// How Khalfoun says words, so the voice does not stumble:
//   • a pronunciation dictionary: English names (PDF, Word, Excel), Omani words a standard
//     Arabic voice misreads (تو، وايد، مب، شوي), school and maths words, and his own name —
//     each written the way it should sound, with just the vowels that matter;
//   • the teacher's own corrections («انطق الطابعة كذا: الطّابِعَة»), which always win;
//   • the natural stop at the end of a sentence (وقف): no case ending is read before a pause,
//     as an Arab speaker says it («شكراً» → «شكرا»، «الحصةُ.» → «الحصة.»).
// Only the voice uses this: the bubble shows the words as written.

import { normalize } from './arabic.js';

const TASHKEEL = /[ً-ْٰـ]/g;
const bare = (w) => String(w || '').replace(TASHKEEL, '');

/** The built-in dictionary: written word (as normalize() makes it) → how to say it. */
export const BUILTIN = {
  // his name and the apps the teacher uses
  خلفون: 'خَلْفُون',
  pdf: 'بي دي إف', word: 'وُورْد', excel: 'إكْسِل', powerpoint: 'باوَرْ بوينْت', claude: 'كْلُود', azure: 'أَزُور',
  windows: 'وِنْدُوز', google: 'جُوجِل', youtube: 'يُوتْيُوب', whatsapp: 'وَاتْسَاب', teams: 'تِيمْز', zoom: 'زُوم', excelfile: 'مَلَف إكْسِل',
  ok: 'أُوكِي', wifi: 'وَاي فَاي', usb: 'يُو إس بي', qr: 'كْيُو آر', geogebra: 'جِيوجِبْرا', ai: 'إيه آي',
  الوورد: 'الوُورْد', وورد: 'وُورْد', الاكسل: 'الإكْسِل', اكسل: 'إكْسِل', البوربوينت: 'البَاوَرْ بوينْت', بوربوينت: 'بَاوَرْ بوينْت',
  الويندوز: 'الوِنْدُوز', ويندوز: 'وِنْدُوز', يوتيوب: 'يُوتْيُوب', جوجل: 'جُوجِل', واتساب: 'وَاتْسَاب', الواتساب: 'الوَاتْسَاب',
  // Omani everyday words that a standard voice reads wrongly
  تو: 'تُو', توه: 'تُوَّه', وايد: 'وَايِد', مب: 'مُب', مو: 'مُو', شوي: 'شْوَي', شويه: 'شْوَيَّة', زين: 'زِين', عاد: 'عَاد',
  يلا: 'يَلَّا', يالله: 'يَا اللّٰه', هلا: 'هَلَا', ابشر: 'أَبْشِر', ابشري: 'أَبْشِرِي', عشان: 'عَشَان', بعدين: 'بَعْدِين',
  ليش: 'لِيش', وين: 'وِين', شو: 'شُو', ايش: 'إيش', كذا: 'كِذَا', جذي: 'جِذِي', حق: 'حَقّ', ترى: 'تَرَى', خلاص: 'خَلَاص',
  بس: 'بَسّ', كفو: 'كَفُو', عساك: 'عَسَاك', ماشاء: 'مَا شَاء', وايدين: 'وَايْدِين', الحين: 'الحِين', هني: 'هْنِي', هناك: 'هْنَاك',
  تعال: 'تَعَال', روح: 'رُوح', سويت: 'سَوَّيت', سوي: 'سَوِّي', اسوي: 'أَسَوِّي', يسوي: 'يْسَوِّي', نسوي: 'نْسَوِّي',
  // school and maths words
  حصه: 'حِصَّة', الحصه: 'الحِصَّة', معلم: 'مُعَلِّم', المعلم: 'المُعَلِّم', الطلاب: 'الطُّلَّاب', طالب: 'طَالِب', الصف: 'الصَّفّ',
  رياضيات: 'رِيَاضِيَّات', الرياضيات: 'الرِّيَاضِيَّات', معادله: 'مُعَادَلَة', المعادله: 'المُعَادَلَة', متباينه: 'مُتَبَايِنَة', المتباينه: 'المُتَبَايِنَة',
  مجهول: 'مَجْهُول', المجهول: 'المَجْهُول', البسط: 'البَسْط', المقام: 'المَقَام', الجذر: 'الجَذْر', تربيع: 'تَرْبِيع', تكعيب: 'تَكْعِيب',
  الداله: 'الدَّالَّة', داله: 'دَالَّة', المنحني: 'المُنْحَنَى', المستقيم: 'المُسْتَقِيم', الميل: 'المَيْل', المحور: 'المِحْوَر',
  سين: 'سِين', صاد: 'صَاد', يساوي: 'يُسَاوِي', ناقص: 'نَاقِص', زائد: 'زَائِد', ضرب: 'ضَرْب', قسمه: 'قِسْمَة', سالب: 'سَالِب', موجب: 'مُوجَب',
  اس: 'أُسّ', الاس: 'الأُسّ', كسر: 'كَسْر', الكسر: 'الكَسْر', عشري: 'عُشْرِي', المثلث: 'المُثَلَّث', مثلث: 'مُثَلَّث', الزاويه: 'الزَّاوِيَة',
  المساحه: 'المِسَاحَة', المحيط: 'المُحِيط', الوتر: 'الوَتَر', فيثاغورس: 'فِيثَاغُورْس', المميز: 'المُمَيِّز', الحل: 'الحَلّ', حلول: 'حُلُول',
  // praise
  احسنت: 'أَحْسَنْت', ممتاز: 'مُمْتَاز', برافو: 'بْرَافُو', صح: 'صَحّ', غلط: 'غَلَط', نجمه: 'نَجْمَة', بطل: 'بَطَل',
};

// prefixes kept in front of a known word: and / with / for / the…
const PREFIXES = ['وبال', 'وال', 'بال', 'فال', 'كال', 'ولل', 'لل', 'وب', 'ول', 'و', 'ف', 'ب', 'ل'];

/** The key a word is looked up by: no vowels, normalized letters, Latin in lower case. */
export function wordKey(w) {
  const b = bare(w);
  return /^[A-Za-z]+$/.test(b) ? b.toLowerCase() : normalize(b);
}

/**
 * The teacher's dictionary wins over the built-in one. A word with a prefix (و، ب، ل، ال)
 * keeps it: «والمعادلة» → «و» + «المُعَادَلَة».
 * @param {string} text
 * @param {Record<string, string>} [mine] the teacher's corrections (key: wordKey(word))
 */
export function applyLexicon(text, mine = {}) {
  const dict = { ...BUILTIN, ...(mine || {}) };
  return String(text || '').replace(/[\p{L}\p{M}]+/gu, (w) => {
    const k = wordKey(w);
    if (dict[k]) return dict[k];
    for (const p of PREFIXES) {
      if (!k.startsWith(p) || k.length <= p.length + 1) continue;
      const rest = k.slice(p.length);
      if (p.endsWith('لل')) { const hit = dict[`ال${rest}`]; if (hit) return `${p.slice(0, -2)}لِل${hit.replace(/^ال/, '')}`; continue; }
      if (p.endsWith('ال')) { const hit = dict[`ال${rest}`]; if (hit) return `${p.slice(0, -2)}${hit}`; continue; }
      const hit = dict[rest];
      if (hit) return `${p}${hit}`;
    }
    return w;
  });
}


/**
 * The stop before a pause (الوقف): the last word of each sentence or clause loses its case
 * ending, as a speaker says it. «ذَهَبَ الطَّالِبُ.» → «ذَهَبَ الطَّالِب.»
 */
export function pausal(text) {
  return String(text || '').replace(/([\p{L}\p{M}]+)(?=\s*(?:[.!?؟،,؛:…\n]|$))/gu, (w) => {
    if (/[ً]$/.test(w) && /ا[ً]$|[ً]ا$/.test(w)) return w.replace(/[ً]/g, ''); // شكراً → شكرا
    // the last letter's vowel goes, its shadda stays (whichever order the marks are stored in)
    return w.replace(/[\u064B-\u0650\u0652]*(\u0651?)[\u064B-\u0650\u0652]*$/, '$1');
  });
}

/** Everything the voice needs, in order: the dictionary, then the natural stops. */
export function forVoice(text, mine) {
  return pausal(applyLexicon(text, mine));
}

/**
 * «انطق الطابعة كذا: الطّابِعَة» / «قل كلمة X مثل Y» / «X تنقال Y» → a correction to keep.
 * @returns {{word: string, say: string}|null}
 */
export function pronounceCommand(text) {
  const t = String(text || '').trim().replace(/^يا خلفون[،,]?\s*/, '');
  const m = /^(?:انطق|قول|قل|اقرا|اقرأ)\s+(?:كلمه|كلمة)?\s*«?([^«»:]{1,30}?)»?\s*(?:كذا|هكذا|مثل|زي|بهالشكل|بهذا الشكل)\s*:?\s*«?([^«»]{1,40})»?$/.exec(t)
    || /^«?([^«»]{1,30}?)»?\s+(?:تنقال|تنطق|تنقرا|تنقرأ|نطقها)\s*:?\s*«?([^«»]{1,40})»?$/.exec(t);
  if (!m) return null;
  const word = m[1].trim(); const say = m[2].trim();
  if (!word || !say || wordKey(word) === wordKey(say) && bare(say) === say) return null;
  return { word, say };
}

/** «كيف تنطق X؟» → X */
export function howDoYouSay(text) {
  const m = /^(?:يا خلفون[،,]?\s*)?(?:كيف|شلون)\s+(?:تنطق|تقول|تقرا|تقرأ)\s+(?:كلمه|كلمة)?\s*«?([^«»؟?]{1,40})»?\s*[؟?]?$/.exec(String(text || '').trim());
  return m ? m[1].trim() : null;
}
