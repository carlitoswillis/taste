import test from "node:test";
import assert from "node:assert/strict";
import { mergeWatchlists } from "./watchlists.mjs";
import { weightedSample } from "./daily-pick.mjs";

const normTitle = (t, y) => `${String(t).toLowerCase()}|${y}`;
const enrich = { "A (2000)": { tmdbId: 1 }, "B (2001)": { tmdbId: 2 }, "C (2002)": { tmdbId: 3 }, "D (2003)": { tmdbId: 4 }, "NoId (1999)": {} };
const f = (title, year, position) => ({ title, year, position });

test("merges watchlists: one entry per film, `lists` counts the watchlists holding it", () => {
  const mine = [f("A", 2000, 1), f("B", 2001, 2), f("NoId", 1999, 3)];
  const theirs = [f("B", 2001, 1), f("C", 2002, 2), f("B", 2001, 5)];
  const out = mergeWatchlists([mine, theirs], { enrich, normTitle });
  assert.deepEqual(out.map((c) => [c.tmdbId, c.lists, c.position]), [[1, 1, 1], [2, 2, 1], [3, 1, 2]]);
});

test("skips films already taken (hand-picked) by id or by title", () => {
  const out = mergeWatchlists([[f("A", 2000, 1), f("B", 2001, 2), f("C", 2002, 3)]], { enrich, normTitle, skipIds: new Set([1]), skipNames: new Set(["c|2002"]) });
  assert.deepEqual(out.map((c) => c.tmdbId), [2]);
});

test("an empty extra watchlist changes nothing", () => {
  const mine = [f("A", 2000, 1), f("D", 2003, 2)];
  assert.deepEqual(mergeWatchlists([mine, []], { enrich, normTitle }), mergeWatchlists([mine], { enrich, normTitle }));
});

test("the row shuffle keeps every film and puts films on both lists nearer the front on average", () => {
  const pool = Array.from({ length: 100 }, (_, i) => ({ id: i, lists: i < 20 ? 2 : 1 }));
  let both = 0, one = 0;
  for (let d = 0; d < 50; d++) {
    const row = weightedSample(pool, (c) => c.lists, Infinity, `row|day${d}`);
    assert.equal(new Set(row.map((c) => c.id)).size, 100);
    row.forEach((c, i) => { if (c.lists === 2) both += i; else one += i; });
  }
  assert.ok(both / (20 * 50) < one / (80 * 50));
});
