# Khalfoun's maths: SymPy computes, step by step, with the reason for each step in Arabic.
# Claude understands the request and explains; the numbers come from here, never from a guess.
#
# Input is already cleaned by core/math-input.js (only digits, x y z a b c k m n, + - * / ^ ( ) = < >
# <= >= , | . and sqrt sin cos tan log ln abs pi e). It is checked again here before parsing.
# Output: JSON {ok, task, answer, steps:[{expr, why}], check?, line?, roots?, error?}.
# Expressions come out in the plain form the page shows in Arabic (2x^2 - 3x + 1 → ٢س² − ٣س + ١).

import json
import re
from sympy import (Symbol, Integer, Float, Rational, sqrt, sin, cos, tan, log, Abs, pi, E, Eq, S, expand, factor,
                   cancel, together, fraction, solve, Poly, gcd, lcm, simplify, nsimplify, diff, integrate,
                   factor_terms, solveset, Interval, Union, oo, sstr, denom, numer, Mul, Add, Pow)
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application, convert_xor
from sympy.solvers.inequalities import solve_univariate_inequality
from sympy.core.parameters import distribute

x, y, z = Symbol('x'), Symbol('y'), Symbol('z')
PARAMS = {n: Symbol(n) for n in 'abckmn'}
SAFE = re.compile(r'^(?:\d+(?:\.\d+)?|[xyzabckmn]|sqrt|sin|cos|tan|log|ln|abs|pi|e|<=|>=|[-+*/^()=<>,|.\s])+$')
T = standard_transformations + (implicit_multiplication_application, convert_xor)


def log10(v):
    return log(v, 10)


GLOBALS = {'__builtins__': {}, 'Integer': Integer, 'Float': Float, 'Rational': Rational, 'Symbol': Symbol,
           'sqrt': sqrt, 'sin': sin, 'cos': cos, 'tan': tan, 'log': log10, 'ln': log, 'Abs': Abs, 'abs': Abs,
           'pi': pi, 'e': E, 'E': E}
LOCALS = {'x': x, 'y': y, 'z': z, **PARAMS}


def P(s, evaluate=True):
    s = s.strip()
    if not s or not SAFE.match(s) or '__' in s:
        raise ValueError('ما فهمت المسألة')
    s = re.sub(r'\|([^|]+)\|', r'abs(\1)', s)
    return parse_expr(s, local_dict=dict(LOCALS), global_dict=dict(GLOBALS), transformations=T, evaluate=evaluate)


def D(s):
    """The problem as the teacher wrote it (2(x+1), not 2x+2), for the first line."""
    P(s)  # still checked and parsed
    t = re.sub(r'\s+', '', s).replace('**', '^').replace('sqrt(', '√(')
    t = re.sub(r'(?<=[\w)])([-+])', r' \1 ', t)  # binary + and − get spaces; a leading minus stays
    t = re.sub(r'(\d)\*(?=[a-z(])', r'\1', t).replace('*', '×')
    return t


def paren(v):
    v = S(v)
    return f'({F(v)})' if v.is_number and v < 0 else F(v)


def F(e):
    """The plain printed form: 2*x**2 → 2x^2, sqrt(3) → √(3)."""
    if isinstance(e, bool):
        return 'صح' if e else 'خطأ'
    s = sstr(e)
    s = s.replace('**', '^').replace('sqrt(', '√(').replace('log(', 'لو(')
    s = re.sub(r'(\d)\*(?=[a-z(√])', r'\1', s)
    s = re.sub(r'([a-z)])\*(?=[a-z(√])', r'\1', s)
    s = s.replace('*', '×')
    return s


def N(v):
    """A number said in the reasons (Arabic digits are made by the page)."""
    return F(v)


def step(expr, why=''):
    return {'expr': expr, 'why': why}


def num_answer(v):
    """An exact value, and its decimal when it is not a whole number."""
    v = nsimplify(v) if v.is_number else v
    s = F(v)
    if v.is_number and not v.is_integer and v.is_real:
        s += f' ≈ {round(float(v), 3)}'
    return s


# ------------------------------------------------------------------ equations

def linear_steps(lhs, rhs, var):
    steps = []
    a1, b1 = Poly(lhs, var).all_coeffs() if Poly(lhs, var).degree() == 1 else (0, lhs)
    a2, b2 = Poly(rhs, var).all_coeffs() if Poly(rhs, var).degree() == 1 else (0, rhs)
    a1, b1, a2, b2 = map(S, (a1, b1, a2, b2))
    A = a1 - a2
    if a2 != 0:
        why = f'نطرح {F(a2 * var)} من الطرفين' if a2 > 0 else f'نضيف {F(-a2 * var)} للطرفين'
        steps.append(step(f'{F(A * var + b1)} = {F(b2)}', why))
    if b1 != 0:
        why = f'نطرح {N(b1)} من الطرفين' if b1 > 0 else f'نضيف {N(-b1)} للطرفين'
        steps.append(step(f'{F(A * var)} = {F(b2)} {"-" if b1 > 0 else "+"} {N(abs(b1))}', why))
        steps.append(step(f'{F(A * var)} = {F(b2 - b1)}', 'نبسّط'))
    B = b2 - b1
    if A == 0:
        return steps, ('كل الأعداد حلول' if B == 0 else 'ما لها حل'), []
    if A != 1:
        steps.append(step(f'{F(var)} = {F(B)} / {F(A)}' if A > 0 else f'{F(var)} = {F(B)} / ({F(A)})', f'نقسم الطرفين على {N(A)}'))
    val = B / A
    if not steps or steps[-1]['expr'] != f'{F(var)} = {num_answer(val)}':
        steps.append(step(f'{F(var)} = {num_answer(val)}', 'الحل'))
    else:
        steps[-1]['why'] = 'الحل'
    return steps, f'{F(var)} = {num_answer(val)}', [val]


def clear_denominators(lhs, rhs, var):
    """Fractions in the equation: multiply both sides by the common denominator first."""
    dens = [denom(t) for side in (lhs, rhs) for t in Add.make_args(expand(side))]
    L = 1
    for d in dens:
        L = lcm(L, d)
    if L == 1 or L.has(var):
        return lhs, rhs, None
    return expand(lhs * L), expand(rhs * L), L


def solve_eq(text, var=x):
    left, right = text.split('=', 1)
    lhs, rhs = P(left), P(right)
    shown = f'{D(left)} = {D(right)}'
    steps = [step(shown, 'المسألة')]
    if not (lhs - rhs).free_symbols:
        ok = simplify(lhs - rhs) == 0
        return {'answer': 'صحيحة' if ok else 'غير صحيحة', 'steps': steps + [step('صحيحة' if ok else 'غير صحيحة', 'ما فيها مجهول')]}
    if var not in (lhs - rhs).free_symbols:
        var = sorted((lhs - rhs).free_symbols, key=lambda s: s.name)[0]
    # parentheses → expanded
    el, er = expand(lhs), expand(rhs)
    if f'{F(el)} = {F(er)}' != shown:
        steps.append(step(f'{F(el)} = {F(er)}', 'نفك الأقواس ونرتّب' if '(' in shown else 'نرتّب'))
    el2, er2, L = clear_denominators(el, er, var)
    if L is not None:
        steps.append(step(f'{F(el2)} = {F(er2)}', f'نضرب الطرفين في {N(L)} عشان نتخلص من الكسور'))
        el, er = el2, er2
    expr = expand(el - er)
    den = denom(together(expr))
    if den.has(var):
        # a rational equation: the variable is in a denominator
        sols = [s for s in solve(Eq(lhs, rhs), var) if s.is_real]
        bad = [r for r in solve(den, var)]
        if bad:
            steps.append(step('، '.join(f'{F(var)} ≠ {num_answer(r)}' for r in bad), 'شرط: المقام ما يساوي صفر'))
        steps.append(step(f'{F(numer(together(expr)))} = 0', 'نضرب في المقام المشترك'))
        ans = ' أو '.join(f'{F(var)} = {num_answer(s)}' for s in sols) or 'ما لها حل'
        steps.append(step(ans, 'الحل (بعد ما نستبعد اللي يصفّر المقام)'))
        return {'answer': ans, 'steps': steps, 'roots': [str(s) for s in sols]}
    try:
        deg = Poly(expr, var).degree()
    except Exception:
        deg = None
    if deg == 1:
        more, ans, vals = linear_steps(el, er, var)
        steps += more
    elif deg == 2:
        more, ans, vals = quadratic_steps(expr, var)
        steps += [m for m in more if m['expr'] != steps[-1]['expr']]
    else:
        vals = [s for s in solve(Eq(lhs, rhs), var) if s.is_real]
        ans = ' أو '.join(f'{F(var)} = {num_answer(s)}' for s in vals) or 'ما لها حل حقيقي'
        steps.append(step(ans, 'الحل'))
    out = {'answer': ans, 'steps': steps, 'roots': [str(v) for v in vals]}
    if vals:
        v = vals[0]
        l, r = lhs.subs(var, v), rhs.subs(var, v)
        out['check'] = f'نتحقق: نعوّض {F(var)} = {num_answer(v)} ← الطرف الأول {num_answer(simplify(l))}، والثاني {num_answer(simplify(r))}'
    return out


def quadratic_steps(expr, var):
    steps = []
    p = Poly(expr, var)
    a, b, c = (S(v) for v in p.all_coeffs())
    g = gcd(gcd(a, b), c) if all(v.is_integer for v in (a, b, c)) else 1
    if a < 0:
        g = -abs(g) if g != 0 else -1
    std = expand(expr)
    steps.append(step(f'{F(std)} = 0', 'نخلي الطرف الثاني صفر (الصورة العامة)'))  # dropped by the caller when it repeats the problem
    if g not in (1, 0) and g != 1:
        std = expand(std / g)
        steps.append(step(f'{F(std)} = 0', f'نقسم الطرفين على {N(g)}'))
        p = Poly(std, var)
        a, b, c = (S(v) for v in p.all_coeffs())
    fac = factor(std)
    if fac != std and isinstance(fac, Mul) or (isinstance(fac, Pow) and fac.base.has(var)):
        parts = [f for f in Mul.make_args(fac) if f.has(var)]
        if c == 0:
            why = f'نطلع العامل المشترك {F(var)}'
        elif b == 0 and a == 1 and c < 0:
            why = 'فرق بين مربعين'
        elif a == 1:
            why = f'نبحث عن عددين حاصل ضربهما {N(c)} ومجموعهما {N(b)}'
        else:
            why = 'نحلّل الثلاثي'
        steps.append(step(f'{F(fac)} = 0', why))
        bases = []
        for f in parts:
            bf = f.base if isinstance(f, Pow) else f
            if bf not in bases:
                bases.append(bf)
        steps.append(step(' أو '.join(f'{F(bf)} = 0' for bf in bases), 'إذا حاصل الضرب صفر فأحد العوامل صفر'))
        vals = []
        for bf in bases:
            vals += solve(bf, var)
        vals = sorted(set(vals), key=lambda v: float(v))
    else:
        Dl = b ** 2 - 4 * a * c
        steps.append(step(f'المميز = ب² − ٤أج = {paren(b)}² − ٤×{paren(a)}×{paren(c)} = {N(Dl)}', 'ما تتحلّل بسهولة، فنستخدم القانون العام'))
        D = Dl
        if D < 0:
            steps.append(step('ما لها حلول حقيقية', 'المميز سالب'))
            return steps, 'ما لها حلول حقيقية', []
        vals = sorted(set([(-b + sqrt(D)) / (2 * a), (-b - sqrt(D)) / (2 * a)]), key=lambda v: float(v))
        top = f'± √{N(D)}' if b == 0 else f'{F(-b)} ± √{N(D)}'
        steps.append(step(f'{F(var)} = ({top}) / {N(2 * a)}', 'القانون العام: س = (−ب ± √المميز) / ٢أ'))
    ans = ' أو '.join(f'{F(var)} = {num_answer(v)}' for v in vals) if vals else 'ما لها حل'
    if len(vals) == 1:
        ans = f'{F(var)} = {num_answer(vals[0])} (جذر مكرر)'
    steps.append(step(ans, 'الحل'))
    return steps, ans, vals


# ------------------------------------------------------------------ inequalities

OPS = ['<=', '>=', '<', '>']
FLIP = {'<': '>', '>': '<', '<=': '>=', '>=': '<='}
SHOW = {'<': '<', '>': '>', '<=': '≤', '>=': '≥'}


def solve_ineq(text, var=x):
    op = next(o for o in OPS if o in text)
    left, right = text.split(op, 1)
    lhs, rhs = P(left), P(right)
    steps = [step(f'{D(left)} {SHOW[op]} {D(right)}', 'المتباينة')]
    expr = expand(lhs - rhs)
    try:
        deg = Poly(expr, var).degree()
    except Exception:
        deg = None
    if deg == 1:
        el, er = expand(lhs), expand(rhs)
        a1, b1 = (Poly(el, var).all_coeffs() if Poly(el, var).degree() == 1 else (0, el))
        a2, b2 = (Poly(er, var).all_coeffs() if Poly(er, var).degree() == 1 else (0, er))
        a1, b1, a2, b2 = map(S, (a1, b1, a2, b2))
        A, B = a1 - a2, b2 - b1
        if a2 != 0 or b1 != 0:
            steps.append(step(f'{F(A * var)} {SHOW[op]} {F(B)}', 'نجمع الحدود اللي فيها المجهول في طرف والأعداد في الطرف الثاني (مثل المعادلة)'))
        o = op
        if A < 0:
            o = FLIP[op]
            steps.append(step(f'{F(var)} {SHOW[o]} {F(B)} / ({F(A)})', f'نقسم على {N(A)} وهو سالب، فنقلب إشارة المتباينة'))
        elif A != 1:
            steps.append(step(f'{F(var)} {SHOW[o]} {F(B)} / {F(A)}', f'نقسم الطرفين على {N(A)} (موجب، الإشارة ما تتغير)'))
        v = B / A
        ans = f'{F(var)} {SHOW[o]} {num_answer(v)}'
        steps.append(step(ans, 'الحل'))
        line = {'at': float(v), 'label': F(nsimplify(v)), 'dir': 'left' if o in ('<', '<=') else 'right', 'closed': o in ('<=', '>=')}
        return {'answer': ans, 'steps': steps, 'line': line, 'interval': interval_text(o, v)}
    sol = solve_univariate_inequality({'<': lhs < rhs, '>': lhs > rhs, '<=': lhs <= rhs, '>=': lhs >= rhs}[op], var, relational=False)
    roots = sorted(set(r for r in solve(Eq(lhs, rhs), var) if r.is_real), key=lambda r: float(r))
    if roots:
        steps.append(step(' ، '.join(f'{F(var)} = {num_answer(r)}' for r in roots), 'نلقى أصفار الطرفين (نحلها كمعادلة)'))
        steps.append(step('نختبر إشارة كل فترة بين الأصفار', 'جدول الإشارات'))
    ans = set_text(sol, var)
    steps.append(step(ans, 'الحل'))
    return {'answer': ans, 'steps': steps}


def interval_text(op, v):
    s = num_answer(v)
    return {'<': f']−∞ ، {s}[', '<=': f']−∞ ، {s}]', '>': f']{s} ، ∞[', '>=': f'[{s} ، ∞['}[op]


def set_text(sol, var):
    if sol == S.EmptySet:
        return 'ما لها حل'
    if sol == S.Reals:
        return 'كل الأعداد الحقيقية'
    parts = sol.args if isinstance(sol, Union) else [sol]
    out = []
    for iv in parts:
        if isinstance(iv, Interval):
            lo = '−∞' if iv.start == -oo else num_answer(iv.start)
            hi = '∞' if iv.end == oo else num_answer(iv.end)
            out.append(f'{"]" if iv.left_open else "["}{lo} ، {hi}{"[" if iv.right_open else "]"}')
        else:
            out.append(F(iv))
    return ' ∪ '.join(out)


# ------------------------------------------------------------------ factor, simplify, systems, check

def factor_expr(text):
    e = expand(P(text))
    steps = [step(F(e), 'العبارة')]
    common = factor_terms(e)
    if common != e and isinstance(common, Mul):
        steps.append(step(F(common), 'نطلع العامل المشترك'))
    f = factor(e)
    if f != common:
        syms = sorted(e.free_symbols, key=lambda s: s.name)
        why = 'نحلّل'
        if len(syms) == 1:
            p = Poly(e, syms[0])
            co = p.all_coeffs()
            if p.degree() == 2 and len(co) == 3 and co[1] == 0 and co[0] > 0 and co[2] < 0:
                why = 'فرق بين مربعين: أ² − ب² = (أ − ب)(أ + ب)'
            elif p.degree() == 2 and co[0] == 1:
                why = f'نبحث عن عددين حاصل ضربهما {N(co[2])} ومجموعهما {N(co[1])}'
        steps.append(step(F(f), why))
    if f == e:
        steps.append(step(F(e), 'ما تتحلّل أكثر'))
    return {'answer': F(f), 'steps': steps}


def simplify_expr(text):
    e = P(text)
    num, den = fraction(together(e))
    steps = [step(F(e), 'الكسر')]
    if den == 1:
        s = simplify(e)
        steps.append(step(F(s), 'نبسّط'))
        return {'answer': F(s), 'steps': steps}
    fn, fd = factor(num), factor(den)
    steps.append(step(f'({F(fn)}) / ({F(fd)})', 'نحلّل البسط والمقام'))
    syms = sorted(den.free_symbols, key=lambda s: s.name)
    cond = ''
    if syms:
        bad = solve(den, syms[0])
        if bad:
            cond = '، '.join(f'{F(syms[0])} ≠ {num_answer(b)}' for b in bad)
    c = cancel(e)
    cn, cd = fraction(c)
    steps.append(step(F(factor(cn)) if cd == 1 else f'({F(factor(cn))}) / ({F(factor(cd))})', 'نختصر العامل المشترك'))
    if cond:
        steps.append(step(cond, 'بشرط: المقام الأصلي ما يساوي صفر'))
    return {'answer': F(c) + (f' ، {cond}' if cond else ''), 'steps': steps}


def solve_system(text):
    eqs = [p for p in re.split(r'[,،;]', text) if '=' in p]
    if len(eqs) != 2:
        raise ValueError('أحتاج معادلتين')
    E1 = [P(s) for s in eqs[0].split('=', 1)]
    E2 = [P(s) for s in eqs[1].split('=', 1)]
    e1, e2 = Eq(*E1), Eq(*E2)
    syms = sorted((e1.free_symbols | e2.free_symbols), key=lambda s: s.name)
    if len(syms) != 2:
        raise ValueError('أحتاج مجهولين')
    a, b = syms
    steps = [step(f'{F(E1[0])} = {F(E1[1])}  ،  {F(E2[0])} = {F(E2[1])}', 'النظام')]
    exp_b = solve(e1, b)
    if exp_b:
        steps.append(step(f'{F(b)} = {F(exp_b[0])}', f'من المعادلة الأولى نكتب {F(b)} بدلالة {F(a)}'))
        sub = Eq(E2[0].subs(b, exp_b[0]), E2[1].subs(b, exp_b[0]))
        steps.append(step(f'{F(expand(sub.lhs))} = {F(expand(sub.rhs))}', 'نعوّض في المعادلة الثانية'))
    sol = solve([e1, e2], [a, b], dict=True)
    if not sol:
        steps.append(step('ما له حل', 'المستقيمان متوازيان'))
        return {'answer': 'ما له حل', 'steps': steps}
    s = sol[0]
    if a in s:
        steps.append(step(f'{F(a)} = {num_answer(s[a])}', 'نحل المعادلة'))
    if b in s:
        steps.append(step(f'{F(b)} = {num_answer(s[b])}', f'نعوّض قيمة {F(a)}'))
    ans = '، '.join(f'{F(k)} = {num_answer(v)}' for k, v in sorted(s.items(), key=lambda kv: kv[0].name))
    return {'answer': ans, 'steps': steps}


def check_answer(text):
    # «x=4 | 2x+3=11»
    given, eq = text.split('|', 1)
    var_s, val_s = given.split('=', 1)
    var, val = P(var_s), P(val_s)
    left, right = eq.split('=', 1)
    l, r = P(left).subs(var, val), P(right).subs(var, val)
    ok = simplify(l - r) == 0
    steps = [step(f'{F(P(left))} = {F(P(right))}', 'المعادلة'),
             step(f'{F(var)} = {F(val)}', 'نعوّض'),
             step(f'{num_answer(simplify(l))} = {num_answer(simplify(r))}', 'نحسب الطرفين'),
             step('الجواب صحيح ✔' if ok else 'الجواب غلط ✘', '')]
    return {'answer': 'صحيح' if ok else 'غلط', 'steps': steps, 'correct': ok}


def evaluate(text):
    e = P(text)
    v = simplify(e)
    return {'answer': num_answer(v), 'steps': [step(F(e), 'العبارة'), step(num_answer(v), 'الناتج')]}


def derivative(text):
    e = P(text)
    var = x if x in e.free_symbols else (sorted(e.free_symbols, key=lambda s: s.name) or [x])[0]
    d = diff(e, var)
    return {'answer': F(simplify(d)), 'steps': [step(F(e), 'الدالة'), step(F(d), 'نشتق كل حد'), step(F(simplify(d)), 'نبسّط')]}


def integral(text):
    e = P(text)
    var = x if x in e.free_symbols else (sorted(e.free_symbols, key=lambda s: s.name) or [x])[0]
    i = integrate(e, var)
    return {'answer': F(i) + ' + ث', 'steps': [step(F(e), 'الدالة'), step(F(i) + ' + ث', 'نكامل كل حد (ث ثابت التكامل)')]}


TASKS = {'solve': None, 'inequality': solve_ineq, 'factor': factor_expr, 'simplify': simplify_expr,
         'system': solve_system, 'check': check_answer, 'evaluate': evaluate, 'derivative': derivative, 'integral': integral}


def handle(req_json):
    try:
        req = json.loads(req_json)
        task, text = str(req.get('task', '')), str(req.get('expr', ''))[:300]
        if task not in TASKS:
            raise ValueError('مهمة غير معروفة')
        if task == 'solve':
            if any(o in text for o in OPS):
                task, out = 'inequality', solve_ineq(text)
            elif text.count('=') >= 2 and re.search(r'[,،;]', text):
                task, out = 'system', solve_system(text)
            elif '=' in text:
                out = solve_eq(text)
            else:
                task, out = 'factor', factor_expr(text)
        else:
            out = TASKS[task](text)
        return json.dumps({'ok': True, 'task': task, **out}, ensure_ascii=False)
    except Exception as err:  # every failure is a plain answer, never a crash
        msg = str(err) if isinstance(err, ValueError) and re.search('[؀-ۿ]', str(err)) else 'ما قدرت أحل هذي بالطريقة اللي انكتبت فيها'
        return json.dumps({'ok': False, 'error': msg, 'detail': type(err).__name__ + ': ' + str(err)[:200]}, ensure_ascii=False)
