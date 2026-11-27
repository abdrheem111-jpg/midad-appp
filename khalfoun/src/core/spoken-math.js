// Maths said out loud («حل اثنين س زائد ثلاثة يساوي احدعش») into symbols («2س + 3 = 11»), so the
// fast local layer can hand it to the maths engine without asking Claude. Works on normalized
// text (normalize(): ة→ه, ى→ي, أ→ا...).

const ONES = {
  صفر: 0, واحد: 1, واحده: 1, اثنين: 2, ثنين: 2, اثنان: 2, ثلاث: 3, ثلاثه: 3, ثلاثة: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5,
  ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثماني: 8, ثمانيه: 8, ثمنيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10,
  احدعش: 11, احدعشر: 11, حدعش: 11, اثنعش: 12, اطنعش: 12, اثناعشر: 12, ثلطعش: 13, ثلاثطعش: 13, اربعطعش: 14, خمسطعش: 15,
  سطعش: 16, ستطعش: 16, سبعطعش: 17, ثمنطعش: 18, تسعطعش: 19, مية: 100, ميه: 100, مايه: 100, مائه: 100,
};
const TENS = { عشرين: 20, ثلاثين: 30, اربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تسعين: 90 };
const WORDS = [
  [/(?<=\s)(?:زائد|زايد|زاد|plus)(?=\s)/g, ' + '], [/(?<=\s)(?:ناقص|ناقصه|سالب|minus)(?=\s)/g, ' - '],
  [/(?<=\s)(?:ضرب|مضروب في|مضروبه في|في)(?=\s)/g, ' * '], [/(?<=\s)(?:على|مقسوم على|مقسومه على|قسمه)(?=\s)/g, ' / '],
  [/(?<=\s)(?:اكبر من او يساوي)(?=\s)/g, ' >= '], [/(?<=\s)(?:اصغر من او يساوي)(?=\s)/g, ' <= '], [/(?<=\s)(?:يساوي|تساوي|يسوي|=)(?=\s)/g, ' = '],
  [/(?<=\s)(?:اكبر من)(?=\s)/g, ' > '], [/(?<=\s)(?:اصغر من|اقل من)(?=\s)/g, ' < '],
  [/(?<=\s)(?:تربيع|اس اثنين|للقوه الثانيه)(?=\s)/g, ' ^2 '], [/(?<=\s)(?:تكعيب|اس ثلاثه|للقوه الثالثه)(?=\s)/g, ' ^3 '],
  [/(?<=\s)(?:جذر)(?=\s)/g, ' √ '], [/(?<=\s)(?:قوس)(?=\s)/g, ' ( '], [/(?<=\s)(?:سكر القوس|نهايه القوس)(?=\s)/g, ' ) '],
];

/** Letters made comparable (ة→ه, ى→ي, أ→ا, no tashkeel) while every maths symbol stays. */
export function light(text) {
  return String(text || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
}

/** «خمسه وعشرين» → 25, «ثلاثه» → 3, «12» → 12 */
function numberOf(tokens, i) {
  const t = tokens[i];
  if (/^\d+(?:\.\d+)?$/.test(t)) return [Number(t), 1];
  if (t in TENS) return [TENS[t], 1];
  if (t in ONES) {
    const a = ONES[t];
    const n = tokens[i + 1];
    if (n && n.startsWith('و') && n.slice(1) in TENS && a < 10) return [a + TENS[n.slice(1)], 2];
    return [a, 1];
  }
  return null;
}

/** @returns {string|null} the maths in symbols, or null when the words are not maths */
export function spokenToMath(text) {
  let t = ` ${light(text).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/([=+\-*/^<>()√×÷−])/g, ' $1 ')} `;
  for (const [re, sym] of WORDS) t = t.replace(re, sym).replace(re, sym);
  // «س تربيع» etc. already symbols; numbers in words → digits
  const tokens = t.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const n = numberOf(tokens, i);
    if (n) { out.push(String(n[0])); i += n[1]; continue; }
    out.push(tokens[i]); i += 1;
  }
  const s = out.join(' ').replace(/\s*\^\s*/g, '^').replace(/(\d)\s+(س|ص)/g, '$1$2').replace(/\s+([²³])/g, '$1').replace(/\s+/g, ' ').trim();
  // it must look like maths: an unknown or a number, and an operator or «=»
  if (!/[سصxy\d]/.test(s) || !/[=+\-*/^<>√]|\d\s*س|س/.test(s)) return null;
  if (/[؀-ۿ]/.test(s.replace(/[سص]/g, ''))) return null; // other Arabic words left: not pure maths
  return s;
}

/** «حل …», «حلل …», «بسط …», «احسب …», «اشتق …»: which task, and the maths after the verb. */
export function mathCommand(text) {
  const explain = /^(?:يا خلفون\s+)?اشرح(?:\s+لي)?(?:\s+كيف)?\s+/.test(light(text));
  const src = light(text).replace(/^(?:يا خلفون\s+)?اشرح(?:\s+لي)?(?:\s+كيف)?\s+(?:نحل\s+|حل\s+)?/, 'حل ');
  const m = /^(?:يا خلفون\s+)?(حل|حلها|حللي|حلل|فكك|بسط|اختصر|احسب|اشتق|كامل|تحقق من)\s+(?:المعادله|المتباينه|المساله|العباره|الكسر|النظام|الداله)?\s*(.+)$/.exec(src);
  if (!m) return null;
  const verb = m[1];
  const task = /^(حلل|فكك)$/.test(verb) ? 'factor' : /^(بسط|اختصر)$/.test(verb) ? 'simplify' : verb === 'احسب' ? 'evaluate' : verb === 'اشتق' ? 'derivative' : verb === 'كامل' ? 'integral' : 'solve';
  const expr = spokenToMath(m[2]);
  return expr ? { task, expr, explain } : null;
}
