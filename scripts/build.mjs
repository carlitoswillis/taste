#!/usr/bin/env node
// Build the taste-profile site: data/*.json + templates/ -> dist/index.html
// Zero dependencies. Run: node scripts/build.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = async (p) => JSON.parse(await readFile(path.join(root, p), "utf8"));
const readOptional = async (p) => (existsSync(path.join(root, p)) ? read(p) : null);

const config = await read("config.json");
const profile = await read("data/profile.json");
const ratings = await read("data/ratings.json");
const directors = await read("data/directors.json");
const watchlist = await read("data/watchlist.json");
const oldFilms = await read("data/old-films.json");
const calibration = await read("data/calibration.json");
const lineage = await read("data/lineage.json");
const cohorts = await read("data/cohorts.json");
const enrichment = (await readOptional("data/enrichment.json")) ?? {};
const letterboxd = await readOptional("data/letterboxd.json");

// --- tiny helpers -----------------------------------------------------------

const esc = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Data files use **bold** and *italic*; everything else is escaped.
const md = (s) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

const enrichKey = (f) => `${f.title} (${f.year})`;

function availability(film) {
  const e = enrichment[enrichKey(film)];
  if (!e?.providers) return "";
  const parts = [];
  if (e.providers.flatrate?.length) parts.push(`<b>Stream:</b> ${esc(e.providers.flatrate.join(", "))}`);
  if (e.providers.rent?.length) parts.push(`<b>Rent:</b> ${esc(e.providers.rent.join(", "))}`);
  if (!parts.length) return "";
  return `<div class="avail">${parts.join(" · ")}</div>`;
}

// --- sections ---------------------------------------------------------------

const scored = ratings.filter((f) => typeof f.score === "number");
const perfect = scored.filter((f) => f.score === 5);
const unrated = ratings.filter((f) => f.score === null);

const TIER_NAMES = {
  5: "Five stars", 4.5: "Four and a half", 4: "Four", 3.5: "Three and a half",
  3: "Three", 2.5: "Two and a half", 2: "Two", 1.5: "One and a half",
  1: "One", 0.5: "Half a star",
};

function tiersHtml() {
  const byScore = new Map();
  for (const f of scored) {
    if (!byScore.has(f.score)) byScore.set(f.score, []);
    byScore.get(f.score).push(f);
  }
  const scores = [...byScore.keys()].sort((a, b) => b - a);
  const floor = scores[scores.length - 1];
  return scores
    .map((score) => {
      const films = byScore.get(score);
      const count = score === floor ? "the floor" : `${films.length} film${films.length === 1 ? "" : "s"}`;
      const list = films
        .map((f) => (score === floor && f.note ? `${esc(f.title)} — ${esc(f.note.split(".")[1]?.trim() ?? f.note)}` : esc(f.title)))
        .join(" · ");
      return `  <div class="tier">
    <div class="lbl">${TIER_NAMES[score] ?? score + " stars"} <span>${count}</span></div>
    <div class="films">${list}</div>
  </div>`;
    })
    .join("\n");
}

const statusTag = (status) =>
  status === "complete"
    ? `<span class="tag done">Complete</span>`
    : `<span class="tag">${esc(status[0].toUpperCase() + status.slice(1))}</span>`;

const directorsHtml = directors
  .map(
    (d) => `  <div class="row">
    <div class="top">${esc(d.name)} ${statusTag(d.status)}</div>
    <div class="note">${md(d.note)}</div>
  </div>`
  )
  .join("\n");

const lineageHtml = lineage
  .map(
    (c) => `  <div class="chain">
    <div class="name">${esc(c.name)}</div>
${c.links.map((l) => `    <div class="link${l.here ? " here" : ""}">${md(l.who)}</div>`).join("\n")}
    <div class="gap">${md(c.gap)}</div>
  </div>`
  )
  .join("\n");

const cohortsHtml = cohorts
  .map(
    (c) => `  <div class="cohort">
    <div class="name">${esc(c.name)}</div>
    <div class="yrs">${esc(c.era)}</div>
    <div class="have">${md(c.have)}</div>
    <div class="miss">${md(c.missing)}</div>
  </div>`
  )
  .join("\n");

const watchNextHtml = watchlist
  .filter((f) => f.rank <= 12)
  .map((f) => {
    const meta = [f.year, f.director, f.runtime].filter(Boolean).join(" · ");
    return `  <div class="row">
    <div class="top">${f.rank}. ${esc(f.title)}</div>
    <div class="meta">${esc(meta)}</div>
    <div class="why">${md(f.why)}</div>${availability(f) ? "\n    " + availability(f) : ""}
  </div>`;
  })
  .join("\n");

const oldFilmsHtml = oldFilms
  .map((f) => {
    const tag = f.risk === "committed" ? ` <span class="tag">Committed</span>` : "";
    const risk = f.risk === "committed" ? "" : ` · ${f.risk} risk`;
    const verdict = f.verdict ? `\n    <div class="avail"><b>Verdict:</b> ${md(f.verdict)}</div>` : "";
    return `  <div class="row">
    <div class="top">${esc(f.title)}${tag}</div>
    <div class="meta">${f.year} · ${esc(f.runtime)}${esc(risk)}</div>
    <div class="why">${md(f.note)}</div>${verdict}
  </div>`;
  })
  .join("\n");

const listHtml = (items) => items.map((i) => `    <li>${md(i)}</li>`).join("\n");

function recentHtml() {
  if (!letterboxd?.entries?.length) return "";
  const stars = (r) => (r == null ? "logged" : "★".repeat(Math.floor(r)) + (r % 1 ? "½" : ""));
  const rows = letterboxd.entries
    .slice(0, 10)
    .map(
      (e) => `  <div class="recent">
    <div><a href="${esc(e.link)}">${esc(e.title)}</a> <span style="color:var(--mid)">${e.year ?? ""}</span></div>
    <div class="stars">${stars(e.rating)}${e.rewatch ? " · rewatch" : ""}</div>
  </div>`
    )
    .join("\n");
  return `
<section class="wrap">
  <h2>Recently logged</h2>
  <p style="margin-bottom:14px;color:var(--mid);font-size:14px">Pulled from Letterboxd on ${esc(letterboxd.fetched?.slice(0, 10) ?? "—")}.</p>
${rows}
</section>
`;
}

// --- page -------------------------------------------------------------------

const css = await readFile(path.join(root, "templates/style.css"), "utf8");
const updated = new Date().toISOString().slice(0, 10);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.siteTitle)}</title>
<style>
${css}</style>
</head>
<body>

<header class="wrap">
  <h1>${esc(config.siteTitle)}</h1>
  <div class="sub">Living document · built ${updated}</div>
  <div class="counts">
    <div><b>${config.filmsSeen}</b>films seen</div>
    <div><b>${scored.length}</b>rated</div>
    <div><b>${perfect.length}</b>perfect scores</div>
    <div><b>${config.filmographiesFinished}</b>filmographies finished</div>
  </div>
</header>

<section class="wrap">
  <h2>The shape</h2>
  <h3>${md(profile.shape.heading)}</h3>
${profile.shape.paragraphs.map((p) => `  <p>${md(p)}</p>`).join("\n")}
</section>

<section class="wrap">
  <h2>The ${scored.length} scores</h2>
${tiersHtml()}
  <div class="tier">
    <div class="lbl">On record, unscored <span>${unrated.length} films</span></div>
    <div class="films">${unrated.map((f) => esc(f.title)).join(" · ")}</div>
  </div>
  <div class="box">${md(profile.ratingsNote)}</div>
</section>

<section class="wrap">
  <h2>Directors — the engine</h2>
  <p style="margin-bottom:18px">${md(profile.directorsIntro)}</p>
${directorsHtml}
</section>

<section class="wrap">
  <h2>Lineage</h2>
  <h3>You've been collecting descendants without the ancestors</h3>
  <p>${md(profile.lineageIntro)}</p>
${lineageHtml}
</section>

<section class="wrap">
  <h2>Cohorts</h2>
  <h3>Who was working at the same time</h3>
  <p>${md(profile.cohortsIntro)}</p>
${cohortsHtml}
</section>

<section class="wrap">
  <h2>Watch next</h2>
${watchNextHtml}
${profile.watchNextNotes.map((n) => `  <div class="box" style="margin-bottom:18px">${md(n)}</div>`).join("\n")}
</section>

<section class="wrap">
  <h2>Old films — on trial</h2>
  <p>${md(profile.oldFilmsIntro)}</p>
${oldFilmsHtml}
</section>

<section class="wrap">
  <h2>Rules for picking</h2>
  <h3>Reach for</h3>
  <ul>
${listHtml(calibration.reachFor)}
  </ul>
  <h3 style="margin-top:22px">Avoid</h3>
  <ul>
${listHtml(calibration.avoid)}
  </ul>
</section>

<section class="wrap">
  <h2>What this can't see</h2>
  <ul>
${listHtml(calibration.blindSpots)}
  </ul>
</section>
${recentHtml()}
<footer class="wrap">
  ${md(profile.footer)}
</footer>

</body>
</html>
`;

await mkdir(path.join(root, "dist"), { recursive: true });
await writeFile(path.join(root, "dist/index.html"), html);
console.log(`Built dist/index.html (${(html.length / 1024).toFixed(1)} KB)`);
