// Merges Letterboxd watchlists (the owner's first, then any extra profiles) into one entry per film for the TV row.
// A film is identified by its TMDB id (from enrichment), falling back to normalized title+year. Each entry keeps the
// first list's title/year and its best (lowest) position, and `lists` counts how many watchlists hold it.
// Films without a TMDB id, or already taken (skipIds / skipNames, e.g. hand-picked films), are left out.
export function mergeWatchlists(lists, { enrich, normTitle, skipIds = new Set(), skipNames = new Set() }) {
  const byKey = new Map();
  const nameKey = new Map(); // normalized title+year -> merged entry, so a title match joins an id match
  for (const items of lists) {
    const here = new Set(); // count a film once per list even if a list repeats it
    for (const w of items ?? []) {
      const e = enrich[`${w.title} (${w.year})`];
      const name = normTitle(w.title, w.year);
      if (!e?.tmdbId || skipIds.has(e.tmdbId) || skipNames.has(name)) continue;
      const entry = byKey.get(e.tmdbId) ?? nameKey.get(name);
      if (entry) {
        if (!here.has(entry)) { entry.lists++; here.add(entry); }
        entry.position = Math.min(entry.position, w.position ?? Infinity);
        continue;
      }
      const c = { title: w.title, year: w.year, tmdbId: e.tmdbId, e, position: w.position ?? Infinity, lists: 1 };
      byKey.set(e.tmdbId, c); nameKey.set(name, c); here.add(c);
    }
  }
  return [...byKey.values()];
}
