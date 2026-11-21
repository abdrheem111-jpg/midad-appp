// Finding words on the screen exactly where they are: Windows' OCR gives every word with its
// box (in the screenshot's pixels); this picks the words the person named and returns boxes
// in the overlay's own coordinates, so Khalfoun can circle, underline or highlight them.
// «حط دايرة على كلمة الماء», «ظلل كلمة النخلة», «وين كلمة ٢٥ في الشاشة».

import { normalize } from './arabic.js';

/** A word as compared: normalized, no punctuation, no tatweel. */
export function cleanWord(w) {
  return normalize(String(w || '')).replace(/[^\p{L}\p{N}]/gu, '');
}

/** The same word with or without a leading «ال», «و», «ب», «ل», «بال», «وال», «لل». */
function variants(w) {
  const out = new Set([w]);
  const bare = w.replace(/^(?:وال|بال|فال|كال|لل|ال|و|ب|ل|ف)(?=\p{L}{2,})/u, '');
  out.add(bare);
  if (!bare.startsWith('ال')) out.add(`ال${bare}`);
  return out;
}

function sameWord(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const va = variants(a);
  for (const v of variants(b)) if (va.has(v)) return true;
  return false;
}

const union = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const bt = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: bt - y };
};

/**
 * @param {{line: number, x: number, y: number, w: number, h: number, text: string}[]} words OCR words
 * @param {string} target what the person said («الماء», «دورة الماء», «٢٥»)
 * @param {{scale?: number, max?: number}} [opts] scale: screenshot pixels per overlay pixel
 * @returns {{x: number, y: number, w: number, h: number, text: string}[]} boxes, top first
 */
export function findOnScreen(words, target, { scale = 1, max = 6 } = {}) {
  const want = String(target || '').split(/\s+/).map(cleanWord).filter(Boolean);
  if (!want.length || !Array.isArray(words)) return [];
  const byLine = new Map();
  for (const w of words) {
    const c = cleanWord(w.text);
    if (!c) continue;
    if (!byLine.has(w.line)) byLine.set(w.line, []);
    byLine.get(w.line).push({ ...w, c });
  }
  const hits = [];
  for (const line of byLine.values()) {
    if (want.length === 1) {
      for (const w of line) if (sameWord(w.c, want[0])) hits.push({ box: union([w]), text: w.text });
      continue;
    }
    // Several words: all on the same line, next to each other (Arabic OCR may list them in either order).
    for (let i = 0; i + want.length <= line.length; i += 1) {
      const run = line.slice(i, i + want.length);
      const fwd = run.every((w, k) => sameWord(w.c, want[k]));
      const back = run.every((w, k) => sameWord(w.c, want[want.length - 1 - k]));
      if (fwd || back) hits.push({ box: union(run), text: run.map((w) => w.text).join(' ') });
    }
  }
  hits.sort((a, b) => a.box.y - b.box.y || b.box.x - a.box.x);
  const s = scale > 0 ? scale : 1;
  return hits.slice(0, max).map(({ box, text }) => ({
    x: Math.round(box.x / s), y: Math.round(box.y / s), w: Math.max(1, Math.round(box.w / s)), h: Math.max(1, Math.round(box.h / s)), text,
  }));
}

/** The OCR lines with where they are, for a vision prompt («measurements» of the screen). */
export function layoutHint(words, { scale = 1, maxLines = 60 } = {}) {
  const lines = new Map();
  for (const w of words || []) {
    if (!lines.has(w.line)) lines.set(w.line, []);
    lines.get(w.line).push(w);
  }
  const s = scale > 0 ? scale : 1;
  const out = [];
  for (const ws of lines.values()) {
    const b = union(ws);
    out.push({ y: b.y, text: `(${Math.round(b.x / s)},${Math.round(b.y / s)} ${Math.round(b.w / s)}×${Math.round(b.h / s)}) ${ws.map((w) => w.text).join(' ')}` });
  }
  return out.sort((a, b) => a.y - b.y).slice(0, maxLines).map((l) => l.text).join('\n');
}
