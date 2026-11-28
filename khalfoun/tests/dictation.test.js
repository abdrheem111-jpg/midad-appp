// Dictation, keyboard control and PDF pages: the «free control» features.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain, spokenPunctuation } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { recognize, takePage } from '../src/core/intents.js';
import { decide } from '../src/core/permissions.js';
import { validateAction } from '../src/main/actions/index.js';
import { createPlatform } from '../src/main/actions/platform.js';

function makeBrain(overrides = {}) {
  let now = new Date(2026, 10, 18, 9, 0).getTime();
  const brain = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 3, name: 'مريم', ...overrides }, clock: () => now, rng: () => 0.2 });
  return { brain, advance: (ms) => { now += ms; } };
}

test('spoken punctuation becomes real marks', () => {
  assert.equal(spokenPunctuation('السلام عليكم فاصلة كيف حالك علامة استفهام'), 'السلام عليكم، كيف حالك؟');
  assert.equal(spokenPunctuation('انتهى الدرس نقطة سطر جديد الواجب صفحة ١٠'), 'انتهى الدرس.\nالواجب صفحة ١٠');
  assert.equal(spokenPunctuation('ممتاز علامة تعجب'), 'ممتاز!');
  assert.equal(spokenPunctuation('ملاحظة نقطتين اقرأ'), 'ملاحظة: اقرأ');
});

test('dictation into the active window: each sentence typed, «امسح آخر جملة», «خلاص»', () => {
  const { brain } = makeBrain();
  const start = brain.hear('ابدأ الإملاء');
  assert.equal(start.situation, 'dictation_start');
  assert.equal(start.behavior, 'dictation_on');
  const a = brain.hear('السلام عليكم فاصلة');
  assert.deepEqual(a.action.params, { text: 'السلام عليكم، ' });
  assert.equal(a.say, null);
  assert.equal(brain.actionResult(a.action.id, { ok: true }), null); // quiet while dictating
  // Commands are not run while dictating: «افتح الحاسبة» is typed as words.
  assert.deepEqual(brain.hear('افتح الحاسبة يا اولاد').action, { id: brain.nextId - 1, type: 'type_text', params: { text: 'افتح الحاسبة يا اولاد ' } });
  const undo = brain.hear('امسح آخر جملة');
  assert.deepEqual([undo.action.type, undo.action.params.key], ['press_key', 'undo']);
  assert.equal(brain.hear('سطر جديد').action.params.text, '\n');
  const end = brain.hear('خلاص');
  assert.equal(end.situation, 'dictation_done');
  assert.equal(end.behavior, 'dictation_off');
  assert.equal(brain.dictation, null);
  assert.equal(brain.hear('افتح الحاسبة').action.type, 'open_app'); // back to commands
});

test('dictation asks once at the assistant level, is refused in kids mode and at the first level', () => {
  const { brain } = makeBrain({ level: 2, askFirst: true });
  const ask = brain.hear('خلني املي عليك');
  assert.equal(ask.awaitingConfirm, true);
  assert.equal(brain.hear('ايوه').situation, 'dictation_start');
  assert.equal(brain.hear('درس اليوم').action.params.text, 'درس اليوم '); // no yes per sentence
  assert.equal(makeBrain({ kidsMode: true }).brain.hear('ابدأ الإملاء').situation, 'kids_blocked');
  assert.equal(makeBrain({ level: 1 }).brain.hear('ابدأ الإملاء').situation, 'need_level');
});

test('dictation into a PDF collects lines and writes them on the chosen page at «خلاص»', () => {
  const { brain } = makeBrain();
  const start = brain.hear('املي عليك في البي دي اف الصفحة الثانية تحت');
  assert.equal(start.situation, 'dictation_start_pdf');
  const l1 = brain.hear('الاسم أحمد سعيد');
  assert.equal(l1.situation, 'dictation_line');
  assert.ok(l1.say.includes('أحمد'));
  brain.hear('الدرجة ١٨ من ٢٠');
  brain.hear('ملاحظة غلط');
  assert.equal(brain.hear('امسح آخر جملة').situation, 'dictation_removed');
  brain.hear('ممتاز علامة تعجب');
  const end = brain.hear('خلاص');
  assert.deepEqual(end.action.params, { text: 'الاسم أحمد سعيد\nالدرجة ١٨ من ٢٠\nممتاز!', position: 'bottom', page: 2 });
  assert.equal(brain.actionResult(end.action.id, { ok: true, data: {} }).situation, 'pdf_ok');
  // cancelling writes nothing
  brain.hear('املي عليك في البي دي اف');
  brain.hear('سطر');
  assert.equal(brain.hear('الغ الاملاء').situation, 'dictation_cancelled');
  assert.equal(brain.dictation, null);
});

test('window dictation ends by itself after ten quiet minutes', () => {
  const { brain, advance } = makeBrain();
  brain.hear('ابدأ الإملاء');
  advance(11 * 60000);
  assert.equal(brain.tick().situation, 'dictation_timeout');
  assert.equal(brain.dictation, null);
});

test('one-shot PDF writing understands the page and middle position', () => {
  assert.deepEqual(recognize('اكتب تم التصحيح في الصفحة الثانية من البي دي اف').slots, { text: 'تم التصحيح', position: 'top', page: 2 });
  assert.deepEqual(recognize('اكتب ممتاز في البي دي اف في الوسط').slots, { text: 'ممتاز', position: 'middle', page: 1 });
  assert.equal(recognize('اكتب ممتاز في الصفحة الأخيرة من البي دي اف').slots.page, 2000);
  assert.deepEqual(takePage('درجتك ١٠ في صفحة ٣'), { page: 3, rest: 'درجتك ١٠' });
});

test('keyboard by voice: phrases, risk and validation', () => {
  const cases = [['انسخ', 'copy'], ['الصق', 'paste'], ['احفظ', 'save'], ['سكر التبويب', 'close_tab'], ['تبويب جديد', 'new_tab'], ['تراجع', 'undo'],
    ['حدد الكل', 'select_all'], ['اضغط انتر', 'enter'], ['انزل في الصفحة', 'page_down'], ['سطح المكتب', 'show_desktop'], ['بدل النافذة', 'switch_window'],
    ['امسح آخر كلمة', 'delete_word'], ['يا خلفون انسخ لو سمحت', 'copy']];
  for (const [text, key] of cases) assert.deepEqual([recognize(text).intent, recognize(text).slots.key], ['key', key], text);
  assert.equal(recognize('تراجع عن الترتيب').intent, 'undo_organize');
  assert.equal(recognize('قصة جميلة').intent !== 'key', true);
  assert.equal(decide({ type: 'press_key', params: { key: 'copy' } }, { level: 2, askFirst: true }).confirm, false);
  assert.equal(decide({ type: 'press_key', params: { key: 'paste' } }, { level: 2, askFirst: true }).confirm, true);
  assert.equal(decide({ type: 'press_key', params: { key: 'paste' } }, { level: 2, askFirst: true, kidsMode: true }).allowed, false);
  assert.equal(validateAction({ type: 'press_key', params: { key: 'copy' } }), null);
  assert.equal(validateAction({ type: 'press_key', params: { key: '^%{DEL}' } }), 'bad_key');
  const { brain } = makeBrain();
  const r = brain.hear('انسخ');
  assert.deepEqual([r.action.type, r.action.params.key, r.situation], ['press_key', 'copy', 'key_ok']);
});

test('platform presses keys from the fixed list only', async () => {
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd, ...args]); return { ok: true, code: 0, stdout: '' }; };
  const p = createPlatform({ platform: 'win32', run, wait: async () => {}, shell: { openExternal: async () => {}, openPath: async () => '' }, paths: {} });
  assert.deepEqual(await p.pressKey('copy'), { ok: true });
  assert.ok(calls.at(-1).join(' ').includes("SendKeys('^c')"));
  await p.pressKey('show_desktop');
  assert.ok(calls.at(-1).join(' ').includes('ToggleDesktop'));
  assert.deepEqual(await p.pressKey('nope'), { ok: false, error: 'bad_key' });
});

import { Motion } from '../src/renderer/motion.js';

const area = { width: 1920, height: 1040 };
const size = { width: 170, height: 210 };
const runFor = (m, seconds, dt = 1 / 60) => { const ev = []; for (let t = 0; t < seconds; t += dt) ev.push(...m.update(dt)); return ev; };

test('movement phrases are understood', () => {
  const cases = [['روح يمين', 'right'], ['يسار', 'left'], ['روح اقصى اليمين', 'edge_right'], ['تعال الوسط', 'center'], ['اطلع فوق النافذة', 'up'],
    ['انزل تحت', 'down'], ['اثبت مكانك', 'stay'], ['لا تتحرك', 'stay'], ['تحرك براحتك', 'free'], ['اركض', 'run'], ['التفت', 'turn'], ['تعال عند الماوس', 'mouse']];
  for (const [text, dir] of cases) assert.deepEqual([recognize(text).intent, recognize(text).slots.dir], ['move', dir], text);
  assert.equal(recognize('انزل في الصفحة').intent, 'key');
  const { brain } = makeBrain();
  const r = brain.hear('روح يمين');
  assert.deepEqual([r.situation, r.behavior], ['move_right', 'move:right']);
  assert.equal(brain.hear('مرة ثانية').behavior, 'move:right');
});

test('motion: steps, edges, climbing onto a window and down, staying put', () => {
  const m = new Motion(area, size, () => 0.5);
  const x0 = m.x;
  assert.ok(m.step(260));
  runFor(m, 6);
  assert.equal(Math.round(m.x), Math.round(x0 + 260));
  m.toEdge(-1);
  runFor(m, 10);
  assert.equal(m.x, 0);
  assert.equal(m.climbDown(), false, 'already on the floor');
  assert.equal(m.climbUp(), false, 'no window in reach');
  m.setPlatforms([{ id: 3, x1: 0, x2: 700, y: area.height - 300 }]);
  assert.equal(m.climbUp(), true);
  const ev = runFor(m, 3);
  assert.ok(ev.some((e) => e.type === 'landed' && e.onWindow));
  assert.equal(m.support.id, 3);
  assert.equal(m.climbDown(), true);
  runFor(m, 3);
  assert.equal(m.support, null);
  m.stay();
  assert.equal(m.mode, 'focus');
  const before = m.x;
  m.nextRoamIn = 0;
  runFor(m, 20);
  assert.equal(m.x, before, 'stays put');
  m.free();
  assert.equal(m.focus, false);
  const f = m.facing;
  m.turn();
  assert.equal(m.facing, -f);
});

test('typing and keys bring the person\'s program forward first when Khalfoun had the focus', async () => {
  const calls = [];
  const run = async (cmd, args) => { calls.push(args.join(' ')); return { ok: true, code: 0, stdout: '' }; };
  const clipboard = { text: 'old', readText() { return this.text; }, writeText(t) { this.text = t; } };
  let target = 4242;
  const p = createPlatform({ platform: 'win32', run, wait: async () => {}, clipboard, beforeType: () => target, shell: { openExternal: async () => {}, openPath: async () => '' }, paths: {} });
  await p.typeText('مرحبا');
  assert.ok(calls.at(-1).includes('AppActivate(4242)') && calls.at(-1).includes("SendKeys('^v')"), calls.at(-1));
  await p.pressKey('copy');
  assert.ok(calls.at(-1).includes('AppActivate(4242)'));
  target = null; // Khalfoun did not have the focus: leave the window in front alone
  await p.pressKey('copy');
  assert.ok(!calls.at(-1).includes('AppActivate'), calls.at(-1));
  assert.equal(clipboard.text, 'old', 'clipboard restored');
});
