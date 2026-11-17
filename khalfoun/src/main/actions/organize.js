// "رتب التنزيلات": moves loose files in a folder into Arabic-named subfolders by
// type, and records every move so it can be undone exactly. Only plain files
// at the top level are touched; folders, hidden files and unfinished downloads
// are left alone, and nothing is ever overwritten or deleted.

import { lstat, mkdir, readdir, rename, access } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';

export const CATEGORIES = {
  'صور': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.svg', '.tif', '.tiff'],
  'مستندات': ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods', '.odp', '.csv', '.md'],
  'فيديو': ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.m4v'],
  'صوتيات': ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.opus'],
  'مضغوطات': ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
  'برامج': ['.exe', '.msi', '.dmg', '.pkg', '.apk', '.appx', '.msix', '.deb', '.rpm'],
};

const SKIP_EXT = new Set(['.crdownload', '.part', '.tmp', '.download', '.partial', '.opdownload']);
const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

export function categoryFor(fileName) {
  const ext = extname(fileName).toLowerCase();
  for (const [folder, exts] of Object.entries(CATEGORIES)) if (exts.includes(ext)) return folder;
  return null; // unknown types stay where they are
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function freeName(dir, fileName) {
  const { name, ext } = parse(fileName);
  let candidate = join(dir, fileName);
  for (let i = 2; await exists(candidate); i += 1) candidate = join(dir, `${name} (${i})${ext}`);
  return candidate;
}

/**
 * @param {string} dir
 * @returns {Promise<{moves: Array<{from: string, to: string}>, skipped: number}>}
 */
export async function organizeFolder(dir) {
  const moves = [];
  let skipped = 0;
  const entries = await readdir(dir);
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (entry.startsWith('.') || SKIP_NAMES.has(lower) || SKIP_EXT.has(extname(lower))) { skipped += 1; continue; }
    const from = join(dir, entry);
    let info;
    try { info = await lstat(from); } catch { skipped += 1; continue; }
    if (!info.isFile()) continue;
    const folder = categoryFor(entry);
    if (!folder) { skipped += 1; continue; }
    const targetDir = join(dir, folder);
    await mkdir(targetDir, { recursive: true });
    const to = await freeName(targetDir, entry);
    try {
      await rename(from, to);
      moves.push({ from, to });
    } catch {
      skipped += 1;
    }
  }
  return { moves, skipped };
}

/**
 * Puts files back where they were. Never overwrites a file that appeared at
 * the original place in the meantime.
 * @param {Array<{from: string, to: string}>} moves
 */
export async function undoMoves(moves) {
  let restored = 0;
  let failed = 0;
  for (const m of [...moves].reverse()) {
    if (!(await exists(m.to)) || (await exists(m.from))) { failed += 1; continue; }
    try {
      await rename(m.to, m.from);
      restored += 1;
    } catch {
      failed += 1;
    }
  }
  return { restored, failed };
}
