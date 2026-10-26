// Pure helpers for the Letterboxd fetch: RSS parser, public /films/ grid
// parser, challenge detection and the never-overwrite-with-empty rule.

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? m[1].trim() : null;
};

export function parseRss(xml) {
  const entries = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = tag(item, "letterboxd:filmTitle");
    if (!title) continue; // skip list items etc.
    const rating = tag(item, "letterboxd:memberRating");
    entries.push({
      title,
      year: Number(tag(item, "letterboxd:filmYear")) || null,
      rating: rating != null ? Number(rating) : null,
      rewatch: tag(item, "letterboxd:rewatch") === "Yes",
      watched: tag(item, "letterboxd:watchedDate"),
      link: tag(item, "link"),
    });
  }
  return entries;
}

// A Cloudflare interstitial ("Just a moment...") answers 403/503 with HTML.
export function isChallenge(status, body) {
  return status === 403 || status === 503 || /<title>\s*Just a moment/i.test(body ?? "");
}

// Parse one page of letterboxd.com/<user>/films/: one griditem per watched
// film, with the member's star rating (rated-N = N/2 stars) and like heart.
// These pages carry no dates, so every entry is flagged undated.
export function parseFilmsGrid(html) {
  const films = [];
  for (const block of html.split(/<li class="griditem">/).slice(1)) {
    const name = block.match(/data-item-name="([^"]*)"/)?.[1];
    if (!name) continue;
    const full = decode(name);
    const m = full.match(/^(.*)\s\((\d{4})\)$/);
    const rated = block.match(/class="rating[^"]*\brated-(\d+)"/)?.[1];
    const slug = block.match(/data-item-slug="([^"]*)"/)?.[1] ?? null;
    films.push({
      title: m ? m[1] : full,
      year: m ? Number(m[2]) : null,
      rating: rated ? Number(rated) / 2 : null,
      liked: /\bicon-liked\b/.test(block),
      rewatch: false,
      watched: null,
      undated: true,
      link: slug ? `https://letterboxd.com/film/${slug}/` : null,
    });
  }
  return films;
}

export function lastFilmsPage(html) {
  const pages = [...html.matchAll(/\/films\/page\/(\d+)\//g)].map((m) => Number(m[1]));
  return Math.max(1, ...pages);
}

// Never replace a non-empty previous result with an empty one.
export function chooseEntries(prev, next) {
  if (next.length) return { entries: next, kept: false };
  if (prev.length) return { entries: prev, kept: true };
  return { entries: [], kept: false };
}

const filmKey = (f) => `${f.title.toLowerCase()} (${f.year})`;

// Union by film+watched date (dated) or film (undated); newest data wins.
export function mergeEntries(prev, next) {
  const k = (e) => (e.watched ? `${filmKey(e)}|${e.watched}` : `${filmKey(e)}|undated`);
  const map = new Map(prev.map((e) => [k(e), e]));
  for (const e of next) {
    // a dated record supersedes an undated placeholder for the same film
    if (e.watched) map.delete(`${filmKey(e)}|undated`);
    if (!e.watched && [...map.keys()].some((x) => x.startsWith(`${filmKey(e)}|`) && !x.endsWith("|undated"))) {
      const dated = [...map.entries()].find(([x]) => x.startsWith(`${filmKey(e)}|`) && !x.endsWith("|undated"))[1];
      dated.liked ??= e.liked; // keep the like, drop the placeholder
      continue;
    }
    map.set(k(e), { ...map.get(k(e)), ...e });
  }
  return [...map.values()];
}

// ---- watched.json reconciliation (first-seen dating) ----------------------

export const normTitle = (s) =>
  String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const tyKey = (f) => `${normTitle(f.title)}|${f.year ?? ""}`;
const slugOf = (link) => String(link ?? "").match(/\/film\/([^/]+)\/?/)?.[1] ?? null;

// Today's date in America/Los_Angeles as YYYY-MM-DD.
export function laDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Add films that appear in the fetched entries but not in watched.json.
// Matching: Letterboxd URI/slug, else normalised title+year. A film that is
// already present is never touched (its date is kept); films missing from the
// fetch are never removed. Undated fetched entries are stamped with `today`
// and dateSource "first-seen"; dated entries (RSS) keep their own date.
// Returns { watched, added }.
export function addFirstSeen(watched, entries, today) {
  const out = [...watched];
  const uris = new Set(), slugs = new Set(), keys = new Set();
  for (const w of out) {
    if (w.uri) uris.add(w.uri);
    const s = slugOf(w.link ?? w.uri);
    if (s) slugs.add(s);
    keys.add(tyKey(w));
  }
  const added = [];
  for (const e of entries) {
    const s = slugOf(e.link);
    if ((e.link && uris.has(e.link)) || (s && slugs.has(s)) || keys.has(tyKey(e))) continue;
    const rec = e.watched
      ? { title: e.title, year: e.year, watched: e.watched }
      : { title: e.title, year: e.year, watched: today, dateSource: "first-seen" };
    if (s) rec.link = e.link;
    out.push(rec);
    if (s) slugs.add(s);
    keys.add(tyKey(e));
    added.push(rec);
  }
  return { watched: out, added };
}

// Combine an export's watched rows (real dates) with the current watched.json:
// export rows win; first-seen rows the export doesn't know yet are kept.
export function mergeExportWatched(current, exported) {
  const keys = new Set(exported.map(tyKey));
  const uris = new Set(exported.map((w) => w.uri).filter(Boolean));
  const keep = current.filter((w) => w.dateSource === "first-seen" && !keys.has(tyKey(w)) && !(w.uri && uris.has(w.uri)));
  return [...exported, ...keep];
}
