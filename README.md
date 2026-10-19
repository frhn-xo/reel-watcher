<div align="center">

<img src="assets/logo.svg" width="92" height="92" alt="Reel Watcher logo" />

# Reel Watcher

**A calm, self-hosted way to watch any Instagram channel's reels — the videos, without the feed.**

Point it at a channel. It pulls that channel's reels into a quiet tile grid and plays
them back in a real video player with proper scrubbing. No infinite scroll, no
suggestions, no algorithm — just the reels you asked for.

![License](https://img.shields.io/badge/license-MIT-dc2626?style=flat-square)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-20232a?style=flat-square&logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)

</div>

---

## Features

- **Any channel, your own library.** Add one or more Instagram handles and each becomes a browsable collection of its reels.
- **A clean tile grid.** Every reel is a tile with its thumbnail and caption-as-title, so you can see the whole catalog at a glance and pick what to watch.
- **A real video player.** Reels play as proper MP4 with full scrubbing, arrow-key seeking, and adjustable playback speed.
- **Resume where you left off.** Playback position is remembered per reel, so you can stop any time and pick up exactly where you stopped — from any screen.
- **Continue watching.** A dedicated row brings you straight back to whatever you haven't finished.
- **Seen and fresh at a glance.** Watched reels are marked and filterable, so you always know what's new and what you've already seen.
- **One-tap refresh.** Pull a channel's newest reels on demand — fetched incrementally, so only new reels are added, not the whole back-catalog.
- **Fully local and private.** Your catalog is a JSON file on your own disk. No account to create, no server to run, no telemetry.

## How it's built

A single [Next.js 16](https://nextjs.org) app — React 19, TypeScript, Tailwind. There is
no database and no external service: the catalog is a local JSON file the app reads and writes.

The one thing it needs is a way to reach Instagram as a logged-in user. It does that by
driving **a Chromium browser you're already signed into**, over the [Chrome DevTools
Protocol (CDP)](https://chromedevtools.github.io/devtools-protocol/). The app connects to
the browser's debug port, opens a throwaway tab on instagram.com, and reads the reels the
same way you would — so there are no copied cookies, tokens, or credentials anywhere in the
project.

Everything that talks to Instagram sits behind one small interface (`ReelResolver` in
`lib/contracts.ts`); the CDP implementation lives in `lib/resolvers/cdp.ts`. The rest of the
app only knows about plain data shapes.

Signed media URLs from Instagram are short-lived, so the app never trusts a stored URL: it
mints a fresh one on demand the moment you press play, which is why playback keeps working
without any manual step.

The look and feel is documented in [DESIGN.md](./DESIGN.md).

## Requirements

| What | Why |
|---|---|
| **Node.js 20+** and npm | to run the app |
| **A Chromium-based browser** (Chrome, Brave, Edge, Chromium, …) signed in to Instagram | this is how the app reaches Instagram |
| The browser launched with **remote debugging** enabled | so the app can connect to it over CDP |
| **Internet access** | to reach instagram.com and its CDN |

No database, no API keys, no ffmpeg or other binaries, no cloud account — only your own
Instagram login, which stays inside your browser.

## Setup

**1. Install**

```bash
npm install
```

**2. Start a browser with remote debugging, signed into Instagram**

Launch any Chromium-based browser (Chrome, Brave, Edge, Chromium) with two flags: a debug
port and a dedicated profile directory (Chrome 136+ requires a *separate* profile for remote
debugging). For example, Chrome on macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.reel-watcher-browser"
```

On a different OS or browser, run the equivalent: keep the two flags exactly the same and
point to your own browser's executable instead (for example `google-chrome`,
`brave-browser`, or `chromium` on Linux; `chrome.exe` on Windows).

In the window that opens, **log in to instagram.com once** — the login persists in that
profile, so you only do this the first time.

**3. Run the app**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), go to **Settings**, add a channel by
its handle or URL, and press **Refresh**. Keep the debug browser open while refreshing or
watching — that's how the app reaches Instagram.

## Configuration

The only setting is where your debug browser is listening. It defaults to
`127.0.0.1:9222`, so if you used the command above you need no configuration at all. To
point at a different host or port, create a `.env.local` file:

```bash
CDP_ENDPOINT=127.0.0.1:9222
```

## Security

Reel Watcher drives your **signed-in** Instagram browser. Anything that can reach
the app's port can use that session — harvest any profile and stream media **as
you** — with no login of its own. Treat the running app as if it were your
Instagram account.

- **Keep it on localhost.** `npm run dev` and `npm run start` bind to `127.0.0.1`
  only, so the app is reachable from your own machine and nothing else. That's the
  default; keep it.
- **Don't expose it.** There is no authentication. Do not bind it to `0.0.0.0`,
  put it behind a public reverse proxy, or forward its port — doing so hands your
  Instagram session to anyone who can reach it. If you override the host to a
  non-loopback address, the app prints a warning on startup.
- **The debug browser is a control channel too.** Chromium's
  `--remote-debugging-port` is itself unauthenticated — anything that reaches it
  can drive the browser. Keep that port on localhost as well.

## Legal

This is a personal tool for watching reels you already have access to. It automates your own
signed-in browser; it does not bypass authentication or access anything you couldn't see
yourself. Use it for personal, educational purposes and in line with
[Instagram's Terms of Use](https://help.instagram.com/581066165581870). It is not affiliated
with, endorsed by, or connected to Instagram or Meta.

## License

[MIT](./LICENSE) © frhn-xo
