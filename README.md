# taste

A personal, local-first film taste app. Ratings, director filmography progress, influence lineages, cohorts, and a ranked watchlist all live as JSON in `data/`; a zero-dependency Node script builds them into a single page you view locally. Whoever runs an instance, it renders *their* data — nothing is published unless you explicitly choose to.

The page is an argument, not a list: *what do the ratings actually circle, and what should be watched next because of it.*

```sh
npm start   # http://127.0.0.1:4747 — edits to data/ rebuild automatically
```

## How it works

```
config.json          who you are (letterboxd user, region, headline stats)
data/
  profile.json       the prose: thesis, section intros, footnotes
  ratings.json       every scored film (+ unscored verbal reactions)
  directors.json     filmography completion tracker
  watchlist.json     ranked watch-next list with reasoning
  lineage.json       influence chains (ancestor -> descendant, and the gap)
  cohorts.json       director cohorts and who's missing
  old-films.json     the "old films on trial" experiment, with a verdict field
  calibration.json   reach-for / avoid rules and known blind spots
  letterboxd.json    (generated) recent activity from the Letterboxd RSS feed
  enrichment.json    (generated) TMDB metadata: directors, runtimes, where to watch
scripts/
  build.mjs          data + templates -> dist/index.html
  fetch-letterboxd.mjs  pulls the public RSS feed, flags new ratings
  enrich-tmdb.mjs    TMDB search + credits + watch providers (JustWatch data)
templates/style.css  the look
```

No frameworks, no npm install. Everything is plain JSON and one build script, so editing your profile is editing a text file. Project state, active tasks, and backlog are tracked in [`ai/PROJECT_STATE.md`](ai/PROJECT_STATE.md).

```sh
npm start        # serve locally with watch + rebuild
npm run build    # one-off build into dist/
npm run sync     # refresh recent Letterboxd activity
TMDB_API_KEY=... npm run enrich   # add metadata + streaming availability
```

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
