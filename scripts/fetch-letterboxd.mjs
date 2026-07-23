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
