#!/usr/bin/env node
// Recompute the deterministic layer of the taste profile into data/stats.json.
// This is the part of "the profile" that never goes stale: counts, tier spread,
// decades, genre tilt, and where your scores diverge from the critics. The
// prose analysis in profile.json is the LLM's job (see /refresh-profile);
// this script's job is to make the numbers self-updating. Run: npm run stats

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, "data");

const load = async (f, fallback) => {
  try {
    return JSON.parse(await readFile(path.join(dataDir, f), "utf8"));
  } catch {
    return fallback;
  }
};

const ratings = await load("ratings.json", []);
const watched = await load("watched.json", []);
const enrichment = await load("enrichment.json", {});
const profile = await load("profile.json", {});

const key = (f) => `${f.title} (${f.year})`;
const enrichFor = (f) => enrichment[key(f)];

// union of the log and the import, keyed by title+year
const seen = new Map();
for (const w of watched) seen.set(key(w).toLowerCase(), w);
for (const r of ratings) seen.set(key(r).toLowerCase(), r);

const scored = ratings.filter((r) => typeof r.score === "number");

const tiers = {};
for (const r of scored) tiers[r.score] = (tiers[r.score] ?? 0) + 1;

const decades = {};
for (const f of seen.values()) {
  if (!f.year) continue;
  const d = Math.floor(f.year / 10) * 10;
  decades[d] = (decades[d] ?? 0) + 1;
}

// genre share among 4★+ films vs everything seen (enriched films only)
const genreCount = (films) => {
  const counts = {};
  let covered = 0;
  for (const f of films) {
    const g = enrichFor(f)?.genres;
    if (!g?.length) continue;
    covered++;
    for (const name of g) counts[name] = (counts[name] ?? 0) + 1;
  }
  return { counts, covered };
};
const loved = genreCount(scored.filter((r) => r.score >= 4));
const all = genreCount([...seen.values()]);
const genreTilt = Object.entries(loved.counts)
  .map(([g, n]) => ({
    genre: g,
    lovedShare: n / loved.covered,
    seenShare: (all.counts[g] ?? 0) / all.covered,
  }))
  .map((g) => ({ ...g, tilt: g.lovedShare - g.seenShare }))
  .sort((a, b) => b.tilt - a.tilt);

// where you and the critics part ways (your score is /5, IMDb is /10)
const divergence = scored
  .map((r) => {
    const imdb = enrichFor(r)?.scores?.imdb;
    if (imdb == null) return null;
    return { title: r.title, year: r.year, mine: r.score, imdb, gap: r.score * 2 - imdb };
  })
  .filter(Boolean)
  .sort((a, b) => b.gap - a.gap);

// staleness of the prose analysis: films watched since profile.json was rewritten
const profileUpdated = profile.updated ?? null;
const newSinceProfile = profileUpdated
  ? watched.filter((w) => w.watched && w.watched > profileUpdated).length
  : null;

const stats = {
  generated: new Date().toISOString().slice(0, 10),
  counts: {
    seen: seen.size,
    rated: ratings.length,
    scored: scored.length,
    perfect: scored.filter((r) => r.score === 5).length,
  },
  tiers,
  decades,
  genreTilt: genreTilt.slice(0, 6),
  genreCoverage: { loved: loved.covered, seen: all.covered },
  lovedAgainstCritics: divergence.filter((d) => d.gap > 0).slice(0, 3),
  coldAgainstCritics: divergence.filter((d) => d.gap < 0).slice(-3).reverse(),
  profileUpdated,
  newSinceProfile,
};

await writeFile(path.join(dataDir, "stats.json"), JSON.stringify(stats, null, 2) + "\n");
console.log(
  `stats.json: ${stats.counts.seen} seen, ${stats.counts.scored} scored` +
    (newSinceProfile != null ? `, ${newSinceProfile} watched since the analysis was last rewritten` : "")
);
