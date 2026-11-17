// Conversation context and learning: follow-ups, repeating, several commands
// in one sentence, «تقصد ...؟», closing apps, and phrases the person teaches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { createPlatform } from '../src/main/actions/platform.js';
import { validateAction } from '../src/main/actions/index.js';
import { decide } from '../src/core/permissions.js';

const seeded = (seed = 5) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function makeBrain(overrides = {}) {
  let now = new Date(2026, 10, 17, 9, 0, 0).getTime();
  let saved = null;
  const brain = new Brain({
    memoryData: { ...defaultMemory(now), onboarded: true, level: 3, name: 'مريم', humor: 1, ...overrides },
    clock: () => now, rng: seeded(11), onMemoryChange: (d) => { saved = d; },
  });
  return { brain, advance: (ms) => { now += ms; }, saved: () => saved };
}

/** Says a sentence and, like the shell, reports a successful action. */
function sayOk(brain, text) {
  const r = brain.hear(text);
  const follow = r?.action ? brain.actionResult(r.action.id, { ok: true }) : null;
  return { r, follow };
}

test('«سكرها» closes what he opened last; with nothing opened he asks which', () => {
  const { brain } = makeBrain();
  assert.equal(brain.hear('سكرها').situation, 'close_which');
  const open = sayOk(brain, 'افتح الحاسبة').r;
  assert.deepEqual(open.action.params, { app: 'calculator' });
  const close = brain.hear('سكرها');
  assert.equal(close.situation, 'close_ok');
  assert.equal(close.action.type, 'close_app');
  assert.deepEqual(close.action.params, { app: 'calculator' });
  assert.ok(close.say.includes('الحاسبة'), close.say);
});

test('closing by name, a closed app, and a website that lives in a tab', () => {
  const { brain } = makeBrain();
  const c = brain.hear('سكر المفكرة');
  assert.deepEqual([c.action.type, c.action.params.app], ['close_app', 'notepad']);
  assert.equal(brain.actionResult(c.action.id, { ok: false, error: 'not_running' }).situation, 'close_not_running');
  assert.equal(brain.hear('سكر اليوتيوب').situation, 'close_tab');
});

test('closing asks first at the assistant level, runs directly at full trust', () => {
  assert.deepEqual(decide({ type: 'close_app', params: { app: 'word' } }, { level: 2 }), { allowed: true, confirm: true, reason: 'modify_needs_yes' });
  assert.equal(decide({ type: 'close_app', params: { app: 'word' } }, { level: 3 }).confirm, false);
  assert.equal(decide({ type: 'close_app', params: { app: 'word' } }, { level: 2, kidsMode: true }).allowed, false);
  const { brain } = makeBrain({ level: 2 });
  const ask = brain.hear('سكر الوورد');
  assert.equal(ask.awaitingConfirm, true);
  assert.equal(brain.hear('ايوه').action.type, 'close_app');
});

test('«افتحه» opens the last app again; «مرة ثانية» repeats the last command', () => {
  const { brain, advance } = makeBrain();
  assert.equal(brain.hear('افتحه').situation, 'open_which');
  assert.equal(brain.hear('مره ثانيه').situation, 'repeat_nothing');
  sayOk(brain, 'افتح المفكرة');
  sayOk(brain, 'سكرها');
  assert.deepEqual(brain.hear('افتحها').action.params, { app: 'notepad' });
  const up = brain.hear('ارفع الصوت');
  assert.equal(up.action.params.direction, 'up');
  const again = brain.hear('زيد');
  assert.equal(again.action.type, 'volume');
  assert.equal(again.action.params.direction, 'up');
  advance(11 * 60000);
  assert.equal(brain.hear('زيد').situation, 'repeat_nothing');
});

test('several commands in one sentence run one after another', () => {
  const { brain } = makeBrain();
  const first = brain.hear('افتح الحاسبة وبعدين المفكرة');
  assert.deepEqual(first.action.params, { app: 'calculator' });
  assert.equal(first.more, true);
  const second = brain.continueQueue();
  assert.deepEqual(second.action.params, { app: 'notepad' });
  assert.ok(!second.more);
  assert.equal(brain.continueQueue(), null);
  const three = brain.hear('ارفع الصوت وبعدين قول نكتة');
  assert.equal(three.action.type, 'volume');
  assert.equal(brain.continueQueue().situation, 'joke');
  // Text to type stays whole.
  const typed = brain.hear('اكتب انا و انت');
  assert.equal(typed.action.params.text, 'انا و انت');
  assert.ok(!typed.more);
});

test('a near-miss app name gets «تقصد ...؟», and yes opens it', () => {
  const { brain } = makeBrain();
  const ask = brain.hear('افتح الحاسوب');
  assert.equal(ask.situation, 'suggest_app');
  assert.ok(ask.say.includes('الحاسبة'), ask.say);
  const yes = brain.hear('ايوه');
  assert.deepEqual(yes.action.params, { app: 'calculator' });
  const ask2 = brain.hear('افتح الحاسوب');
  assert.equal(ask2.situation, 'suggest_app');
  assert.equal(brain.hear('لا').situation, 'cancelled');
});

test('the person teaches a phrase, and it works from then on (and is saved)', () => {
  const { brain, saved } = makeBrain();
  const taught = brain.hear('لما اقول صباحو يعني افتح المتصفح');
  assert.equal(taught.situation, 'learn_saved');
  const used = brain.hear('صباحو');
  assert.deepEqual(used.action.params, { app: 'browser' });
  assert.equal(brain.hear('يا خلفون صباحو').action.params.app, 'browser');
  assert.equal(Object.values(saved().aliases)[0], 'افتح المتصفح');
  assert.equal(brain.hear('لما اقول بلبل يعني طير في السما').situation, 'teach_bad');
});

test('after a sentence he did not get, a rephrase that works makes him offer to learn it', () => {
  const { brain } = makeBrain();
  assert.equal(brain.hear('شغل لي الاغاني الحلوه').situation !== 'learn_saved', true);
  const lost = brain.hear('ابي اسمع اناشيد');
  assert.equal(lost.situation, 'not_understood');
  const { follow } = sayOk(brain, 'افتح اليوتيوب');
  assert.equal(follow.situation, 'learn_offer');
  assert.equal(follow.awaitingConfirm, true);
  assert.equal(brain.hear('اكيد').situation, 'learn_saved');
  assert.equal(brain.hear('ابي اسمع اناشيد').action.params.url, 'https://www.youtube.com');
});

test('main accepts closing only known apps and folders', () => {
  assert.equal(validateAction({ type: 'close_app', params: { app: 'calculator' } }), null);
  assert.equal(validateAction({ type: 'close_app', params: { app: 'downloads' } }), null);
  assert.equal(validateAction({ type: 'close_app', params: { app: 'explorer.exe' } }), 'bad_app');
});

test('platform: closing politely on Windows, and folder windows through the shell', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'taskkill.exe') return { ok: args[1] === 'CalculatorApp.exe', code: args[1] === 'CalculatorApp.exe' ? 0 : 128, stdout: '' };
    return { ok: true, code: 0, stdout: '2\n' };
  };
  const p = createPlatform({ platform: 'win32', run, shell: { openExternal: async () => {}, openPath: async () => '' }, paths: {} });
  assert.deepEqual(await p.closeApp('calculator'), { ok: true });
  assert.ok(calls.every(([cmd, ...a]) => cmd !== 'taskkill.exe' || !a.includes('/F')), 'never forces');
  assert.deepEqual(await p.closeApp('notepad'), { ok: false, error: 'not_running' });
  assert.deepEqual(await p.closeApp('downloads'), { ok: true });
  assert.ok(calls.at(-1).join(' ').includes('Shell.Application'));
  assert.ok(!calls.some((c) => c.includes('explorer.exe') && c[0] === 'taskkill.exe'), 'never stops explorer.exe');
  assert.deepEqual(await p.closeApp('youtube'), { ok: false, error: 'cannot_close' });
});
