import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { edgeKey, decide, mergeMachine, reviewFile, writeMachineResult, stateOf } from "./adaptation-review.mjs";
import { readJsonStrict } from "./atomic-json.mjs";

const edge = (screen, title, status, extra = {}) => ({
  book: { title, author: "A", olWork: null, wikidata: null }, screen, screenId: "m:1", status, source: "omdb", read: false, ...extra,
});
const KEY = (s, t) => `${s}::${t}`;

test("decide: legal transitions", () => {
  const d = { edges: [edge("F (2000)", "B", "candidate"), edge("G (2001)", "C", "confirmed")], rejected: [] };
  assert.equal(decide(d, KEY("F (2000)", "B"), "confirm").status, "confirmed");
  assert.equal(decide(d, KEY("G (2001)", "C"), "reject").status, "rejected");
  assert.equal(stateOf(d, KEY("G (2001)", "C")), "rejected");
  assert.equal(d.edges.length, 1);
});

test("decide: rejected is terminal", () => {
  const d = { edges: [], rejected: [edge("F (2000)", "B", "candidate")] };
  assert.throws(() => decide(d, KEY("F (2000)", "B"), "confirm"), /already rejected/);
  assert.throws(() => decide(d, "nope", "reject"), /no such edge/);
});

test("mergeMachine: a machine candidate never demotes a confirmed row, never resurrects a rejected one", () => {
  const current = {
    edges: [edge("A (1)", "T1", "confirmed", { note: "mine" })],
    rejected: [edge("B (2)", "T2", "candidate")],
  };
  const fresh = { edges: [edge("A (1)", "T1", "candidate"), edge("B (2)", "T2", "confirmed"), edge("C (3)", "T3", "candidate")] };
  const m = mergeMachine(current, fresh, "t");
  assert.equal(m.edges.find((e) => e.screen === "A (1)").status, "confirmed");
  assert.equal(m.edges.find((e) => e.screen === "A (1)").note, "mine");
  assert.ok(!m.edges.some((e) => e.screen === "B (2)"));
  assert.equal(m.rejected.length, 1);
  assert.equal(m.edges.find((e) => e.screen === "C (3)").status, "candidate");
});

test("mergeMachine: a candidate is promoted when a later pass confirms it; manual rows are carried", () => {
  const current = { edges: [edge("A (1)", "T1", "candidate"), edge("M (9)", "TM", "candidate", { source: "manual" })], rejected: [] };
  const m = mergeMachine(current, { edges: [edge("A (1)", "T1", "confirmed", { source: "wikidata" })] });
  assert.equal(m.edges.find((e) => e.screen === "A (1)").status, "confirmed");
  assert.ok(m.edges.some((e) => e.screen === "M (9)"));
});

test("bridge race: a reject made after the run's snapshot survives the write-back", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "adapt-"));
  const file = path.join(dir, "adaptations.json");
  const start = { edges: [edge("F (2000)", "B", "candidate"), edge("G (2001)", "C", "candidate")], rejected: [], flaggedOnly: [], adjacentAuthors: [] };
  writeFileSync(file, JSON.stringify(start));
  const snapshot = readJsonStrict(file); // what the bridge read at the start
  // ... minutes of network passes; meanwhile the app rejects F and confirms G
  reviewFile(file, KEY("F (2000)", "B"), "reject");
  reviewFile(file, KEY("G (2001)", "C"), "confirm");
  // the bridge's machine output is built from the stale snapshot (both still candidates)
  writeMachineResult(file, { edges: snapshot.edges.map((e) => ({ ...e })), flaggedOnly: [], adjacentAuthors: [] });
  const out = readJsonStrict(file);
  assert.deepEqual(out.rejected.map(edgeKey), [KEY("F (2000)", "B")]);
  assert.deepEqual(out.edges.map((e) => [e.screen, e.status]), [["G (2001)", "confirmed"]]);
  assert.deepEqual(readdirSync(dir), ["adaptations.json"], "no temp file left behind");
});

test("a corrupt file is an error, not an empty file that gets written back", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "adapt-"));
  const file = path.join(dir, "adaptations.json");
  writeFileSync(file, '{"edges": [');
  assert.throws(() => reviewFile(file, "x", "reject"), /not valid JSON/);
  assert.throws(() => writeMachineResult(file, { edges: [] }), /not valid JSON/);
  assert.equal(readFileSync(file, "utf8"), '{"edges": [');
});
