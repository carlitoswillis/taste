// The Fire TV sleep screen's daily 25 films. Pure: no clock, no files, no state. A day's set is a function of
// (candidates, date) alone; the previous days it must not repeat are recomputed from their dates, back to a fixed anchor.
import { weightedSample, shiftDateKey } from "./daily-pick.mjs";

export const AMBIENT_ANCHOR = "2026-10-01"; // days on or before this have no history to avoid
export const AMBIENT_TARGET = { queue: 4, lb: 17, sugg: 4 };
export const WINDOWS = [7, 5, 3, 2, 1, 0]; // 7 is the rule; 5 and 3 are the owner-approved relaxations; 2 and 1 are last resorts before repeating freely

const directorsOf = (c) => String(c.director ?? "").split(/\s*(?:,|&| and )\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean);

// One day given the ids to exclude. Returns the picked candidates (shuffled together) or null if fewer than `size` eligible.
function drawDay(cands, date, exclude, size, target) {
  const pool = cands.filter((c) => !exclude.has(c.id));
  if (pool.length < size) return null;
  const ranked = {};
  for (const b of Object.keys(target)) ranked[b] = weightedSample(pool.filter((c) => c.bucket === b), (c) => c.weight, Infinity, `ambient|${b}|${date}`);
  const picked = [], ids = new Set(), dirs = new Set();
  const take = (c, unique) => {
    if (ids.has(c.id)) return false;
    const d = directorsOf(c);
    if (unique && d.some((x) => dirs.has(x))) return false;
    ids.add(c.id); d.forEach((x) => dirs.add(x)); picked.push(c); return true;
  };
  const count = (b) => picked.filter((c) => c.bucket === b).length;
  // 1) each bucket up to its target, one film per director; 2) fill the shortfall from the other buckets (lb first), still unique;
  // 3) if directors still block it, allow repeats of a director.
  for (const unique of [true, false]) {
    for (const b of Object.keys(target)) for (const c of ranked[b]) { if (count(b) >= target[b] || picked.length >= size) break; take(c, unique); }
    for (const b of ["lb", "queue", "sugg"]) for (const c of ranked[b] ?? []) { if (picked.length >= size) break; take(c, unique); }
  }
  if (picked.length < size) return null;
  // Interleave the buckets in a seeded order rather than queue-first.
  return weightedSample(picked, () => 1, size, `ambient|order|${date}`);
}

/**
 * @param cands [{ id, bucket: "queue"|"lb"|"sugg", weight, director }]
 * @returns { items, window, relaxed } : window = days of history honoured (7, 5, 3 or 0 = none), relaxed = window < 7
 */
export function ambientDay(cands, date, { size = 25, target = AMBIENT_TARGET, anchor = AMBIENT_ANCHOR, memo = new Map() } = {}) {
  const key = (d) => d;
  const day = (d) => {
    if (memo.has(key(d))) return memo.get(key(d));
    const prior = [];
    if (d > anchor) for (let i = 1; i <= 7; i++) prior.push(day(shiftDateKey(d, -i)));
    let res = null;
    for (const w of d > anchor ? WINDOWS : [0]) {
      const exclude = new Set(prior.slice(0, w).flatMap((p) => p.items.map((c) => c.id)));
      const items = drawDay(cands, d, exclude, size, target);
      if (items) { res = { items, window: w, relaxed: w < 7 && d > anchor }; break; }
    }
    if (!res) res = { items: weightedSample(cands, () => 1, size, `ambient|short|${d}`), window: 0, relaxed: true }; // pool smaller than size
    memo.set(key(d), res);
    return res;
  };
  // Iterate from the anchor so recursion depth stays shallow.
  for (let d = anchor, n = 0; d < date && n < 4000; d = shiftDateKey(d, 1), n++) day(d);
  return day(date);
}

/** Films per day a pool of [poolSize] can carry with the full 7-day gap (7 excluded days + today = 8 sets): floor(pool / 8), capped at [max], at least [min]. */
export const ambientSize = (poolSize, max = 25, min = 15) => Math.max(min, Math.min(max, Math.floor(poolSize / 8)));
