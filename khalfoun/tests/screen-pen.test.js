// Seeing the screen exactly (word positions), marking words where they are, the pen by voice,
// and the Word fixes found while testing on the teacher's PC (Arabic bold, maths direction,
// drawings that split sentences).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recognize } from '../src/core/intents.js';
import { findOnScreen, layoutHint, cleanWord } from '../src/core/screen-find.js';
import { parseOcrOutput, ocrScript } from '../src/main/ocr.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { decide } from '../src/core/permissions.js';
import { validateAction, createExecutor } from '../src/main/actions/index.js';
import { ANIMATIONS } from '../src/renderer/animations.js';
import { TEMPLATES } from '../src/core/templates/ar-om.js';
import { screenPrompt } from '../src/main/cloud.js';
import { shapeItems } from '../src/main/office/index.js';

const START = new Date(2026, 10, 21, 9, 0).getTime();
const brain = () => new Brain({ memoryData: { ...defaultMemory(START), onboarded: true, level: 3 }, clock: () => START, rng: () => 0.1 });

// Words as Windows OCR gives them: Arabic lines may list words left to right.
const WORDS = [
  { line: 0, x: 900, y: 100, w: 120, h: 40, text: 'السلام' },
  { line: 0, x: 780, y: 100, w: 100, h: 40, text: 'عليكم' },
  { line: 1, x: 860, y: 200, w: 90, h: 36, text: 'دورة' },
  { line: 1, x: 760, y: 200, w: 90, h: 36, text: 'الماء،' },
  { line: 2, x: 700, y: 300, w: 60, h: 36, text: 'والماء' },
  { line: 3, x: 300, y: 400, w: 50, h: 36, text: '٢٥' },
];

test('a word on the screen is found where it is, with or without «ال» and punctuation', () => {
  const hits = findOnScreen(WORDS, 'الماء');
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { x: 760, y: 200, w: 90, h: 36, text: 'الماء،' });
  assert.equal(findOnScreen(WORDS, 'ماء').length, 2);
  // two words next to each other, in either order
  assert.deepEqual(findOnScreen(WORDS, 'دورة الماء')[0], { x: 760, y: 200, w: 190, h: 36, text: 'دورة الماء،' });
  // digits read either way
  assert.equal(findOnScreen(WORDS, '25')[0].x, 300);
  // a high-resolution screen: screenshot pixels to window pixels
  assert.deepEqual(findOnScreen(WORDS, 'السلام', { scale: 2 })[0], { x: 450, y: 50, w: 60, h: 20, text: 'السلام' });
  assert.deepEqual(findOnScreen(WORDS, 'النخلة'), []);
  assert.equal(cleanWord('«الماءُ»'), 'الماء');
  assert.match(layoutHint(WORDS), /\(780,100 240×40\) السلام عليكم/);
});

test('the screen reader prints word boxes when asked, and they are read back', () => {
  assert.match(ocrScript('C:\\x.png', { words: true }), /#W '/);
  assert.doesNotMatch(ocrScript('C:\\x.png'), /#W/);
  const r = parseOcrOutput('#LANG ar\nالسلام عليكم\n#W 0 900 100 120 40 السلام\n#W 0 780 100 100 40 عليكم\n');
  assert.equal(r.data.text, 'السلام عليكم');
  assert.deepEqual(r.data.words[1], { line: 0, x: 780, y: 100, w: 100, h: 40, text: 'عليكم' });
});

test('«حط دايرة على كلمة الماء» reads the screen and circles the word there', () => {
  const b = brain();
  const r = b.hear('حط دايرة على كلمة الماء');
  assert.equal(r.action.type, 'find_on_screen');
  assert.deepEqual(r.action.params, { text: 'الماء' });
  assert.equal(validateAction(r.action), null);
  assert.equal(decide(r.action, { level: 3 }).allowed !== false, true);
  const done = b.actionResult(r.action.id, { ok: true, data: { boxes: [{ x: 10, y: 20, w: 30, h: 40, text: 'الماء' }] } });
  assert.equal(done.situation, 'screen_found');
  assert.deepEqual(done.ink, { marks: [{ x: 10, y: 20, w: 30, h: 40, text: 'الماء' }], mark: 'circle', color: 'red' });
  const none = b.hear('ظلل كلمة النخلة');
  assert.equal(none.action.type, 'find_on_screen');
  const miss = b.actionResult(none.action.id, { ok: true, data: { boxes: [] } });
  assert.equal(miss.situation, 'screen_find_none');
  assert.match(miss.say, /النخلة/);
  const under = recognize('حط خط تحت كلمة الكسور');
  assert.deepEqual([under.intent, under.slots.mark], ['screen_find', 'underline']);
  assert.equal(validateAction({ type: 'find_on_screen', params: { text: '' } }), 'bad_text');
});

test('the executor asks main to find the words', async () => {
  let asked;
  const exec = createExecutor({ platform: {}, getSettings: () => ({ level: 3 }), findOnScreen: async (t) => { asked = t; return { ok: true, data: { boxes: [] } }; } });
  const r = await exec.run({ type: 'find_on_screen', params: { text: 'الماء' } });
  assert.equal(asked, 'الماء');
  assert.equal(r.ok, true);
});

test('the pen changes colour and thickness by voice', () => {
  const b = brain();
  for (const [said, color] of [['لون القلم أخضر', 'green'], ['خلي القلم أحمر', 'red'], ['غير لون القلم للأزرق', 'blue'], ['قلم أصفر', 'yellow']]) {
    const r = b.hear(said);
    assert.equal(r.pen, true, said);
    assert.deepEqual(r.penStyle, { color, width: null }, said);
    assert.equal(r.situation, 'pen_color');
  }
  const thick = b.hear('قلم عريض');
  assert.deepEqual([thick.penStyle.width, thick.situation], [10, 'pen_thick']);
  // «لون الخط احمر» is still the Word text colour
  assert.equal(recognize('لون الخط احمر').intent, 'office_format');
});

test('he holds a marker when writing: the animation exists and every new reply is valid', () => {
  assert.equal(ANIMATIONS.write.pose(1.2, 1).pen, true);
  assert.equal(ANIMATIONS.write.pose(2.4, 1).armL, 0);
  for (const s of ['screen_finding', 'screen_found', 'screen_found_many', 'screen_find_none', 'pen_color', 'pen_thick', 'pen_thin']) {
    const list = TEMPLATES.filter((t) => t.s === s);
    assert.ok(list.length, s);
    for (const t of list) assert.ok(!t.a || ANIMATIONS[t.a], `${t.id}: ${t.a}`);
  }
});

test('the cloud eyes get the screen size and the words with their places', () => {
  const p = screenPrompt('حل المسألة', { width: 2560, height: 1440, layout: '(10,20 300×40) س + ٢ = ٥' });
  assert.match(p, /2560×1440/);
  assert.match(p, /س \+ ٢ = ٥/);
  assert.match(p, /حل المسألة/);
});

test('Word fixes from the live test: Arabic bold, right-to-left maths, drawings on their own lines', async () => {
  const ps = await readFile(new URL('../src/main/office/office-host.ps1', import.meta.url), 'utf8');
  // Arabic text keeps its bold and size apart (BoldBi, SizeBi): both are set.
  assert.match(ps, /function Word-Flip/);
  assert.match(ps, /\$font\.\(\$name \+ 'Bi'\) = \$v/);
  assert.match(ps, /\$font\.SizeBi = \$size/);
  // Arabic maths goes in as a centred right-to-left line, not Word's left-to-right equation.
  assert.match(ps, /\$shown -match '\[\\u0600-\\u06FF\]'/);
  // Drawings: no more inline canvas at the cursor (it split the sentence).
  assert.doesNotMatch(ps, /AddCanvas/);
  assert.match(ps, /function Draw-Word/);
  assert.match(ps, /WrapFormat\.Type = 4/);
  // A circle is a circle, not an oval squeezed into the area.
  assert.equal(shapeItems({ shape: 'circle', color: 'red' })[0].square, true);
});
