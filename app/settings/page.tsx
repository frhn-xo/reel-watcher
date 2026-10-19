import { Suspense } from "react";
import { getLibrary } from "@/lib/catalog";
import { getSettings, MIN_REFRESH_LIMIT, MAX_REFRESH_LIMIT } from "@/lib/settings";
import SettingsPanel, { type ChannelRow } from "./SettingsPanel";
import BackToGrid from "./BackToGrid";

// App settings live here, off the main screen: configuration and channel
// management are rare setup, so they're tucked away rather than cluttering the
// grid (DESIGN.md §3 — amplify the frequent, quiet the rare).

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <BackToGrid className="grid h-9 w-9 place-items-center rounded-full text-neutral-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          <h1 className="text-xl font-semibold tracking-tight text-neutral-50">
            Settings
          </h1>
        </div>
      </header>

      <Suspense
        fallback={<div className="mx-auto max-w-3xl px-6 py-8 text-sm text-neutral-500">Loading…</div>}
      >
        <SettingsLoader />
      </Suspense>
    </main>
  );
}

async function SettingsLoader() {
  const [library, settings] = await Promise.all([getLibrary(), getSettings()]);
  const counts = new Map<string, number>();
  for (const r of library.reels) counts.set(r.channel, (counts.get(r.channel) ?? 0) + 1);
  const rows: ChannelRow[] = library.channels.map((c) => ({
    handle: c.handle,
    displayName: c.displayName,
    harvestedAt: c.harvestedAt,
    count: counts.get(c.handle) ?? 0,
  }));
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <SettingsPanel
        channels={rows}
        refreshLimit={settings.refreshLimit}
        minLimit={MIN_REFRESH_LIMIT}
        maxLimit={MAX_REFRESH_LIMIT}
      />
    </div>
  );
}
