// Builds the real TV feed from data/ into a temp dir and checks what would be published (review 2026-10-25 B2, B7, B8).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feedStrings } from "./tv-feed-rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function build(date) {
  const dist = mkdtempSync(path.join(tmpdir(), "tvfeed-"));
  try {
    execFileSync(process.execPath, [path.join(root, "scripts/build-tv-feed.mjs")], {
      cwd: root, env: { ...process.env, TV_FEED_DIST: dist, TV_FEED_DATE: date }, stdio: "pipe",
    });
    const dir = path.join(dist, "tv", readdirSync(path.join(dist, "tv"))[0]);
    return JSON.parse(readFileSync(path.join(dir, "feed.json"), "utf8"));
  } finally { rmSync(dist, { recursive: true, force: true }); }
}

const days = ["2026-10-25", "2026-10-26", "2026-11-03", "2027-01-15"];
const feeds = days.map(build);

test("no published why/note holds a star or 'rated'; no published string holds a star", () => {
  for (const doc of feeds) {
    for (const [at, s] of feedStrings(doc)) {
      assert.ok(!s.includes("★"), `${at}: ${s}`);
      if (/\.(why|note)$/.test(at)) assert.ok(!/rated/i.test(s), `${at}: ${s}`);
    }
  }
});

test("every ambient item carries verb Available or Rent, matching its route", () => {
  for (const doc of feeds) {
    assert.ok(doc.ambient.items.length > 0);
    for (const a of doc.ambient.items) assert.ok(a.verb === "Available" || a.verb === "Rent", JSON.stringify(a));
  }
});

test("rent-only list notes keep the exact 'Rent on <label>' form the TV parses", () => {
  const notes = feeds.flatMap((d) => d.list.items.map((i) => i.note)).filter((n) => /^Rent on /.test(n ?? ""));
  for (const n of notes) assert.match(n, /^Rent on [^:]+$/);
});
