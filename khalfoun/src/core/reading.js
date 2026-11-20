// Reading-aloud check: compares what a student read (the transcript) with the passage.
// Gives words read right, words per minute, and which words were missed or added.
// The transcript comes from speech recognition, so small spelling differences count as right.

import { levenshtein } from './wake.js';

/** Arabic words for comparing: no diacritics, unified letters, no punctuation. */
export function readingWords(text) {
  return String(text || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter(Boolean);
}

function same(a, b) {
  if (a === b) return true;
  // «وذهب» / «ذهب», «بالمدرسه» / «المدرسه»: a joined letter the recognizer may drop.
  const strip = (w) => w.replace(/^(و|ف)(?=\S{3,})/, '');
  if (strip(a) === strip(b)) return true;
  const long = Math.max(a.length, b.length);
  return long >= 4 && levenshtein(a, b) <= (long >= 7 ? 2 : 1);
}

/**
 * @param {string} passage what should be read
 * @param {string} heard what the recognizer heard
 * @param {number} seconds how long the reading took
 */
export function compareReading(passage, heard, seconds) {
  const ref = readingWords(passage);
  const got = readingWords(heard);
  const n = ref.length;
  const m = got.length;
  // Alignment table: fewest edits to turn the reading into the passage.
  const d = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)]);
  for (let j = 1; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (same(ref[i - 1], got[j - 1]) ? 0 : 1));
    }
  }
  const words = []; // per passage word: {word, ok}
  const extra = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (same(ref[i - 1], got[j - 1]) ? 0 : 1)) {
      words.unshift({ word: ref[i - 1], ok: same(ref[i - 1], got[j - 1]), heard: got[j - 1] });
      i -= 1; j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      words.unshift({ word: ref[i - 1], ok: false, heard: null });
      i -= 1;
    } else {
      extra.unshift(got[j - 1]);
      j -= 1;
    }
  }
  const correct = words.filter((w) => w.ok).length;
  const minutes = Math.max(seconds, 1) / 60;
  return {
    total: n,
    correct,
    accuracy: n ? Math.round((correct / n) * 100) : 0,
    wpm: Math.round(correct / minutes),
    missed: words.filter((w) => !w.ok).map((w) => w.word),
    extra,
    words,
  };
}

/** A short, kind verdict a teacher can read to the student. */
export function readingVerdict(r) {
  if (!r.total) return 'ما فيه نص للقراءة.';
  if (r.accuracy >= 95) return 'قراءة ممتازة!';
  if (r.accuracy >= 85) return 'قراءة جيدة جداً، وكم كلمة تحتاج تركيز.';
  if (r.accuracy >= 70) return 'قراءة جيدة، نراجع الكلمات المعلّمة.';
  return 'نحتاج نتدرب أكثر على هالفقرة، خطوة خطوة.';
}
