# Project State

## What this is
A personal, local-first film taste app. Each user runs their own instance: their ratings,
director progress, watchlist, and taste analysis live as JSON in `data/`, and the site is
the rendered view of that data. Nothing is published anywhere unless the user explicitly
chooses to. GitHub is version control, not distribution.

## Current Focus
- [x] **User action needed**: download the Letterboxd export (Settings → Import & Export) and run `npm run import -- <zip>`, then `npm run enrich` and `npm run suggest`. This is the single biggest data unlock: Films tab shows all ~340 films, suggestions stop offering already-seen films, stats become real
- [ x Live with the tool for a bit: log films through the UI, record old-film verdicts, note friction

## Active Tasks
- [ ] User chore: `gh repo delete carlitoswillis/taste-site --yes` (obsolete mirror repo, README only; deletion classifier-blocked for Claude)
- [ ] User review: `data/theme-map.json` seed (taste claims; "identity" theme matched 0 films, emergent list suggests obsession/psychological-horror/absurdism themes) and the 0-candidate adaptation review queue as it fills
- [ ] Connected recs Phase 4 (cross-media surfacing: connections.json, people.json, chips/chains/threads) — spec in `ai/plans/connected-recs.md`; Phases 1–3 shipped 2026-07-24

## Backlog
- users? maybe (see multi-user note below — deferred until the single-user loop feels alive)
- [ ] Multi-user support: `profiles/<name>/data/` so one install can serve multiple people; config picks the active profile
- [ ] Individual taste accounts → auto-publish returns: once users have their own accounts/profiles, each account's page can build and publish automatically (per-user opt-in pages, Letterboxd-style). Pilot has explicitly OK'd autopublishing in that world — the current restriction only covers this single-user personal instance
- [ ] Reconcile Letterboxd sync into `data/ratings.json` automatically instead of just flagging new ratings
- [ ] Auto-update director completion counts from TMDB filmographies (directors.json is hand-maintained today)
- [ ] Derive the "shape" stats (counts, tiers) into visualizations
- [ ] Two-way Letterboxd: push watchlist changes back (no public API — investigate what's feasible)
- [ ] `scripts/verify.sh` quality gate (build succeeds + JSON schema check on data files)

## Completed
- [x] 2026-07-26 — **Suggestion pools, lenses, streaming filters**: the suggesters now write a deep pool instead of a shortlist (films 60 / TV 40 / books 40, `--pool=` and `--people=` flags, two-pass per-person cap: 2 in the headline, 5 across the pool; `head` in the JSON marks the boundary). 15 theme picks instead of 3. Client gained a shared pool layer — lens chips (runtime/era/deep cuts/critics agree), order + stable shuffle, show more/show all, and a "Tonight" spotlight that rotates on the date. Opt-in streaming filter: `canonService` collapses TMDB's per-reseller names, chips are built from the pool, picks persist in `localStorage` (`config.json.services` seeds a fresh browser), nothing is filtered until a service is picked. Verified with a 34-check Playwright pass over the real app
- [x] 2026-07-24 — **Deploy LIVE**: https://carlitoswillis.github.io/taste/ — final architecture is ONE private repo, Pages build_type=workflow serving only the dist/ artifact (no mirror, no deploy keys; the taste-site mirror detour was retired same day). Leftover legacy Pages that publicly served the whole tree (ai/ included) was found and deleted
- [x] 2026-07-24 — Themes Phase 1 shipped & published (user opted in): TMDB keywords in enrichment, curated data/theme-map.json, themes.mjs engine, THEME_BLEND in suggest + themePicks, Taste/Films/Watch UI
- [x] 2026-07-24 — Zero-touch: RSS→ratings/watched auto-merge in daily sync (idempotent, note-preserving, ±1yr match); drop/ zip importer Action (owner-guarded)
- [x] 2026-07-24 — TV + Books verticals shipped (Phases 2+3): tv/book stores + enrichers + suggesters, Wikidata adaptation bridge (93 confirmed edges), Goodreads importer, write API handlers, TV & Books tabs; suggestions bootstrap entirely from film data
- [x] 2026-07-24 — **Deploy decided & wired (user chose public, Letterboxd-style)**: private source repo publishes `dist/` to public mirror repo `carlitoswillis/taste-site` (GitHub Pages, free plan — Pages-on-private needs Pro, mirror avoids it; `ai/` notes and git history stay private). `deploy.yml` reworked (push-to-mirror via deploy key, triggers: data/template pushes + manual + called by sync); `sync.yml` now republishes daily after data refresh, so the site self-updates — no server, no DB, repo-as-database
- [x] 2026-07-24 — Deterministic profile layer: `scripts/profile-stats.mjs` → `data/stats.json` (tier spread, decades, genre tilt, critic divergence, staleness counter); rendered as "Computed from the data" atop the Taste tab; runs in daily sync
- [x] 2026-07-24 — `/refresh-profile` project skill (`.claude/skills/refresh-profile/`): the ritual that rewrites profile.json/calibration.json prose from new evidence; stats.json's `newSinceProfile` says when it's due
- [x] 2026-07-23 — Extracted the hand-made HTML/xlsx profile into separated JSON data files (`data/`)
- [x] 2026-07-23 — Zero-dependency build script (`scripts/build.mjs` → `dist/index.html`)
- [x] 2026-07-23 — Letterboxd RSS fetcher (`scripts/fetch-letterboxd.mjs`), flags ratings missing from data
- [x] 2026-07-23 — TMDB enricher (`scripts/enrich-tmdb.mjs`): credits, runtime, where-to-watch providers
- [x] 2026-07-23 — GitHub repo created (carlitoswillis/taste); Pages deploy tried, then rolled back — this is personal. Deploy workflow now manual-only; repo private
- [x] 2026-07-23 — Local dev server with watch + rebuild (`scripts/serve.mjs`, `npm start`)
- [x] 2026-07-23 — UI rework: report → tool. Client-rendered app with four tabs (Watch next / Films / Directors / Taste), search, sort, tier filters; "projection booth" design with sprocket-dot filmography meters (`ai/plans/ui-rework.md`)
- [x] 2026-07-23 — Logging layer shipped: local write API in serve.mjs (`api/ratings`, `api/watchlist[/remove]`, `api/oldfilms/verdict`) + in-page dialogs; logging a film auto-clears it from the queue; static exports degrade to read-only
- [x] 2026-07-23 — TMDB + OMDb keys wired (.env + repo secrets); 60 films enriched with credits (person ids), runtimes, genres, posters, providers, RT/MC/IMDb scores
- [x] 2026-07-23 — Suggestion engine (`scripts/suggest.mjs`): people-affinity from 4★+ ratings (director 1.6 / writer 1.1 / actor 0.5 weights), TMDB filmographies, per-person cap of 2, enriched cards with "Queue it"/"Seen it" actions; refreshed daily by sync workflow
- [x] 2026-07-23 — Letterboxd CSV importer (`scripts/import-letterboxd.mjs`): watched.csv → data/watched.json, ratings.csv merged non-destructively; Films tab and enrich/suggest all honor watched.json
- [x] 2026-07-23 — Enriched data surfaced in UI: runtime/genres/scores/streaming on film rows and queue cards, posters on cards
