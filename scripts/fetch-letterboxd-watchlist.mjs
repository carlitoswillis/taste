#!/usr/bin/env node
// Pull the public Letterboxd watchlist into data/letterboxd-watchlist.json.
// Letterboxd has no open API and the watchlist has no RSS, but the page at
// letterboxd.com/<user>/watchlist/ (and /page/N/) renders one LazyPoster
// component per film carrying "Title (Year)", the slug and the film link.
// Page order is kept: Letterboxd's default sort is newest added first.
// Run: node scripts/fetch-letterboxd-watchlist.mjs

import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
const user = config.letterboxd;
const outPath = path.join(root, "data/letterboxd-watchlist.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 taste-profile-site";
const base = `https://letterboxd.com/${user}/watchlist/`;
const MAX_PAGES = 60; // runaway guard: 60 x 28 films

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? tag.match(new RegExp(`\\s${name}='([^']*)'`));
  return m ? decode(m[1]) : null;
};

function parsePage(html) {
  const films = [];
  for (const [tag] of html.matchAll(/<div\b[^>]*data-component-class="LazyPoster"[^>]*>/g)) {
    const name = attr(tag, "data-item-name");
    if (!name) continue;
    const m = name.match(/^(.*)\s\((\d{4})\)$/);
    films.push({
      title: m ? m[1] : name,
      year: m ? Number(m[2]) : null,
      slug: attr(tag, "data-item-slug"),
      link: `https://letterboxd.com${attr(tag, "data-target-link") ?? attr(tag, "data-item-link") ?? ""}`,
    });
  }
  const pages = [...html.matchAll(/\/watchlist\/page\/(\d+)\//g)].map((m) => Number(m[1]));
  return { films, lastPage: Math.max(1, ...pages) };
}

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) {
    console.error(`Letterboxd watchlist fetch failed: ${url} -> ${res.status} ${res.statusText}`);
    process.exit(1); // the existing file is left untouched
  }
  return res.text();
}

const first = parsePage(await get(base));
if (!first.films.length) {
  console.error(`No LazyPoster films parsed from ${base} — bot interstitial, private/empty watchlist, or markup change.`);
  process.exit(1);
}
const items = [...first.films];
const lastPage = Math.min(first.lastPage, MAX_PAGES);
for (let n = 2; n <= lastPage; n++) {
  await new Promise((r) => setTimeout(r, 600)); // polite: one request per page, spaced out
  const page = parsePage(await get(`${base}page/${n}/`));
  if (!page.films.length) {
    console.error(`Page ${n} parsed no films; refusing to write a partial watchlist.`);
    process.exit(1);
  }
  items.push(...page.films);
}

const seen = new Set();
const out = {
  fetched: Date.now(),
  user,
  items: items
    .filter((f) => (seen.has(f.slug) ? false : seen.add(f.slug)))
    .map((f, i) => ({ ...f, position: i + 1 })),
};
// Letterboxd film pages carry the TMDB id (<body data-tmdb-id="...">); the
// enrichment prefers it over any title search. Ids already in the previous file
// are reused so only new films cost a request.
let prev = new Map();
try {
  const old = JSON.parse(await readFile(outPath, "utf8"));
  prev = new Map((old.items ?? []).filter((f) => f.tmdbId).map((f) => [f.slug, f.tmdbId]));
} catch {}
for (const f of out.items) {
  if (prev.has(f.slug)) { f.tmdbId = prev.get(f.slug); continue; }
  try {
    const res = await fetch(f.link, { headers: { "user-agent": UA, accept: "text/html" } });
    if (res.ok) {
      const html = await res.text();
      const id = html.match(/themoviedb\.org\/movie\/(\d+)/)?.[1]; // movie ids only (TV pages link /tv/)
      if (id) f.tmdbId = Number(id);
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 600));
}
// write-then-rename so an interrupted run never leaves a truncated file
await writeFile(outPath + ".tmp", JSON.stringify(out, null, 2) + "\n");
await rename(outPath + ".tmp", outPath);
console.log(`Fetched ${out.items.length} watchlist films over ${lastPage} page(s) for ${user} -> data/letterboxd-watchlist.json`);
