#!/usr/bin/env node
// Builds the Fire TV launcher's feed into dist/tv/<config.tvFeedPath>/feed.json (GitHub Pages serves dist/).
// Same document as the assistant's GET /tv/feed (v1): { v, generated, list:{items}, sent:[], ambient:{items} },
// built daily (America/Los_Angeles seed, scripts/lib/daily-pick.mjs) from: the whole taste queue, a weighted sample of
// 30 Letterboxd watchlist films, and 10 recommender picks (source "suggestion", with a `why`), joined to data/enrichment.json. Differences: list items also carry raw `providers` (flatrate/free/rent/buy), plus
// `backdropUrl` (w780), `detailUrl` (w1280) and `portraitUrl` (w342) and `altBackdropUrls` (w780: the film's other backdrops,
// least black first, from data/tv-backdrops.json; the primary is one that is not mostly black); `sent` is always [] (no Send to TV queue here).
// Ambient items carry `backdropUrl` (w1280 still), `posterUrl` (w780 2:3 poster) and `tagline` (the film's own line, when it does not repeat the plot).
// Rules (scripts/lib/tv-feed-rules.mjs): JustWatch and other non-stores are never a rent/buy venue; a tagline that only repeats
// the plot is dropped; a `why` never ends on "The…".
// Publishes only watchlist-derived films. The path segment is the unguessable part: it lives in config.json
// (tvFeedPath), is stripped from the published copy of config.json (build.mjs), and robots.txt disallows /tv/.
// Run after scripts/build.mjs: node scripts/build-tv-feed.mjs

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dateKey, weightedSample, dailySample } from "./lib/daily-pick.mjs";
import { stores, repeatsOverview, dropDangling, pickStills } from "./lib/tv-feed-rules.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const MAX_LIST = Number(process.env.TV_FEED_MAX_LIST ?? 60);
const LB_SAMPLE = Number(process.env.TV_FEED_LB_SAMPLE ?? 30);
const SUGG_PICKS = Number(process.env.TV_FEED_SUGG_PICKS ?? 10);
const MAX_AMBIENT_QUEUE = 40; // ambient keeps drawing from the original first-40 queue so it is unaffected by the daily mix
const MAX_AMBIENT = Number(process.env.TV_FEED_MAX_AMBIENT ?? 25);
const IMG = "https://image.tmdb.org/t/p";

const readJson = (f, fb) => { try { return JSON.parse(readFileSync(path.join(root, f), "utf8")); } catch { return fb; } };
const cfg = readJson("config.json", {});
if (!/^[0-9a-f]{32}$/.test(cfg.tvFeedPath ?? "")) { console.error("config.json tvFeedPath missing or not 32 hex chars"); process.exit(1); }
const region = cfg.region ?? "US";
const PROVIDERS = readJson("data/tv-providers.json", null);
if (!PROVIDERS) { console.error("data/tv-providers.json missing"); process.exit(1); }

const words = (s) => String(s ?? "").toLowerCase().match(/[a-z0-9+]+/g) ?? [];
const RULES = PROVIDERS.rules.flatMap((r) => r.match.map((m) => [words(m), r]));
const SKIPS = (PROVIDERS.skip ?? []).map(words);
const IGNORE = (PROVIDERS.ignore ?? []).map((s) => s.toLowerCase());
const NOAPP = Object.fromEntries(Object.entries(PROVIDERS.noApp ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
const starts = (w, m) => w.length >= m.length && m.every((x, i) => w[i] === x);
const contains = (w, m) => { for (let i = 0; i + m.length <= w.length; i++) if (m.every((x, j) => w[i + j] === x)) return true; return false; };
function mapProvider(name) {
  const w = words(name);
  if (IGNORE.includes(String(name).toLowerCase()) || SKIPS.some((s) => contains(w, s))) return null;
  for (const [m, r] of RULES) if (starts(w, m)) return r;
  return null;
}
function mapItem(p = {}) {
  const apps = [], rules = [], notes = [], other = [];
  for (const name of [...(p.flatrate ?? []), ...(p.free ?? [])]) {
    const r = mapProvider(name);
    if (r) {
      if (!apps.includes(r.pkg)) { apps.push(r.pkg); rules.push(r); }
      if (r.note && !notes.includes(r.note)) notes.push(r.note);
    } else {
      const n = NOAPP[String(name).toLowerCase()];
      if (n && !other.includes(n)) other.push(n);
    }
  }
  return { apps, rules, notes, other };
}
function noteFor(p = {}, m) {
  if (m.apps.length) return m.notes[0];
  if (m.other.length) return m.other[0];
  const rb = stores([...(p.rent ?? []), ...(p.buy ?? [])]);
  return rb.length ? `Rent or buy: ${rb.slice(0, 2).join(", ")}` : `Not streaming in ${region}`;
}

const namesOf = (xs) => (Array.isArray(xs) ? xs.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean) : []);
const directorOf = (d) => (Array.isArray(d) ? namesOf(d).join(", ") : typeof d === "string" ? d : "") || undefined;
const OVERVIEW_MAX = 2000; // the TV's full plot page shows it whole; views clip themselves (firetv-launcher YOURLIST.md)
function details(e = {}) {
  const d = {};
  let overview = String(e.overview ?? "").split(/\s+/).join(" ").trim();
  if (overview.length > OVERVIEW_MAX) {
    const cut = overview.slice(0, OVERVIEW_MAX).replace(/\s+\S*$/, "").replace(/[\s,;:-]+$/, "");
    overview = (cut || overview.slice(0, OVERVIEW_MAX)) + "…";
  }
  if (overview) d.overview = overview;
  const tagline = String(e.tagline ?? "").split(/\s+/).join(" ").trim();
  if (tagline && !repeatsOverview(tagline, overview)) d.tagline = tagline;
  if (Number.isInteger(e.runtime) && e.runtime > 0) d.runtime = e.runtime;
  const director = directorOf(e.director);
  if (director) d.director = director;
  const genres = (Array.isArray(e.genres) ? e.genres : []).filter((g) => typeof g === "string" && g).slice(0, 3);
  if (genres.length) d.genres = genres;
  const cast = namesOf(e.cast).slice(0, 3);
  if (cast.length) d.cast = cast;
  const rating = e.scores?.imdb || e.tmdbRating;
  if (typeof rating === "number" && rating > 0) d.rating = Math.round(rating * 10) / 10;
  return d;
}
const posterPath = (url) => /\/t\/p\/[^/]+(\/[^/?#]+)$/.exec(String(url ?? ""))?.[1];
const normTitle = (t, y) => `${String(t ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "")}|${y ?? ""}`;

const enrich = readJson("data/enrichment.json", {});
// Per film, how black each of its backdrops is (scripts/enrich-backdrops.mjs); a film with no entry keeps TMDB's own pick.
const BACKDROPS = readJson("data/tv-backdrops.json", {});
const stillsOf = (c) => {
  const primary = c.e.backdrop || null;
  const shares = BACKDROPS[String(c.tmdbId)]?.d;
  if (!shares) return { primary, alts: [] };
  return pickStills(primary, shares);
};
const watch = readJson("data/watchlist.json", []);
const sugg = readJson("data/suggestions.json", {});
const lb = readJson("data/letterboxd-watchlist.json", {});

const fromWatch = [];
for (const w of Array.isArray(watch) ? watch : []) {
  const e = enrich[`${w.title} (${w.year})`];
  if (e?.tmdbId) fromWatch.push({ title: w.title, year: w.year, tmdbId: e.tmdbId, e, why: w.why, director: w.director ?? directorOf(e.director), source: "taste" });
}
const ids = new Set(fromWatch.map((c) => c.tmdbId));
const names = new Set(fromWatch.map((c) => normTitle(c.title, c.year)));
const fromLb = [];
for (const w of Array.isArray(lb?.items) ? lb.items : []) {
  const e = enrich[`${w.title} (${w.year})`];
  if (!e?.tmdbId || ids.has(e.tmdbId) || names.has(normTitle(w.title, w.year))) continue;
  ids.add(e.tmdbId); names.add(normTitle(w.title, w.year));
  fromLb.push({ title: w.title, year: w.year, tmdbId: e.tmdbId, e, director: directorOf(e.director), source: "letterboxd", position: w.position ?? Infinity });
}
const streamable = (c) => (mapItem(c.e.providers).apps.length ? 0 : 1);
fromLb.sort((a, b) => streamable(a) - streamable(b) || a.position - b.position);
fromWatch.forEach((c, i) => { c.rank = i; });
fromWatch.sort((a, b) => streamable(a) - streamable(b) || a.rank - b.rank);
const fromSugg = [];
for (const s of sugg?.items ?? []) {
  if (!s.tmdbId) continue;
  const e = { ...(enrich[`${s.title} (${s.year})`] ?? {}) };
  for (const [k, v] of Object.entries(s)) if (v) e[k] = v;
  fromSugg.push({ title: s.title, year: s.year, tmdbId: s.tmdbId, e, why: s.why, score: s.score, director: directorOf(s.director ?? e.director), source: "taste" });
}
const primary = [...fromWatch, ...fromLb];
const ambientQueue = (primary.length ? primary : fromSugg).slice(0, MAX_AMBIENT_QUEUE);

// Daily mix (deterministic per America/Los_Angeles calendar day): 1) the owner's whole queue, in rank order;
// 2) a weighted sample of the Letterboxd watchlist; 3) a few of the recommender's picks.
const today = process.env.TV_FEED_DATE || dateKey();
const hasApp = (c) => mapItem(c.e.providers).apps.length > 0;
const lbWeight = (c) => (hasApp(c) ? 3 : 1) * (c.position <= 20 ? 1.5 : 1);
const lbPick = dailySample(fromLb, { weight: lbWeight, id: (c) => c.tmdbId, k: LB_SAMPLE, date: today, salt: "letterboxd" });
const seenFilm = new Set();
for (const f of [...readJson("data/watched.json", []), ...readJson("data/ratings.json", [])]) seenFilm.add(normTitle(f.title, f.year));
const taken = new Set([...fromWatch, ...lbPick].map((c) => c.tmdbId));
// "Within taste" (owner, 2026-10-25): only the recommender's stronger half, and only films that are well regarded
// (IMDb or TMDB >= 6.8 on >= 150 votes); weight by score^1.5 so the strongest picks surface most. This keeps a
// one-credit link (e.g. a minor writer) from pushing a weak film onto the TV.
const MIN_FILM_RATING = 6.8, MIN_VOTES = 150;
const scores = fromSugg.map((c) => Number(c.score) || 0).sort((a, b) => a - b);
const medianScore = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
const wellRegarded = (c) => {
  const r = Number(c.e.scores?.imdb || c.e.tmdbRating || c.e.tmdbRating) || 0;
  const v = Number(c.e.votes ?? c.e.voteCount ?? 0);
  return r >= MIN_FILM_RATING && (v === 0 || v >= MIN_VOTES);
};
const suggPool = fromSugg.filter((c) => !taken.has(c.tmdbId) && !seenFilm.has(normTitle(c.title, c.year)) && !names.has(normTitle(c.title, c.year))
  && (Number(c.score) || 0) >= medianScore && wellRegarded(c));
const suggPick = dailySample(suggPool, { weight: (c) => Math.pow(Number(c.score) || 0, 1.5), id: (c) => c.tmdbId, k: SUGG_PICKS, date: today, salt: "suggestions" }).map((c) => {
  // suggestions.json `why` is " · "-joined reasons; keep the first one, which is real data from the file.
  const why = String(c.why ?? "").split(" · ")[0].trim();
  return { ...c, source: "suggestion", why: why.length > 140 ? dropDangling(why.slice(0, 139).replace(/\s+\S*$/, "")) + "…" : why };
});
const queue = [...fromWatch, ...lbPick, ...suggPick].slice(0, MAX_LIST);
globalThis.__groups = { watch: fromWatch.length, lb: lbPick.length, sugg: suggPick.length, date: today };

const now = Date.now();
const list = queue.map((c) => {
  const p = c.e.providers ?? {};
  const m = mapItem(p);
  const note = noteFor(p, m);
  const { primary: b, alts } = stillsOf(c);
  const pp = posterPath(c.e.poster);
  return {
    id: `${c.source}:${c.tmdbId}`, title: c.title, ...(c.year ? { year: c.year } : {}), source: c.source, apps: m.apps,
    providers: { flatrate: p.flatrate ?? [], free: p.free ?? [], rent: stores(p.rent), buy: stores(p.buy) },
    ...(note ? { note } : {}), ...(c.source === "suggestion" && c.why ? { why: c.why } : {}), addedAt: now, ...details(c.e),
    ...(b ? { posterUrl: `${IMG}/w780${b}`, backdropUrl: `${IMG}/w780${b}`, detailUrl: `${IMG}/w1280${b}` } : pp ? { posterUrl: `${IMG}/w342${pp}` } : {}),
    ...(b && alts.length ? { altBackdropUrls: alts.map((a) => `${IMG}/w780${a}`) } : {}),
    ...(pp ? { portraitUrl: `${IMG}/w342${pp}` } : {}),
  };
});

const seen = new Set();
const ambient = [];
for (const c of [...ambientQueue, ...fromWatch, ...fromLb, ...fromSugg]) {
  if (seen.has(c.tmdbId)) continue;
  seen.add(c.tmdbId);
  const m = mapItem(c.e.providers);
  const b = stillsOf(c).primary;
  if (!m.apps.length || !b) continue; // the ambient screen is a backdrop: no backdrop, no item
  const pp = posterPath(c.e.poster);
  // The film's own line for the ambient bill's quiet line when there is no taste note; details() already drops a
  // tagline that only repeats the plot (tv-feed-rules repeatsOverview).
  const tagline = details(c.e).tagline;
  ambient.push({
    id: String(c.tmdbId), title: c.title, ...(c.year ? { year: c.year } : {}),
    ...(c.director ? { director: c.director } : {}),
    app: m.apps[0], appLabel: m.rules[0].label ?? m.rules[0].match[0],
    ...(c.why ? { note: String(c.why).slice(0, 280) } : {}),
    backdropUrl: `${IMG}/w1280${b}`,
    ...(pp ? { posterUrl: `${IMG}/w780${pp}` } : {}),
    ...(tagline ? { tagline: tagline.slice(0, 200) } : {}),
  });
  if (ambient.length >= MAX_AMBIENT) break;
}

const out = path.join(dist, "tv", cfg.tvFeedPath);
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "feed.json"), JSON.stringify({ v: 1, generated: now, list: { items: list }, sent: [], ambient: { items: ambient } }));

// robots.txt: keep any existing rules, make sure /tv/ is disallowed.
const robots = path.join(dist, "robots.txt");
let txt = existsSync(robots) ? readFileSync(robots, "utf8") : "User-agent: *\n";
if (!/^Disallow:\s*\/tv\/\s*$/m.test(txt)) txt = txt.replace(/\s*$/, "\n") + "Disallow: /tv/\n";
writeFileSync(robots, txt);

const g = globalThis.__groups;
console.log(`TV feed ${g.date}: queue ${g.watch} + letterboxd ${g.lb} + suggestions ${g.sugg}; ${list.length} list, ${ambient.length} ambient -> dist/tv/<tvFeedPath>/feed.json`);
