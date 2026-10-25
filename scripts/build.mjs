#!/usr/bin/env node
// Build: copy the app shell (templates/) and a snapshot of the data into dist/.
// The app is client-rendered; this exists so a static export (e.g. a deliberate
// Pages deploy) works without the local server. Run: node scripts/build.mjs

import { cp, mkdir, readdir, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");

await mkdir(path.join(dist, "data"), { recursive: true });

for (const f of ["index.html", "style.css", "app.js"]) {
  await copyFile(path.join(root, "templates", f), path.join(dist, f));
}
// tvFeedPath is the TV feed's unguessable path segment: never published in the site's own copy of the config.
const { tvFeedPath: _omit, ...publicConfig } = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
await writeFile(path.join(dist, "data/config.json"), JSON.stringify(publicConfig, null, 2) + "\n");
for (const f of await readdir(path.join(root, "data"))) {
  if (f.endsWith(".json")) await cp(path.join(root, "data", f), path.join(dist, "data", f));
}

console.log("Built dist/ (app shell + data snapshot)");
