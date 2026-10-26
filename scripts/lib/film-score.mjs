// Scoring rules for the film recommender (scripts/suggest.mjs).
//
// A person's pull toward a candidate film = their taste affinity (built from the
// films you rated) x how much they actually shaped THIS film. The old model only
// looked at the role name, so one minor credit carried a person's full weight:
// a co-writer of an unrelated comedy outranked a Coen brothers sequel, one
// director of an 18-segment anthology counted as "wrote and directed this", and
// any billed actor pulled like a lead. The rules below fix that:
//
//  1. Role: director >> screenplay/writer >> story-type credits (story, novel,
//     characters), and lead cast (billing 1-3) > supporting cast.
//  2. Crowding: when a film credits many people in a role, each one's share is
//     divided by sqrt(count). Two directors = 0.71 each; an 18-director
//     omnibus = 0.24 each. Writers and actors crowd the same way.
//  3. Corroboration: a film with no director link, no theme match and fewer than
//     two independent person links is capped (UNCORROBORATED), so one writer or
//     one actor can never carry a film into the top half by themselves.
//  4. Quality prior: the film's own rating, shrunk toward the average by vote
//     count, scales the whole score. A weak film needs much stronger taste links.

export const CREDIT_FACTOR = {
  director: 1,
  writer: 0.45, // "Screenplay" / "Writer" only
  story: 0.12, // Story / Novel / Characters: an idea credit, not authorship of the film
  storyFavourite: 0.35, // ...unless the source is a film you rated 5 stars
  lead: 0.5, // billing order 1-3
  support: 0.15, // billing order 4+
};
export const STORY_JOBS = ["Story", "Novel", "Characters", "Book", "Short Story"];
export const WRITER_JOBS = ["Screenplay", "Writer"];
export const LEAD_ORDER = 2; // TMDB cast order is zero-based: 0,1,2 = billing 1-3
export const UNCORROBORATED = 0.4; // multiplier when nothing backs up a lone writer/actor link
export const LINK_MIN = 0.6; // a person link counts toward "two independent links" at this weight

// Crowding divisor for a role with `n` credited people on the film.
export const crowd = (n) => Math.sqrt(Math.max(1, n || 1));

// The factor for one person's best credit on one film.
// credits: Set/array of {kind, order?}; film.counts: {director, writer, cast};
// favourite: true when the person's strongest source film is rated 5 stars.
export function creditFactor(credits, counts = {}, favourite = false) {
  let best = 0;
  let kind = null;
  for (const c of credits) {
    let f;
    if (c.kind === "director") f = CREDIT_FACTOR.director / crowd(counts.director);
    else if (c.kind === "writer") f = CREDIT_FACTOR.writer / crowd(counts.writer);
    else if (c.kind === "story") f = (favourite ? CREDIT_FACTOR.storyFavourite : CREDIT_FACTOR.story) / crowd(counts.writer);
    else f = ((c.order ?? 99) <= LEAD_ORDER ? CREDIT_FACTOR.lead : CREDIT_FACTOR.support);
    if (f > best) {
      best = f;
      kind = c.kind;
    }
  }
  return { factor: best, kind };
}

// Rating shrunk toward the prior mean: few votes -> trust the prior, many -> the rating.
export const SHRINK_VOTES = 800;
export const PRIOR_MEAN = 6.4;
export const shrunkRating = (rating, votes) => {
  const v = Math.max(0, Number(votes) || 0);
  return (v * (Number(rating) || 0) + SHRINK_VOTES * PRIOR_MEAN) / (v + SHRINK_VOTES);
};
// 1.0 at a 6.9 shrunk rating; ~0.6 for a 6.2, ~1.2 for an 8. Clamped so a great
// film can't be rescued from zero taste links, nor a weak one erased by quality alone.
export const qualityMultiplier = (rating, votes) =>
  Math.min(1.2, Math.max(0.4, 1 + (shrunkRating(rating, votes) - 6.9) * 0.55));

// Score one candidate.
// contributors: [{ weight (person affinity), credits:[{kind, order}], favourite }]
// film: { tmdbRating, votes, counts:{director, writer, cast}, themeScore }
// Returns { score, links:[{index, weight, factor, kind}], corroborated }.
export function scoreFilm(contributors, film) {
  const links = contributors
    .map((c, index) => {
      const { factor, kind } = creditFactor(c.credits, film.counts, c.favourite);
      return { index, kind, factor, weight: c.weight * factor };
    })
    .filter((l) => l.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const raw = links.reduce((s, l) => s + l.weight, 0);
  const hasDirector = links.some((l) => l.kind === "director" && l.factor >= 0.5);
  const hasTheme = (film.themeScore ?? 0) > 0;
  const independent = links.filter((l) => l.weight >= LINK_MIN).length;
  const corroborated = hasDirector || hasTheme || independent >= 2;
  const score = raw * qualityMultiplier(film.tmdbRating, film.votes) * (corroborated ? 1 : UNCORROBORATED);
  return { score, links, corroborated };
}

// What the person did on this film, in words that stay true for anthologies.
export function describeCredit(kind, credits, counts = {}) {
  const has = (k) => credits.some((c) => c.kind === k);
  const anthology = (counts.director ?? 1) >= 4;
  if (kind === "director") {
    if (anthology) return "directed a segment of this";
    if ((counts.director ?? 1) > 1) return has("writer") ? "co-wrote and co-directed this" : "co-directed this";
    return has("writer") || has("story") ? "wrote and directed this" : "directed this";
  }
  if (kind === "writer") return anthology ? "wrote a segment of this" : (counts.writer ?? 1) > 1 ? "co-wrote this" : "wrote this";
  if (kind === "story") return "has a story credit here";
  const lead = credits.some((c) => c.kind === "actor" && (c.order ?? 99) <= LEAD_ORDER);
  return lead ? "stars in this" : "appears in this";
}
