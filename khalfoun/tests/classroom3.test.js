import test from 'node:test';
import assert from 'node:assert/strict';
import { Classroom } from '../src/core/classroom.js';
import { weeklyReport } from '../src/core/report.js';
import { Inbox } from '../src/core/inbox.js';
import { buildXlsx } from '../src/main/office/xlsx.js';

const DAY = 86400000;

test('fair pick: who took part less is more likely, nobody twice in a round, and «ليش هو؟» explains', () => {
  const now = Date.UTC(2026, 10, 26, 8);
  const counts = { أحمد: 0, سالم: 0, مريم: 0 };
  for (let k = 0; k < 3000; k += 1) {
    const room = new Classroom({ students: ['أحمد', 'سالم', 'مريم'] });
    for (let i = 0; i < 6; i += 1) room.note('أحمد', 'star', now - DAY); // أحمد took part a lot
    counts[room.pick(Math.random, now).name] += 1;
  }
  assert.ok(counts.سالم > counts.أحمد * 3, JSON.stringify(counts));
  assert.ok(counts.أحمد > 0); // still a chance
  const room = new Classroom({ students: ['أحمد', 'سالم', 'مريم'] });
  const seen = new Set([1, 2, 3].map(() => room.pick(Math.random, now).name));
  assert.equal(seen.size, 3);
  assert.match(new Classroom({ students: ['أحمد', 'سالم'] }).why('سالم', now), /ما شارك ولا مرة/);
  // the log survives saving
  const again = new Classroom(JSON.parse(JSON.stringify(room)));
  assert.equal(again.log.filter((e) => e.k === 'pick').length, 3);
});

test('stars: every 5th is a bigger celebration, every 10th the biggest', () => {
  const room = new Classroom({ students: ['أحمد'] });
  const levels = [];
  for (let i = 0; i < 10; i += 1) levels.push(room.award('أحمد', 1).level);
  assert.deepEqual(levels, [1, 1, 1, 1, 2, 1, 1, 1, 1, 3]);
  assert.equal(room.award('أحمد', -1).level, 0);
});

test('weekly report: attendance, taking part, stars and approved grades; never a judgement on too little data', async () => {
  const now = new Date(2026, 10, 26, 12).getTime(); // a Thursday
  const room = new Classroom({ students: ['أحمد', 'سالم', 'مريم'] });
  for (let i = 0; i < 4; i += 1) room.note('أحمد', 'star', now - i * DAY, { d: 1 });
  room.note('أحمد', 'grade', now - DAY, { score: 8, total: 10 });
  room.note('سالم', 'pick', now - 2 * DAY);
  const att = { days: { '2026-11-25': { absent: ['مريم'], late: ['سالم'] }, '2026-11-24': { absent: ['مريم'], late: [] } } };
  const rep = weeklyReport(room.toJSON(), att, { now });
  const row = (n) => rep.rows.find((r) => r[0] === n);
  assert.deepEqual(row('أحمد').slice(1, 8), [2, 0, 0, 4, 4, 0, '80٪']);
  assert.equal(row('سالم')[8], 'بيانات قليلة هالأسبوع');
  assert.equal(row('مريم')[2], 2);
  assert.match(rep.summary, /شارك منهم ٢|شارك منهم 2/);
  const xlsx = await buildXlsx({ title: rep.title, columns: rep.columns, rows: rep.rows });
  assert.equal(xlsx.subarray(0, 2).toString(), 'PK'); // a real workbook
});

test('phone inbox: items wait for the teacher, an answer is taken once, old ones go', () => {
  let t = 1000;
  const box = new Inbox(() => t);
  const it = box.add({ kind: 'grade', title: 'تصحيح: أحمد — ٨ من ١٠', actions: [{ id: 'approve', label: 'اعتمد', main: true }], data: { score: 8 } });
  assert.equal(box.list()[0].data, undefined); // private data stays on the PC
  assert.equal(box.add({ kind: 'hack', title: 'x' }), null);
  assert.equal(box.act(it.id, 'delete_all'), null);
  assert.equal(box.act(it.id, 'approve').data.score, 8);
  assert.equal(box.act(it.id, 'approve'), null);
  box.add({ kind: 'suggest', title: 'سؤال تحقق؟' });
  assert.deepEqual(box.add({ kind: 'note', title: 'x' }).actions, [{ id: 'dismiss', label: 'تمام' }]);
  t += 4 * 60 * 60 * 1000;
  assert.equal(box.list().length, 0);
});
