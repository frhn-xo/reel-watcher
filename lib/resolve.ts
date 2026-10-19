// Wires the resolver to the resolved-video store. The catalog only needs a reel's
// shortcode; the short-lived, signed video URL is minted fresh on demand and
// cached, so new reels and expired URLs both self-heal with no manual step.

import type { ResolvedVideo } from "./catalog";
import { upsertResolvedVideo } from "./catalog";
import { cdpResolver as resolver } from "./resolvers/cdp";

// De-dupe concurrent resolves of the same reel: if two stream requests for an
// unresolved (or just-expired) reel arrive together, they share one browser trip
// instead of opening two tabs and racing their writes.
const inFlight = new Map<string, Promise<ResolvedVideo>>();

/** Mint a fresh video URL for a reel, persist it, and return it. */
export function resolveAndCache(shortcode: string): Promise<ResolvedVideo> {
  const existing = inFlight.get(shortcode);
  if (existing) return existing;

  const p = (async () => {
    const video = await resolver.resolve({ shortcode });
    await upsertResolvedVideo(shortcode, video);
    return video;
  })();

  inFlight.set(shortcode, p);
  // Free the slot once settled (either way) so a later expiry can re-resolve.
  void p.catch(() => {}).finally(() => {
    if (inFlight.get(shortcode) === p) inFlight.delete(shortcode);
  });
  return p;
}
