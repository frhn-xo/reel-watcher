import {
  ReelUnavailableError,
  type Catalog,
  type Reel,
  type ReelRef,
  type ReelResolver,
  type ResolvedVideo,
} from "../contracts";

// Resolve reels by driving a signed-in Chromium browser over the Chrome DevTools
// Protocol. The browser is already logged in to Instagram and exposes a CDP debug
// port on localhost; we connect to that port, open a tab on the channel profile,
// scroll until every reel has lazy-loaded, and scrape the rendered grid. The
// scrape runs *inside* the instagram.com page, so it sees exactly what the
// logged-in user sees. We scrape the DOM rather than Instagram's JSON API — the
// API is aggressively rate-limited (429s), while the rendered page is not.

const CDP_HOST = process.env.CDP_ENDPOINT ?? "127.0.0.1:9222";

interface ScrapedReel {
  shortcode: string;
  url: string;
  thumbnail: string | null;
  caption: string | null;
}

/** Minimal CDP client over a single browser-level websocket, with session routing. */
class CDPSession {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private sessionId?: string;

  static async connect(): Promise<CDPSession> {
    const version = await fetch(`http://${CDP_HOST}/json/version`, {
      // never cache — we want the live debugger url
      cache: "no-store",
    }).then((r) => {
      if (!r.ok) throw new Error(`CDP /json/version ${r.status}`);
      return r.json() as Promise<{ webSocketDebuggerUrl: string }>;
    });

    const s = new CDPSession();
    s.ws = new WebSocket(version.webSocketDebuggerUrl);
    s.ws.onmessage = (e: MessageEvent) => s.onMessage(String(e.data));
    await new Promise<void>((resolve, reject) => {
      s.ws.onopen = () => resolve();
      s.ws.onerror = () => reject(new Error("CDP websocket failed to open"));
    });
    return s;
  }

  private onMessage(data: string) {
    const msg = JSON.parse(data);
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message ?? "CDP error"));
      else resolve(msg.result);
    }
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (this.sessionId) payload.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  /** Open a fresh tab on `url` and attach to it; subsequent calls target that tab. */
  async openTab(url: string): Promise<string> {
    // `background: true` keeps the harvest invisible: the tab loads, scrolls, and
    // scrapes without the browser stealing OS focus (no tab switch, no window raise),
    // so the user stays in whatever app they were in. Chromium-only CDP flag.
    const { targetId } = await this.call("Target.createTarget", {
      url,
      background: true,
    });
    const { sessionId } = await this.call("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    this.sessionId = sessionId;
    await this.call("Page.enable");
    await this.call("Runtime.enable");
    return targetId;
  }

  async closeTab(targetId: string): Promise<void> {
    this.sessionId = undefined;
    await this.call("Target.closeTarget", { targetId });
  }

  close(): void {
    this.ws.close();
  }

  /** Evaluate an expression in the attached tab and return its value. */
  async evaluate<T>(expression: string, awaitPromise = false): Promise<T> {
    const res = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          "evaluate threw"
      );
    }
    return res.result.value as T;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Expression evaluated inside the instagram.com page to read the rendered grid.
const SCRAPE_EXPR = `(() => {
  const out = {};
  for (const a of document.querySelectorAll('a[href*="/reel/"]')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\\/reel\\/([^/?]+)/);
    if (!m) continue;
    const shortcode = m[1];
    if (out[shortcode]) continue;
    const img = a.querySelector('img');
    out[shortcode] = {
      shortcode,
      url: 'https://www.instagram.com' + (href.startsWith('/') ? href : '/' + href),
      thumbnail: img ? (img.getAttribute('src') || null) : null,
      caption: img ? (img.getAttribute('alt') || null) : null,
    };
  }
  return Object.values(out);
})()`;

// Expression evaluated on the /<channel>/reels/ route to read view counts.
// Unlike the main profile grid (which only labels each tile "Clip"), the reels
// tab renders a persistent view badge inside each tile — the number immediately
// following the "View Count Icon" accessibility label (last occurrence, since
// pinned reels also list likes/comments before it). No thumbnails live here,
// though, so this pass contributes views only; the grid pass owns the images.
const VIEWS_SCRAPE_EXPR = `(() => {
  const out = {};
  for (const a of document.querySelectorAll('a[href*="/reel/"]')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\\/reel\\/([^/?]+)/);
    if (!m) continue;
    const shortcode = m[1];
    if (out[shortcode]) continue;
    const txt = a.textContent || '';
    const idx = txt.lastIndexOf('View Count Icon');
    let views = null;
    if (idx >= 0) {
      const vm = txt.slice(idx + 'View Count Icon'.length).match(/^\\s*([\\d.,]+\\s*[KMB]?)/i);
      if (vm) views = vm[1].replace(/\\s+/g, '');
    }
    out[shortcode] = { shortcode, views };
  }
  return Object.values(out);
})()`;

const DISPLAY_NAME_EXPR = `(() => {
  const og = document.querySelector('meta[property="og:title"]');
  const t = og && og.getAttribute('content');
  if (t) return t.split('(@')[0].trim() || null;
  return null;
})()`;

// Instagram's public web client id. The media-info endpoint requires it; it is a
// fixed, non-secret constant the web app ships to every browser.
const IG_WEB_APP_ID = "936619743392459";

/**
 * Expression evaluated INSIDE an instagram.com tab (so it carries the logged-in
 * cookies) to mint a fresh, playable video URL for one reel.
 *
 * Why this and not the DOM/network: the web player streams reels as DASH (a blob:
 * MediaSource fed by separate VP9-video + AAC-audio segment requests), so neither
 * `<video>.currentSrc`, an og:video meta, nor sniffing network requests yields a
 * single playable file. Instagram's media-info API, however, returns
 * `video_versions` — progressive, muxed H.264+AAC mp4s (the same shape the store
 * already held) that our stream proxy can serve directly with Range support.
 *
 * The media id is the shortcode base64-decoded (custom alphabet) to its pk — the
 * same transform lib/catalog.ts uses for sorting. We compute it inline so this
 * adapter stays self-contained. BigInt is native in the browser regardless of our
 * TS compile target, since this string runs in Chrome, not Node.
 */
function resolveExpr(shortcode: string): string {
  return `(async () => {
    const ALPH = ${JSON.stringify(IG_ALPHABET_FOR_PK)};
    let pk = BigInt(0);
    for (const c of ${JSON.stringify(shortcode)}) {
      const v = ALPH.indexOf(c);
      if (v < 0) return { error: 'bad shortcode character' };
      pk = pk * BigInt(64) + BigInt(v);
    }
    try {
      const r = await fetch('https://www.instagram.com/api/v1/media/' + pk.toString() + '/info/', {
        headers: { 'x-ig-app-id': '${IG_WEB_APP_ID}' },
        credentials: 'include',
      });
      if (!r.ok) {
        // A removed/taken-down/private reel answers 404, or 400 "Media not found
        // or unavailable". Flag those as GONE (permanent) so the caller can 410
        // rather than treat it as a transient error worth retrying.
        let gone = r.status === 404;
        try {
          const j = await r.json();
          if (r.status === 400 && /not found|unavailable/i.test((j && j.message) || '')) gone = true;
        } catch (_) {}
        return { error: 'media-info HTTP ' + r.status, gone };
      }
      const j = await r.json();
      const item = j.items && j.items[0];
      if (!item) return { error: 'no media item (private, removed, or not logged in?)' };
      const vv = (item.video_versions || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0));
      if (!vv.length) return { error: 'no video_versions (not a video post?)' };
      return {
        videoUrl: vv[0].url,
        caption: (item.caption && item.caption.text) || null,
        durationMs: Math.round((item.video_duration || 0) * 1000),
      };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  })()`;
}

// Same custom base64 alphabet lib/catalog.ts uses — duplicated here so the
// adapter needs no import from the app layer (ports/adapters stay decoupled).
const IG_ALPHABET_FOR_PK =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * ADAPTER: resolve one reel to a fresh, playable progressive mp4 URL by driving
 * the signed-in browser over CDP. Opens the reel in a throwaway tab
 * (guarantees the instagram.com origin + cookies, and that the reel exists), calls
 * the media-info API from inside that page, and returns the best progressive
 * version plus caption/duration. This is the ReelResolver.resolve() port.
 */
async function resolveViaCdp(shortcode: string): Promise<ResolvedVideo> {
  const cdp = await CDPSession.connect();
  let tab: string | undefined;
  try {
    tab = await cdp.openTab(`https://www.instagram.com/reel/${shortcode}/`);
    // Wait until the tab is actually ON instagram.com before our same-origin fetch.
    // A fresh CDP target starts at about:blank (which is already readyState
    // "complete"), so we must poll for the real origin to commit — otherwise the
    // in-page fetch runs from about:blank and is blocked cross-origin.
    const deadline = Date.now() + 15_000;
    for (;;) {
      const onIg = await cdp
        .evaluate<boolean>(
          `location.hostname.endsWith('instagram.com') && document.readyState !== 'loading'`
        )
        .catch(() => false);
      if (onIg) break;
      if (Date.now() > deadline) break;
      await sleep(300);
    }
    const result = await cdp.evaluate<{
      videoUrl?: string;
      caption?: string | null;
      durationMs?: number;
      error?: string;
      gone?: boolean;
    }>(resolveExpr(shortcode), /* awaitPromise */ true);
    if (!result || result.error || !result.videoUrl) {
      const message = `resolve ${shortcode}: ${result?.error ?? "no video url"}`;
      // A permanently-gone reel gets a typed error the stream route maps to 410.
      if (result?.gone) throw new ReelUnavailableError(shortcode, message);
      throw new Error(message);
    }
    return {
      videoUrl: result.videoUrl,
      caption: result.caption ?? null,
      durationMs: result.durationMs ?? 0,
    };
  } finally {
    if (tab) await cdp.closeTab(tab).catch(() => {});
    cdp.close();
  }
}

// Incremental harvest: once we've scrolled past the new reels into the already-
// known back-catalog, we want to stop rather than scroll the whole channel. We
// require this many CONSECUTIVE scroll steps that reveal new tiles but ZERO of
// them unknown before bailing. A streak (not a single step) guards against a
// brief window of only pinned/known tiles re-rendering mid-scroll, and against a
// stray older reel we'd previously missed sitting just past the overlap — the
// "fetches slightly more, but won't silently miss reels" trade-off.
const OVERLAP_STOP_STREAK = 2;

/**
 * Scroll the already-open tab to the bottom repeatedly, re-running `scrapeExpr`
 * on every step and accumulating by key. Instagram virtualizes its grids — tiles
 * scroll out of the DOM — so we must scrape each step and merge, never once at
 * the end. Returns the deduped accumulation. Assumes a tab is already attached.
 *
 * When `knownCodes` is non-empty the scan is INCREMENTAL: tiles render newest-
 * first, so we stop early after OVERLAP_STOP_STREAK consecutive steps whose new
 * tiles are all already-known — i.e. we've scrolled out of the fresh reels and
 * into the back-catalog. The returned window therefore holds the new reels plus
 * a small known overlap, not the whole channel. With an empty/omitted set this
 * degrades to a full harvest (the overlap condition can never fire).
 *
 * `limit` caps the result at the newest `limit` keys (tiles render newest-first,
 * and a Map preserves insertion order). It's the sole stop condition on a first
 * harvest (no known set → no overlap) and a backstop on a big incremental one.
 */
async function accumulate<T>(
  cdp: CDPSession,
  scrapeExpr: string,
  keyOf: (r: T) => string,
  knownCodes?: Set<string>,
  limit?: number
): Promise<T[]> {
  const incremental = !!knownCodes && knownCodes.size > 0;
  const capped = typeof limit === "number" && limit > 0;

  // Wait for the document and the first reel tiles to render.
  const deadline = Date.now() + 20_000;
  for (;;) {
    const ready = await cdp.evaluate<boolean>(
      `document.readyState === 'complete' && document.querySelectorAll('a[href*="/reel/"]').length > 0`
    );
    if (ready) break;
    if (Date.now() > deadline) break;
    await sleep(500);
  }

  const byKey = new Map<string, T>();
  let stable = 0;
  let overlap = 0;
  for (let i = 0; i < 60 && stable < 3 && overlap < OVERLAP_STOP_STREAK; i++) {
    const batch = await cdp.evaluate<T[]>(scrapeExpr);
    let appeared = 0; // keys new to our accumulation this step
    let fresh = 0; // ...of those, ones we didn't already have on file
    for (const r of batch) {
      const k = keyOf(r);
      if (!k || byKey.has(k)) continue;
      byKey.set(k, r);
      appeared++;
      if (!incremental || !knownCodes!.has(k)) fresh++;
    }
    // "Stable" = no NEW items this step, but only once we've found some. This
    // avoids bailing out during a slow first paint (0 items isn't "done").
    stable = byKey.size > 0 && appeared === 0 ? stable + 1 : 0;
    // Overlap streak: a step that surfaced new tiles, all of them already known,
    // means we've crossed into the back-catalog. Any fresh tile resets it.
    if (incremental && appeared > 0) overlap = fresh === 0 ? overlap + 1 : 0;
    // Hit the harvest cap → stop scrolling; we have the newest `limit` tiles.
    if (capped && byKey.size >= limit!) break;
    await cdp.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await sleep(1200);
  }
  const all = [...byKey.values()];
  return capped ? all.slice(0, limit!) : all;
}

/**
 * List a channel's reels by driving the signed-in browser over CDP.
 * Returns a Catalog in harvest order (the app re-sorts chronologically). When
 * `knownShortcodes` is supplied, both scroll passes stop early once they reach
 * the already-known back-catalog, so the result is a recent window (new reels +
 * a small known overlap) rather than the whole channel — see accumulate().
 * `limit` caps both passes at the newest `limit` reels — see accumulate().
 */
async function listChannelViaCdp(
  channel: string,
  knownShortcodes?: Set<string>,
  limit?: number
): Promise<Catalog> {
  const cdp = await CDPSession.connect();
  let gridTab: string | undefined;
  let reelsTab: string | undefined;
  try {
    // ── Pass 1: the main profile grid ──────────────────────────────────────
    // The main grid reliably renders every reel link as you scroll and carries
    // the tile thumbnail + caption (the /reels/ sub-route does NOT render
    // thumbnails). We accumulate across scroll steps, so photo posts interleaved
    // in the grid are simply ignored and all reels are still captured. This pass
    // is authoritative for the reel LIST.
    gridTab = await cdp.openTab(`https://www.instagram.com/${channel}/`);
    const scraped = await accumulate<ScrapedReel>(
      cdp,
      SCRAPE_EXPR,
      (r) => r.shortcode,
      knownShortcodes,
      limit
    );
    const displayName = await cdp
      .evaluate<string | null>(DISPLAY_NAME_EXPR)
      .catch(() => null);
    await cdp.closeTab(gridTab);
    gridTab = undefined;

    // ── Pass 2: the /reels/ tab for view counts ────────────────────────────
    // The main grid only labels each tile "Clip" — view counts are never in its
    // DOM (not even on hover). The dedicated reels tab, however, renders a
    // persistent view badge per tile. Views are best-effort: if this route is
    // throttled/empty, the map stays sparse and the refresh route preserves any
    // counts we already knew. It never affects the reel list from pass 1. Like
    // pass 1 this pass is bounded by knownShortcodes, so an incremental refresh
    // only reads fresh view counts for the recent window; counts for older reels
    // outside it keep their previously-known values (preserved by the merge).
    const viewsByCode = new Map<string, string>();
    try {
      reelsTab = await cdp.openTab(`https://www.instagram.com/${channel}/reels/`);
      const withViews = await accumulate<{ shortcode: string; views: string | null }>(
        cdp,
        VIEWS_SCRAPE_EXPR,
        (r) => r.shortcode,
        knownShortcodes,
        limit
      );
      for (const r of withViews) if (r.views) viewsByCode.set(r.shortcode, r.views);
    } catch {
      /* views are best-effort — leave the map sparse on any failure */
    } finally {
      if (reelsTab) await cdp.closeTab(reelsTab).catch(() => {});
      reelsTab = undefined;
    }

    const reels: Reel[] = scraped
      .filter((r) => r.shortcode && r.thumbnail)
      .map((r) => ({
        shortcode: r.shortcode,
        url: r.url,
        thumbnail: r.thumbnail as string,
        views: viewsByCode.get(r.shortcode) ?? null, // from the /reels/ pass; preserved by the refresh route if missing
        caption: r.caption,
        channel, // tag every reel with the channel it was harvested from
      }));

    return {
      channel,
      displayName: displayName ?? channel,
      harvestedAt: new Date().toISOString().slice(0, 10),
      reels,
    };
  } finally {
    if (gridTab) await cdp.closeTab(gridTab).catch(() => {});
    if (reelsTab) await cdp.closeTab(reelsTab).catch(() => {});
    cdp.close();
  }
}

// The ReelResolver the app programs against. The rest of the app only ever touches
// this object, never the CDP details above.
export const cdpResolver: ReelResolver = {
  listChannel: (channel: string, knownShortcodes?: Set<string>, limit?: number) =>
    listChannelViaCdp(channel, knownShortcodes, limit),
  resolve: ({ shortcode }: ReelRef) => resolveViaCdp(shortcode),
};
