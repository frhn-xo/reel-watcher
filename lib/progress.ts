"use client";

// ─────────────────────────────────────────────────────────────────────────────
// WATCH HISTORY (local, client-side store)
//
// Durable per-reel playback state: where you left off + whether you finished.
// Keyed by shortcode so it's screen-agnostic — the grid, the "Continue watching"
// row, and the player all read/write the SAME entry. Open a reel from anywhere
// and it resumes from the same spot.
//
// Why localStorage: this is a personal, single-user, local app — no auth, no
// backend user table. All watch history lives in this one module.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

const KEY = "reel-watcher:watch-history:v1";
const EVENT = "reel-watcher:progress"; // fired on write so open views refresh live

/** How much of a reel counts as "finished". */
const COMPLETE_FRACTION = 0.95;
/** Below this many seconds we treat it as "never really started" (= fresh). */
const STARTED_SECONDS = 3;
/** How many reels the "Continue watching" row shows. */
export const CONTINUE_WATCHING_LIMIT = 3;

export interface WatchEntry {
  position: number; // seconds into the reel
  duration: number; // total seconds (as reported by the <video>)
  completed: boolean; // watched to the end at least once
  rotation?: number; // manual display rotation in degrees (0 | 90 | 180 | 270)
  zoom?: number; // manual display zoom factor (1 = fit-to-frame; see ZOOM_MIN/MAX)
  updatedAt: number; // epoch ms — drives "most recently watched" ordering
}

/** Clockwise rotations a reel can be displayed at. Some IG sources carry broken
 *  orientation metadata, so we let the viewer correct it and remember the choice. */
export type Rotation = 0 | 90 | 180 | 270;

/** Bounds and step for the per-reel display zoom. 1 = fit-to-frame (the default);
 *  below shrinks, above enlarges (and may crop). A reel's source resolution varies
 *  wildly, so this is remembered per reel like rotation. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;

/** Clamp a zoom into range and onto a clean step — keeps repeated +/- clicks from
 *  accumulating floating-point drift (1.0000000002) in the stored value. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  const stepped = Math.round(zoom / ZOOM_STEP) * ZOOM_STEP;
  return Number(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped)).toFixed(2));
}

export type WatchStatus = "fresh" | "in-progress" | "watched";

type Store = Record<string, WatchEntry>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(store));
  // Notify any mounted views in this tab; "storage" covers other tabs.
  window.dispatchEvent(new Event(EVENT));
}

export function getEntry(shortcode: string): WatchEntry | null {
  return read()[shortcode] ?? null;
}

/** The shape a never-seen reel starts from, so merges never read `undefined`. */
const DEFAULT_ENTRY: WatchEntry = {
  position: 0,
  duration: 0,
  completed: false,
  rotation: 0,
  zoom: 1,
  updatedAt: 0,
};

/**
 * The single writer for watch history. Merges `patch` onto the existing entry
 * (or a fresh default) so each caller only states the fields it owns — no caller
 * has to remember to carry the others forward. By default it stamps updatedAt
 * ("most recently watched" ordering); pass `touch: false` for changes that aren't
 * watching (e.g. rotating) so they don't reorder the Continue-watching row.
 */
function updateEntry(
  shortcode: string,
  patch: Partial<WatchEntry>,
  { touch = true }: { touch?: boolean } = {}
): void {
  if (!shortcode) return;
  const store = read();
  const next: WatchEntry = { ...(store[shortcode] ?? DEFAULT_ENTRY), ...patch };
  if (touch) next.updatedAt = Date.now();
  store[shortcode] = next;
  write(store);
}

/** Record the current playback position. Marks completed once past the threshold. */
export function saveProgress(
  shortcode: string,
  position: number,
  duration: number
): void {
  if (!shortcode || !duration || !isFinite(duration) || position < 0) return;
  const already = getEntry(shortcode)?.completed ?? false;
  updateEntry(shortcode, {
    position,
    duration,
    completed: already || position / duration >= COMPLETE_FRACTION,
  });
}

/** Force-mark a reel finished (e.g. the video fired `ended`). */
export function markCompleted(shortcode: string, duration: number): void {
  const prev = getEntry(shortcode);
  updateEntry(shortcode, {
    position: duration || prev?.position || 0,
    duration: duration || prev?.duration || 0,
    completed: true,
  });
}

/** Read the remembered display rotation for a reel (defaults to 0). */
export function getRotation(shortcode: string): Rotation {
  return (getEntry(shortcode)?.rotation ?? 0) as Rotation;
}

/** Remember the manual display rotation for a reel. Not "watching", so it leaves
 *  updatedAt untouched and won't reorder the Continue-watching row. */
export function saveRotation(shortcode: string, rotation: Rotation): void {
  updateEntry(shortcode, { rotation }, { touch: false });
}

/** Read the remembered display zoom for a reel (defaults to 1 = fit-to-frame). */
export function getZoom(shortcode: string): number {
  return getEntry(shortcode)?.zoom ?? 1;
}

/** Remember the manual display zoom for a reel. Like rotation it isn't "watching",
 *  so it leaves updatedAt untouched and won't reorder the Continue-watching row. */
export function saveZoom(shortcode: string, zoom: number): void {
  updateEntry(shortcode, { zoom: clampZoom(zoom) }, { touch: false });
}

export function statusOf(entry: WatchEntry | null | undefined): WatchStatus {
  if (!entry) return "fresh";
  if (entry.completed) return "watched";
  if (entry.position >= STARTED_SECONDS) return "in-progress";
  return "fresh"; // barely started → treat as fresh (your "midway = fresh" in the grid)
}

/**
 * True if a saved entry is worth resuming into (started, not basically-finished).
 * Used by the player to decide whether to seek on load.
 */
export function shouldResume(entry: WatchEntry | null | undefined): boolean {
  if (!entry || entry.completed) return false;
  if (entry.position < STARTED_SECONDS) return false;
  if (entry.duration && entry.position >= entry.duration - 1) return false;
  return true;
}

// ─── Backup (export / restore the whole store) ───────────────────────────────
// Watch history is the client half of a backup bundle (the library + settings
// live server-side — see lib/backup.ts). These two functions are the only door
// in/out of the whole store, so the localStorage key stays owned by this module.

/** The entire watch-history store — for inclusion in an exported backup. */
export function exportWatchHistory(): Store {
  return read();
}

/**
 * Replace the entire watch-history store from a backup bundle. Each entry is
 * coerced to a valid shape and anything malformed is dropped, so a hand-edited or
 * foreign file can't poison the store. The write fires the update event, so any
 * open grid/player reflects the restored progress immediately.
 */
export function importWatchHistory(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const next: Store = {};
  for (const [shortcode, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!shortcode || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const position = Number(v.position);
    const duration = Number(v.duration);
    const updatedAt = Number(v.updatedAt);
    const rotation = Number(v.rotation);
    const zoom = Number(v.zoom);
    next[shortcode] = {
      position: Number.isFinite(position) && position >= 0 ? position : 0,
      duration: Number.isFinite(duration) && duration >= 0 ? duration : 0,
      completed: v.completed === true,
      rotation:
        rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0,
      zoom: Number.isFinite(zoom) && zoom > 0 ? clampZoom(zoom) : 1,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    };
  }
  write(next);
}

/**
 * React hook: the live watch-history map. Re-reads on write (this tab), on
 * cross-tab storage events, and when the window/tab regains focus — so returning
 * from the player immediately reflects new progress.
 */
export function useWatchHistory(): Store {
  const [store, setStore] = useState<Store>({});
  useEffect(() => {
    const sync = () => setStore(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return store;
}
