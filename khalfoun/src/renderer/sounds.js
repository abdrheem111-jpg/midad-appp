// Khalfoun does not speak, but he makes little sounds. Every sound is
// synthesised on the spot from a small "plan" of tones, so there are no audio
// files. The plans are pure data (unit-tested); the player turns them into
// Web Audio oscillators.

/** Base pitch per emotion (Hz): happier = higher, sadder = lower. */
const MOOD_PITCH = {
  calm: 420, happy: 520, proud: 470, excited: 580, amazed: 560, curious: 480, focused: 400, confused: 430,
  shy: 500, grateful: 480, longing: 450, sad: 330, sulky: 350, jealous: 380, scared: 600, bored: 340, sleepy: 300,
};

const tone = (t, dur, freq, opts = {}) => ({ t, dur, freq, freqEnd: opts.to ?? freq, type: opts.type || 'sine', gain: opts.gain ?? 0.25, noise: !!opts.noise });

/**
 * A named effect as a list of tones (seconds, Hz, 0..1 gain).
 * @param {string} name
 * @param {string} [emotion]
 */
export function soundPlan(name, emotion = 'calm') {
  const p = MOOD_PITCH[emotion] || MOOD_PITCH.calm;
  switch (name) {
    case 'pop': return [tone(0, 0.07, 700, { to: 1100, gain: 0.18 })];
    case 'giggle': return [0, 0.09, 0.18, 0.27, 0.36].map((t, i) => tone(t, 0.07, p * 1.4 + i * 40, { to: p * 1.9 + i * 50, type: 'triangle', gain: 0.2 }));
    case 'hmm': return [tone(0, 0.45, p * 0.55, { to: p * 0.5, type: 'triangle', gain: 0.16 })];
    case 'whistle': return [tone(0, 0.18, 1200, { to: 1600, gain: 0.12 }), tone(0.22, 0.25, 1500, { to: 1100, gain: 0.12 })];
    case 'boing': return [tone(0, 0.22, 260, { to: 520, type: 'triangle', gain: 0.22 })];
    case 'thud': return [tone(0, 0.18, 140, { to: 60, type: 'sine', gain: 0.35 }), tone(0, 0.12, 0, { noise: true, gain: 0.12 })];
    case 'sparkle': return [0, 0.06, 0.12, 0.18].map((t, i) => tone(t, 0.12, [1318, 1568, 1976, 2637][i], { gain: 0.09 }));
    case 'chime': return [tone(0, 0.35, 880, { gain: 0.2 }), tone(0.3, 0.5, 1175, { gain: 0.2 })];
    case 'yay': return [0, 0.1, 0.2].map((t, i) => tone(t, 0.16, [523, 659, 784][i] * (p / 420), { type: 'triangle', gain: 0.18 }));
    case 'aww': return [tone(0, 0.5, p * 1.1, { to: p * 0.7, type: 'triangle', gain: 0.16 })];
    case 'snore': return [tone(0, 0.8, 0, { noise: true, gain: 0.05 }), tone(0, 0.8, 90, { to: 70, type: 'sine', gain: 0.06 })];
    case 'gasp': return [tone(0, 0.12, p * 1.3, { to: p * 2, type: 'triangle', gain: 0.2 })];
    case 'ding': return [tone(0, 0.4, 1046, { gain: 0.18 })];
    default: return [];
  }
}

/**
 * Soft chatter while his words appear: a short blip every two letters,
 * pitch following the emotion with a little variation per syllable.
 * @param {string} text
 * @param {string} emotion
 * @param {number} [charMs] typing speed in ms per character
 */
export function babblePlan(text, emotion = 'calm', charMs = 15) {
  const p = MOOD_PITCH[emotion] || MOOD_PITCH.calm;
  const chars = Array.from(String(text)).filter((c) => /\p{L}|\p{N}/u.test(c));
  const count = Math.min(24, Math.ceil(chars.length / 2));
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const code = chars[i * 2]?.codePointAt(0) || 0;
    const wobble = ((code % 7) - 3) * 0.04; // same text, same melody
    out.push(tone((i * 2 * charMs) / 1000 + i * 0.012, 0.045, p * (1 + wobble), { to: p * (1 + wobble) * 1.05, type: 'square', gain: 0.045 }));
  }
  return out;
}

/** Which effect fits an animation. */
export const ANIMATION_SOUND = {
  laugh: 'giggle', cheeky: 'giggle', tickle: 'giggle', think: 'hmm', scratch: 'hmm', whistle: 'whistle',
  jump: 'boing', leap: 'boing', amazed: 'gasp', wake: 'gasp', trip: 'thud', dust: 'thud', cast: 'sparkle',
  alarm: 'chime', celebrate: 'yay', dance: 'yay', clap: 'yay', sad: 'aww', sulk: 'aww', sleep: 'snore', sneeze: 'gasp',
};

export class SoundPlayer {
  constructor({ enabled = true, volume = 0.7, contextFactory } = {}) {
    this.enabled = enabled;
    this.volume = volume;
    this.contextFactory = contextFactory || (() => new (window.AudioContext || window.webkitAudioContext)());
    this.ctx = null;
    this.played = 0; // for tests
    this.lastEffect = 0;
  }

  setEnabled(on) { this.enabled = !!on; }

  context() {
    if (!this.ctx) {
      try { this.ctx = this.contextFactory(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Plays a list of tones now. */
  playPlan(plan) {
    if (!this.enabled || !plan.length) return 0;
    const ctx = this.context();
    if (!ctx) return 0;
    const start = ctx.currentTime + 0.01;
    for (const t of plan) {
      const g = ctx.createGain();
      const at = start + t.t;
      const peak = Math.max(0.0001, t.gain * this.volume);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, t.dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, at + t.dur);
      g.connect(ctx.destination);
      let src;
      if (t.noise) {
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * t.dur)), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
        src = ctx.createBufferSource();
        src.buffer = buf;
      } else {
        src = ctx.createOscillator();
        src.type = t.type;
        src.frequency.setValueAtTime(t.freq, at);
        if (t.freqEnd !== t.freq) src.frequency.exponentialRampToValueAtTime(Math.max(1, t.freqEnd), at + t.dur);
      }
      src.connect(g);
      src.start(at);
      src.stop(at + t.dur + 0.02);
      this.played += 1;
    }
    return plan.length;
  }

  /** An effect by name; effects closer than 150 ms apart are skipped so they never pile up. */
  effect(name, emotion) {
    const now = Date.now();
    if (now - this.lastEffect < 150) return 0;
    this.lastEffect = now;
    return this.playPlan(soundPlan(name, emotion));
  }

  babble(text, emotion) { return this.playPlan(babblePlan(text, emotion)); }
}
