// Writing into PDF files. Chromium renders the Arabic text (so letters join
// correctly) into a transparent one-page PDF the size of the target page; that
// page is stamped onto the original with pdf-lib and saved as a NEW file next
// to it. The original file is never changed.

import { readdir, readFile, stat, writeFile, access } from 'node:fs/promises';
import { join, parse } from 'node:path';
import pdfLib from 'pdf-lib';

const { PDFDocument } = pdfLib;
const SUFFIX = ' - خلفون';

/** Newest PDF (by modification time) in the given folders, or null. */
export async function findLatestPdf(dirs) {
  let best = null;
  for (const dir of dirs) {
    let names = [];
    try { names = await readdir(dir); } catch { continue; }
    for (const name of names) {
      if (!/\.pdf$/i.test(name) || name.startsWith('.')) continue;
      const file = join(dir, name);
      try {
        const info = await stat(file);
        if (info.isFile() && (!best || info.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: info.mtimeMs };
      } catch { /* vanished */ }
    }
  }
  return best ? best.file : null;
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** «تقرير.pdf» -> «تقرير - خلفون.pdf», never overwriting an existing file. */
export async function copyName(file) {
  const { dir, name } = parse(file);
  const base = name.endsWith(SUFFIX) ? name : `${name}${SUFFIX}`;
  let candidate = join(dir, `${base}.pdf`);
  for (let i = 2; await exists(candidate); i += 1) candidate = join(dir, `${base} (${i}).pdf`);
  return candidate;
}

/** HTML for the transparent overlay page; sizes in PDF points (1/72 inch). */
export function overlayHtml({ width, height, text, position, fontCss = '' }) {
  const esc = String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const vertical = position === 'bottom' ? 'bottom: 48pt;' : 'top: 44pt;';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
${fontCss}
@page { size: ${width}pt ${height}pt; margin: 0; }
html, body { margin: 0; width: ${width}pt; height: ${height}pt; background: transparent; }
.ink { position: absolute; ${vertical} right: 44pt; max-width: ${Math.round(width * 0.8)}pt;
  font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif; font-weight: 700; font-size: 16pt; line-height: 1.5;
  color: #1B2F7A; unicode-bidi: plaintext; text-align: right; white-space: pre-wrap; }
</style></head><body><div class="ink">${esc}</div></body></html>`;
}

/**
 * Stamps `overlayBytes` (a one-page PDF) onto page `pageIndex` of `file` and saves a copy.
 * @returns {Promise<string>} the new file path
 */
export async function stampPdf(file, overlayBytes, pageIndex = 0) {
  const doc = await PDFDocument.load(await readFile(file), { ignoreEncryption: false });
  const pages = doc.getPages();
  const page = pages[Math.min(Math.max(0, pageIndex), pages.length - 1)];
  const [overlay] = await doc.embedPdf(overlayBytes, [0]);
  const { width, height } = page.getSize();
  page.drawPage(overlay, { x: 0, y: 0, width, height });
  const out = await copyName(file);
  await writeFile(out, await doc.save());
  return out;
}

/** Size of a page in points. */
export async function pageSize(file, pageIndex = 0) {
  const doc = await PDFDocument.load(await readFile(file), { updateMetadata: false });
  const pages = doc.getPages();
  const page = pages[Math.min(Math.max(0, pageIndex), pages.length - 1)];
  return page.getSize();
}

/**
 * Whole action: newest PDF -> overlay with the text -> stamped copy.
 * @param {{dirs: string[], text: string, position: 'top'|'bottom', render: (html: string, size: {width: number, height: number}) => Promise<Uint8Array>, fontCss?: string}} opts
 */
export async function writeIntoLatestPdf(opts) {
  const file = await findLatestPdf(opts.dirs);
  if (!file) return { ok: false, error: 'no_pdf' };
  let size;
  try { size = await pageSize(file); } catch { return { ok: false, error: 'pdf_unreadable' }; }
  const html = overlayHtml({ ...size, text: opts.text, position: opts.position, fontCss: opts.fontCss });
  const overlay = await opts.render(html, size);
  const out = await stampPdf(file, overlay);
  return { ok: true, data: { file: out, source: file } };
}
