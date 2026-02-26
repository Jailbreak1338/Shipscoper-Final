import { readdir, stat, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';

const TMP_DIR = os.tmpdir();
const TMP_FILE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.xlsx$/i;

export const TMP_TTL_MIN = parseInt(process.env.TMP_TTL_MIN || '30', 10);
const TMP_TTL_MS = TMP_TTL_MIN * 60 * 1000;

export function getTmpFilePath(jobId: string): string {
  return path.join(TMP_DIR, `${jobId}.xlsx`);
}

export function getTmpMetaPath(jobId: string): string {
  return path.join(TMP_DIR, `${jobId}.meta`);
}

export async function isTmpFileExpired(filePath: string): Promise<boolean> {
  const info = await stat(filePath);
  return Date.now() - info.mtimeMs > TMP_TTL_MS;
}

const TMP_META_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.meta$/i;

export async function cleanupExpiredTmpFiles(): Promise<number> {
  let removed = 0;
  const files = await readdir(TMP_DIR);
  const now = Date.now();

  for (const file of files) {
    if (!TMP_FILE_REGEX.test(file)) {
      continue;
    }

    const abs = path.join(TMP_DIR, file);
    try {
      const info = await stat(abs);
      const expired = now - info.mtimeMs > TMP_TTL_MS;
      if (expired) {
        await unlink(abs);
        removed++;
        // Also remove accompanying .meta file if present
        const metaAbs = abs.replace(/\.xlsx$/i, '.meta');
        try { await unlink(metaAbs); } catch { /* already gone */ }
      }
    } catch {
      // Ignore races (deleted between readdir/stat/unlink).
    }
  }

  // Clean up orphaned .meta files (no corresponding .xlsx)
  for (const file of files) {
    if (!TMP_META_REGEX.test(file)) continue;
    const xlsxAbs = path.join(TMP_DIR, file.replace(/\.meta$/i, '.xlsx'));
    try {
      await stat(xlsxAbs);
    } catch {
      // .xlsx gone — remove orphan .meta
      try { await unlink(path.join(TMP_DIR, file)); } catch { /* race */ }
    }
  }

  return removed;
}
