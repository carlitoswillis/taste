// Seeded, deterministic daily sampling for the TV feed. Pure: no clock, no files, no state.
// The same date key always gives the same draw, so the mix is stable all day and changes daily.

export function hashString(s) { // FNV-1a, 32-bit
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// "YYYY-MM-DD" for a moment, in a given IANA zone (default America/Los_Angeles).
export function dateKey(when = new Date(), timeZone = "America/Los_Angeles") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
}

export function shiftDateKey(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Weighted sample without replacement (Efraimidis-Spirakis: key = u^(1/w), keep the k largest).
// items: array; weight(item) -> number (<= 0 or non-finite excludes it); returns items in draw order.
export function weightedSample(items, weight, k, seed) {
  const rng = mulberry32(typeof seed === "string" ? hashString(seed) : seed);
  const keyed = [];
  for (const item of items) { // rng is consumed once per item in input order, so the draw depends only on (items, seed)
    const u = rng();
    const w = weight(item);
    if (!(w > 0) || !Number.isFinite(w)) continue;
    keyed.push({ item, key: Math.log(u || 1e-12) / w });
  }
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map((x) => x.item);
}

// A day's sample with a freshness penalty: whatever yesterday's draw (same seeded draw, base weights, previous
// date) picked is `penalty` times as likely today. id(item) identifies items; salt separates independent draws.
export function dailySample(items, { weight, id, k, date, salt = "", penalty = 0.5 }) {
  const seedFor = (d) => `${salt}|${d}`;
  const yesterday = new Set(weightedSample(items, weight, k, seedFor(shiftDateKey(date, -1))).map(id));
  return weightedSample(items, (it) => weight(it) * (yesterday.has(id(it)) ? penalty : 1), k, seedFor(date));
}
