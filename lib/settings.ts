import { promises as fs } from "fs";
import path from "path";
import { type Filter, parseFilter } from "./prefs";

// ─────────────────────────────────────────────────────────────────────────────
// APP SETTINGS (server-side, durable)
//
// The one home for user-configurable settings. Persisted to data/settings.json
// next to the library, read through getSettings(). Two concerns live here:
//
//   • refreshLimit — how many reels a single harvest (refresh OR add-channel)
//     pulls at most. A channel can have thousands of reels; without a ceiling a
//     first harvest would scroll the whole back-catalog. Default 50.
//   • view — the durable fallback for the grid's filter + channel selection,
//     restored on a cold open. The URL stays the in-session source of truth
//     (see app/CatalogGrid.tsx); this is only consulted when the URL carries no
//     view params. (Migrated here from the old localStorage prefs so all settings
//     live in one place with one responsibility.)
//
// Same single-user, local-app rationale as lib/catalog.ts: a plain JSON file is
// the right amount of machinery.
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(process.cwd(), "data", "settings.json");

export const DEFAULT_REFRESH_LIMIT = 50;
export const MIN_REFRESH_LIMIT = 1;
// Harvesting scrolls a virtualized grid; past a few hundred tiles the browser is
// doing real work. This is the ceiling the UI enforces and getSettings() clamps to.
export const MAX_REFRESH_LIMIT = 500;

export interface ViewPrefs {
  filter: Filter;
  channels: string[] | null; // null = all channels (incl. any added later)
}

export interface Settings {
  refreshLimit: number;
  view: ViewPrefs;
}

const DEFAULT_SETTINGS: Settings = {
  refreshLimit: DEFAULT_REFRESH_LIMIT,
  view: { filter: "all", channels: null },
};

/** Clamp an arbitrary value to a valid refresh limit (integer, in range). */
export function clampRefreshLimit(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_REFRESH_LIMIT;
  return Math.min(MAX_REFRESH_LIMIT, Math.max(MIN_REFRESH_LIMIT, n));
}

function normalizeView(raw: unknown): ViewPrefs {
  const v = (raw ?? {}) as Partial<ViewPrefs>;
  return {
    filter: parseFilter(v.filter),
    channels: Array.isArray(v.channels) ? v.channels.filter((h) => typeof h === "string") : null,
  };
}

/** Read settings from disk, falling back to defaults field-by-field. */
export async function getSettings(): Promise<Settings> {
  let data: Partial<Settings>;
  try {
    data = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf-8"));
  } catch {
    return DEFAULT_SETTINGS; // nothing saved yet
  }
  return {
    refreshLimit: clampRefreshLimit(data.refreshLimit ?? DEFAULT_REFRESH_LIMIT),
    view: normalizeView(data.view),
  };
}

/** Overwrite the settings file with a fully-formed (normalized) Settings. */
export async function saveSettings(settings: Settings): Promise<void> {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

/**
 * Merge a partial patch over current settings and persist. Normalizes every field
 * so a malformed body can't corrupt the store. Returns the saved settings.
 */
export async function patchSettings(patch: {
  refreshLimit?: unknown;
  view?: unknown;
}): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    refreshLimit:
      patch.refreshLimit === undefined
        ? current.refreshLimit
        : clampRefreshLimit(patch.refreshLimit),
    view: patch.view === undefined ? current.view : normalizeView(patch.view),
  };
  await saveSettings(next);
  return next;
}
