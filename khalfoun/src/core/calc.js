// Arithmetic said the Omani way: «كم ٢٥ ضرب ٤», «احسب ١٥٪ من ٢٠٠»،
// «جذر ٨١»، «ثلاثة زائد خمسة على اثنين». A small parser with the usual
// precedence; no eval, nothing but numbers and these operators.

import { toArabicDigits } from './arabic.js';
import { parseArabicNumber } from './quiz.js';

function norm(s) {
  return String(s)
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.').replace(/٪/g, '%').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
}

const OP_WORDS = [
  [['زائد', 'زايد', 'بلس'], '+'],
  [['ناقص', 'ناقس', 'مطروح', 'سالب', 'ماينس'], '-'],
  [['ضرب', 'ضربه', 'مضروب', 'مضروبه', 'في', 'اكس', 'تايمز'], '*'],
  [['على', 'عل', 'قسمه', 'تقسيم', 'مقسوم', 'مقسومه', 'قسمة'], '/'],
  [['اس', 'أس', 'للقوه', 'قوه'], '^'],
];
for (const entry of OP_WORDS) entry[0] = entry[0].map((w) => norm(w));
const POSTFIX = { 'تربيع': ['^', 2], 'مربع': ['^', 2], 'تكعيب': ['^', 3], 'مكعب': ['^', 3] };
const NUMBER_WORD = /^(و?(ال)?(صفر|واحد|وحده|اثنين|ثنين|اثنتين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|ثماني|تسع|تسعه|عشر|عشره|احدعش|احدعشر|اثنعش|اثناعشر|ثلطعش|ثلاثطعش|ثلاثه عشر|اربعطعش|خمسطعش|ستطعش|سبعطعش|ثمنطعش|تسعطعش|عشرين|ثلاثين|اربعين|خمسين|ستين|سبعين|ثمانين|تسعين|ميه|مية|مايه|مئه|ميتين|مئتين|ثلاثمية|ثلاثميه|اربعمية|خمسمية|الف|الفين|نص|ربع))$/;


/** Splits a spoken calculation into number and operator tokens, or null if it is not one. */
export function tokenizeCalc(text) {
  const s = norm(text).replace(/([+\-*/^%()])/g, ' $1 ').replace(/(\d)\s*,\s*(\d{3})\b/g, '$1$2');
  const words = s.split(/\s+/).filter(Boolean);
  const tokens = [];
  let wordRun = [];
  const flushWords = () => {
    if (!wordRun.length) return;
    const n = parseArabicNumber(wordRun.join(' ').replace(/(^| )نص( |$)/, ' ').trim() || 'صفر');
    const half = wordRun.some((w) => /^و?(ال)?نص$/.test(w)) ? 0.5 : 0;
    const quarter = wordRun.some((w) => /^و?(ال)?ربع$/.test(w)) ? 0.25 : 0;
    const onlyFraction = wordRun.every((w) => /^و?(ال)?(نص|ربع)$/.test(w));
    tokens.push({ num: onlyFraction ? half + quarter : (n ?? 0) + half + quarter });
    wordRun = [];
  };
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (/^\d+(\.\d+)?$/.test(w)) { flushWords(); tokens.push({ num: Number(w) }); continue; }
    if (NUMBER_WORD.test(w)) { wordRun.push(w); continue; }
    flushWords();
    if ('+-*/^%()'.includes(w) && w.length === 1) { tokens.push({ op: w }); continue; }
    if (/^(بالميه|بالمية|بالمئه|بالمائه|في المية|بالمئة)$/.test(w)) { tokens.push({ op: '%' }); continue; }
    if (w === 'المية' || w === 'الميه') continue; // «في المية» second word
    if (POSTFIX[w]) { tokens.push({ op: POSTFIX[w][0] }, { num: POSTFIX[w][1] }); continue; }
    if (/^(جذر|الجذر)$/.test(w)) { tokens.push({ op: 'sqrt' }); if (words[i + 1] === 'التربيعي' || words[i + 1] === 'تربيعي') i += 1; continue; }
    if (w === 'من' && tokens.at(-1)?.op === '%') { tokens.push({ op: '*' }); continue; }
    const op = OP_WORDS.find(([list]) => list.includes(w));
    if (op) {
      // «مطروح منه», «مقسوم على», «مضروب في»: skip the little word after
      if (['مطروح', 'مقسوم', 'مقسومه', 'مضروب', 'مضروبه'].includes(w) && ['من', 'منه', 'منها', 'علي', 'في'].includes(words[i + 1])) i += 1;
      tokens.push({ op: op[1] });
      continue;
    }
    if (/^(كم|احسب|حل|يساوي|تساوي|يطلع|شقد|قديش|ايش|وش|شو|ناتج|الناتج|حاصل|جواب|لي|يا|خلفون|و|=|؟|\?)$/.test(w)) continue;
    return null; // a word that is not part of a calculation
  }
  flushWords();
  const nums = tokens.filter((t) => 'num' in t).length;
  const ops = tokens.filter((t) => t.op && t.op !== '(' && t.op !== ')').length;
  if (!ops || (nums < 2 && !tokens.some((t) => t.op === 'sqrt' || t.op === '%'))) return null;
  return tokens;
}

/** Evaluates tokens with precedence: + - < * / < ^ < unary (√, −) < postfix %. */
export function evaluateTokens(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  function primary() {
    const t = take();
    if (!t) throw new Error('incomplete');
    if ('num' in t) {
      let v = t.num;
      while (peek()?.op === '%') { take(); v /= 100; }
      return v;
    }
    if (t.op === '(') { const v = sum(); if (take()?.op !== ')') throw new Error('paren'); return v; }
    if (t.op === '-') return -power();
    if (t.op === '+') return power();
    if (t.op === 'sqrt') { const v = power(); if (v < 0) throw new Error('domain'); return Math.sqrt(v); }
    throw new Error('unexpected');
  }
  function power() {
    const base = primary();
    if (peek()?.op === '^') { take(); return base ** power(); }
    return base;
  }
  function product() {
    let v = power();
    while (peek() && (peek().op === '*' || peek().op === '/')) {
      const op = take().op;
      const r = power();
      if (op === '/' && r === 0) throw new Error('div_zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (peek() && (peek().op === '+' || peek().op === '-')) {
      const op = take().op;
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  if (i !== tokens.length) throw new Error('trailing');
  if (!Number.isFinite(v)) throw new Error('overflow');
  return v;
}

/**
 * @param {string} text
 * @returns {{ok: true, value: number, text: string, expr: string} | {ok: false, error: string} | null}
 *   null when the text is not a calculation at all.
 */
export function calculate(text) {
  const tokens = tokenizeCalc(text);
  if (!tokens) return null;
  try {
    const value = evaluateTokens(tokens);
    return { ok: true, value, text: formatNumber(value), expr: formatExpr(tokens) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function formatNumber(v) {
  const rounded = Math.abs(v) >= 1e12 ? v : Math.round(v * 10000) / 10000;
  const s = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return toArabicDigits(s.replace('.', '٫'));
}

function formatExpr(tokens) {
  const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', '%': '٪', '(': '(', ')': ')', sqrt: '√' };
  return tokens.map((t) => ('num' in t ? formatNumber(t.num) : SYM[t.op])).join(' ').replace(/ ٪/g, '٪').replace(/√ /g, '√');
}
