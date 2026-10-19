"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Channel, Reel } from "@/lib/contracts";
import {
  useWatchHistory,
  statusOf,
  CONTINUE_WATCHING_LIMIT,
  type WatchEntry,
} from "@/lib/progress";
import { type Filter, parseFilter } from "@/lib/prefs";
import type { ViewPrefs } from "@/lib/settings";
import ChannelMenu from "./ChannelMenu";

// Persist the durable view fallback (filter + channel selection) to the settings
// store. Best-effort and fire-and-forget — exactly the role the old localStorage
// write played, now server-side so all settings live in one home (data/settings.
// json). The URL stays the in-session source of truth; this is only what a cold
// open restores from.
function persistView(view: ViewPrefs): void {
  fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ view }),
    keepalive: true,
  }).catch(() => {});
}

// The grid is a client component so it can read local watch history. The library
// itself is still fetched on the server (page.tsx) and handed down as plain data.
// Two filter dimensions compose here: the seen/fresh pills and the channel
// multi-select. Both live in the URL (so navigating into a reel and back preserves
// the view) and are mirrored to the settings store (so a cold app open restores
// them). `initialView` is that stored fallback, read on the server (page.tsx).
export default function CatalogGrid({
  reels,
  channels,
  initialView,
}: {
  reels: Reel[];
  channels: Channel[];
  initialView: ViewPrefs;
}) {
  const history = useWatchHistory();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filter = parseFilter(searchParams.get("filter"));

  // Channel selection: `?ch=a,b` → explicit subset; absent → all channels (null).
  // We intersect with channels that still exist so a removed channel can't linger
  // in the URL and silently hide everything.
  const allHandles = useMemo(() => channels.map((c) => c.handle), [channels]);
  const selected = useMemo<string[] | null>(() => {
    const raw = searchParams.get("ch");
    if (!raw) return null;
    const live = new Set(allHandles);
    const picked = raw.split(",").filter((h) => live.has(h));
    // An explicit full set is equivalent to "all" — normalize to null.
    return picked.length === allHandles.length ? null : picked;
  }, [searchParams, allHandles]);

  const selectedSet = useMemo(
    () => new Set(selected ?? allHandles),
    [selected, allHandles]
  );

  // Write a param set to the URL and remember it for next launch. `replace` (not
  // push) so filter changes don't pile up in back-button history. `persist` is
  // false when we're only restoring the stored fallback on cold open (no need to
  // write back the same value we just read).
  const apply = (
    next: { filter?: Filter; channels?: string[] | null },
    { persist = true }: { persist?: boolean } = {}
  ) => {
    const params = new URLSearchParams(searchParams);
    const nextFilter = next.filter ?? filter;
    const nextChannels = next.channels === undefined ? selected : next.channels;

    if (nextFilter === "all") params.delete("filter");
    else params.set("filter", nextFilter);

    if (nextChannels === null || nextChannels.length === allHandles.length) {
      params.delete("ch");
    } else {
      params.set("ch", [...nextChannels].sort().join(","));
    }

    if (persist) persistView({ filter: nextFilter, channels: nextChannels });
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const setFilter = (next: Filter) => apply({ filter: next });
  const setChannels = (next: string[] | null) => apply({ channels: next });

  // Cold-open hydration: if the URL carries no view params, restore the last-used
  // filter + channels from the stored fallback (server-provided initialView). Runs
  // once; later changes go through apply() which writes both the URL and the store.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (searchParams.has("filter") || searchParams.has("ch")) return;
    if (initialView.filter === "all" && initialView.channels === null) return; // nothing to restore
    apply({ filter: initialView.filter, channels: initialView.channels }, { persist: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reels within the selected channels — the base every count/filter works over.
  const base = useMemo(
    () => (selected === null ? reels : reels.filter((r) => selectedSet.has(r.channel))),
    [reels, selected, selectedSet]
  );

  // Per-channel reel totals for the dropdown (over the full library, not the base).
  const channelOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reels) counts.set(r.channel, (counts.get(r.channel) ?? 0) + 1);
    return channels.map((c) => ({
      handle: c.handle,
      displayName: c.displayName,
      count: counts.get(c.handle) ?? 0,
    }));
  }, [reels, channels]);

  // "Continue watching": in-progress reels in the selected channels, most-recently
  // watched first, top N. (Resuming is about recency, not publish order.)
  const continueWatching = useMemo(() => {
    return base
      .map((reel) => ({ reel, entry: history[reel.shortcode] }))
      .filter((x) => statusOf(x.entry) === "in-progress")
      .sort((a, b) => (b.entry!.updatedAt ?? 0) - (a.entry!.updatedAt ?? 0))
      .slice(0, CONTINUE_WATCHING_LIMIT);
  }, [base, history]);

  // Counts for the filter pills, over the channel-filtered base. "Seen" = finished;
  // "Fresh" = everything else (never started OR left partway).
  const seenCount = useMemo(
    () => base.filter((r) => statusOf(history[r.shortcode]) === "watched").length,
    [base, history]
  );
  const freshCount = base.length - seenCount;

  // `base` preserves publish order (from getLibrary), so filtering just drops rows.
  const visible = useMemo(() => {
    if (filter === "all") return base;
    return base.filter((r) => {
      const isSeen = statusOf(history[r.shortcode]) === "watched";
      return filter === "seen" ? isSeen : !isSeen;
    });
  }, [base, history, filter]);

  // Carry the active view into the player so its up-next playlist matches the grid.
  const query = searchParams.toString();

  return (
    <section className="mx-auto max-w-7xl px-6 py-8">
      {continueWatching.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Continue watching
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
            {continueWatching.map(({ reel, entry }) => (
              <div key={reel.shortcode} className="w-36 shrink-0 sm:w-44">
                <Tile reel={reel} entry={entry} query={query} resume />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters: channel multi-select + seen/fresh pills */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {channels.length > 1 && (
          <ChannelMenu
            channels={channelOptions}
            selected={selected}
            onChange={setChannels}
          />
        )}
        <FilterPill label="All" count={base.length} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterPill label="Fresh" count={freshCount} active={filter === "fresh"} onClick={() => setFilter("fresh")} />
        <FilterPill label="Seen" count={seenCount} active={filter === "seen"} onClick={() => setFilter("seen")} />
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">
          {selectedSet.size === 0
            ? "No channels selected."
            : filter === "seen"
              ? "Nothing watched yet."
              : "No reels here."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {visible.map((reel) => (
            <Tile
              key={reel.shortcode}
              reel={reel}
              entry={history[reel.shortcode]}
              query={query}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 ${
        active
          ? "bg-white text-neutral-900"
          : "border border-white/15 text-neutral-300 hover:bg-white/10"
      }`}
    >
      {label}
      <span className="ml-1.5 tabular-nums text-neutral-500">{count}</span>
    </button>
  );
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function Tile({
  reel,
  entry,
  query,
  resume = false,
}: {
  reel: Reel;
  entry?: WatchEntry;
  query: string;
  resume?: boolean;
}) {
  const status = statusOf(entry);
  const watched = status === "watched";
  const pct =
    entry && entry.duration
      ? Math.min(100, (entry.position / entry.duration) * 100)
      : 0;

  return (
    <a
      href={`/watch/${reel.shortcode}${query ? `?${query}` : ""}`}
      // Mark that we entered the player from the grid, so the player's "Back"
      // can history.back() into this exact scroll position (instead of rebuilding
      // the grid from scratch and jumping to the top).
      onClick={() => {
        try {
          sessionStorage.setItem("reel-watcher:from-grid", "1");
        } catch {}
      }}
      className="group relative block overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/5 transition hover:ring-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
    >
      <div className="relative aspect-[9/16] w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/thumb/${reel.shortcode}`}
          alt={reel.shortcode}
          loading="lazy"
          className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 ${
            // Watched reels recede (dimmed + desaturated); hover restores them so
            // rewatching stays one obvious click away.
            watched
              ? "opacity-45 saturate-50 group-hover:opacity-100 group-hover:saturate-100"
              : ""
          }`}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />

        {/* "Seen" badge — only on finished reels. The calm signal. */}
        {watched && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-seen backdrop-blur">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
            </svg>
            Seen
          </span>
        )}

        {/* Resume chip — only in the Continue watching row. */}
        {resume && entry && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            {fmt(entry.position)}
          </span>
        )}

        {reel.views && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 text-xs font-semibold tabular-nums text-white drop-shadow">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            {reel.views}
          </span>
        )}

        {/* Resume progress bar — only in the Continue watching row. */}
        {resume && (
          <div className="absolute bottom-0 left-0 h-[3px] w-full bg-white/25">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </a>
  );
}
