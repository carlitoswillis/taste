#!/usr/bin/env node
// Generate data/tv-suggestions.json: series you haven't seen, found by
// following the people behind the films AND series you rated highly — so it
// produces real picks even before a single show is logged (film evidence
// bridges over via TMDB's shared person ids). When themes.json exists the
// curated themes nudge the ranking, same as suggest.mjs. Needs enrichment
// (enrich-tmdb.mjs, and enrich-tv.mjs once shows are logged) and a TMDB key;
// adds critic scores when OMDB_API_KEY is set.
//
// Like suggest.mjs this writes a deep pool: the first HEAD items are the tight
// headline (max 2 per person), the rest fill out to --pool with a looser cap.
// Run: npm run suggest:tv [-- --pool=40 --people=26]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  for (const line of (await readFile(path.join(root, ".env"), "utf8")).split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
} catch {}

const key = process.env.TMDB_API_KEY;
const token = process.env.TMDB_TOKEN;
if (!key && !token) {
  console.error("Set TMDB_API_KEY or TMDB_TOKEN first.");
  process.exit(1);
}

const read = async (name, fallback) => {
  try {
    return JSON.parse(await readFile(path.join(root, `data/${name}.json`), "utf8"));
  } catch {
    return fallback;
  }
};
const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
const region = config.region ?? "US";

// --- sizing knobs (mirrors suggest.mjs) -------------------------------------
// --flag > config.json "suggest.tv" > the defaults here
const num = (name, configured, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  // an empty or junk `--flag=` falls through to config, not past it to dflt
  for (const v of [hit?.split("=")[1], configured]) {
    const n = Number(v);
    if (v != null && v !== "" && Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return dflt;
};
const tuning = config.suggest?.tv ?? {};
const POOL = num("pool", tuning.pool, 40);
const HEAD = Math.min(num("head", tuning.head, 10), POOL);
const PEOPLE = num("people", tuning.people, 26);
const HEAD_CAP = 2;
const POOL_CAP = 5;
const OMDB_MAX = num("omdb", tuning.omdb, 30);

async function tmdb(pathname, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (key) url.searchParams.set("api_key", key);
  const res = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  if (!res.ok) throw new Error(`TMDB ${pathname}: ${res.status}`);
  return res.json();
}
const pause = () => new Promise((r) => setTimeout(r, 120));

const ratings = await read("ratings", []);
const enrichment = await read("enrichment", {});
const tvRatings = await read("tv-ratings", []);
const tvWatchlist = await read("tv-watchlist", []);
const tvEnrichment = await read("tv-enrichment", {});
const themesData = await read("themes", null);
const themeMap = await read("theme-map", null);
// no themes.json / theme-map.json -> degrade gracefully to people-only
const useThemes = Boolean(themesData?.themes?.length && themeMap?.themes?.length);

// Every series already logged or queued is off the table.
// Normalized titles + TMDB ids via enrichment, same defence as suggest.mjs.
const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
const seen = new Set();
const seenIds = new Set();
for (const s of [...tvRatings, ...tvWatchlist]) {
  seen.add(norm(s.title));
  const id = tvEnrichment[`${s.title} (${s.year})`]?.tmdbId;
  if (id) seenIds.add(id);
}

// --- people affinity, weighted by your scores -------------------------------
// score 4 -> 1, 4.5 -> 1.5, 5 -> 2; unified role-weight table across media.
const FILM_ROLE_WEIGHT = { director: 1.6, writer: 1.1, actor: 0.5 };
const TV_ROLE_WEIGHT = { creator: 1.6, writer: 1.1, director: 0.7, actor: 0.6 };
const people = new Map(); // id -> {name, weight, roles:Set, via:[{title, score, role}]}

const credit = (list, role, itemWeight, table, title, score) => {
  for (const p of list ?? []) {
    if (!p.id) continue;
    const entry = people.get(p.id) ?? { name: p.name, weight: 0, roles: new Set(), via: [] };
    entry.weight += itemWeight * table[role];
    entry.roles.add(role);
    if (!entry.via.some((v) => v.title === title)) entry.via.push({ title, score, role });
    people.set(p.id, entry);
  }
};

// film side — exactly the suggest.mjs loop, evidence bridges to TV via person ids
for (const film of ratings) {
  if (film.score == null || film.score < 4) continue;
  const e = enrichment[`${film.title} (${film.year})`];
  if (!e) continue;
  const w = film.score - 3;
  credit(e.director, "director", w, FILM_ROLE_WEIGHT, film.title, film.score);
  credit(e.writers, "writer", w, FILM_ROLE_WEIGHT, film.title, film.score);
  credit(e.cast?.slice(0, 5), "actor", w, FILM_ROLE_WEIGHT, film.title, film.score);
}

// TV side — abandoned shows stay in the seen-set but carry no affinity;
// writers/directors only count with ≥ 25% of the show's episodes.
for (const show of tvRatings) {
  if (show.status === "abandoned") continue;
  if (show.score == null || show.score < 4) continue;
  const e = tvEnrichment[`${show.title} (${show.year})`];
  if (!e) continue;
  const w = show.score - 3;
  const minEp = (e.episodes ?? 0) * 0.25;
  credit(e.creators, "creator", w, TV_ROLE_WEIGHT, show.title, show.score);
  credit(e.writers?.filter((p) => p.episodes >= minEp), "writer", w, TV_ROLE_WEIGHT, show.title, show.score);
  credit(e.directors?.filter((p) => p.episodes >= minEp), "director", w, TV_ROLE_WEIGHT, show.title, show.score);
  credit(e.cast?.slice(0, 5), "actor", w, TV_ROLE_WEIGHT, show.title, show.score);
}

const topPeople = [...people.entries()]
  .sort((a, b) => b[1].weight - a[1].weight)
  .slice(0, PEOPLE);

console.log("Top connections:");
for (const [, p] of topPeople.slice(0, 10)) {
  console.log(`  ${p.name} (${[...p.roles].join("/")}) — ${p.weight.toFixed(1)} via ${p.via.map((v) => v.title).join(", ")}`);
}

// --- candidate series from those people's TV credits ------------------------
// Talk/news/reality/kids genres are noise, not taste.
const DROP_GENRES = new Set([10767, 10763, 10764, 10762]);
const CREW_ALWAYS = new Set(["Creator", "Writer", "Teleplay", "Story"]);
const today = new Date().toISOString().slice(0, 10);
const candidates = new Map(); // tmdbId -> {series, score, contributors:[]}

// Weight a person's pull by what they actually did ON the candidate show —
// an executive-producer credit is not creating, and the card must not imply it.
const CREDIT_FACTOR = { creator: 1, writer: 0.8, story: 0.4, director: 0.8, ep: 0.6, actor: 0.6 };
const CREDIT_OF = { Creator: "creator", Writer: "writer", Teleplay: "writer", Story: "story", Director: "director", "Executive Producer": "ep" };

for (const [id, p] of topPeople) {
  const credits = await tmdb(`/person/${id}/tv_credits`);
  await pause();
  const works = [];
  for (const c of credits.crew ?? []) {
    if (CREW_ALWAYS.has(c.job)) works.push({ ...c, credit: CREDIT_OF[c.job] });
    else if (c.job === "Director" && p.roles.has("director")) works.push({ ...c, credit: "director" });
    else if (c.job === "Executive Producer" && p.roles.has("creator")) works.push({ ...c, credit: "ep" }); // showrunners hide there
  }
  for (const c of (credits.cast ?? []).filter((c) => (c.episode_count ?? 0) >= 6)) works.push({ ...c, credit: "actor" });
  // one person can hold several jobs on one show — collect them before scoring
  const byShow = new Map();
  for (const w of works) {
    const cur = byShow.get(w.id) ?? { info: w, credits: new Set() };
    cur.credits.add(w.credit);
    byShow.set(w.id, cur);
  }
  for (const { info: w, credits: showCredits } of byShow.values()) {
    if (!w.first_air_date || w.first_air_date > today) continue;
    if ((w.vote_count ?? 0) < 100) continue; // drop obscurities
    if ((w.genre_ids ?? []).some((g) => DROP_GENRES.has(g))) continue;
    if (seenIds.has(w.id)) continue;
    if (seen.has(norm(w.name)) || seen.has(norm(w.original_name ?? ""))) continue;
    const c = candidates.get(w.id) ?? {
      title: w.name,
      year: Number(w.first_air_date.slice(0, 4)),
      tmdbId: w.id,
      tmdbRating: w.vote_average ?? 0,
      votes: w.vote_count ?? 0,
      score: 0,
      contributors: [],
    };
    if (!c.contributors.some((x) => x.id === id)) {
      const factor = Math.max(...[...showCredits].map((r) => CREDIT_FACTOR[r]));
      c.score += p.weight * factor;
      c.contributors.push({ id, name: p.name, credits: [...showCredits], weight: p.weight * factor, via: p.via });
    }
    candidates.set(w.id, c);
  }
}

// --- theme scoring: candidate keywords vs the curated theme vocabulary ------
// Same blend and cap as suggest.mjs; TV keywords live under .results.
const THEME_BLEND = 3;
const themeWeight = new Map((themesData?.themes ?? []).map((t) => [t.id, t.affinityNorm])); // 0..1
const themeName = new Map((themeMap?.themes ?? []).map((t) => [t.id, t.name]));
const kwToTheme = new Map(); // lowercase keyword name -> theme id
for (const t of themeMap?.themes ?? []) for (const k of t.keywords ?? []) kwToTheme.set(k.trim().toLowerCase(), t.id);
const themeScoreOf = (keywords) => {
  const hit = new Set();
  for (const k of keywords) {
    const t = kwToTheme.get(k.name.trim().toLowerCase());
    if (t) hit.add(t);
  }
  return { score: Math.min([...hit].reduce((s, t) => s + (themeWeight.get(t) ?? 0), 0), 2), themes: [...hit] };
};

if (useThemes) {
  const shortlist = [...candidates.values()]
    .sort((a, b) => b.score * 2 + b.tmdbRating / 2 - (a.score * 2 + a.tmdbRating / 2))
    .slice(0, POOL * 2);
  for (const c of shortlist) {
    const kw = await tmdb(`/tv/${c.tmdbId}/keywords`);
    await pause();
    const { score, themes } = themeScoreOf(kw.results ?? []);
    c.themeScore = score;
    c.themes = themes;
  }
}

// Rank in two passes: tight per-person cap for the headline, looser one to fill
// out the pool — same shape as suggest.mjs.
const sorted = [...candidates.values()]
  .map((c) => ({ ...c, rankScore: c.score * 2 + (c.themeScore ?? 0) * THEME_BLEND + c.tmdbRating / 2 }))
  .sort((a, b) => b.rankScore - a.rankScore);
const taken = new Map(); // person id -> count
const chosen = new Set(); // tmdb ids already placed
const ranked = [];
for (const { limit, cap } of [{ limit: HEAD, cap: HEAD_CAP }, { limit: POOL, cap: POOL_CAP }]) {
  for (const c of sorted) {
    if (ranked.length >= limit) break;
    if (chosen.has(c.tmdbId)) continue;
    const primary = c.contributors.reduce((a, b) => (people.get(b.id).weight > people.get(a.id).weight ? b : a));
    if ((taken.get(primary.id) ?? 0) >= cap) continue;
    taken.set(primary.id, (taken.get(primary.id) ?? 0) + 1);
    chosen.add(c.tmdbId);
    ranked.push(c);
  }
}
ranked.forEach((c, i) => (c.rank = i + 1));

// --- flesh out the picks: creators, size, providers, critic scores ----------
const omdbKey = process.env.OMDB_API_KEY;
const VERB = { creator: "created", director: "directed", writer: "wrote", actor: "stars in" };
let enriched = 0;
for (const c of ranked) {
  if (++enriched % 20 === 0) console.log(`  …enriched ${enriched}/${ranked.length}`);
  const detail = await tmdb(`/tv/${c.tmdbId}`, { append_to_response: "external_ids,watch/providers" });
  await pause();
  const providers = detail["watch/providers"]?.results?.[region] ?? {};
  c.creators = detail.created_by?.map((x) => x.name) ?? [];
  c.seasons = detail.number_of_seasons ?? null;
  c.episodes = detail.number_of_episodes ?? null;
  c.episodeRuntime = detail.episode_run_time?.[0] ?? detail.last_episode_to_air?.runtime ?? null;
  c.showStatus = detail.status ?? null;
  c.genres = detail.genres?.map((g) => g.name) ?? [];
  c.poster = detail.poster_path ? `https://image.tmdb.org/t/p/w342${detail.poster_path}` : null;
  c.providers = {
    flatrate: providers.flatrate?.map((x) => x.provider_name) ?? [],
    rent: providers.rent?.map((x) => x.provider_name) ?? [],
  };
  if (omdbKey && detail.external_ids?.imdb_id && enriched <= OMDB_MAX) {
    const data = await fetch(`https://www.omdbapi.com/?i=${detail.external_ids.imdb_id}&apikey=${omdbKey}`).then((r) => r.json()).catch(() => null);
    if (data?.Response !== "False" && data?.Ratings) {
      const by = Object.fromEntries(data.Ratings.map((r) => [r.Source, r.Value]));
      c.scores = {
        rt: by["Rotten Tomatoes"] ? parseInt(by["Rotten Tomatoes"]) : null,
        metacritic: by["Metacritic"] ? parseInt(by["Metacritic"]) : null,
        imdb: by["Internet Movie Database"] ? parseFloat(by["Internet Movie Database"]) : null,
      };
    }
    await pause();
  }
  // human-readable reason — first what the person did on THIS show, then the
  // evidence, where each via line carries its own verb ("directed Persona 5★")
  const DID = { creator: "created this", writer: "wrote for this", story: "has a story credit here", director: "directed episodes", ep: "executive-produced this", actor: "stars in this" };
  c.why = c.contributors
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((p) => {
      const best = ["creator", "writer", "director", "story", "ep", "actor"].find((r) => p.credits.includes(r));
      return `${p.name} ${DID[best]} (${p.via.slice(0, 3).map((v) => `${VERB[v.role]} ${v.title} ${v.score}★`).join(", ")})`;
    })
    .join(" · ");
  if (c.themes?.length) c.why += ` · themes: ${c.themes.map((t) => (themeName.get(t) ?? t).toLowerCase()).join(", ")}`;
  else delete c.themes;
  delete c.contributors;
  delete c.rankScore;
  delete c.themeScore;
  // votes survives: the UI's "deep cuts" lens is a vote-count filter
}

const out = {
  generated: new Date().toISOString(),
  basedOn:
    ratings.filter((r) => r.score >= 4).length +
    tvRatings.filter((r) => r.score >= 4 && r.status !== "abandoned").length,
  head: Math.min(HEAD, ranked.length),
  items: ranked,
};
await writeFile(path.join(root, "data/tv-suggestions.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n${ranked.length} suggestions (head ${out.head}) -> data/tv-suggestions.json`);
for (const c of ranked) console.log(`  ${c.rank}. ${c.title} (${c.year}) — ${c.why}`);
