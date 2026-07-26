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
`index.html` + `app.js` (ES module) + `style.css`. Six tabs — Watch next, Films, TV, Books,
Directors, Taste — rendered client-side from fetched JSON, with search, sort, and tier
filters. Logging dialogs post to the API; on page load the app probes `api/health` and falls
back to read-only (no log buttons) when the API is absent, e.g. on a static export. Design:
"projection booth" tungsten-dark, Futura/Avenir/SF Mono system faces, sprocket-dot
filmography meters (see `ai/plans/ui-rework.md`).

**Suggestion pools.** The suggesters write a deep ranked pool (`items`, plus `head` marking
where the tight top ends); the client decides how much of it to show. One shared layer in
`app.js` serves all three media *and* both hand-ranked queues (`queue`, `tvqueue`):
- `poolView(medium, items)` — filter (lens + streaming services) → order → cut to the
  unfolded length; returns `hidden` so a filtered view can admit what it withheld.
  `poolControls` / `poolList` / `poolMore` render it, `wirePool` binds it. Per-medium view
  state lives in `state.pool[medium]` and is deliberately *not* persisted: a fresh visit
  starts from the ranking the engine produced. The queues start at `shown: Infinity` — they
  are curated, so there is nothing to unfold.
- `LENSES` — shape-of-the-evening predicates (runtime, era, obscurity, critical standing).
  `FACTS[medium]` normalises a row before a predicate sees it: suggestions carry their own
  runtime/providers, queue entries get them from `enrichment.json` keyed `"Title (Year)"`.
  That indirection is why the same lens code works over both. The queue lens set omits
  `deep cuts` because enrichment has no vote counts.
- Shuffle is `hash32(title + seed)`, so an order holds still while you interact with it and
  reshuffles wholesale when the seed bumps. The "Tonight" spotlight indexes the pool by
  `Math.floor(Date.now() / 86400000)`, so it rotates daily with no rerun.
- `canonService` collapses TMDB's per-reseller provider names ("Netflix Standard with Ads",
  "HBO Max Amazon Channel") into the service a person would say they have. The picked
  services live in `localStorage` under `taste.prefs` (seeded from `config.json.services`)
  — filtering is off entirely until something is picked.

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
- `deploy.yml` — Pages deploy; also `workflow_call`, so other workflows republish through it.
- `sync.yml` — daily Letterboxd/TMDB refresh committing changed data files, then publishes.
- `refresh.yml` — on-demand suggestion regeneration from the Actions UI (phone-friendly):
  choice of medium, optional pool/people overrides, commits + republishes, and writes the
  new pool's head into the run summary. Owner-guarded; inputs are passed through `env` and
  digit-checked rather than interpolated into the shell.

**Suggestion sizing.** `config.json.suggest.{film,tv,book}` holds the pool sizes; each
suggester resolves `--flag` → config → built-in default via its `num()` helper. The config
layer exists because the daily sync passes no flags — without it, any hand-tuned pool would
be silently reset overnight. `num()` treats an empty or non-numeric flag as *absent* and
falls through to config, so a form that assembles flags from blank fields can't clobber the
configured size.

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
