import { promises as fs } from "fs";
import path from "path";
import type { Catalog, Channel, Library, Reel, ResolvedVideo } from "./contracts";
import { writeJsonFileAtomic } from "./atomic";

// Re-exported so existing imports (`@/lib/catalog`'s ResolvedVideo) keep working;
// the canonical definition lives in the port layer (contracts.ts).
export type { ResolvedVideo };

// The app reads the library from here. It does not know or care how the data was
// harvested — it only depends on the Library shape. One file holds every
// subscribed channel plus the union of their reels (each tagged with its channel).
// Writes go through saveLibrary(); the /api/refresh and /api/channels routes
// compose the read/merge/write cycle.

const DATA_FILE = path.join(process.cwd(), "data", "reels.json");
const RESOLVED_FILE = path.join(process.cwd(), "data", "resolved.json");

// Instagram shortcodes base64-decode (custom alphabet) to the media's primary key,
// which increases monotonically with publish time. So decoding gives us a reliable
// chronological sort key even though reels.json is stored in harvest order.
const IG_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function shortcodeToPk(shortcode: string): bigint {
  // PKs are ~19 digits (beyond Number's safe range) so we accumulate as BigInt.
  // Use BigInt() calls, not `0n` literals, to stay compatible with the ES2017 target.
  const ZERO = BigInt(0);
  const BASE = BigInt(64);
  let n = ZERO;
  for (const ch of shortcode) {
    const v = IG_ALPHABET.indexOf(ch);
    if (v < 0) return ZERO; // unknown char → sort last; don't throw
    n = n * BASE + BigInt(v);
  }
  return n;
}

// Canonical order for the whole app: newest-published first. Everything downstream
// (grid, filters, player playlist) inherits this single order.
function sortNewestFirst(reels: Reel[]): Reel[] {
  return [...reels].sort((a, b) => {
    const pa = shortcodeToPk(a.shortcode);
    const pb = shortcodeToPk(b.shortcode);
    return pb > pa ? 1 : pb < pa ? -1 : 0;
  });
}

// The on-disk file started life as a single-channel Catalog ({channel, displayName,
// harvestedAt, reels[]}). Multi-channel upgrades it to a Library ({channels[],
// reels[]}) where each reel is tagged with its channel. We migrate on read (and
// persist the upgrade) so old files self-heal with no manual step; a legacy reel
// with no `channel` field inherits the file's single channel.
type LegacyCatalog = Omit<Catalog, "reels"> & {
  reels: Array<Omit<Reel, "channel"> & { channel?: string }>;
};

function isLibrary(data: unknown): data is Library {
  return !!data && Array.isArray((data as Library).channels);
}

function migrate(legacy: LegacyCatalog): Library {
  const handle = legacy.channel;
  return {
    channels: [
      {
        handle,
        displayName: legacy.displayName || handle,
        harvestedAt: legacy.harvestedAt,
      },
    ],
    reels: (legacy.reels ?? []).map((r) => ({ ...r, channel: r.channel ?? handle })),
  };
}

/** Read the library from disk, migrating a legacy single-channel file if needed. */
export async function getLibrary(): Promise<Library> {
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(DATA_FILE, "utf-8"));
  } catch {
    return { channels: [], reels: [] }; // nothing harvested yet
  }

  let library: Library;
  if (isLibrary(data)) {
    library = data;
  } else {
    library = migrate(data as LegacyCatalog);
    await saveLibrary(library); // persist the upgrade so it only happens once
  }

  return { channels: library.channels, reels: sortNewestFirst(library.reels) };
}

/** Overwrite the library file. Reels are stored in whatever order they arrive;
 *  getLibrary() is the single place that imposes chronological order on read.
 *  Written atomically (temp + rename) so a crash mid-write can't truncate it. */
export async function saveLibrary(library: Library): Promise<void> {
  await writeJsonFileAtomic(DATA_FILE, library);
}

// ─── Serialized library mutations ────────────────────────────────────────────
// A library write is a read-modify-write over the WHOLE file (read everything,
// change a bit, write everything back), and the harvest that feeds it drives the
// ONE shared browser. Both facts demand these operations run strictly one at a
// time. Without it, two overlapping operations each read the same starting
// library and the second save clobbers the first's change — a silent lost update
// (e.g. "add channel" vanishing because a concurrent refresh wrote a snapshot
// that predated it) — and two harvests would also fight over the same browser
// tabs.
//
// A single in-process promise-chain lock serializes them in arrival order (the
// same pattern used for the resolved-video store below, generalized). Pure reads
// (getLibrary) deliberately do NOT take the lock: the atomic write above means a
// reader always sees a complete file, so the grid and player stay responsive
// while a harvest runs — only writers queue, and only against each other.
//
// In-process only: this is one lock per Node process, which is exactly right for
// a single-user local app. A multi-process deployment against the same data dir
// would need a file lock or a database instead.
let libraryLock: Promise<unknown> = Promise.resolve();

/** Run `fn` with exclusive access to the library (refresh / add / remove all
 *  share this lock). Each caller still awaits — and sees the error of — its own
 *  run; a failed run doesn't poison the chain for the next waiter. */
export function withLibraryLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = libraryLock.then(fn);
  libraryLock = run.catch(() => {});
  return run;
}

export async function getReelByShortcode(shortcode: string): Promise<Reel | null> {
  const library = await getLibrary();
  return library.reels.find((r) => r.shortcode === shortcode) ?? null;
}

// ─── Library mutations (used by the API routes) ──────────────────────────────

/**
 * Union a freshly-harvested channel Catalog into an existing library and return
 * the new library plus how many reels were added. The harvest is typically only a
 * RECENT WINDOW (incremental), so we upsert rather than replace: fresh fields win
 * (newer signed thumbnail, updated caption/views), falling back to prior values
 * when a best-effort pass (e.g. view counts) didn't capture them. Reels belonging
 * to OTHER channels are left untouched.
 */
export function mergeHarvest(
  library: Library,
  harvest: Catalog
): { library: Library; added: number } {
  const prior = new Map(library.reels.map((r) => [r.shortcode, r]));
  let added = 0;
  for (const r of harvest.reels) {
    const old = prior.get(r.shortcode);
    if (!old) added++;
    prior.set(r.shortcode, {
      ...old,
      ...r,
      views: r.views ?? old?.views ?? null,
      caption: r.caption ?? old?.caption ?? null,
      channel: r.channel || harvest.channel,
    });
  }

  const channels = upsertChannel(library.channels, {
    handle: harvest.channel,
    displayName: harvest.displayName || harvest.channel,
    harvestedAt: harvest.harvestedAt,
  });

  return { library: { channels, reels: [...prior.values()] }, added };
}

/** Add or update a channel in the registry (match by handle). */
export function upsertChannel(channels: Channel[], next: Channel): Channel[] {
  const i = channels.findIndex((c) => c.handle === next.handle);
  if (i < 0) return [...channels, next];
  const merged = { ...channels[i], ...next };
  // Don't let a bare handle clobber a real display name we already learned.
  merged.displayName = next.displayName || channels[i].displayName || next.handle;
  const copy = [...channels];
  copy[i] = merged;
  return copy;
}

/** Remove a channel and all of its reels from the library. */
export function removeChannel(library: Library, handle: string): Library {
  return {
    channels: library.channels.filter((c) => c.handle !== handle),
    reels: library.reels.filter((r) => r.channel !== handle),
  };
}

// ─── Resolved video store ────────────────────────────────────────────────────
// Cache of ReelResolver.resolve() output, keyed by shortcode. These signed CDN
// mp4 URLs expire in hours, so entries are disposable: when one is missing or has
// rotted, lib/resolve.ts re-resolves on demand and upserts a fresh URL here (the
// stream proxy drives this). The only durable identifier is the shortcode — which
// is globally unique, so this store needs no channel awareness.

interface ResolvedStore {
  resolvedAt: string;
  videos: Record<string, ResolvedVideo>;
}

export async function getResolvedStore(): Promise<ResolvedStore> {
  try {
    const raw = await fs.readFile(RESOLVED_FILE, "utf-8");
    return JSON.parse(raw) as ResolvedStore;
  } catch {
    return { resolvedAt: "", videos: {} };
  }
}

export async function getResolvedVideo(
  shortcode: string
): Promise<ResolvedVideo | null> {
  const store = await getResolvedStore();
  return store.videos[shortcode] ?? null;
}

// Persist a freshly-resolved video into the store. Writes are serialized through
// a single promise chain so two reels resolving at once can't clobber each
// other's read-modify-write on the shared JSON file. Each caller still awaits —
// and sees the error of — its own write; a failed write doesn't poison the chain.
let writeTail: Promise<unknown> = Promise.resolve();

export function upsertResolvedVideo(
  shortcode: string,
  video: ResolvedVideo
): Promise<void> {
  const run = writeTail.then(async () => {
    const store = await getResolvedStore();
    store.videos[shortcode] = video;
    store.resolvedAt = new Date().toISOString();
    await writeJsonFileAtomic(RESOLVED_FILE, store);
  });
  writeTail = run.catch(() => {});
  return run;
}
