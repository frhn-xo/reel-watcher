// Next calls register() once per server boot. We use it only to run the startup
// security guard (warn on a non-loopback bind). The guard reads process.argv, a
// Node API, so it lives in a separate module imported dynamically ONLY under the
// Node runtime — keeping instrumentation.ts clean of Node APIs in the Edge bundle.
// See lib/startup-guard.ts and the Security section of README.md.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warnIfNonLoopbackBind } = await import("./lib/startup-guard");
  warnIfNonLoopbackBind();
}
