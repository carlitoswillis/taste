// Feed-side half of the TV's Tonight picker (firetv spec §6). Pure: build-tv-feed.mjs passes data in.
// The TV adds the evening-local part (bedtime, fits, shown-not-played). Only `base` (rounded to 0.05), `rank`, a rating-free `why`
// and `availableSince` are published; the inputs (scores, affinity, diary) never leave this module.
import { RATING_WORDS } from "./tv-feed-rules.mjs";

export const WHY_MAX = 52;
const DAY = 86400000;
const day = (s) => Date.parse(`${s}T00:00:00Z`);
export const daysBetween = (a, b) => Math.round((day(b) - day(a)) / DAY);
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const round05 = (x) => Math.round(x * 20) / 20;
export const personKey = (n) => String(n ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const people = (xs) => (Array.isArray(xs) ? xs.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean) : []);

/** "1h55" / "2h05" / "98 min" / 127 -> minutes, or undefined. */
export function parseRuntime(r) {
  if (Number.isInteger(r) && r > 0) return r;
  const s = String(r ?? "");
  const hm = /^(\d+)\s*h\s*(\d{0,2})/i.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
  const m = /^(\d+)\s*(?:m|min)/i.exec(s);
  return m ? Number(m[1]) : undefined;
}

const ORD = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * recent: diary films [{title, year, date, score, directors[], cast[], genres[]}] (any order).
 * Returns {thread, sameDirector14d, moodHits} signals for one candidate (director names + cast + genres).
 */
export function signals(item, recent, today) {
  const dirs = new Set(people(item.directors).map(personKey));
  const top3 = new Set(people(item.cast).slice(0, 3).map(personKey));
  let thread = null, sameDirector14d = false;
  for (const r of [...recent].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    const age = daysBetween(r.date, today);
    if (age < 0) continue;
    const rd = people(r.directors).map(personKey);
    if (age <= 14 && rd.some((d) => dirs.has(d))) sameDirector14d = true;
    if (!thread && age <= 90 && r.score >= 4) {
      const sharedDir = people(r.directors).find((d) => dirs.has(personKey(d)));
      const sharedCast = people(r.cast).slice(0, 3).find((c) => top3.has(personKey(c)));
      if (sharedDir || sharedCast) thread = { name: sharedDir ?? sharedCast, kind: sharedDir ? "director" : "cast", title: r.title, month: MONTH[Number(r.date.slice(5, 7)) - 1] };
    }
  }
  const last3 = [...recent].filter((r) => daysBetween(r.date, today) >= 0).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
  const first = (item.genres ?? [])[0];
  const moodHits = first ? last3.filter((r) => (r.genres ?? []).includes(first)).length : 0;
  return { thread, sameDirector14d, moodHits };
}

/**
 * base = 0.40 queue + 0.25 quality + 0.20 affinity + 0.15 thread - 0.25 sameDirector14d - 0.10 moodHits + 0.10 newOnApps, rounded to 0.05.
 * queue: hand-ranked 1-(rank-1)/(2n), Letterboxd watchlist 0.45. quality: clamp((rating-6)/3). affinity: (mean-3)/2 or 0.3 when unknown.
 */
export function baseScore({ rank, n = 1, rating, affinityMean, thread, sameDirector14d, moodHits = 0, isNew }) {
  const queue = rank ? 1 - (rank - 1) / (2 * Math.max(n, 1)) : 0.45;
  const quality = typeof rating === "number" && rating > 0 ? clamp((rating - 6) / 3) : 0;
  const affinity = typeof affinityMean === "number" ? clamp((affinityMean - 3) / 2) : 0.3;
  const b = 0.4 * queue + 0.25 * quality + 0.2 * affinity + 0.15 * (thread ? 1 : 0) - 0.25 * (sameDirector14d ? 1 : 0) - 0.1 * moodHits + 0.1 * (isNew ? 1 : 0);
  return Math.max(0, round05(b));
}

const lastWord = (n) => String(n).trim().split(/\s+/).pop();
/** The first rule that applies, as one rating-free line <= 52 chars (spec §6: thread, new on apps, queue top 10, watchlist, fit). */
export function whyLine({ thread, newApp, rank, source, runtime }) {
  const cands = [];
  if (thread) {
    const who = thread.kind === "director" ? lastWord(thread.name) : thread.name;
    cands.push([`${who} again, after ${thread.title} in ${thread.month}`, `${who} again, after ${thread.title}`]);
  }
  if (newApp) cands.push([`New on ${newApp} this week`]);
  if (rank && rank <= 10) cands.push([`${ORD[rank]} on your ranked list`]);
  if (source === "letterboxd") cands.push([runtime && runtime < 100 ? "On your Letterboxd watchlist, under 100 min" : "On your Letterboxd watchlist"]);
  if (runtime) cands.push([`${runtime} minutes`]);
  for (const opts of cands) for (const s of opts) if (s.length <= WHY_MAX && !RATING_WORDS.test(s)) return s;
  return undefined;
}
