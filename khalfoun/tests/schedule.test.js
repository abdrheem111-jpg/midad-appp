// The teacher's timetable and weekday reminders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClassEntry, parseDays, nextClass, dueClasses, classesOn, schoolHour } from '../src/core/schedule.js';
import { parseClock, clockToTime } from '../src/core/arabic.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { recognize } from '../src/core/intents.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime(); // Nov 2026: 15 = Sunday, 18 = Wednesday

test('timetable entries the way teachers say them', () => {
  assert.deepEqual(parseClassEntry('كل أحد الساعة ٨ عندي حصة رياضيات وافتح البوربوينت'), { days: [0], hour: 8, minute: 0, subject: 'رياضيات', command: 'افتح البوربوينت' });
  assert.deepEqual(parseClassEntry('كل يوم الساعة ٧ ونص عندي حصة علوم الصف الخامس'), { days: [0, 1, 2, 3, 4], hour: 7, minute: 30, subject: 'علوم الصف الخامس', command: null });
  assert.deepEqual(parseClassEntry('عندي حصة عربي يوم الاثنين والأربعاء الساعة ١٠').days, [1, 3]);
  assert.equal(parseClassEntry('يوم الخميس الساعه ١ درس انجليزي و افتح الوورد').hour, 13);
  assert.equal(parseClassEntry('عندي حصة'), null);
  assert.deepEqual(parseDays('الأحد والثلاثاء'), [0, 2]);
  assert.equal(schoolHour({ hour: 2, period: null }), 14);
  assert.equal(schoolHour({ hour: 9, period: null }), 9);
});

test('today, the next class, and the five-minute warning (once a day)', () => {
  const schedule = [
    { id: 'a', days: [3], hour: 8, minute: 0, subject: 'رياضيات' },
    { id: 'b', days: [3], hour: 10, minute: 30, subject: 'علوم' },
    { id: 'c', days: [4], hour: 9, minute: 0, subject: 'عربي' },
  ];
  assert.deepEqual(classesOn(schedule, new Date(at(18, 6))).map((c) => c.subject), ['رياضيات', 'علوم']);
  const next = nextClass(schedule, at(18, 9));
  assert.deepEqual([next.entry.subject, next.minutes, next.dayOffset], ['علوم', 90, 0]);
  assert.equal(nextClass(schedule, at(18, 11)).entry.subject, 'عربي');
  assert.deepEqual(dueClasses(schedule, at(18, 10, 26)).map((c) => c.id), ['b']);
  assert.deepEqual(dueClasses(schedule, at(18, 10, 20)), []);
  assert.deepEqual(dueClasses([{ ...schedule[1], notified: new Date(at(18, 10)).toDateString() }], at(18, 10, 26)), []);
});

test('weekday reminders: «ذكرني يوم الثلاثاء الساعة ٧ الصبح بالواجب»', () => {
  const r = recognize('ذكرني يوم الثلاثاء الساعة ٧ الصبح بالواجب');
  assert.equal(r.slots.note, 'الواجب');
  assert.equal(clockToTime(r.slots.clock, at(18, 10)), at(24, 7));
  assert.equal(clockToTime(parseClock('يوم الاربعاء الساعه ٩ الصبح'), at(18, 10)), at(25, 9));
  assert.equal(clockToTime(parseClock('يوم الاربعاء الساعه ١١ الصبح'), at(18, 10)), at(18, 11));
});

test('brain: add, ask, warn before class and run its command', () => {
  let now = at(18, 7, 0);
  let saved = null;
  const b = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 3 }, clock: () => now, rng: () => 0.2, onMemoryChange: (d) => { saved = d; } });
  assert.equal(b.hear('الحصة الجاية').situation, 'schedule_empty');
  const add = b.hear('كل يوم الساعة ٨ عندي حصة رياضيات وافتح البوربوينت');
  assert.equal(add.situation, 'schedule_added_cmd');
  assert.equal(saved.schedule.length, 1);
  b.hear('عندي حصة علوم يوم الأربعاء الساعة ١٠');
  const today = b.hear('شو عندي اليوم');
  assert.ok(today.say.includes('رياضيات') && today.say.includes('علوم'), today.say);
  assert.ok(b.hear('الحصة الجاية').say.includes('رياضيات'));
  now = at(18, 7, 56);
  const warn = b.tick();
  assert.equal(warn.situation, 'class_soon');
  assert.ok(warn.say.includes('رياضيات'));
  assert.equal(warn.more, true);
  assert.deepEqual(b.continueQueue().action.params, { app: 'powerpoint' });
  now = at(18, 7, 57);
  assert.notEqual(b.tick()?.situation, 'class_soon', 'only once a day');
  assert.ok(b.hear('جدولي').say.includes('الأربعاء'));
  assert.equal(b.hear('الغ حصة العلوم').situation, 'schedule_removed');
  assert.equal(b.hear('امسح الجدول').situation, 'schedule_cleared');
});
