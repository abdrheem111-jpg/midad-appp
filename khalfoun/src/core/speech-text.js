// Text as a fluent Arabic teacher would read it aloud. Claude writes its replies with tashkeel
// (for the voice); the bubble shows them without it. Maths symbols are read as words
// («س² = ٩» → «سين تربيع يساوي ٩»), and a long reply is read in whole sentences, one after
// another without gaps (the next sentence's audio is fetched while this one plays).

const TASHKEEL = /[ً-ْٰـ]/g; // harakat, tanween, shadda, sukun, dagger alif, tatweel

/** «مَرْحَبًا» → «مرحبا» (for the bubble). */
export const stripTashkeel = (t) => String(t || '').replace(TASHKEEL, '');

const SUPER = { '²': ' تربيع', '³': ' تكعيب', '¹': ' أس واحد', '⁴': ' أس أربعة', '⁵': ' أس خمسة', '⁻¹': ' أس سالب واحد' };
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const LETTER_NAMES = { س: 'سين', ص: 'صاد', ع: 'عين' };

/**
 * Maths symbols and numbers → spoken Arabic words. Only touches symbols; ordinary words are
 * left as they are.
 */
export function spokenMath(text) {
  let t = String(text || '');
  t = t.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/(\d)٫(\d)/g, '$1.$2'); // the voice reads Western digits most reliably
  t = t.replace(/(^|[\s(=])[−-](?=\d)/g, '$1سالب ');
  t = t.replace(/⁻¹/g, SUPER['⁻¹']).replace(/[²³¹⁴⁵]/g, (c) => SUPER[c]);
  t = t.replace(/\^\(?\s*(-?\d+)\s*\)?/g, (_, n) => (n === '2' ? ' تربيع' : n === '3' ? ' تكعيب' : ` أس ${n.replace('-', 'سالب ')}`));
  t = t.replace(/√\s*\(?/g, ' الجذر التربيعي لـ ').replace(/π/g, ' باي ').replace(/∞/g, ' ما لا نهاية ');
  t = t.replace(/(\d+)\s*\/\s*(\d+)/g, '$1 على $2');
  t = t.replace(/(\d)\s*%/g, '$1 بالمئة');
  t = t.replace(/(\d)\s*°/g, '$1 درجة');
  t = t.replace(/≠/g, ' لا يساوي ').replace(/≥/g, ' أكبر من أو يساوي ').replace(/≤/g, ' أصغر من أو يساوي ').replace(/±/g, ' زائد أو ناقص ');
  t = t.replace(/\s=\s|(?<=[\d؀-ۿa-z)])=(?=[\s\d؀-ۿa-z(])/gi, ' يساوي ');
  t = t.replace(/(?<=[\d)ء-يa-z]\s?)>(?=\s?[\d(ء-يa-z])/gi, ' أكبر من ').replace(/(?<=[\d)ء-يa-z]\s?)<(?=\s?[\d(ء-يa-z])/gi, ' أصغر من ');
  t = t.replace(/[×✕]|(?<=\d\s?)\*(?=\s?\d)/g, ' ضرب ').replace(/÷/g, ' قسمة ');
  t = t.replace(/\+/g, ' زائد ').replace(/(?<=[\d)]\s?)[−-](?=\s?[\d(سصع])|\s[−-]\s|−/g, ' ناقص ');
  t = t.replace(/(\d)([سصع])/g, '$1 $2');
  // a lone س / ص / ع in an equation is read as the letter's name
  t = t.replace(/(^|[\s(\d])([سصع])(?=[\s)\d]|$)/g, (m, pre, l) => `${pre}${LETTER_NAMES[l]}`);
  t = t.replace(/[()]/g, ' ');
  return t.replace(/\s{2,}/g, ' ').trim();
}

/**
 * A reply cut into sentences for the voice: each at most `max` characters, short pieces kept
 * together so it does not pause after every word.
 */
export function sentenceChunks(text, max = 240) {
  const parts = String(text || '').split(/(?<=[.!?؟…]|\n)\s+|(?<=،)\s+(?=\S{2,})/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (!cur) { cur = p; continue; }
    if (cur.length < 60 || (cur + ' ' + p).length <= max * 0.6) cur = `${cur} ${p}`;
    else { out.push(cur); cur = p; }
  }
  if (cur) out.push(cur);
  // a single very long sentence is cut at spaces
  return out.flatMap((s) => {
    if (s.length <= max) return [s];
    const words = s.split(' ');
    const res = [];
    let c = '';
    for (const w of words) { if ((c + ' ' + w).length > max && c) { res.push(c); c = w; } else c = c ? `${c} ${w}` : w; }
    if (c) res.push(c);
    return res;
  });
}

/** Azure's Arabic voices, as the teacher chooses them in settings (the first is the default). */
export const VOICE_CHOICES = [
  { id: 'ar-SA-HamedNeural', label: 'حامد: سعودي، أوضح نطق ★' },
  { id: 'ar-OM-AbdullahNeural', label: 'عبدالله: عُماني' },
  { id: 'ar-AE-HamdanNeural', label: 'حمدان: إماراتي' },
  { id: 'ar-KW-FahedNeural', label: 'فهد: كويتي' },
  { id: 'ar-EG-ShakirNeural', label: 'شاكر: مصري' },
  { id: 'ar-SA-ZariyahNeural', label: 'زارية: سعودية' },
  { id: 'ar-OM-AyshaNeural', label: 'عائشة: عُمانية' },
  { id: 'ar-AE-FatimaNeural', label: 'فاطمة: إماراتية' },
];
export const VOICE_IDS = VOICE_CHOICES.map((v) => v.id);
