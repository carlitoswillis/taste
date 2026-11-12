#!/usr/bin/env node
// Lists queue rows that are already logged (film queue vs ratings, TV queue vs tv-ratings).
// Dry run by default; --apply removes them and renumbers ranks. --dir <path> targets a copy of data/.
// Run: node scripts/repair-queue.mjs [--dir data] [--apply]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearRatedFromQueue } from "./lib/queue.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const di = args.indexOf("--dir");
const dir = path.resolve(di >= 0 ? args[di + 1] : path.join(root, "data"));

let total = 0;
for (const pair of [{ queue: "watchlist", log: "ratings" }, { queue: "tv-watchlist", log: "tv-ratings" }]) {
  const removed = clearRatedFromQueue(dir, { ...pair, apply });
  total += removed.length;
  console.log(`${pair.queue}: ${removed.length} already in ${pair.log}${apply ? " (removed)" : ""}`);
  for (const w of removed) console.log(`  ${w.title} (${w.year})`);
}
console.log(apply ? `Removed ${total}.` : `Dry run: ${total} row(s) would be removed. Re-run with --apply to write.`);
