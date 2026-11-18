import test from 'node:test';
import assert from 'node:assert/strict';
import { recognize } from '../src/core/intents.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { ReminderScheduler } from '../src/main/reminders.js';
import { validateAction } from '../src/main/actions/index.js';

const DAY = 24 * 3600e3;
const MIN = 60e3;

// ------------------------------------------------------- recurring reminders

for (const [text, minutes, note, repeat] of [
  ['ذكرني كل ساعة اشرب ماي', 60, 'اشرب ماي', true],
  ['ذكرني كل نص ساعة اقوم اتحرك', 30, 'اقوم اتحرك', true],
  ['ذكرني كل عشرين دقيقة بالشاشة', 20, 'الشاشة', true],
  ['ذكرني بعد ساعة بالدواء', 60, 'الدواء', false],
]) {
  test(`reminder: "${text}"`, () => {
    const r = recognize(text);
    assert.equal(r.intent, 'reminder');
    assert.deepEqual([r.slots.minutes, r.slots.note, r.slots.repeat], [minutes, note, repeat]);
  });
}

test('cancel reminders and routines are understood', () => {
  assert.equal(recognize('الغ التذكيرات').intent, 'cancel_reminders');
  assert.equal(recognize('وقف التذكير').intent, 'cancel_reminders');
  assert.equal(recognize('لا تفتح شي لحالك').intent, 'clear_routines');
});

function brainAt(t, extra = {}) {
  let now = t;
  const b = new Brain({ memoryData: { ...defaultMemory(t), onboarded: true, level: 2, name: 'سعيد', ...extra }, clock: () => now, rng: () => 0.3 });
  return { b, set: (x) => { now = x; }, get now() { return now; } };
}

test('a repeating reminder is planned with repeat, too-frequent ones are refused', () => {
  const { b } = brainAt(new Date(2026, 10, 10, 9).getTime());
  const r = b.hear('ذكرني كل ساعة اشرب ماي');
  assert.deepEqual(r.action.params, { minutes: 60, note: 'اشرب ماي', repeat: true });
  assert.match(r.say, /كل ساعة/);
  assert.equal(b.hear('ذكرني كل دقيقتين').situation, 'reminder_too_often');
  const c = b.hear('الغ التذكيرات');
  assert.equal(c.action.type, 'cancel_reminders');
  assert.match(b.actionResult(c.action.id, { ok: true, data: { cancelled: 2 } }).say, /تذكيرين/);
  const c2 = b.hear('الغ التذكيرات');
  assert.equal(b.actionResult(c2.action.id, { ok: true, data: { cancelled: 0 } }).situation, 'reminders_none');
});

test('main refuses malformed or too-frequent repeating reminders', () => {
  assert.equal(validateAction({ type: 'reminder', params: { minutes: 60, repeat: true } }), null);
  assert.equal(validateAction({ type: 'reminder', params: { minutes: 2, repeat: true } }), 'bad_reminder');
  assert.equal(validateAction({ type: 'reminder', params: { minutes: 60, repeat: 'yes' } }), 'bad_reminder');
  assert.equal(validateAction({ type: 'cancel_reminders', params: {} }), null);
});

function fakeTimers() {
  let now = 1_000_000;
  const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, done: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.done = true; },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((t) => !t.done && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.done = true;
        next.fn();
      }
      now = end;
    },
  };
}

function memStore(initial) {
  let data = initial;
  return { read: async () => data, write: async (d) => { data = JSON.parse(JSON.stringify(d)); }, get data() { return data; } };
}

test('reminder scheduler fires once, repeats, and saves its list', async () => {
  const clock = fakeTimers();
  const store = memStore({ items: [] });
  const fired = [];
  const s = new ReminderScheduler({ store, onFire: (r) => fired.push(r.note), ...clock });
  s.add({ minutes: 10, note: 'مرة' });
  s.add({ minutes: 30, note: 'كل نص ساعة', repeat: true });
  assert.equal(store.data.items.length, 2);
  clock.advance(10 * MIN);
  assert.deepEqual(fired, ['مرة']);
  assert.equal(store.data.items.length, 1, 'one-off reminder removed after firing');
  clock.advance(60 * MIN);
  assert.deepEqual(fired, ['مرة', 'كل نص ساعة', 'كل نص ساعة']);
  assert.equal(s.cancelAll(), 1);
  clock.advance(120 * MIN);
  assert.equal(fired.length, 3, 'nothing after cancelling');
  assert.deepEqual(store.data.items, []);
});

test('reminders survive a restart; overdue ones fire at once', async () => {
  const clock = fakeTimers();
  const store = memStore({ items: [
    { id: 4, at: clock.now() - 5 * MIN, minutes: 10, note: 'فات وقته', repeat: false },
    { id: 7, at: clock.now() + 20 * MIN, minutes: 60, note: 'بعدين', repeat: true },
    { id: 9, at: 'bad' },
  ] });
  const fired = [];
  const s = new ReminderScheduler({ store, onFire: (r) => fired.push(r.note), ...clock });
  assert.equal(await s.restore(), 2, 'broken entries are dropped');
  clock.advance(1);
  assert.deepEqual(fired, ['فات وقته']);
  clock.advance(20 * MIN);
  assert.deepEqual(fired, ['فات وقته', 'بعدين']);
  assert.equal(s.add({ minutes: 1 }).id, 8, 'new ids continue after saved ones');
});

// ------------------------------------------------------------------- habits

test('after opening the same app around the same hour on three days he offers to do it himself', () => {
  const t0 = new Date(2026, 10, 9, 8, 10).getTime();
  const h = brainAt(t0);
  for (let day = 0; day < 3; day += 1) {
    h.set(t0 + day * DAY + day * 7 * MIN);
    const r = h.b.hear('افتح المتصفح');
    const done = h.b.actionResult(r.action.id, { ok: true });
    if (day < 2) assert.equal(done, null);
    else {
      assert.equal(done.situation, 'routine_offer');
      assert.match(done.say, /المتصفح/);
      assert.equal(done.awaitingConfirm, true);
    }
  }
  const saved = h.b.hear('ايوه');
  assert.equal(saved.situation, 'routine_saved');
  assert.equal(h.b.memory.data.routines.length, 1);
  // next morning: the routine runs once
  h.set(t0 + 3 * DAY + 20 * MIN);
  const due = h.b.dueRoutines();
  assert.equal(due.length, 1);
  assert.equal(due[0].type, 'open_app');
  assert.equal(h.b.actionResult(due[0].id, { ok: true }), null, 'routine runs quietly');
  assert.equal(h.b.dueRoutines().length, 0, 'only once a day');
  h.set(t0 + 3 * DAY + 6 * 3600e3);
  assert.equal(h.b.dueRoutines().length, 0, 'not at other hours');
  assert.equal(h.b.hear('الغ العادات').situation, 'routines_cleared');
  h.set(t0 + 4 * DAY);
  assert.equal(h.b.dueRoutines().length, 0);
});

test('saying no to the offer means he never asks about it again', () => {
  const t0 = new Date(2026, 10, 9, 20, 0).getTime();
  const h = brainAt(t0);
  let offer;
  for (let day = 0; day < 3; day += 1) {
    h.set(t0 + day * DAY);
    const r = h.b.hear('شغل يوتيوب');
    offer = h.b.actionResult(r.action.id, { ok: true });
  }
  assert.equal(offer.situation, 'routine_offer');
  assert.equal(h.b.hear('لا').situation, 'cancelled');
  h.set(t0 + 3 * DAY);
  const r = h.b.hear('شغل يوتيوب');
  assert.equal(h.b.actionResult(r.action.id, { ok: true }), null);
});

test('routines respect the current permission level', () => {
  const t0 = new Date(2026, 10, 9, 8, 0).getTime();
  const h = brainAt(t0, { routines: [{ key: 'open_app:browser', hour: 8, action: { type: 'open_app', params: { app: 'browser' } }, lastRun: '' }] });
  h.b.memory.set({ level: 1 });
  assert.equal(h.b.dueRoutines().length, 0, 'no routines at the lowest level');
  h.b.memory.set({ level: 2 });
  assert.equal(h.b.dueRoutines().length, 1);
});
