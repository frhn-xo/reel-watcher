"use client";

import { useEffect, useState } from "react";

// Connection preflight (DESIGN.md §1.4 "honest state"). The single biggest setup
// snag is the debug browser: wrong flags, wrong profile, or just not logged in.
// Today you only find out by adding a channel and getting a cryptic error — so we
// check /api/health up front and say plainly what's wrong and how to fix it.
//
// On-system color: this app reserves red for playback and emerald for "seen"
// (DESIGN.md §4), so a status light can't use either. We signal with NEUTRALS +
// the contrast/weight levers instead — an all-good state stays calm and quiet; a
// problem state gets brighter ink, heavier weight, and remediation steps.

interface Health {
  reachable: boolean; // the CDP debug port answered
  loggedIn: boolean; // an instagram.com session cookie is present
  endpoint: string; // where we looked, e.g. "127.0.0.1:9222"
  error?: string;
}

type State =
  | { status: "checking" }
  | { status: "failed" } // the health request itself didn't complete
  | { status: "ok"; health: Health };

// Pure fetch — no React state — so both the mount effect and the button can map
// its result into setState inside their own callback (which the hooks lint allows,
// unlike calling a setState-ing function from an effect body).
async function fetchHealth(): Promise<State> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    const health = (await res.json()) as Health;
    return { status: "ok", health };
  } catch {
    return { status: "failed" };
  }
}

export default function ConnectionStatus() {
  const [state, setState] = useState<State>({ status: "checking" });

  useEffect(() => {
    let alive = true;
    fetchHealth().then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  function check() {
    setState({ status: "checking" });
    fetchHealth().then(setState);
  }

  const checking = state.status === "checking";
  const healthy =
    state.status === "ok" && state.health.reachable && state.health.loggedIn;

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Connection
      </h2>
      <div className="rounded-xl bg-neutral-900/50 p-4 ring-1 ring-white/10">
        <div className="flex items-start gap-3">
          <Indicator calm={healthy} dim={checking} />
          <div className="min-w-0 flex-1">
            <Body state={state} />
          </div>
          <button
            onClick={check}
            disabled={checking}
            className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
      </div>
    </section>
  );
}

// A calm, filled dot when all is well; a brighter hollow ring when something
// needs attention; a faint dot while the check is in flight. No chromatic color.
function Indicator({ calm, dim }: { calm: boolean; dim: boolean }) {
  const cls = dim
    ? "bg-neutral-700"
    : calm
      ? "bg-neutral-400"
      : "bg-transparent ring-2 ring-white/70";
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} aria-hidden />;
}

function Body({ state }: { state: State }) {
  if (state.status === "checking") {
    return <Line head="Checking the browser connection…" tone="muted" />;
  }
  if (state.status === "failed") {
    return (
      <Line
        head="Couldn't run the connection check"
        detail="The app couldn't complete the check. Make sure the dev server is still running, then try again."
      />
    );
  }

  const { reachable, loggedIn, endpoint, error } = state.health;

  if (reachable && loggedIn) {
    return (
      <Line
        head="Connected"
        detail={`Signed in to Instagram · browser at ${endpoint}.`}
        tone="muted"
      />
    );
  }

  if (reachable && !loggedIn) {
    return (
      <Line
        head="Not signed in to Instagram"
        detail={`The browser at ${endpoint} is reachable but has no Instagram session.`}
        steps={[
          "Open instagram.com in that browser and log in once (it persists in the profile).",
          "Then press Check again.",
        ]}
      />
    );
  }

  return (
    <Line
      head="Browser not reachable"
      detail={`Couldn't reach a debug browser at ${endpoint}.${error ? ` (${error})` : ""}`}
      steps={[
        "Launch a Chromium browser with --remote-debugging-port and a dedicated --user-data-dir, and keep it open.",
        "Confirm the port matches CDP_ENDPOINT (see the README for the exact command).",
      ]}
    />
  );
}

function Line({
  head,
  detail,
  steps,
  tone = "loud",
}: {
  head: string;
  detail?: string;
  steps?: string[];
  tone?: "loud" | "muted";
}) {
  return (
    <>
      <p
        className={`text-sm ${
          tone === "muted" ? "text-neutral-300" : "font-medium text-neutral-50"
        }`}
      >
        {head}
      </p>
      {detail && <p className="mt-1 text-xs text-neutral-400">{detail}</p>}
      {steps && (
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-neutral-400 marker:text-neutral-600">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </>
  );
}
