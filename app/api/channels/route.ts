import { NextResponse } from "next/server";
import type { Catalog } from "@/lib/contracts";
import {
  getLibrary,
  mergeHarvest,
  removeChannel,
  saveLibrary,
  upsertChannel,
  withLibraryLock,
} from "@/lib/catalog";
import { getSettings, clampRefreshLimit } from "@/lib/settings";
import { cdpResolver } from "@/lib/resolvers/cdp";
import { parseHandle } from "@/lib/handle";

// Manage the set of subscribed channels. Like /api/refresh this drives the browser
// over CDP, so it runs on the Node runtime (the default for route handlers).

/**
 * Add a channel. Body: { input: "<handle | @handle | profile URL>", limit?: number }.
 * Registers the channel, then harvests (no known set) so its reels show up
 * immediately — add is a one-step action, not "add then separately refresh". The
 * harvest is capped at `limit` when the caller provides one (clamped to the valid
 * range), else the configured refresh limit (data/settings.json): a brand-new
 * channel can have thousands of reels, so a first add pulls the newest N, not the
 * entire back-catalog. The per-add limit lets a new channel pull more (or fewer)
 * on its first harvest than a routine refresh does, without touching the setting.
 *
 * Runs under withLibraryLock so the read-harvest-merge-save can't race a
 * concurrent refresh/remove (and so it doesn't drive the shared browser while
 * another harvest is mid-scroll).
 */
export async function POST(req: Request) {
  let input: string | undefined;
  let rawLimit: unknown;
  try {
    const body = await req.json();
    input = body?.input;
    rawLimit = body?.limit;
  } catch {
    /* fall through to validation */
  }

  const handle = parseHandle(input ?? "");
  if (!handle) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid Instagram handle or profile URL." },
      { status: 400 }
    );
  }

  const outcome = await withLibraryLock(async () => {
    const library = await getLibrary();
    if (library.channels.some((c) => c.handle === handle)) {
      return {
        status: 409,
        json: { ok: false, error: `@${handle} is already in your channels.` },
      };
    }

    // Register first (bare display name) so the channel exists even if the harvest
    // comes back thin; mergeHarvest fills in the real display name + reels.
    const today = new Date().toISOString().slice(0, 10);
    let next = {
      channels: upsertChannel(library.channels, {
        handle,
        displayName: handle,
        harvestedAt: today,
      }),
      reels: library.reels,
    };

    try {
      // A per-add limit (optional) overrides the setting for this first harvest
      // only; when omitted, fall back to the configured refresh limit.
      const { refreshLimit } = await getSettings();
      const limit =
        rawLimit === undefined || rawLimit === null || rawLimit === ""
          ? refreshLimit
          : clampRefreshLimit(rawLimit);
      const harvest: Catalog = await cdpResolver.listChannel(handle, undefined, limit);
      if (harvest.reels.length === 0) {
        return {
          status: 502,
          json: {
            ok: false,
            error:
              "Harvested 0 reels — the profile may be private, empty, or not loaded. Not added.",
          },
        };
      }
      next = mergeHarvest(next, harvest).library;
    } catch (err) {
      return {
        status: 502,
        json: {
          ok: false,
          error:
            "Couldn't reach the browser. Make sure it's open, signed in to Instagram, and exposing the CDP port. " +
            (err instanceof Error ? err.message : String(err)),
        },
      };
    }

    await saveLibrary(next);
    const added = next.reels.filter((r) => r.channel === handle).length;
    return {
      status: 200,
      json: { ok: true, channel: handle, added, channels: next.channels },
    };
  });

  return NextResponse.json(outcome.json, { status: outcome.status });
}

/** Remove a channel and all of its reels. Body: { handle: "<handle>" }. Runs
 *  under withLibraryLock so its read-modify-write can't race a concurrent
 *  refresh/add (which could otherwise write a snapshot that un-removes it). */
export async function DELETE(req: Request) {
  let handle: string | undefined;
  try {
    handle = (await req.json())?.handle;
  } catch {
    /* fall through */
  }
  if (!handle) {
    return NextResponse.json(
      { ok: false, error: "No channel specified." },
      { status: 400 }
    );
  }

  const outcome = await withLibraryLock(async () => {
    const library = await getLibrary();
    if (!library.channels.some((c) => c.handle === handle)) {
      return {
        status: 404,
        json: { ok: false, error: `@${handle} isn't in your channels.` },
      };
    }

    const next = removeChannel(library, handle);
    await saveLibrary(next);
    return { status: 200, json: { ok: true, channels: next.channels } };
  });

  return NextResponse.json(outcome.json, { status: outcome.status });
}
