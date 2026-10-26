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
