// The AI notebook and Khalfoun's own tools (whiteboard, notebook).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Notebook, cleanNotebook, parseCards, offlineSummary, keywords, autoTitle, readingInfo, BOX_DAYS } from '../src/core/notebook.js';
import { recognize } from '../src/core/intents.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { validateAction, createExecutor } from '../src/main/actions/index.js';
import { decide } from '../src/core/permissions.js';

const DAY = 86400000;

test('notes: add, edit, search with Arabic spelling variants, newest first, delete removes its cards', () => {
  let now = 1000;
  const nb = new Notebook(undefined, () => now);
  const a = nb.add({ title: 'الكسور', body: 'الكسرة العشرية' });
  now += 10;
  const b = nb.add({ body: 'المضاعفات المشتركة' });
  assert.deepEqual(nb.list().map((n) => n.id), [b.id, a.id]);
  assert.deepEqual(nb.list('العشريه').map((n) => n.id), [a.id]); // ة/ه
  assert.deepEqual(nb.list('الْكسور').map((n) => n.id), [a.id]); // diacritics
  now += 10;
  nb.update(a.id, { body: 'تغير' });
  assert.equal(nb.list()[0].id, a.id);
  nb.addCards(a.id, [{ q: 'س١؟', a: 'ج١' }]);
  assert.equal(nb.remove(a.id), true);
  assert.equal(nb.data.cards.length, 0);
});

test('cards from the model: several formats, duplicates skipped', () => {
  const text = 'س: ما هو الكسر العشري؟ | ج: كسر مقامه ١٠ أو قوى ١٠\nسؤال: كم عشراً في الواحد؟\nجواب: عشرة\n1. متى نقارن الكسور؟ — من اليسار\nكلام زائد';
  const cards = parseCards(text);
  assert.deepEqual(cards.map((c) => c.a), ['كسر مقامه ١٠ أو قوى ١٠', 'عشرة', 'من اليسار']);
  const nb = new Notebook(undefined, () => 0);
  const n = nb.add({ body: 'x' });
  assert.equal(nb.addCards(n.id, cards), 3);
  assert.equal(nb.addCards(n.id, cards), 0);
});

test('spaced repetition: right moves up a box and comes back later, wrong starts again', () => {
  let now = 0;
  const nb = new Notebook(undefined, () => now);
  const n = nb.add({ body: 'x' });
  nb.addCards(n.id, [{ q: 'سؤال؟', a: 'جواب' }]);
  const [card] = nb.dueCards();
  nb.review(card.id, true);
  assert.equal(nb.dueCards().length, 0);
  now += BOX_DAYS[1] * DAY;
  assert.equal(nb.dueCards().length, 1);
  nb.review(card.id, false);
  assert.equal(nb.data.cards[0].box, 0);
  assert.equal(nb.stats().cards, 1);
});

test('damaged notebook files are cleaned, not trusted', () => {
  const nb = cleanNotebook({ notes: [{ id: 'a', title: 5, body: 'x'.repeat(60000) }, null, { title: 'no id' }], cards: [{ note: 'zzz', q: 'q', a: 'a' }] });
  assert.equal(nb.notes.length, 1);
  assert.equal(nb.notes[0].body.length, 50000);
  assert.equal(nb.cards.length, 0);
  assert.deepEqual(cleanNotebook('broken'), { version: 1, notes: [], cards: [] });
});

test('offline helpers: summary keeps the key sentences in order, key words, title, reading time', () => {
  const text = 'الكسور العشرية تكتب بعد الفاصلة العشرية. الطقس اليوم جميل جداً في مسقط. الجزء من عشرة يسمى عشراً في الكسور العشرية. نقارن الكسور العشرية من اليسار. أكلت التمر مع القهوة في الصباح الباكر.';
  const s = offlineSummary(text, 2);
  assert.equal(s.length, 2);
  assert.ok(s.every((x) => /الكسور/.test(x)), s.join(' | '));
  assert.ok(keywords(text).includes('كسور'));
  assert.equal(autoTitle('\n  درس الكسور العشرية للصف الخامس اليوم والغد'), 'درس الكسور العشرية للصف الخامس اليوم');
  assert.deepEqual(readingInfo('كلمة '.repeat(360)), { words: 360, minutes: 2 });
});

test('«افتح السبورة», «دفتري», «سكر الدفتر», «راجع البطاقات», «اكتب في الدفتر»', () => {
  const cases = [
    ['افتح السبورة', 'open_tool', 'board'], ['سبورة الرياضيات', 'open_tool', 'board'], ['ابي السبورة', 'open_tool', 'board'], ['افتح مداد', 'open_tool', 'board'],
    ['افتح الدفتر', 'open_tool', 'notebook'], ['دفتري', 'open_tool', 'notebook'], ['راجع البطاقات', 'open_tool', 'notebook'], ['اكتب في الدفتر', 'open_tool', 'notebook'],
    ['سكر السبورة', 'close_tool', 'board'], ['سكر الدفتر', 'close_tool', 'notebook'],
  ];
  for (const [s, intent, tool] of cases) {
    const r = recognize(s);
    assert.deepEqual([r.intent, r.slots.tool], [intent, tool], s);
  }
  assert.equal(recognize('افتح الملاحظات').slots.app, 'notepad'); // Notepad stays Notepad
});

test('his own tools open at every permission level, even in kids mode, and pass main', () => {
  for (const level of [1, 2, 3]) {
    for (const kidsMode of [false, true]) {
      const a = { type: 'open_tool', params: { tool: 'board' } };
      assert.equal(validateAction(a), null);
      assert.equal(decide(a, { level, kidsMode }).allowed, true, `level ${level} kids ${kidsMode}`);
    }
  }
  assert.equal(validateAction({ type: 'open_tool', params: { tool: 'cmd.exe' } }), 'bad_tool');
});

test('the executor opens and closes tools through main', async () => {
  const opened = [];
  const ex = createExecutor({ platform: {}, getSettings: () => ({ level: 1, kidsMode: false }), openTool: (t) => { opened.push(t); return { ok: true }; }, closeTool: () => ({ ok: true }) });
  assert.deepEqual(await ex.run({ type: 'open_tool', params: { tool: 'notebook' } }), { ok: true });
  assert.deepEqual(opened, ['notebook']);
});

test('he reacts to what happens in the notebook, without talking over every card', () => {
  let r = 0.9;
  const brain = new Brain({ memoryData: { ...defaultMemory(0), onboarded: true, level: 3, name: 'عبدالرحيم' }, clock: () => 0, rng: () => r });
  assert.equal(brain.event('tool_done', { tool: 'notebook', mode: 'cards', ok: true }).situation, 'nb_done_cards');
  assert.equal(brain.event('tool_done', { tool: 'notebook', mode: 'summarize', ok: false }).situation, 'nb_failed');
  assert.equal(brain.event('tool_event', { what: 'card_right' }), null); // quiet most of the time
  r = 0.1;
  assert.equal(brain.event('tool_event', { what: 'card_right' }).situation, 'nb_card_right');
  const done = brain.event('tool_event', { what: 'review_done', count: 4 });
  assert.equal(done.situation, 'nb_review_done');
  assert.match(done.say, /٤/);
  assert.equal(brain.event('tool_event', { what: 'review_done', count: 0 }).situation, 'nb_review_zero');
  const open = brain.hear('افتح السبورة');
  assert.equal(open.action.type, 'open_tool');
});
