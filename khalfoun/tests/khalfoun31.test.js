import test from 'node:test';
import assert from 'node:assert/strict';
import { LessonMemory, asksWhereWeStopped } from '../src/core/lesson-memory.js';
import { ANIMATIONS, MOVE_NAMES } from '../src/renderer/animations.js';
import { MORE_ANIMATIONS } from '../src/renderer/animations-more.js';
import { SIGNS, signFromWords, MARKS } from '../src/renderer/signs.js';
import { SIGN_NAMES } from '../src/core/sign-names.js';
import { currentClass } from '../src/core/schedule.js';
import { decide } from '../src/core/permissions.js';
import { recognize } from '../src/core/intents.js';
import { isFast } from '../src/core/fast-layer.js';
import { normalize } from '../src/core/arabic.js';

test('direct mode: modifying actions run at once at the assistant level; «اسأل قبل» brings the question back', () => {
  const type = { type: 'type_text', params: { text: 'x' } };
  assert.equal(decide(type, { level: 2 }).confirm, false);
  assert.equal(decide(type, { level: 3 }).confirm, false);
  assert.equal(decide(type, { level: 2, askFirst: true }).confirm, true);
  assert.equal(decide(type, { level: 1 }).allowed, false);
  assert.equal(decide(type, { level: 3, kidsMode: true }).allowed, false); // kids mode is still kids mode
});

test('lesson memory: what was taught, who took part, where we stopped; a new lesson after a period change or a long quiet', () => {
  let t = new Date(2026, 10, 24, 8, 0).getTime();
  const m = new LessonMemory({}, () => t);
  m.note('topic', 'حل 2x+3=11', 'رياضيات ٧أ');
  m.note('student', 'أحمد', 'رياضيات ٧أ');
  t += 10 * 60000; m.note('topic', 'رسم ص = س²', 'رياضيات ٧أ');
  assert.match(m.forClaude('رياضيات ٧أ'), /هالحصة لين الحين: حل 2x\+3=11، رسم ص = س²/);
  t += 5 * 60000; m.note('topic', 'تحليل x^2-9', 'رياضيات ٨ب'); // another class: the first lesson is kept
  assert.equal(m.episodes.length, 1);
  t += 60 * 60000; m.tick(); // a long quiet ends it
  assert.equal(m.episodes.length, 2);
  t = new Date(2026, 10, 25, 9, 0).getTime();
  const w = m.whereWeStopped('رياضيات ٧أ');
  assert.match(w, /آخر مرة أمس \(رياضيات ٧أ\) شرحنا: حل 2x\+3=11، رسم ص = س²/);
  assert.match(w, /وقفنا عند: رسم ص = س²/);
  assert.match(w, /شارك: أحمد/);
  const again = new LessonMemory(JSON.parse(JSON.stringify(m)), () => t);
  assert.equal(again.episodes.length, 2);
  assert.equal(new LessonMemory().whereWeStopped(), null);
  for (const q of ['وين وقفنا', 'وين وقفنا اخر مره', 'وش شرحنا امس', 'ذكرني وين وقفنا']) assert.ok(asksWhereWeStopped(normalize(q)), q);
  assert.equal(asksWhereWeStopped(normalize('وين الملف')), false);
});

test('the big library: 118+ moves all well-formed, signs and their names agree, words find them', () => {
  assert.ok(MOVE_NAMES.length >= 110, String(MOVE_NAMES.length));
  for (const [name, a] of Object.entries(ANIMATIONS)) {
    for (const t of [0, a.dur * 0.37, a.dur * 0.99, a.dur * 2.3]) {
      const p = a.pose(t);
      for (const [k, v] of Object.entries(p)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}.${k} at ${t}`);
    }
  }
  for (const a of Object.values(MORE_ANIMATIONS)) assert.ok(a.ar && a.dur > 0);
  assert.deepEqual(Object.keys(SIGNS).sort(), [...SIGN_NAMES].sort());
  assert.ok(SIGN_NAMES.length >= 35);
  assert.equal(signFromWords(normalize('ممتاز')), 'excellent');
  assert.equal(signFromWords(normalize('خلص الوقت')), 'time_up');
  assert.ok(MARKS.includes('circle') && MARKS.includes('stamp_correct'));
  for (const t of ['مطر ارقام', 'قوس قزح', 'حفلة كبيرة', 'العاب نارية']) assert.ok(isFast(recognize(t)), t);
});

test('the class going on now, from the timetable', () => {
  const sched = [{ days: [2], hour: 8, minute: 0, subject: 'رياضيات ٧أ' }, { days: [2], hour: 9, minute: 0, subject: 'رياضيات ٨ب' }];
  assert.match(currentClass(sched, new Date(2026, 10, 24, 8, 20).getTime()), /رياضيات ٧أ/);
  assert.match(currentClass(sched, new Date(2026, 10, 24, 9, 5).getTime()), /رياضيات ٨ب/);
  assert.equal(currentClass(sched, new Date(2026, 10, 24, 10, 30).getTime()), '');
});
