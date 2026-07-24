#!/usr/bin/env node
// Enrich books with Open Library metadata — work id, authors, subjects, cover,
// description, edition count, OL ratings. Covers everything in data/books.json
// plus the unread books behind confirmed adaptation edges (so the bridge can
// show covers and the suggester can rank them). Retries entries marked
// unmatched on every run. Writes data/book-enrichment.json keyed "Title (Author)".
// No key needed — just the Open Library etiquette: a real User-Agent and
// 500–1100 ms between requests. Run: npm run enrich:books

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = async (name, fallback) => {
  try {
    return JSON.parse(await readFile(path.join(root, `data/${name}.json`), "utf8"));
  } catch {
    return fallback;
  }
};

const books = await read("books", []);
const adaptations = await read("adaptations", { edges: [] });

const USER_AGENT = "taste/0.1 (adamnodded@gmail.com)";
const pause = () => new Promise((r) => setTimeout(r, 500 + Math.random() * 600));
const FIELDS = "key,title,author_key,author_name,first_publish_year,cover_i,edition_count,number_of_pages_median,subject,ratings_average,ratings_count";

async function ol(pathname, params = {}) {
  const url = new URL(`https://openlibrary.org${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Open Library ${pathname}: ${res.status}`);
  return res.json();
}

// --- what needs enriching: the log, plus unread confirmed adaptation books --
const targets = new Map(); // "Title (Author)" -> {title, author, olWork?}
for (const b of books) {
  targets.set(`${b.title} (${b.author})`, { title: b.title, author: b.author });
}
for (const e of adaptations.edges ?? []) {
  if (e.status !== "confirmed" || e.read) continue;
  const k = `${e.book.title} (${e.book.author})`;
  if (!targets.has(k)) targets.set(k, { title: e.book.title, author: e.book.author, olWork: e.book.olWork });
}

const outPath = path.join(root, "data/book-enrichment.json");
const out = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : {};

let hits = 0, misses = 0;
for (const [k, t] of targets) {
  // skip what's done — unless it's unmatched, or Wikidata knows a different work id
  if (out[k] && !out[k].unmatched && !(t.olWork && out[k].olWork !== t.olWork)) continue;

  // one parse path for every candidate list: the search endpoint
  const found = await ol("/search.json", {
    title: t.title,
    author: t.author.split(",")[0].trim(),
    limit: 5,
    fields: FIELDS,
  });
  await pause();
  // ambiguity rule: a known OL work id wins, else highest edition count
  const docs = found.docs ?? [];
  let doc =
    docs.find((d) => t.olWork && d.key === `/works/${t.olWork}`) ??
    docs.sort((a, b) => (b.edition_count ?? 0) - (a.edition_count ?? 0))[0];
  if (t.olWork && doc?.key !== `/works/${t.olWork}`) {
    // Wikidata's P648 outranks the title search — fetch that work directly
    const byKey = await ol("/search.json", { q: `key:"/works/${t.olWork}"`, limit: 1, fields: FIELDS });
    await pause();
    doc = byKey.docs?.[0] ?? doc;
  }
  if (!doc) {
    out[k] = { unmatched: true };
    misses++;
    console.warn(`  no OL match: ${k}`);
    continue;
  }

  const olWork = doc.key.replace("/works/", "");
  const work = await ol(`/works/${olWork}.json`).catch(() => ({}));
  await pause();
  const desc = typeof work.description === "string" ? work.description : work.description?.value ?? null;
  const subjects = doc.subject ?? work.subjects ?? [];
  out[k] = {
    id: `b:${olWork}`,
    olWork,
    authors: (doc.author_key ?? []).map((key, i) => ({ key, name: doc.author_name?.[i] ?? null })),
    firstPublished: doc.first_publish_year ?? null,
    pages: doc.number_of_pages_median ?? null,
    subjects: subjects.slice(0, 12),
    coverId: doc.cover_i ?? null,
    cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    description: desc ? desc.slice(0, 600) : null,
    editionCount: doc.edition_count ?? 0,
    olRating: { average: doc.ratings_average ?? null, count: doc.ratings_count ?? 0 },
    adaptedAs: [],
  };
  hits++;
  console.log(`  enriched: ${k} — ${olWork}, ${out[k].editionCount} editions`);
}

// back-fill adaptedAs from confirmed edges, by OL work id or display key
// (Wikidata doesn't always carry P648, so the key is the fallback join)
for (const [k, entry] of Object.entries(out)) {
  if (entry.unmatched) continue;
  entry.adaptedAs = (adaptations.edges ?? [])
    .filter((e) => e.status === "confirmed" && (e.book.olWork === entry.olWork || `${e.book.title} (${e.book.author})` === k))
    .map((e) => e.screen);
}

await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`\n${hits} new, ${misses} unmatched, ${Object.keys(out).length} total -> data/book-enrichment.json`);
