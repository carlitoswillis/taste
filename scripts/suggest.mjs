#!/usr/bin/env node
// Generate data/suggestions.json: films you haven't seen, found by following
// the people — directors, writers, actors — behind the films you rated highly,
// weighted by your own scores. When themes.json exists (run themes.mjs first)
// the curated themes nudge the ranking and add wildcard themePicks.
// Needs enrichment (run enrich-tmdb.mjs first) and a TMDB key; adds critic
// scores when OMDB_API_KEY is set.
//
// Writes a deep pool, not a shortlist: the first HEAD items are the tight
// headline (max 2 per person), the rest fill out to --pool with a looser cap so
// the UI has something to filter, shuffle and rotate through.
// Run: npm run suggest [-- --pool=60 --people=30]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORY_JOBS, WRITER_JOBS, scoreFilm, describeCredit } from "./lib/film-score.mjs";

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

// --- sizing knobs -----------------------------------------------------------
// POOL is the whole ranked list written to disk; HEAD is the tight top of it.
// PEOPLE is how far down the affinity list we chase filmographies — more people
// means more distinct primaries, which is what lets the pool stay varied.
// Precedence: --flag > config.json "suggest.film" > the defaults here. The
// config layer is what makes a bigger pool stick: the daily sync passes no
// flags, so without it every run would snap back to the built-in numbers.
// Falls through the layers in order, taking the first usable positive number.
// An empty or junk `--pool=` must fall through to config rather than past it to
// the built-in default — otherwise a caller that assembles flags from a form
// silently loses the configured size whenever a field is left blank.
const num = (name, configured, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  for (const v of [hit?.split("=")[1], configured]) {
    const n = Number(v);
    if (v != null && v !== "" && Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return dflt;
};
const tuning = config.suggest?.film ?? {};
const POOL = num("pool", tuning.pool, 60);
const HEAD = Math.min(num("head", tuning.head, 12), POOL);
const PEOPLE = num("people", tuning.people, 30);
const HEAD_CAP = 2; // per person, inside the headline
const POOL_CAP = 5; // per person, across the whole pool
const OMDB_MAX = num("omdb", tuning.omdb, 40); // critic-score lookups are the rate-limited bit

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
const watchlist = await read("watchlist", []);
const oldFilms = await read("old-films", []);
const watched = await read("watched", []);
const enrichment = await read("enrichment", {});
const themesData = await read("themes", null);
const themeMap = await read("theme-map", null);
// no themes.json / theme-map.json -> degrade gracefully to people-only
const useThemes = Boolean(themesData?.themes?.length && themeMap?.themes?.length);

// Everything already seen, queued, or on trial is off the table.
// Matched two ways: normalized title (curly quotes, accents and punctuation
// must not save a duplicate) and TMDB id via enrichment (exact, survives any
// retitling on either side).
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
for (const f of [...ratings, ...watchlist, ...oldFilms, ...watched]) {
  seen.add(norm(f.title));
  const id = enrichment[`${f.title} (${f.year})`]?.tmdbId;
  if (id) seenIds.add(id);
}

// --- people affinity, weighted by your scores -------------------------------
// score 4 -> 1, 4.5 -> 1.5, 5 -> 2; role weights: director > writer > actor
const ROLE_WEIGHT = { director: 1.6, writer: 1.1, actor: 0.5 };
const people = new Map(); // id -> {name, weight, roles:Set, via:[{title, score}]}

for (const film of ratings) {
  if (film.score == null || film.score < 4) continue;
  const e = enrichment[`${film.title} (${film.year})`];
  if (!e) continue;
  const filmWeight = film.score - 3;
  const credit = (list, role) => {
    for (const p of list ?? []) {
      if (!p.id) continue;
      const entry = people.get(p.id) ?? { name: p.name, weight: 0, roles: new Set(), via: [] };
      entry.weight += filmWeight * ROLE_WEIGHT[role];
      entry.roles.add(role);
      if (!entry.via.some((v) => v.title === film.title)) entry.via.push({ title: film.title, score: film.score });
      people.set(p.id, entry);
    }
  };
  credit(e.director, "director");
  credit(e.writers, "writer");
  credit(e.cast?.slice(0, 5), "actor");
}

const topPeople = [...people.entries()]
  .sort((a, b) => b[1].weight - a[1].weight)
  .slice(0, PEOPLE);

console.log("Top connections:");
for (const [, p] of topPeople.slice(0, 10)) {
  console.log(`  ${p.name} (${[...p.roles].join("/")}) — ${p.weight.toFixed(1)} via ${p.via.map((v) => v.title).join(", ")}`);
}

// --- candidate films from those people's filmographies ----------------------
// A person's pull toward a candidate depends on what they actually did ON that
// film, and how prominent that was — see scripts/lib/film-score.mjs for the
// rules (role, billing order, anthology crowding, corroboration, quality prior).
// Here we only collect the raw credits; scoring happens once we know the film's
// full credit counts.
const candidates = new Map(); // tmdbId -> {film, contributors:[{id, name, weight, credits, via, favourite}]}

for (const [id, p] of topPeople) {
  const credits = await tmdb(`/person/${id}/movie_credits`);
  await pause();
  const works = [];
  if (p.roles.has("director")) {
    for (const c of (credits.crew ?? []).filter((c) => c.job === "Director")) works.push({ ...c, credit: { kind: "director" } });
  }
  if (p.roles.has("writer")) {
    // Screenplay/Writer are authorship; Story/Novel/Characters are idea credits.
    for (const c of (credits.crew ?? []).filter((c) => [...WRITER_JOBS, ...STORY_JOBS].includes(c.job)))
      works.push({ ...c, credit: { kind: WRITER_JOBS.includes(c.job) ? "writer" : "story" } });
  }
  if (p.roles.has("actor")) {
    // keep billing order: a lead is not a bit part
    for (const c of (credits.cast ?? []).filter((c) => (c.order ?? 99) <= 4)) works.push({ ...c, credit: { kind: "actor", order: c.order ?? 99 } });
  }
  // one person can hold several jobs on one film — collect them before scoring
  const byFilm = new Map();
  for (const w of works) {
    const cur = byFilm.get(w.id) ?? { info: w, credits: [] };
    cur.credits.push(w.credit);
    byFilm.set(w.id, cur);
  }
  for (const { info: w, credits: filmCredits } of byFilm.values()) {
    if (!w.release_date || w.release_date > new Date().toISOString().slice(0, 10)) continue;
    if ((w.vote_count ?? 0) < 150) continue; // drop obscurities and shorts
    if (seenIds.has(w.id)) continue;
    if (seen.has(norm(w.title)) || seen.has(norm(w.original_title ?? ""))) continue;
    const c = candidates.get(w.id) ?? {
      title: w.title,
      year: Number(w.release_date.slice(0, 4)),
      tmdbId: w.id,
      tmdbRating: w.vote_average ?? 0,
      votes: w.vote_count ?? 0,
      contributors: [],
    };
    if (!c.contributors.some((x) => x.id === id)) {
      // a story credit only counts for more when the source is a 5-star film of yours
      const favourite = p.via.some((v) => v.score >= 5);
      c.contributors.push({ id, name: p.name, weight: p.weight, credits: filmCredits, via: p.via, favourite });
    }
    candidates.set(w.id, c);
  }
}

// Provisional pass (no crowding info yet, theme benefit of the doubt) just to
// pick whom to look at closely. Then ONE detail call per shortlisted film gives
// the full credit counts (anthology crowding) and the keywords (themes).
const SHORTLIST = POOL * 3;
const shortlist = [...candidates.values()]
  .map((c) => ({ c, s: scoreFilm(c.contributors, { tmdbRating: c.tmdbRating, votes: c.votes, counts: {}, themeScore: 1 }).score }))
  .sort((a, b) => b.s - a.s)
  .slice(0, SHORTLIST)
  .map((x) => x.c);

// --- theme scoring: candidate keywords vs the curated theme vocabulary ------
// Weighted by your own theme affinities (0..1 each, sum capped at 2). With
// THEME_BLEND = 3 the theme term tops out at 6 while the people term spans
// ~4–26: themes reorder the middle and break ties, never outrank a person.
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

for (const c of shortlist) {
  const d = await tmdb(`/movie/${c.tmdbId}`, { append_to_response: "credits,keywords" });
  await pause();
  const crew = d.credits?.crew ?? [];
  const uniq = (jobs) => new Set(crew.filter((x) => jobs.includes(x.job)).map((x) => x.id)).size;
  c.counts = { director: uniq(["Director"]), writer: uniq(WRITER_JOBS) || uniq(STORY_JOBS), cast: d.credits?.cast?.length ?? 0 };
  if (useThemes) {
    const { score, themes } = themeScoreOf(d.keywords?.keywords ?? []);
    c.themeScore = score;
    c.themes = themes;
  }
  const r = scoreFilm(c.contributors, c);
  c.score = Math.round(r.score * 100) / 100;
  c.links = r.links; // strongest first, indexes into contributors
  c.corroborated = r.corroborated;
}

// Rank, but cap how many slots any one person can take — otherwise a single
// beloved director with a deep filmography floods the whole list. Two passes:
// the headline gets the tight cap, then the pool refills with a looser one, so
// depth costs variety only after the top of the list is settled.
// (the quality prior is already inside c.score, so no separate rating term)
const sorted = shortlist
  .map((c) => ({ ...c, rankScore: c.score * 2 + (c.themeScore ?? 0) * THEME_BLEND }))
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

// --- theme wildcards: top-rated unseen films from your strongest themes -----
// Discover-based, kept out of items so the people list stays honest. Several
// per theme across two pages, so this section is a shelf to browse rather than
// a single pick that never changes.
const THEME_COUNT = num("themes", tuning.themes, 5);
const PER_THEME = num("perTheme", tuning.perTheme, 3);
const themePicks = [];
if (useThemes) {
  const rankedIds = new Set(ranked.map((c) => c.tmdbId));
  const topThemes = [...themesData.themes].sort((a, b) => b.affinity - a.affinity).slice(0, THEME_COUNT);
  for (const t of topThemes) {
    if (!t.keywordIds?.length) continue;
    let got = 0;
    for (const page of [1, 2]) {
      if (got >= PER_THEME) break;
      const found = await tmdb("/discover/movie", {
        with_keywords: t.keywordIds.join("|"),
        sort_by: "vote_average.desc",
        "vote_count.gte": 300,
        include_adult: "false",
        page,
      });
      await pause();
      for (const r of found.results ?? []) {
        if (got >= PER_THEME) break;
        if (!r.release_date || r.release_date > new Date().toISOString().slice(0, 10)) continue;
        if (seenIds.has(r.id)) continue;
        if (seen.has(norm(r.title)) || seen.has(norm(r.original_title ?? ""))) continue;
        if (rankedIds.has(r.id) || themePicks.some((p) => p.tmdbId === r.id)) continue;
        themePicks.push({
          title: r.title,
          year: Number(r.release_date.slice(0, 4)),
          tmdbId: r.id,
          tmdbRating: r.vote_average ?? 0,
          votes: r.vote_count ?? 0,
          theme: t.id,
          why: `${t.id} — the thread through ${t.lovedCount} of your loved films`,
        });
        got++;
      }
    }
  }
}

// --- flesh out the picks: runtime, providers, critic scores -----------------
// Every pool item gets TMDB detail (providers drive the streaming filter, so
// the tail needs them as much as the head); OMDb critic scores stop at
// OMDB_MAX because that's the quota-limited call.
const omdbKey = process.env.OMDB_API_KEY;
const toEnrich = [...ranked, ...themePicks];
let enriched = 0;
for (const c of toEnrich) {
  if (++enriched % 20 === 0) console.log(`  …enriched ${enriched}/${toEnrich.length}`);
  const detail = await tmdb(`/movie/${c.tmdbId}`, { append_to_response: "credits,watch/providers" });
  await pause();
  const providers = detail["watch/providers"]?.results?.[region] ?? {};
  c.director = detail.credits?.crew?.filter((x) => x.job === "Director").map((x) => x.name) ?? [];
  c.runtime = detail.runtime ?? null;
  c.genres = detail.genres?.map((g) => g.name) ?? [];
  c.poster = detail.poster_path ? `https://image.tmdb.org/t/p/w342${detail.poster_path}` : null;
  c.providers = {
    flatrate: providers.flatrate?.map((x) => x.provider_name) ?? [],
    rent: providers.rent?.map((x) => x.provider_name) ?? [],
  };
  if (omdbKey && detail.imdb_id && enriched <= OMDB_MAX) {
    const data = await fetch(`https://www.omdbapi.com/?i=${detail.imdb_id}&apikey=${omdbKey}`).then((r) => r.json()).catch(() => null);
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
  // human-readable reason, built from the strongest contributors. The verb
  // describes the person's credit on THIS film — never their role elsewhere.
  // (theme wildcards carry no contributors — their why is set already)
  if (c.contributors) {
    // strongest REAL links only: drop ones far weaker than the lead link
    const top = c.links[0]?.weight ?? 0;
    c.why = c.links
      .filter((l, i) => i === 0 || l.weight >= top * 0.25)
      .slice(0, 2)
      .map((l) => {
        const p = c.contributors[l.index];
        const did = describeCredit(l.kind, p.credits, c.counts);
        const via = p.via.slice(0, 3).map((v) => `${v.title} ${v.score}★`).join(", ");
        return `${p.name} ${did} — you rated ${via}`;
      })
      .join(" · ");
  }
  if (c.themes?.length) c.why += ` · themes: ${c.themes.map((t) => (themeName.get(t) ?? t).toLowerCase()).join(", ")}`;
  else delete c.themes;
  delete c.contributors;
  delete c.links;
  delete c.counts;
  delete c.corroborated;
  delete c.rankScore;
  delete c.themeScore;
  // votes survives: the UI's "deep cuts" lens is a vote-count filter
}

const out = {
  generated: new Date().toISOString(),
  basedOn: ratings.filter((r) => r.score >= 4).length,
  head: Math.min(HEAD, ranked.length), // where the tight top of the list ends
  items: ranked,
};
if (themePicks.length) out.themePicks = themePicks;
await writeFile(path.join(root, "data/suggestions.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n${ranked.length} suggestions (head ${out.head}) -> data/suggestions.json`);
for (const c of ranked) console.log(`  ${c.rank}. ${c.title} (${c.year}) — ${c.why}`);
if (themePicks.length) {
  console.log(`\n${themePicks.length} theme picks:`);
  for (const c of themePicks) console.log(`  ${c.title} (${c.year}) — ${c.why}`);
}
