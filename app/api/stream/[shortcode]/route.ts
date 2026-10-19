import { NextRequest } from "next/server";
import { getResolvedVideo, type ResolvedVideo } from "@/lib/catalog";
import { resolveAndCache } from "@/lib/resolve";
import { ReelUnavailableError } from "@/lib/contracts";

// ─────────────────────────────────────────────────────────────────────────────
// Video stream proxy.
//
// Two wins over linking the CDN URL directly:
//
//   1. HTTP RANGE support: the browser's <video> sends `Range: bytes=...` when you
//      scrub; we forward it to Instagram's CDN (which honors ranges) and pass back
//      the 206 Partial Content + Content-Range. That's what makes seeking smooth.
//
//   2. Self-healing sources: the signed CDN mp4 URLs are short-lived (expire in
//      hours) and brand-new reels may have no URL yet at all. So instead of 404/502
//      on a missing or rotted URL, we mint a fresh one on demand via the resolver
//      and cache it. The catalog only has to know a reel's shortcode; this route
//      always re-derives a playable URL. That's why every reel "just works".
// ─────────────────────────────────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function fetchUpstream(url: string, range: string | undefined) {
  return fetch(url, {
    headers: {
      Referer: "https://www.instagram.com/",
      "User-Agent": UA,
      ...(range ? { Range: range } : {}),
    },
    cache: "no-store",
  });
}

const ok = (r: Response) => r.status === 200 || r.status === 206;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// A permanently-gone reel (removed/taken-down/private) → 410 Gone, so the player
// shows "no longer available" instead of a generic, retry-worthy error.
const GONE_BODY = (sc: string) =>
  `Reel ${sc} is no longer available on Instagram (removed, taken down, or private).`;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shortcode: string }> }
) {
  const { shortcode } = await params;
  const range = req.headers.get("range") ?? undefined;

  // 1. Use the cached URL if we have one; otherwise resolve this reel on demand.
  let video: ResolvedVideo | null = await getResolvedVideo(shortcode);
  if (!video) {
    try {
      video = await resolveAndCache(shortcode);
    } catch (e) {
      if (e instanceof ReelUnavailableError) {
        return new Response(GONE_BODY(shortcode), { status: 410 });
      }
      return new Response(`Couldn't resolve reel ${shortcode}: ${msg(e)}`, {
        status: 502,
      });
    }
  }

  // 2. Stream it. If the signed URL has rotted, mint a fresh one and retry once.
  let upstream = await fetchUpstream(video.videoUrl, range);
  if (!ok(upstream)) {
    try {
      video = await resolveAndCache(shortcode);
      upstream = await fetchUpstream(video.videoUrl, range);
    } catch (e) {
      if (e instanceof ReelUnavailableError) {
        return new Response(GONE_BODY(shortcode), { status: 410 });
      }
      return new Response(`Re-resolve failed for ${shortcode}: ${msg(e)}`, {
        status: 502,
      });
    }
  }
  if (!ok(upstream)) {
    return new Response(
      `Upstream ${upstream.status} after re-resolve — reel may be unavailable.`,
      { status: 502 }
    );
  }

  const headers = new Headers();
  for (const h of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
  ]) {
    const val = upstream.headers.get(h);
    if (val) headers.set(h, val);
  }
  if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, { status: upstream.status, headers });
}
