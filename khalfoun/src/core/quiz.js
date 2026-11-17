// A quick, adaptive mental-maths game: Khalfoun asks, the child answers by
// voice or keyboard, and the level rises after three right answers in a row
// and drops after two wrong ones. Pure: unit-tested.

import { normalize, toArabicDigits } from './arabic.js';

const UNITS = new Map([
  ['صفر', 0], ['واحد', 1], ['وحده', 1], ['اثنين', 2], ['اثنان', 2], ['ثنين', 2], ['ثلاث', 3], ['ثلاثه', 3],
  ['اربع', 4], ['اربعه', 4], ['خمس', 5], ['خمسه', 5], ['ست', 6], ['سته', 6], ['سبع', 7], ['سبعه', 7],
  ['ثمان', 8], ['ثمانيه', 8], ['ثماني', 8], ['تسع', 9], ['تسعه', 9],
]);
const TEENS = new Map([
  ['عشر', 10], ['عشره', 10], ['احدعش', 11], ['احدعشر', 11], ['حداش', 11], ['حدعش', 11], ['اثنعش', 12], ['اثنعشر', 12], ['اثناعشر', 12], ['طنعش', 12],
  ['ثلطعش', 13], ['ثلاثطعش', 13], ['ثلاثتعشر', 13], ['اربعطعش', 14], ['اربعتعشر', 14], ['خمسطعش', 15], ['خمستعشر', 15],
  ['سطعش', 16], ['ستطعش', 16], ['ستتعشر', 16], ['سبعطعش', 17], ['سبعتعشر', 17], ['ثمنطعش', 18], ['ثمانتعشر', 18], ['تسعطعش', 19], ['تسعتعشر', 19],
]);
const TENS = new Map([['عشرين', 20], ['ثلاثين', 30], ['اربعين', 40], ['خمسين', 50], ['ستين', 60], ['سبعين', 70], ['ثمانين', 80], ['تسعين', 90]]);
const HUNDREDS = new Map([['ميه', 100], ['مية', 100], ['مئه', 100], ['مايه', 100], ['ميتين', 200], ['مئتين', 200]]);

/**
 * Reads a whole number from what the child said: digits («١٢»، «12») or
 * spoken words («خمسة وعشرين»، «مية واثنين»، «اثنعش»). Returns null if none.
 * @param {string} text
 */
export function parseArabicNumber(text) {
  const n = normalize(text);
  const digits = n.match(/-?\d+/);
  if (digits) return Number(digits[0]);
  let total = 0;
  let found = false;
  let negative = false;
  for (let raw of n.split(' ')) {
    if (raw === 'سالب' || raw === 'ناقص') { negative = true; continue; }
    if (raw.startsWith('و') && raw.length > 2) raw = raw.slice(1);
    if (raw.startsWith('ال') && raw.length > 3) raw = raw.slice(2);
    for (const map of [UNITS, TEENS, TENS, HUNDREDS]) {
      if (map.has(raw)) { total += map.get(raw); found = true; break; }
    }
  }
  if (!found) return null;
  return negative ? -total : total;
}

const rint = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/**
 * Makes one question at a level 1..5.
 * @returns {{text: string, answer: number}}
 */
export function makeQuestion(level, rng = Math.random) {
  const d = toArabicDigits;
  switch (level) {
    case 1: { const a = rint(rng, 1, 9); const b = rint(rng, 1, 9 - Math.min(a, 8)); return { text: `كم ${d(a)} + ${d(b)}؟`, answer: a + b }; }
    case 2: {
      if (rng() < 0.5) { const a = rint(rng, 5, 15); const b = rint(rng, 2, 9); return { text: `كم ${d(a)} + ${d(b)}؟`, answer: a + b }; }
      const a = rint(rng, 8, 20); const b = rint(rng, 1, a - 1); return { text: `كم ${d(a)} − ${d(b)}؟`, answer: a - b };
    }
    case 3: { const a = rint(rng, 2, 9); const b = rint(rng, 2, 10); return { text: `كم ${d(a)} × ${d(b)}؟`, answer: a * b }; }
    case 4: {
      const r = rng();
      if (r < 0.35) { const a = rint(rng, 12, 89); const b = rint(rng, 11, 99 - a); return { text: `كم ${d(a)} + ${d(b)}؟`, answer: a + b }; }
      if (r < 0.7) { const a = rint(rng, 30, 99); const b = rint(rng, 11, a - 1); return { text: `كم ${d(a)} − ${d(b)}؟`, answer: a - b }; }
      const b = rint(rng, 2, 9); const q = rint(rng, 2, 10); return { text: `كم ${d(b * q)} ÷ ${d(b)}؟`, answer: q };
    }
    default: {
      const r = rng();
      if (r < 0.3) { const a = rint(rng, 2, 15); return { text: `كم مربع ${d(a)}؟ يعني ${d(a)} × ${d(a)}`, answer: a * a }; }
      if (r < 0.6) { const p = [10, 20, 25, 50][rint(rng, 0, 3)]; const base = [20, 40, 60, 80, 100, 200][rint(rng, 0, 5)]; return { text: `كم ${d(p)}٪ من ${d(base)}؟`, answer: (p * base) / 100 }; }
      const a = rint(rng, 11, 19); const b = rint(rng, 3, 9); return { text: `كم ${d(a)} × ${d(b)}؟`, answer: a * b };
    }
  }
}

export class Quiz {
  /**
   * @param {{level?: number, rng?: () => number}} [opts]
   */
  constructor(opts = {}) {
    this.level = Math.min(5, Math.max(1, Math.round(opts.level || 1)));
    this.rng = opts.rng || Math.random;
    this.streak = 0;
    this.misses = 0;
    this.right = 0;
    this.total = 0;
    this.current = null;
  }

  next() {
    let q;
    do { q = makeQuestion(this.level, this.rng); } while (this.current && q.text === this.current.text);
    this.current = q;
    return q;
  }

  /**
   * Checks an answer.
   * @returns {{correct: boolean, answer: number, levelChange: -1|0|1, streak: number}}
   */
  answer(value) {
    const q = this.current;
    this.total += 1;
    let levelChange = 0;
    const correct = value === q.answer;
    if (correct) {
      this.right += 1;
      this.streak += 1;
      this.misses = 0;
      if (this.streak >= 3 && this.level < 5) { this.level += 1; this.streak = 0; levelChange = 1; }
    } else {
      this.misses += 1;
      this.streak = 0;
      if (this.misses >= 2 && this.level > 1) { this.level -= 1; this.misses = 0; levelChange = -1; }
    }
    return { correct, answer: q.answer, levelChange, streak: this.streak };
  }

  /** «ما أعرف»: reveal and move on without penalty to the level. */
  skip() {
    const q = this.current;
    this.total += 1;
    this.streak = 0;
    return { answer: q.answer };
  }
}
