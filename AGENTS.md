<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Rule: no declared-but-unimplemented code — implement it or delete it

**Every feature is a transaction: it's either implemented completely or it does not
exist. There is no in-between.** Declaring a thing and leaving it unbuilt is a bug —
it's confusing, it rots, and it lies about what the system does.

Concretely, in any change you make here:

- **Interfaces / types / ports** — if you declare one, something must implement it
  *and* something must consume it. An interface with no concrete implementation, or
  a concrete implementation nothing calls, is dead. Wire it through or remove it.
  (A `ReelResolver` must have a real resolver — e.g. `browserOSResolver` — and the
  app must actually call it.)
- **Functions / classes / exports** — no stubs, no `throw new Error("not
  implemented")`, no exported symbol with zero call sites. If it's not used, delete
  it. If it should be used, use it.
- **UI** — no button, link, or control that does nothing (or only `TODO`s). A
  control that isn't wired to real behavior gets removed, not shipped greyed-out.
- **Comments / docs** — don't describe behavior that doesn't exist yet ("in a later
  step…", "the future X will…"). Either build it now or don't mention it. Comments
  must match the code as it actually is.

Before finishing: no orphan declarations, no half-features, no "coming soon".
Prefer deleting over leaving a placeholder.

<!-- frhn-vibe-playbook:start — managed by the frhn-vibe-playbook skill. Do not hand-edit; the sync overwrites everything between these markers. -->
## How I vibe-code (frhn-vibe-playbook)

1. **All-or-nothing / transactional.** Implement a change completely or not at all — never leave a half-built, in-between state. If it can't be finished properly now, stop and say so instead of committing a partial version.
2. **Refactor over building on hacks.** When new work would lean on an earlier shortcut that no longer fits, refactor that foundation clean first — don't stack on it. Be honest when earlier code (even mine from this same session) is the hack. Keep refactors scoped to what the new work actually touches.
3. **Features are interventions, not islands.** Before calling a feature done, run a second-order pass — Collision: what existing thing shares this trigger/name/surface? Unintended activation: what inputs other than the intended one can fire it (modifiers, bubbling, autofire)? Breakage: what existing behavior does it shadow or pre-empt? Inverse: when should it NOT happen, and did I encode that? Then verify the negative space — exercise adjacent actions (refresh, back, resize, held modifiers), not just the happy path. After "does it work?" always ask "what else did it touch?"
4. **Build the real home, move the furniture in.** When a new feature becomes the proper home for a domain (settings, state, config, caching, …), don't wire it for the immediate need alone — find the earlier scrappy versions of that same concern (a localStorage hack, an inline constant, a one-off file) and migrate them into the new home as part of the work, so one domain lives in one place with one clean responsibility. Scope the migration to the concern you're building; don't let it sprawl into unrelated code.
5. **Generalize to the right altitude — loosen a notch, with taste.** When I name a token, rule, or convention for one spot ("use green here"), don't scope it so tightly it fits only that instance — loosen it to the coherent category so sibling elements that mean the same thing reuse it, not to a catch-all that means nothing. Name the category, not the instance and not the universe; how far to loosen is taste, not formula.
<!-- frhn-vibe-playbook:end -->
