import test from "node:test";
import assert from "node:assert/strict";
import { parseRss, parseFilmsGrid, isChallenge, chooseEntries, mergeEntries, lastFilmsPage } from "./letterboxd.mjs";

const rss = `<rss><channel><item><title>x</title><link>https://letterboxd.com/u/film/a/</link>
<letterboxd:watchedDate>2026-10-01</letterboxd:watchedDate><letterboxd:rewatch>Yes</letterboxd:rewatch>
<letterboxd:filmTitle>Heat</letterboxd:filmTitle><letterboxd:filmYear>1995</letterboxd:filmYear>
<letterboxd:memberRating>4.5</letterboxd:memberRating></item>
<item><title>a list</title></item></channel></rss>`;

test("parseRss reads film items and skips non-film items", () => {
  const [e, ...rest] = parseRss(rss);
  assert.equal(rest.length, 0);
  assert.deepEqual(e, { title: "Heat", year: 1995, rating: 4.5, rewatch: true, watched: "2026-10-01", link: "https://letterboxd.com/u/film/a/" });
});

test("parseRss on a valid empty feed returns []", () => {
  assert.deepEqual(parseRss("<rss><channel><title>t</title></channel></rss>"), []);
});

const grid = `<ul><li class="griditem"><div data-item-name="Lee Cronin&#039;s The Mummy (2026)" data-item-slug="lee-x"></div>
<p class="poster-viewingdata"><span class="rating -micro -darker rated-7">★★★½</span> <span class="like liked-micro has-icon icon-liked"></span></p></li>
<li class="griditem"><div data-item-name="Primetime (2026)" data-item-slug="primetime-2026"></div><p class="poster-viewingdata"></p></li>
<li class="griditem"><div data-item-name="Heat (1995)" data-item-slug="heat"></div><p class="poster-viewingdata"><span class="rating -micro rated-10"></span></p></li></ul>
<a href="/u/films/page/2/">2</a><a href="/u/films/page/5/">5</a>`;

test("parseFilmsGrid: rating, like, undated flag, entity decoding", () => {
  const f = parseFilmsGrid(grid);
  assert.equal(f.length, 3);
  assert.deepEqual([f[0].title, f[0].year, f[0].rating, f[0].liked, f[0].undated, f[0].watched], ["Lee Cronin's The Mummy", 2026, 3.5, true, true, null]);
  assert.deepEqual([f[1].rating, f[1].liked], [null, false]);
  assert.deepEqual([f[2].rating, f[2].liked], [5, false]);
  assert.equal(lastFilmsPage(grid), 5);
});

test("isChallenge recognises Cloudflare interstitials", () => {
  assert.ok(isChallenge(403, ""));
  assert.ok(isChallenge(200, "<title>Just a moment...</title>"));
  assert.ok(!isChallenge(200, "<title>films</title>"));
});

test("never overwrite existing data with an empty result", () => {
  const prev = [{ title: "Heat", year: 1995 }];
  assert.deepEqual(chooseEntries(prev, []), { entries: prev, kept: true });
  assert.deepEqual(chooseEntries([], []), { entries: [], kept: false });
  const next = [{ title: "Ran", year: 1985 }];
  assert.deepEqual(chooseEntries(prev, next), { entries: next, kept: false });
});

test("mergeEntries dedupes, upgrades undated to dated, keeps likes", () => {
  const prev = [{ title: "Heat", year: 1995, watched: "2026-10-01", rating: 4 }, { title: "Ran", year: 1985, watched: null, undated: true }];
  const next = [
    { title: "Heat", year: 1995, watched: null, undated: true, liked: true },
    { title: "Heat", year: 1995, watched: "2026-10-01", rating: 4.5 },
    { title: "Ran", year: 1985, watched: "2026-10-05" },
  ];
  const m = mergeEntries(prev, next);
  assert.equal(m.length, 2);
  assert.equal(m.find((e) => e.title === "Heat").rating, 4.5);
  assert.equal(m.find((e) => e.title === "Ran").watched, "2026-10-05");
  assert.equal(mergeEntries(m, next).length, 2); // idempotent
});
