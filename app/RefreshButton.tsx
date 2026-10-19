"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Header Refresh — the frequent, visible maintenance action (DESIGN.md §3: ghost
// button at the edge). It re-harvests whatever channels are CURRENTLY SELECTED in
// the grid (all of them when the selection is "all"), driving the signed-in
// browser via /api/refresh, then re-streams the server catalog.
// Granular one-at-a-time refresh lives in the channel dropdown (ChannelMenu).

type RefreshResult = { channel: string; added: number; total: number; error?: string };

export default function RefreshButton({ channels }: { channels: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const working = busy || isPending;

  // Which channels the Refresh acts on: the grid's current selection, else all.
  const raw = searchParams.get("ch");
  const live = new Set(channels);
  const targets = raw ? raw.split(",").filter((h) => live.has(h)) : channels;

  async function refresh() {
    if (targets.length === 0) {
      setNote("No channels to refresh.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels: targets }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setNote(data.error ?? "Refresh failed.");
        return;
      }
      const failed = (data.results as RefreshResult[] | undefined)?.filter((r) => r.error) ?? [];
      const base =
        data.added > 0 ? `+${data.added} new · ${data.total} total` : `Up to date · ${data.total} reels`;
      setNote(failed.length ? `${base} · ${failed.length} failed` : base);
      startTransition(() => router.refresh());
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      {note && <span className="text-xs text-neutral-400">{note}</span>}
      <button
        onClick={refresh}
        disabled={working || channels.length === 0}
        title="Re-harvest the selected channels from the live, signed-in browser"
        className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-1.5 text-sm text-neutral-200 transition hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={working ? "animate-spin" : ""}
          aria-hidden
        >
          <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z" />
        </svg>
        {working ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
