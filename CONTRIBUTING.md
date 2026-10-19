# Contributing to Reel Watcher

Thanks for taking a look. This is a small, deliberately-focused project — a calm,
self-hosted way to watch one Instagram channel's reels. Contributions that keep it
calm, local, and simple are very welcome.

## Getting set up

1. **Install** — `npm install`
2. **Start a signed-in debug browser** — launch any Chromium-based browser with
   remote debugging and a dedicated profile, and log in to instagram.com once. See
   the [README](./README.md#setup) for the exact command.
3. **Copy the env template** — `cp .env.example .env.local` (only needed if your
   browser listens somewhere other than `127.0.0.1:9222`).
4. **Run** — `npm run dev`, then open http://localhost:3000

The app keeps **no database**: your catalog is a plain JSON file under `data/`
(`reels.json`), and watch history lives in the browser's `localStorage`. Nothing
leaves your machine.

## Before you open a PR

Please make sure both of these pass:

```bash
npm run lint          # eslint
npx tsc --noEmit      # typecheck
```

## House rules

A few conventions this codebase holds itself to — PRs are reviewed against them:

- **Design is a system, not a vibe.** [DESIGN.md](./DESIGN.md) is the single source
  of truth for how everything looks and feels (dark-only, content-loud/chrome-quiet,
  two accent colors, a fixed spacing scale). Read it before any UI change. If you
  need to break a rule, change the rule in DESIGN.md and bring the app in line — no
  silent one-offs.
- **No half-features.** A change is either implemented completely or it doesn't
  exist. No dead code, no stubs, no buttons wired to nothing, no "coming soon"
  comments. If a symbol has no caller, delete it; if it should have one, wire it.
- **Keep the platform behind the port.** Anything that talks to Instagram goes
  through the `ReelResolver` interface in `lib/contracts.ts` (implemented by the CDP
  resolver in `lib/resolvers/cdp.ts`). The rest of the app depends only on plain
  data shapes — keep it that way.
- **Stay local and private.** No telemetry, no analytics, no external services, no
  copied credentials. The app automates *your own* signed-in browser and nothing
  else.
- **Respect the data store.** Writes to files under `data/` go through the atomic
  helper (`lib/atomic.ts`) and, for the library, the serialization lock
  (`withLibraryLock` in `lib/catalog.ts`). Don't write those files directly.

## Scope

This is a personal tool for watching reels you already have access to (see the
[Legal](./README.md#legal) note). Please keep contributions in that spirit — bug
fixes, UX polish, reliability, and accessibility are all great. Features that turn
it into a scraper-at-scale, a multi-account service, or anything that bypasses
access controls are out of scope.

## Reporting bugs & ideas

Open an issue. For bugs, include your OS, browser, Node version, and what you
expected vs. what happened. For features, a short "what problem does this solve"
goes a long way.
