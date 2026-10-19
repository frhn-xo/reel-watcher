// The shapes the rest of the app depends on. Application code uses only these
// interfaces; the concrete platform code lives behind the ReelResolver interface
// (see lib/resolvers/cdp.ts).

/** A single reel in the catalog (metadata only — no video bytes). */
export interface Reel {
  shortcode: string; // stable unique id — also our dedup key (globally unique across IG)
  url: string; // canonical instagram.com/.../reel/<shortcode>/
  thumbnail: string; // signed CDN cover-image URL (expires; we proxy it)
  views: string | null; // e.g. "1.5M" (display only)
  caption?: string | null; // reel caption → used as the title
  channel: string; // which channel's handle this reel belongs to (set when stored)
}

/** The harvest result for ONE channel — the shape a ReelResolver returns. */
export interface Catalog {
  channel: string; // instagram handle
  displayName: string;
  harvestedAt: string; // ISO date the list was pulled
  reels: Reel[];
}

/** One subscribed channel in the library (metadata, no reels). */
export interface Channel {
  handle: string; // instagram handle (no @) — stable id
  displayName: string;
  harvestedAt: string; // ISO date this channel was last harvested
}

/**
 * The whole library the app renders: every subscribed channel plus the union of
 * all their reels (each reel tagged with its `channel`). This is what persists to
 * data/reels.json and what getLibrary() returns. A single ReelResolver still
 * harvests one channel at a time (returning a Catalog); the refresh/add routes
 * tag and union those into this shape.
 */
export interface Library {
  channels: Channel[];
  reels: Reel[];
}

/** Identify a reel to resolve. */
export type ReelRef = { shortcode: string };

/**
 * Thrown by ReelResolver.resolve() when the reel is PERMANENTLY unavailable on the
 * source platform — removed, taken down, or made private — as opposed to a
 * transient failure (browser down, rate limit, network). The stream route maps
 * this to HTTP 410 Gone so the player can say "no longer available" instead of a
 * generic error. A transient failure stays a 502 and is worth retrying.
 */
export class ReelUnavailableError extends Error {
  readonly shortcode: string;
  constructor(shortcode: string, message?: string) {
    super(message ?? `Reel ${shortcode} is no longer available`);
    this.name = "ReelUnavailableError";
    this.shortcode = shortcode;
  }
}

/**
 * A reel resolved to a playable media source. The signed CDN URL is short-lived
 * (expires in hours), so resolve() is re-run on demand rather than treated as
 * durable — see lib/resolve.ts + the stream proxy. This is the exact shape the
 * resolved-video store persists and serves.
 */
export interface ResolvedVideo {
  videoUrl: string; // signed, expiring CDN mp4 (progressive, muxed H.264+AAC)
  caption: string | null; // reel caption → used as the player title
  durationMs: number; // media length in milliseconds
}

/**
 * Anything that can talk to the source platform (list a channel's reels, resolve
 * one reel to its media). The adapter is the CDP resolver (see lib/resolvers/cdp.ts,
 * which exports `cdpResolver`).
 */
export interface ReelResolver {
  /**
   * List a channel's reels (metadata only).
   *
   * `knownShortcodes` enables an *incremental* harvest: the resolver scans
   * newest-first and stops early once it scrolls past the recent reels into a
   * run of already-known ones, instead of walking the entire back-catalog every
   * time. The returned Catalog is therefore a PARTIAL, recent window (new reels
   * plus a small known overlap) — the caller is responsible for unioning it into
   * whatever it already has. Omit the set (or pass an empty one) for a full
   * harvest, e.g. the first run when nothing is on file.
   *
   * `limit` caps how many reels a single harvest pulls (newest-first). It bounds
   * both the first-ever harvest (a channel may have thousands of reels) and a big
   * backfill (a channel that posted a lot since last refresh). The window returned
   * is therefore the newest `limit` reels at most; omit for no cap.
   */
  listChannel(
    channel: string,
    knownShortcodes?: Set<string>,
    limit?: number
  ): Promise<Catalog>;
  /** Resolve one reel to a fresh, playable media source. */
  resolve(ref: ReelRef): Promise<ResolvedVideo>;
}
