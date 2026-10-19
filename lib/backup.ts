import type { Channel, Library, Reel } from "./contracts";
import { getLibrary, saveLibrary, withLibraryLock } from "./catalog";
import { getSettings, patchSettings, type Settings } from "./settings";

// ─────────────────────────────────────────────────────────────────────────────
// BACKUP — export & restore the server-side half of your data.
//
// "Your catalog is a JSON file on your own disk" is a promise this makes real: a
// backup bundles everything that is YOURS and hard to recreate —
//   • the library (subscribed channels + their reels), from data/reels.json
//   • the settings (refresh limit + view prefs),        from data/settings.json
// and (added client-side, where it lives) your watch history from localStorage.
//
// Deliberately NOT included: the resolved-video cache (data/resolved.json). Those
// signed CDN URLs expire within hours and are re-minted on demand, so backing
// them up would only restore dead links.
//
// This module owns the SERVER half: reading the two files for export, and
// validating + restoring them on import. The client (app/settings/BackupControls)
// assembles the download and carries watch history across. Restore REPLACES the
// library wholesale, so it runs under withLibraryLock like every other library
// mutation — a restore mid-refresh can't interleave into a torn state.
// ─────────────────────────────────────────────────────────────────────────────

/** Bumped only on a breaking change to the bundle shape. */
export const BACKUP_VERSION = 1;

export interface ServerBackup {
  library: Library;
  settings: Settings;
}

/** Read the server-side state to export. */
export async function readServerBackup(): Promise<ServerBackup> {
  const [library, settings] = await Promise.all([getLibrary(), getSettings()]);
  return { library, settings };
}

const asString = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

/**
 * Coerce an untrusted value (from an imported file) into a clean Library, or
 * null if it isn't library-shaped at all. Malformed channels/reels are dropped
 * rather than failing the whole import, but the top-level shape must be right —
 * we never persist arbitrary JSON into the catalog.
 */
export function coerceLibrary(raw: unknown): Library | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { channels?: unknown; reels?: unknown };
  if (!Array.isArray(r.channels) || !Array.isArray(r.reels)) return null;

  const channels: Channel[] = [];
  for (const c of r.channels) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const handle = asString(o.handle);
    if (!handle) continue;
    channels.push({
      handle,
      displayName: asString(o.displayName) || handle,
      harvestedAt: asString(o.harvestedAt) || "",
    });
  }

  const reels: Reel[] = [];
  for (const rl of r.reels) {
    if (!rl || typeof rl !== "object") continue;
    const o = rl as Record<string, unknown>;
    const shortcode = asString(o.shortcode);
    const url = asString(o.url);
    const thumbnail = asString(o.thumbnail);
    const channel = asString(o.channel);
    if (!shortcode || !url || !thumbnail || !channel) continue;
    reels.push({
      shortcode,
      url,
      thumbnail,
      channel,
      views: asString(o.views),
      caption: o.caption == null ? null : asString(o.caption),
    });
  }

  return { channels, reels };
}

/**
 * Validate and restore a backup's server half. Replaces the library wholesale and
 * (if present) the settings. Throws if the bundle carries no valid library, so the
 * caller can surface a clear error instead of silently wiping the catalog.
 */
export async function restoreServerBackup(raw: {
  library?: unknown;
  settings?: unknown;
}): Promise<ServerBackup> {
  const library = coerceLibrary(raw.library);
  if (!library) {
    throw new Error("This file doesn't contain a valid Reel Watcher library.");
  }

  return withLibraryLock(async () => {
    await saveLibrary(library);
    // patchSettings normalizes every field, so a malformed settings block can't
    // corrupt the store; if it's absent entirely we keep the current settings.
    const settings =
      raw.settings === undefined
        ? await getSettings()
        : await patchSettings(raw.settings as { refreshLimit?: unknown; view?: unknown });
    return { library, settings };
  });
}
