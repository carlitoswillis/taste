#!/usr/bin/env node
// Import your Goodreads library from their export into data/books.json.
// Get the export: goodreads.com -> My Books -> Import and export -> Export Library.
// Then run:  node scripts/import-goodreads.mjs ~/Downloads/goodreads_library_export.csv
//
// Column mapping: Exclusive Shelf -> status (read/currently-reading/to-read),
// My Rating 0 -> null (Goodreads can't express "unrated" any other way),
// ISBN13 arrives as ="9780307387134" (stripped), series parentheticals are
// dropped from titles ("The Fellowship of the Ring (The Lord of the Rings, #1)").
// Identity is lowercased title+author; existing entries are never touched.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./lib/csv.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const input = process.argv[2];
if (!input || !existsSync(input)) {
  console.error("Usage: node scripts/import-goodreads.mjs <goodreads_library_export.csv>");
  process.exit(1);
}

const STATUS = { read: "read", "currently-reading": "reading", "to-read": "toread" };
const cleanTitle = (t) => t.replace(/\s*\([^)]*#\s*[\d.]+[^)]*\)\s*$/, "").trim();
const cleanIsbn = (s) => s.replace(/^="?|"?$/g, "").trim() || null;

const rows = parseCsv(await readFile(input, "utf8"));
const outPath = path.join(root, "data/books.json");
const books = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : [];
const known = new Set(books.map((b) => `${b.title.toLowerCase()}|${b.author.toLowerCase()}`));

let added = 0, skipped = 0;
for (const r of rows) {
  const status = STATUS[r["Exclusive Shelf"]];
  if (!r.Title || !r.Author || !status) continue;
  const title = cleanTitle(r.Title);
  const id = `${title.toLowerCase()}|${r.Author.toLowerCase()}`;
  if (known.has(id)) { skipped++; continue; }
  const year = Number(r["Original Publication Year"] || r["Year Published"]) || null;
  const score = Number(r["My Rating"]) || null; // 0 means unrated on Goodreads
  const book = { title, author: r.Author, year, status, score, read: r["Date Read"] || null };
  if (r["My Review"]) book.note = r["My Review"];
  const isbn13 = cleanIsbn(r.ISBN13 ?? "");
  if (isbn13) book.isbn13 = isbn13;
  books.push(book);
  known.add(id);
  added++;
  console.log(`  new book: ${title} (${r.Author}) — ${status}${score ? ` ${score}★` : ""}`);
}

if (added) await writeFile(outPath, JSON.stringify(books, null, 2) + "\n");
console.log(`${added} books imported, ${skipped} already present (existing entries untouched)`);
console.log("\nNext: npm run enrich:books   (Open Library metadata for the new books)");
console.log("Then: npm run suggest:books");
