// Finding the teacher's own files by what he calls them («البي دي إف حق الصف العاشر», «درس
// الكسور») and opening one. Only inside his Desktop, Documents and Downloads folders, only
// documents, pictures and videos — never a program, a script or a shortcut.

import { readdir, stat, realpath } from 'node:fs/promises';
import { join, extname, basename, relative, isAbsolute, resolve } from 'node:path';
import { normalize } from '../../core/arabic.js';

/** What may be opened: documents, slides, sheets, pictures, sound and video. */
export const OPENABLE = new Set(['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.ppsx', '.xlsx', '.xls', '.csv', '.txt', '.rtf', '.odt', '.odp', '.ods',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.mp4', '.mp3', '.wav', '.m4a', '.wmv', '.avi', '.mkv', '.html', '.htm']);

const KINDS = {
  pdf: ['.pdf'], word: ['.docx', '.doc', '.rtf', '.odt'], powerpoint: ['.pptx', '.ppt', '.ppsx', '.odp'],
  excel: ['.xlsx', '.xls', '.csv', '.ods'], picture: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'], video: ['.mp4', '.wmv', '.avi', '.mkv'],
};

// «الصف العاشر» and «الصف 10» should find each other.
const ORDINALS = [['الحادي عشر', '11'], ['الثاني عشر', '12'], ['الاول', '1'], ['الثاني', '2'], ['الثالث', '3'], ['الرابع', '4'], ['الخامس', '5'],
  ['السادس', '6'], ['السابع', '7'], ['الثامن', '8'], ['التاسع', '9'], ['العاشر', '10']].map(([w, n]) => [normalize(w), n]);
const STOP = new Set(['ملف', 'الملف', 'حق', 'حقت', 'مال', 'مع', 'في', 'من', 'على', 'اللي', 'هذا', 'ذا', 'افتح', 'لي', 'pdf', 'بي', 'دي', 'اف', 'ال']);

function words(text) {
  let t = ` ${normalize(String(text || '').replace(/[_\-.()[\]]+/g, ' '))} `;
  for (const [w, n] of ORDINALS) t = t.split(` ${w} `).join(` ${n} `);
  return t.split(/\s+/).filter((w) => w && !STOP.has(w));
}

/** How well a file name matches what was said (0 = not at all). */
export function matchScore(query, fileName) {
  const q = words(query);
  if (!q.length) return 0;
  const name = ` ${words(basename(fileName, extname(fileName))).join(' ')} `;
  let hit = 0;
  for (const w of q) {
    if (name.includes(` ${w} `)) hit += 1;
    else if (w.length >= 3 && name.includes(w)) hit += 0.6;
    else if (w.startsWith('ال') && w.length > 4 && name.includes(w.slice(2))) hit += 0.6;
  }
  return hit / q.length;
}

/**
 * Looks through the folders (a few levels deep) for files whose names match.
 * @param {string[]} roots
 * @param {string} query
 * @param {{kind?: string, max?: number, depth?: number, limitScan?: number}} [opts]
 */
export async function findFiles(roots, query, opts = {}) {
  const exts = KINDS[opts.kind] ? new Set(KINDS[opts.kind]) : OPENABLE;
  const found = [];
  let scanned = 0;
  const limit = opts.limitScan || 6000;
  async function walk(dir, depth) {
    if (scanned > limit) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (scanned++ > limit) return;
      if (e.name.startsWith('.') || e.name.startsWith('~$') || /^(node_modules|AppData|\$RECYCLE\.BIN)$/i.test(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) await walk(full, depth - 1); continue; }
      if (!e.isFile() || !exts.has(extname(e.name).toLowerCase())) continue;
      const score = query ? matchScore(query, e.name) : 1;
      if (score < 0.5) continue;
      let modified = 0;
      try { modified = (await stat(full)).mtimeMs; } catch { /* still listed */ }
      found.push({ path: full, name: e.name, score, modified });
    }
  }
  for (const r of roots.filter(Boolean)) await walk(r, opts.depth ?? 4);
  found.sort((a, b) => b.score - a.score || b.modified - a.modified);
  const seen = new Set();
  return found.filter((f) => (seen.has(f.path) ? false : seen.add(f.path))).slice(0, opts.max || 12);
}

/** True when `file` really lies inside one of the roots (links resolved) and may be opened. */
export async function insideRoots(roots, file) {
  if (typeof file !== 'string' || !isAbsolute(file) || !OPENABLE.has(extname(file).toLowerCase())) return false;
  let real;
  try { real = await realpath(resolve(file)); } catch { return false; }
  for (const r of roots.filter(Boolean)) {
    let base;
    try { base = await realpath(r); } catch { continue; }
    const rel = relative(base, real);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return true;
  }
  return false;
}
