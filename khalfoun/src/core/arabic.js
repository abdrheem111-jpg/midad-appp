// Arabic text utilities shared by the brain (main process and renderer).
// Everything here is pure: no I/O, no globals.

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Normalizes Arabic text so that spelling variants compare equal:
 * removes diacritics and tatweel, unifies alef/yaa/taa marbuta/hamza
 * forms, converts Eastern digits to Western, drops punctuation and
 * collapses whitespace.
 * @param {string} input
 * @returns {string}
 */
export function normalize(input) {
  if (typeof input !== 'string') return '';
  let s = input.replace(DIACRITICS, '').replace(TATWEEL, '');
  s = s
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_INDIC.indexOf(d)));
  s = s.toLowerCase();
  // Keep letters, digits and spaces; everything else becomes a space.
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** @param {string} input */
export function tokenize(input) {
  const n = normalize(input);
  return n ? n.split(' ') : [];
}

// Number words as they appear after normalize(); Omani/Gulf spoken forms included.
const NUMBER_WORDS = new Map([
  ['صفر', 0], ['واحد', 1], ['وحده', 1], ['اثنين', 2], ['ثنين', 2], ['اثنتين', 2],
  ['ثلاث', 3], ['ثلاثه', 3], ['اربع', 4], ['اربعه', 4], ['خمس', 5], ['خمسه', 5],
  ['ست', 6], ['سته', 6], ['سبع', 7], ['سبعه', 7], ['ثمان', 8], ['ثمانيه', 8], ['ثماني', 8],
  ['تسع', 9], ['تسعه', 9], ['عشر', 10], ['عشره', 10], ['عشرين', 20], ['ثلاثين', 30],
  ['اربعين', 40], ['خمسين', 50], ['ستين', 60], ['مية', 100], ['ميه', 100], ['مايه', 100], ['مئه', 100],
]);

/**
 * Reads a number from a single normalized token (digits or a number word).
 * @param {string} token
 * @returns {number|null}
 */
export function parseNumberToken(token) {
  if (!token) return null;
  if (/^\d+$/.test(token)) return Number(token);
  if (NUMBER_WORDS.has(token)) return NUMBER_WORDS.get(token);
  return null;
}

/**
 * Extracts a duration in minutes from free text such as
 * "بعد 5 دقايق", "بعد ربع ساعه", "بعد ساعتين", "بعد دقيقتين".
 * @param {string} text normalized or raw text
 * @returns {number|null}
 */
export function parseMinutes(text) {
  const t = ` ${normalize(text)} `;
  if (/ (ربع ساعه) /.test(t)) return 15;
  if (/ (نص|نصف) ساعه /.test(t)) return 30;
  if (/ ساعه الا ربع /.test(t)) return 45;
  if (/ ساعتين /.test(t)) return 120;
  if (/ دقيقتين /.test(t)) return 2;
  const tokens = t.trim().split(' ');
  for (let i = 0; i < tokens.length; i += 1) {
    const unit = tokens[i + 1] || '';
    const n = parseNumberToken(tokens[i]);
    if (n === null) continue;
    if (/^(دقيقه|دقايق|دقائق|دقيقة|دقايق|دقيقا|دقيق)$/.test(unit)) return n;
    if (/^(ساعه|ساعات)$/.test(unit)) return n * 60;
    if (/^(ثانيه|ثواني)$/.test(unit)) return Math.max(1, Math.round(n / 60));
  }
  if (/ دقيقه /.test(t)) return 1;
  if (/ ساعه /.test(t)) return 60;
  return null;
}

/**
 * True when the space-padded normalized text contains the normalized phrase as whole words.
 * @param {string} paddedText text already normalized and wrapped in single spaces
 * @param {string} normalizedPhrase
 */
export function hasPhrase(paddedText, normalizedPhrase) {
  return paddedText.includes(` ${normalizedPhrase} `);
}

/** Converts Western digits to Arabic-Indic digits for display. */
export function toArabicDigits(value) {
  return String(value).replace(/\d/g, (d) => ARABIC_INDIC[Number(d)]);
}
