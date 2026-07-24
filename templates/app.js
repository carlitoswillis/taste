// taste — client app. Fetches data/*.json, renders tabs, and (when the local
// server's write API is present) logs films, edits the queue, records verdicts.

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
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
  filmTheme: "all",
  kwTheme: new Map(),
  themeName: new Map(),
};

// ---------- data ----------

async function loadAll() {
  const files = ["config", "profile", "ratings", "directors", "watchlist", "old-films", "calibration", "lineage", "cohorts"];
  const results = await Promise.all(
    files.map((f) => fetch(`data/${f}.json`).then((r) => (r.ok ? r.json() : null)))
  );
  files.forEach((f, i) => (state.data[f] = results[i]));
  const optional = async (f, fallback) =>
    fetch(`data/${f}.json`).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
  state.data.enrichment = await optional("enrichment", {});
  state.data.suggestions = await optional("suggestions", null);
  state.data.watched = await optional("watched", null);
  state.data.stats = await optional("stats", null);
  state.data.themes = await optional("themes", null);
  state.data.themeMap = await optional("theme-map", null);
  state.data.tvRatings = await optional("tv-ratings", []);
  state.data.tvWatchlist = await optional("tv-watchlist", []);
  state.data.tvEnrichment = await optional("tv-enrichment", {});
  state.data.tvSuggestions = await optional("tv-suggestions", null);
  state.data.books = await optional("books", []);
  state.data.bookEnrichment = await optional("book-enrichment", {});
  state.data.bookSuggestions = await optional("book-suggestions", null);
  state.data.adaptations = await optional("adaptations", null);
  state.adaptIdx = new Map();
  for (const e of state.data.adaptations?.edges ?? []) {
    if (e.status === "confirmed") state.adaptIdx.set(e.screen, e);
  }
  state.kwTheme = new Map();
  state.themeName = new Map();
  for (const t of state.data.themeMap?.themes ?? []) {
    state.themeName.set(t.id, t.name);
    for (const k of t.keywords ?? []) state.kwTheme.set(k.toLowerCase().trim(), t.id);
  }
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

function stars(score, watchedOnly) {
  if (watchedOnly) return `<span class="stars none">watched</span>`;
  if (score == null) return `<span class="stars none">reaction only</span>`;
  const full = "★".repeat(Math.floor(score));
  const half = score % 1 ? `<span class="half">½</span>` : "";
  return `<span class="stars" title="${score}">${full}${half}</span>`;
}

const confClass = (c) => ({ high: "high", medium: "medium", low: "low" }[c] ?? "test");

const enrichFor = (film) => state.data.enrichment?.[`${film.title} (${film.year})`];
const tvEnrichFor = (show) => state.data.tvEnrichment?.[`${show.title} (${show.year})`];
const bookEnrichFor = (book) => state.data.bookEnrichment?.[`${book.title} (${book.author})`];

const onShelf = (title, author) =>
  (state.data.books ?? []).some(
    (b) => b.title.toLowerCase() === String(title).toLowerCase() && b.author.toLowerCase() === String(author).toLowerCase()
  );

// "novel by Cormac McCarthy · unread" — shown on film cards with a confirmed adaptation edge
function adaptBadge(f) {
  const e = state.adaptIdx?.get(`${f.title} (${f.year})`);
  if (!e) return "";
  return ` <span class="badge-adaptation">novel by ${esc(e.book.author)}${e.read ? "" : ` · <span class="unread">unread</span>`}</span>`;
}

// theme ids for a film, derived client-side: enrichment keywords through the
// curated map, plus assign, minus suppress — editing theme-map.json updates chips
function themesFor(film) {
  const key = `${film.title} (${film.year})`;
  const map = state.data.themeMap;
  if (!map) return [];
  const ids = new Set(map.assign?.[key] ?? []);
  for (const k of enrichFor(film)?.keywords ?? []) {
    const t = state.kwTheme.get(k.name.toLowerCase().trim());
    if (t) ids.add(t);
  }
  for (const t of map.suppress?.[key] ?? []) ids.delete(t);
  return [...ids];
}

const tchips = (ids) =>
  (ids ?? []).map((id) => `<span class="tchip">${esc(state.themeName.get(id) ?? id)}</span>`).join("");

function scoreBits(e) {
  if (!e?.scores) return "";
  const s = [];
  if (e.scores.rt != null) s.push(`RT ${e.scores.rt}%`);
  if (e.scores.metacritic != null) s.push(`MC ${e.scores.metacritic}`);
  if (e.scores.imdb != null) s.push(`IMDb ${e.scores.imdb}`);
  return s.join(" · ");
}

function streamBits(e) {
  if (e?.providers?.flatrate?.length) return `stream: ${esc(e.providers.flatrate.slice(0, 3).join(", "))}`;
  if (e?.providers?.rent?.length) return `rent: ${esc(e.providers.rent.slice(0, 3).join(", "))}`;
  return "";
}

function availability(filmOrEntry, entry) {
  const e = entry ?? enrichFor(filmOrEntry);
  if (!e) return "";
  const bits = [];
  const s = scoreBits(e);
  if (s) bits.push(`<b>${s}</b>`);
  const st = streamBits(e);
  if (st) bits.push(st);
  if (!bits.length) return "";
  return `<div class="avail">${bits.join(" &nbsp;·&nbsp; ")}</div>`;
}

const poster = (e, h = 66) =>
  e?.poster ? `<img class="poster" src="${esc(e.poster)}" alt="" loading="lazy" style="height:${h}px">` : `<span class="poster empty-p" style="height:${h}px"></span>`;

const matches = (q, ...fields) =>
  !q || fields.some((f) => String(f ?? "").toLowerCase().includes(q));

// ---------- header ----------

function renderHeader() {
  const { config, ratings, directors, watched } = state.data;
  const scored = ratings.filter((f) => typeof f.score === "number");
  const complete = directors.filter((d) => !d.remaining.length && !d.openEnded);
  const series = state.data.tvRatings?.length ?? 0;
  const books = state.data.books?.length ?? 0;
  $("#stats").innerHTML = `
    <div><b>${watched?.length ?? config.filmsSeen}</b> seen</div>
    <div><b>${scored.length}</b> rated</div>
    <div><b>${scored.filter((f) => f.score === 5).length}</b> perfect</div>
    <div><b>${complete.length}</b> runs closed</div>
    ${series ? `<div><b>${series}</b> series</div>` : ""}${books ? `<div><b>${books}</b> books</div>` : ""}`;
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
        .map((f) => {
          const e = enrichFor(f);
          const runtime = f.runtime ?? (e?.runtime ? `${Math.floor(e.runtime / 60)}h${String(e.runtime % 60).padStart(2, "0")}` : null);
          return `
    <div class="card qcard" data-title="${esc(f.title)}" data-year="${f.year}">
      <div class="rank">${f.rank}</div>
      ${poster(e)}
      <div class="body">
        <div class="title">${esc(f.title)}</div>
        <div class="meta">${f.year} · ${esc(f.director)}${runtime ? " · " + esc(runtime) : ""}${e?.genres?.length ? " · " + esc(e.genres.slice(0, 2).join(", ")) : ""}${adaptBadge(f)}</div>
        <div class="why">${md(f.why)}</div>
        ${availability(f, e)}
      </div>
      <div class="side">
        <span class="chip ${confClass(f.confidence)}">${esc(f.confidence)}</span>
        ${state.canWrite ? `<button class="btn small act-logged">Logged it</button><button class="btn small act-drop">Remove</button>` : ""}
      </div>
    </div>`;
        })
        .join("")
    : `<div class="empty">${q ? "Nothing in the queue matches that search." : "Queue is empty — add the next thing worth arguing for."}</div>`;

  const sugg = state.data.suggestions;
  const suggItems = (sugg?.items ?? []).filter((s) => matches(q, s.title, s.director?.join(" "), s.why));
  const suggHtml = sugg
    ? suggItems
        .map(
          (s) => `
    <div class="card qcard sugg" data-title="${esc(s.title)}" data-year="${s.year}" data-why="${esc(s.why)}">
      <div class="rank">?</div>
      ${poster(s)}
      <div class="body">
        <div class="title">${esc(s.title)}</div>
        <div class="meta">${s.year} · ${esc(s.director?.join(", ") ?? "")}${s.runtime ? ` · ${Math.floor(s.runtime / 60)}h${String(s.runtime % 60).padStart(2, "0")}` : ""}${s.genres?.length ? " · " + esc(s.genres.slice(0, 2).join(", ")) : ""}${s.themes?.length ? " " + tchips(s.themes) : ""}${adaptBadge(s)}</div>
        <div class="why">Because ${esc(s.why)}</div>
        ${availability(null, s)}
      </div>
      <div class="side">
        ${state.canWrite ? `<button class="btn small act-queue-sugg">Queue it</button><button class="btn small act-logged">Seen it</button>` : ""}
      </div>
    </div>`
        )
        .join("")
    : "";

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

  const suggSection = sugg
    ? `
    <h2 class="sect">Suggested by the data <span class="n">· ${suggItems.length}</span></h2>
    <p class="lede">Generated from the people behind your 4★+ films — directors, writers, actors, weighted by your scores — minus everything already logged. ${state.data.watched ? "" : "<strong>Your full watch history isn't imported yet</strong>, so some of these you'll have seen — run the Letterboxd CSV import to fix that (README has the two steps)."} Regenerate with <span style="font-family:var(--mono)">npm run suggest</span>.</p>
    ${suggHtml || `<div class="empty">No suggestions match that search.</div>`}`
    : "";

  const picks = (sugg?.themePicks ?? []).filter((s) => matches(q, s.title, s.director?.join(" "), s.why));
  const themePickSection = picks.length
    ? `
    <h2 class="sect">From the themes <span class="n">· ${picks.length}</span></h2>
    <p class="lede">One pick per strongest theme — well-rated films carrying the threads your loved films share, no person connection required.</p>
    ${picks
      .map(
        (s) => `
    <div class="card qcard sugg" data-title="${esc(s.title)}" data-year="${s.year}" data-why="${esc(s.why)}">
      <div class="rank">~</div>
      ${poster(s)}
      <div class="body">
        <div class="title">${esc(s.title)}</div>
        <div class="meta">${s.year} · ${esc(s.director?.join(", ") ?? "")}${s.runtime ? ` · ${Math.floor(s.runtime / 60)}h${String(s.runtime % 60).padStart(2, "0")}` : ""}${s.genres?.length ? " · " + esc(s.genres.slice(0, 2).join(", ")) : ""} ${tchips([s.theme])}</div>
        <div class="why">${esc(s.why)}</div>
        ${availability(null, s)}
      </div>
      <div class="side">
        ${state.canWrite ? `<button class="btn small act-queue-sugg">Queue it</button>` : ""}
      </div>
    </div>`
      )
      .join("")}`
    : "";

  $("#tab-watch").innerHTML = `
    <h2 class="sect">Up next <span class="n">· ${items.length}</span>${state.canWrite ? ` <button class="btn small" id="queue-open" style="margin-left:10px">+ Add</button>` : ""}</h2>
    <p class="lede">The ranked argument for what to watch, not a wishlist. Logging a film clears it from the queue.</p>
    ${queueHtml}
    ${suggSection}
    ${themePickSection}
    <h2 class="sect">Old films — on trial <span class="n">· ${trials.filter((f) => !f.verdict).length} open</span></h2>
    <p class="lede">${md(state.data.profile.oldFilmsIntro)} Verdicts recorded here turn the age question into data.</p>
    ${trialHtml}`;

  $("#queue-open")?.addEventListener("click", () => $("#queue-dialog").showModal());

  $$("#tab-watch .act-queue-sugg").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".qcard");
      await api("api/watchlist", {
        title: card.dataset.title,
        year: Number(card.dataset.year),
        director: card.querySelector(".meta").textContent.split("·")[1]?.trim() || null,
        confidence: "medium",
        why: `Suggested: ${card.dataset.why}`,
      });
      await refresh();
    })
  );

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
  const { ratings, watched } = state.data;
  const q = state.q;

  // full watch history (post Letterboxd import) joins the log as unscored rows
  const known = new Set(ratings.map((r) => r.title.toLowerCase()));
  const extras = (watched ?? [])
    .filter((w) => !known.has(w.title.toLowerCase()))
    .map((w) => ({ title: w.title, year: w.year, director: null, score: null, watchedOnly: true }));

  let films = [...ratings, ...extras].filter((f) => matches(q, f.title, f.director, f.note));
  if (state.filmTier !== "all") {
    films = films.filter((f) =>
      state.filmTier === "unscored" ? f.score == null : f.score === Number(state.filmTier)
    );
  }
  if (state.filmTheme !== "all") films = films.filter((f) => themesFor(f).includes(state.filmTheme));
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
  const themeChips = state.themeName.size
    ? [
        `<button class="fchip" data-theme="all" aria-pressed="${state.filmTheme === "all"}">all themes</button>`,
        ...[...state.themeName.keys()].map(
          (id) => `<button class="fchip" data-theme="${esc(id)}" aria-pressed="${state.filmTheme === id}">${esc(id)}</button>`
        ),
      ].join("")
    : "";

  const rows = films.length
    ? films
        .map((f) => {
          const e = enrichFor(f);
          const tids = themesFor(f);
          const facts = [
            e?.runtime ? `${Math.floor(e.runtime / 60)}h${String(e.runtime % 60).padStart(2, "0")}` : null,
            e?.genres?.slice(0, 2).join(", ") || null,
            scoreBits(e) || null,
            streamBits(e) || null,
            adaptBadge(f).trim() || null,
          ].filter(Boolean);
          return `
    <div class="frow">
      <div class="t">${esc(f.title)}<span class="yr">${f.year}</span><div class="d">${esc(f.director ?? (e?.director?.map((d) => d.name).join(", ") || "—"))}</div></div>
      ${stars(f.score, f.watchedOnly)}
      ${facts.length ? `<div class="facts">${facts.join(" &nbsp;·&nbsp; ")}</div>` : ""}
      ${tids.length ? `<div class="facts">${tchips(tids)}</div>` : ""}
      ${f.note ? `<div class="note">${md(f.note)}</div>` : ""}
    </div>`;
        })
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
    ${themeChips ? `<div class="controls">${themeChips}</div>` : ""}
    ${rows}
    <div class="lede" style="margin-top:16px">${md(state.data.profile.ratingsNote)}</div>`;

  $("#film-sort").addEventListener("change", (e) => {
    state.filmSort = e.target.value;
    renderFilms();
  });
  $$("#tab-films .fchip[data-tier]").forEach((c) =>
    c.addEventListener("click", () => {
      state.filmTier = c.dataset.tier;
      renderFilms();
    })
  );
  $$("#tab-films .fchip[data-theme]").forEach((c) =>
    c.addEventListener("click", () => {
      state.filmTheme = c.dataset.theme;
      renderFilms();
    })
  );
}

// ---------- tv ----------

// "3 seasons · ~60 min/ep · Ended" — works on enrichment entries and suggestion items alike
function seriesMeta(e) {
  if (!e) return "";
  const bits = [];
  if (e.seasons) bits.push(`${e.seasons} season${e.seasons === 1 ? "" : "s"}`);
  if (e.episodeRuntime) bits.push(`~${e.episodeRuntime} min/ep`);
  if (e.showStatus) bits.push(e.showStatus);
  return bits.join(" · ");
}

function renderTV() {
  const q = state.q;
  const ratings = state.data.tvRatings ?? [];

  const watching = ratings.filter((r) => r.status === "watching" && matches(q, r.title, r.creator, r.note));
  const watchingHtml = watching
    .map((r) => {
      const e = tvEnrichFor(r);
      const progress = r.seasonsWatched != null ? `S${r.seasonsWatched}${e?.seasons ? ` of ${e.seasons}` : ""}` : null;
      const meta = [r.year, r.creator ?? e?.creators?.map((c) => c.name).join(", "), progress, seriesMeta(e)]
        .filter(Boolean)
        .map(esc)
        .join(" · ");
      return `
    <div class="card qcard" data-title="${esc(r.title)}" data-year="${r.year}" data-creator="${esc(r.creator ?? "")}" data-score="${r.score ?? ""}" data-seasons="${r.seasonsWatched ?? ""}">
      <div class="rank">▸</div>
      ${poster(e)}
      <div class="body">
        <div class="title">${esc(r.title)}</div>
        <div class="meta">${meta}</div>
        ${r.note ? `<div class="why">${md(r.note)}</div>` : ""}
        ${availability(null, e)}
      </div>
      <div class="side">
        <span class="chip watching">watching</span>
        ${state.canWrite ? `<button class="btn small act-tv-finish">Finished</button><button class="btn small act-tv-abandon">Abandon</button>` : ""}
      </div>
    </div>`;
    })
    .join("");

  const queue = (state.data.tvWatchlist ?? [])
    .filter((w) => matches(q, w.title, w.creator, w.why))
    .sort((a, b) => a.rank - b.rank);
  const queueHtml = queue.length
    ? queue
        .map((w) => {
          const e = tvEnrichFor(w);
          return `
    <div class="card qcard" data-title="${esc(w.title)}" data-year="${w.year}" data-creator="${esc(w.creator ?? "")}">
      <div class="rank">${w.rank}</div>
      ${poster(e)}
      <div class="body">
        <div class="title">${esc(w.title)}</div>
        <div class="meta">${[w.year, w.creator, seriesMeta(e)].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="why">${md(w.why)}</div>
        ${availability(null, e)}
      </div>
      <div class="side">
        <span class="chip ${confClass(w.confidence)}">${esc(w.confidence)}</span>
        ${state.canWrite ? `<button class="btn small act-tv-logged">Logged it</button><button class="btn small act-tv-drop">Remove</button>` : ""}
      </div>
    </div>`;
        })
        .join("")
    : `<div class="empty">${q ? "Nothing in the TV queue matches that search." : "TV queue is empty — the suggestions below are where the film log points."}</div>`;

  const sugg = state.data.tvSuggestions;
  const suggItems = (sugg?.items ?? []).filter((s) => matches(q, s.title, s.creators?.join(" "), s.why));
  const suggHtml = sugg
    ? suggItems
        .map(
          (s) => `
    <div class="card qcard sugg" data-title="${esc(s.title)}" data-year="${s.year}" data-creator="${esc(s.creators?.[0] ?? "")}" data-why="${esc(s.why)}">
      <div class="rank">?</div>
      ${poster(s)}
      <div class="body">
        <div class="title">${esc(s.title)}</div>
        <div class="meta">${[s.year, s.creators?.join(", "), seriesMeta(s)].filter(Boolean).map(esc).join(" · ")}${s.genres?.length ? " · " + esc(s.genres.slice(0, 2).join(", ")) : ""}${s.themes?.length ? " " + tchips(s.themes) : ""}</div>
        <div class="why">Because ${esc(s.why)}</div>
        ${availability(null, s)}
      </div>
      <div class="side">
        ${state.canWrite ? `<button class="btn small act-tv-queue">Queue it</button><button class="btn small act-tv-logged">Seen it</button>` : ""}
      </div>
    </div>`
        )
        .join("")
    : "";

  const logRows = ratings
    .filter((r) => matches(q, r.title, r.creator, r.note))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.year - a.year);
  const logHtml = logRows.length
    ? logRows
        .map((r) => {
          const e = tvEnrichFor(r);
          const facts = [seriesMeta(e) || null, scoreBits(e) || null, streamBits(e) || null].filter(Boolean);
          return `
    <div class="frow">
      <div class="t">${esc(r.title)}<span class="yr">${r.year}</span><div class="d">${esc(r.creator ?? (e?.creators?.map((c) => c.name).join(", ") || "—"))}</div></div>
      <div class="rcell"><span class="chip ${esc(r.status)}">${esc(r.status)}</span>${r.score != null ? stars(r.score) : ""}</div>
      ${facts.length ? `<div class="facts">${facts.join(" &nbsp;·&nbsp; ")}</div>` : ""}
      ${r.note ? `<div class="note">${md(r.note)}</div>` : ""}
    </div>`;
        })
        .join("")
    : `<div class="empty">${q ? "No series match that search." : "No series logged yet — the log only knows what you tell it."}</div>`;

  const suggSection = sugg
    ? `
    <h2 class="sect">Suggested by the data <span class="n">· ${suggItems.length}</span></h2>
    <p class="lede">Built from the people behind your 4★+ films${sugg.basedOn ? ` (${sugg.basedOn} of them)` : ""} — creators, writers, directors crossing into TV — minus everything already logged or queued. Regenerate with <span style="font-family:var(--mono)">npm run suggest:tv</span>.</p>
    ${suggHtml || `<div class="empty">No TV suggestions match that search.</div>`}`
    : "";

  $("#tab-tv").innerHTML = `
    ${watching.length ? `<h2 class="sect">Watching now <span class="n">· ${watching.length}</span></h2>${watchingHtml}` : ""}
    <h2 class="sect">Up next <span class="n">· ${queue.length}</span></h2>
    <p class="lede">The ranked TV queue. Logging a series clears it from here.</p>
    ${queueHtml}
    ${suggSection}
    <h2 class="sect">Series log <span class="n">· ${logRows.length}</span>${state.canWrite ? ` <button class="btn small" id="tv-log-open" style="margin-left:10px">+ Log a series</button>` : ""}</h2>
    ${logHtml}`;

  $("#tv-log-open")?.addEventListener("click", () => openLogDialog({ medium: "tv" }));

  $$("#tab-tv .act-tv-finish").forEach((b) =>
    b.addEventListener("click", () => {
      const card = b.closest(".qcard");
      openLogDialog({
        medium: "tv",
        title: card.dataset.title,
        year: card.dataset.year,
        director: card.dataset.creator,
        score: card.dataset.score || undefined,
        status: "finished",
        seasons: card.dataset.seasons,
      });
    })
  );
  $$("#tab-tv .act-tv-abandon").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".qcard");
      await api("api/tv", {
        title: card.dataset.title,
        year: Number(card.dataset.year),
        creator: card.dataset.creator || null,
        score: card.dataset.score ? Number(card.dataset.score) : null,
        status: "abandoned",
        seasonsWatched: card.dataset.seasons ? Number(card.dataset.seasons) : undefined,
      });
      await refresh();
    })
  );
  $$("#tab-tv .act-tv-logged").forEach((b) =>
    b.addEventListener("click", () => {
      const card = b.closest(".qcard");
      openLogDialog({
        medium: "tv",
        title: card.dataset.title,
        year: card.dataset.year,
        director: card.dataset.creator,
      });
    })
  );
  $$("#tab-tv .act-tv-drop").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".qcard");
      await api("api/tv-watchlist/remove", { title: card.dataset.title, year: Number(card.dataset.year) });
      await refresh();
    })
  );
  $$("#tab-tv .act-tv-queue").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".qcard");
      await api("api/tv-watchlist", {
        title: card.dataset.title,
        year: Number(card.dataset.year),
        creator: card.dataset.creator || null,
        confidence: "medium",
        why: `Suggested: ${card.dataset.why}`,
      });
      await refresh();
    })
  );
}

// ---------- books ----------

const subjectChips = (subjects) =>
  (subjects ?? [])
    .filter((s) => !s.includes("_") && s.length <= 26)
    .slice(0, 4)
    .map((s) => `<span class="tchip">${esc(s.toLowerCase())}</span>`)
    .join("");

function renderBooks() {
  const q = state.q;
  const books = state.data.books ?? [];

  const toread = books
    .filter((b) => b.status === "toread" && matches(q, b.title, b.author, b.why, b.note))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const toreadHtml = toread
    .map((b) => {
      const e = bookEnrichFor(b);
      const meta = [b.author, b.year ?? e?.firstPublished, e?.pages ? `${e.pages} pp` : null].filter(Boolean).map(esc).join(" · ");
      return `
    <div class="card qcard" data-title="${esc(b.title)}" data-author="${esc(b.author)}">
      <div class="rank">${b.rank ?? "·"}</div>
      ${e?.cover ? `<img class="poster book-cover" src="${esc(e.cover)}" alt="" loading="lazy">` : `<span class="poster book-cover empty-p"></span>`}
      <div class="body">
        <div class="title">${esc(b.title)}</div>
        <div class="meta">${meta}</div>
        ${b.why ? `<div class="why">${md(b.why)}</div>` : ""}
        ${subjectChips(e?.subjects) ? `<div class="avail">${subjectChips(e?.subjects)}</div>` : ""}
      </div>
      <div class="side">
        ${state.canWrite ? `<button class="btn small act-book-read">Read it</button><button class="btn small act-book-drop">Remove</button>` : ""}
      </div>
    </div>`;
    })
    .join("");

  const sugg = state.data.bookSuggestions;
  const suggItems = (sugg?.items ?? []).filter(
    (s) => !onShelf(s.title, s.author) && matches(q, s.title, s.author, s.why)
  );
  const suggHtml = sugg
    ? suggItems
        .map((s) => {
          const e = bookEnrichFor(s);
          const meta = [
            s.author,
            s.year,
            s.pages ? `${s.pages} pp` : null,
            s.olRating?.average != null && s.olRating.count >= 5 ? `OL ${s.olRating.average.toFixed(1)}` : null,
          ]
            .filter(Boolean)
            .map(esc)
            .join(" · ");
          return `
    <div class="card qcard sugg" data-title="${esc(s.title)}" data-author="${esc(s.author)}" data-why="${esc(s.why)}">
      <div class="rank">?</div>
      ${s.cover ? `<img class="poster book-cover" src="${esc(s.cover)}" alt="" loading="lazy">` : `<span class="poster book-cover empty-p"></span>`}
      <div class="body">
        <div class="title">${esc(s.title)}</div>
        <div class="meta">${meta}</div>
        <div class="why">Because ${esc(s.why)}</div>
        ${subjectChips(e?.subjects) ? `<div class="avail">${subjectChips(e?.subjects)}</div>` : ""}
      </div>
      <div class="side">
        ${state.canWrite ? `<button class="btn small act-book-shelve">Shelve it</button>` : ""}
      </div>
    </div>`;
        })
        .join("")
    : "";

  const shelf = books
    .filter((b) => (b.status === "read" || b.status === "reading") && matches(q, b.title, b.author, b.note))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title));
  const shelfHtml = shelf.length
    ? shelf
        .map((b) => {
          const e = bookEnrichFor(b);
          return `
    <div class="frow">
      <div class="t">${esc(b.title)}<span class="yr">${b.year ?? e?.firstPublished ?? ""}</span><div class="d">${esc(b.author)}</div></div>
      <div class="rcell">${b.status === "reading" ? `<span class="chip reading">reading</span>` : ""}${b.score != null ? stars(b.score) : ""}</div>
      ${b.note ? `<div class="note">${md(b.note)}</div>` : ""}
    </div>`;
        })
        .join("")
    : `<div class="empty">${q ? "Nothing on the shelf matches that search." : "Shelf is empty — import Goodreads (npm run import:books) or log one."}</div>`;

  // ---- the bridge: adaptation edges book → screen ----
  const ad = state.data.adaptations;
  const filmScore = new Map((state.data.ratings ?? []).map((r) => [`${r.title} (${r.year})`, r.score]));
  const edges = (ad?.edges ?? []).filter((e) => matches(q, e.screen, e.book?.title, e.book?.author));
  const confirmed = edges
    .filter((e) => e.status === "confirmed")
    .sort((a, b) => (filmScore.get(b.screen) ?? -1) - (filmScore.get(a.screen) ?? -1));
  const candidates = edges.filter((e) => e.status === "candidate");
  const edgeKey = (e) => `${e.screen}::${e.book?.wikidata ?? e.book?.title}`;

  const confirmedHtml = confirmed
    .map((e) => {
      const score = filmScore.get(e.screen);
      const shelved = onShelf(e.book.title, e.book.author);
      return `
    <div class="frow" data-key="${esc(edgeKey(e))}" data-title="${esc(e.book.title)}" data-author="${esc(e.book.author)}" data-screen="${esc(e.screen)}">
      <div class="t" style="font-weight:400"><strong>${esc(e.screen)}</strong>${score != null ? ` ${score}★` : ""} <span style="color:var(--tung-dim)">←</span> <em>${esc(e.book.title)}</em>, ${esc(e.book.author)}</div>
      <div class="rcell">${e.read ? `<span class="chip done">read</span>` : `<span class="badge-adaptation" style="margin-left:0"><span class="unread">unread</span></span>`}
        ${state.canWrite && !shelved && !e.read ? `<button class="btn small act-edge-shelve">Shelve the book</button>` : shelved && !e.read ? `<span class="chip left">shelved</span>` : ""}</div>
    </div>`;
    })
    .join("");

  const candidateHtml = candidates.length
    ? `
    <h2 class="sect">Needs review <span class="n">· ${candidates.length}</span></h2>
    <p class="lede">Probable adaptations found in writer credits — confirm to make them truth, reject to stop them coming back.</p>
    ${candidates
      .map(
        (e) => `
    <div class="card qcard" data-key="${esc(edgeKey(e))}">
      <div class="rank">~</div>
      <span class="poster book-cover empty-p"></span>
      <div class="body">
        <div class="title">${esc(e.book.title)} <span style="font-weight:400;color:var(--dim)">— ${esc(e.book.author)}</span></div>
        <div class="meta">behind ${esc(e.screen)} · via ${esc(e.source)}${e.confidence ? ` · ${esc(e.confidence)}` : ""}</div>
        ${e.evidence ? `<div class="why">${esc(e.evidence)}</div>` : ""}
      </div>
      <div class="side">
        ${state.canWrite ? `<button class="btn small act-edge-confirm">Confirm</button><button class="btn small act-edge-reject">Reject</button>` : ""}
      </div>
    </div>`
      )
      .join("")}`
    : "";

  const flagged = (ad?.flaggedOnly ?? []).filter((f) => matches(q, f.screen));
  const flaggedHtml = flagged.length
    ? `<p class="lede" style="margin-top:14px">Based on a book — help me identify it: ${flagged.map((f) => `<strong>${esc(f.screen)}</strong>`).join(" · ")}</p>`
    : "";

  const adjacent = [...(ad?.adjacentAuthors ?? [])].sort((a, b) => b.weight - a.weight);
  const adjacentHtml = adjacent.length
    ? `
    <h2 class="sect">Adjacent authors</h2>
    <p class="lede">Writers your favorite directors keep adapting — the shelf behind the filmographies.</p>
    <div style="line-height:2.1">${adjacent
        .map(
          (a) =>
            `<span class="tchip" title="${esc(a.adaptedBy.map((d) => `${d.director}: ${d.films.join(", ")}`).join(" · "))}">${esc(a.name)}</span>`
        )
        .join(" ")}</div>`
    : "";

  const suggSection = sugg
    ? `
    <h2 class="sect">Suggested by the data <span class="n">· ${suggItems.length}</span></h2>
    <p class="lede">Source novels of your 4★+ films first, then the authors behind them. Regenerate with <span style="font-family:var(--mono)">npm run suggest:books</span>.</p>
    ${suggHtml || `<div class="empty">No book suggestions match that search.</div>`}`
    : "";

  $("#tab-books").innerHTML = `
    <h2 class="sect">Read next <span class="n">· ${toread.length}</span></h2>
    <p class="lede">The to-read queue. Logging a book as read clears its rank.</p>
    ${toreadHtml || `<div class="empty">${q ? "Nothing queued matches that search." : "Nothing shelved to read yet — start from the bridge or the suggestions below."}</div>`}
    ${suggSection}
    <h2 class="sect">Shelf <span class="n">· ${shelf.length}</span>${state.canWrite ? ` <button class="btn small" id="book-log-open" style="margin-left:10px">+ Log a book</button>` : ""}</h2>
    ${shelfHtml}
    ${
      ad
        ? `
    <h2 class="sect">The bridge <span class="n">· ${confirmed.length} adaptations</span></h2>
    <p class="lede">Films you've logged that began as books — read status tracked against the shelf.</p>
    ${confirmedHtml || `<div class="empty">No adaptation edges match that search.</div>`}
    ${flaggedHtml}
    ${candidateHtml}
    ${adjacentHtml}`
        : ""
    }`;

  $("#book-log-open")?.addEventListener("click", () => openLogDialog({ medium: "book" }));

  $$("#tab-books .act-book-read").forEach((b) =>
    b.addEventListener("click", () => {
      const card = b.closest(".qcard");
      openLogDialog({ medium: "book", title: card.dataset.title, director: card.dataset.author, status: "read" });
    })
  );
  $$("#tab-books .act-book-drop").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".qcard");
      await api("api/books/remove", { title: card.dataset.title, author: card.dataset.author });
      await refresh();
    })
  );
  $$("#tab-books .act-book-shelve").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".qcard");
      await api("api/books", {
        title: card.dataset.title,
        author: card.dataset.author,
        status: "toread",
        why: `Suggested: ${card.dataset.why}`,
      });
      await refresh();
    })
  );
  $$("#tab-books .act-edge-shelve").forEach((b) =>
    b.addEventListener("click", async () => {
      const row = b.closest(".frow");
      await api("api/books", {
        title: row.dataset.title,
        author: row.dataset.author,
        status: "toread",
        why: `the book behind ${row.dataset.screen}`,
      });
      await refresh();
    })
  );
  $$("#tab-books .act-edge-confirm, #tab-books .act-edge-reject").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".qcard");
      await api("api/adaptations", {
        action: b.classList.contains("act-edge-confirm") ? "confirm" : "reject",
        key: card.dataset.key,
      });
      await refresh();
    })
  );
}

// ---------- directors ----------

// series where this director's TMDB person id (or name) shows up as creator/director
function tvCreditsFor(name) {
  const tv = state.data.tvEnrichment ?? {};
  if (!Object.keys(tv).length) return [];
  let pid = null;
  for (const e of Object.values(state.data.enrichment ?? {})) {
    const hit = e?.director?.find((p) => p.name === name);
    if (hit) { pid = hit.id; break; }
  }
  const shows = [];
  for (const [key, e] of Object.entries(tv)) {
    const has = (list) => (list ?? []).some((p) => (pid != null && p.id === pid) || p.name === name);
    const roles = [has(e.creators) && "created", has(e.directors) && "directed"].filter(Boolean);
    if (roles.length) shows.push(`${key} — ${roles.join(", ")}`);
  }
  return shows;
}

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
      ${(() => { const tv = tvCreditsFor(d.name); return tv.length ? `<div class="queue-names">also on TV: ${tv.map(esc).join(" · ")}</div>` : ""; })()}
    </div>`;
    })
    .join("");

  $("#tab-directors").innerHTML = `
    <h2 class="sect">Filmography runs</h2>
    <p class="lede">${md(state.data.profile.directorsIntro)} Filled sprockets are films seen; hollow ones are what's left.</p>
    ${rows || `<div class="empty">No directors match that search.</div>`}`;
}

// ---------- taste ----------

function computedSection() {
  const s = state.data.stats;
  if (!s) return "";
  const bar = (n, max) => `<span class="bar"><span style="width:${Math.round((n / max) * 100)}%"></span></span>`;
  const row = (lbl, n, max, val) =>
    `<div class="statrow"><span class="lbl">${lbl}</span>${bar(n, max)}<span class="val">${val}</span></div>`;

  const tierMax = Math.max(...Object.values(s.tiers));
  const tierRows = Object.keys(s.tiers)
    .map(Number)
    .sort((a, b) => b - a)
    .map((t) => row(`${t}★`, s.tiers[t], tierMax, s.tiers[t]))
    .join("");

  const decMax = Math.max(...Object.values(s.decades));
  const decRows = Object.keys(s.decades)
    .map(Number)
    .sort((a, b) => a - b)
    .map((d) => row(`${String(d).slice(2)}s`, s.decades[d], decMax, s.decades[d]))
    .join("");

  const pct = (x) => `${Math.round(x * 100)}%`;
  const tiltRows = s.genreTilt
    .map((g) => row(esc(g.genre), g.lovedShare, 1, `${pct(g.lovedShare)} loved · ${pct(g.seenShare)} seen`))
    .join("");

  const divRows = (list) =>
    list.map((d) => `<li><strong>${esc(d.title)}</strong> — you ${d.mine}★, IMDb ${d.imdb}</li>`).join("");

  const stale =
    s.newSinceProfile > 0
      ? `<p class="lede">The written analysis below dates from <strong>${esc(s.profileUpdated)}</strong> — ${s.newSinceProfile} film${s.newSinceProfile === 1 ? "" : "s"} watched since. When it drifts, rerun the profile ritual.</p>`
      : "";

  return `
    <h2 class="sect">Computed from the data <span class="n">· refreshed ${esc(s.generated)}</span></h2>
    ${stale}
    <div class="grid2">
      <div class="card statcard"><h3>Score spread</h3>${tierRows}</div>
      <div class="card statcard"><h3>Decades seen</h3>${decRows}</div>
      <div class="card statcard"><h3>Genre tilt — where 4★+ over-indexes</h3>${tiltRows}</div>
      <div class="card statcard"><h3>Against the critics</h3>
        <ul class="divlist hot">${divRows(s.lovedAgainstCritics)}</ul>
        <ul class="divlist cold">${divRows(s.coldAgainstCritics)}</ul>
      </div>
    </div>`;
}

function themesSection() {
  const t = state.data.themes;
  if (!t?.themes?.length) return "";
  const pct = (x) => `${Math.round(x * 100)}%`;
  const bar = (n) => `<span class="bar"><span style="width:${Math.round(n * 100)}%"></span></span>`;

  const themeRows = [...t.themes]
    .sort((a, b) => b.tilt - a.tilt)
    .map((th) => {
      const loved = th.lovedFilms?.length
        ? `<ul class="divlist" style="margin:4px 0 10px;padding-left:52px">${th.lovedFilms
            .map(
              (f) =>
                `<li><strong>${esc(f.title)}</strong> (${f.year}) — ${f.score}★${f.matched?.length ? ` · ${esc(f.matched.join(", "))}` : ""}</li>`
            )
            .join("")}</ul>`
        : `<div class="divlist" style="margin:4px 0 10px;padding-left:52px;color:var(--dim)">no 4★+ films here yet</div>`;
      return `
      <details>
        <summary style="cursor:pointer;list-style:none">
          <div class="statrow"><span class="lbl">${esc(th.name)}</span>${bar(th.lovedShare)}<span class="val">${th.lovedCount} loved · ${pct(th.seenShare)} seen</span></div>
        </summary>
        ${loved}
      </details>`;
    })
    .join("");

  const emergent = (t.emergent ?? [])
    .map(
      (e) =>
        `<div class="statrow"><span class="lbl">${e.lovedCount} loved</span><span style="font-size:13px">${esc(e.keyword)}</span><span class="val">${e.seenCount} seen</span></div>`
    )
    .join("");

  return `
    <h2 class="sect">Themes <span class="n">· refreshed ${esc(t.generated)}</span></h2>
    <div class="grid2">
      <div class="card statcard"><h3>Named themes — where 4★+ over-indexes</h3>${themeRows}</div>
      <div class="card statcard"><h3>Emerging — unmapped keywords in loved films</h3>${emergent || `<div class="empty">nothing emergent yet</div>`}
        <div class="lede" style="margin:12px 0 0;font-size:12.5px">Names come from the curated map. To grow it: <span style="font-family:var(--mono)">node scripts/themes.mjs --unmapped</span>, edit <span style="font-family:var(--mono)">data/theme-map.json</span>, rerun <span style="font-family:var(--mono)">npm run themes</span>.</div>
      </div>
    </div>`;
}

function renderTaste() {
  const { profile, calibration, lineage, cohorts } = state.data;
  $("#tab-taste").innerHTML = `
    ${computedSection()}
    ${themesSection()}
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

// the one dialog logs all three media; the selector drives which fields show
function applyLogMedium(form) {
  const m = form.medium.value;
  $("#log-person-lbl").textContent = m === "tv" ? "Creator" : m === "book" ? "Author" : "Director";
  $("#log-tv-fields").hidden = m !== "tv";
  $("#log-book-status").hidden = m !== "book";
  form.year.required = m !== "book"; // publication year is optional
}

function openLogDialog(prefill = {}) {
  const form = $("#log-form");
  form.reset();
  form.medium.value = prefill.medium ?? "film";
  applyLogMedium(form);
  form.title.value = prefill.title ?? "";
  form.year.value = prefill.year ?? "";
  form.director.value = prefill.director ?? "";
  if (prefill.score != null && prefill.score !== "") form.score.value = String(prefill.score);
  if (prefill.status) (form.medium.value === "tv" ? form.tvstatus : form.bookstatus).value = prefill.status;
  if (prefill.seasons) form.seasons.value = prefill.seasons;
  const noun = { film: "film", tv: "series", book: "book" }[form.medium.value];
  $("#log-title").textContent = prefill.title ? `Log “${prefill.title}”` : `Log a ${noun}`;
  $("#log-dialog").showModal();
}

function wireDialogs() {
  $("#log-open").addEventListener("click", () => openLogDialog());
  $("#log-cancel").addEventListener("click", () => $("#log-dialog").close());
  $("#queue-cancel").addEventListener("click", () => $("#queue-dialog").close());

  $$("#log-medium input").forEach((r) =>
    r.addEventListener("change", () => applyLogMedium($("#log-form")))
  );

  $("#log-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const title = f.title.value.trim();
    const year = f.year.value === "" ? null : Number(f.year.value);
    const score = f.score.value === "" ? null : Number(f.score.value);
    const note = f.note.value.trim() || undefined;
    const person = f.director.value.trim();
    const medium = f.medium.value;
    if (medium === "tv") {
      await api("api/tv", {
        title,
        year,
        creator: person || null,
        score,
        status: f.tvstatus.value,
        seasonsWatched: f.seasons.value === "" ? undefined : Number(f.seasons.value),
        note,
      });
    } else if (medium === "book") {
      if (!person) return f.director.focus();
      await api("api/books", { title, author: person, year, status: f.bookstatus.value, score, note });
    } else {
      await api("api/ratings", { title, year, director: person || null, score, note });
    }
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

const renderers = { watch: renderWatch, films: renderFilms, tv: renderTV, books: renderBooks, directors: renderDirectors, taste: renderTaste };

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
