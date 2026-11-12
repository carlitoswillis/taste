#!/usr/bin/env node
// Daily step in sync.yml, after enrich-tmdb: records when each streaming provider first showed up for a film
// (data/tv-provider-seen.json), so the TV feed can say "New on Hulu this week". Deterministic, no network.
import { readJsonStrict, writeJsonAtomic } from "./lib/atomic-json.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateSeen } from "./lib/provider-seen.mjs";
import { dateKey } from "./lib/daily-pick.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Only a MISSING file is "empty"; an unreadable tv-provider-seen.json must not be re-baselined (that would erase every first-seen date).
const read = (f, fb) => readJsonStrict(path.join(root, f), fb);
const enrichment = read("data/enrichment.json", {});
const prev = read("data/tv-provider-seen.json", { v: 1, seen: {} });
const films = {};
for (const e of Object.values(enrichment)) if (e?.tmdbId && e.providers) films[e.tmdbId] = e.providers;
const seen = updateSeen(prev.seen, films, process.env.TV_FEED_DATE || dateKey());
writeJsonAtomic(path.join(root, "data/tv-provider-seen.json"), { v: 1, seen }, 1);
console.log(`provider-seen: ${Object.keys(seen).length} films tracked`);
