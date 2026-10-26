// Pure rules of the Fire TV feed builder (scripts/build-tv-feed.mjs). The TV launcher (firetv-launcher) applies the same
// rules to whatever it is sent, so a feed built before these existed is still shown right: Providers.venue / cleanNote,
// FilmDetailMath.taglineFor / dropDangling and net/Dark.kt are the Kotlin twins.

const words = (s) => String(s ?? "").toLowerCase().match(/[a-z0-9+]+/g) ?? [];
const contains = (w, m) => { for (let i = 0; i + m.length <= w.length; i++) if (m.every((x, j) => w[i + j] === x)) return true; return false; };

// Names TMDB (JustWatch) lists under rent/buy that are not a store: the search site itself, and Plex's channel listing.
export const NOT_A_STORE = ["JustWatch", "Plex Channel"];
const NOT_STORE_WORDS = NOT_A_STORE.map(words);
export const isStore = (name) => { const w = words(name); return w.length > 0 && !NOT_STORE_WORDS.some((m) => contains(w, m)); };
/** A rent/buy list without the names that are no store, order kept, de-duplicated. */
export const stores = (names) => [...new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === "string" && isStore(n)))];

// ---- taglines that only repeat the plot
const norm = (s) => String(s ?? "").toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) ?? [];
/** True when [tagline] only repeats the start of [overview]: a prefix of it (or of its first sentence), or an opening run of 4+ words that is half the tagline. */
export function repeatsOverview(tagline, overview) {
  const tw = norm(tagline), ow = norm(overview);
  if (!tw.length || !ow.length) return false;
  let run = 0;
  while (run < tw.length && run < ow.length && tw[run] === ow[run]) run++;
  if (run === tw.length) return true;
  if (run >= 4 && run * 2 >= tw.length) return true;
  const first = String(overview).trim().split(/(?<=[.!?…])\s/)[0];
  return norm(first).join(" ") === tw.join(" ");
}

// ---- a cut never ends on "The…"
const STOP = new Set(["the", "a", "an", "of", "and", "or", "but", "nor", "in", "on", "at", "to", "for", "with", "by", "from", "as", "if", "is", "was", "than", "that", "this", "into", "over", "about", "its", "his", "her", "their", "my", "your", "our"]);
/** [s] without trailing stopwords and stray punctuation ("you rated The Odyssey 5★, The" -> "you rated The Odyssey 5★"). */
export function dropDangling(s) {
  let t = String(s).replace(/[\s,;:\-–—.]+$/, "");
  for (;;) {
    const i = t.lastIndexOf(" ");
    const last = (i < 0 ? t : t.slice(i + 1)).replace(/^[,;:.()"“”]+|[,;:.()"“”]+$/g, "").toLowerCase();
    if (i <= 0 || !STOP.has(last)) return t;
    t = t.slice(0, i).replace(/[\s,;:\-–—.]+$/, "");
  }
}

// ---- stills with a solid black region (net/Dark.kt is the Kotlin twin)
// A still is swapped only when it has a solid black REGION that reads as a failed or letterboxed image: a band of black
// lines touching an edge (columns in from the left/right, rows in from the top/bottom; letterbox bars add up) covering at
// least DARK_SHARE of the width or height. A line is black when >= 98 % of its pixels have luma < DARK_LUMA and the luma
// variance is near zero. Moody dark images with texture are kept (owner 2026-10-25: "some are dark on purpose").
export const DARK_LUMA = 12;     // a pixel under this luma (0..255) is near-pure black
export const DARK_SHARE = 0.25;  // the band must cover at least this share of the width or height
export const DARK_LINE = 0.98;   // share of a line's pixels that must be near-pure black
export const DARK_VARIANCE = 4;  // luma variance under this counts as flat
export const DARK_MARGIN = 0.05; // an alternative must beat the first still by this much

/**
 * The black-region score (0..1) of an RGBA image ([data], [w] x [h]): the larger of the width share covered by black
 * columns running in from the left and right edges and the height share covered by black rows running in from the top and
 * bottom; 0 unless at least DARK_SHARE.
 */
export function darkRegion(data, w, h) {
  if (!(w > 0 && h > 0) || data.length < w * h * 4) return 0;
  const luma = (i) => (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  const blackLine = (n, at) => {
    let dark = 0, sum = 0, sq = 0;
    for (let k = 0; k < n; k++) { const l = luma(at(k) * 4); if (l < DARK_LUMA) dark++; sum += l; sq += l * l; }
    if (dark < DARK_LINE * n) return false;
    const mean = sum / n;
    return sq / n - mean * mean < DARK_VARIANCE;
  };
  const col = (x) => blackLine(h, (k) => k * w + x);
  const row = (y) => blackLine(w, (k) => y * w + k);
  const run = (count, black, fromEnd) => { let k = 0; while (k < count && black(fromEnd ? count - 1 - k : k)) k++; return k; };
  const l = run(w, col, false), r = l >= w ? 0 : run(w, col, true);
  const t = run(h, row, false), b = t >= h ? 0 : run(h, row, true);
  const score = Math.max((l + r) / w, (t + b) / h);
  return score >= DARK_SHARE ? Math.min(score, 1) : 0;
}

/**
 * The backdrops to offer for a film, best first: [primary] (TMDB's own choice, a path) stays first unless it is mostly
 * black and another candidate is clearly less dark; the rest follow by darkness. [shares] maps a path to its black share
 * (a candidate with no share is unknown and never replaces a known primary). Returns { primary, alts }, alts up to [max].
 */
export function pickStills(primary, shares, max = 2) {
  const cand = Object.keys(shares ?? {});
  const known = (p) => typeof shares?.[p] === "number";
  const order = cand.filter((p) => p !== primary && known(p)).sort((a, b) => shares[a] - shares[b]);
  let first = primary;
  if (primary && known(primary) && shares[primary] >= DARK_SHARE) {
    const best = order[0];
    if (best && shares[best] <= shares[primary] - DARK_MARGIN) first = best;
  } else if (!primary && order.length) first = order[0];
  const rest = (primary && first !== primary ? [primary, ...order] : order).filter((p) => p !== first);
  rest.sort((a, b) => (shares[a] ?? 1) - (shares[b] ?? 1));
  return { primary: first, alts: rest.slice(0, max) };
}
