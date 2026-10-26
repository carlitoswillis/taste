import test from "node:test";
import assert from "node:assert/strict";
import { isStore, stores, repeatsOverview, dropDangling, darkRegion, pickStills, DARK_SHARE } from "./tv-feed-rules.mjs";

test("JustWatch and Plex's channel are never a rent/buy venue", () => {
  assert.equal(isStore("JustWatch TV"), false);
  assert.equal(isStore("JustWatch TV Store"), false);
  assert.equal(isStore("Plex Channel"), false);
  assert.equal(isStore("Apple TV Store"), true);
  assert.equal(isStore("Amazon Video"), true);
  assert.equal(isStore("Plex"), true);
  assert.deepEqual(stores(["JustWatch TV", "Amazon Video", "Apple TV Store", "Amazon Video"]), ["Amazon Video", "Apple TV Store"]);
  assert.deepEqual(stores(undefined), []);
});

test("a tagline that repeats the plot is dropped", () => {
  const plot = "Here's a little story they're about to tell... Adam Horovitz and Michael Diamond look back.";
  assert.equal(repeatsOverview("Here's a little story they've got to tell", plot), true);
  assert.equal(repeatsOverview("Here’s a little story they’re about to tell.", plot), true);
  assert.equal(repeatsOverview("Shit floats to the surface", "A woman walks through Hollywood on Christmas Eve."), false);
  assert.equal(repeatsOverview("In space no one can hear you scream", "In the far future a crew wakes."), false);
  assert.equal(repeatsOverview("A tagline", ""), false);
  assert.equal(repeatsOverview("", plot), false);
  assert.equal(repeatsOverview("Hello", "Hello. Look back."), true);
});

test("a cut never ends on a dangling word", () => {
  assert.equal(dropDangling("you rated The Odyssey 5★, The"), "you rated The Odyssey 5★");
  assert.equal(dropDangling("Dune and the"), "Dune");
  assert.equal(dropDangling("The"), "The");
  assert.equal(dropDangling("Fine ending"), "Fine ending");
});

const W = 100, H = 60;
const tex = (x, y) => 40 + ((x * 37 + y * 91 + x * y) % 160);
const img = (black, fill = tex) => { const a = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = black(x, y) ? 0 : fill(x, y); a.set([v, v, v, 255], (y * W + x) * 4); } return a; };

test("a black band down the left side swaps", () => {
  assert.equal(darkRegion(img((x) => x < 40), W, H), 0.4);
});
test("letterbox bars swap, a single thin bar does not", () => {
  assert.ok(darkRegion(img((x, y) => y < 8 || y >= H - 8), W, H) >= DARK_SHARE);
  assert.equal(darkRegion(img((x, y) => y < 12), W, H), 0);
});
test("a dark textured image is kept, and so is a black blob that touches no edge band", () => {
  assert.equal(darkRegion(img(() => false, (x, y) => 4 + ((x * 7 + y * 13) % 40)), W, H), 0);
  assert.equal(darkRegion(img((x, y) => x >= 20 && x <= 80 && y >= 10 && y <= 50), W, H), 0);
  // 40 % near-black pixels scattered with no band (Cronos, Presence) is kept.
  assert.equal(darkRegion(img((x, y) => (x + y) % 5 < 2), W, H), 0);
});
test("a uniform dark grey image is kept; empty input is 0", () => {
  assert.equal(darkRegion(img(() => false, () => 40), W, H), 0);
  assert.equal(darkRegion(new Uint8Array(0), 0, 0), 0);
});

test("the least black backdrop is the primary when TMDB's own is mostly black", () => {
  // Paris, je t'aime: the first still is 40 % black, the second 5 %.
  const r = pickStills("/a.jpg", { "/a.jpg": 0.4, "/b.jpg": 0, "/c.jpg": 0.3 });
  assert.equal(r.primary, "/b.jpg");
  assert.deepEqual(r.alts, ["/c.jpg", "/a.jpg"]);   // the rest, least black first
  // A fine primary stays first; the others are alternatives by darkness.
  const k = pickStills("/a.jpg", { "/a.jpg": 0.1, "/b.jpg": 0.0, "/c.jpg": 0.2 });
  assert.equal(k.primary, "/a.jpg"); assert.deepEqual(k.alts, ["/b.jpg", "/c.jpg"]);
  // All dark and no clear winner: nothing changes.
  assert.equal(pickStills("/a.jpg", { "/a.jpg": 0.6, "/b.jpg": 0.58 }).primary, "/a.jpg");
  // Unknown shares never replace a known primary; no primary takes the least black.
  assert.equal(pickStills("/a.jpg", { "/a.jpg": 0.9 }).primary, "/a.jpg");
  assert.equal(pickStills(null, { "/b.jpg": 0.5, "/c.jpg": 0.1 }).primary, "/c.jpg");
  assert.deepEqual(pickStills("/a.jpg", undefined), { primary: "/a.jpg", alts: [] });
  assert.ok(DARK_SHARE === 0.25);
});
