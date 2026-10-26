#!/usr/bin/env node
// Builds the Fire TV launcher's feed into dist/tv/<config.tvFeedPath>/feed.json (GitHub Pages serves dist/).
// Same document as the assistant's GET /tv/feed (v1): { v, generated, list:{items}, sent:[], ambient:{items} },
// built daily (America/Los_Angeles seed, scripts/lib/daily-pick.mjs) from: the whole taste queue, a weighted sample of
// 30 Letterboxd watchlist films, and 10 recommender picks (source "suggestion", with a `why`), joined to data/enrichment.json. Differences: list items also carry raw `providers` (flatrate/free/rent/buy), plus
// `backdropUrl` (w780), `detailUrl` (w1280) and `portraitUrl` (w342) and `altBackdropUrls` (w780: the film's other backdrops,
// least black first, from data/tv-backdrops.json; the primary is one that is not mostly black); `sent` is always [] (no Send to TV queue here).
// Rules (scripts/lib/tv-feed-rules.mjs): JustWatch and other non-stores are never a rent/buy venue; a tagline that only repeats
// the plot is dropped; every cut (overview, why, note, tagline) is one cutter, cutWords, that never ends on "The…".
// Publishes the owner's queue, a sample of the Letterboxd watchlist and a few recommender suggestions, with their reasons.
// It never publishes ratings history: every `why` and ambient `note` goes through ratingFree ("X directed this, like A
// and B", no stars, no "you rated"), and the build fails if any published string still holds "★" or "rated".
// Ambient items carry `verb`: "Available" for a streaming route, "Rent" for a rent/buy-only one. The path segment is the unguessable part: it lives in config.json
// (tvFeedPath), is stripped from the published copy of config.json (build.mjs), and robots.txt disallows /tv/.
// Run after scripts/build.mjs: node scripts/build-tv-feed.mjs

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dateKey, weightedSample, dailySample } from "./lib/daily-pick.mjs";
import { ambientDay, ambientSize } from "./lib/ambient-pick.mjs";
import { stores, repeatsOverview, pickStills, cutWords, ratingFree, ratingLeaks, ambientVerb, rentNote } from "./lib/tv-feed-rules.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = process.env.TV_FEED_DIST || path.join(root, "dist");
const MAX_LIST = Number(process.env.TV_FEED_MAX_LIST ?? 60);
const LB_SAMPLE = Number(process.env.TV_FEED_LB_SAMPLE ?? 30);
const SUGG_PICKS = Number(process.env.TV_FEED_SUGG_PICKS ?? 10);
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
const RENT_VENUES = (PROVIDERS.rentVenues ?? []).flatMap((r) => r.match.map((m) => [words(m), r]));
// Rent/buy only: a store that is a route to an app although it is not a streaming provider (never used for flatrate/free).
function rentVenue(name) {
  const w = words(name);
  for (const [m, r] of RENT_VENUES) if (starts(w, m)) return r;
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
  const rv = rb.map(rentVenue).find(Boolean);
  if (rv) return rentNote(rv.label);
  return rb.length ? `Rent or buy: ${rb.slice(0, 2).join(", ")}` : `Not streaming in ${region}`;
}

const namesOf = (xs) => (Array.isArray(xs) ? xs.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean) : []);
const directorOf = (d) => (Array.isArray(d) ? namesOf(d).join(", ") : typeof d === "string" ? d : "") || undefined;
const OVERVIEW_MAX = 2000; // the TV's full plot page shows it whole; views clip themselves (firetv-launcher YOURLIST.md)
function details(e = {}) {
  const d = {};
  const overview = cutWords(e.overview, OVERVIEW_MAX);
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
  // suggestions.json `why` is " · "-joined reasons; keep the first one with its ratings clause removed.
  const why = ratingFree(String(c.why ?? "").split(" · ")[0]);
  return { ...c, source: "suggestion", why: cutWords(why, 140) };
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

// Sleep screen (owner 2026-10-25: not the same films every day): a fresh 25 per day from queue + whole Letterboxd watchlist +
// the TV-filtered suggestions, none repeating within the last 7 days (scripts/lib/ambient-pick.mjs). Needs an app route
// (flatrate/free, else rent/buy on a mapped store) and a backdrop or poster.
const routeOf = (c) => {
  const p = c.e.providers ?? {};
  const m = mapItem(p);
  if (m.apps.length) return { apps: m.apps, rules: m.rules, streams: true };
  const rules = [];
  for (const name of [...stores(p.rent), ...stores(p.buy)]) { const r = mapProvider(name) ?? rentVenue(name); if (r && !rules.includes(r)) rules.push(r); }
  return rules.length ? { apps: rules.map((r) => r.pkg), rules, streams: false } : null;
};
const ambPool = [];
const ambSeen = new Set();
const addAmb = (c, bucket, weight) => {
  if (ambSeen.has(c.tmdbId) || !c.director || !c.title || !c.year) return;
  const r = routeOf(c), b = stillsOf(c).primary, pp = posterPath(c.e.poster);
  if (!r || !(b || pp)) return;
  ambSeen.add(c.tmdbId);
  ambPool.push({ id: String(c.tmdbId), bucket, weight: weight * (r.streams ? 3 : 1), director: c.director, c, r, b, pp });
};
fromWatch.forEach((c) => addAmb(c, "queue", 1));
fromLb.forEach((c) => addAmb(c, "lb", 1));
const ambSuggs = fromSugg.filter((c) => !ids.has(c.tmdbId) && !seenFilm.has(normTitle(c.title, c.year)) && !names.has(normTitle(c.title, c.year))
  && (Number(c.score) || 0) >= medianScore && wellRegarded(c));
ambSuggs.forEach((c) => addAmb(c, "sugg", Math.pow(Number(c.score) || 0, 1.5)));
// A 7-day gap excludes the 7 previous days, so a pool holds it only up to pool/8 films a day. Shrink the day (never below 15)
// rather than relax the window: the TV cycles them every 20 s anyway.
const ambSize = ambientSize(ambPool.length, MAX_AMBIENT);
if (ambSize < MAX_AMBIENT) console.warn(`ambient: daily count lowered to ${ambSize} (pool ${ambPool.length}) to keep the 7-day gap`);
const day = ambientDay(ambPool, today, { size: ambSize });
if (day.relaxed) console.warn(`ambient: freshness relaxed to ${day.window} day(s) on ${today}; pool ${ambPool.length}`);
const ambient = day.items.map(({ c, r, b, pp }) => ({
  id: String(c.tmdbId), title: c.title, ...(c.year ? { year: c.year } : {}),
  ...(c.director ? { director: c.director } : {}),
  app: r.apps[0], appLabel: r.rules[0].label ?? r.rules[0].match[0], verb: ambientVerb(r.streams),
  ...(ratingFree(c.why) ? { note: cutWords(ratingFree(c.why), 280) } : {}),
  ...(b ? { backdropUrl: `${IMG}/w1280${b}` } : {}),
  ...(pp ? { posterUrl: `${IMG}/w780${pp}` } : {}),
  // The film's own line for the ambient bill's quiet line when there is no taste note (details() drops plot-repeating taglines).
  ...(details(c.e).tagline ? { tagline: cutWords(details(c.e).tagline, 200) } : {}),
}));
globalThis.__ambientPool = ambPool.length;

const doc = { v: 1, generated: now, list: { items: list }, sent: [], ambient: { items: ambient } };
const leaks = ratingLeaks(doc);
if (leaks.length) { console.error(`TV feed would publish ratings history at ${leaks.slice(0, 5).map(([at]) => at).join(", ")}`); process.exit(1); }
const out = path.join(dist, "tv", cfg.tvFeedPath);
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "feed.json"), JSON.stringify(doc));

// robots.txt: keep any existing rules, make sure /tv/ is disallowed.
const robots = path.join(dist, "robots.txt");
let txt = existsSync(robots) ? readFileSync(robots, "utf8") : "User-agent: *\n";
if (!/^Disallow:\s*\/tv\/\s*$/m.test(txt)) txt = txt.replace(/\s*$/, "\n") + "Disallow: /tv/\n";
writeFileSync(robots, txt);

const g = globalThis.__groups;
console.log(`TV feed ${g.date}: queue ${g.watch} + letterboxd ${g.lb} + suggestions ${g.sugg}; ${list.length} list, ${ambient.length} ambient (pool ${globalThis.__ambientPool}, window ${day.window}d) -> dist/tv/<tvFeedPath>/feed.json`);
if (process.env.TV_FEED_DEBUG) { const n = {}; for (const c of ambPool) n[c.bucket] = (n[c.bucket] ?? 0) + 1; console.log(n, "lb total", fromLb.length, "queue", fromWatch.length, "sugg", ambSuggs.length, "no-route lb", fromLb.filter(c=>!routeOf(c)).length, "no-dir", fromLb.filter(c=>!c.director).length); }
