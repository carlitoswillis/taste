#!/usr/bin/env node
// For the Fire TV feed: find, per film, how much of each of its TMDB backdrops is black, so the feed builder
// (scripts/build-tv-feed.mjs) can prefer a backdrop that reads as a picture over one that looks like a failed image
// load (Paris, je t'aime: ~40 % pure black). Fetches /movie/{id}/images (textless, wide) and the small w300 copy of
// each candidate, counts near-black pixels, and caches the result in data/tv-backdrops.json, keyed by TMDB id:
//   { "<tmdbId>": { at: "2026-10-25", d: { "/abc.jpg": 0.4, "/def.jpg": 0.02 } } }
// Only films with no cache entry are fetched, so a daily run costs a few requests. JPEGs are decoded with jpeg-js
// (installed by the workflow with `npm i --no-save`); without it, or without a TMDB key, this exits 0 and changes nothing.
//
// Keys are read from .env or the environment: TMDB_API_KEY (v3) or TMDB_TOKEN (v4).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { darkShare } from "./lib/tv-feed-rules.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  for (const line of (await readFile(path.join(root, ".env"), "utf8")).split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
} catch {}

const key = process.env.TMDB_API_KEY;
const token = process.env.TMDB_TOKEN;
if (!key && !token) { console.log("tv-backdrops: no TMDB key, skipped"); process.exit(0); }
let jpeg;
try { jpeg = (await import("jpeg-js")).default; } catch { console.log("tv-backdrops: jpeg-js not installed, skipped"); process.exit(0); }

const readJson = async (f, fb) => { try { return JSON.parse(await readFile(path.join(root, f), "utf8")); } catch { return fb; } };
const MAX_CAND = Number(process.env.TV_BACKDROPS_MAX ?? 5);
const MAX_NEW = Number(process.env.TV_BACKDROPS_BATCH ?? 80);
const IMG = "https://image.tmdb.org/t/p";

async function tmdb(pathname, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (key) url.searchParams.set("api_key", key);
  const res = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : {});
  if (!res.ok) throw new Error(`TMDB ${pathname}: ${res.status}`);
  return res.json();
}

async function shareOf(p) {
  const res = await fetch(`${IMG}/w300${p}`);
  if (!res.ok) throw new Error(`image ${res.status}`);
  const img = jpeg.decode(new Uint8Array(await res.arrayBuffer()), { useTArray: true, maxMemoryUsageInMB: 64 });
  return Math.round(darkShare(img.data) * 100) / 100;
}

// The films the TV feed can show: the owner's queue, the Letterboxd watchlist, the recommender's picks (same join as the builder).
const enrich = await readJson("data/enrichment.json", {});
const films = [];
const add = (title, year) => { const e = enrich[`${title} (${year})`]; if (e?.tmdbId) films.push(e); };
for (const w of await readJson("data/watchlist.json", [])) add(w.title, w.year);
for (const w of (await readJson("data/letterboxd-watchlist.json", {}))?.items ?? []) add(w.title, w.year);
for (const s of (await readJson("data/suggestions.json", {}))?.items ?? []) { if (s.tmdbId) films.push({ tmdbId: s.tmdbId, backdrop: enrich[`${s.title} (${s.year})`]?.backdrop ?? null }); }

const outPath = path.join(root, "data/tv-backdrops.json");
const cache = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : {};
const today = new Date().toISOString().slice(0, 10);
const seen = new Set();
let fetched = 0, failed = 0;
for (const e of films) {
  const id = String(e.tmdbId);
  if (seen.has(id) || cache[id]) continue;
  seen.add(id);
  if (fetched >= MAX_NEW) break;
  try {
    const imgs = await tmdb(`/movie/${id}/images`, { include_image_language: "null" });
    const wide = (imgs.backdrops ?? []).filter((b) => b.file_path && b.width >= 1280 && b.width / b.height > 1.7 && b.width / b.height < 1.85);
    wide.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    const paths = [...new Set([e.backdrop, ...wide.map((b) => b.file_path)].filter(Boolean))].slice(0, MAX_CAND + 1);
    const d = {};
    for (const p of paths) { try { d[p] = await shareOf(p); } catch { /* one bad image: the rest still count */ } }
    cache[id] = { at: today, d };
    fetched++;
  } catch (err) { failed++; console.warn(`tv-backdrops ${id}: ${err.message}`); }
}
const sorted = Object.fromEntries(Object.entries(cache).sort((a, b) => Number(a[0]) - Number(b[0])));
await writeFile(outPath, JSON.stringify(sorted, null, 1) + "\n");
console.log(`tv-backdrops: ${fetched} films fetched, ${failed} failed, ${Object.keys(sorted).length} cached`);
