// A small, safe reader for the functions the teacher graphs: «ص = ٢س² − ٣س + ١», «y = sin(x)»,
// «جا س», «أ س + ب». It never runs text as code: the expression becomes a tree of a few known
// operations, evaluated with numbers only.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, floor: Math.floor, round: Math.round,
};
// Arabic names: جا (sin), جتا (cos), ظا (tan), جذر, لو (log), لن (ln), مطلق (abs)
const AR_FUNCS = { جتا: 'cos', جا: 'sin', ظا: 'tan', جذر: 'sqrt', لو: 'log', لن: 'ln', مطلق: 'abs' };
const SUPERS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
/** Parameters he can name in Arabic or Latin; Arabic is turned into Latin inside. */
const AR_PARAMS = { أ: 'a', ا: 'a', ب: 'b', ج: 'c', د: 'd', ك: 'k', م: 'm', ن: 'n' };

/** Cleans what was written into the reader's own symbols. */
export function prepare(src) {
  let t = String(src || '').trim();
  t = t.replace(/^\s*(?:ص|y|f\s*\(\s*(?:x|س)\s*\)|د\s*\(\s*س\s*\))\s*=\s*/i, '');
  t = t.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/٫/g, '.').replace(/،/g, ',');
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^(${[...m].map((c) => SUPERS[c]).join('')})`);
  t = t.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/√/g, 'sqrt').replace(/π/g, 'pi');
  for (const [ar, en] of Object.entries(AR_FUNCS)) t = t.split(ar).join(` ${en} `);
  t = t.replace(/س/g, ' x ').replace(/[أابجدكمن]/g, (c) => ` ${AR_PARAMS[c]} `);
  return t.replace(/\s+/g, ' ').trim();
}

function tokenize(t) {
  const out = [];
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === ' ') { i += 1; continue; }
    const num = /^\d+(?:\.\d+)?|^\.\d+/.exec(t.slice(i));
    if (num) { out.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const word = /^[a-z]+/i.exec(t.slice(i));
    if (word) {
      const w = word[0].toLowerCase();
      if (FUNCS[w]) out.push({ k: 'fn', v: w });
      else if (w === 'pi') out.push({ k: 'num', v: Math.PI });
      else if (w === 'e') out.push({ k: 'num', v: Math.E });
      else for (const ch of w) out.push({ k: 'var', v: ch }); // «ax» = a·x
      i += w.length;
      continue;
    }
    if ('+-*/^(),|'.includes(c)) { out.push({ k: 'op', v: c }); i += 1; continue; }
    throw new Error(`ما فهمت «${c}»`);
  }
  return out;
}

/**
 * Parses into a tree. Grammar (implicit multiplication allowed: 2x, 3(x+1), x(x-1), 2sin x):
 *   expr := term (('+'|'-') term)* ; term := unary (('*'|'/')? unary)* ; unary := '-' unary | power
 *   power := atom ('^' unary)? ; atom := num | var | fn atom | '(' expr ')' | '|' expr '|'
 */
export function parse(src) {
  const toks = tokenize(prepare(src));
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { if (peek()?.v === v) { p += 1; return true; } return false; };
  const startsAtom = (t) => t && (t.k === 'num' || t.k === 'var' || t.k === 'fn' || t.v === '(' || t.v === '|');
  function expr() {
    let n = term();
    while (peek()?.k === 'op' && (peek().v === '+' || peek().v === '-')) { const op = toks[p++].v; n = { op, a: n, b: term() }; }
    return n;
  }
  function term() {
    let n = unary();
    for (;;) {
      if (peek()?.v === '*' || peek()?.v === '/') { const op = toks[p++].v; n = { op, a: n, b: unary() }; continue; }
      if (startsAtom(peek()) && !(peek().v === '|' && inAbs)) { n = { op: '*', a: n, b: power() }; continue; }
      return n;
    }
  }
  function unary() { if (eat('-')) return { op: 'neg', a: unary() }; if (eat('+')) return unary(); return power(); }
  function power() { const base = atom(); if (eat('^')) return { op: '^', a: base, b: unary() }; return base; }
  let inAbs = false;
  function atom() {
    const t = toks[p++];
    if (!t) throw new Error('الدالة ناقصة');
    if (t.k === 'num') return { num: t.v };
    if (t.k === 'var') return { v: t.v };
    if (t.k === 'fn') { if (peek()?.v === '(') return { fn: t.v, a: atom() }; return { fn: t.v, a: power() }; }
    if (t.v === '(') { const n = expr(); if (!eat(')')) throw new Error('قوس ناقص'); return n; }
    if (t.v === '|') { const was = inAbs; inAbs = true; const n = expr(); inAbs = was; if (!eat('|')) throw new Error('علامة القيمة المطلقة ناقصة'); return { fn: 'abs', a: n }; }
    throw new Error(`ما توقعت «${t.v}»`);
  }
  const tree = expr();
  if (p < toks.length) throw new Error(`ما فهمت «${toks[p].v}»`);
  return tree;
}

/** The value at x, with the parameters given ({a: 2, b: -1}); NaN where it does not exist. */
export function evaluate(tree, x, params = {}) {
  const ev = (n) => {
    if ('num' in n) return n.num;
    if ('v' in n) return n.v === 'x' ? x : n.v in params ? Number(params[n.v]) : 1;
    if (n.fn) return FUNCS[n.fn](ev(n.a));
    switch (n.op) {
      case '+': return ev(n.a) + ev(n.b);
      case '-': return ev(n.a) - ev(n.b);
      case '*': return ev(n.a) * ev(n.b);
      case '/': { const d = ev(n.b); return d === 0 ? NaN : ev(n.a) / d; }
      case '^': return ev(n.a) ** ev(n.b);
      case 'neg': return -ev(n.a);
      default: return NaN;
    }
  };
  const y = ev(tree);
  return Number.isFinite(y) ? y : NaN;
}

/** The parameters a function uses (other than x), e.g. ['a', 'b']. */
export function paramsOf(tree) {
  const out = new Set();
  const walk = (n) => { if (!n) return; if ('v' in n && n.v !== 'x') out.add(n.v); walk(n.a); walk(n.b); };
  walk(tree);
  return [...out];
}

/** Where the graph crosses the x axis in [x0, x1] (sign changes, refined). */
export function roots(tree, x0, x1, params = {}, n = 400) {
  const out = [];
  let px = x0; let py = evaluate(tree, x0, params);
  for (let i = 1; i <= n; i += 1) {
    const x = x0 + ((x1 - x0) * i) / n; const y = evaluate(tree, x, params);
    if (Number.isFinite(py) && Number.isFinite(y)) {
      if (py === 0) out.push(px);
      else if (py * y < 0 && Math.abs(y - py) < (Math.abs(y) + Math.abs(py)) * 4 + 1) {
        let a = px; let b = x; let fa = py;
        for (let k = 0; k < 40; k += 1) { const m = (a + b) / 2; const fm = evaluate(tree, m, params); if (fa * fm <= 0) b = m; else { a = m; fa = fm; } }
        out.push((a + b) / 2);
      }
    }
    px = x; py = y;
  }
  return out.filter((r, i) => i === 0 || Math.abs(r - out[i - 1]) > (x1 - x0) / 200).map((r) => Math.round(r * 1000) / 1000);
}

/** A tidy y range for the functions over [x0, x1] (outliers left out), and tick steps. */
export function autoRange(trees, x0, x1, params = {}) {
  const ys = [];
  for (const t of trees) for (let i = 0; i <= 200; i += 1) { const y = evaluate(t, x0 + ((x1 - x0) * i) / 200, params); if (Number.isFinite(y)) ys.push(y); }
  if (!ys.length) return [-10, 10];
  ys.sort((a, b) => a - b);
  let lo = ys[Math.floor(ys.length * 0.04)]; let hi = ys[Math.ceil(ys.length * 0.96) - 1];
  lo = Math.min(lo, 0); hi = Math.max(hi, 0);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

export function niceStep(span, target = 10) {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
