// Strict TMDB movie matching shared by the enrichment scripts.
// Rules: the release year must match (±1 for festival vs release year), and an
// exact normalised title match beats a popularity-ranked partial one.

export const normTitle = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, "");

export const yearOf = (r) => Number((r.release_date ?? "").slice(0, 4)) || null;

export const yearOk = (r, year, tol = 1) => {
  const y = yearOf(r);
  return y != null && Math.abs(y - year) <= tol;
};

// results: merged TMDB search results. Returns the best result or null.
export function pickMatch(results, title, year) {
  const want = normTitle(title);
  const cands = (results ?? []).filter((r) => yearOk(r, year));
  const names = (r) => [r.title, r.original_title].map(normTitle);
  const rank = (r) => (yearOf(r) === year ? 0 : 1);
  const byPop = (a, b) => rank(a) - rank(b) || (b.popularity ?? 0) - (a.popularity ?? 0);
  const exact = cands.filter((r) => names(r).includes(want)).sort(byPop);
  if (exact.length) return exact[0];
  // partial: one title wholly contains the other (subtitle / alt-title cases)
  const partial = cands
    .filter((r) => names(r).some((n) => n && want && (n.startsWith(want) || want.startsWith(n))))
    .sort(byPop);
  return partial[0] ?? null;
}

// Search with and without the year filter and merge, de-duplicated by id.
export async function searchMovie(tmdb, title, year) {
  const seen = new Map();
  for (const params of [{ query: title, year }, { query: title }]) {
    const res = await tmdb("/search/movie", params);
    for (const r of res.results ?? []) if (!seen.has(r.id)) seen.set(r.id, r);
  }
  return [...seen.values()];
}
