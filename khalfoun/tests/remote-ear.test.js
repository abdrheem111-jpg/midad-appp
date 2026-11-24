import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteKeyFrom, REMOTE_ACCEL, REMOTE_REFUSAL } from '../src/core/remote-keys.js';
import { EAR_CALLS, EAR_OTHERS, EAR_VOICES, earTtsPlan, goodCall, EAR_KINDS } from '../src/core/ear-plan.js';
import { sampleAzure } from '../src/main/cloud.js';
import { findWakeWord } from '../src/core/wake.js';
import { normalize } from '../src/core/arabic.js';

test('remote: the buttons a presenter remote sends become Khalfoun\'s button', () => {
  assert.deepEqual(remoteKeyFrom({ key: 'F5', shiftKey: true }), { ok: true, accel: 'Shift+F5', label: 'Shift + F5' });
  assert.equal(remoteKeyFrom({ key: 'PageDown' }).accel, 'PageDown');
  assert.match(remoteKeyFrom({ key: 'PageDown' }).warn, /PDF/); // he is told it no longer turns pages
  assert.match(remoteKeyFrom({ key: 'F5' }).warn, /F5/);
  assert.equal(remoteKeyFrom({ key: 'MediaPlayPause', code: 'MediaPlayPause' }).accel, 'MediaPlayPause');
  assert.equal(remoteKeyFrom({ key: 'AudioVolumeUp', code: 'AudioVolumeUp' }).accel, 'VolumeUp');
  assert.equal(remoteKeyFrom({ key: 'ب', code: 'KeyF', ctrlKey: true }).accel, 'Ctrl+F'); // Arabic keyboard layout
});

test('remote: keys needed for typing, Esc and lone modifiers are never taken', () => {
  for (const key of ['b', '.', 'ب', ' ', 'Enter', 'Tab', 'Backspace', 'ArrowRight', '1']) assert.equal(remoteKeyFrom({ key }).why, 'typing_key', key);
  assert.equal(remoteKeyFrom({ key: 'Escape' }).why, 'escape');
  assert.equal(remoteKeyFrom({ key: 'Shift', shiftKey: true }).why, 'modifier');
  assert.equal(remoteKeyFrom({ key: 'Unidentified' }).why, 'unknown');
  for (const why of ['typing_key', 'escape', 'unknown', 'modifier']) assert.ok(REMOTE_REFUSAL[why]);
});

test('remote: the main process only registers shortcut shapes it knows', () => {
  for (const ok of ['F5', 'Shift+F5', 'Ctrl+Alt+F12', 'PageDown', 'MediaPlayPause', 'Ctrl+F']) assert.ok(REMOTE_ACCEL.test(ok), ok);
  for (const bad of ['B', 'Escape', 'Super+L', 'F25', 'Ctrl+Shift+Alt+Ctrl+F1', 'calc.exe', '', 'F5; rm']) assert.equal(REMOTE_ACCEL.test(bad), false, bad);
});

test('ear: the calls he records are his name; the other sentences are not', () => {
  assert.equal(EAR_CALLS.length, 40);
  for (const [text] of EAR_CALLS) assert.ok(findWakeWord(text).found, text);
  for (const text of EAR_OTHERS) assert.equal(/خلفون/.test(normalize(text)), false, text);
  assert.ok(EAR_OTHERS.length >= 20);
  assert.deepEqual(EAR_KINDS, ['call', 'other', 'room', 'tts-call', 'tts-other']);
});

test('ear: a good recording is a name\'s length', () => {
  assert.equal(goodCall(900, true, false), true);
  assert.equal(goodCall(200, true, false), false); // a click
  assert.equal(goodCall(5000, true, false), false); // too long for just a name
  assert.equal(goodCall(5000, true, true), true); // the name and a command after it
  assert.equal(goodCall(900, false, false), false); // nothing said
});

test('ear: Azure voices plan: every voice, varied speed and pitch, stable names', () => {
  const plan = earTtsPlan();
  assert.equal(plan.length, EAR_VOICES.length * 16);
  assert.equal(new Set(plan.map((c) => c.name)).size, plan.length);
  assert.ok(plan.filter((c) => c.kind === 'tts-call').every((c) => /خَلْفُون/.test(c.text)));
  assert.ok(new Set(plan.map((c) => c.rate)).size >= 3);
  assert.deepEqual(earTtsPlan(), plan);
});

test('ear: one Azure clip is asked as 16 kHz WAV with the voice, speed and pitch', async () => {
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([82, 73, 70, 70, 0, 0]).buffer }; };
  const r = await sampleAzure({ key: 'k', region: 'uaenorth' }, { voice: 'ar-OM-AyshaNeural', text: 'يا خَلْفُون', rate: '+18%', pitch: '-12%' }, { fetchFn });
  assert.equal(r.ok, true);
  assert.equal(seen.url, 'https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(seen.init.headers['X-Microsoft-OutputFormat'], 'riff-16khz-16bit-mono-pcm');
  assert.match(seen.init.body, /<voice name="ar-OM-AyshaNeural"><prosody rate="\+18%" pitch="-12%">يا خَلْفُون<\/prosody>/);
  // nothing odd reaches the request
  const bad = await sampleAzure({ key: 'k', region: 'uaenorth' }, { voice: 'en-US-x"><evil', text: 'x' }, { fetchFn });
  assert.equal(bad.error, 'bad_voice');
  await sampleAzure({ key: 'k', region: 'uaenorth' }, { voice: 'ar-SA-HamedNeural', text: '<a>&', rate: '50%;' }, { fetchFn });
  assert.match(seen.init.body, /rate="\+0%"/);
  assert.match(seen.init.body, /&lt;a&gt;&amp;/);
  const missing = await sampleAzure({ key: 'k', region: 'uaenorth' }, { voice: 'ar-YE-SalehNeural', text: 'x' }, { fetchFn: async () => ({ ok: false, status: 400 }) });
  assert.equal(missing.error, 'http_400');
});

test('ear: the app computes exactly what the training code computed (same models, same steps)', async () => {
  const ort = await import('../node_modules/onnxruntime-web/dist/ort.node.min.mjs');
  const { readFile } = await import('node:fs/promises');
  const { EarStream, CHUNK } = await import('../src/renderer/ear-model.js');
  ort.env.wasm.numThreads = 1;
  const at = (p) => new URL(`../${p}`, import.meta.url);
  const ear = await EarStream.create(ort, { mel: await readFile(at('assets/ear/melspectrogram.onnx')), emb: await readFile(at('assets/ear/embedding_model.onnx')), cls: await readFile(at('tests/fixtures/ear/test-ear.onnx')) });
  const expected = JSON.parse(await readFile(at('tests/fixtures/ear/expected.json'), 'utf8'));
  const n = 32000;
  const probe = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { const t = i / 16000; probe[i] = 3000 * Math.sin(2 * Math.PI * 220 * t) * Math.sin(2 * Math.PI * 1.5 * t) + 400 * Math.sin(2 * Math.PI * 1700 * t); }
  const scores = [];
  for (let i = 0; i + CHUNK <= n; i += CHUNK) { const s = await ear.step(probe.subarray(i, i + CHUNK)); if (s !== null) scores.push(s); }
  assert.equal(scores.length, expected.scores.length);
  scores.forEach((s, i) => assert.ok(Math.abs(s - expected.scores[i]) < 1e-4, `${i}: ${s} vs ${expected.scores[i]}`));
  // push() takes sound in any batch size (-1..1) and gives the best new score
  ear.reset();
  const best = await ear.push(Float32Array.from(probe, (v) => v / 32767));
  assert.ok(Math.abs(best - Math.max(...expected.scores)) < 1e-3);
});

test('ear: a call is two scores above the line in a row, or one well above it, then a pause', async () => {
  const { EarTrigger } = await import('../src/renderer/ear-model.js');
  const t = new EarTrigger({ threshold: 0.5, high: 0.85, refractoryMs: 2000 });
  assert.equal(t.feed(0.6, 0), false); // one is not enough
  assert.equal(t.feed(0.7, 80), true); // two in a row
  assert.equal(t.feed(0.95, 160), false); // the same call (pause)
  assert.equal(t.feed(0.1, 3000), false);
  assert.equal(t.feed(0.9, 3080), true); // well above: at once
  assert.equal(t.feed(null, 3200), false);
  assert.equal(t.takePeak(), 0.95);
  assert.equal(t.takePeak(), 0);
});
