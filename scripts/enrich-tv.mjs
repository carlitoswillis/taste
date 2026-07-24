#!/usr/bin/env node
// Enrich logged TV series with TMDB metadata — creators, writers, directors,
// cast (aggregate credits), keywords, seasons/episodes, IMDb id, and where to
// watch — and, when an OMDb key is present, critic scores looked up by IMDb id
// (Metacritic is usually null for TV; renderers already skip nulls).
// Reads tv-ratings.json + tv-watchlist.json; writes data/tv-enrichment.json
// keyed "Title (Year)" (first-air year). Suggested-but-unlogged series are
// fleshed out by suggest-tv.mjs itself, like suggest.mjs does for films.
//
// Keys are read from .env or the environment:
//   TMDB_API_KEY (v3) or TMDB_TOKEN (v4)  — themoviedb.org/settings/api
//   OMDB_API_KEY (optional)               — omdbapi.com/apikey.aspx

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// load .env if present, without overriding real env vars
try {
  for (const line of (await readFile(path.join(root, ".env"), "utf8")).split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
} catch {}

const key = process.env.TMDB_API_KEY;
const token = process.env.TMDB_TOKEN;
if (!key && !token) {
  console.error("Set TMDB_API_KEY (v3) or TMDB_TOKEN (v4 read token). Free at themoviedb.org/settings/api");
  process.exit(1);
}

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

const shows = [];
for (const file of ["data/tv-ratings.json", "data/tv-watchlist.json"]) {
  try {
    shows.push(...JSON.parse(await readFile(path.join(root, file), "utf8")));
  } catch {}
}

const outPath = path.join(root, "data/tv-enrichment.json");
const existing = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : {};
const out = { ...existing };

const person = (c) => ({ id: c.id, name: c.name });
const WRITER_JOBS = new Set(["Writer", "Story", "Teleplay"]);
const DIRECTOR_JOBS = new Set(["Director"]);
// aggregate_credits crew: episode counts summed across matching jobs, top 5
const crewByJobs = (crew, jobs) =>
  (crew ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      episodes: (c.jobs ?? []).filter((j) => jobs.has(j.job)).reduce((s, j) => s + (j.episode_count ?? 0), 0),
    }))
    .filter((c) => c.episodes > 0)
    .sort((a, b) => b.episodes - a.episodes)
    .slice(0, 5);

let hits = 0;
for (const show of shows) {
  if (!show.year) continue;
  const k = `${show.title} (${show.year})`;
  if (out[k]?.tmdbId) continue;

  const search = await tmdb("/search/tv", { query: show.title, first_air_date_year: show.year });
  const match = search.results?.[0];
  if (!match) {
    console.warn(`  no TMDB match: ${k}`);
    continue;
  }
  const detail = await tmdb(`/tv/${match.id}`, {
    append_to_response: "aggregate_credits,keywords,external_ids,watch/providers",
  });
  const credits = detail.aggregate_credits ?? {};
  const providers = detail["watch/providers"]?.results?.[region] ?? {};
  out[k] = {
    id: `t:${match.id}`,
    tmdbId: match.id,
    imdbId: detail.external_ids?.imdb_id ?? null,
    creators: detail.created_by?.map(person) ?? [],
    writers: crewByJobs(credits.crew, WRITER_JOBS),
    directors: crewByJobs(credits.crew, DIRECTOR_JOBS),
    cast:
      credits.cast
        ?.slice()
        .sort((a, b) => (b.total_episode_count ?? 0) - (a.total_episode_count ?? 0))
        .slice(0, 8)
        .map((c) => ({ id: c.id, name: c.name, episodes: c.total_episode_count ?? 0 })) ?? [],
    seasons: detail.number_of_seasons ?? null,
    episodes: detail.number_of_episodes ?? null,
    episodeRuntime: detail.episode_run_time?.[0] ?? detail.last_episode_to_air?.runtime ?? null,
    showStatus: detail.status ?? null,
    firstAir: detail.first_air_date ?? null,
    lastAir: detail.last_air_date ?? null,
    genres: detail.genres?.map((g) => g.name) ?? [],
    keywords: detail.keywords?.results?.map((kw) => ({ id: kw.id, name: kw.name })) ?? [], // TV nests under .results
    tmdbRating: detail.vote_average ?? null,
    poster: match.poster_path ? `https://image.tmdb.org/t/p/w342${match.poster_path}` : null,
    providers: {
      flatrate: providers.flatrate?.map((p) => p.provider_name) ?? [],
      rent: providers.rent?.map((p) => p.provider_name) ?? [],
      buy: providers.buy?.map((p) => p.provider_name) ?? [],
    },
    providersLink: providers.link ?? null,
    region,
    scores: existing[k]?.scores, // keep critic scores across schema refreshes
  };
  if (!out[k].scores) delete out[k].scores;
  hits++;
  console.log(`  enriched: ${k}`);
  await new Promise((r) => setTimeout(r, 120)); // stay friendly to the API
}

// Second pass: critic scores from OMDb, by IMDb id, for entries that lack them.
const omdbKey = process.env.OMDB_API_KEY;
if (omdbKey) {
  let scored = 0;
  for (const [k, entry] of Object.entries(out)) {
    if (!entry.imdbId || entry.scores) continue;
    const res = await fetch(
      `https://www.omdbapi.com/?i=${entry.imdbId}&apikey=${omdbKey}`
    );
    if (!res.ok) {
      console.warn(`  OMDb ${k}: ${res.status}`);
      continue;
    }
    const data = await res.json();
    if (data.Response === "False") continue;
    const bySource = Object.fromEntries((data.Ratings ?? []).map((r) => [r.Source, r.Value]));
    entry.scores = {
      rt: bySource["Rotten Tomatoes"] ? parseInt(bySource["Rotten Tomatoes"]) : null,
      metacritic: bySource["Metacritic"] ? parseInt(bySource["Metacritic"]) : null,
      imdb: bySource["Internet Movie Database"] ? parseFloat(bySource["Internet Movie Database"]) : null,
    };
    scored++;
    console.log(`  scores: ${k} — RT ${entry.scores.rt ?? "—"} · MC ${entry.scores.metacritic ?? "—"} · IMDb ${entry.scores.imdb ?? "—"}`);
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`${scored} series scored via OMDb`);
} else {
  console.log("(no OMDB_API_KEY — skipping critic scores)");
}

await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`\n${hits} new, ${Object.keys(out).length} total -> data/tv-enrichment.json`);
