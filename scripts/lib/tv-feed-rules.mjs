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

// ---- mostly black stills (net/Dark.kt)
export const DARK_LUMA = 24;     // pixels at or under this luma (0..255) are black
export const DARK_SHARE = 0.30;  // more than this share of black pixels makes a still "mostly black"
export const DARK_MARGIN = 0.05; // an alternative must beat the first still by this much

/** Share (0..1) of RGBA pixels in [data] whose luma is at most DARK_LUMA. */
export function darkShare(data) {
  const n = data.length >> 2;
  if (!n) return 0;
  let k = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 <= DARK_LUMA) k++;
  return k / n;
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
  if (primary && known(primary) && shares[primary] > DARK_SHARE) {
    const best = order[0];
    if (best && shares[best] <= shares[primary] - DARK_MARGIN) first = best;
  } else if (!primary && order.length) first = order[0];
  const rest = (primary && first !== primary ? [primary, ...order] : order).filter((p) => p !== first);
  rest.sort((a, b) => (shares[a] ?? 1) - (shares[b] ?? 1));
  return { primary: first, alts: rest.slice(0, max) };
}
