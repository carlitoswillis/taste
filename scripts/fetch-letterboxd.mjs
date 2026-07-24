#!/usr/bin/env node
// Pull recent activity from Letterboxd's public RSS feed into data/letterboxd.json.
// Letterboxd has no open API, but every account exposes ~50 recent entries at
// letterboxd.com/<user>/rss/ including star ratings and rewatch flags.
// Run: node scripts/fetch-letterboxd.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));

const url = `https://letterboxd.com/${config.letterboxd}/rss/`;
const res = await fetch(url, { headers: { "user-agent": "taste-profile-site (github.com)" } });
if (!res.ok) {
  console.error(`Letterboxd RSS fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const xml = await res.text();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? m[1].trim() : null;
};

const entries = [];
for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
  const title = tag(item, "letterboxd:filmTitle");
  if (!title) continue; // skip list items etc.
  const rating = tag(item, "letterboxd:memberRating");
  entries.push({
    title,
    year: Number(tag(item, "letterboxd:filmYear")) || null,
    rating: rating != null ? Number(rating) : null,
    rewatch: tag(item, "letterboxd:rewatch") === "Yes",
    watched: tag(item, "letterboxd:watchedDate"),
    link: tag(item, "link"),
  });
}

const out = { user: config.letterboxd, fetched: new Date().toISOString(), entries };
await writeFile(path.join(root, "data/letterboxd.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`Fetched ${entries.length} entries for ${config.letterboxd} -> data/letterboxd.json`);

// Flag rated entries that aren't in data/ratings.json yet, so the profile can be updated.
const ratings = JSON.parse(await readFile(path.join(root, "data/ratings.json"), "utf8"));
const known = new Set(ratings.map((r) => r.title.toLowerCase()));
const news = entries.filter((e) => e.rating != null && !known.has(e.title.toLowerCase()));
if (news.length) {
  console.log("\nNew ratings on Letterboxd not yet in data/ratings.json:");
  for (const e of news) console.log(`  ${e.title} (${e.year}) — ${e.rating}`);
}

// Reconcile: merge new RSS activity into the canonical files. Matching key is
// lowercased "title (year)"; existing entries are never deleted or reordered,
// new films are appended at the end. Idempotent across runs.
const key = (f) => `${f.title.toLowerCase()} (${f.year})`;
const titleKey = (f) => f.title.toLowerCase();

// Ratings: append unknown rated films (director unknown from RSS; enrich fills
// credits downstream). A changed score is updated in place — notes and any
// other hand-written fields are never touched. Hand-entered years drift a year
// off Letterboxd's for some films, so a near-miss (same title, ±1 year) counts
// as the same film rather than a duplicate; remakes stay distinct.
const byKey = new Map(ratings.map((r) => [key(r), r]));
const byTitle = new Map(ratings.map((r) => [titleKey(r), r]));
let ratingsChanged = false;
for (const e of entries) {
  if (e.rating == null) continue;
  const near = byTitle.get(titleKey(e));
  const existing = byKey.get(key(e)) ?? (near && Math.abs(near.year - e.year) <= 1 ? near : null);
  if (!existing) {
    const added = { title: e.title, year: e.year, director: null, score: e.rating };
    ratings.push(added);
    byKey.set(key(e), added);
    byTitle.set(titleKey(e), added);
    ratingsChanged = true;
    console.log(`  merged rating: ${e.title} (${e.year}) — ${e.rating}`);
  } else if (existing.score !== e.rating) {
    console.log(`  updated score: ${e.title} (${e.year}) — ${existing.score} -> ${e.rating}`);
    existing.score = e.rating;
    ratingsChanged = true;
  }
}
if (ratingsChanged) {
  await writeFile(path.join(root, "data/ratings.json"), JSON.stringify(ratings, null, 2) + "\n");
  console.log("Merged new ratings -> data/ratings.json");
}

// Watched: append unseen films so the seen-set stays complete. Years here come
// from Letterboxd (importer CSV) just like the RSS, so the exact key is safe —
// and it keeps remakes (two years, one title) distinct.
const watched = JSON.parse(await readFile(path.join(root, "data/watched.json"), "utf8"));
const seen = new Set(watched.map((w) => key(w)));
let watchedAdded = 0;
for (const e of entries) {
  if (seen.has(key(e))) continue;
  watched.push({ title: e.title, year: e.year, watched: e.watched });
  seen.add(key(e));
  watchedAdded++;
  console.log(`  merged watch: ${e.title} (${e.year}) — ${e.watched}`);
}
if (watchedAdded) {
  await writeFile(path.join(root, "data/watched.json"), JSON.stringify(watched, null, 2) + "\n");
  console.log(`Merged ${watchedAdded} new watches -> data/watched.json`);
}
