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
from TMDB, drops everything you've logged, and ranks what's left. Each suggestion says who
earned it and why. Until your full watch history is imported it will occasionally suggest
something you've already seen; the Letterboxd import fixes that.

It writes a **pool, not a shortlist** — 60 films by default (40 series, 40 books). The first
dozen are the headline, capped at two per person so one favorite can't flood the top; the
rest fill in behind a looser cap of five. Size it yourself:

```sh
npm run suggest -- --pool=100 --people=40   # deeper pool, more people chased
npm run suggest -- --pool=24                # a smaller, tighter list
```

`--pool` is a ceiling, not a promise: it's capped by how many unseen candidates those
filmographies actually yield. If it prints `73 suggestions`, the data ran out — raise
`--people` to raise the ceiling.

Flags apply to one run. To change the sizes **for good**, edit the `suggest` block in
`config.json` — that's what the daily sync reads, so without it every overnight run snaps
back to the built-in numbers:

```json
"suggest": {
  "film": { "pool": 60, "people": 30 },
  "tv":   { "pool": 40, "people": 26 },
  "book": { "pool": 40, "authors": 12 }
}
```

Precedence is `--flag` → `config.json` → built-in default.

### Refreshing without a laptop

**Actions → [Refresh suggestions](../../actions/workflows/refresh.yml) → Run workflow.**
Works from github.com or the GitHub mobile app: pick films / tv / books / everything,
optionally type a pool and people size, run. It commits the new data, republishes the site,
and writes the top of the new pool into the run summary so you can read the result on your
phone without opening a diff. Leave the size fields blank to use `config.json`.

The published site links to it too — the `Refresh suggestions ↗` button next to the
read-only badge in the footer. That's a deep link to the workflow, not a one-tap trigger:
the page is public, so it holds no credentials and can't dispatch anything by itself.

`config.json` is editable from the GitHub web UI as well, so the permanent sizes can be
changed from a phone the same way.

In the page that pool is something to browse rather than a fixed list:

- **Tonight** — one card off the top, picked by the date. It moves on its own once a day; *Reroll* if tonight's isn't it.
- **Lenses** — `under 100 min`, `long haul`, `pre-1980`, `this century`, `deep cuts`, `critics agree`. The shape of an evening, not another genre filter.
- **Order & shuffle** — best fit, highest rated, newest, oldest, or shuffled. Shuffle holds still until you press it again.
- **Show more / show all** — the headline unfolds into the whole pool.
- **My streaming** — pick the services you actually pay for and everything narrows to what you can watch tonight; cards get a `▶ Criterion Channel` badge. **Off unless you pick something** — no selection means no filtering. Optionally count rent & buy as available too. Your picks live in the browser (`localStorage`), so they survive reloads and never reach the repo; `config.json` can carry a `"services": [...]` list to seed a fresh browser.

The same lenses and service filter run over **Up next**, so the queue answers "what can I
actually watch tonight" and not just "what did I argue for". Two rules keep that honest: a
filtered queue always says what it withheld (`2 · 17 filtered out`), and cards keep their real
rank — filtering never renumbers the argument. The queue drops the `deep cuts` lens, since
enrichment carries no vote counts and a lens that silently matches nothing is worse than no
lens. The services drawer sits at the top of the tab because it governs all of it: queue,
spotlight and suggestions alike.

TMDB lists every reselling of a service separately — *Netflix*, *Netflix Standard with Ads*,
*HBO Max Amazon Channel*. The app collapses those to the thing you'd actually say you have,
and the service list is built from your own pool, so it only ever offers services that could
match something.

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
- **Refresh suggestions** (`.github/workflows/refresh.yml`): manual, phone-friendly. Regenerates any of the three suggestion pools at a size you choose and republishes. Owner-only.
- **Deploy** (`.github/workflows/deploy.yml`): manual-trigger only. This app is local-first; run this workflow only if you deliberately want a public copy on GitHub Pages.

### APIs used

- **Letterboxd RSS** — no API key, public per-account feed (`letterboxd.com/<user>/rss/`), last ~50 entries with star ratings and rewatch flags. Letterboxd's real API is invite-only; RSS is the sanctioned free path.
- **TMDB** — free API key. Provides directors/cast (for connecting films to the director map), runtimes, IMDb ids, posters, and watch providers (the same JustWatch data most "where to watch" features use). Get a key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) and add it as a repo secret named `TMDB_API_KEY`.

## Roadmap

The living backlog is in [`ai/PROJECT_STATE.md`](ai/PROJECT_STATE.md). Headlines: a logging UI so adding a film doesn't mean hand-editing JSON, full-history import from Letterboxd's CSV export, multi-profile support, and critic scores via the free OMDb API.
