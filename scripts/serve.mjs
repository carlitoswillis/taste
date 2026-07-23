#!/usr/bin/env node
// Local dev server: serves dist/ and rebuilds whenever data/, templates/, or
// config.json change. Zero dependencies. Run: npm start  (or node scripts/serve.mjs)

import { createServer } from "node:http";
import { readFile, watch } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const PORT = Number(process.env.PORT) || 4747;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function build() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(root, "scripts/build.mjs")], { stdio: "inherit" });
    p.on("exit", resolve);
  });
}

await build();

const server = createServer(async (req, res) => {
  let file = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (file.endsWith("/")) file += "index.html";
  const full = path.join(dist, path.normalize(file));
  if (!full.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(full);
    res.writeHead(200, { "content-type": TYPES[path.extname(full)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
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
    console.log(`\n  taste running at http://127.0.0.1:${port}\n  watching data/, templates/, config.json — edit and refresh\n`);
  });
}
listen(PORT, 10);

// Debounced rebuild on change.
let timer = null;
const queueBuild = (event, filename) => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    console.log(`\nchange detected${filename ? ` (${filename})` : ""} — rebuilding...`);
    await build();
  }, 150);
};

for (const target of ["data", "templates"]) {
  (async () => {
    for await (const ev of watch(path.join(root, target), { recursive: true })) queueBuild(ev.eventType, ev.filename);
  })().catch(() => {});
}
(async () => {
  for await (const ev of watch(path.join(root, "config.json"))) queueBuild(ev.eventType, "config.json");
})().catch(() => {});
