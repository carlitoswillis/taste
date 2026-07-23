#!/usr/bin/env node
// Generate data/suggestions.json: films you haven't seen, found by following
// the people — directors, writers, actors — behind the films you rated highly,
// weighted by your own scores. Needs enrichment (run enrich-tmdb.mjs first)
// and a TMDB key; adds critic scores when OMDB_API_KEY is set.
// Run: npm run suggest

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

// Everything already seen, queued, or on trial is off the table.
const seen = new Set();
for (const f of [...ratings, ...watchlist, ...oldFilms, ...watched]) {
  seen.add(f.title.toLowerCase());
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
  .slice(0, 18);

console.log("Top connections:");
for (const [, p] of topPeople.slice(0, 10)) {
  console.log(`  ${p.name} (${[...p.roles].join("/")}) — ${p.weight.toFixed(1)} via ${p.via.map((v) => v.title).join(", ")}`);
}

// --- candidate films from those people's filmographies ----------------------
const candidates = new Map(); // tmdbId -> {film, score, contributors:[]}

for (const [id, p] of topPeople) {
  const credits = await tmdb(`/person/${id}/movie_credits`);
  await pause();
  const works = [];
  if (p.roles.has("director")) {
    works.push(...(credits.crew ?? []).filter((c) => c.job === "Director"));
  }
  if (p.roles.has("writer")) {
    works.push(...(credits.crew ?? []).filter((c) => ["Writer", "Screenplay", "Story"].includes(c.job)));
  }
  if (p.roles.has("actor")) {
    works.push(...(credits.cast ?? []).filter((c) => (c.order ?? 99) <= 4));
  }
  for (const w of works) {
    if (!w.release_date || w.release_date > new Date().toISOString().slice(0, 10)) continue;
    if ((w.vote_count ?? 0) < 150) continue; // drop obscurities and shorts
    if (seen.has(w.title.toLowerCase()) || seen.has((w.original_title ?? "").toLowerCase())) continue;
    const c = candidates.get(w.id) ?? {
      title: w.title,
      year: Number(w.release_date.slice(0, 4)),
      tmdbId: w.id,
      tmdbRating: w.vote_average ?? 0,
      votes: w.vote_count ?? 0,
      score: 0,
      contributors: [],
    };
    if (!c.contributors.some((x) => x.id === id)) {
      c.score += p.weight;
      c.contributors.push({ id, name: p.name, roles: [...p.roles], via: p.via });
    }
    candidates.set(w.id, c);
  }
}

// Rank, but cap how many slots any one person can take — otherwise a single
// beloved director with a deep filmography floods the whole list.
const PER_PERSON_CAP = 2;
const sorted = [...candidates.values()]
  .map((c) => ({ ...c, rankScore: c.score * 2 + c.tmdbRating / 2 }))
  .sort((a, b) => b.rankScore - a.rankScore);
const taken = new Map(); // person id -> count
const ranked = [];
for (const c of sorted) {
  if (ranked.length >= 12) break;
  const primary = c.contributors.reduce((a, b) => (people.get(b.id).weight > people.get(a.id).weight ? b : a));
  if ((taken.get(primary.id) ?? 0) >= PER_PERSON_CAP) continue;
  taken.set(primary.id, (taken.get(primary.id) ?? 0) + 1);
  ranked.push(c);
}

// --- flesh out the top picks: runtime, providers, critic scores -------------
const omdbKey = process.env.OMDB_API_KEY;
for (const c of ranked) {
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
  if (omdbKey && detail.imdb_id) {
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
  // human-readable reason, built from the strongest contributors
  c.why = c.contributors
    .sort((a, b) => b.via.length - a.via.length)
    .slice(0, 2)
    .map((p) => {
      const role = p.roles.includes("director") ? "directed" : p.roles.includes("writer") ? "wrote" : "stars in";
      const via = p.via.slice(0, 3).map((v) => `${v.title} ${v.score}★`).join(", ");
      return `${p.name} (${role} ${via})`;
    })
    .join(" · ");
  delete c.contributors;
  delete c.votes;
  delete c.rankScore;
}

const out = { generated: new Date().toISOString(), basedOn: ratings.filter((r) => r.score >= 4).length, items: ranked };
await writeFile(path.join(root, "data/suggestions.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n${ranked.length} suggestions -> data/suggestions.json`);
for (const c of ranked) console.log(`  ${c.title} (${c.year}) — ${c.why}`);
