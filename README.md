# taste

A data-driven film taste profile. Ratings, director filmography progress, influence lineages, cohorts, and a ranked watchlist all live as JSON in `data/`; a zero-dependency Node script builds them into a single static page, deployed on GitHub Pages.

The page is an argument, not a list: *what do the ratings actually circle, and what should be watched next because of it.*

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

No frameworks, no npm install. Everything is plain JSON and one build script, so editing your profile is editing a text file.

```sh
node scripts/build.mjs          # build the site into dist/
node scripts/fetch-letterboxd.mjs   # refresh recent-activity data
TMDB_API_KEY=... node scripts/enrich-tmdb.mjs  # add metadata + streaming availability
npm run serve                   # preview at localhost:3000
```

Text fields in the data files support `**bold**` and `*italic*` — everything else is escaped.

## Make it yours

This repo is one person's profile, but nothing in the code is specific to them:

1. Fork it.
2. Edit `config.json` — your Letterboxd username, region (for streaming availability), site title.
3. Replace the contents of `data/*.json` with your own films. The schemas are small; every file above shows the shape by example.
4. Push. The deploy workflow publishes to GitHub Pages (enable Pages → Source: GitHub Actions in repo settings).

## Automation

- **Deploy** (`.github/workflows/deploy.yml`): every push to `main` rebuilds and republishes the site.
- **Sync** (`.github/workflows/sync.yml`): daily, pulls your latest Letterboxd activity via RSS and — if a `TMDB_API_KEY` secret is set — refreshes metadata and where-to-watch data. Commits only when something changed, which triggers a redeploy.

### APIs used

- **Letterboxd RSS** — no API key, public per-account feed (`letterboxd.com/<user>/rss/`), last ~50 entries with star ratings and rewatch flags. Letterboxd's real API is invite-only; RSS is the sanctioned free path.
- **TMDB** — free API key. Provides directors/cast (for connecting films to the director map), runtimes, IMDb ids, posters, and watch providers (the same JustWatch data most "where to watch" features use). Get a key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) and add it as a repo secret named `TMDB_API_KEY`.

## Roadmap

- [ ] Reconcile synced Letterboxd ratings into `data/ratings.json` automatically (open a PR from the sync workflow rather than just flagging)
- [ ] Full-history import from Letterboxd's CSV export (RSS only covers recent activity)
- [ ] Show streaming availability on every watchlist entry once enrichment runs in CI
- [ ] Auto-update director completion counts from TMDB filmographies
- [ ] Critic scores via the free OMDb API (Rotten Tomatoes/Metacritic numbers)
- [ ] Multi-profile support (one `data/` dir per person) if this outgrows the fork model
