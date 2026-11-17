import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWakeWord, levenshtein } from '../src/core/wake.js';
import { VoiceActivityDetector } from '../src/renderer/vad.js';
import { findWhisper, transcribe, PROMPT } from '../src/main/stt.js';
import { encodeWav } from '../src/renderer/wav.js';

test('levenshtein', () => {
  assert.equal(levenshtein('خلفون', 'خلفون'), 0);
  assert.equal(levenshtein('خلفون', 'خلفان'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
});

const hits = [
  ['يا خلفون', ''],
  ['يا خلفون افتح الحاسبة', 'افتح الحاسبة'],
  ['ياخلفون، كم الساعة؟', 'كم الساعة؟'],
  ['خلفون!', ''],
  ['يا خلفان شغل يوتيوب', 'شغل يوتيوب'], // common mishearing
  ['يا خَلْفُون دور لي عن مطاعم', 'دور لي عن مطاعم'],
  ['هلا وخلفون وينك', 'وينك'],
  ['ممكن يا خلفوه تفتح المتصفح', 'تفتح المتصفح'],
  ['يا خالفون تعال', 'تعال'],
];
for (const [text, rest] of hits) {
  test(`wake word found in "${text}"`, () => {
    assert.deepEqual(findWakeWord(text), { found: true, rest });
  });
}

for (const text of ['افتح الحاسبة', 'خلف البيت', 'مختلفون في الرأي جداً', 'كلفون', 'عطني التلفون', 'تلفونك وين', 'مخلفون', 'خلفي', '', 'السلام عليكم']) {
  test(`no wake word in "${text}"`, () => {
    assert.equal(findWakeWord(text).found, false);
  });
}

// ------------------------------------------------------------- voice activity

const RATE = 16000;
const silence = (ms, level = 0.001) => { const a = new Float32Array((RATE * ms) / 1000); for (let i = 0; i < a.length; i += 1) a[i] = (Math.random() * 2 - 1) * level; return a; };
const voice = (ms, amp = 0.2) => { const a = new Float32Array((RATE * ms) / 1000); for (let i = 0; i < a.length; i += 1) a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE) * (0.6 + 0.4 * Math.sin(i / 400)); return a; };
function feed(vad, parts, chunk = 128) {
  const events = [];
  for (const part of parts) for (let i = 0; i < part.length; i += chunk) events.push(...vad.push(part.subarray(i, i + chunk)));
  return events;
}

test('a spoken sentence between silences becomes one segment with lead-in', () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  const ev = feed(vad, [silence(1000), voice(900), silence(1000)]);
  const segs = ev.filter((e) => e.type === 'segment');
  assert.equal(ev.filter((e) => e.type === 'start').length, 1);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].ms >= 900 && segs[0].ms <= 1900, `segment ${segs[0].ms}ms`);
  assert.equal(segs[0].cut, false);
});

test('two sentences with a pause give two segments; short clicks are ignored', () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  const ev = feed(vad, [silence(500), voice(600), silence(900), voice(40), silence(900), voice(700), silence(900)]);
  assert.equal(ev.filter((e) => e.type === 'segment').length, 2);
});

test('endless talking is cut at the maximum length', () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE, maxMs: 2000 });
  const ev = feed(vad, [silence(300), voice(5000)]);
  const segs = ev.filter((e) => e.type === 'segment');
  assert.ok(segs.length >= 2);
  assert.ok(segs[0].cut);
});

test('steady background noise raises the threshold instead of triggering', () => {
  const vad = new VoiceActivityDetector({ sampleRate: RATE });
  const ev = feed(vad, [silence(6000, 0.006)]);
  assert.equal(ev.length, 0);
  assert.ok(vad.threshold > 0.008);
  const ev2 = feed(vad, [voice(800, 0.25), silence(900, 0.006)]);
  assert.equal(ev2.filter((e) => e.type === 'segment').length, 1, 'real speech still heard over the noise');
});

// ------------------------------------------------------------------ whisper

test('a small model is used for the wake word, the best one for commands', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'khalfoun-wake-'));
  await writeFile(join(dir, 'whisper-cli'), '');
  await writeFile(join(dir, 'ggml-small.bin'), '');
  await writeFile(join(dir, 'ggml-tiny.bin'), '');
  const w = await findWhisper({ dirs: [dir], env: {} });
  assert.ok(w.model.endsWith('ggml-small.bin'));
  assert.ok(w.wakeModel.endsWith('ggml-tiny.bin'));
  const used = [];
  const run = (bin, args, opts, cb) => { used.push(args); cb(null, 'يا خلفون'); };
  const wav = encodeWav(new Float32Array(1600), 16000);
  await transcribe(w, wav, { run, purpose: 'wake' });
  await transcribe(w, wav, { run, purpose: 'command' });
  assert.ok(used[0][used[0].indexOf('-m') + 1].endsWith('ggml-tiny.bin'));
  assert.ok(used[1][used[1].indexOf('-m') + 1].endsWith('ggml-small.bin'));
  assert.equal(used[0][used[0].indexOf('--prompt') + 1], PROMPT);
  assert.ok(!PROMPT.includes('خلفون'), 'the name is never in the prompt, so an echoed prompt cannot wake him');
  await rm(dir, { recursive: true, force: true });
});

test('an echoed prompt is thrown away', async () => {
  const run = (bin, args, opts, cb) => cb(null, PROMPT);
  const r = await transcribe({ bin: 'x', model: 'y' }, encodeWav(new Float32Array(1600), 16000), { run });
  assert.deepEqual(r, { ok: true, text: '' });
});
