---
name: refresh-profile
description: Re-read the ratings/watched data and rewrite the taste-analysis prose (profile.json, calibration.json) so the written profile catches up with what's actually been watched. Use when the user asks to refresh/update the taste profile or when stats.json shows the analysis has drifted.
---

# Refresh the taste profile

The written analysis is the *interpretive* layer of this app — `data/stats.json` handles the numbers automatically (run `npm run stats` if it's stale), but the prose only updates when this ritual runs. Your job: re-read the evidence and rewrite the prose so it reflects the current data, keeping what still holds and revising what doesn't.

## Read first

1. `data/stats.json` — the computed layer; `newSinceProfile` says how far the prose has drifted
2. `data/ratings.json` — every rating, with notes; the notes are primary evidence
3. `data/watched.json` — full watch history (unrated watches count as "what was on", not taste)
4. `data/profile.json` and `data/calibration.json` — the current analysis you are revising
5. `data/old-films.json` — verdicts recorded since last time are new evidence
6. `data/enrichment.json` — genres/people/critic scores, for cross-checking hunches

## Rewrite

- `data/profile.json`: `shape` (heading + paragraphs), `ratingsNote`, `oldFilmsIntro`, `lineageIntro`, `cohortsIntro`, `directorsIntro`, `watchNextNotes`, `footer` (update the counts), and set `updated` to today's date (YYYY-MM-DD).
- `data/calibration.json`: `reachFor` / `avoid` / `blindSpots` — revise only where new evidence justifies it.

## Rules

- **Evidence over vibes.** Every claim should be traceable to specific ratings, notes, or verdicts. Name the films.
- **Revise, don't rewrite from scratch.** The existing analysis (doubling, unravelling-with-payoff, lineage gaps) is accumulated insight; overturn a finding only when new data contradicts it, and say what changed your mind.
- **Keep the voice**: second person, direct, concrete, a little blunt. Bold the load-bearing phrases with `**…**` (the UI renders `**bold**` / `*italic*`).
- **Unrated ≠ liked.** The watch history is mostly "what was on"; only ratings, notes, and verdicts carry taste signal.
- After writing, run `npm run stats` so `newSinceProfile` resets, then show the user a short diff-style summary of what changed in the analysis and why.
