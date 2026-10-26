#!/usr/bin/env node
// Daily step in sync.yml, after enrich-tmdb: records when each streaming provider first showed up for a film
// (data/tv-provider-seen.json), so the TV feed can say "New on Hulu this week". Deterministic, no network.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateSeen } from "./lib/provider-seen.mjs";
import { dateKey } from "./lib/daily-pick.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f, fb) => { try { return JSON.parse(readFileSync(path.join(root, f), "utf8")); } catch { return fb; } };
const enrichment = read("data/enrichment.json", {});
const prev = read("data/tv-provider-seen.json", { v: 1, seen: {} });
const films = {};
for (const e of Object.values(enrichment)) if (e?.tmdbId && e.providers) films[e.tmdbId] = e.providers;
const seen = updateSeen(prev.seen, films, process.env.TV_FEED_DATE || dateKey());
writeFileSync(path.join(root, "data/tv-provider-seen.json"), JSON.stringify({ v: 1, seen }, null, 1) + "\n");
console.log(`provider-seen: ${Object.keys(seen).length} films tracked`);
