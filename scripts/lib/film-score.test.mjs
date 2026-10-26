import test from "node:test";
import assert from "node:assert/strict";
import { creditFactor, scoreFilm, qualityMultiplier, shrunkRating, describeCredit, UNCORROBORATED } from "./film-score.mjs";

const person = (weight, credits, favourite = false) => ({ weight, credits, favourite });
const dir = [{ kind: "director" }];
const wri = [{ kind: "writer" }];
const sto = [{ kind: "story" }];
const act = (order) => [{ kind: "actor", order }];
const good = { tmdbRating: 7.5, votes: 5000 };

test("director outweighs writer outweighs story; lead outweighs supporting", () => {
  const f = (c, fav) => creditFactor(c, { director: 1, writer: 1 }, fav).factor;
  assert.ok(f(dir) > f(wri) && f(wri) > f(sto));
  assert.ok(f(act(0)) > f(act(4)));
  assert.ok(f(sto, true) > f(sto, false), "a story credit from a 5-star source counts for more");
});

test("anthology: a director's share shrinks by sqrt(count)", () => {
  const solo = creditFactor(dir, { director: 1 }).factor;
  const omnibus = creditFactor(dir, { director: 16 }).factor;
  assert.equal(omnibus, solo / 4);
  const pair = creditFactor(dir, { director: 2 }).factor;
  assert.ok(Math.abs(pair - 1 / Math.SQRT2) < 1e-9);
});

test("a lone writer link cannot pass what a director link earns", () => {
  const writerOnly = scoreFilm([person(3, wri)], { ...good, counts: { writer: 1 } });
  const director = scoreFilm([person(3, dir)], { ...good, counts: { director: 1 } });
  assert.equal(writerOnly.corroborated, false);
  assert.ok(director.score > writerOnly.score * 3);
});

test("corroboration: theme, director, or two independent people lift the cap", () => {
  const base = { ...good, counts: { writer: 2 } };
  const one = scoreFilm([person(4, wri)], base);
  assert.equal(one.corroborated, false);
  assert.equal(scoreFilm([person(4, wri)], { ...base, themeScore: 0.5 }).corroborated, true);
  assert.equal(scoreFilm([person(4, wri), person(4, act(0))], base).corroborated, true);
  const lifted = scoreFilm([person(4, wri)], { ...base, themeScore: 0.5 });
  assert.ok(Math.abs(one.score - lifted.score * UNCORROBORATED) < 1e-9);
  // two links that are each trivial do not count as independent
  assert.equal(scoreFilm([person(4, wri), person(0.2, act(4))], base).corroborated, false);
});

test("quality prior: weak films need stronger links; few votes trust the prior", () => {
  const links = [person(4, dir)];
  const strong = scoreFilm(links, { tmdbRating: 8, votes: 5000, counts: { director: 1 } }).score;
  const weak = scoreFilm(links, { tmdbRating: 5.5, votes: 5000, counts: { director: 1 } }).score;
  assert.ok(strong > weak * 1.5);
  assert.ok(shrunkRating(9.5, 10) < 7, "10 votes cannot make a 9.5");
  assert.ok(qualityMultiplier(10, 1e6) <= 1.2 && qualityMultiplier(1, 1e6) >= 0.4);
});

test("Space Jam shape: two co-writers of a middling film score far below a director link", () => {
  const spaceJam = scoreFilm([person(3.3, wri), person(3.3, wri)], { tmdbRating: 6.1, votes: 2000, counts: { writer: 6 } });
  const bergman = scoreFilm([person(14, dir)], { tmdbRating: 8, votes: 2000, counts: { director: 1 } });
  assert.ok(bergman.score > spaceJam.score * 10);
});

test("why text stays true for anthologies and small parts", () => {
  assert.equal(describeCredit("director", dir, { director: 18 }), "directed a segment of this");
  assert.equal(describeCredit("director", dir, { director: 1 }), "directed this");
  assert.equal(describeCredit("director", [...dir, ...wri], { director: 1 }), "wrote and directed this");
  assert.equal(describeCredit("director", dir, { director: 2 }), "co-directed this");
  assert.equal(describeCredit("writer", wri, { director: 1, writer: 1 }), "wrote this");
  assert.equal(describeCredit("writer", wri, { director: 1, writer: 3 }), "co-wrote this");
  assert.equal(describeCredit("story", sto, {}), "has a story credit here");
  assert.equal(describeCredit("actor", act(0), {}), "stars in this");
  assert.equal(describeCredit("actor", act(4), {}), "appears in this");
});
