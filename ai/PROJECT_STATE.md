# Project State

## What this is
A personal, local-first film taste app. Each user runs their own instance: their ratings,
director progress, watchlist, and taste analysis live as JSON in `data/`, and the site is
the rendered view of that data. Nothing is published anywhere unless the user explicitly
chooses to. GitHub is version control, not distribution.

## Current Focus
- [x] Local-first workflow: `npm start` serves the site locally and rebuilds on data edits
- [ ] Decide the shape of the logging layer: how a user *adds* a film/rating without hand-editing JSON (tiny local write server vs. CLI vs. edit-in-page)

## Active Tasks
- [ ] Letterboxd full-history import from CSV export (RSS only covers diary entries, and this account's feed is empty because films were logged without diary dates)
- [ ] Get a TMDB API key into `.env` and run `npm run enrich` once, so watchlist entries show where-to-watch

## Backlog
- [ ] Logging UI: local page/form that appends to `data/ratings.json` (turns this from a rendered document into an actual logger)
- [ ] Multi-user support: `profiles/<name>/data/` so one install can serve multiple people; config picks the active profile
- [ ] Reconcile Letterboxd sync into `data/ratings.json` automatically instead of just flagging new ratings
- [ ] Auto-update director completion counts from TMDB filmographies (directors.json is hand-maintained today)
- [ ] Critic scores via free OMDb API (Rotten Tomatoes / Metacritic numbers)
- [ ] Derive the "shape" stats (counts, tiers) into visualizations
- [ ] Two-way Letterboxd: push watchlist changes back (no public API — investigate what's feasible)
- [ ] `scripts/verify.sh` quality gate (build succeeds + JSON schema check on data files)

## Completed
- [x] 2026-07-23 — Extracted the hand-made HTML/xlsx profile into separated JSON data files (`data/`)
- [x] 2026-07-23 — Zero-dependency build script (`scripts/build.mjs` → `dist/index.html`)
- [x] 2026-07-23 — Letterboxd RSS fetcher (`scripts/fetch-letterboxd.mjs`), flags ratings missing from data
- [x] 2026-07-23 — TMDB enricher (`scripts/enrich-tmdb.mjs`): credits, runtime, where-to-watch providers
- [x] 2026-07-23 — GitHub repo created (carlitoswillis/taste); Pages deploy tried, then rolled back — this is personal. Deploy workflow now manual-only; repo private
- [x] 2026-07-23 — Local dev server with watch + rebuild (`scripts/serve.mjs`, `npm start`)
