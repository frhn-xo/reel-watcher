import { NextResponse } from "next/server";
import type { Catalog } from "@/lib/contracts";
import {
  getLibrary,
  mergeHarvest,
  removeChannel,
  saveLibrary,
  upsertChannel,
} from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { cdpResolver } from "@/lib/resolvers/cdp";
import { parseHandle } from "@/lib/handle";

// Manage the set of subscribed channels. Like /api/refresh this drives the browser
// over CDP, so it runs on the Node runtime (the default for route handlers).

/**
 * Add a channel. Body: { input: "<handle | @handle | profile URL>" }.
 * Registers the channel, then harvests (no known set) so its reels show up
 * immediately — add is a one-step action, not "add then separately refresh". The
 * harvest is capped at the configured refresh limit (data/settings.json): a brand-
 * new channel can have thousands of reels, so a first add pulls the newest N, not
 * the entire back-catalog.
 */
export async function POST(req: Request) {
  let input: string | undefined;
  try {
    input = (await req.json())?.input;
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

  const library = await getLibrary();
  if (library.channels.some((c) => c.handle === handle)) {
    return NextResponse.json(
      { ok: false, error: `@${handle} is already in your channels.` },
      { status: 409 }
    );
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
    const { refreshLimit } = await getSettings();
    const harvest: Catalog = await cdpResolver.listChannel(handle, undefined, refreshLimit);
    if (harvest.reels.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Harvested 0 reels — the profile may be private, empty, or not loaded. Not added.",
        },
        { status: 502 }
      );
    }
    next = mergeHarvest(next, harvest).library;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Couldn't reach the browser. Make sure it's open, signed in to Instagram, and exposing the CDP port. " +
          (err instanceof Error ? err.message : String(err)),
      },
      { status: 502 }
    );
  }

  await saveLibrary(next);
  const added = next.reels.filter((r) => r.channel === handle).length;
  return NextResponse.json({ ok: true, channel: handle, added, channels: next.channels });
}

/** Remove a channel and all of its reels. Body: { handle: "<handle>" }. */
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

  const library = await getLibrary();
  if (!library.channels.some((c) => c.handle === handle)) {
    return NextResponse.json(
      { ok: false, error: `@${handle} isn't in your channels.` },
      { status: 404 }
    );
  }

  const next = removeChannel(library, handle);
  await saveLibrary(next);
  return NextResponse.json({ ok: true, channels: next.channels });
}
