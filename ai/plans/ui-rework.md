# UI rework plan — from report to tool

## Problem
v1 rendered the taste profile as a single long prose page (a "report"). The archive HTML was
source information, not a template. The site should be an instrument you open and use.

## Direction: "projection booth"
A private tool used in a dark room to decide what to watch and log what was watched.

- **Palette** (warm tungsten dark, not neutral black):
  bg `#131009` · surface `#1C1710` · line `#352D1E` · ink `#F0E8D8` · dim `#A39678` · tungsten `#E8A83E`
- **Type**: Futura (the film-credits face) for wordmark/section caps · Avenir Next body ·
  SF Mono for years/runtimes/counts. All local system faces — works offline, zero deps.
- **Signature**: sprocket-dot filmography meters on the Directors tab — one filled dot per
  film seen, hollow dots for what's left, `+` when the list is open-ended. Encodes real data.
- **Committed choices**: dark-only (house lights down), star glyphs as data, no light theme.

## Structure
Topbar: wordmark · computed stats · search. Tabs:
1. **Watch next** (default): ranked queue cards + "old films on trial" with verdict entry
2. **Films**: the ratings log — sort, tier filter, search; unscored reactions included
3. **Directors**: sprocket meters + status + notes
4. **Taste**: the analysis (shape, rules, lineage chains, cohorts, blind spots) as cards

## Tool layer
`serve.mjs` grows a local write API (127.0.0.1 only):
- `POST /api/ratings` upsert a log entry; auto-removes the film from the watchlist
- `POST /api/watchlist` add · `POST /api/watchlist/remove`
- `POST /api/oldfilms/verdict` record a verdict
- `GET /api/health` — the page probes this; without it (static export) the UI is read-only

Client fetches `data/*.json` (served live from `data/` in dev; snapshot copied to `dist/data/`
by the build for static export). `build.mjs` becomes shell-copy + data-snapshot.
