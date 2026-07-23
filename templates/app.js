// taste — client app. Fetches data/*.json, renders tabs, and (when the local
// server's write API is present) logs films, edits the queue, records verdicts.

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
// data files support **bold** / *italic*; everything else is escaped
const md = (s) =>
  esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");

const state = {
  data: {},
  canWrite: false,
  tab: "watch",
  q: "",
  filmSort: "score",
  filmTier: "all",
};

// ---------- data ----------

async function loadAll() {
  const files = ["config", "profile", "ratings", "directors", "watchlist", "old-films", "calibration", "lineage", "cohorts"];
  const results = await Promise.all(
    files.map((f) => fetch(`data/${f}.json`).then((r) => (r.ok ? r.json() : null)))
  );
  files.forEach((f, i) => (state.data[f] = results[i]));
  state.data.enrichment = await fetch("data/enrichment.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  state.canWrite = await fetch("api/health").then((r) => r.ok).catch(() => false);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

// ---------- shared bits ----------

function stars(score) {
  if (score == null) return `<span class="stars none">reaction only</span>`;
  const full = "★".repeat(Math.floor(score));
  const half = score % 1 ? `<span class="half">½</span>` : "";
  return `<span class="stars" title="${score}">${full}${half}</span>`;
}

const confClass = (c) => ({ high: "high", medium: "medium", low: "low" }[c] ?? "test");

function availability(film) {
  const e = state.data.enrichment?.[`${film.title} (${film.year})`];
  if (!e?.providers) return "";
  const bits = [];
  if (e.providers.flatrate?.length) bits.push(`<b>stream</b> ${esc(e.providers.flatrate.slice(0, 3).join(", "))}`);
  else if (e.providers.rent?.length) bits.push(`<b>rent</b> ${esc(e.providers.rent.slice(0, 3).join(", "))}`);
  if (!bits.length) return "";
  return `<div class="avail">${bits.join(" · ")}</div>`;
}

const matches = (q, ...fields) =>
  !q || fields.some((f) => String(f ?? "").toLowerCase().includes(q));

// ---------- header ----------

function renderHeader() {
  const { config, ratings, directors } = state.data;
  const scored = ratings.filter((f) => typeof f.score === "number");
  const complete = directors.filter((d) => !d.remaining.length && !d.openEnded);
  $("#stats").innerHTML = `
    <div><b>${config.filmsSeen}</b> seen</div>
    <div><b>${scored.length}</b> rated</div>
    <div><b>${scored.filter((f) => f.score === 5).length}</b> perfect</div>
    <div><b>${complete.length}</b> runs closed</div>`;
  document.title = config.siteTitle ?? "taste";
  $("#foot").innerHTML = `${md(state.data.profile.footer)}${state.canWrite ? "" : ` <span class="readonly">read-only · run npm start to log</span>`}`;
  if (!state.canWrite) $("#log-open").hidden = true;
}

// ---------- watch next ----------

function renderWatch() {
  const { watchlist, "old-films": oldFilms } = state.data;
  const q = state.q;
  const items = watchlist
    .filter((f) => matches(q, f.title, f.director, f.why))
    .sort((a, b) => a.rank - b.rank);

  const queueHtml = items.length
    ? items
        .map(
          (f) => `
    <div class="card qcard" data-title="${esc(f.title)}" data-year="${f.year}">
      <div class="rank">${f.rank}</div>
      <div class="title">${esc(f.title)}</div>
      <div class="side">
        <span class="chip ${confClass(f.confidence)}">${esc(f.confidence)}</span>
        ${state.canWrite ? `<button class="btn small act-logged">Logged it</button><button class="btn small act-drop">Remove</button>` : ""}
      </div>
      <div class="meta">${f.year} · ${esc(f.director)}${f.runtime ? " · " + esc(f.runtime) : ""}</div>
      <div class="why">${md(f.why)}</div>
      ${availability(f)}
    </div>`
        )
        .join("")
    : `<div class="empty">${q ? "Nothing in the queue matches that search." : "Queue is empty — add the next thing worth arguing for."}</div>`;

  const trials = oldFilms.filter((f) => matches(q, f.title, f.note));
  const trialHtml = trials
    .map(
      (f) => `
    <div class="card trial" data-title="${esc(f.title)}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
        <div class="title" style="font-weight:600">${esc(f.title)} <span class="yr" style="font:500 12px var(--mono);color:var(--dim)">${f.year} · ${esc(f.runtime)}</span></div>
        <span class="risk">${esc(f.risk)}${f.risk === "committed" ? "" : " risk"}</span>
      </div>
      <div class="why" style="font-size:14px;margin-top:5px;color:var(--dim)">${md(f.note)}</div>
      ${
        f.verdict
          ? `<div class="verdict">Verdict: ${md(f.verdict)}</div>`
          : state.canWrite
          ? `<div class="verdict-in"><input placeholder="verdict after watching…" aria-label="Verdict for ${esc(f.title)}"><button class="btn small act-verdict">Save</button></div>`
          : ""
      }
    </div>`
    )
    .join("");

  $("#tab-watch").innerHTML = `
    <h2 class="sect">Up next <span class="n">· ${items.length}</span>${state.canWrite ? ` <button class="btn small" id="queue-open" style="margin-left:10px">+ Add</button>` : ""}</h2>
    <p class="lede">The ranked argument for what to watch, not a wishlist. Logging a film clears it from the queue.</p>
    ${queueHtml}
    <h2 class="sect">Old films — on trial <span class="n">· ${trials.filter((f) => !f.verdict).length} open</span></h2>
    <p class="lede">${md(state.data.profile.oldFilmsIntro)} Verdicts recorded here turn the age question into data.</p>
    ${trialHtml}`;

  $("#queue-open")?.addEventListener("click", () => $("#queue-dialog").showModal());

  $$("#tab-watch .act-logged").forEach((b) =>
    b.addEventListener("click", () => {
      const card = b.closest(".qcard");
      openLogDialog({
        title: card.dataset.title,
        year: card.dataset.year,
        director: card.querySelector(".meta").textContent.split("·")[1]?.trim() ?? "",
      });
    })
  );
  $$("#tab-watch .act-drop").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".qcard");
      await api("api/watchlist/remove", { title: card.dataset.title, year: Number(card.dataset.year) });
      await refresh();
    })
  );
  $$("#tab-watch .act-verdict").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".trial");
      const input = card.querySelector("input");
      if (!input.value.trim()) return input.focus();
      await api("api/oldfilms/verdict", { title: card.dataset.title, verdict: input.value.trim() });
      await refresh();
    })
  );
}

// ---------- films ----------

function renderFilms() {
  const { ratings } = state.data;
  const q = state.q;

  let films = ratings.filter((f) => matches(q, f.title, f.director, f.note));
  if (state.filmTier !== "all") {
    films = films.filter((f) =>
      state.filmTier === "unscored" ? f.score == null : f.score === Number(state.filmTier)
    );
  }
  const sorters = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.year - a.year,
    year: (a, b) => b.year - a.year,
    title: (a, b) => a.title.localeCompare(b.title),
  };
  films = [...films].sort(sorters[state.filmSort]);

  const tiers = [...new Set(ratings.filter((f) => f.score != null).map((f) => f.score))].sort((a, b) => b - a);
  const chips = [
    `<button class="fchip" data-tier="all" aria-pressed="${state.filmTier === "all"}">all</button>`,
    ...tiers.map(
      (t) => `<button class="fchip" data-tier="${t}" aria-pressed="${state.filmTier === String(t)}">${t}★</button>`
    ),
    `<button class="fchip" data-tier="unscored" aria-pressed="${state.filmTier === "unscored"}">unscored</button>`,
  ].join("");

  const rows = films.length
    ? films
        .map(
          (f) => `
    <div class="frow">
      <div class="t">${esc(f.title)}<span class="yr">${f.year}</span><div class="d">${esc(f.director ?? "—")}</div></div>
      ${stars(f.score)}
      ${f.note ? `<div class="note">${md(f.note)}</div>` : ""}
    </div>`
        )
        .join("")
    : `<div class="empty">No films match. Log one — the profile only knows what you tell it.</div>`;

  $("#tab-films").innerHTML = `
    <h2 class="sect">The log <span class="n">· ${films.length} shown</span></h2>
    <div class="controls">
      <select id="film-sort" aria-label="Sort films">
        <option value="score" ${state.filmSort === "score" ? "selected" : ""}>by score</option>
        <option value="year" ${state.filmSort === "year" ? "selected" : ""}>by year</option>
        <option value="title" ${state.filmSort === "title" ? "selected" : ""}>by title</option>
      </select>
      ${chips}
    </div>
    ${rows}
    <div class="lede" style="margin-top:16px">${md(state.data.profile.ratingsNote)}</div>`;

  $("#film-sort").addEventListener("change", (e) => {
    state.filmSort = e.target.value;
    renderFilms();
  });
  $$("#tab-films .fchip").forEach((c) =>
    c.addEventListener("click", () => {
      state.filmTier = c.dataset.tier;
      renderFilms();
    })
  );
}

// ---------- directors ----------

function renderDirectors() {
  const { directors } = state.data;
  const q = state.q;
  const rows = directors
    .filter((d) => matches(q, d.name, d.note, d.remaining.join(" ")))
    .map((d) => {
      const done = !d.remaining.length && !d.openEnded;
      const cap = 14;
      const seenDots = Math.min(d.seen, cap);
      const todoDots = Math.min(d.remaining.length, cap - Math.min(seenDots, cap - 1));
      const dots =
        `<span class="dot"></span>`.repeat(seenDots) +
        (d.seen > cap ? `<span class="more">+${d.seen - cap}</span>` : "") +
        `<span class="dot todo"></span>`.repeat(todoDots) +
        (d.openEnded ? `<span class="more">+</span>` : "");
      const status = done
        ? `<span class="chip done">complete</span>`
        : `<span class="chip left">${d.remaining.length}${d.openEnded ? "+" : ""} left</span>`;
      return `
    <div class="drow">
      <div class="head"><span class="name">${esc(d.name)}</span>${status}
        <span style="margin-left:auto;font:500 12px var(--mono);color:var(--dim)">${d.seen} seen</span></div>
      <div class="sprockets" aria-label="${d.seen} seen, ${d.remaining.length}${d.openEnded ? " or more" : ""} remaining">${dots}</div>
      <div class="note">${md(d.note)}</div>
      ${d.remaining.length ? `<div class="queue-names">next: ${d.remaining.map(esc).join(" · ")}</div>` : ""}
    </div>`;
    })
    .join("");

  $("#tab-directors").innerHTML = `
    <h2 class="sect">Filmography runs</h2>
    <p class="lede">${md(state.data.profile.directorsIntro)} Filled sprockets are films seen; hollow ones are what's left.</p>
    ${rows || `<div class="empty">No directors match that search.</div>`}`;
}

// ---------- taste ----------

function renderTaste() {
  const { profile, calibration, lineage, cohorts } = state.data;
  $("#tab-taste").innerHTML = `
    <h2 class="sect">The shape</h2>
    <div class="prose"><p><strong>${md(profile.shape.heading)}.</strong></p>
    ${profile.shape.paragraphs.map((p) => `<p>${md(p)}</p>`).join("")}</div>

    <h2 class="sect">Rules for picking</h2>
    <div class="grid2">
      <div class="card rulecard reach"><h3>Reach for</h3><ul>${calibration.reachFor.map((r) => `<li>${md(r)}</li>`).join("")}</ul></div>
      <div class="card rulecard avoid"><h3>Avoid</h3><ul>${calibration.avoid.map((r) => `<li>${md(r)}</li>`).join("")}</ul></div>
    </div>

    <h2 class="sect">Lineage</h2>
    <p class="lede">${md(profile.lineageIntro)}</p>
    ${lineage
      .map(
        (c) => `<div class="chain"><div class="cname">${esc(c.name)}</div>
      ${c.links.map((l) => `<div class="link${l.here ? " here" : ""}">${md(l.who)}</div>`).join("")}
      <div class="gap">${md(c.gap)}</div></div>`
      )
      .join("")}

    <h2 class="sect">Cohorts</h2>
    <p class="lede">${md(profile.cohortsIntro)}</p>
    <div class="grid2">
    ${cohorts
      .map(
        (c) => `<div class="card cohort"><div class="cname">${esc(c.name)}</div>
      <div class="era">${esc(c.era)}</div>
      <div class="have">${md(c.have)}</div><div class="miss">${md(c.missing)}</div></div>`
      )
      .join("")}
    </div>

    <h2 class="sect">What this can't see</h2>
    <div class="card rulecard"><ul>${calibration.blindSpots.map((r) => `<li>${md(r)}</li>`).join("")}</ul></div>`;
}

// ---------- dialogs ----------

function openLogDialog(prefill = {}) {
  const form = $("#log-form");
  form.reset();
  form.title.value = prefill.title ?? "";
  form.year.value = prefill.year ?? "";
  form.director.value = prefill.director ?? "";
  $("#log-title").textContent = prefill.title ? `Log “${prefill.title}”` : "Log a film";
  $("#log-dialog").showModal();
}

function wireDialogs() {
  $("#log-open").addEventListener("click", () => openLogDialog());
  $("#log-cancel").addEventListener("click", () => $("#log-dialog").close());
  $("#queue-cancel").addEventListener("click", () => $("#queue-dialog").close());

  $("#log-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    await api("api/ratings", {
      title: f.title.value.trim(),
      year: Number(f.year.value),
      director: f.director.value.trim() || null,
      score: f.score.value === "" ? null : Number(f.score.value),
      note: f.note.value.trim() || undefined,
    });
    $("#log-dialog").close();
    await refresh();
  });

  $("#queue-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    await api("api/watchlist", {
      title: f.title.value.trim(),
      year: Number(f.year.value),
      director: f.director.value.trim() || null,
      confidence: f.confidence.value,
      why: f.why.value.trim() || "",
    });
    $("#queue-dialog").close();
    await refresh();
  });
}

// ---------- shell ----------

const renderers = { watch: renderWatch, films: renderFilms, directors: renderDirectors, taste: renderTaste };

function show(tab) {
  state.tab = renderers[tab] ? tab : "watch";
  $$(".tab").forEach((s) => (s.hidden = s.id !== `tab-${state.tab}`));
  $$(".tabs a").forEach((a) =>
    a.dataset.tab === state.tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")
  );
  renderers[state.tab]();
}

async function refresh() {
  await loadAll();
  renderHeader();
  show(state.tab);
}

window.addEventListener("hashchange", () => show(location.hash.slice(1) || "watch"));
$("#search").addEventListener("input", (e) => {
  state.q = e.target.value.trim().toLowerCase();
  renderers[state.tab]();
});

await loadAll();
renderHeader();
wireDialogs();
show(location.hash.slice(1) || "watch");
