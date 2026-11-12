// Watch queue vs log. A film is queued (data/watchlist.json, or tv-watchlist.json) until it is rated/logged
// (data/ratings.json, tv-ratings.json); rating a title removes it from the queue. Every writer of a rating file
// (the app's api/ratings and api/tv, the Letterboxd RSS sync, the export import) calls clearRatedFromQueue so the
// invariant "no title is in both files" has one owner. Queue ranks stay contiguous (1..n).
import { readJsonStrict, writeJsonAtomic } from "./atomic-json.mjs";
import path from "node:path";

export const sameFilm = (a, b) =>
  String(a.title).toLowerCase() === String(b.title).toLowerCase() && (!a.year || !b.year || Number(a.year) === Number(b.year));

export const renumber = (rows) => rows.sort((a, b) => a.rank - b.rank).forEach((w, i) => (w.rank = i + 1));

/** Pure: queue rows not in the log (renumbered) and the rows removed. */
export function dropRated(queue, log) {
  const rest = [], removed = [];
  for (const w of queue) (log.some((r) => sameFilm(w, r)) ? removed : rest).push(w);
  renumber(rest);
  return { rest, removed };
}

/** Rewrites the queue file only when something was removed. Returns the removed rows. */
export function clearRatedFromQueue(dataDir, { queue = "watchlist", log = "ratings", apply = true } = {}) {
  const queueFile = path.join(dataDir, `${queue}.json`);
  const logged = readJsonStrict(path.join(dataDir, `${log}.json`), []);
  const current = readJsonStrict(queueFile, []);
  const { rest, removed } = dropRated(current, logged);
  if (removed.length && apply) writeJsonAtomic(queueFile, rest);
  return removed;
}
