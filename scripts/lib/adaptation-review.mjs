// Review lifecycle of a book -> screen adaptation edge (data/adaptations.json). The ONLY module that decides
// how an edge's review state may change; the server (human decisions) and bridge-adaptations (machine passes)
// both go through it.
//
// States (an edge is in exactly one):
//   candidate  in edges[], status "candidate"  - a machine guess (OMDb Writer parse), awaiting a human
//   confirmed  in edges[], status "confirmed"  - Wikidata fact, hand-entered, or a human said yes
//   rejected   in rejected[]                   - a human said no; terminal, never resurrected
// Human transitions:   candidate -> confirmed | rejected;   confirmed -> rejected;   confirmed -> confirmed (no-op)
//                      rejected -> anything: illegal (throws)
// Machine transitions: (new) -> candidate | confirmed;   candidate -> confirmed (a later pass proves it);
//                      confirmed/rejected are never moved back to candidate, and rejected keys are never re-added.
// A human decision always beats a machine suggestion.
import { readJsonStrict, writeJsonAtomic } from "./atomic-json.mjs";

export const EMPTY = () => ({ edges: [], rejected: [], flaggedOnly: [], adjacentAuthors: [] });
export const edgeKey = (e) => `${e.screen}::${e.book?.wikidata ?? e.book?.title}`;
const RANK = { candidate: 0, confirmed: 1 };
const stronger = (a, b) => ((RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b);

export function stateOf(data, key) {
  if ((data.rejected ?? []).some((e) => edgeKey(e) === key)) return "rejected";
  const e = (data.edges ?? []).find((x) => edgeKey(x) === key);
  return e ? e.status ?? "candidate" : null;
}

/** Human decision on one edge. Mutates and returns { edge, status }. */
export function decide(data, key, action) {
  if (action !== "confirm" && action !== "reject") throw new Error("action must be confirm or reject");
  data.edges ??= [];
  const i = data.edges.findIndex((e) => edgeKey(e) === key);
  if (i < 0) throw new Error(stateOf(data, key) === "rejected" ? "edge is already rejected" : "no such edge");
  const edge = data.edges[i];
  if (action === "confirm") {
    edge.status = "confirmed";
    return { edge, status: "confirmed" };
  }
  data.edges.splice(i, 1);
  (data.rejected ??= []).push(edge);
  return { edge, status: "rejected" };
}

/**
 * Merge a machine pass (`fresh`: edges/flaggedOnly/adjacentAuthors built from a start-of-run snapshot) into
 * `current` (the file as it is NOW, re-read at write time). Pure. Reviews in `current` always win.
 */
export function mergeMachine(current, fresh, generated = new Date().toISOString()) {
  const rejected = current.rejected ?? [];
  const rejectedKeys = new Set(rejected.map(edgeKey));
  const byKey = new Map(); // insertion-ordered
  for (const e of fresh.edges ?? []) if (!rejectedKeys.has(edgeKey(e))) byKey.set(edgeKey(e), e);
  for (const cur of current.edges ?? []) {
    const key = edgeKey(cur);
    if (rejectedKeys.has(key)) continue;
    const f = byKey.get(key);
    if (f) {
      // human-confirmed row beats a machine candidate wholesale; otherwise take the fresh facts at the stronger status
      byKey.set(key, cur.status === "confirmed" && f.status !== "confirmed" ? cur : { ...f, status: stronger(f.status, cur.status) });
    } else if (cur.source === "manual" || cur.status === "confirmed") {
      byKey.set(key, cur); // hand entries and reviewed rows the passes did not rediscover
    }
  }
  return {
    generated,
    edges: [...byKey.values()],
    rejected,
    flaggedOnly: fresh.flaggedOnly ?? current.flaggedOnly ?? [],
    adjacentAuthors: fresh.adjacentAuthors ?? current.adjacentAuthors ?? [],
  };
}

/** Synchronous read -> apply -> atomic write with no await in between, so no request can interleave. */
export function updateFile(file, fn) {
  const data = readJsonStrict(file, EMPTY());
  const result = fn(data);
  writeJsonAtomic(file, data);
  return result;
}

export function reviewFile(file, key, action) {
  return updateFile(file, (data) => decide(data, key, action));
}

/** Bridge write step: re-read the file now, merge the machine result into it, write atomically. */
export function writeMachineResult(file, fresh, finish = (edges) => edges) {
  const current = readJsonStrict(file, EMPTY());
  const merged = mergeMachine(current, fresh);
  merged.edges = finish(merged.edges);
  writeJsonAtomic(file, merged);
  return merged;
}
