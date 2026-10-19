"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Multi-select channel filter — the home for channels in the grid. Selecting
// composes with the seen/fresh pills (CatalogGrid owns both). `selected == null`
// means "all channels" (the default, and auto-includes any channel added later);
// an explicit array is a chosen subset. Per-channel Refresh lives here too: it's
// used often, so it's one click away (not buried in settings) — DESIGN.md §3.

export interface ChannelOption {
  handle: string;
  displayName: string;
  count: number; // reels currently in the library for this channel
}

export default function ChannelMenu({
  channels,
  selected,
  onChange,
}: {
  channels: ChannelOption[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const allHandles = channels.map((c) => c.handle);
  const isAll = selected === null;
  const selectedSet = new Set(isAll ? allHandles : selected);
  const selectedCount = selectedSet.size;

  // Close on outside click / Escape (same pattern as the player's speed menu).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Collapse an explicit full set back to the "all" sentinel so a newly-added
  // channel still shows up by default.
  const commit = (next: Set<string>) => {
    if (next.size === allHandles.length && allHandles.every((h) => next.has(h))) {
      onChange(null);
    } else {
      onChange([...next]);
    }
  };

  const toggle = (handle: string) => {
    const next = new Set(selectedSet);
    if (next.has(handle)) next.delete(handle);
    else next.add(handle);
    commit(next);
  };

  async function refreshOne(handle: string) {
    setRefreshing((s) => new Set(s).add(handle));
    try {
      await fetch("/api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels: [handle] }),
      });
      router.refresh();
    } catch {
      /* best-effort; the header Refresh surfaces detailed errors */
    } finally {
      setRefreshing((s) => {
        const n = new Set(s);
        n.delete(handle);
        return n;
      });
    }
  }

  const label =
    channels.length === 0
      ? "No channels"
      : isAll
        ? "All channels"
        : `${selectedCount} of ${channels.length}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-sm font-medium text-neutral-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
        </svg>
        {label}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-2 max-h-[70vh] w-72 overflow-auto rounded-lg bg-neutral-900/95 py-1 text-sm shadow-xl ring-1 ring-white/10 backdrop-blur"
        >
          <Row
            checked={isAll}
            label="All channels"
            onClick={() => onChange(null)}
          />

          <div className="my-1 h-px bg-white/10" />

          {channels.map((c) => (
            <Row
              key={c.handle}
              checked={selectedSet.has(c.handle)}
              label={c.displayName}
              sub={`@${c.handle}`}
              count={c.count}
              busy={refreshing.has(c.handle)}
              onClick={() => toggle(c.handle)}
              onRefresh={() => refreshOne(c.handle)}
            />
          ))}

          <div className="my-1 h-px bg-white/10" />

          <Link
            href="/settings"
            className="flex items-center gap-2 px-3 py-2 text-neutral-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M11 9h2V7h-2v2zm1 13C6.48 22 2 17.52 2 12S6.48 2 12 2s10 4.48 10 10-4.48 10-10 10zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8 8-3.59 8-8-3.59-8-8-8zm-1 15h2v-6h-2v6z" />
            </svg>
            Manage channels
          </Link>
        </div>
      )}
    </div>
  );
}

function Row({
  checked,
  label,
  sub,
  count,
  busy,
  onClick,
  onRefresh,
}: {
  checked: boolean;
  label: string;
  sub?: string;
  count?: number;
  busy?: boolean;
  onClick: () => void;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 transition hover:bg-white/10">
      <button
        role="menuitemcheckbox"
        aria-checked={checked}
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none"
      >
        <span
          className={`grid h-4 w-4 shrink-0 place-items-center rounded ${
            checked ? "bg-white text-neutral-900" : "ring-1 ring-white/25"
          }`}
          aria-hidden
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-neutral-100">{label}</span>
          {sub && <span className="block truncate text-xs text-neutral-500">{sub}</span>}
        </span>
        {typeof count === "number" && (
          <span className="shrink-0 tabular-nums text-xs text-neutral-500">{count}</span>
        )}
      </button>

      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={busy}
          aria-label={`Refresh ${sub ?? label}`}
          title={`Refresh ${sub ?? label}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
            className={busy ? "animate-spin" : ""}
          >
            <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z" />
          </svg>
        </button>
      )}
    </div>
  );
}
