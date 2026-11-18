// Finds the wake word «خلفون» in what the speech recognizer heard, tolerating
// small mishearings (one wrong letter) and common prefixes («يا خلفون»,
// «ياخلفون», «وخلفون»). Returns whatever was said after the name so a whole
// sentence like «يا خلفون افتح الحاسبة» runs in one go.

import { normalize } from './arabic.js';

const WAKE = normalize('خلفون');

/** Edit distance between two short strings. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// The consonants خ-ل-ف must be there: this keeps «خلفان» and «خلفوه» (common
// mishearings) but rejects look-alikes such as «تلفون» (phone) or «كلفون».
const close = (t) => t.length >= 4 && t.length <= 6 && (t.startsWith('خلف') || t.startsWith('خالف')) && levenshtein(t, WAKE) <= 1;
// Whisper often writes خ as ح («حلفون»), and some people type the name in Latin letters.
const closeH = (t) => t.length === 5 && t.startsWith('حلفو') && levenshtein(t, WAKE) <= 1;
const LATIN = /^(?:ya)?(?:kh|k|h)al+f(?:o|ou|oo|u)+n$/;

function isWake(token) {
  if (close(token) || closeH(token) || LATIN.test(token)) return true;
  for (const prefix of ['يا', 'و', 'ف']) {
    const t = token.slice(prefix.length);
    if (token.startsWith(prefix) && (close(t) || closeH(t))) return true;
  }
  return false;
}

/**
 * @param {string} raw text from the recognizer
 * @returns {{found: false} | {found: true, rest: string}}
 */
export function findWakeWord(raw) {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const n = normalize(tokens[i]);
    if (!n) continue;
    for (const part of n.split(' ')) {
      if (isWake(part)) {
        const rest = tokens.slice(i + 1).join(' ').replace(/^[\s،,.!؟?:]+/u, '').trim();
        return { found: true, rest };
      }
    }
  }
  return { found: false };
}
