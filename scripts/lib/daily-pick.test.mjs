import test from "node:test";
import assert from "node:assert/strict";
import { hashString, mulberry32, dateKey, shiftDateKey, weightedSample, dailySample } from "./daily-pick.mjs";

const pool = Array.from({ length: 100 }, (_, i) => ({ id: i }));
const ids = (xs) => xs.map((x) => x.id);

test("rng is deterministic and in [0,1)", () => {
  const a = mulberry32(hashString("2026-10-25")), b = mulberry32(hashString("2026-10-25"));
  for (let i = 0; i < 50; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test("same date same output, different dates differ", () => {
  const w = () => 1;
  const a = ids(dailySample(pool, { weight: w, id: (x) => x.id, k: 30, date: "2026-10-25" }));
  assert.deepEqual(a, ids(dailySample(pool, { weight: w, id: (x) => x.id, k: 30, date: "2026-10-25" })));
  const b = ids(dailySample(pool, { weight: w, id: (x) => x.id, k: 30, date: "2026-10-26" }));
  assert.notDeepEqual(a, b);
});

test("no duplicates, honors k and pool size, drops zero weights", () => {
  const s = ids(weightedSample(pool, (x) => (x.id < 10 ? 0 : 1), 30, "s"));
  assert.equal(s.length, 30); assert.equal(new Set(s).size, 30); assert.ok(s.every((i) => i >= 10));
  assert.equal(weightedSample(pool.slice(0, 5), () => 1, 30, "s").length, 5);
});

test("weights are respected statistically", () => {
  let heavy = 0, light = 0;
  for (let d = 0; d < 400; d++) {
    for (const x of weightedSample(pool, (p) => (p.id < 50 ? 3 : 1), 20, `seed${d}`)) (x.id < 50 ? heavy++ : light++);
  }
  const ratio = heavy / light;
  assert.ok(ratio > 2 && ratio < 4, `ratio ${ratio}`);
});

test("freshness halves yesterday's picks", () => {
  const opts = { weight: () => 1, id: (x) => x.id, k: 30, salt: "t" };
  let inY = 0, outY = 0, nIn = 0, nOut = 0;
  for (let d = 0; d < 300; d++) {
    const day = shiftDateKey("2026-01-02", d);
    const y = new Set(ids(weightedSample(pool, () => 1, 30, `t|${shiftDateKey(day, -1)}`)));
    const today = new Set(ids(dailySample(pool, { ...opts, date: day })));
    for (const p of pool) { if (y.has(p.id)) { nIn++; if (today.has(p.id)) inY++; } else { nOut++; if (today.has(p.id)) outY++; } }
  }
  const rIn = inY / nIn, rOut = outY / nOut;
  assert.ok(rIn < rOut * 0.75 && rIn > rOut * 0.3, `in ${rIn} out ${rOut}`);
});

test("dateKey uses Los Angeles calendar day", () => {
  assert.equal(dateKey(new Date("2026-10-26T05:00:00Z")), "2026-10-25");
  assert.equal(dateKey(new Date("2026-10-26T08:00:00Z")), "2026-10-26");
  assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
});
