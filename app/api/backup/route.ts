import { NextResponse } from "next/server";
import {
  BACKUP_VERSION,
  readServerBackup,
  restoreServerBackup,
} from "@/lib/backup";

// Export / restore the server-side half of a backup (library + settings). Both
// handlers touch the filesystem, so they run on the Node runtime (the default for
// route handlers). Watch history lives in the browser, so the client assembles the
// downloaded file and carries that piece across — see app/settings/BackupControls.

/** Export: the current library + settings, for the client to bundle and download. */
export async function GET() {
  const { library, settings } = await readServerBackup();
  return NextResponse.json({ ok: true, version: BACKUP_VERSION, library, settings });
}

/** Restore: replace the library (and settings) from an uploaded backup. */
export async function POST(req: Request) {
  let body: { library?: unknown; settings?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* fall through to validation, which rejects a missing library */
  }

  try {
    const { library, settings } = await restoreServerBackup(body);
    const channels = library.channels.length;
    return NextResponse.json({
      ok: true,
      channels,
      reels: library.reels.length,
      settings,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Import failed." },
      { status: 400 }
    );
  }
}
