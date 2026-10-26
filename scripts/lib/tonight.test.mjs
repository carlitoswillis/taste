import test from "node:test";
import assert from "node:assert/strict";
import { baseScore, signals, whyLine, parseRuntime, round05, daysBetween } from "./tonight.mjs";

test("parseRuntime reads minutes and 1h55 forms", () => {
  assert.equal(parseRuntime(127), 127);
  assert.equal(parseRuntime("1h55"), 115);
  assert.equal(parseRuntime("2h05"), 125);
  assert.equal(parseRuntime("98 min"), 98);
  assert.equal(parseRuntime(null), undefined);
});

test("baseScore follows the spec weights and rounds to 0.05", () => {
  // rank 6 of 19, imdb 8.6, unknown affinity, no thread, not new: .4*(1-5/38) + .25*.8667 + .2*.3 = .3474+.2167+.06 = .624 -> .60
  assert.equal(baseScore({ rank: 6, n: 19, rating: 8.6 }), 0.6);
  assert.equal(baseScore({ source: "letterboxd", rating: 6 }), round05(0.4 * 0.45 + 0.06));
  assert.equal(baseScore({ rank: 1, n: 19, rating: 9, thread: {}, isNew: true, sameDirector14d: true, moodHits: 1 }) <= 1, true);
  assert.equal(baseScore({ n: 1, rating: 0, sameDirector14d: true, moodHits: 3 }), 0); // never negative
});

const recent = [
  { title: "Zodiac", date: "2026-08-10", score: 4.5, directors: ["David Fincher"], cast: ["Jake Gyllenhaal"], genres: ["Crime"] },
  { title: "Old Low", date: "2026-10-20", score: 2, directors: ["Someone"], cast: ["A", "B"], genres: ["Crime"] },
];
test("signals: thread needs score >= 4 within 90 days; sameDirector14d ignores score; mood counts the first genre", () => {
  const s = signals({ directors: ["David Fincher"], cast: [], genres: ["Crime", "Drama"] }, recent, "2026-10-25");
  assert.equal(s.thread.title, "Zodiac");
  assert.equal(s.thread.month, "August");
  assert.equal(s.sameDirector14d, false); // 76 days ago
  assert.equal(s.moodHits, 2);
  const t = signals({ directors: ["Someone"], cast: [], genres: [] }, recent, "2026-10-25");
  assert.equal(t.thread, null);
  assert.equal(t.sameDirector14d, true);
  assert.equal(signals({ directors: ["David Fincher"], cast: [] }, recent, "2026-02-01").thread, null); // diary film is in the future
});

test("whyLine: first rule that applies, <= 52 chars, never a score", () => {
  assert.equal(whyLine({ thread: { kind: "director", name: "David Fincher", title: "Zodiac", month: "July" }, rank: 6 }), "Fincher again, after Zodiac in July");
  assert.equal(whyLine({ thread: { kind: "director", name: "David Fincher", title: "A Very Long Film Title Indeed Yes", month: "July" }, rank: 6 }), "Sixth on your ranked list"); // too long: next rule
  assert.equal(whyLine({ newApp: "Hulu", rank: 6 }), "New on Hulu this week");
  assert.equal(whyLine({ rank: 6, source: "taste" }), "Sixth on your ranked list");
  assert.equal(whyLine({ source: "letterboxd", runtime: 90 }), "On your Letterboxd watchlist, under 100 min");
  assert.equal(whyLine({ source: "taste", rank: 14, runtime: 127 }), "127 minutes");
  assert.equal(whyLine({ thread: { kind: "cast", name: "Rated X", title: "T", month: "May" }, runtime: 100 }), "100 minutes"); // "rated" is skipped
  assert.equal(daysBetween("2026-10-18", "2026-10-25"), 7);
});
