# Project State

## What this is
A personal, local-first film taste app. Each user runs their own instance: their ratings,
director progress, watchlist, and taste analysis live as JSON in `data/`, and the site is
the rendered view of that data. Nothing is published anywhere unless the user explicitly
chooses to. GitHub is version control, not distribution.

## Current Focus
- [ ] Live with the tool for a bit: log films through the UI, record old-film verdicts, note friction
- [ ] Letterboxd full-history import from CSV export (RSS only covers diary entries, and this account's feed is empty because films were logged without diary dates)

## Active Tasks
- [ ] Get a TMDB API key into `.env` and run `npm run enrich` once, so queue cards show where-to-watch
- [ ] Visual QA pass in a real browser (Claude's Chrome bridge couldn't reach localhost this session — even the user's own 4321 dev server was unreachable from it)

## Backlog
- [ ] Multi-user support: `profiles/<name>/data/` so one install can serve multiple people; config picks the active profile
- [ ] Individual taste accounts → auto-publish returns: once users have their own accounts/profiles, each account's page can build and publish automatically (per-user opt-in pages, Letterboxd-style). Pilot has explicitly OK'd autopublishing in that world — the current restriction only covers this single-user personal instance
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
- [x] 2026-07-23 — UI rework: report → tool. Client-rendered app with four tabs (Watch next / Films / Directors / Taste), search, sort, tier filters; "projection booth" design with sprocket-dot filmography meters (`ai/plans/ui-rework.md`)
- [x] 2026-07-23 — Logging layer shipped: local write API in serve.mjs (`api/ratings`, `api/watchlist[/remove]`, `api/oldfilms/verdict`) + in-page dialogs; logging a film auto-clears it from the queue; static exports degrade to read-only
