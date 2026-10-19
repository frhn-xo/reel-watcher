"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseHandle } from "@/lib/handle";

export interface ChannelRow {
  handle: string;
  displayName: string;
  harvestedAt: string;
  count: number;
}

export default function SettingsPanel({
  channels,
  refreshLimit,
  minLimit,
  maxLimit,
}: {
  channels: ChannelRow[];
  refreshLimit: number;
  minLimit: number;
  maxLimit: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addNote, setAddNote] = useState<string | null>(null);
  const [addError, setAddError] = useState(false);

  // Optional per-add fetch count: how many reels THIS new channel pulls on its
  // first harvest. Blank = use the configured refresh limit. Independent of the
  // Refresh button, which always uses the saved limit.
  const [addLimit, setAddLimit] = useState("");
  const addLimitNum = Number(addLimit);
  const addLimitValid =
    addLimit === "" ||
    (Number.isInteger(addLimitNum) &&
      addLimitNum >= minLimit &&
      addLimitNum <= maxLimit);

  // Refresh limit — how many reels a single harvest (refresh or add) pulls at most.
  const [limit, setLimit] = useState(String(refreshLimit));
  const [savingLimit, setSavingLimit] = useState(false);
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const [limitError, setLimitError] = useState(false);

  const limitNum = Number(limit);
  const limitValid =
    Number.isInteger(limitNum) && limitNum >= minLimit && limitNum <= maxLimit;
  const limitDirty = limitValid && limitNum !== refreshLimit;

  async function saveLimit() {
    if (!limitDirty || savingLimit) return;
    setSavingLimit(true);
    setLimitNote(null);
    setLimitError(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshLimit: limitNum }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setLimit(String(data.settings.refreshLimit));
        setLimitNote("Saved.");
        startTransition(() => router.refresh());
      } else {
        setLimitError(true);
        setLimitNote("Couldn't save the limit.");
      }
    } catch {
      setLimitError(true);
      setLimitNote("Couldn't save the limit.");
    } finally {
      setSavingLimit(false);
    }
  }

  // Two-step remove (no modal): the row reveals Confirm/Cancel inline.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const parsed = parseHandle(input);

  async function add() {
    if (!parsed || !addLimitValid || adding) return;
    setAdding(true);
    setAddNote(null);
    setAddError(false);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input,
          ...(addLimit === "" ? {} : { limit: addLimitNum }),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAddError(true);
        setAddNote(data.error ?? "Couldn't add that channel.");
        return;
      }
      setAddNote(`Added @${data.channel} · ${data.added} reels`);
      setInput("");
      setAddLimit("");
      startTransition(() => router.refresh());
    } catch (err) {
      setAddError(true);
      setAddNote(err instanceof Error ? err.message : "Couldn't add that channel.");
    } finally {
      setAdding(false);
    }
  }

  async function remove(handle: string) {
    setRemoving(handle);
    try {
      const res = await fetch("/api/channels", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        startTransition(() => router.refresh());
      }
    } catch {
      /* leave the row; the next refresh reflects reality */
    } finally {
      setRemoving(null);
      setConfirming(null);
    }
  }

  return (
    <div>
      {/* Refresh limit */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Refresh limit
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={minLimit}
            max={maxLimit}
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
              setLimitNote(null);
              setLimitError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && saveLimit()}
            className="w-28 rounded-full border border-white/15 bg-neutral-900 px-4 py-2 text-sm tabular-nums text-neutral-100 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
          />
          <button
            onClick={saveLimit}
            disabled={!limitDirty || savingLimit}
            className="shrink-0 rounded-full bg-white px-5 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingLimit ? "Saving…" : "Save"}
          </button>
          {limitNote && (
            <span className={`text-xs ${limitError ? "text-accent" : "text-neutral-400"}`}>
              {limitNote}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          How many reels each refresh or new channel pulls at most, newest first —
          so a first harvest never scrolls a whole back-catalog. {minLimit}–{maxLimit}.
        </p>
      </section>

      {/* Add a channel */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Add a channel
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="handle or profile URL"
            spellCheck={false}
            autoCapitalize="none"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
          />
          <input
            type="number"
            inputMode="numeric"
            min={minLimit}
            max={maxLimit}
            value={addLimit}
            onChange={(e) => setAddLimit(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={String(refreshLimit)}
            aria-label="Reels to fetch on this first harvest"
            title={`How many reels to fetch now — leave blank for the default (${refreshLimit}). ${minLimit}–${maxLimit}.`}
            className={`w-24 shrink-0 rounded-full border bg-neutral-900 px-4 py-2 text-sm tabular-nums text-neutral-100 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 ${addLimitValid ? "border-white/15" : "border-accent"}`}
          />
          <button
            onClick={add}
            disabled={!parsed || !addLimitValid || adding}
            className="shrink-0 rounded-full bg-white px-5 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          The number is how many reels to fetch on this first harvest, newest
          first — leave it blank to use the refresh limit ({refreshLimit}).{" "}
          {minLimit}–{maxLimit}.
        </p>
        {addNote && (
          <p className={`mt-2 text-xs ${addError ? "text-accent" : "text-neutral-400"}`}>
            {addNote}
          </p>
        )}
        {adding && (
          <p className="mt-2 text-xs text-neutral-500">
            Harvesting reels from the signed-in browser — this can take a moment.
          </p>
        )}
      </section>

      {/* Existing channels */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Your channels
        </h2>
        {channels.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            No channels yet. Add one above.
          </p>
        ) : (
          <ul className="divide-y divide-white/10 overflow-hidden rounded-xl ring-1 ring-white/10">
            {channels.map((c) => (
              <li
                key={c.handle}
                className="flex items-center gap-3 bg-neutral-900/50 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-100">{c.displayName}</p>
                  <p className="truncate text-xs text-neutral-500">
                    @{c.handle} · <span className="tabular-nums">{c.count}</span> reels
                  </p>
                </div>

                {confirming === c.handle ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden text-xs text-neutral-400 sm:inline">
                      Remove @{c.handle} and its {c.count} reels?
                    </span>
                    <button
                      onClick={() => remove(c.handle)}
                      disabled={removing === c.handle}
                      className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-50"
                    >
                      {removing === c.handle ? "Removing…" : "Remove"}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirming(c.handle)}
                    className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
