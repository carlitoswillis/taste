#!/usr/bin/env node
// Find the books behind your films. Wikidata-primary: one bulk SPARQL query
// maps every enriched IMDb id through P144 ("based on") to works with a P50
// author (the author requirement filters remake/sequel noise) — those edges
// are confirmed. Unresolved 4★+ films get an OMDb Writer-field parse (novel/
// story credits) as candidates; films flagged "based on novel or book" (TMDB
// keyword 818) but still unresolved land in flaggedOnly for manual review.
// A second SPARQL walk finds adjacent authors: writers your top-affinity
// directors adapted in films you haven't logged. Writes data/adaptations.json.
// Needs enrichment (run enrich-tmdb.mjs first). Run: npm run bridge

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EMPTY, edgeKey, writeMachineResult } from "./lib/adaptation-review.mjs";
import { readJsonStrict, writeJsonAtomic } from "./lib/atomic-json.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  for (const line of (await readFile(path.join(root, ".env"), "utf8")).split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
} catch {}

const read = async (name, fallback) => {
  try {
    return JSON.parse(await readFile(path.join(root, `data/${name}.json`), "utf8"));
  } catch {
    return fallback;
  }
};

const ratings = await read("ratings", []);
const enrichment = await read("enrichment", {});
const books = await read("books", []);
// Start-of-run snapshot, used only to skip work for rejected keys. The file is re-read and merged at write time
// (lib/adaptation-review.mjs), so reviews made in the app during the network passes are never lost. A corrupt
// file throws here instead of being treated as empty.
const adaptationsFile = path.join(root, "data/adaptations.json");
const existing = readJsonStrict(adaptationsFile, EMPTY());

const USER_AGENT = "taste/0.1 (https://github.com/carlitoswillis/taste)";
const qid = (uri) => uri?.split("/").pop() ?? null;
const round = (n) => Math.round(n * 100) / 100;

// One bulk query, proper User-Agent — query.wikidata.org norms.
async function sparql(query) {
  const res = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/sparql-results+json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `query=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL: ${res.status}`);
  return (await res.json()).results.bindings;
}

// --- what we're bridging from ------------------------------------------------
const byImdb = new Map(); // imdbId -> display key
for (const [k, e] of Object.entries(enrichment)) if (e.imdbId) byImdb.set(e.imdbId, k);
const scoreOf = new Map(ratings.filter((r) => r.score != null).map((r) => [`${r.title} (${r.year})`, r.score]));
const readSet = new Set(books.filter((b) => b.status === "read").map((b) => `${b.title.toLowerCase()}|${b.author.toLowerCase()}`));
const rejectedKeys = new Set((existing.rejected ?? []).map((e) => `${e.screen}::${e.book?.wikidata ?? e.book?.title}`));

// --- pass 1: bulk Wikidata — imdbId -> P144 work -> P50 author --------------
const values = [...byImdb.keys()].map((id) => `"${id}"`).join(" ");
const rows = await sparql(`
SELECT ?imdb ?work ?workLabel ?workOL ?author ?authorLabel WHERE {
  VALUES ?imdb { ${values} }
  ?film wdt:P345 ?imdb .
  ?film wdt:P144 ?work .
  ?work wdt:P50 ?author .
  OPTIONAL { ?work wdt:P648 ?workOL . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`);

const confirmed = new Map(); // screen::workQid -> edge
for (const r of rows) {
  const screen = byImdb.get(r.imdb.value);
  if (!screen) continue;
  const key = `${screen}::${qid(r.work.value)}`;
  if (rejectedKeys.has(key)) continue; // rejected edges stay rejected across re-runs
  const edge = confirmed.get(key) ?? {
    book: { title: r.workLabel.value, author: null, olWork: r.workOL?.value ?? null, wikidata: qid(r.work.value) },
    screen,
    screenId: enrichment[screen].id ?? `m:${enrichment[screen].tmdbId}`,
    status: "confirmed",
    source: "wikidata",
    authors: [],
    read: false,
  };
  if (!edge.authors.includes(r.authorLabel.value)) edge.authors.push(r.authorLabel.value);
  confirmed.set(key, edge);
}
const edges = [...confirmed.values()].map((e) => {
  e.book.author = e.authors.join(", ");
  delete e.authors;
  return e;
});
console.log(`${edges.length} confirmed edges via Wikidata (${byImdb.size} imdb ids queried)`);

const resolved = new Set(edges.map((e) => e.screen));

// --- pass 2: OMDb Writer-field parse for unresolved 4★+ films ---------------
const omdbKey = process.env.OMDB_API_KEY;
if (omdbKey) {
  const BOOKISH = /\b(novel|novella|book|story|stories|memoir|comic)\b/i;
  for (const [screen, score] of scoreOf) {
    if (score < 4 || resolved.has(screen) || !enrichment[screen]?.imdbId) continue;
    const data = await fetch(`https://www.omdbapi.com/?i=${enrichment[screen].imdbId}&apikey=${omdbKey}`)
      .then((r) => r.json())
      .catch(() => null);
    await new Promise((r) => setTimeout(r, 120));
    for (const credit of (data?.Writer ?? "").split(", ")) {
      const m = credit.match(/^(.+?)\s*\(([^)]*)\)$/);
      if (!m || !BOOKISH.test(m[2])) continue;
      const title = m[2].match(/"([^"]+)"/)?.[1] ?? screen.replace(/ \(\d{4}\)$/, "");
      const edge = {
        book: { title, author: m[1], olWork: null, wikidata: null },
        screen,
        screenId: enrichment[screen].id ?? `m:${enrichment[screen].tmdbId}`,
        status: "candidate",
        confidence: 0.5,
        source: "omdb",
        evidence: `Writer: "${credit}"`,
        read: false,
      };
      if (rejectedKeys.has(edgeKey(edge)) || edges.some((e) => edgeKey(e) === edgeKey(edge))) continue;
      edges.push(edge);
      resolved.add(screen);
      console.log(`  candidate (OMDb): ${screen} <- ${title}, ${m[1]}`);
    }
  }
} else {
  console.log("(no OMDB_API_KEY — skipping the Writer-parse pass)");
}

// --- pass 3: TMDB keyword 818 present but nothing resolved -> flaggedOnly ---
const flaggedOnly = [];
for (const [k, e] of Object.entries(enrichment)) {
  if (resolved.has(k) || !e.keywords?.some((kw) => kw.id === 818)) continue;
  flaggedOnly.push({ screen: k, screenId: e.id ?? `m:${e.tmdbId}` });
}

// --- pass 4: adjacent authors via your top-affinity directors ---------------
// director affinity as in suggest.mjs: (score - 3) × 1.6 per 4★+ film
const directors = new Map(); // tmdb person id -> {name, weight}
for (const film of ratings) {
  if (film.score == null || film.score < 4) continue;
  for (const d of enrichment[`${film.title} (${film.year})`]?.director ?? []) {
    const entry = directors.get(d.id) ?? { name: d.name, weight: 0 };
    entry.weight += (film.score - 3) * 1.6;
    directors.set(d.id, entry);
  }
}
const topDirectors = [...directors.entries()].sort((a, b) => b[1].weight - a[1].weight).slice(0, 10);

const adjacentAuthors = [];
if (topDirectors.length) {
  const dirValues = topDirectors.map(([id]) => `"${id}"`).join(" ");
  const adjRows = await sparql(`
SELECT ?tmdb ?filmLabel ?author ?authorLabel ?authorOL WHERE {
  VALUES ?tmdb { ${dirValues} }
  ?director wdt:P4985 ?tmdb .
  ?film wdt:P57 ?director .
  ?film wdt:P144 ?work .
  ?work wdt:P50 ?author .
  OPTIONAL { ?author wdt:P648 ?authorOL . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`);
  const byAuthor = new Map(); // author qid -> entry
  for (const r of adjRows) {
    const dir = directors.get(Number(r.tmdb.value));
    if (!dir) continue;
    const a = byAuthor.get(qid(r.author.value)) ?? {
      name: r.authorLabel.value,
      wikidata: qid(r.author.value),
      olKey: r.authorOL?.value ?? null,
      adaptedBy: [],
      weight: 0,
    };
    let by = a.adaptedBy.find((x) => x.director === dir.name);
    if (!by) {
      by = { director: dir.name, films: [] };
      a.adaptedBy.push(by);
      a.weight = round(a.weight + dir.weight * 0.4);
    }
    if (!by.films.includes(r.filmLabel.value)) by.films.push(r.filmLabel.value);
    byAuthor.set(qid(r.author.value), a);
  }
  adjacentAuthors.push(...[...byAuthor.values()].sort((a, b) => b.weight - a.weight));
}
console.log(`${adjacentAuthors.length} adjacent authors via ${topDirectors.length} top directors`);

// --- merge into the file as it is NOW, write atomically ----------------------
// Reviews (confirmed / rejected) in the current file always beat this run's machine output.
const merged = writeMachineResult(
  adaptationsFile,
  { edges, flaggedOnly, adjacentAuthors },
  (list) => {
    for (const e of list) e.read = readSet.has(`${e.book.title.toLowerCase()}|${(e.book.author ?? "").toLowerCase()}`);
    return list.sort((a, b) => (scoreOf.get(b.screen) ?? 0) - (scoreOf.get(a.screen) ?? 0));
  },
);

// back-fill adaptedAs on already-enriched books (tolerate the file not existing)
const bookEnrichment = await read("book-enrichment", null);
if (bookEnrichment) {
  for (const [k, entry] of Object.entries(bookEnrichment)) {
    if (entry.unmatched) continue;
    entry.adaptedAs = merged.edges
      .filter((e) => e.status === "confirmed" && (e.book.olWork === entry.olWork || `${e.book.title} (${e.book.author})` === k))
      .map((e) => e.screen);
  }
  writeJsonAtomic(path.join(root, "data/book-enrichment.json"), bookEnrichment);
}

const nConfirmed = merged.edges.filter((e) => e.status === "confirmed").length;
const nCandidate = merged.edges.filter((e) => e.status === "candidate").length;
console.log(`\n${nConfirmed} confirmed, ${nCandidate} candidate, ${flaggedOnly.length} flagged-only -> data/adaptations.json`);
