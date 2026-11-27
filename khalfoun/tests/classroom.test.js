// Classroom tools for the teacher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Classroom, parseNames, shuffle } from '../src/core/classroom.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { recognize } from '../src/core/intents.js';

const seeded = (seed = 9) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

test('class list from how teachers say it', () => {
  assert.deepEqual(parseNames('أحمد، سعيد، مريم و فاطمة'), ['أحمد', 'سعيد', 'مريم', 'فاطمة']);
  assert.deepEqual(recognize('أسماء الطلاب: أحمد، سعيد، مريم و فاطمة').slots.names, ['أحمد', 'سعيد', 'مريم', 'فاطمة']);
  assert.deepEqual(recognize('اسماء الطلاب احمد سعيد مريم').slots.names, ['احمد', 'سعيد', 'مريم']);
  const cases = [['اختار طالب', 'pick_student'], ['منو يجاوب', 'pick_student'], ['قرعة', 'pick_student'], ['النتائج', 'points_board'], ['صفر النقاط', 'points_reset'],
    ['وقف المؤقت', 'timer_stop'], ['اضف الطالب خالد', 'student_add'], ['احذف الطالب سعيد', 'student_remove']];
  for (const [t, intent] of cases) assert.equal(recognize(t).intent, intent, t);
  assert.deepEqual(recognize('قسمهم ٤ مجموعات').slots, { count: 4 });
  assert.deepEqual(recognize('قسم الصف الى ثلاث مجموعات').slots, { count: 3 });
  assert.deepEqual(recognize('مجموعات من ٣').slots, { size: 3 });
  assert.deepEqual(recognize('نجمة لأحمد').slots, { name: 'أحمد', delta: 1 });
  assert.deepEqual(recognize('نقطتين لمريم').slots, { name: 'مريم', delta: 2 });
  assert.deepEqual(recognize('زيد فاطمة ثلاث نقاط').slots, { name: 'فاطمة', delta: 3 });
  assert.deepEqual(recognize('نقص سعيد نقطة').slots, { name: 'سعيد', delta: -1 });
  assert.deepEqual(recognize('مؤقت ٥ دقايق').slots, { minutes: 5 });
  assert.deepEqual(recognize('عد تنازلي ربع ساعة').slots, { minutes: 15 });
  assert.equal(recognize('اكتب نقطة').intent, 'type_text');
  assert.equal(recognize('زيد').intent, 'repeat');
});

test('picking: nobody twice until everyone had a turn', () => {
  const room = new Classroom();
  room.setStudents(['أحمد', 'سعيد', 'مريم', 'فاطمة']);
  const rng = seeded(3);
  const first = [1, 2, 3, 4].map(() => room.pick(rng).name);
  assert.equal(new Set(first).size, 4);
  const next = room.pick(rng);
  assert.equal(next.newRound, true);
  assert.equal(new Classroom().pick(), null);
});

test('groups are even and contain everyone once', () => {
  const room = new Classroom();
  room.setStudents(['أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر']);
  const g = room.groups({ count: 3 }, seeded(5));
  assert.equal(g.length, 3);
  assert.deepEqual(g.map((x) => x.length).sort(), [3, 3, 4]);
  assert.equal(new Set(g.flat()).size, 10);
  assert.equal(room.groups({ size: 4 }, seeded(5)).length, 3);
  assert.equal(shuffle([1, 2, 3], () => 0).length, 3);
});

test('points: names matched loosely, never below zero, sorted board', () => {
  const room = new Classroom();
  room.setStudents(['أحمد', 'مريم']);
  assert.deepEqual(room.award('احمد', 2), { name: 'أحمد', points: 2, level: 1 });
  assert.deepEqual(room.award('مريم', 1), { name: 'مريم', points: 1, level: 1 });
  assert.deepEqual(room.award('مريم', -5), { name: 'مريم', points: 0, level: 0 });
  assert.deepEqual(room.award('خالد', 1), { name: 'خالد', points: 1, level: 1 }); // new name joins the class
  assert.deepEqual(room.board(), [{ name: 'أحمد', points: 2 }, { name: 'خالد', points: 1 }]);
  assert.equal(room.find('احمد'), 'أحمد');
});

test('brain: the whole classroom flow, saved in memory', () => {
  let saved = null;
  let now = new Date(2026, 10, 18, 9).getTime();
  const brain = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 2 }, clock: () => now, rng: seeded(7), onMemoryChange: (d) => { saved = d; } });
  assert.equal(brain.hear('اختار طالب').situation, 'pick_need_names');
  assert.equal(brain.hear('أسماء الطلاب: أحمد، سعيد، مريم، فاطمة، خالد، عائشة').situation, 'students_saved');
  const pick = brain.hear('منو يجاوب');
  assert.ok(['pick_result'].includes(pick.situation));
  assert.equal(pick.behavior, 'drumroll');
  assert.ok(['أحمد', 'سعيد', 'مريم', 'فاطمة', 'خالد', 'عائشة'].some((n) => pick.say.includes(n)), pick.say);
  const groups = brain.hear('قسمهم ٣ مجموعات');
  assert.equal(groups.long, true);
  assert.equal((groups.say.match(/المجموعة/g) || []).length, 3);
  const award = brain.hear('نجمة لأحمد');
  assert.equal(award.situation, 'award_ok');
  assert.equal(award.behavior, 'star');
  brain.hear('نقطتين لمريم');
  const board = brain.hear('النتائج');
  assert.ok(board.say.indexOf('مريم') < board.say.indexOf('أحمد'), board.say);
  assert.equal(saved.classroom.points['مريم'], 2);
  const timer = brain.hear('مؤقت ٥ دقايق');
  assert.deepEqual([timer.situation, timer.behavior], ['timer_started', 'timer:300']);
  assert.equal(brain.event('timer_done').situation, 'timer_done');
  assert.equal(brain.hear('مؤقت').situation, 'timer_no_time');
  assert.equal(brain.hear('وقف المؤقت').behavior, 'timer:stop');
  assert.equal(brain.hear('صفر النقاط').situation, 'points_cleared');
  assert.equal(brain.hear('النتائج').situation, 'board_empty');
  // «اكتبها» after groups types the list
  brain.hear('قسمهم ٢ مجموعات');
  const ask = brain.hear('اكتبها');
  assert.equal(ask.awaitingConfirm, true);
  assert.ok(brain.hear('ايوه').action.params.text.startsWith('المجموعة ١'));
});
