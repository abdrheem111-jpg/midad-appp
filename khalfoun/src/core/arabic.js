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
 * Reads a clock time from free text: «الساعه 5», «الساعه خمس ونص العصر»,
 * «بكره الساعه ٧ الصبح», «الساعه 4:30», «الساعه سبعه الا ربع».
 * Returns {hour (0-23 or 1-12 when no period), minute, period, dayOffset} or null.
 * @param {string} text
 */
export function parseClock(text) {
  const t = ` ${normalize(text)} `;
  const dayOffset = / بعد (بكره|باكر|بكرا) /.test(t) ? 2 : / (بكره|باكر|بكرا|غدا|بكرة) /.test(t) ? 1 : 0;
  let hour = null;
  let minute = 0;
  const colon = /(?:^|\s)(\d{1,2})\s+(\d{2})(?:\s|$)/.exec(String(text).replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d))).replace(/[:.]/g, ' '));
  const tokens = t.trim().split(' ');
  const at = tokens.findIndex((w) => w === 'الساعه' || w === 'ساعه' || w === 'الساعة');
  if (at >= 0) {
    hour = parseNumberToken(tokens[at + 1]);
    if (hour === null && tokens[at + 1] === 'وحده') hour = 1;
    if (hour === null) {
      const two = `${tokens[at + 1] || ''} ${tokens[at + 2] || ''}`;
      const m = /^(\d+) (\d+)$/.exec(two);
      if (m) { hour = Number(m[1]); minute = Number(m[2]); }
    } else if (/^\d{2}$/.test(tokens[at + 2] || '') && Number(tokens[at + 2]) < 60) {
      minute = Number(tokens[at + 2]);
    }
  }
  if (hour === null && colon && / (الساعه|ساعه) /.test(t)) { hour = Number(colon[1]); minute = Number(colon[2]); }
  if (hour === null || hour > 23 || minute > 59) return null;
  if (/ (و نص|ونص|والنص|و نصف|ونصف) /.test(t)) minute = 30;
  else if (/ (و ربع|وربع) /.test(t)) minute = 15;
  else if (/ (و ثلث|وثلث) /.test(t)) minute = 20;
  else if (/ الا ربع /.test(t)) { hour = (hour + 23) % 24; minute = 45; }
  else if (/ الا ثلث /.test(t)) { hour = (hour + 23) % 24; minute = 40; }
  let period = null;
  if (/ (الصبح|الصباح|صباحا|صباح|الفجر|فجر|ص) /.test(t)) period = 'am';
  else if (/ (الظهر|ظهر|الظهريه) /.test(t)) period = 'noon';
  else if (/ (العصر|عصر|المغرب|مغرب|المسا|المساء|مساء|مسا|م|العشا|العشاء) /.test(t)) period = 'pm';
  else if (/ (الليل|بالليل|ليل) /.test(t)) period = 'night';
  // «يوم الثلاثاء»: the next such weekday
  const WD = { الاحد: 0, الاثنين: 1, الاتنين: 1, الثلاثاء: 2, الثلاثا: 2, الاربعاء: 3, الاربعا: 3, الخميس: 4, الجمعه: 5, السبت: 6 };
  const wdWord = t.trim().split(' ').find((w) => w in WD);
  const weekday = wdWord !== undefined ? WD[wdWord] : null;
  return weekday === null ? { hour, minute, period, dayOffset } : { hour, minute, period, dayOffset, weekday };
}

/**
 * The exact moment a parsed clock time refers to, after `now`. Without a
 * period, the next time the clock shows that hour is chosen.
 * @param {{hour: number, minute: number, period: string|null, dayOffset: number}} c
 * @param {number} now
 * @returns {number} epoch milliseconds
 */
export function clockToTime(c, now) {
  const base = new Date(now);
  if (Number.isInteger(c.weekday)) {
    // The coming «الثلاثاء»; today only if that time is still ahead.
    let h = c.hour;
    if (h <= 12) {
      if (c.period === 'am') h = h === 12 ? 0 : h;
      else if (c.period === 'pm' || c.period === 'noon') h = h === 12 ? 12 : h + 12;
      else if (c.period === 'night') h = h === 12 ? 0 : h <= 4 ? h : h + 12;
      else h = h >= 7 && h <= 11 ? h : h === 12 ? 12 : h + 12;
    }
    let add = (c.weekday - base.getDay() + 7) % 7;
    const at = (n) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n, h, c.minute, 0, 0).getTime();
    if (at(add) <= now + 30000) add += 7;
    return at(add);
  }
  const at = (h, extraDays = 0) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + c.dayOffset + extraDays, h, c.minute, 0, 0);
    return d.getTime();
  };
  let h = c.hour;
  if (h <= 12 && c.period) {
    if (c.period === 'am') h = h === 12 ? 0 : h;
    else if (c.period === 'noon') h = h <= 4 ? h + 12 : h === 12 ? 12 : h;
    else if (c.period === 'pm') h = h === 12 ? 12 : h + 12;
    else if (c.period === 'night') h = h === 12 ? 0 : h <= 4 ? h : h + 12;
  }
  if (h > 12 || c.period || h === 0) {
    let t = at(h);
    if (t <= now + 30000) t = at(h, 1);
    return t;
  }
  // No period: «الساعه 5» → the next 5 o'clock, morning or afternoon.
  if (c.dayOffset > 0) return at(h >= 7 && h <= 11 ? h : h === 12 ? 12 : h + 12);
  const options = [at(h), at(h === 12 ? 0 : h + 12), at(h, 1)].filter((t) => t > now + 30000);
  return Math.min(...options);
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
