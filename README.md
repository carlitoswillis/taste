# taste

A personal, local-first film taste app. Ratings, director filmography progress, influence lineages, cohorts, and a ranked watchlist all live as JSON in `data/`; a zero-dependency local server renders them as a tool you actually use — log a film from the page, manage the watch queue, record verdicts — and writes your changes back to the JSON. Whoever runs an instance, it renders *their* data — nothing is published unless you explicitly choose to.

```sh
npm start   # http://127.0.0.1:4747
```

Four tabs: **Watch next** (the ranked queue — logging a film clears it automatically, plus the "old films on trial" experiment with verdict entry), **Films** (the log: sort, filter by tier, search), **Directors** (filmography runs as sprocket meters — filled dots seen, hollow dots left), and **Taste** (the analysis: what the ratings circle, rules for picking, lineage chains, cohorts).

## How it works

```
config.json          who you are (letterboxd user, region, headline stats)
data/
  profile.json       the prose: thesis, section intros, footnotes
  ratings.json       every scored film (+ unscored verbal reactions)
  directors.json     filmography runs: seen count, what's left
  watchlist.json     ranked watch-next queue with reasoning
  lineage.json       influence chains (ancestor -> descendant, and the gap)
  cohorts.json       director cohorts and who's missing
  old-films.json     the "old films on trial" experiment, with a verdict field
  calibration.json   reach-for / avoid rules and known blind spots
  letterboxd.json    (generated) recent activity from the Letterboxd RSS feed
  enrichment.json    (generated) TMDB metadata: directors, runtimes, where to watch
templates/           the app shell: index.html, app.js, style.css
scripts/
  serve.mjs          the app: serves the shell, live data, and the write API
  build.mjs          static read-only snapshot into dist/ (only for deliberate exports)
  fetch-letterboxd.mjs  pulls the public RSS feed, flags new ratings
  enrich-tmdb.mjs    TMDB search + credits + watch providers (JustWatch data)
```

No frameworks, no npm install. Your data is plain JSON — edit it in the page or in a text editor, same thing. Project state, active tasks, and backlog are tracked in [`ai/PROJECT_STATE.md`](ai/PROJECT_STATE.md).

```sh
npm start        # run the app locally
npm run import -- ~/Downloads/letterboxd-export.zip   # full watch history in
npm run enrich   # metadata, critic scores, where-to-watch (keys from .env)
npm run suggest  # regenerate the suggestion list
npm run sync     # refresh recent Letterboxd activity (RSS)
npm run build    # optional: static read-only export into dist/
```

**Suggestions** are generated, not curated: the engine follows the people behind your 4★+
films (directors weighted heaviest, then writers, then actors), pulls their filmographies
from TMDB, drops everything you've logged, and ranks what's left — capped at two films per
person so one favorite doesn't flood the list. Each suggestion says who earned it and why.
Until your full watch history is imported it will occasionally suggest something you've
already seen; the Letterboxd import fixes that.

**Import** wants Letterboxd's official export (Settings → Import & Export → Export your
data). It fills `data/watched.json` (your complete history — the Films tab then shows
everything, not just rated films) and merges any ratings you've only recorded on Letterboxd,
never touching entries you wrote by hand.

Text fields in the data files support `**bold**` and `*italic*` — everything else is escaped.

## Make it yours

This repo is one person's profile, but nothing in the code is specific to them:

1. Clone or fork it.
2. Edit `config.json` — your Letterboxd username, region (for streaming availability), site title.
3. Replace the contents of `data/*.json` with your own films. The schemas are small; every file above shows the shape by example.
4. `npm start`.

## Automation

- **Sync** (`.github/workflows/sync.yml`): daily, pulls your latest Letterboxd activity via RSS and — if a `TMDB_API_KEY` secret is set — refreshes metadata and where-to-watch data. Commits only when something changed.
- **Deploy** (`.github/workflows/deploy.yml`): manual-trigger only. This app is local-first; run this workflow only if you deliberately want a public copy on GitHub Pages.

### APIs used

- **Letterboxd RSS** — no API key, public per-account feed (`letterboxd.com/<user>/rss/`), last ~50 entries with star ratings and rewatch flags. Letterboxd's real API is invite-only; RSS is the sanctioned free path.
- **TMDB** — free API key. Provides directors/cast (for connecting films to the director map), runtimes, IMDb ids, posters, and watch providers (the same JustWatch data most "where to watch" features use). Get a key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) and add it as a repo secret named `TMDB_API_KEY`.

## Roadmap

The living backlog is in [`ai/PROJECT_STATE.md`](ai/PROJECT_STATE.md). Headlines: a logging UI so adding a film doesn't mean hand-editing JSON, full-history import from Letterboxd's CSV export, multi-profile support, and critic scores via the free OMDb API.
