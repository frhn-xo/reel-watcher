import { promises as fs } from "fs";

// ─────────────────────────────────────────────────────────────────────────────
// ATOMIC FILE WRITE
//
// Every durable store in data/ (reels.json, resolved.json, settings.json) is a
// single JSON file we overwrite wholesale. A plain fs.writeFile truncates the
// real file first and then streams the new bytes — so a crash (or a Ctrl-C on
// `next dev`) mid-write leaves a half-written, unparseable file, and the whole
// library is gone.
//
// The fix is the standard temp-then-rename: write the full contents into a
// sibling temp file, then rename(2) it over the target. rename is atomic on a
// single filesystem, so a reader (or a crash) sees EITHER the complete old file
// OR the complete new one — never a truncated middle. The temp lives next to the
// target (same directory → same filesystem → rename stays atomic), and its name
// is unique per process + call so two concurrent writers can't share and clobber
// one temp.
// ─────────────────────────────────────────────────────────────────────────────

let tmpCounter = 0;

/** Atomically write `data` to `file` via a sibling temp file + rename. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${tmpCounter++}`;
  try {
    await fs.writeFile(tmp, data, "utf-8");
    await fs.rename(tmp, file);
  } catch (err) {
    // Best-effort cleanup so a failed write doesn't leave a stray temp behind.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Atomically write a value as pretty JSON with a trailing newline — the on-disk
 *  convention shared by every JSON store in data/. */
export function writeJsonFileAtomic(file: string, value: unknown): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}
