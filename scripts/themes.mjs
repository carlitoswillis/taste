#!/usr/bin/env node
// Measure how strongly each curated theme runs through the films you loved,
// by matching TMDB keywords (from enrichment.json) against the hand-edited
// vocabulary in data/theme-map.json. Deterministic, zero network — reads only
// local JSON, writes data/themes.json. The map itself is curation: use
// --unmapped to dump the keywords still awaiting a home. Run: npm run themes

import { readFile, writeFile } from "node:fs/promises";
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

const ratings = await read("ratings", []);
const watched = await read("watched", []);
const oldFilms = await read("old-films", []);
const enrichment = await read("enrichment", {});
const map = await read("theme-map", { themes: [], ignore: [], assign: {}, suppress: {} });

const key = (f) => `${f.title} (${f.year})`;
const norm = (s) => s.trim().toLowerCase();
const round = (n) => Math.round(n * 100) / 100;

// exact lowercase-name matching only — variants are enumerated in the map
const kwTheme = new Map(); // keyword name -> theme id
for (const t of map.themes) for (const k of t.keywords ?? []) kwTheme.set(norm(k), t.id);
const ignore = new Set((map.ignore ?? []).map(norm));

// union of the log, the import, and the old-films trial, keyed by title+year
const seen = new Map();
for (const f of [...watched, ...oldFilms, ...ratings]) seen.set(key(f), f);
const loved = ratings.filter((r) => typeof r.score === "number" && r.score >= 4);

// a film expresses a theme iff ≥1 keyword matches, or its key is in assign, minus suppress
const expresses = (f) => {
  const dk = key(f);
  const matched = new Map(); // theme id -> matched keyword names
  for (const kw of enrichment[dk]?.keywords ?? []) {
    const t = kwTheme.get(norm(kw.name));
    if (!t) continue;
    if (!matched.has(t)) matched.set(t, []);
    matched.get(t).push(norm(kw.name));
  }
  for (const t of map.assign?.[dk] ?? []) if (!matched.has(t)) matched.set(t, []);
  for (const t of map.suppress?.[dk] ?? []) matched.delete(t);
  return matched;
};

// --- one pass over everything seen: corpus keyword stats + theme exposure ---
const acc = new Map(map.themes.map((t) => [t.id, {
  lovedCount: 0, seenCount: 0, affinity: 0, lovedFilms: [], keywordIds: new Set(), keywordHits: {},
}]));
const corpus = new Map(); // keyword name -> {id, seenCount, lovedCount, films:[], lovedFilms:[]}
let seenWithKeywords = 0;

for (const f of seen.values()) {
  const kws = enrichment[key(f)]?.keywords;
  if (Array.isArray(kws)) {
    seenWithKeywords++;
    for (const kw of kws) {
      const n = norm(kw.name);
      const c = corpus.get(n) ?? { id: kw.id, seenCount: 0, lovedCount: 0, films: [], lovedFilms: [] };
      c.seenCount++;
      if (c.films.length < 3) c.films.push(key(f));
      corpus.set(n, c);
    }
  }
  for (const [t, names] of expresses(f)) {
    const a = acc.get(t);
    if (!a) continue;
    a.seenCount++;
    for (const n of names) {
      a.keywordIds.add(corpus.get(n).id);
      a.keywordHits[n] = (a.keywordHits[n] ?? 0) + 1;
    }
  }
}
const lovedCovered = loved.filter((f) => Array.isArray(enrichment[key(f)]?.keywords)).length;

for (const f of loved) {
  for (const [t, names] of expresses(f)) {
    const a = acc.get(t);
    if (!a) continue;
    a.lovedCount++;
    a.affinity += f.score - 3;
    a.lovedFilms.push({ title: f.title, year: f.year, score: f.score, matched: [...new Set(names)] });
  }
  for (const kw of enrichment[key(f)]?.keywords ?? []) {
    const c = corpus.get(norm(kw.name));
    c.lovedCount++;
    if (c.lovedFilms.length < 3) c.lovedFilms.push(key(f));
  }
}

const maxAffinity = Math.max(...[...acc.values()].map((a) => a.affinity), 0);
const themes = map.themes.map((t) => {
  const a = acc.get(t.id);
  return {
    id: t.id, name: t.name, core: t.core ?? false,
    affinity: a.affinity,
    affinityNorm: maxAffinity ? round(a.affinity / maxAffinity) : 0,
    lovedCount: a.lovedCount,
    lovedShare: lovedCovered ? round(a.lovedCount / lovedCovered) : 0,
    seenCount: a.seenCount,
    seenShare: seenWithKeywords ? round(a.seenCount / seenWithKeywords) : 0,
    tilt: round((lovedCovered ? a.lovedCount / lovedCovered : 0) - (seenWithKeywords ? a.seenCount / seenWithKeywords : 0)),
    lovedFilms: a.lovedFilms.sort((x, y) => y.score - x.score),
    keywordIds: [...a.keywordIds],
    keywordHits: a.keywordHits,
  };
});

// unmapped, non-ignored keywords that keep showing up in loved films
const unmapped = [...corpus.entries()].filter(([n]) => !kwTheme.has(n) && !ignore.has(n));
const emergent = unmapped
  .filter(([, c]) => c.lovedCount >= 2)
  .map(([n, c]) => ({
    keyword: n, id: c.id, lovedCount: c.lovedCount, seenCount: c.seenCount,
    tilt: round((lovedCovered ? c.lovedCount / lovedCovered : 0) - (seenWithKeywords ? c.seenCount / seenWithKeywords : 0)),
    films: c.lovedFilms,
  }))
  .sort((a, b) => b.lovedCount - a.lovedCount || b.tilt - a.tilt)
  .slice(0, 25);

if (process.argv.includes("--unmapped")) {
  // curation dump: count<TAB>keyword<TAB>example films — paste into a Claude session
  const rows = unmapped.filter(([, c]) => c.seenCount >= 2).sort((a, b) => b[1].seenCount - a[1].seenCount || a[0].localeCompare(b[0]));
  for (const [n, c] of rows) console.log(`${c.seenCount}\t${n}\t${c.films.join(" · ")}`);
  process.exit(0);
}

const out = {
  generated: new Date().toISOString(),
  basedOn: { loved: loved.length, seenWithKeywords, filmsEnriched: Object.keys(enrichment).length },
  themes,
  emergent,
  coverage: {
    filmsWithKeywords: seenWithKeywords,
    filmsWithoutKeywords: seen.size - seenWithKeywords,
    distinctKeywords: corpus.size,
    mappedKeywords: [...corpus.keys()].filter((n) => kwTheme.has(n)).length,
    unmappedSeenTwicePlus: unmapped.filter(([, c]) => c.seenCount >= 2).length,
  },
};
await writeFile(path.join(root, "data/themes.json"), JSON.stringify(out, null, 2) + "\n");
const top = [...themes].sort((a, b) => b.affinity - a.affinity)[0];
console.log(
  `themes.json: ${themes.length} themes` +
    (top ? `, strongest "${top.name}" (affinity ${top.affinity}, ${top.lovedCount} loved)` : "") +
    ` · ${emergent.length} emergent · ${out.coverage.unmappedSeenTwicePlus} unmapped keywords seen 2+`
);
