#!/usr/bin/env node
// Pull recent activity from Letterboxd's public RSS feed into data/letterboxd.json.
// Letterboxd has no open API, but every account exposes ~50 recent entries at
// letterboxd.com/<user>/rss/ including star ratings and rewatch flags.
// Run: node scripts/fetch-letterboxd.mjs
//
// Dating: the /films/ grid lists the newest marks first and carries no dates.
// A film in the grid that is not yet in data/watched.json is recorded with
// watched = the sync date (America/Los_Angeles) and dateSource "first-seen";
// the daily sync sees a new mark within a day. Existing dates are never changed
// and films that fall off page 1 are never removed. So dated history no longer
// needs exports (an export via scripts/import-letterboxd.mjs still replaces
// first-seen dates with real ones). Exact dates come from logging a film via
// Letterboxd's "Log" (diary), not the eye icon.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRss, parseFilmsGrid, lastFilmsPage, isChallenge, chooseEntries, mergeEntries, addFirstSeen, laDate } from "./lib/letterboxd.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));

const url = `https://letterboxd.com/${config.letterboxd}/rss/`;
const outPath = path.join(root, "data/letterboxd.json");
// Same honest, identifying agent the watchlist fetch uses. If Cloudflare
// answers a challenge we report it and stop; we do not try to get around it.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 taste-profile-site";
const get = (u, accept) => fetch(u, { headers: { "user-agent": UA, accept } });

let prev = { entries: [] };
try { prev = JSON.parse(await readFile(outPath, "utf8")); } catch {}
prev.entries ??= [];

let entries = [];
let source = "rss";
const res = await get(url, "application/rss+xml,application/xml,text/xml");
const xml = res.ok ? await res.text() : "";
if (!res.ok) console.error(`Letterboxd RSS fetch failed: ${res.status} ${res.statusText}`);
else entries = parseRss(xml);

if (res.ok && !entries.length) {
  // The 2026-07 failure: a valid feed with zero items (status 200, ~500 bytes).
  console.error(`\nRSS ${url} parsed 0 film entries (${xml.length} bytes, <item> blocks: ${[...xml.matchAll(/<item>/g)].length}).`);
  console.error(`  starts: ${xml.slice(0, 200).replace(/\s+/g, " ")}`);
  console.error("  -> valid feed with no items: the diary is not being exposed over RSS. Falling back to the public /films/ pages.");
}

if (!entries.length) {
  source = "films-pages";
  const base = `https://letterboxd.com/${config.letterboxd}/films/`;
  let last = 1;
  for (let n = 1; n <= Math.min(last, 60); n++) {
    if (n > 1) await new Promise((r) => setTimeout(r, 800));
    const r = await get(n === 1 ? base : `${base}page/${n}/`, "text/html");
    const html = await r.text();
    if (!r.ok || isChallenge(r.status, html)) {
      console.error(`  /films/ page ${n}: ${r.status} ${isChallenge(r.status, html) ? "(Cloudflare challenge — stopping; not bypassing)" : ""}`);
      break;
    }
    if (n === 1) last = lastFilmsPage(html);
    const page = parseFilmsGrid(html);
    if (!page.length) { console.error(`  /films/ page ${n}: no films parsed (markup change?)`); break; }
    entries.push(...page);
  }
  console.log(`Fallback read ${entries.length} undated watched marks from /films/ (of ${last} page(s))`);
}

const { entries: chosen, kept } = chooseEntries(prev.entries, entries);
if (kept) {
  console.error(`\nFETCH RETURNED 0 ENTRIES — keeping the ${prev.entries.length} entries already in data/letterboxd.json untouched.`);
  process.exit(1);
}
if (!chosen.length) {
  console.error("\nNo Letterboxd entries from RSS or /films/ pages, and no previous data.");
  process.exit(1);
}
const stored = mergeEntries(prev.entries, entries);

const out = { user: config.letterboxd, fetched: new Date().toISOString(), source, entries: stored };
await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`Fetched ${entries.length} entries (${source}), ${stored.length} stored -> data/letterboxd.json`);

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
    const added = { title: e.title, year: e.year, director: null, score: e.rating, ...(e.liked ? { liked: true } : {}) };
    ratings.push(added);
    byKey.set(key(e), added);
    byTitle.set(titleKey(e), added);
    ratingsChanged = true;
    console.log(`  merged rating: ${e.title} (${e.year}) — ${e.rating}`);
  } else if (e.liked && !existing.liked) {
    existing.liked = true;
    ratingsChanged = true;
    if (existing.score === e.rating) continue;
    console.log(`  updated score: ${e.title} (${e.year}) — ${existing.score} -> ${e.rating}`);
    existing.score = e.rating;
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
const { watched: watchedNext, added } = addFirstSeen(watched, entries, laDate());
const watchedAdded = added.length;
for (const w of added) console.log(`  merged watch: ${w.title} (${w.year}) — ${w.watched}${w.dateSource ? " (first-seen)" : ""}`);
if (watchedAdded) {
  await writeFile(path.join(root, "data/watched.json"), JSON.stringify(watchedNext, null, 2) + "\n");
  console.log(`Merged ${watchedAdded} new watches -> data/watched.json`);
}
