"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { exportWatchHistory, importWatchHistory } from "@/lib/progress";

// Backup: one-click export of everything that's yours and hard to recreate —
// the library (channels + reels) and settings from the server, plus watch history
// from this browser's localStorage — into a single JSON file, and a guarded import
// that restores it. The resolved-video cache is intentionally left out (those
// signed URLs expire within hours and are re-minted on play). The server half
// lives in lib/backup.ts + /api/backup; this component owns the download, the file
// read, and carrying watch history across. See DESIGN.md §3 — this is maintenance,
// so it sits quiet at the bottom of Settings.

const APP_MARKER = "reel-watcher";

interface Bundle {
  app: string;
  version: number;
  exportedAt: string;
  library: { channels?: unknown[]; reels?: unknown[] };
  settings?: unknown;
  watchHistory?: unknown;
}

/** A parsed, not-yet-applied import, held while the user confirms the overwrite. */
interface Pending {
  fileName: string;
  bundle: Bundle;
  summary: string;
}

export default function BackupControls() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  function say(message: string, isError = false) {
    setNote(message);
    setError(isError);
  }

  async function exportBackup() {
    if (busy) return;
    setBusy(true);
    say("Preparing…");
    try {
      const res = await fetch("/api/backup");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't read your data.");

      const bundle: Bundle = {
        app: APP_MARKER,
        version: data.version,
        exportedAt: new Date().toISOString(),
        library: data.library,
        settings: data.settings,
        watchHistory: exportWatchHistory(),
      };

      const blob = new Blob([JSON.stringify(bundle, null, 2) + "\n"], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reel-watcher-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const reels = Array.isArray(data.library?.reels) ? data.library.reels.length : 0;
      say(`Exported ${reels} reels.`);
    } catch (err) {
      say(err instanceof Error ? err.message : "Export failed.", true);
    } finally {
      setBusy(false);
    }
  }

  // Step 1 of import: read + validate the file, then stage it for confirmation.
  async function pickFile(file: File) {
    say("Reading…");
    try {
      const bundle = JSON.parse(await file.text()) as Bundle;
      const channels = bundle?.library?.channels;
      const reels = bundle?.library?.reels;
      if (bundle?.app !== APP_MARKER || !Array.isArray(channels) || !Array.isArray(reels)) {
        throw new Error("That doesn't look like a Reel Watcher backup.");
      }
      setPending({
        fileName: file.name,
        bundle,
        summary: `${channels.length} channel${channels.length === 1 ? "" : "s"} · ${reels.length} reels`,
      });
      setNote(null);
      setError(false);
    } catch (err) {
      setPending(null);
      say(
        err instanceof SyntaxError
          ? "That file isn't valid JSON."
          : err instanceof Error
            ? err.message
            : "Couldn't read that file.",
        true
      );
    }
  }

  // Step 2 of import: apply the staged bundle. Replaces library + settings on the
  // server and watch history in this browser, then refreshes the page.
  async function applyImport() {
    if (!pending || busy) return;
    setBusy(true);
    say("Restoring…");
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          library: pending.bundle.library,
          settings: pending.bundle.settings,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Import failed.");

      // Watch history lives only in this browser, so restore it client-side.
      if (pending.bundle.watchHistory !== undefined) {
        importWatchHistory(pending.bundle.watchHistory);
      }

      setPending(null);
      say(`Restored ${data.channels} channel${data.channels === 1 ? "" : "s"} · ${data.reels} reels.`);
      startTransition(() => router.refresh());
    } catch (err) {
      say(err instanceof Error ? err.message : "Import failed.", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 border-t border-white/10 pt-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Backup
      </h2>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-picking the same file
          if (file) pickFile(file);
        }}
      />

      {pending ? (
        <div className="rounded-xl bg-neutral-900/50 p-4 ring-1 ring-white/10">
          <p className="text-sm text-neutral-200">
            Restore from <span className="text-neutral-100">{pending.fileName}</span>?
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {pending.summary}. This replaces your current library, settings, and
            watch history — it can’t be undone.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={applyImport}
              disabled={busy}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-50"
            >
              {busy ? "Restoring…" : "Replace everything"}
            </button>
            <button
              onClick={() => setPending(null)}
              disabled={busy}
              className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-neutral-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportBackup}
            disabled={busy}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-50"
          >
            Export backup
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-50"
          >
            Import backup…
          </button>
        </div>
      )}

      {note && (
        <p className={`mt-2 text-xs ${error ? "text-accent" : "text-neutral-400"}`}>{note}</p>
      )}
      <p className="mt-2 text-xs text-neutral-500">
        Export saves your channels, reels, settings, and watch history to one JSON
        file. The expiring video cache isn’t included — it’s rebuilt on play.
      </p>
    </section>
  );
}
