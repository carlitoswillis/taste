// Upsert into a rating log. `entry` carries only the fields the caller actually supplied: re-logging a film from
// the page without a director must not erase the stored one. New rows get `defaults` for the optional fields.
import { sameFilm } from "./queue.mjs";

export function upsertLogEntry(rows, entry, defaults = {}) {
  const i = rows.findIndex((r) => sameFilm(r, entry));
  if (i >= 0) rows[i] = { ...rows[i], ...entry };
  else rows.push({ title: entry.title, year: entry.year, ...defaults, ...entry });
  return i >= 0;
}
