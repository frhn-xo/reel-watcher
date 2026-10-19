// ─────────────────────────────────────────────────────────────────────────────
// VIEW-STATE VALUE TYPES (pure, client-safe)
//
// The grid's filter dimension: its type, the allowed values, and a parser that
// validates an untrusted string (a URL param or a stored value) down to a Filter.
// This module is pure (no fs, no localStorage) so both the client grid and the
// server-side settings store can import it.
//
// DURABILITY lives in lib/settings.ts now — the filter + channel selection persist
// in data/settings.json (the one settings home), not localStorage. This file is
// only the shared vocabulary for that value.
// ─────────────────────────────────────────────────────────────────────────────

export type Filter = "all" | "fresh" | "seen";
export const FILTERS: readonly Filter[] = ["all", "fresh", "seen"];

export function parseFilter(raw: string | null | undefined): Filter {
  return FILTERS.includes(raw as Filter) ? (raw as Filter) : "all";
}
