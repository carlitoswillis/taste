#!/usr/bin/env node
// Import your full Letterboxd history from their export.
// Get the export: letterboxd.com -> Settings -> Import & Export -> Export your data.
// Then run:  node scripts/import-letterboxd.mjs ~/Downloads/letterboxd-username-....zip
// (also accepts an unzipped folder, or a single watched.csv / ratings.csv)
//
// - watched.csv  -> data/watched.json  (title, year, watched date)
// - ratings.csv  -> merged into data/ratings.json for films not already there
//   (your hand-written entries and notes are never touched)

import { readFile, writeFile, mkdtemp, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./lib/csv.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const input = process.argv[2];
if (!input || !existsSync(input)) {
  console.error("Usage: node scripts/import-letterboxd.mjs <letterboxd-export.zip | folder | csv>");
  process.exit(1);
}

// Locate the CSVs whatever form the input takes.
let dir = input;
if (statSync(input).isFile() && input.endsWith(".zip")) {
  dir = await mkdtemp(path.join(os.tmpdir(), "letterboxd-"));
  execFileSync("unzip", ["-o", "-q", input, "-d", dir]);
}
const findCsv = async (name) => {
  if (statSync(dir).isFile()) return path.basename(dir) === name ? dir : null;
  for (const f of await readdir(dir, { recursive: true })) {
    if (path.basename(f) === name) return path.join(dir, f);
  }
  return null;
};

const watchedCsv = await findCsv("watched.csv");
const ratingsCsv = await findCsv("ratings.csv");
if (!watchedCsv && !ratingsCsv) {
  console.error("No watched.csv or ratings.csv found in the export.");
  process.exit(1);
}

// --- watched.csv -> data/watched.json ---------------------------------------
if (watchedCsv) {
  const rows = parseCsv(await readFile(watchedCsv, "utf8"));
  const watched = rows
    .filter((r) => r.Name && r.Year)
    .map((r) => ({ title: r.Name, year: Number(r.Year), watched: r.Date || null, uri: r["Letterboxd URI"] || null }));
  await writeFile(path.join(root, "data/watched.json"), JSON.stringify(watched, null, 2) + "\n");
  console.log(`${watched.length} films -> data/watched.json`);
}

// --- ratings.csv -> merge new ones into data/ratings.json -------------------
if (ratingsCsv) {
  const rows = parseCsv(await readFile(ratingsCsv, "utf8"));
  const ratings = JSON.parse(await readFile(path.join(root, "data/ratings.json"), "utf8"));
  const known = new Set(ratings.map((r) => r.title.toLowerCase()));
  let added = 0;
  for (const r of rows) {
    if (!r.Name || !r.Rating || known.has(r.Name.toLowerCase())) continue;
    ratings.push({ title: r.Name, year: Number(r.Year), director: null, score: Number(r.Rating) });
    known.add(r.Name.toLowerCase());
    added++;
    console.log(`  new rating: ${r.Name} (${r.Year}) — ${r.Rating}`);
  }
  if (added) await writeFile(path.join(root, "data/ratings.json"), JSON.stringify(ratings, null, 2) + "\n");
  console.log(`${added} new ratings merged (existing entries untouched)`);
}

console.log("\nNext: npm run enrich   (metadata for the new films)");
console.log("Then: npm run suggest  (suggestions will stop offering films you've seen)");
