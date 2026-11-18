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
  assert.equal(speakableText('طبول... 🥁 الدور على أحمد!\n(قول «اكتبها» وأكتبها لك.)'), 'طبول... الدور على أحمد!.');
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
  assert.equal(synth.spoken[0].text, 'هلا والله');
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
