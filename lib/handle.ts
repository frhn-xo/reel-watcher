// Normalize whatever the user pastes into a bare Instagram handle. Accepts a raw
// handle ("natgeo"), an @-handle ("@natgeo"), or any profile/reel URL
// ("https://www.instagram.com/natgeo/reels/"). Pure (no I/O) so both the client
// settings form and the server route can share one definition.

// Path segments that are Instagram routes, never usernames — so a pasted reel or
// post URL doesn't get mistaken for a channel.
const RESERVED = new Set(["reel", "reels", "p", "explore", "stories", "tv", "s"]);

export function parseHandle(input: string): string | null {
  let s = (input || "").trim();
  if (!s) return null;

  if (s.includes("instagram.com")) {
    // Take the first path segment after the domain.
    const m = s.match(/instagram\.com\/+([^/?#]+)/i);
    s = m ? m[1] : "";
  }

  s = s.replace(/^@+/, "").replace(/[/?#].*$/, "").trim();

  if (!s || RESERVED.has(s.toLowerCase())) return null;
  // IG handles: letters, digits, periods, underscores.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null;
  return s;
}
