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
      cwd: root, env: { TV_FEED_PATH: "0".repeat(32), ...process.env, TV_FEED_DIST: dist, TV_FEED_DATE: date }, stdio: "pipe",
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

test("tonight: only non-suggestions carry it; base is a 0.05 step; why is short and rating-free; no inputs leak", () => {
  for (const doc of feeds) {
    for (const i of doc.list.items) {
      if (i.source === "suggestion") { assert.equal(i.tonight, undefined, i.id); continue; }
      if (!i.tonight) continue;
      const t = i.tonight;
      assert.deepEqual(Object.keys(t).filter((k) => !["base", "rank", "why", "availableSince"].includes(k)), [], i.id);
      assert.ok(t.base >= 0 && t.base <= 1 && Math.abs(t.base * 20 - Math.round(t.base * 20)) < 1e-9, `${i.id} ${t.base}`);
      assert.ok(t.why.length > 0 && t.why.length <= 52 && !/★|rat(e|ing)/i.test(t.why), t.why);
      assert.ok(Number.isInteger(i.runtime), i.id);
    }
  }
});

test("tonight: a film already in watched.json has no tonight (Dead Ringers)", () => {
  for (const doc of feeds) for (const i of doc.list.items) if (i.title === "Dead Ringers") assert.equal(i.tonight, undefined);
});

test("watched: newest first, at most 40, last 12 months, no bulk-import dates, same provider shape as list items", () => {
  for (const doc of feeds) {
    assert.ok(doc.watched.length <= 40);
    const dates = doc.watched.map((w) => w.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    for (const w of doc.watched) {
      assert.ok(!w.date.startsWith("2024-08"), w.title);
      assert.deepEqual(Object.keys(w.providers), ["flatrate", "free", "rent", "buy"]);
      assert.equal(typeof w.rewatch, "boolean");
      assert.ok(!("rating" in w) && !("score" in w) && !("sealed" in doc));
    }
  }
});
