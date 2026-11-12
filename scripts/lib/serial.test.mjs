import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeSerial, writeJsonAtomic, readJsonStrict } from "./atomic-json.mjs";

test("makeSerial: interleaved read-modify-write jobs lose no update", async () => {
  const serial = makeSerial();
  let value = [];
  const add = (x) => serial(async () => { const copy = [...value]; await new Promise((r) => setTimeout(r, 5)); copy.push(x); value = copy; });
  await Promise.all([add(1), add(2), add(3)]);
  assert.deepEqual(value, [1, 2, 3]);
});

test("makeSerial: a failing job does not block the next one", async () => {
  const serial = makeSerial();
  await assert.rejects(serial(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await serial(async () => 7), 7);
});

test("writeJsonAtomic leaves no temp file; readJsonStrict: only ENOENT falls back", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atomic-"));
  const f = path.join(dir, "a.json");
  assert.deepEqual(readJsonStrict(f, []), []);
  assert.throws(() => readJsonStrict(f), /ENOENT/);
  writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(readJsonStrict(f), { a: 1 });
  assert.deepEqual(readdirSync(dir), ["a.json"]);
  writeFileSync(f, "{");
  assert.throws(() => readJsonStrict(f, []), /not valid JSON/);
  assert.equal(readFileSync(f, "utf8"), "{");
});
