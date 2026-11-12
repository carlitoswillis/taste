import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dropRated, clearRatedFromQueue } from "./queue.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const q = (rank, title, year) => ({ rank, title, year, director: null, confidence: "high", why: "" });

test("dropRated: removes rated titles (case-insensitive, year-tolerant when absent) and renumbers", () => {
  const { rest, removed } = dropRated(
    [q(1, "Heat", 1995), q(2, "Alien", 1979), q(3, "Ran", 1985), q(4, "Alien", 1986)],
    [{ title: "alien", year: 1979, score: 4 }, { title: "Ran", score: null }],
  );
  assert.deepEqual(removed.map((w) => w.title), ["Alien", "Ran"]);
  assert.deepEqual(rest.map((w) => [w.rank, w.title, w.year]), [[1, "Heat", 1995], [2, "Alien", 1986]]);
});

function scratch(queue, ratings) {
  const dir = mkdtempSync(path.join(tmpdir(), "queue-"));
  writeFileSync(path.join(dir, "watchlist.json"), JSON.stringify(queue));
  writeFileSync(path.join(dir, "ratings.json"), JSON.stringify(ratings));
  return dir;
}

test("clearRatedFromQueue: every rating writer's call leaves no title in both files; second call is a no-op", () => {
  const dir = scratch([q(1, "Heat", 1995), q(2, "Ran", 1985)], [{ title: "Ran", year: 1985, score: 5 }]);
  assert.equal(clearRatedFromQueue(dir).length, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "watchlist.json"), "utf8")), [q(1, "Heat", 1995)]);
  assert.equal(clearRatedFromQueue(dir).length, 0);
  assert.ok(!readdirSync(dir).some((f) => f.endsWith(".tmp")));
});

test("clearRatedFromQueue: unreadable queue throws instead of being treated as empty", () => {
  const dir = scratch([], [{ title: "Ran", year: 1985 }]);
  writeFileSync(path.join(dir, "watchlist.json"), "[{");
  assert.throws(() => clearRatedFromQueue(dir), /not valid JSON/);
  assert.equal(readFileSync(path.join(dir, "watchlist.json"), "utf8"), "[{");
});

test("repair-queue: dry run reports and writes nothing; --apply repairs", () => {
  const dir = scratch([q(1, "Heat", 1995), q(2, "Ran", 1985)], [{ title: "Ran", year: 1985, score: 5 }]);
  const before = readFileSync(path.join(dir, "watchlist.json"), "utf8");
  const run = (...a) => execFileSync(process.execPath, [path.join(root, "scripts/repair-queue.mjs"), "--dir", dir, ...a], { encoding: "utf8" });
  assert.match(run(), /watchlist: 1 already in ratings\n.*Ran \(1985\)[\s\S]*Dry run: 1/);
  assert.equal(readFileSync(path.join(dir, "watchlist.json"), "utf8"), before);
  assert.match(run("--apply"), /Removed 1/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, "watchlist.json"), "utf8")).length, 1);
});
