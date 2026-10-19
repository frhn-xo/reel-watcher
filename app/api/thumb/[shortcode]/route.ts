import { NextRequest } from "next/server";
import { getReelByShortcode } from "@/lib/catalog";

// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail proxy.
// Instagram CDN thumbnail URLs are signed, expire, and reject foreign referers,
// so dropping them straight into <img src> rots. We fetch them server-side with
// an instagram.com Referer and stream the bytes back. The ugly CDN URL never
// reaches the browser — the client just asks for /api/thumb/<shortcode>.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shortcode: string }> }
) {
  const { shortcode } = await params;
  const reel = await getReelByShortcode(shortcode);
  if (!reel) {
    return new Response("Unknown reel", { status: 404 });
  }

  const upstream = await fetch(reel.thumbnail, {
    headers: {
      Referer: "https://www.instagram.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    // Most likely the signed URL expired → re-harvest needed.
    return new Response(`Thumbnail upstream ${upstream.status}`, {
      status: 502,
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
