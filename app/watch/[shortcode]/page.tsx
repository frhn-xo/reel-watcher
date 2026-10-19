import { Suspense } from "react";
import { getLibrary, getResolvedStore } from "@/lib/catalog";
import { parseFilter } from "@/lib/prefs";
import ReelPlayer, { type PlaylistItem } from "./ReelPlayer";

export default function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ shortcode: string }>;
  searchParams: Promise<{ ch?: string; filter?: string }>;
}) {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <Suspense fallback={<div className="h-screen w-screen bg-black" />}>
        <PlayerLoader params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function PlayerLoader({
  params,
  searchParams,
}: {
  params: Promise<{ shortcode: string }>;
  searchParams: Promise<{ ch?: string; filter?: string }>;
}) {
  const { shortcode } = await params;
  const { ch, filter } = await searchParams;
  const [library, resolved] = await Promise.all([getLibrary(), getResolvedStore()]);

  // Full playlist in publish order; the player narrows it to match the grid's
  // active view (channel selection + seen/fresh) client-side, since seen/fresh
  // depends on local watch history.
  const playlist: PlaylistItem[] = library.reels.map((r) => {
    const cap = resolved.videos[r.shortcode]?.caption;
    const title = (cap || r.caption || "")?.split("\n")[0] || r.shortcode;
    return { shortcode: r.shortcode, title, views: r.views, channel: r.channel };
  });

  const filterChannels = ch ? ch.split(",").filter(Boolean) : null;
  const filterMode = parseFilter(filter);

  // The view query, rebuilt so the player can keep it in the URL as reels change —
  // a mid-player refresh then restores the same filtered up-next list.
  const qp = new URLSearchParams();
  if (ch) qp.set("ch", ch);
  if (filterMode !== "all") qp.set("filter", filterMode);
  const query = qp.toString();

  return (
    <ReelPlayer
      playlist={playlist}
      startShortcode={shortcode}
      filterChannels={filterChannels}
      filterMode={filterMode}
      query={query}
    />
  );
}
