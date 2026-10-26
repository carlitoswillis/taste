import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dateKey, shiftDateKey } from "./daily-pick.mjs";
import { ambientDay, ambientSize, AMBIENT_TARGET } from "./ambient-pick.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---- synthetic pool large enough for the full 7-day rule
const synth = [];
for (const [b, n] of [["queue", 30], ["lb", 200], ["sugg", 40]]) for (let i = 0; i < n; i++) synth.push({ id: `${b}${i}`, bucket: b, weight: 1 + (i % 3), director: `dir-${b}-${i}` });
const count = (items, b) => items.filter((c) => c.bucket === b).length;

test("synthetic: 30 days, 25 each, no repeats within 7 days, mix within +-2, deterministic", () => {
  const start = "2026-11-01", days = [];
  for (let i = 0; i < 30; i++) days.push(shiftDateKey(start, i));
  const res = days.map((d) => ambientDay(synth, d));
  res.forEach((r, i) => {
    assert.equal(r.items.length, 25);
    assert.equal(r.window, 7);
    for (const b of Object.keys(AMBIENT_TARGET)) assert.ok(Math.abs(count(r.items, b) - AMBIENT_TARGET[b]) <= 2);
    for (let j = Math.max(0, i - 7); j < i; j++) {
      const prev = new Set(res[j].items.map((c) => c.id));
      assert.ok(!r.items.some((c) => prev.has(c.id)), `repeat within 7 days on ${days[i]}`);
    }
  });
  assert.deepEqual(ambientDay(synth, days[10]).items.map((c) => c.id), res[10].items.map((c) => c.id));
});

test("synthetic: a director appears once a day when the pool allows", () => {
  const pool = synth.map((c, i) => ({ ...c, director: `d${i % 120}` }));
  for (let i = 0; i < 10; i++) {
    const r = ambientDay(pool, shiftDateKey("2026-11-01", i));
    assert.equal(new Set(r.items.map((c) => c.director)).size, 25);
  }
});

test("synthetic: small pool relaxes the window and says so", () => {
  const small = synth.filter((c, i) => i % 3 === 0).slice(0, 80);
  const r = ambientDay(small, "2026-11-20");
  assert.equal(r.items.length, 25);
  assert.ok(r.window < 7 && r.relaxed);
});

test("ambientSize: pool/8 capped at 25, floor 15", () => {
  assert.equal(ambientSize(84), 15);
  assert.equal(ambientSize(167), 20);
  assert.equal(ambientSize(200), 25);
  assert.equal(ambientSize(1000), 25);
  assert.equal(ambientSize(10), 15);
});

// ---- the real feed: run the builder for 30 consecutive days from today
test("real feed: 30 days from today", () => {
  const start = dateKey(), dist = mkdtempSync(path.join(tmpdir(), "ambient-"));
  const feed = (d) => {
    execFileSync("node", ["scripts/build-tv-feed.mjs"], { cwd: root, env: { ...process.env, TV_FEED_DATE: d, TV_FEED_DIST: dist }, stdio: ["ignore", "pipe", "pipe"] });
    const dir = path.join(dist, "tv", readdirSync(path.join(dist, "tv"))[0]);
    return JSON.parse(readFileSync(path.join(dir, "feed.json"), "utf8")).ambient.items;
  };
  const poolSize = Number(/pool (\d+)/.exec(execFileSync("node", ["scripts/build-tv-feed.mjs"], { cwd: root, env: { ...process.env, TV_FEED_DIST: dist }, encoding: "utf8" }))[1]);
  const size = ambientSize(poolSize);
  const days = Array.from({ length: 30 }, (_, i) => shiftDateKey(start, i));
  const sets = days.map(feed);
  const last = {}; let minGap = Infinity; const shown = new Set(); const gaps = [];
  sets.forEach((items, i) => {
    assert.equal(items.length, size, days[i]);
    assert.equal(new Set(items.map((x) => x.id)).size, size);
    for (const x of items) {
      assert.ok(x.posterUrl || x.backdropUrl, "needs a picture");
      shown.add(x.id);
      if (x.id in last) { minGap = Math.min(minGap, i - last[x.id]); gaps.push(i - last[x.id]); }
      last[x.id] = i;
    }
    const dirs = items.map((x) => x.director);
    // directors repeat only when the pool cannot avoid it: with 25 films the pool has far more directors
    assert.equal(new Set(dirs).size, size, `duplicate director on ${days[i]}`);
  });
  assert.deepEqual(feed(days[3]).map((x) => x.id), sets[3].map((x) => x.id), "determinism");
  console.log(`# pool ${poolSize}; distinct films over 30 days ${shown.size}; min gap ${minGap}; mean gap ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)}`);
  // The rule is a 7-day gap unless the pool is too small, in which case the builder logs the relaxed window.
  assert.ok(minGap >= 8, `7-day gap kept: min gap ${minGap}`);
});
