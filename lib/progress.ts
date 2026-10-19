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
  updatedAt: number; // epoch ms — drives "most recently watched" ordering
}

/** Clockwise rotations a reel can be displayed at. Some IG sources carry broken
 *  orientation metadata, so we let the viewer correct it and remember the choice. */
export type Rotation = 0 | 90 | 180 | 270;

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
