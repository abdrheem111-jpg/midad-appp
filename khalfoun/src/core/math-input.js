// The teacher's maths, as said or written («٢س + ٣ = ١١», «حلل س² − ٩», «2x+y=7، x−y=2»), made into
// the plain form the maths engine reads — and nothing else gets through: only digits, the
// unknowns, a few letters for parameters, operators and a fixed list of functions. This is the
// first of two checks (the solver checks again before it parses).

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const SUPERS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
const AR_FUNCS = [['جتا', 'cos'], ['جا', 'sin'], ['ظا', 'tan'], ['جذر', 'sqrt'], ['لو', 'log'], ['لن', 'ln'], ['مطلق', 'abs']];
const AR_LETTERS = { س: 'x', ص: 'y', ع: 'z', أ: 'a', ا: 'a', ب: 'b', ج: 'c', ك: 'k', م: 'm', ن: 'n' };
const FUNCS = ['sqrt', 'sin', 'cos', 'tan', 'log', 'ln', 'abs', 'pi'];
const LETTERS = 'xyzabckmn';

export const MATH_TASKS = ['solve', 'inequality', 'factor', 'simplify', 'system', 'check', 'evaluate', 'derivative', 'integral'];

/**
 * @param {string} src
 * @returns {{ok: true, expr: string}|{ok: false, error: string}}
 */
export function toEngine(src) {
  let t = String(src || '').trim();
  if (!t || t.length > 300) return { ok: false, error: 'المسألة فاضية أو طويلة' };
  t = t.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/٫/g, '.').replace(/[،؛]/g, ',');
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^(${[...m].map((c) => SUPERS[c]).join('')})`);
  t = t.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').replace(/√/g, 'sqrt').replace(/π/g, 'pi');
  t = t.replace(/≤|=<|⩽/g, '<=').replace(/≥|=>|⩾/g, '>=').replace(/\*\*/g, '^');
  t = t.replace(/د\s*\(\s*س\s*\)/g, 'f(x)'); // د(س) = …  →  the right-hand side is the function
  t = t.replace(/^\s*(?:f\s*\(\s*x\s*\)|ص|y)\s*=\s*(?=[^=]*$)/, ''); // «ص = 2س+1» alone means the expression
  for (const [ar, en] of AR_FUNCS) t = t.split(ar).join(` ${en} `);
  t = t.replace(/[سصعأابجكمن]/g, (c) => ` ${AR_LETTERS[c]} `);
  t = t.replace(/[ً-ْـ]/g, ''); // tashkeel and tatweel
  // letter runs: a function name stays whole, anything else must be known single letters (2ax → 2 a x)
  let bad = null;
  t = t.replace(/[A-Za-z]+/g, (w) => {
    const lw = w.toLowerCase();
    if (FUNCS.includes(lw) || lw === 'e') return ` ${lw} `;
    if ([...lw].every((c) => LETTERS.includes(c))) return ` ${[...lw].join(' ')} `;
    bad ??= w;
    return '';
  });
  if (bad) return { ok: false, error: `ما أعرف «${bad}» في المسائل` };
  t = t.replace(/\s+/g, ' ').trim();
  if (!/^(?:\d+(?:\.\d+)?|[xyzabckmn]|sqrt|sin|cos|tan|log|ln|abs|pi|e|<=|>=|[-+*/^()=<>,|.\s])+$/.test(t)) return { ok: false, error: 'فيها رموز ما أعرفها' };
  if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) return { ok: false, error: 'الأقواس ناقصة' };
  return { ok: true, expr: t };
}

/** Which task a sentence asks for, when the teacher says it in words («حلل…», «بسّط…», «تحقق…»). */
export function taskFromWords(normalized) {
  const t = String(normalized || '');
  if (/(حلل|حللها|تحليل|فكك)/.test(t)) return 'factor';
  if (/(بسط|اختصر|تبسيط)/.test(t)) return 'simplify';
  if (/(اشتق|مشتقه|المشتقه)/.test(t)) return 'derivative';
  if (/(كامل|تكامل)/.test(t)) return 'integral';
  if (/(احسب|كم ناتج|ناتج)/.test(t)) return 'evaluate';
  return 'solve';
}
