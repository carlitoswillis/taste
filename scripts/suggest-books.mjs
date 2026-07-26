#!/usr/bin/env node
// Generate data/book-suggestions.json: books you haven't read, found through
// your films — the unread novels behind films you loved, more from the authors
// your taste keeps meeting (adaptation authors, authors your favourite
// directors adapt), plus theme subjects and a film-genre -> OL-subject map.
// Works with zero rated books; rated books sharpen the author signal when they
// exist. Needs adaptations.json (npm run bridge) and book-enrichment.json
// (npm run enrich:books); degrades to whatever signals have data.
// Run: npm run suggest:books

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));

// --- sizing knobs (mirrors suggest.mjs) -------------------------------------
// --flag > config.json "suggest.book" > the defaults here
const num = (name, configured, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  // an empty or junk `--flag=` falls through to config, not past it to dflt
  for (const v of [hit?.split("=")[1], configured]) {
    const n = Number(v);
    if (v != null && v !== "" && Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return dflt;
};
const tuning = config.suggest?.book ?? {};
const POOL = num("pool", tuning.pool, 40);
const HEAD = Math.min(num("head", tuning.head, 12), POOL);
const AUTHORS = num("authors", tuning.authors, 12);
const HEAD_CAP = 2; // per author, inside the headline
const POOL_CAP = 4; // per author, across the whole pool

const read = async (name, fallback) => {
  try {
    return JSON.parse(await readFile(path.join(root, `data/${name}.json`), "utf8"));
  } catch {
    return fallback;
  }
};

const books = await read("books", []);
const bookEnrichment = await read("book-enrichment", {});
const adaptations = await read("adaptations", { edges: [], adjacentAuthors: [] });
const ratings = await read("ratings", []);
const enrichment = await read("enrichment", {});
const themesData = await read("themes", null);
const themeMap = await read("theme-map", null);

const USER_AGENT = "taste/0.1 (adamnodded@gmail.com)";
const pause = () => new Promise((r) => setTimeout(r, 500 + Math.random() * 600));
const FIELDS = "key,title,author_key,author_name,first_publish_year,cover_i,edition_count,number_of_pages_median,subject,ratings_average,ratings_count";

async function ol(params = {}) {
  const url = new URL("https://openlibrary.org/search.json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Open Library search: ${res.status}`);
  return res.json();
}

const round = (n) => Math.round(n * 100) / 100;
const scoreOf = new Map(ratings.filter((r) => r.score != null).map((r) => [`${r.title} (${r.year})`, r.score]));

// everything logged, whatever the shelf, is off the table
const seen = new Set(books.map((b) => `${b.title.toLowerCase()}|${b.author.toLowerCase()}`));
const seenTitle = new Set(books.map((b) => b.title.toLowerCase()));

// --- candidates, merged across signals by OL work id ------------------------
const candidates = new Map(); // olWork -> {doc fields..., weight, whys:[], gated}
const titleTaken = new Set(); // "normalized title|author key" — OL keeps duplicate works per translation
const addCandidate = (doc, weight, why, { gated = true, author: authorName } = {}) => {
  const olWork = doc.key.replace("/works/", "");
  let c = candidates.get(olWork);
  if (!c) {
    const author = authorName ?? doc.author_name?.[0] ?? "unknown";
    const authorKey = doc.author_key?.[0] ?? null;
    if (!/[A-Za-z]/.test(doc.title)) return; // OL duplicates under untransliterated titles
    if (seen.has(`${doc.title.toLowerCase()}|${author.toLowerCase()}`) || seenTitle.has(doc.title.toLowerCase())) return;
    const dedupe = `${doc.title.toLowerCase().replace(/^the /, "")}|${authorKey}`;
    if (titleTaken.has(dedupe)) return;
    titleTaken.add(dedupe);
    c = {
      title: doc.title,
      author,
      authorKey,
      olWork,
      year: doc.first_publish_year ?? null,
      pages: doc.number_of_pages_median ?? null,
      cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
      editionCount: doc.edition_count ?? 0,
      olRating: { average: doc.ratings_average ?? null, count: doc.ratings_count ?? 0 },
      weight: 0,
      whys: [],
      gated: true,
    };
    candidates.set(olWork, c);
  }
  c.weight += weight;
  if (why && !c.whys.includes(why)) c.whys.push(why);
  if (!gated) c.gated = false; // confirmed adaptations bypass the popularity gates
};

// --- signal 1: unread confirmed adaptations of 4★+ films --------------------
// (filmScore - 3) × 1.4 — the book-author role weight — no popularity gate
const confirmedEdges = (adaptations.edges ?? []).filter((e) => e.status === "confirmed");
let adaptationPicks = 0;
for (const e of confirmedEdges) {
  if (e.read) continue;
  const score = scoreOf.get(e.screen);
  if (score == null || score < 4) continue;
  const enriched = bookEnrichment[`${e.book.title} (${e.book.author})`];
  const doc = enriched && !enriched.unmatched
    ? {
        key: `/works/${enriched.olWork}`,
        title: e.book.title,
        author_name: [e.book.author],
        author_key: enriched.authors?.map((a) => a.key) ?? [],
        first_publish_year: enriched.firstPublished,
        cover_i: enriched.coverId,
        edition_count: enriched.editionCount,
        number_of_pages_median: enriched.pages,
        ratings_average: enriched.olRating?.average,
        ratings_count: enriched.olRating?.count,
      }
    : { key: `/works/${e.book.olWork ?? `x:${e.screen}`}`, title: e.book.title, author_name: [e.book.author] };
  addCandidate(doc, (score - 3) * 1.4, `the book behind ${e.screen} ${score}★`, { gated: false });
  adaptationPicks++;
}

// --- signal 2: author affinity ----------------------------------------------
// rated-book authors ×1.4 · adaptation authors ×0.8 · adjacent authors ×0.4
const authors = new Map(); // ol author key -> {name, weight, why}
const creditAuthor = (key, name, weight, why) => {
  if (!key) return;
  const a = authors.get(key) ?? { name, weight: 0, whys: [] };
  a.weight += weight;
  if (!a.whys.includes(why)) a.whys.push(why);
  authors.set(key, a);
};
for (const b of books) {
  if (b.status !== "read" || b.score == null || b.score < 4) continue;
  const e = bookEnrichment[`${b.title} (${b.author})`];
  for (const a of e?.authors ?? []) creditAuthor(a.key, a.name, (b.score - 3) * 1.4, `wrote ${b.title} ${b.score}★`);
}
for (const e of confirmedEdges) {
  const score = scoreOf.get(e.screen);
  if (score == null || score < 4) continue;
  const enriched = bookEnrichment[`${e.book.title} (${e.book.author})`];
  for (const a of enriched?.authors ?? []) {
    // the edge carries Wikidata's English name; OL sometimes has the untransliterated one
    const name = enriched.authors.length === 1 ? e.book.author : a.name;
    creditAuthor(a.key, name, (score - 3) * 0.8, `wrote the book behind ${e.screen} ${score}★`);
  }
}
for (const a of adaptations.adjacentAuthors ?? []) {
  // bridge already applied the ×0.4; the why names the adapting director
  const by = a.adaptedBy?.[0];
  creditAuthor(a.olKey, a.name, a.weight, by ? `${by.director} adapted him (${by.films[0]})` : "adapted by a favourite");
}

const topAuthors = [...authors.entries()].sort((a, b) => b[1].weight - a[1].weight).slice(0, AUTHORS);
console.log("Top authors:");
for (const [, a] of topAuthors) console.log(`  ${a.name} — ${a.weight.toFixed(1)} (${a.whys[0]})`);

for (const [key, a] of topAuthors) {
  const found = await ol({ author_key: key, sort: "rating", limit: 30, fields: FIELDS }).catch(() => null);
  await pause();
  for (const doc of (found?.docs ?? []).slice(0, 12)) {
    if (!doc.title || !doc.key) continue;
    if (doc.author_key?.[0] !== key) continue; // shelves include retellings by others
    const why = a.whys[0].includes(a.name) ? a.whys[0] : `${a.name} — ${a.whys[0]}`;
    addCandidate(doc, a.weight, why, { author: a.name });
  }
}

// --- signal 3: theme subjects (theme-map themes gain "subjects" over time) --
const themeNorm = new Map((themesData?.themes ?? []).map((t) => [t.id, t.affinityNorm]));
for (const t of themeMap?.themes ?? []) {
  if (!t.subjects?.length || !(themeNorm.get(t.id) > 0)) continue;
  for (const subject of t.subjects.slice(0, 2)) {
    const found = await ol({ subject, sort: "rating", limit: 30, fields: FIELDS }).catch(() => null);
    await pause();
    for (const doc of (found?.docs ?? []).slice(0, 10)) {
      if (!doc.title || !doc.key) continue;
      addCandidate(doc, themeNorm.get(t.id), `${t.name.toLowerCase()} — a theme of yours`);
    }
  }
}

// --- signal 4: film genres -> OL subjects, weighted by genre affinity ×0.7 --
const genreAffinity = new Map();
for (const film of ratings) {
  if (film.score == null || film.score < 4) continue;
  for (const g of enrichment[`${film.title} (${film.year})`]?.genres ?? []) {
    genreAffinity.set(g, (genreAffinity.get(g) ?? 0) + (film.score - 3));
  }
}
const maxGenre = Math.max(...genreAffinity.values(), 0);
const genreMap = themeMap?.genreMap ?? {};
const topGenres = [...genreAffinity.entries()]
  .filter(([g]) => genreMap[g]?.length)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 4);
for (const [genre, affinity] of topGenres) {
  const norm = maxGenre ? affinity / maxGenre : 0;
  for (const subject of genreMap[genre].slice(0, 1)) {
    const found = await ol({ subject, sort: "rating", limit: 30, fields: FIELDS }).catch(() => null);
    await pause();
    for (const doc of (found?.docs ?? []).slice(0, 10)) {
      if (!doc.title || !doc.key) continue;
      addCandidate(doc, round(norm * 0.7), `${genre.toLowerCase()} on the page — you over-index on it in film`);
    }
  }
}

// --- gate, rank, cap --------------------------------------------------------
// gates: ratings_count ≥ 15 or edition_count ≥ 8 (confirmed adaptations exempt)
// rankScore = weightSum×2 + (ratings_average ?? min(4, 1 + log2(editions)/2))
const sorted = [...candidates.values()]
  .filter((c) => !c.gated || c.olRating.count >= 15 || c.editionCount >= 8)
  .map((c) => ({
    ...c,
    rankScore: c.weight * 2 + (c.olRating.average ?? Math.min(4, 1 + Math.log2(c.editionCount || 1) / 2)),
  }))
  .sort((a, b) => b.rankScore - a.rankScore);

// two passes: tight per-author cap for the headline, looser one to fill the pool
const taken = new Map(); // author key/name -> count
const chosen = new Set(); // ol work ids already placed
const ranked = [];
for (const { limit, cap } of [{ limit: HEAD, cap: HEAD_CAP }, { limit: POOL, cap: POOL_CAP }]) {
  for (const c of sorted) {
    if (ranked.length >= limit) break;
    if (chosen.has(c.olWork)) continue;
    const who = c.authorKey ?? c.author;
    if ((taken.get(who) ?? 0) >= cap) continue;
    taken.set(who, (taken.get(who) ?? 0) + 1);
    chosen.add(c.olWork);
    // two why parts max, and never two citing the same film (compare by year token)
    const filmsIn = (s) => [...s.matchAll(/\((\d{4})\)/g)].map((m) => m[1]);
    const parts = [];
    for (const w of c.whys) {
      if (parts.length === 2) break;
      if (parts.some((p) => filmsIn(p).some((f) => filmsIn(w).includes(f)))) continue;
      parts.push(w);
    }
    c.why = parts.join(" · ");
    delete c.whys;
    delete c.gated;
    delete c.authorKey;
    c.weight = round(c.weight);
    c.rankScore = round(c.rankScore);
    ranked.push(c);
  }
}
ranked.forEach((c, i) => (c.rank = i + 1));

const out = {
  generated: new Date().toISOString(),
  basedOn: {
    lovedFilms: ratings.filter((r) => r.score >= 4).length,
    ratedBooks: books.filter((b) => b.status === "read" && b.score != null).length,
    confirmedAdaptations: confirmedEdges.length,
  },
  head: Math.min(HEAD, ranked.length),
  items: ranked,
};
await writeFile(path.join(root, "data/book-suggestions.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n${ranked.length} suggestions, head ${out.head} (${adaptationPicks} adaptation-derived) -> data/book-suggestions.json`);
for (const c of ranked) console.log(`  ${c.rank}. ${c.title} — ${c.author} · ${c.why}`);
