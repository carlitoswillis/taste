# Architecture

PURPOSE: Technical system design and data flow of the taste application.

## Overview
A local tool over personal film data. The page is a client-rendered app (watch queue, film
log, director runs, taste analysis) that reads `data/*.json` and writes back through a small
local API. No database, no framework, no npm dependencies — the filesystem is the database
and git is the history.

## System Components

### 1. Data layer (`config.json`, `data/`)
- `config.json` — instance identity: Letterboxd username, region, site title, headline stats.
- `data/*.json` — the user's content: `ratings`, `directors` (with `seen`/`remaining` for the
  sprocket meters), `watchlist`, `lineage`, `cohorts`, `old-films` (with a `verdict` field),
  `calibration`, `profile` (prose).
- Generated files: `data/letterboxd.json` (RSS sync), `data/enrichment.json` (TMDB metadata
  and watch providers, keyed `"Title (Year)"`). Safe to delete; scripts regenerate them.

### 2. App shell (`templates/`)
`index.html` + `app.js` (ES module) + `style.css`. Four tabs — Watch next, Films, Directors,
Taste — rendered client-side from fetched JSON, with search, sort, and tier filters. Logging
dialogs post to the API; on page load the app probes `api/health` and falls back to read-only
(no log buttons) when the API is absent, e.g. on a static export. Design: "projection booth"
tungsten-dark, Futura/Avenir/SF Mono system faces, sprocket-dot filmography meters
(see `ai/plans/ui-rework.md`).

### 3. Local server (`scripts/serve.mjs`, `npm start`, port 4747)
Zero-dep, binds 127.0.0.1 only. Serves the shell from `templates/`, data live from `data/`,
and the write API:
- `POST api/ratings` — upsert a log entry; also removes that film from the watchlist and
  re-ranks it
- `POST api/watchlist` / `api/watchlist/remove` — queue management
- `POST api/oldfilms/verdict` — record a verdict on an on-trial film
- `GET api/health` — write-capability probe

### 4. Static export (`scripts/build.mjs`)
Copies the shell plus a data snapshot into `dist/`. Only needed for a deliberate static
deploy; the result is read-only.

### 4. Sync scripts
- `scripts/fetch-letterboxd.mjs` — pulls the public per-account RSS feed (diary entries and
  reviews only, ~50 most recent), writes `data/letterboxd.json`, and prints rated films not
  yet present in `data/ratings.json`.
- `scripts/enrich-tmdb.mjs` — TMDB search + credits + watch providers per film. Needs
  `TMDB_API_KEY` (v3) or `TMDB_TOKEN` (v4) env var. Idempotent: skips already-enriched keys.

### 5. Sync scripts
- `scripts/fetch-letterboxd.mjs` — public per-account RSS feed (diary entries and reviews
  only, ~50 most recent) → `data/letterboxd.json`; prints rated films missing from the log.
- `scripts/enrich-tmdb.mjs` — TMDB search + credits + watch providers per film. Needs
  `TMDB_API_KEY` (v3) or `TMDB_TOKEN` (v4). Idempotent: skips already-enriched keys.

### 6. Infrastructure (GitHub, optional)
Private repo, version control only.
- `deploy.yml` — Pages deploy, **manual trigger only** (workflow_dispatch).
- `sync.yml` — daily Letterboxd/TMDB refresh committing changed data files.

## Data Flow
```
Letterboxd RSS ─┐                     ┌─ GET data/*.json ──> app.js renders tabs
TMDB API ───────┼─> data/*.json <──┤
hand edits ─────┘        ▲            └─ POST api/* (log film, queue, verdict)
                         └── serve.mjs (127.0.0.1:4747) ── the write path
```

## AI Workspace Substrate
This repository uses an AI-assisted engineering substrate located in `/ai`:
- **Cognition Layer**: State and tasks are tracked in `ai/PROJECT_STATE.md`.
- **Rules**: Agent constraints are defined in `ai/AGENTS.md`.
- **Flow**: Human Pilot -> AI Implementation -> Deterministic Verification (build must pass;
  `scripts/verify.sh` is on the backlog).
