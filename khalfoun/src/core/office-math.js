// Spoken maths to written maths, and Arabic digits.
//   «س زائد اثنين يساوي خمسة» → «س + ٢ = ٥»
//   «ثلاثة على أربعة» → «٣/٤», «س تربيع» → «س²», «جذر تسعة» → «√٩»
// Teachers in Oman write maths with Arabic (Eastern) digits in the early grades, so that is the default.

import { normalize } from './arabic.js';

const AR = '٠١٢٣٤٥٦٧٨٩';
export const toArabicDigitsAll = (s) => String(s).replace(/[0-9]/g, (d) => AR[d]);
export const toLatinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));

const ONES = { صفر: 0, واحد: 1, وحده: 1, اثنين: 2, اثنان: 2, ثنين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, ثماني: 8, تسع: 9, تسعه: 9 };
const TEENS = { عشر: 10, عشره: 10, احدعش: 11, احدعشر: 11, اثنعش: 12, اثنعشر: 12, ثلطعش: 13, ثلاثطعش: 13, اربعطعش: 14, خمسطعش: 15, ستطعش: 16, سبعطعش: 17, ثمنطعش: 18, تسعطعش: 19 };
const TENS = { عشرين: 20, ثلاثين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تسعين: 90 };
const BIG = { ميه: 100, مايه: 100, مية: 100, ميتين: 200, الف: 1000, الفين: 2000 };

/** Operators said aloud → symbols (normalized words). Longer phrases first. */
const OPS = [
  ['اكبر من او يساوي', '≥'], ['اصغر من او يساوي', '≤'], ['لا يساوي', '≠'], ['ما يساوي', '≠'],
  ['اكبر من', '>'], ['اصغر من', '<'], ['يساوي', '='], ['تساوي', '='], ['يسوي', '='],
  ['زائد', '+'], ['زايد', '+'], ['زاد', '+'], ['جمع', '+'],
  ['ناقص', '−'], ['ناقصه', '−'], ['سالب', '−'], ['طرح', '−'],
  ['ضرب', '×'], ['في', '×'], ['مضروب في', '×'], ['مضروبه في', '×'],
  ['تقسيم', '÷'], ['قسمه', '÷'], ['مقسوم على', '÷'], ['قسمه على', '÷'],
  ['على', '/'], ['من', '/'],
  ['تربيع', '²'], ['اس اثنين', '²'], ['تكعيب', '³'], ['اس ثلاثه', '³'],
  ['جذر', '√'], ['الجذر التربيعي ل', '√'], ['الجذر التربيعي', '√'],
  ['فاصله', '٫'], ['نقطه', '٫'], ['بالميه', '٪'], ['في الميه', '٪'], ['بالمايه', '٪'],
  ['قوس', '('], ['افتح قوس', '('], ['سكر قوس', ')'], ['اقفل قوس', ')'],
  ['باي', 'π'],
];
for (const op of OPS) op[0] = normalize(op[0]);
OPS.sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

/** Variable names said aloud (Arabic letters used in Omani maths books, and «إكس»). */
const VARS = { س: 'س', ص: 'ص', ع: 'ع', ل: 'ل', م: 'م', ن: 'ن', ك: 'ك', اكس: 'x', واي: 'y', زد: 'z', سين: 'س', صاد: 'ص', عين: 'ع' };

/** Reads a number said in words at position i; returns [value, wordsUsed] or null. */
function numberAt(words, i) {
  const w = words[i];
  if (/^[0-9٠-٩]+(?:[.,٫][0-9٠-٩]+)?$/.test(w)) return [toLatinDigits(w).replace(/[,٫]/, '.'), 1];
  const part = (x) => ONES[x] ?? TEENS[x] ?? TENS[x] ?? BIG[x] ?? null;
  const first = part(w);
  if (first === null) return null;
  // «خمسه وعشرين», «ميه وخمسين»: further parts join with «و»; «ثلاثه اربعه» are two numbers.
  let total = first;
  let used = 1;
  while (i + used < words.length) {
    const x = words[i + used];
    const v = x.length > 1 && x.startsWith('و') ? part(x.slice(1)) : null;
    if (v === null) break;
    total += v;
    used += 1;
  }
  return [String(total), used];
}

/**
 * Turns spoken maths into written maths. Words that are not maths stay as they are.
 * @param {string} spoken
 * @param {{digits?: 'arabic'|'latin'}} [opts]
 */
export function spokenMath(spoken, opts = {}) {
  // Symbols already written («٣/٤ + ١») stay; words are normalized one by one.
  const SYM = /([=+\-−×÷*/<>≤≥≠²³√()٪%^.,٫])/;
  const words = String(spoken).replace(/[؟?!،]/g, ' ').split(SYM).flatMap((piece) => (SYM.test(piece) ? [piece] : normalize(piece).split(/\s+/))).filter(Boolean)
    .map((w) => ({ '*': '×', '-': '−', '%': '٪', '^': '²', ',': '٫', '.': '٫' }[w] || w));
  const out = [];
  for (let i = 0; i < words.length;) {
    const n = numberAt(words, i);
    if (n) { out.push(n[0]); i += n[1]; continue; }
    let hit = null;
    for (const [phrase, sym] of OPS) {
      const p = phrase.split(' ');
      if (words.slice(i, i + p.length).join(' ') === phrase) { hit = [sym, p.length]; break; }
    }
    if (hit) { out.push(hit[0]); i += hit[1]; continue; }
    if (VARS[words[i]]) { out.push(VARS[words[i]]); i += 1; continue; }
    out.push(words[i]);
    i += 1;
  }
  let s = out.join(' ')
    .replace(/\s*([²³٪])/g, '$1')
    .replace(/√\s+/g, '√')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/(\S+)\s*\/\s*(\S+)/g, '$1/$2')
    .replace(/(\d)\s*٫\s*(\d)/g, '$1٫$2')
    .replace(/\s+/g, ' ').trim();
  if ((opts.digits || 'arabic') === 'arabic') s = toArabicDigitsAll(s).replace(/(\d)\.(\d)/g, '$1٫$2');
  return s;
}

/** Does this look like maths (has an operator and something to operate on)? */
export function looksLikeMath(text) {
  const s = spokenMath(text);
  return /[=+−×÷<>≤≥≠²³√/]/.test(s) && /[0-9٠-٩سصعxyzπ]/.test(s);
}

/**
 * Office's «linear format» for an equation (Word builds it up into a real equation):
 * our symbols → ones Word's maths engine understands.
 */
export function linearMath(written) {
  return String(written).replace(/−/g, '-').replace(/÷/g, '÷').replace(/√(\S+)/g, '√($1)').replace(/(\S+)\/(\S+)/g, '($1)/($2)');
}
