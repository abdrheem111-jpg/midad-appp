// The optional speaking voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceOut, speakableText, pickArabicVoice } from '../src/renderer/voice-out.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { recognize } from '../src/core/intents.js';

function fakeSynth(voices) {
  const spoken = [];
  return {
    spoken,
    speaking: false,
    getVoices: () => voices,
    speak(u) { spoken.push(u); u.onstart?.(); },
    cancel() { this.cancelled = (this.cancelled || 0) + 1; },
  };
}
class FakeUtterance { constructor(text) { this.text = text; } }

test('spoken text drops hints, emoji and symbols', () => {
  assert.equal(speakableText('طبول... 🥁 الدور على أحمد!\n(قول «اكتبها» وأكتبها لك.)'), 'طبول... الدور على أحمد!');
  assert.equal(speakableText('⏱ «مرحبا»'), 'مرحبا');
});

test('the Gulf Arabic voice is preferred; no Arabic voice means silence', () => {
  const v = pickArabicVoice([{ lang: 'en-US', name: 'Zira' }, { lang: 'ar-EG', name: 'Salma' }, { lang: 'ar-SA', name: 'Hoda' }]);
  assert.equal(v.name, 'Hoda');
  assert.equal(pickArabicVoice([{ lang: 'en-US' }]), null);
  const silent = new VoiceOut({ synth: fakeSynth([{ lang: 'en-US' }]), Utterance: FakeUtterance });
  silent.setEnabled(true);
  assert.equal(silent.available, false);
  assert.equal(silent.speak('هلا'), false);
});

test('speaking: only when enabled, with the Arabic voice, replacing the previous line', () => {
  const synth = fakeSynth([{ lang: 'ar-SA', name: 'Hoda' }]);
  const v = new VoiceOut({ synth, Utterance: FakeUtterance });
  let started = 0;
  v.onStart = () => { started += 1; };
  assert.equal(v.speak('هلا'), false, 'off by default');
  v.setEnabled(true);
  assert.equal(v.speak('هلا والله'), true);
  assert.equal(synth.spoken[0].text, 'هَلَا والله'); // the pronunciation dictionary gives «هلا» its vowels
  assert.equal(synth.spoken[0].voice.name, 'Hoda');
  assert.ok(synth.spoken[0].pitch > 1);
  assert.equal(started, 1);
  v.speak('ثانية');
  assert.ok(synth.cancelled >= 1, 'previous line stopped');
});

test('«تكلم» / «لا تتكلم» turn the voice on and off and are remembered', () => {
  assert.deepEqual(recognize('تكلم').slots, { on: true });
  assert.deepEqual(recognize('لا تتكلم').slots, { on: false });
  const now = Date.now();
  let saved = null;
  const b = new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 2 }, onMemoryChange: (d) => { saved = d; } });
  assert.equal(b.hear('تكلم').behavior, 'speak:on');
  assert.equal(saved.speak, true);
  assert.equal(b.hear('لا تتكلم').behavior, 'speak:off');
  assert.equal(saved.speak, false);
});

test('the cloud voice reads a reply in whole sentences without gaps: the next is fetched while one plays', async () => {
  const fetched = [];
  const played = [];
  class FakeAudio {
    constructor(url) { this.url = url; played.push(url); FakeAudio.last = this; }
    play() { return Promise.resolve(); }
    pause() {}
  }
  globalThis.URL.createObjectURL ??= () => 'blob:x';
  globalThis.URL.revokeObjectURL ??= () => {};
  const v = new VoiceOut({ synth: fakeSynth([]), Utterance: FakeUtterance, Audio: FakeAudio });
  v.remote = async (line) => { fetched.push(line); return { ok: true, audio: new Uint8Array([1, 2, 3]) }; };
  v.setEnabled(true);
  const long = 'هَلَا وَاللّٰه يا أستاذ، اليوم بنحل المسألة الأولى مع بعض خطوة خطوة. أول شي نكتب المعطيات: س² + ٣ = ١٢. بعدها ننقل الثلاثة للطرف الثاني ونطرح. وأخيراً ناخذ الجذر التربيعي للطرفين ونطلع الجواب، يعني س يساوي ثلاثة.';
  assert.equal(v.queue(long), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(fetched.length >= 2, 'the second sentence is fetched before the first finishes');
  const plain = (f) => f.replace(/[\u064B-\u0652\u0670]/g, '');
  assert.ok(fetched.some((f) => /سين تربيع زائد 3 يساوي 12/.test(plain(f))), fetched.join(' | '));
  assert.ok(fetched.every((f) => f.length <= 240));
  const total = fetched.length;
  // sentences play one after another as each ends
  for (let i = 0; i < 6 && v.speaking; i += 1) { FakeAudio.last.onended(); await new Promise((r) => setTimeout(r, 0)); }
  assert.equal(v.speaking, false);
  assert.ok(played.length >= 2 && played.length === fetched.length && fetched.length >= total);
  // stop() drops what was left
  v.queue('جملة أولى طويلة شوي عشان ما تندمج مع غيرها أبداً يا جماعة الخير. جملة ثانية طويلة بعد عشان تكون لحالها في القراءة.');
  v.stop();
  assert.equal(v.lines.length, 0);
});
