#!/usr/bin/env node
// Enrich films with TMDB metadata — director, runtime, IMDb id, and where to
// watch (streaming/rent providers, via the JustWatch data TMDB exposes) — and,
// when an OMDb key is present, critic scores (Rotten Tomatoes, Metacritic,
// IMDb) looked up by IMDb id. Writes data/enrichment.json keyed "Title (Year)".
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

// Enrich everything we have titles for.
const films = [];
for (const file of ["data/watchlist.json", "data/ratings.json", "data/old-films.json"]) {
  films.push(...JSON.parse(await readFile(path.join(root, file), "utf8")));
}

const outPath = path.join(root, "data/enrichment.json");
const existing = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : {};
const out = { ...existing };

let hits = 0;
for (const film of films) {
  if (!film.year) continue;
  const k = `${film.title} (${film.year})`;
  if (out[k]?.tmdbId) continue; // already enriched; delete the entry to refresh

  const search = await tmdb("/search/movie", { query: film.title, year: film.year });
  const match = search.results?.[0];
  if (!match) {
    console.warn(`  no TMDB match: ${k}`);
    continue;
  }
  const detail = await tmdb(`/movie/${match.id}`, { append_to_response: "credits,watch/providers" });
  const providers = detail["watch/providers"]?.results?.[region] ?? {};
  out[k] = {
    tmdbId: match.id,
    imdbId: detail.imdb_id ?? null,
    director: detail.credits?.crew?.filter((c) => c.job === "Director").map((c) => c.name) ?? [],
    cast: detail.credits?.cast?.slice(0, 5).map((c) => c.name) ?? [],
    runtime: detail.runtime ?? null,
    genres: detail.genres?.map((g) => g.name) ?? [],
    poster: match.poster_path ? `https://image.tmdb.org/t/p/w342${match.poster_path}` : null,
    providers: {
      flatrate: providers.flatrate?.map((p) => p.provider_name) ?? [],
      rent: providers.rent?.map((p) => p.provider_name) ?? [],
      buy: providers.buy?.map((p) => p.provider_name) ?? [],
    },
    providersLink: providers.link ?? null,
    region,
  };
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
  console.log(`${scored} films scored via OMDb`);
} else {
  console.log("(no OMDB_API_KEY — skipping critic scores)");
}

await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`\n${hits} new, ${Object.keys(out).length} total -> data/enrichment.json`);
