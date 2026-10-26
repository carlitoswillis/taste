import test from "node:test";
import assert from "node:assert/strict";
import { updateSeen, newestSince, streamingOf } from "./provider-seen.mjs";

test("a film seen for the first time is baselined, not new", () => {
  assert.deepEqual(updateSeen({}, { 1: { flatrate: ["Hulu"], rent: ["Apple"] } }, "2026-10-25"), { 1: { Hulu: null } });
});
test("a provider that appears later is dated today; one that vanishes is forgotten; dates stay", () => {
  const seen = { 1: { Hulu: null, Max: "2026-10-01" } };
  const next = updateSeen(seen, { 1: { flatrate: ["Hulu", "Netflix"], free: ["Tubi"] } }, "2026-10-25");
  assert.deepEqual(next, { 1: { Hulu: null, Netflix: "2026-10-25", Tubi: "2026-10-25" } });
  assert.deepEqual(updateSeen(next, { 1: { flatrate: ["Hulu"] } }, "2026-10-26"), { 1: { Hulu: null } });
});
test("films with no streaming provider are not tracked; newestSince picks the latest dated provider", () => {
  assert.deepEqual(updateSeen({}, { 2: { rent: ["X"] } }, "2026-10-25"), {});
  assert.deepEqual(newestSince({ A: null, B: "2026-10-20", C: "2026-10-22" }, ["A", "B", "C"]), { date: "2026-10-22", name: "C" });
  assert.equal(newestSince({ A: null }, ["A"]), undefined);
  assert.deepEqual(streamingOf({ flatrate: ["A", "A"], free: ["B"] }), ["A", "B"]);
});
