// Finds the installed program the person means when they say its name in
// Arabic («افتح سبوتيفاي», «شغل زوم») or type it in English. Program names on
// the computer are mostly English, so a spoken Arabic name is matched through
// a small dictionary of well-known apps and, failing that, by comparing the
// sound skeleton of the Arabic letters with the English letters.

import { normalize } from './arabic.js';
import { levenshtein } from './wake.js';

/** Arabic names people use for common programs → words found in their English names. */
export const KNOWN_APP_WORDS = [
  [['سبوتيفاي', 'سبوتفاي', 'سبوتي فاي'], 'spotify'],
  [['زوم', 'الزوم'], 'zoom'],
  [['تيمز', 'تيم', 'مايكروسوفت تيمز', 'التيمز'], 'teams'],
  [['تيليجرام', 'تلجرام', 'تليجرام', 'تلقرام', 'التلجرام', 'التليجرام'], 'telegram'],
  [['ديسكورد', 'دسكورد', 'الديسكورد'], 'discord'],
  [['فوتوشوب', 'الفوتوشوب'], 'photoshop'],
  [['اوتلوك', 'الاوتلوك', 'البريد اوتلوك'], 'outlook'],
  [['ون نوت', 'وان نوت', 'الون نوت'], 'onenote'],
  [['سكايب', 'السكايب'], 'skype'],
  [['ستيم', 'الستيم'], 'steam'],
  [['في ال سي', 'فلك', 'في ال سي بلاير'], 'vlc'],
  [['اكروبات', 'ادوبي ريدر', 'اكروبات ريدر', 'ريدر'], 'acrobat'],
  [['فيجوال ستوديو كود', 'في اس كود', 'فيجوال كود'], 'visual studio code'],
  [['فيجوال ستوديو'], 'visual studio'],
  [['بايثون'], 'python'],
  [['كانفا', 'الكانفا'], 'canva'],
  [['واتساب', 'الواتساب', 'الواتس'], 'whatsapp'],
  [['تيك توك', 'التيك توك'], 'tiktok'],
  [['نتفلكس', 'نتفليكس'], 'netflix'],
  [['انستقرام', 'انستغرام', 'الانستا', 'انستا'], 'instagram'],
  [['اكس بوكس', 'الاكس بوكس'], 'xbox'],
  [['ماين كرافت', 'ماينكرافت'], 'minecraft'],
  [['روبلوكس'], 'roblox'],
  [['فورتنايت'], 'fortnite'],
  [['بلندر'], 'blender'],
  [['او بي اس', 'اوبس'], 'obs'],
  [['كاب كت', 'كاب كات'], 'capcut'],
  [['شات جي بي تي', 'تشات جي بي تي'], 'chatgpt'],
  [['كلود'], 'claude'],
  [['البريد', 'الايميل', 'الميل'], 'mail'],
  [['التقويم', 'الكالندر'], 'calendar'],
  [['الكاميرا', 'الكامرا'], 'camera'],
  [['الخرائط', 'الخريطه'], 'maps'],
  [['المتجر', 'متجر مايكروسوفت', 'الستور'], 'store'],
  [['الطقس'], 'weather'],
  [['مسجل الصوت', 'المسجل'], 'sound recorder'],
  [['اداه القص', 'اداة القص', 'سنيبنج تول', 'القصاصه'], 'snipping tool'],
  [['لوحه التحكم', 'لوحة التحكم', 'كنترول بانل'], 'control panel'],
  [['مدير المهام', 'تاسك مانجر'], 'task manager'],
  [['موجه الاوامر', 'السي ام دي', 'سي ام دي'], 'command prompt'],
  [['باورشيل', 'البورشيل', 'بور شيل'], 'powershell'],
  [['جوجل كروم', 'كروم'], 'chrome'],
  [['ايدج', 'مايكروسوفت ايدج'], 'edge'],
  [['فايرفوكس', 'فاير فوكس'], 'firefox'],
  [['اوفيس'], 'office'],
  [['اكسبلورر'], 'explorer'],
  [['جيت هب', 'جيت هاب', 'قيت هب'], 'github'],
  [['ميديا بلاير', 'مشغل الوسائط'], 'media player'],
].map(([ar, en]) => [ar.map(normalize), en]);

// Arabic letters → rough sound classes shared with English letters.
const AR_CLASS = {
  'ب': 'B', 'ت': 'T', 'ث': 'S', 'ج': 'J', 'ح': 'H', 'خ': 'K', 'د': 'T', 'ذ': 'S', 'ر': 'R', 'ز': 'S', 'س': 'S', 'ش': 'X',
  'ص': 'S', 'ض': 'T', 'ط': 'T', 'ظ': 'S', 'ع': '', 'غ': 'K', 'ف': 'F', 'ق': 'K', 'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N',
  'ه': 'H', 'و': '', 'ي': '', 'ا': '', 'ء': '', 'ة': '',
};
const EN_DIGRAPH = [['sh', 'X'], ['ch', 'X'], ['th', 'S'], ['ph', 'F'], ['ck', 'K'], ['qu', 'K']];
const EN_CLASS = {
  b: 'B', p: 'B', t: 'T', d: 'T', s: 'S', z: 'S', c: 'K', k: 'K', q: 'K', g: 'K', x: 'KS', j: 'J', h: 'H', r: 'R',
  f: 'F', v: 'F', l: 'L', m: 'M', n: 'N', w: '', y: '', a: '', e: '', i: '', o: '', u: '',
};

/** Consonant skeleton of Arabic text («سبوتيفاي» → «SBTF»). */
export function arabicSkeleton(text) {
  return [...normalize(text).replace(/^ال/, '').replace(/\s+/g, '')].map((ch) => AR_CLASS[ch] ?? '').join('');
}

/** Consonant skeleton of English text («Spotify» → «SBTF»). */
export function latinSkeleton(text) {
  let s = String(text).toLowerCase().replace(/[^a-z]/g, '');
  for (const [d, c] of EN_DIGRAPH) s = s.split(d).join(c.toLowerCase() === c ? c : `\u0000${c}`);
  return [...s].map((ch) => (ch === '\u0000' ? '' : /[A-Z]/.test(ch) ? ch : EN_CLASS[ch] ?? '')).join('');
}

const STOP = /(uninstall|help|readme|documentation|website|license|release notes|manual|update|setup|repair|إلغاء التثبيت)/i;

/**
 * @param {string} spoken what the person called it (Arabic or English)
 * @param {Array<{name: string, id: string}>} apps installed programs (Start menu list)
 * @returns {{name: string, id: string} | null}
 */
export function matchInstalled(spoken, apps) {
  const usable = (apps || []).filter((a) => a && typeof a.name === 'string' && a.name && !STOP.test(a.name));
  const raw = String(spoken || '').trim();
  if (!raw || !usable.length) return null;
  const norm = normalize(raw).replace(/^(برنامج|تطبيق|لعبه|لعبة) /, '');
  const lower = (s) => s.toLowerCase();
  const byShortName = (list) => list.sort((a, b) => a.name.length - b.name.length)[0] || null;

  // 1. Typed in English: «افتح Spotify».
  const latin = lower(raw.replace(/[^\p{Script=Latin}\d+ ]/gu, ' ').replace(/\s+/g, ' ').trim());
  if (latin.length >= 2) {
    const exact = usable.filter((a) => lower(a.name) === latin);
    if (exact.length) return byShortName(exact);
    const words = usable.filter((a) => lower(a.name).split(/[^a-z0-9+]+/).includes(latin) || lower(a.name).startsWith(latin));
    if (words.length) return byShortName(words);
  }
  // 2. A well-known Arabic name.
  for (const [names, en] of KNOWN_APP_WORDS) {
    if (names.includes(norm) || names.includes(norm.replace(/^ال/, ''))) {
      const hits = usable.filter((a) => lower(a.name).includes(en));
      if (hits.length) return byShortName(hits);
    }
  }
  // 3. Sound skeleton: «سبوتيفاي» ≈ «Spotify».
  const sk = arabicSkeleton(norm);
  if (sk.length < 2) return null;
  let best = null;
  for (const app of usable) {
    for (const part of [app.name, ...app.name.split(/\s+/)]) {
      const ls = latinSkeleton(part);
      if (ls.length < 2) continue;
      const d = levenshtein(sk, ls);
      const limit = sk.length >= 5 ? 1 : 0;
      if (d <= limit && (!best || d < best.d || (d === best.d && app.name.length < best.app.name.length))) best = { app, d };
    }
  }
  return best ? best.app : null;
}
