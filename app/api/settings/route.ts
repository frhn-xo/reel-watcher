import { NextResponse } from "next/server";
import { getSettings, patchSettings } from "@/lib/settings";

// Read/patch the app settings store (data/settings.json). Both handlers touch the
// filesystem, so they run on the Node runtime (the default for route handlers).
// The grid persists its view prefs here (POST { view }); the settings page sets
// the refresh limit (POST { refreshLimit }). A POST is a merge-patch, so each
// caller sends only the field it owns.

export async function GET() {
  return NextResponse.json({ ok: true, settings: await getSettings() });
}

export async function POST(req: Request) {
  let body: { refreshLimit?: unknown; view?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty/invalid body → no-op patch, returns current settings */
  }
  const settings = await patchSettings(body);
  return NextResponse.json({ ok: true, settings });
}
