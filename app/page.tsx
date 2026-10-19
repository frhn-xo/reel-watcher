import { Suspense } from "react";
import Link from "next/link";
import { getLibrary } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import CatalogGrid from "./CatalogGrid";
import RefreshButton from "./RefreshButton";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

// "2026-10-17" → "Oct 17, 2026". Pure string math (no Date) so the server and
// client render identically — no timezone drift, no hydration mismatch.
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`;
}

// The route renders instantly; the library read (uncached filesystem data) is
// streamed inside a <Suspense> boundary. This satisfies Next 16 Cache Components
// and keeps the data dynamic, so an /api/refresh shows up without a rebuild.

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <Suspense fallback={<GridSkeleton />}>
        <CatalogView />
      </Suspense>
    </main>
  );
}

async function CatalogView() {
  const [library, settings] = await Promise.all([getLibrary(), getSettings()]);
  const { channels, reels } = library;
  const handles = channels.map((c) => c.handle);
  // Newest harvest across all channels (ISO dates sort lexicographically).
  const lastUpdated = channels.reduce(
    (max, c) => (c.harvestedAt > max ? c.harvestedAt : max),
    ""
  );

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-50">
                Reel Watcher
              </h1>
              {channels.length > 0 ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-neutral-400">
                  <span className="tabular-nums text-neutral-300">
                    {channels.length} {channels.length === 1 ? "channel" : "channels"}
                  </span>
                  <Dot />
                  <span className="tabular-nums">{reels.length} reels</span>
                  {lastUpdated && (
                    <>
                      <Dot />
                      <span className="text-neutral-500">Updated {formatDate(lastUpdated)}</span>
                    </>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-sm text-neutral-500">No channels yet.</p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {channels.length > 0 ? (
              <>
                <RefreshButton channels={handles} />
                <SettingsLink />
              </>
            ) : (
              <Link
                href="/settings"
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
              >
                Add a channel
              </Link>
            )}
          </div>
        </div>
      </header>

      {channels.length === 0 ? (
        <EmptyState />
      ) : (
        <CatalogGrid reels={reels} channels={channels} initialView={settings.view} />
      )}
    </>
  );
}

function Dot() {
  return (
    <span className="text-neutral-600" aria-hidden>
      ·
    </span>
  );
}

// Quiet, always-present entry to channel management (add/remove) — the rare setup
// action lives at the edge as an icon button (DESIGN.md §3, §10), not a loud CTA.
function SettingsLink() {
  return (
    <Link
      href="/settings"
      aria-label="Manage channels"
      title="Manage channels"
      className="grid h-9 w-9 place-items-center rounded-full text-white/90 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
      </svg>
    </Link>
  );
}

// The eye/"watcher" mark, inline so it inherits ink color (DESIGN.md §8).
function Logo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 64 64"
      fill="none"
      className="shrink-0 text-neutral-100"
      aria-hidden
    >
      <g
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 32C16 20 48 20 58 32C48 44 16 44 6 32Z" />
        <circle cx="32" cy="32" r="9" />
        <path d="M32 16V8M18 19L13 11M46 19L51 11M32 48V56M18 45L13 53M46 45L51 53" />
      </g>
      <circle cx="32" cy="32" r="3.5" fill="currentColor" />
    </svg>
  );
}

function EmptyState() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 text-center">
      <p className="text-sm text-neutral-400">
        Add an Instagram channel to start building your library.
      </p>
      <Link
        href="/settings"
        className="mt-5 inline-block rounded-full bg-white px-5 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
      >
        Add a channel
      </Link>
    </section>
  );
}

function GridSkeleton() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[9/16] w-full animate-pulse rounded-xl bg-neutral-900"
          />
        ))}
      </div>
    </section>
  );
}
