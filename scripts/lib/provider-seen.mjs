// Daily provider diff behind the TV's "New on <app>" signal. data/tv-provider-seen.json maps tmdbId -> { provider: first date | null }.
// A film seen for the first time is baselined (null): it was already there, we just did not know. A provider that appears
// for an already-tracked film gets today's date; one that disappears is forgotten, so a return counts as new again.
export const streamingOf = (p = {}) => [...new Set([...(p.flatrate ?? []), ...(p.free ?? [])].filter((x) => typeof x === "string" && x))];

export function updateSeen(seen, films, today) {
  const next = {};
  for (const [id, providers] of Object.entries(films)) {
    const names = streamingOf(providers);
    if (!names.length) continue;
    const prev = seen?.[id];
    next[id] = Object.fromEntries(names.map((n) => [n, prev ? (n in prev ? prev[n] : today) : null]));
  }
  return next;
}

/** Latest first-seen date among `names` (provider names mapped to apps), with the name; undefined when none is dated. */
export function newestSince(entry, names) {
  let best;
  for (const n of names) {
    const d = entry?.[n];
    if (d && (!best || d > best.date)) best = { date: d, name: n };
  }
  return best;
}
