import test from "node:test";
import assert from "node:assert/strict";
import { upsertLogEntry } from "./log-entry.mjs";

test("re-logging without a director keeps the stored director; a supplied one replaces it", () => {
  const rows = [{ title: "Heat", year: 1995, director: "Michael Mann", score: 4 }];
  assert.equal(upsertLogEntry(rows, { title: "Heat", year: 1995, score: 5 }, { director: null }), true);
  assert.deepEqual(rows[0], { title: "Heat", year: 1995, director: "Michael Mann", score: 5 });
  upsertLogEntry(rows, { title: "Heat", year: 1995, director: "M. Mann", score: 5 }, { director: null });
  assert.equal(rows[0].director, "M. Mann");
});

test("new rows get the defaults", () => {
  const rows = [];
  assert.equal(upsertLogEntry(rows, { title: "Ran", year: 1985, score: 5 }, { director: null }), false);
  assert.deepEqual(Object.keys(rows[0]), ["title", "year", "director", "score"]);
});
