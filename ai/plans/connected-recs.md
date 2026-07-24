# Connected recs — architecture

Synthesis of the TV, Books, Themes, and Graph specs. Where they conflicted, the rulings are: **display-keyed stores win over canonical-keyed stores** (the graph spec's id-keyed `tv.json`/`books.json` is over-engineering; ids become *fields*, the graph layer alone keys by them); **one curated theme file** (`theme-map.json`) replaces the three competing theme/subject files; **each vertical's suggest script stays self-contained until Phase 4**; the graph's chains/edges survive but capped and offline. Zero npm deps, single-JSON-file store, static-degradable, free APIs only — every ruling below defers to those.

## The entity model (shared across all media)

**Canonical ids are fields, not keys.** Every enrichment entry carries an `id`; hand-edited and per-medium files keep legible display keys; only generated graph files (`people.json`, `connections.json`, Phase 4) key by canonical id.

| Kind | id | Store key | Log file | Enrichment file |
|---|---|---|---|---|
| Film | `m:{tmdbId}` | `"Title (Year)"` | `ratings.json` / `watched.json` / `watchlist.json` (unchanged) | `enrichment.json` (unchanged, +`id`, +`keywords`) |
| TV | `t:{tmdbId}` | `"Title (Year)"` (first-air year) | `tv-ratings.json`, `tv-watchlist.json` | `tv-enrichment.json` |
| Book | `b:{olWorkId}` | `"Title (Author)"` | `books.json` (one file, `status` field) | `book-enrichment.json` |

**People.** TMDB person ids bridge film↔TV for free (shared id space). Books use Open Library author keys. Canonical forms `p:tmdb:{id}` / `p:ol:{key}` exist only inside Phase-4 graph files; `data/people-links.json` (hand-edited, `[{ "tmdbId": 6384, "olId": "OL2162284A" }]`) merges the two, with auto-link candidates proposed (never auto-applied) when names match across a confirmed adaptation edge.

**Role weights** (one table, all engines):

```
film director 1.6 · tv creator 1.6 · book author 1.4 · writer 1.1
tv episode-director 0.7 · tv actor 0.6 · film actor 0.5
```

Affinity contribution per rated item ≥ 4★: `(score − 3) × roleWeight` (4→1, 4.5→1.5, 5→2), the existing `suggest.mjs` formula.

**Themes.** One curated vocabulary in `data/theme-map.json` (hand-edited, LLM-seeded, scripts never write it). Each theme maps to media-native tag names — TMDB keyword names now, OL subject strings in Phase 3 — by **exact match on lowercased trimmed name**. Theme ids are the cross-media join key. Per-item `assign`/`suppress` overrides live in the same file, keyed by display key with a medium prefix (`"The Prestige (2006)"` = film; `"tv:…"`, `"book:Title (Author)"`).

**Adaptations.** Directed edges book→screen in `data/adaptations.json`: `status: "confirmed"` edges are truth; `"candidate"` edges await one-click review; a `rejected` list stops resurrection. Discovery is Wikidata-primary (P144), OMDb-fallback, TMDB-keyword-818-flag last.

**Pipeline order** (daily Action + local): `sync → import → enrich → enrich:tv → enrich:books → themes → bridge → stats → suggest → suggest:tv → suggest:books → connect → build`. Every script tolerates missing upstream files. `build.mjs` unchanged (copies `data/` wholesale) — **but graph/theme files are taste claims: confirm with the user before they ship to the public site** (standing opt-in preference); if excluded, add an allowlist to `build.mjs`.

---

## Phase 1: Themes (implement now — self-contained, films-only, feeds suggestions)

### 1a. `scripts/enrich-tmdb.mjs` — modify

1. Line 73: `append_to_response: "credits,watch/providers,keywords"`. In the entry object add:
   ```js
   id: `m:${match.id}`,
   keywords: detail.keywords?.keywords?.map((k) => ({ id: k.id, name: k.name })) ?? [],
   ```
   (Movies nest under `.keywords.keywords`; TV uses `.results` — don't copy this line into Phase 2.)
2. **Backfill pass**, same shape as the OMDb second pass (lines 100–128): for every entry where `entry.keywords === undefined`, `GET /movie/{tmdbId}/keywords`, store mapped array (empty array when none, so it's never refetched), set `entry.id = \`m:${entry.tmdbId}\``, 120 ms pause. ~362 calls once, then incremental. Presence of the `keywords` array is the schema marker (same trick as `writers`).

### 1b. `data/theme-map.json` — hand-curated, NEW

```json
{
  "updated": "2026-07-24",
  "themes": [
    { "id": "doubling", "name": "Doubling & doppelgangers", "core": true,
      "note": "Twins, clones, dual roles, the self met from outside.",
      "keywords": ["doppelganger", "twins", "twin brother", "twin sister", "dual role", "clone", "lookalike", "alter ego", "body double", "identity swap", "evil twin"] },
    { "id": "unravelling", "name": "Coming apart (with a landing)", "core": true,
      "keywords": ["mental breakdown", "descent into madness", "paranoia", "psychological breakdown", "nervous breakdown", "delusion", "unreliable narrator"] },
    { "id": "identity", "name": "Impostors & stolen selves", "core": true,
      "keywords": ["mistaken identity", "impostor", "false identity", "assumed identity", "split personality", "amnesia"] },
    { "id": "cruel-comedy", "name": "Comedy that's actually cruel", "core": false,
      "keywords": ["black comedy", "satire", "dark comedy", "humiliation", "social satire", "class satire"] },
    { "id": "metaphysical", "name": "Big metaphysical swings", "core": false,
      "keywords": ["existentialism", "nature of reality", "simulated reality", "afterlife", "immortality", "meaning of life"] },
    { "id": "body-horror", "name": "The body betrays", "core": false,
      "keywords": ["body horror", "transformation", "mutation", "medical experiment", "parasite"] },
    { "id": "surveillance", "name": "Watched & watching", "core": false,
      "keywords": ["surveillance", "voyeurism", "hidden camera", "stalking", "wiretapping", "peeping tom"] },
    { "id": "grief-horror", "name": "Grief wearing a mask", "core": false,
      "keywords": ["grief", "loss of child", "mourning", "family curse", "inherited trauma", "cult"] }
  ],
  "ignore": ["based on novel or book", "based on true story", "duringcreditsstinger", "aftercreditsstinger", "woman director", "biography", "remake", "sequel", "independent film", "new york city", "los angeles, california"],
  "assign": { "The Prestige (2006)": ["doubling"] },
  "suppress": {}
}
```

Rules: exact lowercase-name matching only (no fuzzy — variants are enumerated; cheap because curation only maps keywords that occur in the corpus). `core: true` = the taste spine, headlined in the UI and 2× edge weight in Phase 4. Forward-compatible: each theme later gains optional `"subjects": []` (OL) without breaking anything. Seed is a **draft — user reviews before committing** (themes are taste claims). Curation ritual: `npm run enrich` → `node scripts/themes.mjs --unmapped` → paste dump + `profile.json` into a Claude session → Claude edits `theme-map.json` → `npm run themes`.

### 1c. `scripts/themes.mjs` — NEW, `npm run themes`

Deterministic, **zero network calls**, CI-safe, ~100 lines in house style. Reads `ratings.json`, `watched.json`, `old-films.json`, `enrichment.json`, `theme-map.json`; writes `data/themes.json`:

```json
{
  "generated": "2026-07-24T12:00:00.000Z",
  "basedOn": { "loved": 27, "seenWithKeywords": 344, "filmsEnriched": 362 },
  "themes": [
    { "id": "doubling", "name": "Doubling & doppelgangers", "core": true,
      "affinity": 9.5, "affinityNorm": 1.0,
      "lovedCount": 9, "lovedShare": 0.33, "seenCount": 24, "seenShare": 0.07, "tilt": 0.26,
      "lovedFilms": [{ "title": "The Prestige", "year": 2006, "score": 4.5, "matched": ["twins", "dual role"] }],
      "keywordIds": [10714, 4552], "keywordHits": { "twins": 4 } }
  ],
  "emergent": [
    { "keyword": "time loop", "id": 4562, "lovedCount": 3, "seenCount": 4, "tilt": 0.10,
      "films": ["Predestination (2014)", "Triangle (2009)", "Coherence (2013)"] }
  ],
  "coverage": { "filmsWithKeywords": 344, "filmsWithoutKeywords": 18, "distinctKeywords": 1240, "mappedKeywords": 96, "unmappedSeenTwicePlus": 210 }
}
```

Definitions: a film **expresses a theme** iff ≥1 keyword name matches (binary per film; `matched` records which) **or** the display key is in `assign`, minus `suppress`. `affinity` = Σ over 4★+ films expressing it of `(score − 3)`. `affinityNorm` = affinity / max affinity. `lovedShare`/`seenShare`/`tilt` mirror `genreTilt` in `stats.json`. `emergent` = unmapped non-ignored keywords in ≥2 loved films, sorted lovedCount desc then tilt, cap 25. `--unmapped` flag: skip writing, print `count<TAB>keyword<TAB>up to 3 example films` for curation. Add `"themes": "node scripts/themes.mjs"` to `package.json`; Action order `… enrich → themes → stats → suggest → build`.

### 1d. `scripts/suggest.mjs` — modify

Load `themes.json` + `theme-map.json` via `read()` with fallbacks; degrade to people-only when absent. After building `candidates` (line ~130): take the top 40 by provisional `score * 2 + tmdbRating / 2`, fetch `GET /movie/{id}/keywords` each (120 ms pause), then:

```js
const themeWeight = new Map(themesData.themes.map((t) => [t.id, t.affinityNorm])); // 0..1
const kwToTheme = new Map(); // lowercase keyword name -> theme id, from theme-map
const themeScoreOf = (keywords) => {
  const hit = new Set();
  for (const k of keywords) { const t = kwToTheme.get(k.name.toLowerCase()); if (t) hit.add(t); }
  return { score: Math.min([...hit].reduce((s, t) => s + (themeWeight.get(t) ?? 0), 0), 2), themes: [...hit] };
};
const THEME_BLEND = 3;
// line 135 becomes: rankScore = c.score * 2 + c.themeScore * THEME_BLEND + c.tmdbRating / 2
```

Calibration: people term spans ~4–26; theme term maxes at 6 — themes reorder the middle and break ties but never outrank a strong person connection. Output changes per item: `"themes": ["doubling"]` (matched ids) and `why` gains `· themes: doubling, the body betrays` (names) when they contributed.

**Theme wildcards:** after the 12 are ranked, for the top 3 themes by `affinity`: `GET /discover/movie?with_keywords={keywordIds joined "|"}&sort_by=vote_average.desc&vote_count.gte=300&include_adult=false` (one call each, ids from `themes.json`); filter `seen` + already-ranked; best 1 per theme; flesh out via the existing loop; emit as separate `"themePicks": [...]` (theme id + `why: "doubling — the thread through 9 of your loved films"`), max 3, kept out of `items` so the people list stays honest.

### 1e. UI — `templates/app.js` + `style.css`

- **`loadAll()`** (line 32 area): `state.data.themes = await optional("themes", null)`, `state.data.themeMap = await optional("theme-map", null)`. Then build `state.kwTheme` (Map lowercased keyword → themeId), `state.themeName` (Map id → name), and apply `assign`/`suppress` in the helper below.
- **Helper next to `enrichFor` (line 61):** `themesFor(film)` — derive theme ids client-side from `enrichFor(film)?.keywords` + `state.kwTheme` + assign/suppress. No duplication; editing the map updates chips with no regeneration.
- **Taste tab:** new `themesSection()` called in `renderTaste()` directly after `computedSection()` (line 419). Two cards in the existing `.grid2`/`.statrow`/`.bar` idiom (lines 371–392): "Named themes — where 4★+ over-indexes" (one row per theme, sorted tilt desc, bar = lovedShare, val = `"9 loved · 7% seen"`, each row wrapped in native `<details>` listing `lovedFilms` with matched keywords — degrades statically); "Emerging — unmapped keywords in loved films" (plain `emergent` list + `.lede` footer pointing at the curation ritual). Show `themes.generated` freshness like the `stale` pattern.
- **Films tab (`renderFilms`)**: theme chips `<span class="tchip">` after the `.facts` div in each `.frow`; a second `.fchip` row after the tier chips driving new `state.filmTheme` (default `"all"`, filter `themesFor(f).includes(state.filmTheme)`), wired exactly like lines 321–326.
- **Watch tab (`renderWatch`)**: render `s.themes` as `.tchip`s in suggestion `.meta` lines (data straight from suggestions.json); new `<h2 class="sect">From the themes</h2>` section after `suggSection` rendering `themePicks` with the `qcard sugg` markup, rank cell `~`, omitted when empty.
- **`style.css`** — one class, tungsten idiom:
  ```css
  .tchip { display:inline-block; font:500 11px var(--mono); padding:1px 7px; margin-right:4px;
           border:1px solid var(--tung-dim); border-radius:9px; color:var(--tung); opacity:.85; }
  ```

---

## Phase 2: TV

Separate files, series-level ratings, new tab — the TV spec stands, with two graph-conformance edits: entries carry `id: "t:{tmdbId}"`, and `keywords` ships day one.

**`data/tv-ratings.json`** (array): `{ title, year (first-air), creator, score (0.5–5|null), status: "watching"|"finished"|"abandoned", seasonsWatched?, note?, seasons?: [{season, note}] }`. Abandoned = kept in seen-set, excluded from affinity. **`data/tv-watchlist.json`**: watchlist shape with `creator` for `director`.

**`data/tv-enrichment.json`** keyed `"Title (Year)"`: `{ id: "t:54344", tmdbId, imdbId, creators: [{id,name}], writers/directors/cast: [{id,name,episodes}], seasons, episodes, episodeRuntime, showStatus, firstAir, lastAir, genres, keywords: [{id,name}], tmdbRating, poster, providers, providersLink, region, scores }`.

**`scripts/enrich-tv.mjs`** (`npm run enrich:tv`): clone of enrich-tmdb.mjs. `GET /search/tv?query&first_air_date_year`, then `GET /tv/{id}?append_to_response=aggregate_credits,keywords,external_ids,watch/providers`. Gotchas: `imdbId` from `external_ids.imdb_id`; keywords under `.keywords.results`; writers = crew with any job in {Writer, Story, Teleplay} (summed `episode_count`, top 5); directors likewise; cast = top 8 by `total_episode_count`; `episodeRuntime = episode_run_time[0] ?? last_episode_to_air?.runtime ?? null`. OMDb pass identical (metacritic usually null for TV — renderers already skip nulls).

**`scripts/suggest-tv.mjs`** (`npm run suggest:tv`): suggest.mjs skeleton. Affinity from **both** stores — film side exactly as today, TV side with the unified weight table (creator 1.6 / writer 1.1 / tv-director 0.7 / tv-actor 0.6), counting writers/directors only at `episodes ≥ 25%` of show total, top-5 cast, skipping `abandoned`. Candidates via `GET /person/{id}/tv_credits`: crew jobs {Creator, Writer, Teleplay, Story} always, Director only for director-affinity people, Executive Producer **only** for creator-affinity people (showrunners hide there); cast requires `episode_count >= 6`; filters: aired, `vote_count >= 100`, drop genre ids {10767, 10763, 10764, 10762} (talk/news/reality/kids); seen-set = tv-ratings + tv-watchlist. Same rank formula, `PER_PERSON_CAP = 2`, take 10; flesh out via `GET /tv/{id}?append_to_response=external_ids,watch/providers`; themes applied to TV via the same `theme-map.json` once keywords exist. Output `tv-suggestions.json`, same envelope, `why` may cite film evidence ("Damon Lindelof (created The Leftovers 4.5★, wrote Prometheus 4★)"). Follow-up one-liner: film `suggest.mjs` gains the TV-side affinity loop so a loved series surfaces its creator's films.

**`serve.mjs`**: three handlers mirroring existing ones — `api/tv` (upsert tv-ratings; validates status; removes from tv-watchlist + re-ranks), `api/tv-watchlist`, `api/tv-watchlist/remove`. Static deploys 404 → read-only, no new code path.

**UI**: fifth tab `TV` between Films and Directors; `renderTV()` with four sections — Watching now (progress "S2 of 3", Finished/Abandon buttons), Up next (ranked queue cards), Suggested (film-suggestion layout + "3 seasons · ~60 min/ep · Ended" meta), Series log (Films-style table with status chip). Log dialog gains a Film/TV radio + TV-only fieldset (status select, seasonsWatched), director label swaps to "Creator". Header gains "N series" when nonzero. Directors tab: "Also on TV" line when a director's TMDB person id appears in tv-enrichment `creators`/`directors`.

**Trakt import** (`scripts/import-trakt.mjs`, optional): device-code OAuth, `GET /sync/watched/shows` + `/sync/ratings/shows`, score = rating/2, upsert never clobbering manual notes. Only build if the user actually has Trakt history.

## Phase 3: Books

**`data/books.json`** (array, one file — log + shelf + queue via `status`): `{ title, author, year (orig. publication), status: "read"|"reading"|"toread", score (integers arrive from Goodreads; user refines), read (date|null), note?, isbn13?, rank (toread only), why? }`. Identity everywhere: lowercased title+author.

**`data/book-enrichment.json`** keyed `"Title (Author)"`: `{ id: "b:OL2919624W", olWork, authors: [{key, name}], firstPublished, pages, subjects (first 12), coverId, cover, description (~600 chars; handle string|{value}), editionCount, olRating: {average, count}, adaptedAs: [], unmatched? }`. OL work-id ambiguity rule: **highest edition count wins**.

**Open Library etiquette** (all scripts): `User-Agent: taste/0.1 (adamnodded@gmail.com)`, 500–1100 ms pauses, no key. Endpoints: `search.json?title&author&limit=5&fields=key,title,author_key,author_name,first_publish_year,cover_i,edition_count,number_of_pages_median,subject,ratings_average,ratings_count` (also `?author_key=…&sort=rating&limit=30` for author shelves and `?subject={slug}&sort=rating&limit=30` for themes — one parse path for all candidate lists); `/works/{OLID}.json` for detail; covers via `covers.openlibrary.org/b/id/{cover_i}-M.jpg` (id-based only — ISBN covers are rate-limited).

**Scripts**: `scripts/lib/csv.mjs` (extract `parseCsv` from import-letterboxd.mjs, both import); `import-goodreads.mjs` (`import:books` — column mapping per Books spec: Exclusive Shelf→status, `My Rating` 0→null, strip `="…"` ISBNs and series parentheticals; merge never touches existing entries); `enrich-books.mjs` (`enrich:books` — resolve gaps + `unmatched` retries + unread bridge books); `suggest-books.mjs` (`suggest:books` — **works with zero rated books**: signals = ① unread confirmed-adaptation books of 4★+ films at `(filmScore−3)×1.4`, bypassing popularity gates; ② author affinity (rated-book authors ×1.4… wait — author weight 1.4 per the unified table — plus adaptation authors ×0.8 and adjacent authors ×0.4); ③ theme `subjects` arrays from theme-map themes (added in this phase); ④ genre→subject map (top-level `"genreMap"` in theme-map.json, weights computed from film genre affinity ×0.7). Gates: `ratings_count ≥ 15` or `edition_count ≥ 8`; `rankScore = weightSum×2 + (ratings_average ?? min(4, 1 + log2(editionCount)/2))`; PER_AUTHOR_CAP 2; output 12).

**`scripts/bridge-adaptations.mjs`** (`npm run bridge`) writes `data/adaptations.json` (graph shape, Wikidata-primary discovery): `{ generated, edges: [{ book: {title, author, olWork, wikidata}, screen: "No Country for Old Men (2007)", screenId: "m:6977", status: "confirmed"|"candidate", confidence?, source: "wikidata"|"omdb"|"manual", evidence?, read: false }], rejected: [], flaggedOnly: [], adjacentAuthors: [{ name, wikidata, olKey, adaptedBy: [{director, films}], weight }] }`. Pass order: ① one bulk SPARQL to `query.wikidata.org/sparql` — `VALUES ?imdb {…}` over all enriched imdbIds, `wdt:P345/P144/P50`, `OPTIONAL P648` (OL id for free) — auto-`confirmed` (P50 requirement filters remake noise); ② OMDb `Writer`-field parse for unresolved 4★+ films → `candidate`; ③ TMDB keyword 818 present but unresolved → `flaggedOnly`; ④ adjacent authors via P4985 (TMDB person id) → P57 → P144 → P50 for top-10 affinity directors. Recompute `read` flags and back-fill `adaptedAs` each run. Candidates/flagged get a review queue in the UI (Confirm/Reject via new `api/adaptations` handler; hidden on static deploys).

**UI**: sixth tab `Books` — Read next (toread queue + suggestions; cover in the poster slot, subjects as chips), Shelf (read/reading, `stars()`), The bridge (adaptation rows "**Film** 4.5★ ← *Book*, Author" + unread badge + "Shelve the book"; flaggedOnly under "based on a book — help me identify it"; adjacentAuthors chip row). `openBookLogDialog` clone; film cards in `renderWatch`/`renderFilms` get a `novel by Cormac McCarthy · unread` badge when a confirmed edge exists. CSS: `.book-cover { aspect-ratio: 2/3 }`, `.badge-adaptation`.

## Phase 4: Cross-media surfacing

**`scripts/connect.mjs`** — offline, keyless, no network; skips missing stores (each vertical ships standalone). Reads all logs/enrichments + theme-map + themes + adaptations + people-links; writes:

- **`data/people.json`** (generated): `{ "p:tmdb:21684": { name, tmdbId, olId, roles: {directed, wrote, acted, created, authored: [itemIds]}, affinity, affinityWhy } }` — the shared affinity registry; suggest scripts switch to reading it here (behavior-identical for films, unifies numbers across media).
- **`data/connections.json`** (generated): `nodes` (id → `{kind, title, year, image, status, score, themes}`), `edges` (id → top-8 by weight, symmetric: person edges `roleWeight(a)×roleWeight(b)×(1+affinity/4)`, actor–actor only when affinity ≥ 1; adaptation edges fixed 5.0, always kept; theme edges 1.0 / 2.0 for `core`, only where no person/adaptation edge exists and one endpoint is unseen or 4★+), and `chains` (seeds = 4.5★+, 2-hop walks to unseen targets, dedupe, exclude queued, top 12).
- stdout curation report: unmapped keywords/subjects among 4★+ items, person-link candidates.

**UI**: `connStrip(id)` component — up to 3 edge chips (glyphs `◆` film `▤` book `▣` tv) under queue/suggestion/rated cards, clicking opens `#conn-dialog` (full edge list grouped People / Adaptation / Threads, targets show seen/rated/queued/unseen + queue-add when `canWrite`). Taste tab gains **Threads** (each `core` theme as a cross-media scroller, seen items dimmed with stars, unseen bright with availability) and **Because you loved…** (chains as sentences with queue-add, cap 6 + "show more"). Cross-media suggestions stay in **separate sections per medium** — scores aren't commensurable; interleaving happens only in chains, strips, and adaptation footnotes on suggestion cards.

## Open questions for the user

1. **Theme seed sign-off** — the `theme-map.json` draft encodes taste claims; review/edit before first commit? (Assumed yes.)
2. **Public site scope** — should `themes.json`, `theme-map.json`, and later `people.json`/`connections.json` ship to the public static site, or stay local via a `build.mjs` allowlist? Default: excluded until you say otherwise.
3. **3.5★ films** — exposure-only (current spec) or mild affinity (0.25)? Recommend keeping 4+ until the corpus grows.
4. **Watched-but-unrated prior** — should the 331 unscored Letterboxd imports contribute a small positive prior (e.g. 0.2 × roleWeight) to people affinity? Currently no.
5. **TV import** — do you have history on Trakt or IMDb? If neither, `import-trakt.mjs` is cut entirely.
6. **Goodreads score precision** — flag imported integer scores (`scoreSource: "goodreads"`) so profile prose can discount them?
7. **Short-story adaptations** (Arrival ← "Story of Your Life") — resolve to the containing collection when the standalone work has `edition_count < 2`?
8. **Cross-medium profile prose** — rewrite `profile.json`/`calibration.json` only after ~15 rated series / 10 rated books, as a deliberate ritual? (Assumed yes; nothing automatic.)
9. **Tuning debts, post-first-run** — `THEME_BLEND = 3` and the theme cap; TV `vote_count ≥ 100` and actor `episode_count ≥ 6`; actor-edge affinity ≥ 1 gate. All flagged for one calibration pass each, not user decisions up front.
