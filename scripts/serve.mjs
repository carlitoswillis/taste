#!/usr/bin/env node
// Local app server: serves the shell from templates/, data live from data/,
// and a small write API so the page works as a logging tool. Localhost only,
// zero dependencies. Run: npm start  (or node scripts/serve.mjs)

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 4747;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

const dataPath = (name) => path.join(root, "data", `${name}.json`);
const readData = async (name) => JSON.parse(await readFile(dataPath(name), "utf8"));
const writeData = (name, value) =>
  writeFile(dataPath(name), JSON.stringify(value, null, 2) + "\n");

const sameFilm = (a, b) =>
  a.title.toLowerCase() === String(b.title).toLowerCase() && (!a.year || !b.year || a.year === Number(b.year));

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("body too large");
  }
  return JSON.parse(raw || "{}");
}

const VALID_SCORES = new Set([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);

const api = {
  // Upsert a log entry; logging a film also clears it from the watch queue.
  "api/ratings": async (body) => {
    const title = String(body.title ?? "").trim();
    const year = Number(body.year);
    if (!title || !Number.isInteger(year) || year < 1880 || year > 2100) throw new Error("valid title and year required");
    const score = body.score == null ? null : Number(body.score);
    if (score != null && !VALID_SCORES.has(score)) throw new Error("score must be 0.5–5 in half steps");

    const entry = { title, year, director: body.director || null, score };
    if (body.note) entry.note = String(body.note);

    const ratings = await readData("ratings");
    const i = ratings.findIndex((r) => sameFilm(r, entry));
    i >= 0 ? (ratings[i] = { ...ratings[i], ...entry }) : ratings.push(entry);
    await writeData("ratings", ratings);

    const watchlist = await readData("watchlist");
    const rest = watchlist.filter((w) => !sameFilm(w, entry));
    if (rest.length !== watchlist.length) {
      rest.sort((a, b) => a.rank - b.rank).forEach((w, idx) => (w.rank = idx + 1));
      await writeData("watchlist", rest);
    }
    return { ok: true, updated: i >= 0 };
  },

  "api/watchlist": async (body) => {
    const title = String(body.title ?? "").trim();
    const year = Number(body.year);
    if (!title || !Number.isInteger(year)) throw new Error("valid title and year required");
    const watchlist = await readData("watchlist");
    if (watchlist.some((w) => sameFilm(w, { title, year }))) throw new Error("already in the queue");
    watchlist.push({
      rank: watchlist.length + 1,
      title,
      year,
      director: body.director || null,
      confidence: ["high", "medium", "low", "test case"].includes(body.confidence) ? body.confidence : "medium",
      why: String(body.why ?? ""),
    });
    await writeData("watchlist", watchlist);
    return { ok: true };
  },

  "api/watchlist/remove": async (body) => {
    const watchlist = await readData("watchlist");
    const rest = watchlist.filter((w) => !sameFilm(w, body));
    if (rest.length === watchlist.length) throw new Error("not in the queue");
    rest.sort((a, b) => a.rank - b.rank).forEach((w, idx) => (w.rank = idx + 1));
    await writeData("watchlist", rest);
    return { ok: true };
  },

  "api/oldfilms/verdict": async (body) => {
    const films = await readData("old-films");
    const film = films.find((f) => f.title.toLowerCase() === String(body.title).toLowerCase());
    if (!film) throw new Error("film not on trial");
    film.verdict = String(body.verdict ?? "").trim() || null;
    await writeData("old-films", films);
    return { ok: true };
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const route = url.pathname.replace(/^\/+/, "");
  const send = (code, body, type = "application/json") =>
    res.writeHead(code, { "content-type": type }).end(body);

  try {
    if (route === "api/health") return send(200, `{"ok":true}`);

    if (route.startsWith("api/")) {
      if (req.method !== "POST") return send(405, `{"error":"POST only"}`);
      const handler = api[route];
      if (!handler) return send(404, `{"error":"no such endpoint"}`);
      try {
        return send(200, JSON.stringify(await handler(await readBody(req))));
      } catch (err) {
        return send(400, JSON.stringify({ error: err.message }));
      }
    }

    // data served live from data/ (config.json aliased in)
    if (route.startsWith("data/") && route.endsWith(".json")) {
      const name = route.slice(5, -5);
      const file = name === "config" ? path.join(root, "config.json") : dataPath(path.basename(name));
      try {
        return send(200, await readFile(file), "application/json");
      } catch {
        return send(404, `{"error":"no such data file"}`);
      }
    }

    // app shell from templates/
    const file = route === "" ? "index.html" : path.basename(route);
    if (["index.html", "style.css", "app.js"].includes(file)) {
      return send(200, await readFile(path.join(root, "templates", file)), TYPES[path.extname(file)]);
    }
    return send(404, "not found", "text/plain");
  } catch (err) {
    console.error(err);
    return send(500, "server error", "text/plain");
  }
});

function listen(port, attemptsLeft) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`port ${port} in use, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      throw err;
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`\n  taste running at http://127.0.0.1:${port}\n  serving templates/ + live data/ — edits appear on refresh\n`);
  });
}
listen(PORT, 10);
