import { NextResponse } from "next/server";
import type { Catalog } from "@/lib/contracts";
import { getLibrary, mergeHarvest, saveLibrary, withLibraryLock } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { cdpResolver } from "@/lib/resolvers/cdp";

// This route drives the signed-in browser over CDP (needs sockets +
// fs — the Node runtime, which is the default for route handlers). This project
// uses Next 16 Cache Components, which forbids `runtime`/`dynamic` segment config,
// so none is set; a POST handler is dynamic and never prerendered regardless.

/**
 * Re-harvest the latest reels for one or more channels from the live, logged-in
 * browser and persist them to the library. Body:
 *   { channels: ["a", "b"] }  → refresh exactly these
 *   { channel: "a" }          → refresh just this one (convenience)
 *   {}                        → refresh every subscribed channel
 *
 * Each channel is harvested INCREMENTALLY (its own known shortcodes bound the
 * scan) and unioned in, so reels from channels we didn't refresh are untouched.
 * Harvesting is sequential: it drives one shared browser, and parallel CDP tabs
 * would contend. A per-channel failure is reported but doesn't abort the rest.
 *
 * The whole read-harvest-merge-save runs under withLibraryLock so it can't race a
 * concurrent refresh/add/remove (which would read the same starting library and
 * clobber each other's save) — the lock also serializes the shared browser.
 */
export async function POST(req: Request) {
  let body: { channel?: string; channels?: string[] } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body is fine → refresh all */
  }

  const outcome = await withLibraryLock(async () => {
    const library = await getLibrary();

    // Resolve which channels to refresh: explicit list, single, or all on file.
    let targets = body.channels ?? (body.channel ? [body.channel] : null);
    if (!targets) targets = library.channels.map((c) => c.handle);
    targets = [...new Set(targets.filter(Boolean))];

    if (targets.length === 0) {
      return {
        status: 400,
        json: { ok: false, error: "No channels to refresh. Add a channel first." },
      };
    }

    // One harvest cap for every channel (data/settings.json). Bounds a big
    // backfill: a channel that posted a lot since last refresh pulls at most
    // `refreshLimit` newest reels instead of the whole gap.
    const { refreshLimit } = await getSettings();

    // Thread the library through each harvest so sequential merges accumulate.
    let current = library;
    const results: Array<{ channel: string; added: number; total: number; error?: string }> = [];

    for (const handle of targets) {
      const known = new Set(
        current.reels.filter((r) => r.channel === handle).map((r) => r.shortcode)
      );
      try {
        const harvest: Catalog = await cdpResolver.listChannel(handle, known, refreshLimit);
        if (harvest.reels.length === 0 && known.size === 0) {
          // First-ever harvest returning nothing → likely not loaded / not logged in.
          results.push({
            channel: handle,
            added: 0,
            total: 0,
            error: "Harvested 0 reels — profile may not have loaded or isn't logged in.",
          });
          continue;
        }
        const merged = mergeHarvest(current, harvest);
        current = merged.library;
        const total = current.reels.filter((r) => r.channel === handle).length;
        results.push({ channel: handle, added: merged.added, total });
      } catch (err) {
        results.push({
          channel: handle,
          added: 0,
          total: current.reels.filter((r) => r.channel === handle).length,
          error:
            "Couldn't reach the browser. Make sure it's open, signed in to Instagram, and exposing the CDP port. " +
            (err instanceof Error ? err.message : String(err)),
        });
      }
    }

    const anySucceeded = results.some((r) => !r.error);
    if (anySucceeded) await saveLibrary(current);

    const added = results.reduce((n, r) => n + r.added, 0);
    const total = current.reels.length;

    // If every requested channel failed, surface it as an error (502) so the UI
    // can show the reason rather than a misleading "up to date".
    if (!anySucceeded) {
      return {
        status: 502,
        json: { ok: false, error: results[0]?.error ?? "Refresh failed.", results },
      };
    }

    return { status: 200, json: { ok: true, added, total, results } };
  });

  return NextResponse.json(outcome.json, { status: outcome.status });
}
