// JSON data-file IO shared by the server and the scripts.
// - writeJsonAtomic: temp file in the same directory + rename, so a reader (the page polling data/, a sync that
//   starts mid-write) never sees a truncated file, and a crash leaves the old file whole.
// - readJsonStrict: only a MISSING file may fall back to a default. An unreadable or unparseable file throws, so
//   callers never treat a read error as "empty" and write that back over real data.
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";

export function readJsonStrict(file, fallback) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT" && fallback !== undefined) return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path.basename(file)} is not valid JSON (${err.message}); refusing to treat it as empty`);
  }
}

export function writeJsonAtomic(file, value, space = 2) {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, space) + "\n");
    renameSync(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

// Runs async jobs one at a time. Used by the server so two requests never interleave their read-modify-write.
export function makeSerial() {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job, job);
    tail = run.then(() => {}, () => {});
    return run;
  };
}
