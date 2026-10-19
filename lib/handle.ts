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

  // Instagram handles are case-insensitive and canonically lowercase, so we
  // normalize to lowercase here. Without this, "NatGeo" and "natgeo" would be
  // treated as two different channels for the same account (the library dedups
  // channels by exact handle) — you'd get a duplicate and a redundant harvest.
  s = s.replace(/^@+/, "").replace(/[/?#].*$/, "").trim().toLowerCase();

  if (!s || RESERVED.has(s)) return null;
  // IG handles: letters, digits, periods, underscores.
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;
  return s;
}
