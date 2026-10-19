// ─────────────────────────────────────────────────────────────────────────────
// STARTUP SECURITY GUARD (Node-only)
//
// Warns once at boot if the server is bound to a non-loopback host. Lives in its
// own module — not inline in instrumentation.ts — so the `process.argv` read never
// lands in the Edge bundle; instrumentation.ts imports it dynamically only under
// the Node runtime. See the Security section of README.md for the why.
// ─────────────────────────────────────────────────────────────────────────────

/** The host passed via `-H`/`--hostname` on the command line, or null if none. */
function configuredHost(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-H" || a === "--hostname") return argv[i + 1] ?? null;
    if (a.startsWith("--hostname=")) return a.slice("--hostname=".length);
  }
  return null;
}

/** True for loopback hosts (reachable only from this machine). 0.0.0.0 / a LAN IP
 *  are NOT loopback — those expose the app to other machines. */
function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  return h === "localhost" || h === "::1" || /^127\./.test(h);
}

/**
 * This app drives your signed-in Instagram browser: anything that can reach its
 * port can harvest any profile and stream media AS YOU, with no login of its own
 * and no auth in front. So where it listens is a security decision.
 *
 * The real mitigation is the loopback default baked into the npm scripts
 * (`next dev -H 127.0.0.1`). This is the backstop: if someone overrides the host
 * to a non-loopback address (e.g. `-H 0.0.0.0` to expose it on the LAN), we shout
 * once at startup. We only warn on a host we can POSITIVELY see on the command
 * line — absence of `-H` is left to the safe default + the README, so a normal
 * `npm run dev` never cries wolf.
 */
export function warnIfNonLoopbackBind(): void {
  const host = configuredHost(process.argv);
  if (!host || isLoopback(host)) return;

  console.warn(
    [
      "",
      "  ┌───────────────────────────────────────────────────────────────────────┐",
      "  │  ⚠  Reel Watcher is bound to a non-loopback host:                       │",
      `  │       ${host.padEnd(66)}│`,
      "  │                                                                         │",
      "  │  This app drives your signed-in Instagram browser and has NO auth.      │",
      "  │  Anyone who can reach this port can harvest profiles and stream media   │",
      "  │  as you. Bind to 127.0.0.1 unless you fully trust every host on this    │",
      "  │  network. See the Security section of README.md.                        │",
      "  └───────────────────────────────────────────────────────────────────────┘",
      "",
    ].join("\n")
  );
}
