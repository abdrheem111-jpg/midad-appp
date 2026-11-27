import test from 'node:test';
import assert from 'node:assert/strict';
import { toEngine, taskFromWords } from '../src/core/math-input.js';
import { spokenToMath, mathCommand } from '../src/core/spoken-math.js';
import { mathDeck } from '../src/core/math-deck.js';
import { solveTriangle, geometryFigure } from '../src/core/geometry.js';
import { createMathEngine } from '../src/main/math/engine.js';
import { cleanSketch } from '../src/core/math-sketch.js';

test('maths input: the teacher\'s Arabic notation becomes the engine\'s; anything else is refused', () => {
  assert.deepEqual(toEngine('٢س + ٣ = ١١'), { ok: true, expr: '2 x + 3 = 11' });
  assert.equal(toEngine('س² − ٩').expr, 'x ^(2) - 9');
  assert.equal(toEngine('٢س + ص = ٧، س − ص = ٢').expr, '2 x + y = 7, x - y = 2');
  assert.equal(toEngine('س ≥ ٣').expr, 'x >= 3');
  assert.equal(toEngine('ص = ٢س + ١').expr, '2 x + 1');
  assert.equal(toEngine('جا س').expr, 'sin x');
  assert.equal(toEngine('٢٫٥س = ٥').expr, '2.5 x = 5');
  for (const bad of ['process.exit()', 'import os', '__class__', 'x; y', 'eval(1)', 'open("f")', '`ls`']) assert.equal(toEngine(bad).ok, false, bad);
  assert.equal(toEngine('(x+1').ok, false);
  assert.equal(taskFromWords('حلل العباره'), 'factor');
  assert.equal(taskFromWords('بسط الكسر'), 'simplify');
});

test('spoken maths: «حل اثنين س زائد ثلاثة يساوي احدعش» is solved locally; other sentences are not maths', () => {
  assert.deepEqual(mathCommand('حل اثنين س زائد ثلاثة يساوي احدعش'), { task: 'solve', expr: '2س + 3 = 11', explain: false });
  assert.deepEqual(mathCommand('حلل س تربيع ناقص تسعة'), { task: 'factor', expr: 'س^2 - 9', explain: false });
  assert.equal(mathCommand('اشرح لي حل ٢س + ٣ = ١١').explain, true);
  assert.equal(mathCommand('حل س اكبر من او يساوي ٣').expr, 'س >= 3');
  assert.equal(mathCommand('احسب خمسة وعشرين ضرب اربعة').expr, '25 * 4');
  assert.equal(mathCommand('حل الواجب'), null);
  assert.equal(mathCommand('حل هذي المسألة اللي في الشاشة'), null); // Claude looks at the screen for that
  assert.equal(spokenToMath('كيف حالك'), null);
});

test('maths deck: one line per step, reasons under them in «اشرح لي», a number line for an inequality', () => {
  const r = { answer: 'x > -3', steps: [{ expr: '-3x + 2 < 11', why: 'المتباينة' }, { expr: '-3x < 9', why: 'نجمع' }, { expr: 'x > -3', why: 'الحل' }], line: { at: -3, dir: 'right', closed: false } };
  const d = mathDeck(r, { show: 'steps', explain: true, size: { width: 1568, height: 882 } });
  assert.equal(d.length, 4);
  assert.equal(d[1].items.length, 2); // the step and its reason
  assert.ok(d[1].items[1].y > d[1].items[0].y);
  assert.equal(d[3].items[0].type, 'numberline');
  assert.deepEqual(d[3].items[0].ray, { at: -3, dir: 'right', closed: false });
  assert.match(d.at(-1).say, /فاضية/);
  const shapes = cleanSketch(d[3].items, { pt: (x, y) => ({ x, y }), len: (v) => v, digits: 'arabic' });
  assert.deepEqual(shapes[0].ray, { at: -3, dir: 'right', closed: false });
  assert.equal(mathDeck(r, { show: 'answer', size: { width: 1000, height: 600 } }).length, 1);
});

test('geometry: triangles solved exactly (SSS, SAS, ASA), impossible ones refused, figures fit the box', () => {
  const t = solveTriangle({ a: 3, b: 4, c: 5 });
  assert.deepEqual([t.C, t.area, t.perimeter, t.right], [90, 6, 12, 'C']);
  assert.equal(solveTriangle({ b: 5, c: 7, A: 60 }).a, 6.24);
  assert.equal(solveTriangle({ A: 50, B: 60, a: 10 }).C, 70);
  assert.equal(solveTriangle({ a: 1, b: 2, c: 5 }).ok, false);
  assert.equal(solveTriangle({ A: 100, B: 90, a: 3 }).ok, false);
  const box = { x: 800, y: 100, w: 700, h: 700 };
  const f = geometryFigure({ shape: 'triangle', given: { a: 3, b: 4, c: 5 } }, box);
  for (const [x, y] of f.items[0].points) assert.ok(x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
  assert.equal(f.items.filter((i) => i.type === 'angle' && i.right).length, 1);
  assert.equal(geometryFigure({ shape: 'circle', given: { r: 4 } }, box).measures.area, 50.27);
  assert.equal(geometryFigure({ shape: 'rectangle', given: { w: 6, h: 8 } }, box).measures.diagonal, 10);
});

test('the real maths engine (SymPy in Pyodide, on this PC) solves step by step', { timeout: 180000 }, async () => {
  const e = createMathEngine();
  try {
    const lin = await e.solve('solve', '٢س + ٣ = ١١');
    assert.equal(lin.ok, true, JSON.stringify(lin));
    assert.equal(lin.answer, 'x = 4');
    assert.deepEqual(lin.steps.map((s) => s.expr), ['2x + 3 = 11', '2x = 11 - 3', '2x = 8', 'x = 8 / 2', 'x = 4']);
    assert.match(lin.steps[1].why, /نطرح/);
    const q = await e.solve('solve', 'x^2 - 5x + 6 = 0');
    assert.equal(q.answer, 'x = 2 أو x = 3');
    assert.ok(q.steps.some((s) => /\(x - 3\)\(x - 2\)|\(x - 2\)\(x - 3\)/.test(s.expr)));
    const iq = await e.solve('solve', '-3x + 2 < 11');
    assert.equal(iq.task, 'inequality');
    assert.equal(iq.answer, 'x > -3');
    assert.ok(iq.steps.some((s) => /نقلب/.test(s.why)));
    assert.deepEqual(iq.line, { at: -3, label: '-3', dir: 'right', closed: false });
    assert.equal((await e.solve('factor', 'x^2 - 9')).answer, '(x - 3)(x + 3)');
    assert.equal((await e.solve('simplify', '(x^2-1)/(x+1)')).answer, 'x - 1 ، x ≠ -1');
    assert.equal((await e.solve('solve', '2x+y=7, x-y=2')).answer, 'x = 3، y = 1');
    assert.equal((await e.solve('check', 'x=5 | 2x+3=11')).correct, false);
    assert.equal((await e.solve('solve', 'x^2+x+1=0')).answer, 'ما لها حلول حقيقية');
    assert.equal((await e.solve('derivative', 'x^3+2x')).answer, '3x^2 + 2');
    assert.equal((await e.solve('solve', 'process.exit()')).ok, false); // refused before it reaches Python
  } finally { e.close(); }
});
