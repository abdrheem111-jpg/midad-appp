// Khalfoun X: the noise meter's judgement, the listening beeps, the voice test sentences,
// the guide, photo solving in the cloud, the reading transcription prompt and the occasion effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NoiseJudge, blockDb } from '../src/renderer/noise.js';
import { soundPlan, SoundPlayer } from '../src/renderer/sounds.js';
import { recognize } from '../src/core/intents.js';
import { GUIDE } from '../src/core/guide.js';
import { GeminiAgent, ClaudeAgent, chainAgents, visionPrompt, cleanVision, agentSystem, COMMAND_EXAMPLES } from '../src/main/cloud.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { EFFECT_SECONDS } from '../src/renderer/effects.js';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('noise judge: learns the room, calls out sustained noise only, and rewards a quiet stretch', () => {
  const j = new NoiseJudge({ calibrateS: 1, quietForStarS: 10 });
  for (let i = 0; i < 12; i += 1) assert.deepEqual(j.feed(-60, 0.1), []);
  assert.ok(Math.abs(j.base - -60) < 1, String(j.base));
  // A single clap is not «loud».
  assert.deepEqual(j.feed(-20, 0.1), []);
  for (let i = 0; i < 5; i += 1) j.feed(-60, 0.1);
  // Talking for two seconds is.
  const events = [];
  for (let i = 0; i < 20; i += 1) events.push(...j.feed(-38, 0.1));
  assert.ok(events.includes('loud'), events.join(','));
  assert.ok(!events.includes('very'));
  // Very loud.
  const very = [];
  for (let i = 0; i < 40; i += 1) very.push(...j.feed(-25, 0.1));
  assert.ok(very.includes('very'), very.join(','));
  // A quiet stretch earns a star once.
  const quiet = [];
  for (let i = 0; i < 130; i += 1) quiet.push(...j.feed(-61, 0.1));
  assert.equal(quiet.filter((e) => e === 'quiet').length, 1);
  assert.ok(j.level >= 0 && j.level <= 1);
  assert.equal(blockDb(new Float32Array(100)), -100);
  assert.ok(Math.abs(blockDb(new Float32Array(100).fill(0.1)) - -20) < 0.01);
});

test('listening beeps exist and are never skipped by the effect spacing', () => {
  assert.ok(soundPlan('cue_start').length === 2 && soundPlan('cue_stop').length === 2);
  assert.ok(soundPlan('cue_start')[1].freq > soundPlan('cue_start')[0].freq, 'start rises');
  assert.ok(soundPlan('cue_stop')[1].freq < soundPlan('cue_stop')[0].freq, 'stop falls');
  const fakeCtx = { currentTime: 0, state: 'running', sampleRate: 16000, destination: {},
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
    createOscillator: () => ({ frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }) };
  const p = new SoundPlayer({ contextFactory: () => fakeCtx });
  assert.equal(p.cue('start'), 2);
  assert.equal(p.cue('stop'), 2); // right after: still plays
  p.setEnabled(false);
  assert.equal(p.cue('start'), 0);
});

test('every voice-test sentence and every guide example is understood', async () => {
  const { VOICE_TEST } = await import('../src/renderer/classroom-ui.js');
  for (const [text, intent] of VOICE_TEST) assert.equal(recognize(text).intent, intent, text);
  let n = 0;
  for (const group of GUIDE) {
    assert.ok(group.title && group.icon && group.items.length);
    for (const [cmd, what] of group.items) {
      n += 1;
      const r = recognize(cmd);
      assert.ok(!['unknown', 'open_unknown'].includes(r.intent) && r.confidence >= 0.7, `${cmd} → ${r.intent}`);
      assert.ok(what.length > 3, cmd);
    }
  }
  assert.ok(n >= 40, `guide has ${n} commands`);
});

test('the cloud brain knows the new commands and how to take a joke', () => {
  for (const c of ['لف العجلة', 'عطني لغز', 'نجمة للصف', 'حل من الكاميرا', 'صدر كشف الغياب']) assert.ok(COMMAND_EXAMPLES.includes(c), c);
  for (const c of COMMAND_EXAMPLES) {
    const sample = c.replace(/<اسم>/g, 'أحمد').replace(/<[^>]+>/g, 'الاجتماع');
    assert.ok(!['unknown', 'open_unknown'].includes(recognize(sample).intent), `${c} (${sample}) → ${recognize(sample).intent}`);
  }
  assert.match(agentSystem({}), /نكتة/);
});

test('vision: Gemini sends the photo inline and returns the cleaned answer', async () => {
  const calls = [];
  const g = new GeminiAgent({ key: 'AIza' + 'x'.repeat(35), model: 'gemini-x', fetchFn: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return reply(200, { candidates: [{ content: { parts: [{ text: '**السؤال:** ٢+٢\nالحل:\n١. نجمع\nالجواب: ٤' }] } }] });
  } });
  const r = await g.vision('QUJD'.repeat(40), { mode: 'solve' });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'السؤال: ٢+٢\nالحل:\n١. نجمع\nالجواب: ٤');
  const parts = calls[0].body.contents[0].parts;
  assert.equal(parts[0].inline_data.mime_type, 'image/jpeg');
  assert.match(parts[1].text, /السؤال:/);
  assert.match(calls[0].url, /gemini-x:generateContent$/);
  // An unreadable photo.
  const unclear = new GeminiAgent({ key: 'k', model: 'm', fetchFn: async () => reply(200, { candidates: [{ content: { parts: [{ text: 'غير واضح' }] } }] }) });
  assert.equal((await unclear.vision('QUJD', {})).error, 'unclear');
  assert.equal(cleanVision('  غير واضح. '), null);
  assert.match(visionPrompt('look'), /صف/);
});

test('vision: Claude gets an image block, and the chain falls back to Gemini when Claude has no credit', async () => {
  let claudeBody = null;
  const claude = new ClaudeAgent({ key: 'sk-ant-x', fetchFn: async (url, init) => { claudeBody = JSON.parse(init.body); return reply(400, { error: { message: 'Your credit balance is too low' } }); } });
  const gemini = new GeminiAgent({ key: 'k', model: 'm', fetchFn: async () => reply(200, { candidates: [{ content: { parts: [{ text: 'الجواب: ٥' }] } }] }) });
  const r = await chainAgents([claude, gemini]).vision('QUJD', { mode: 'solve' });
  assert.equal(r.ok, true);
  assert.equal(r.service, 'gemini');
  assert.equal(claudeBody.messages[0].content[0].type, 'image');
  assert.equal(claudeBody.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.equal((await chainAgents([]).vision('x', {})).error, 'not_configured');
});

test('reading transcription asks Gemini for what was read, mistakes included, with room for a long passage', async () => {
  let body = null;
  const g = new GeminiAgent({ key: 'k', model: 'm', fetchFn: async (url, init) => { body = JSON.parse(init.body); return reply(200, { candidates: [{ content: { parts: [{ text: 'ذهب احمد الى البحر' }] } }] }); } });
  const r = await g.transcribe(new Uint8Array(2000), { reading: true });
  assert.equal(r.text, 'ذهب احمد الى البحر');
  assert.match(body.contents[0].parts[1].text, /حتى لو أخطأ/);
  assert.equal(body.generationConfig.maxOutputTokens, 1500);
  await g.transcribe(new Uint8Array(2000));
  assert.match(body.contents[0].parts[1].text, /اللهجة العُمانية/);
});

test('the occasion greeting dresses the screen: flags on National Day', () => {
  const day = new Date(2026, 10, 20, 8, 0).getTime();
  const brain = new Brain({ memoryData: { ...defaultMemory(day), onboarded: true, level: 2 }, clock: () => day, rng: () => 0.1 });
  const r = brain.start();
  assert.equal(r.situation, 'occasion_national_day');
  assert.equal(r.effect, 'national');
  assert.ok(EFFECT_SECONDS[r.effect]);
});
