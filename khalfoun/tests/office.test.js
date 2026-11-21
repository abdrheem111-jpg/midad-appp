// Writing and drawing in Word, PowerPoint, Excel and PDF; maths by voice; the pen on the
// screen; and the COM host protocol. (The COM script itself is parse-checked on Windows.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { recognize, splitCommands } from '../src/core/intents.js';
import { spokenMath, looksLikeMath, linearMath } from '../src/core/office-math.js';
import { cleanPlan, extractJson, layoutDiagram, composePrompt, splitApp, parseShape, planText, KINDS, SHAPES } from '../src/core/office-plan.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { decide } from '../src/core/permissions.js';
import { validateAction, createExecutor } from '../src/main/actions/index.js';
import { buildDocx } from '../src/main/office/docx.js';
import { buildPptx } from '../src/main/office/pptx.js';
import { buildXlsx } from '../src/main/office/xlsx.js';
import { planHtml } from '../src/main/office/html.js';
import { fileTitle } from '../src/main/office/theme.js';
import { createOfficeActions, bgr, shapeItems, diagramItems, appOfProcess } from '../src/main/office/index.js';
import { OfficeHost } from '../src/main/office/office-host.js';
import { shapePoints } from '../src/renderer/ink.js';
import { TEMPLATES } from '../src/core/templates/ar-om.js';
import { ANIMATIONS } from '../src/renderer/animations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const START = Date.UTC(2026, 10, 18, 6, 0, 0);
function makeBrain(extra = {}) {
  let now = START;
  return new Brain({ memoryData: { ...defaultMemory(START), onboarded: true, level: 3, ...extra }, clock: () => now, rng: () => 0.1 });
}

// ------------------------------------------------------------------ understanding
test('writing, drawing, formatting and screen commands are understood', () => {
  const cases = [
    ['اكتب فقرة عن النخلة في الوورد', 'compose', { kind: 'text', topic: 'النخلة', app: 'word' }],
    ['سو عرض تقديمي عن الكسور من ٥ شرائح', 'compose', { kind: 'slides', topic: 'الكسور', app: 'powerpoint', count: 5 }],
    ['جهز ورقة عمل عن الجمع', 'compose', { kind: 'worksheet', app: 'word' }],
    ['سو لي ٥ اسئلة عن الضرب', 'compose', { kind: 'quiz', count: 5 }],
    ['سو جدول ضرب في الاكسل', 'compose', { kind: 'table', app: 'excel', topic: 'جدول ضرب' }],
    ['اكتب قصة عن الصدق في PDF', 'compose', { kind: 'story', app: 'pdf' }],
    ['ارسم دورة الماء', 'compose', { kind: 'diagram', topic: 'دورة الماء' }],
    ['اكتب في الوورد قصة عن الأمانة', 'compose', { kind: 'story', app: 'word' }],
    ['سولي اختبار في الوورد عن الجمع', 'compose', { kind: 'quiz', app: 'word' }],
    ['ارسم دايرة حمرا', 'draw_shape', { shape: 'circle', color: 'red', count: 1 }],
    ['ارسم ٣ نجوم صفرا في البوربوينت', 'draw_shape', { shape: 'star', color: 'yellow', count: 3, app: 'powerpoint' }],
    ['اكتب في الوورد: السلام عليكم ورحمة الله', 'office_write', { app: 'word', text: 'السلام عليكم ورحمة الله' }],
    ['اكتب في البوربوينت عنوان درس الكسور', 'office_write', { app: 'powerpoint', style: 'heading' }],
    ['خلي الخط عريض', 'office_format', { op: 'bold' }],
    ['كبر الخط', 'office_format', { op: 'grow' }],
    ['لون الخط احمر', 'office_format', { op: 'color', value: 'red' }],
    ['خلي حجم الخط ٢٤', 'office_format', { op: 'size', value: 24 }],
    ['شريحة جديدة', 'office_slide', {}],
    ['حوله PDF', 'office_pdf', {}],
    ['اكتب معادلة س زائد اثنين يساوي خمسة', 'office_equation', { text: 'س + ٢ = ٥' }],
    ['دور عليه', 'office_circle', {}],
    ['اكتب على الشاشة مرحبا يا طلاب', 'screen_write', { text: 'مرحبا يا طلاب' }],
    ['ارسم دائرة حمرا على الشاشة', 'screen_draw', { shape: 'circle', color: 'red' }],
    ['قلم', 'screen_pen', { on: true }],
    ['وقف القلم', 'screen_pen', { on: false }],
    ['امسح الشاشة', 'screen_clear', {}],
    ['الأرقام بالعربي', 'set_digits', { digits: 'arabic' }],
  ];
  for (const [text, intent, slots] of cases) {
    const r = recognize(text);
    assert.equal(r.intent, intent, text);
    for (const [k, v] of Object.entries(slots)) assert.deepEqual(r.slots[k], v, `${text}: ${k}`);
  }
  // Old meanings stay.
  for (const [text, intent] of [['سولي اختبار رياضيات', 'quiz'], ['اكتب السلام عليكم', 'type_text'], ['اكتب اسمي في ملف البي دي اف', 'pdf_write'],
    ['اكتب في البي دي اف مرحبا', 'pdf_write'], ['اكتب في الدفتر', 'open_tool'], ['سو مطر', 'effect'], ['عطني لغز', 'riddle'], ['انزل سطر', 'key'],
    ['كبر الشاشه', 'key'], ['افتح الوورد', 'open'], ['شيل الزينة', 'effect_stop'], ['نجمة للصف', 'class_star']]) {
    assert.equal(recognize(text).intent, intent, text);
  }
  assert.deepEqual(splitCommands('افتح الوورد واكتب فقرة عن النخلة وبعدين خلي الخط عريض'), ['افتح الوورد', 'اكتب فقرة عن النخلة', 'خلي الخط عريض']);
});

test('app names: at the end, glued, «جديد», and in the middle', () => {
  assert.deepEqual(splitApp('جدول ضرب في الاكسل جديد'), { app: 'excel', rest: 'جدول ضرب', fresh: true });
  assert.equal(splitApp('سو عرض عن الكسور بالبوربوينت').app, 'powerpoint');
  assert.equal(splitApp('اكتب السلام عليكم'), null);
  assert.deepEqual(parseShape('مربع ازرق مكتوب فيه مرحبا'), { shape: 'square', color: 'blue', count: 1, text: 'مرحبا' });
  assert.equal(parseShape('دوره الماء'), null);
});

test('spoken maths becomes written maths with Arabic digits', () => {
  assert.equal(spokenMath('س زائد اثنين يساوي خمسة'), 'س + ٢ = ٥');
  assert.equal(spokenMath('ثلاثة على أربعة زائد واحد على أربعة يساوي واحد'), '٣/٤ + ١/٤ = ١');
  assert.equal(spokenMath('خمسة وعشرين ضرب أربعة يساوي مية'), '٢٥ × ٤ = ١٠٠');
  assert.equal(spokenMath('س تربيع زائد ص تربيع'), 'س² + ص²');
  assert.equal(spokenMath('جذر تسعة يساوي ثلاثة'), '√٩ = ٣');
  assert.equal(spokenMath('١٢ تقسيم ٤ يساوي ٣'), '١٢ ÷ ٤ = ٣');
  assert.equal(spokenMath('٣/٤ + ١/٤ = ١'), '٣/٤ + ١/٤ = ١');
  assert.equal(spokenMath('5*3=15', { digits: 'latin' }), '5 × 3 = 15');
  assert.equal(spokenMath('ثلاثة فاصلة خمسة'), '٣٫٥');
  assert.ok(looksLikeMath('س زائد ٢ يساوي ٥'));
  assert.ok(!looksLikeMath('السلام عليكم'));
  assert.equal(linearMath('٣/٤ + √٩'), '(٣)/(٤) + √(٩)');
});

// ------------------------------------------------------------------ plans from the model
test('the model\'s answer is pulled out, checked and cleaned for every kind', () => {
  assert.deepEqual(extractJson('هذا هو: {"a": "{x}", "b": [1]} شكراً'), { a: '{x}', b: [1] });
  assert.equal(extractJson('لا شيء'), null);
  const ws = cleanPlan('worksheet', { title: '**ورقة**', intro: 'أجب', questions: [{ q: 'س١', choices: ['أ', 'ب'], answer: 'أ', lines: 9 }, { q: '' }] });
  assert.equal(ws.title, 'ورقة');
  assert.equal(ws.blocks[0].text, 'أجب');
  assert.equal(ws.blocks.at(-1).items.length, 1);
  assert.equal(ws.blocks.at(-1).items[0].lines, 4);
  // Cleaning twice changes nothing (the main process checks again).
  assert.deepEqual(cleanPlan('worksheet', ws).blocks.at(-1), ws.blocks.at(-1));
  const story = cleanPlan('story', { title: 'ق', paragraphs: ['أ', 'ب'], moral: 'ع' });
  assert.deepEqual(cleanPlan('story', story), story);
  const deck = cleanPlan('slides', { title: 'ع', slides: [{ title: 'ش١', bullets: ['ن'] }, { title: '', bullets: [] }] });
  assert.equal(deck.slides.length, 1);
  const tbl = cleanPlan('table', { columns: ['أ', 'ب'], rows: [[1], ['x', 'y', 'z']] });
  assert.deepEqual(tbl.rows, [[1, ''], ['x', 'y']]);
  const dia = cleanPlan('diagram', { layout: 'weird', nodes: [{ id: 'a', text: 'أ', color: 'nope' }, { id: 'b', text: 'ب' }], links: [{ from: 'a', to: 'zz' }] });
  assert.equal(dia.layout, 'flow');
  assert.equal(dia.nodes[0].color, null);
  assert.equal(dia.links.length, 0);
  assert.equal(cleanPlan('diagram', { nodes: [{ text: 'وحيد' }] }), null);
  assert.equal(cleanPlan('text', {}), null);
  assert.match(planText(ws), /س١/);
  for (const kind of Object.keys(KINDS)) {
    const p = composePrompt({ kind, topic: 'الماء', count: 4, raw: 'اكتب عن الماء' });
    assert.match(p.user, /الماء/);
    assert.match(p.system, /JSON/);
  }
});

test('diagram layout: boxes inside the area, arrows between box edges, cycles close', () => {
  for (const layout of ['cycle', 'flow', 'tree', 'grid']) {
    const plan = cleanPlan('diagram', { layout, nodes: ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز'].map((t, i) => ({ id: `n${i}`, text: t })), links: [] });
    const { boxes, arrows } = layoutDiagram(plan);
    assert.equal(boxes.length, 7);
    for (const b of boxes) {
      assert.ok(b.x - b.w / 2 >= -0.01 && b.x + b.w / 2 <= 1.01 && b.y - b.h / 2 >= -0.01 && b.y + b.h / 2 <= 1.01, `${layout}: ${JSON.stringify(b)}`);
    }
    if (layout === 'cycle') assert.equal(arrows.length, 7);
    if (layout === 'tree') assert.equal(arrows.length, 6);
    if (layout === 'grid') assert.equal(arrows.length, 0);
  }
  // Flows read right to left.
  const flow = layoutDiagram(cleanPlan('diagram', { layout: 'flow', nodes: [{ id: 'a', text: 'أول' }, { id: 'b', text: 'ثاني' }], links: [] }));
  assert.ok(flow.boxes[0].x > flow.boxes[1].x);
});

// ------------------------------------------------------------------ the brain
test('brain: compose → the cloud writes → a checked office_put through permissions', () => {
  const b = makeBrain();
  const r = b.hear('اكتب فقرة عن النخلة في الوورد');
  assert.equal(r.situation, 'compose_working');
  assert.equal(r.compose.digits, 'arabic');
  const done = b.composed(r.compose, { ok: true, plan: { kind: 'text', title: 'النخلة', blocks: [{ type: 'paragraph', text: 'شجرة.' }] } });
  assert.equal(done.action.type, 'office_put');
  assert.equal(validateAction(done.action), null);
  assert.equal(decide(done.action, { level: 2 }).confirm, true); // writing into a document asks at level 2
  assert.equal(decide(done.action, { level: 3 }).allowed, true);
  assert.equal(decide(done.action, { level: 3, kidsMode: true }).allowed, false);
  const file = b.actionResult(done.action.id, { ok: true, data: { mode: 'file', app: 'word' } });
  assert.equal(file.situation, 'office_new_file');
  // Failures say why.
  assert.equal(b.composed({ kind: 'text', app: 'word' }, { ok: false, error: 'no_cloud' }).situation, 'compose_no_cloud');
  assert.equal(b.composed({ kind: 'text', app: 'word' }, { ok: true, plan: { kind: 'text' } }).situation, 'compose_failed');
});

test('brain: «سو عرض» asks what about, and the next sentence is the topic', () => {
  const b = makeBrain();
  assert.equal(b.hear('سو عرض').situation, 'compose_what');
  const r = b.hear('الطاقة الشمسية');
  assert.equal(r.situation, 'compose_working');
  assert.deepEqual([r.compose.kind, r.compose.topic, r.compose.app], ['slides', 'الطاقة الشمسية', 'powerpoint']);
  // A real command instead of a topic just runs.
  b.hear('سو جدول');
  assert.equal(b.hear('افتح الحاسبة').action.type, 'open_app');
});

test('brain: drawing or an equation with no Office open goes on the screen; «دور عليه» circles the mouse spot', () => {
  const b = makeBrain();
  const d = b.hear('ارسم قلب احمر');
  assert.equal(validateAction(d.action), null);
  const screen = b.actionResult(d.action.id, { ok: false, error: 'no_office' });
  assert.deepEqual(screen.ink, { shape: 'heart', color: 'red', count: 1, text: '' });
  const e = b.hear('اكتب معادلة ٣ ضرب ٤ يساوي ١٢');
  assert.deepEqual(b.actionResult(e.action.id, { ok: false, error: 'no_office' }).ink, { text: '٣ × ٤ = ١٢' });
  const c = b.hear('دور عليه');
  assert.equal(b.actionResult(c.action.id, { ok: false, error: 'no_office' }).ink.at, 'pointer');
  const f = b.hear('خلي الخط عريض');
  assert.equal(b.actionResult(f.action.id, { ok: false, error: 'no_selection' }).situation, 'office_need_selection');
  assert.equal(b.hear('اكتب على الشاشة مرحبا').ink.text, 'مرحبا');
  assert.equal(b.hear('قلم').pen, true);
  assert.equal(b.hear('امسح الشاشة').ink.clear, true);
});

test('brain: Latin digits when the teacher asks for them', () => {
  const b = makeBrain();
  b.hear('الارقام انجليزي');
  assert.equal(b.memory.data.writeDigits, 'latin');
  assert.equal(b.hear('اكتب معادلة 3 ضرب 4 يساوي 12').action.params.text, '3 × 4 = 12');
  b.hear('الأرقام بالعربي');
  assert.equal(b.hear('اكتب في الوورد: الصف 5').action.params.plan.blocks[0].text, 'الصف ٥');
});

test('brain: the voice session words and a typed chain of writing steps', () => {
  const b = makeBrain();
  assert.equal(b.event('session_start', {}).situation, 'session_start');
  assert.equal(b.event('session_end', {}).situation, 'session_end');
  const first = b.hear('افتح الوورد واكتب فقرة عن النخلة');
  assert.equal(first.action.type, 'open_app');
  assert.equal(first.more, true);
  assert.equal(b.continueQueue().situation, 'compose_working');
});

test('office actions refuse anything malformed', () => {
  const plan = { kind: 'text', title: '', blocks: [{ type: 'paragraph', text: 'أ' }] };
  assert.equal(validateAction({ type: 'office_put', params: { app: 'word', plan } }), null);
  for (const bad of [{ app: 'notepad', plan }, { app: 'word', plan: { kind: 'virus' } }, { app: 'word', plan: { kind: 'text', blocks: [] } }, { app: 'word', plan, digits: 'roman' }]) {
    assert.equal(validateAction({ type: 'office_put', params: bad }), 'bad_office', JSON.stringify(bad));
  }
  assert.equal(validateAction({ type: 'office_draw', params: { app: null, shape: 'circle', color: 'red', count: 1, text: '' } }), null);
  assert.equal(validateAction({ type: 'office_draw', params: { app: null, shape: 'bomb', color: 'red', count: 1, text: '' } }), 'bad_office');
  assert.equal(validateAction({ type: 'office_draw', params: { app: null, shape: 'circle', color: 'red', count: 99, text: '' } }), 'bad_office');
  assert.equal(validateAction({ type: 'office_format', params: { op: 'size', value: 500 } }), 'bad_office');
  assert.equal(validateAction({ type: 'office_format', params: { op: 'rm -rf' } }), 'bad_office');
  assert.equal(validateAction({ type: 'office_format', params: { op: 'color', value: 'red' } }), null);
  assert.equal(validateAction({ type: 'office_equation', params: { app: null, text: 'x'.repeat(301) } }), 'bad_office');
  assert.equal(validateAction({ type: 'office_slide', params: { title: 'ش' } }), null);
});

// ------------------------------------------------------------------ files
test('Word files: right-to-left, Arabic fonts, questions with an answer key on its own page', async () => {
  const plan = cleanPlan('worksheet', { title: 'ورقة عمل', questions: [{ q: 'ما نصف ٨؟', choices: ['٢', '٤'], answer: '٤' }, { q: 'اكتب كسراً', lines: 2, answer: '١/٢' }] });
  const zip = await JSZip.loadAsync(await buildDocx(plan));
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /<w:bidi\/>/);
  assert.match(xml, /<w:rtl\/>/);
  assert.match(xml, /ما نصف ٨؟/);
  assert.match(xml, /مفتاح الإجابة/);
  assert.match(xml, /w:type="page"/);
  assert.match(xml, /١\. /); // Arabic numbering
  const latin = await JSZip.loadAsync(await buildDocx(plan, { digits: 'latin' }));
  assert.match(await latin.file('word/document.xml').async('string'), />1\. </);
  const table = await JSZip.loadAsync(await buildDocx(cleanPlan('table', { title: 'ج', columns: ['أ'], rows: [['١']] })));
  assert.match(await table.file('word/document.xml').async('string'), /<w:bidiVisual\/>/);
});

test('PowerPoint files: a title slide, one slide per part, right-to-left bullets, diagrams and shapes', async () => {
  const deck = cleanPlan('slides', { title: 'الكسور', subtitle: 'الرابع', slides: [{ title: 'ما الكسر؟', bullets: ['جزء من كل', 'بسط ومقام'], note: 'ملاحظة' }, { title: 'أنواع', bullets: ['عادي'] }] });
  const zip = await JSZip.loadAsync(await buildPptx(deck));
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  assert.equal(slides.length, 3);
  const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(s2, /ما الكسر؟/);
  assert.match(s2, /rtl="1"/);
  assert.ok(Object.keys(zip.files).some((f) => /notesSlide/.test(f)));
  const dia = await JSZip.loadAsync(await buildPptx(cleanPlan('diagram', { layout: 'cycle', title: 'دورة الماء', nodes: ['تبخر', 'تكاثف', 'هطول'].map((t, i) => ({ id: `n${i}`, text: t })), links: [] })));
  const d1 = await dia.file('ppt/slides/slide1.xml').async('string');
  assert.equal((d1.match(/prst="roundRect"/g) || []).length, 3);
  assert.ok((d1.match(/<a:tailEnd type="triangle"/g) || []).length >= 3);
  const shp = await JSZip.loadAsync(await buildPptx(null, { shape: { shape: 'star', color: 'yellow', count: 3 } }));
  assert.equal(((await shp.file('ppt/slides/slide1.xml').async('string')).match(/prst="star5"/g) || []).length, 3);
});

test('Excel files: right-to-left sheet, header, numbers as numbers, escaped text', async () => {
  const zip = await JSZip.loadAsync(await buildXlsx({ title: 'جدول', columns: ['العدد', 'ملاحظة'], rows: [['١٢', 'a&b<c'], [3.5, 'x']] }));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet, /rightToLeft="1"/);
  assert.match(sheet, /<v>12<\/v>/);
  assert.match(sheet, /<v>3\.5<\/v>/);
  assert.match(sheet, /a&amp;b&lt;c/);
  assert.match(sheet, /state="frozen"/);
});

test('PDF page: right-to-left HTML, escaped, with the diagram as SVG', () => {
  const html = planHtml(cleanPlan('diagram', { layout: 'flow', title: '<b>عنوان</b>', nodes: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }], links: [] }));
  assert.match(html, /dir="rtl"/);
  assert.match(html, /<svg/);
  assert.match(html, /&lt;b&gt;عنوان/);
  assert.doesNotMatch(html, /<b>عنوان/);
  assert.match(planHtml(cleanPlan('worksheet', { title: 'و', questions: [{ q: 'س', answer: 'ج' }] })), /مفتاح الإجابة/);
  assert.equal(fileTitle('a/b:c*?'), 'a b c');
  assert.equal(fileTitle(''), 'خلفون');
});

// ------------------------------------------------------------------ doing it
function fakeHost(answers) {
  const calls = [];
  return { calls, available: true, async call(op, args) { calls.push({ op, args }); const a = answers[op]; return typeof a === 'function' ? a(args) : (a || { ok: false, error: 'no_office' }); } };
}

test('office actions: into the open document when there is one, else a new file that never overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kh-office-'));
  try {
    const opened = [];
    const base = { documentsDir: dir, openPath: async (f) => { opened.push(f); return ''; }, personProcess: async () => 'WINWORD' };
    const plan = cleanPlan('text', { title: 'النخلة', paragraphs: ['شجرة.'] });
    const live = fakeHost({ status: { ok: true, data: { app: 'word', hasDoc: true } }, insert: { ok: true, data: { app: 'word' } } });
    const a = createOfficeActions({ ...base, host: live });
    assert.deepEqual(await a.put({ app: 'word', plan }), { ok: true, data: { mode: 'inserted', app: 'word' } });
    assert.equal(live.calls[1].op, 'insert');
    assert.equal(live.calls[1].args.process, 'WINWORD');
    assert.equal(live.calls[1].args.c.digits, 'arabic');
    // Word not open: a new designed file, opened.
    const none = createOfficeActions({ ...base, host: fakeHost({ status: { ok: true, data: { app: null, hasDoc: false } } }) });
    const first = await none.put({ app: 'word', plan });
    assert.equal(first.data.mode, 'file');
    assert.equal(first.data.file, join(dir, 'خلفون', 'النخلة.docx'));
    const second = await none.put({ app: 'word', plan });
    assert.notEqual(second.data.file, first.data.file);
    assert.equal((await readdir(join(dir, 'خلفون'))).length, 2);
    assert.equal(opened.length, 2);
    // A deck and a table go to their own programs; a diagram for Word becomes slides.
    assert.match((await none.put({ app: 'powerpoint', plan: cleanPlan('slides', { title: 'ع', slides: [{ title: 'ش', bullets: ['ن'] }] }) })).data.file, /\.pptx$/);
    assert.match((await none.put({ app: 'excel', plan: cleanPlan('table', { title: 'ج', columns: ['أ'], rows: [['١']] }) })).data.file, /\.xlsx$/);
    assert.match((await none.put({ app: 'word', plan: cleanPlan('diagram', { nodes: [{ text: 'أ' }, { text: 'ب' }] }) })).data.file, /\.pptx$/);
    // «جديد» always makes a file, even with Word open.
    assert.equal((await a.put({ app: 'word', plan, fresh: true })).data.mode, 'file');
    // The document refused: a few words are pasted instead.
    const typed = [];
    const refuse = createOfficeActions({ ...base, typeText: async (t) => { typed.push(t); return { ok: true }; }, host: fakeHost({ status: { ok: true, data: { app: 'word', hasDoc: true } }, insert: { ok: false, error: 'com: busy' } }) });
    assert.equal((await refuse.put({ app: 'word', plan: { kind: 'text', title: '', blocks: [{ type: 'paragraph', text: 'مرحبا' }] }, verbatim: true })).data.mode, 'pasted');
    assert.deepEqual(typed, ['مرحبا']);
    // A PDF is printed from the page.
    const printed = [];
    const pdf = createOfficeActions({ ...base, host: fakeHost({}), printPdf: async (html, file) => { printed.push(file); } });
    assert.match((await pdf.put({ app: 'pdf', plan })).data.file, /\.pdf$/);
    assert.equal(printed.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('office actions: drawing, formatting fallbacks, slides, equations, circles', async () => {
  const keys = [];
  const base = { documentsDir: tmpdir(), openPath: async () => '', personProcess: async () => null, pressKey: async (k) => { keys.push(k); return { ok: true }; } };
  const nothing = createOfficeActions({ ...base, host: fakeHost({}) });
  assert.deepEqual(await nothing.draw({ app: null, shape: 'circle', color: 'red', count: 1, text: '' }), { ok: false, error: 'no_office' });
  assert.deepEqual(await nothing.format({ op: 'bold' }), { ok: true, data: { mode: 'keys' } });
  assert.deepEqual(keys, ['bold']);
  assert.deepEqual(await nothing.format({ op: 'heading' }), { ok: false, error: 'no_office' });
  assert.equal((await nothing.slide({ title: '' })).error, 'no_office');
  const host = fakeHost({ draw: { ok: true, data: { app: 'powerpoint' } }, format: { ok: true, data: { app: 'word' } }, equation: { ok: true, data: { app: 'word' } }, circle: { ok: true, data: { app: 'word' } } });
  const live = createOfficeActions({ ...base, host });
  assert.equal((await live.draw({ app: null, shape: 'star', color: 'yellow', count: 3, text: '' })).ok, true);
  assert.equal(host.calls[0].args.items.length, 3);
  await live.format({ op: 'color', value: 'red' });
  assert.equal(host.calls[1].args.rgb, bgr('E63946'));
  await live.equation({ app: 'word', text: '٣/٤ + ١' });
  assert.equal(host.calls[2].args.linear, '(٣)/(٤) + ١');
  assert.equal((await live.circle()).ok, true);
  assert.equal(host.calls[3].args.red, bgr('E63946'));
  // Not on Windows: no host at all.
  const off = createOfficeActions({ ...base, host: { available: false, call: async () => ({ ok: false, error: 'unsupported' }) } });
  assert.equal((await off.draw({ app: null, shape: 'circle', count: 1, text: '' })).error, 'no_office');
});

test('shapes and diagrams for the COM host: fractions inside the area, BGR colours', () => {
  assert.equal(bgr('FF0000'), 255);
  assert.equal(bgr('0000FF'), 255 << 16);
  const items = shapeItems({ shape: 'circle', color: 'blue', count: 4 });
  assert.equal(items.length, 4);
  for (const it of items) assert.ok(it.x >= 0 && it.x + it.w <= 1 && it.y >= 0 && it.y + it.h <= 1 && it.type === SHAPES.circle.ppt);
  const d = diagramItems(cleanPlan('diagram', { layout: 'cycle', nodes: [{ text: 'أ' }, { text: 'ب' }, { text: 'ج' }] }));
  assert.equal(d.filter((x) => x.kind === 'arrow').length, 3);
  assert.equal(d.filter((x) => x.kind === 'shape').length, 3);
  assert.equal(appOfProcess('winword.exe'), 'word');
  assert.equal(appOfProcess('chrome'), null);
});

test('the executor checks the plan again before writing', async () => {
  let got = null;
  const exec = createExecutor({ platform: {}, getSettings: () => ({ level: 3 }), office: { put: async (p) => { got = p; return { ok: true, data: { mode: 'file' } }; } } });
  await exec.run({ type: 'office_put', params: { app: 'word', plan: { kind: 'text', title: '**عنوان**', blocks: [{ type: 'paragraph', text: 'أ' }] } } });
  assert.equal(got.plan.title, 'عنوان');
});

// ------------------------------------------------------------------ the COM host
test('office host: one PowerShell, requests and answers matched by id, restarts after a crash', async () => {
  const children = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit('exit');
    child.stdin.on('data', (buf) => {
      for (const line of String(buf).trim().split('\n')) {
        const req = JSON.parse(Buffer.from(line, 'base64').toString('utf8'));
        const ans = req.op === 'ping' ? { id: req.id, ok: true, data: 'pong' } : { id: req.id, ok: false, error: 'no_office' };
        child.stdout.write(`${Buffer.from(JSON.stringify(ans)).toString('base64')}\n`);
      }
    });
    children.push(child);
    return child;
  };
  const dir = await mkdtemp(join(tmpdir(), 'kh-host-'));
  try {
    const host = new OfficeHost({ tempDir: dir, platform: 'win32', spawnFn });
    assert.deepEqual(await host.call('ping'), { ok: true, data: 'pong' });
    assert.deepEqual(await host.call('draw', { items: [] }), { ok: false, error: 'no_office' });
    assert.equal(children.length, 1);
    children[0].emit('exit');
    assert.deepEqual(await host.call('ping'), { ok: true, data: 'pong' });
    assert.equal(children.length, 2);
    // The script is copied out of the app archive for PowerShell.
    assert.match(await readFile(join(dir, 'khalfoun-office-host.ps1'), 'utf8'), /Send-Answer/);
    host.stop();
    assert.equal((await new OfficeHost({ tempDir: dir, platform: 'linux' }).call('ping')).error, 'unsupported');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the COM script only runs fixed operations and never evaluates text', async () => {
  const ps = await readFile(join(HERE, '../src/main/office/office-host.ps1'), 'utf8');
  for (const bad of ['Invoke-Expression', 'iex ', 'Start-Process', 'ScriptBlock', '& $', 'Add-Type -TypeDefinition $']) assert.ok(!ps.includes(bad), bad);
  for (const op of ['ping', 'status', 'insert', 'draw', 'format', 'circle', 'slide', 'equation', 'pdf']) assert.ok(ps.includes(`'${op}' {`), op);
  if (process.platform === 'win32') {
    // PowerShell itself parses the script: no syntax errors.
    const check = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${join(HERE, '../src/main/office/office-host.ps1').replace(/'/g, "''")}', [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }`], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout + check.stderr);
  }
});

// ------------------------------------------------------------------ screen ink, templates
test('screen ink shapes are drawn as outlines that can be revealed stroke by stroke', () => {
  for (const shape of Object.keys(SHAPES)) {
    const pts = shapePoints(shape, 500, 400, 100);
    assert.ok(pts.length >= 3, shape);
    for (const [x, y] of pts) assert.ok(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - 500) <= 160 && Math.abs(y - 400) <= 160, `${shape}: ${x},${y}`);
  }
});

test('every writing/drawing situation has replies, and they follow the template rules', () => {
  const situations = ['compose_working', 'compose_what', 'compose_no_cloud', 'compose_failed', 'office_composed', 'office_new_file', 'office_pasted', 'office_written', 'office_drawn',
    'office_formatted', 'office_formatted_keys', 'office_slide_added', 'office_pdf_saved', 'office_equation_done', 'office_circled', 'office_none', 'office_need_selection',
    'office_not_installed', 'screen_written', 'screen_drawn', 'screen_circled', 'pen_on', 'pen_off', 'screen_cleared', 'digits_arabic', 'digits_latin',
    'session_start', 'session_end', 'session_timeout'];
  for (const s of situations) {
    const list = TEMPLATES.filter((t) => t.s === s);
    assert.ok(list.some((t) => !t.h), s);
    for (const t of list) if (t.a) assert.ok(ANIMATIONS[t.a], `${t.id}: ${t.a}`);
  }
});
