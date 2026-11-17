import test from 'node:test';
import assert from 'node:assert/strict';
import { soundPlan, babblePlan, ANIMATION_SOUND, SoundPlayer } from '../src/renderer/sounds.js';
import { ANIMATIONS } from '../src/renderer/animations.js';
import { EMOTIONS } from '../src/core/emotions.js';
import { recognize } from '../src/core/intents.js';

const NAMES = ['pop', 'giggle', 'hmm', 'whistle', 'boing', 'thud', 'sparkle', 'chime', 'yay', 'aww', 'snore', 'gasp', 'ding'];

test('every effect is a short, well-formed list of tones for every emotion', () => {
  for (const name of NAMES) {
    for (const e of EMOTIONS) {
      const plan = soundPlan(name, e);
      assert.ok(plan.length > 0, name);
      for (const t of plan) {
        for (const k of ['t', 'dur', 'freq', 'freqEnd', 'gain']) assert.ok(Number.isFinite(t[k]), `${name}.${k}`);
        assert.ok(t.dur > 0 && t.t + t.dur <= 1.2, `${name} too long`);
        assert.ok(t.gain > 0 && t.gain <= 0.4, `${name} too loud`);
        if (!t.noise) assert.ok(t.freq >= 40 && t.freq <= 4000, `${name} freq ${t.freq}`);
      }
    }
  }
  assert.deepEqual(soundPlan('nonsense'), []);
});

test('happy chatter is higher than sad chatter, and the same text sounds the same', () => {
  const happy = babblePlan('هلا والله شحالك', 'happy');
  const sad = babblePlan('هلا والله شحالك', 'sad');
  assert.ok(happy[0].freq > sad[0].freq);
  assert.deepEqual(babblePlan('زين', 'calm'), babblePlan('زين', 'calm'));
  assert.ok(babblePlan('ا'.repeat(500), 'calm').length <= 24, 'long text never chatters forever');
  assert.equal(babblePlan('...!!', 'calm').length, 0, 'punctuation is silent');
  assert.ok(babblePlan('مرحبا بك', 'calm').every((t) => t.gain < 0.1), 'chatter stays quiet');
});

test('every animation mapped to a sound exists, and every sound name is real', () => {
  for (const [anim, name] of Object.entries(ANIMATION_SOUND)) {
    if (!['tickle', 'leap'].includes(anim)) assert.ok(ANIMATIONS[anim] || anim === 'leap', `animation ${anim}`);
    assert.ok(NAMES.includes(name), `sound ${name}`);
  }
});

function fakeContext() {
  const made = [];
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, start() {}, stop() {}, frequency: param(), gain: param() });
  return {
    made,
    factory: () => ({
      state: 'running', currentTime: 0, sampleRate: 8000, destination: {},
      createGain: () => { const n = node(); made.push('gain'); return n; },
      createOscillator: () => { const n = node(); made.push('osc'); return n; },
      createBufferSource: () => { const n = node(); made.push('noise'); return n; },
      createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }),
    }),
  };
}

test('the player plays tones, respects mute and never piles up effects', () => {
  const fake = fakeContext();
  const p = new SoundPlayer({ contextFactory: fake.factory });
  assert.equal(p.effect('thud'), 2);
  assert.ok(fake.made.includes('noise') && fake.made.includes('osc'));
  assert.equal(p.effect('boing'), 0, 'too soon after the last effect');
  p.setEnabled(false);
  assert.equal(p.babble('هلا والله', 'happy'), 0);
  p.setEnabled(true);
  assert.ok(p.babble('هلا والله', 'happy') > 0);
  const broken = new SoundPlayer({ contextFactory: () => { throw new Error('no audio'); } });
  assert.equal(broken.babble('هلا', 'calm'), 0, 'no audio device is not an error');
});

test('sound commands do not clash with the volume commands', () => {
  assert.deepEqual([recognize('اسكت الأصوات').intent, recognize('اسكت الأصوات').slots.on], ['sounds', false]);
  assert.deepEqual([recognize('شغل الأصوات').intent, recognize('شغل الأصوات').slots.on], ['sounds', true]);
  assert.equal(recognize('اكتم الصوت').intent, 'volume');
  assert.equal(recognize('ارفع الصوت').intent, 'volume');
});
