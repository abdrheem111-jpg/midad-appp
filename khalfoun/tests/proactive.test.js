import test from 'node:test';
import assert from 'node:assert/strict';
import { Suggester, LessonWatch, momentFromWords, routineCommand, routinePattern, dictionaryCommand, applyDictionary } from '../src/core/proactive.js';

test('suggestions: silent, at most one every N minutes, the same idea not again soon, and they can be off', () => {
  let t = 0; let on = true;
  const s = new Suggester({ now: () => t, enabled: () => on, everyMin: () => 10 });
  const a = s.moment('concept_done');
  assert.equal(a.kind, 'suggest');
  assert.deepEqual(a.actions.map((x) => x.id), ['do', 'dismiss']);
  assert.match(a.data.say, /quiz_make/);
  t += 5 * 60000; assert.equal(s.moment('long_talk'), null); // too soon
  t += 6 * 60000; assert.ok(s.moment('long_talk'));
  t += 11 * 60000; assert.equal(s.moment('concept_done'), null); // same idea within 30 minutes
  t += 30 * 60000; on = false; assert.equal(s.moment('review'), null);
  assert.equal(s.moment('nonsense'), null);
});

test('the lesson\'s moments: a long explanation, a new lesson, a common mistake, review words', () => {
  let t = 1e9;
  const w = new LessonWatch(() => t);
  assert.equal(w.command(), 'lesson_start'); // the first command of the day
  t += 60000; assert.equal(w.command(), null);
  let got = null;
  for (let i = 0; i < 80 && !got; i += 1) { t += 10000; got = w.talk(10000); }
  assert.equal(got, 'long_talk');
  t += 41 * 60000; assert.equal(w.command(), 'lesson_start');
  assert.equal(w.grade(3, 10), null); assert.equal(w.grade(9, 10), null); assert.equal(w.grade(2, 10), null);
  assert.equal(w.grade(4, 10), 'group_error');
  assert.equal(momentFromWords('خلونا نراجع الدرس'), 'review');
  assert.equal(momentFromWords('اغلبهم غلطوا في السؤال'), 'group_error');
  assert.equal(momentFromWords('افتح الوورد'), null);
});

test('routines by voice, and the commands he keeps doing together offered as one', () => {
  assert.deepEqual(routineCommand('سجل روتين ابدأ الحصة'), { op: 'start', name: 'ابدا الحصه' });
  assert.deepEqual(routineCommand('خلاص الروتين'), { op: 'end' });
  assert.deepEqual(routineCommand('احذف روتين ابدأ الحصة'), { op: 'delete', name: 'ابدا الحصه' });
  assert.deepEqual(routineCommand('ابدأ الحصة', { 'ابدا الحصه': { steps: [] } }), { op: 'run', name: 'ابدا الحصه' });
  assert.equal(routineCommand('ابدأ الحصة', {}), null);
  const D = 86400000; const t0 = Date.UTC(2026, 10, 20, 8);
  const h = [{ text: 'افتح ملف الدرس', at: t0 }, { text: 'شغل مؤقت ٥ دقايق', at: t0 + 60000 }];
  assert.equal(routinePattern(h, t0 + D), null); // once is not a habit
  const twice = [...h, { text: 'افتح ملف الدرس', at: t0 + D }, { text: 'شغل مؤقت ٥ دقايق', at: t0 + D + 30000 }];
  assert.deepEqual(routinePattern(twice, t0 + 2 * D).steps, ['افتح ملف الدرس', 'شغل مؤقت ٥ دقايق']);
  const far = [...h, { text: 'افتح ملف الدرس', at: t0 + D }, { text: 'شغل مؤقت ٥ دقايق', at: t0 + D + 10 * 60000 }];
  assert.equal(routinePattern(far, t0 + 2 * D), null); // not done together
});

test('the dialect dictionary: «لما أقول X أقصد Y», whole words only', () => {
  assert.deepEqual(dictionaryCommand('لما أقول الشنطة أقصد الملف'), { from: 'الشنطه', to: 'الملف' });
  assert.deepEqual(dictionaryCommand('صحح: السبوره يعني الشاشة'), { from: 'السبوره', to: 'الشاشه' });
  assert.equal(dictionaryCommand('افتح الملف'), null);
  assert.equal(applyDictionary('افتح الشنطة', { الشنطه: 'الملف' }), 'افتح الملف');
  assert.equal(applyDictionary('الشنطهات', { الشنطه: 'الملف' }), 'الشنطهات');
  assert.equal(applyDictionary('افتح الوورد', {}), 'افتح الوورد');
});
