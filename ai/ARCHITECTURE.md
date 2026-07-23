# Architecture

PURPOSE: Technical system design and data flow of the taste application.

## Overview
A static-site pipeline over personal film data. JSON in, one HTML page out, viewed locally.
No database, no framework, no npm dependencies — the filesystem is the database and git is
the history.

## System Components

### 1. Data layer (`config.json`, `data/`)
- `config.json` — instance identity: Letterboxd username, region, site title, headline stats.
- `data/*.json` — human-authored content: `ratings`, `directors`, `watchlist`, `lineage`,
  `cohorts`, `old-films`, `calibration`, `profile` (prose).
- Generated files: `data/letterboxd.json` (RSS sync), `data/enrichment.json` (TMDB metadata
  and watch providers, keyed `"Title (Year)"`). Safe to delete; scripts regenerate them.

### 2. Build (`scripts/build.mjs`)
Reads all data + `templates/style.css`, renders `dist/index.html`. Computes derived stats
(rating counts, tier grouping). Escapes everything; supports `**bold**`/`*italic*` in text
fields. Enrichment and letterboxd data are optional inputs — the build degrades gracefully
without them.

### 3. Local server (`scripts/serve.mjs`, `npm start`)
Zero-dep static server over `dist/` with a watcher on `data/`, `templates/`, `config.json`
that re-runs the build on change. This is the primary way the app is used.

### 4. Sync scripts
- `scripts/fetch-letterboxd.mjs` — pulls the public per-account RSS feed (diary entries and
  reviews only, ~50 most recent), writes `data/letterboxd.json`, and prints rated films not
  yet present in `data/ratings.json`.
- `scripts/enrich-tmdb.mjs` — TMDB search + credits + watch providers per film. Needs
  `TMDB_API_KEY` (v3) or `TMDB_TOKEN` (v4) env var. Idempotent: skips already-enriched keys.

### 5. Infrastructure (GitHub, optional)
Private repo, version control only.
- `deploy.yml` — Pages deploy, **manual trigger only** (workflow_dispatch).
- `sync.yml` — daily Letterboxd/TMDB refresh committing changed data files.

## Data Flow
```
Letterboxd RSS ─┐
TMDB API ───────┼─> data/*.json ──> build.mjs ──> dist/index.html ──> localhost (serve.mjs)
hand edits ─────┘
```

## AI Workspace Substrate
This repository uses an AI-assisted engineering substrate located in `/ai`:
- **Cognition Layer**: State and tasks are tracked in `ai/PROJECT_STATE.md`.
- **Rules**: Agent constraints are defined in `ai/AGENTS.md`.
- **Flow**: Human Pilot -> AI Implementation -> Deterministic Verification (build must pass;
  `scripts/verify.sh` is on the backlog).
