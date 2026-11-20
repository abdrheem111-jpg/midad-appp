// Push-to-talk microphone recording that stops by itself after the person
// stops speaking, then returns a 16 kHz WAV for speech recognition.

import { downsample, encodeWav, rms } from './wav.js';

const TARGET_RATE = 16000;
const SILENCE_RMS = 0.012;
const SILENCE_AFTER_SPEECH_MS = 1300;
const MAX_MS = 12000;
const NO_SPEECH_MS = 5000;

export class Recorder {
  constructor() {
    this.active = false;
  }

  /**
   * Records until silence. Resolves with {wav, spoke} or rejects on mic errors.
   * @param {(level: number) => void} [onLevel] loudness 0..1 for the UI
   * @param {{maxMs?: number, silenceMs?: number|null, noSpeechMs?: number, worklet?: string, onChunk?: (samples: Float32Array) => void}} [opts]
   *   silenceMs null: keep recording through pauses (a student reading) until stop() or maxMs.
   */
  async record(onLevel, opts = {}) {
    const maxMs = opts.maxMs || MAX_MS;
    const silenceMs = opts.silenceMs === null ? Infinity : (opts.silenceMs || SILENCE_AFTER_SPEECH_MS);
    const noSpeechMs = opts.noSpeechMs || NO_SPEECH_MS;
    if (this.active) throw new Error('busy');
    this.active = true;
    let stream;
    let ctx;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule(opts.worklet || 'recorder-worklet.js');
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'khalfoun-recorder');
      const chunks = [];
      let spoke = false;
      let lastLoud = performance.now();
      const started = performance.now();
      await new Promise((resolve) => {
        this.finish = resolve;
        node.port.onmessage = (e) => {
          const chunk = e.data;
          chunks.push(chunk);
          const level = rms(chunk);
          if (onLevel) onLevel(Math.min(1, level * 12));
          const now = performance.now();
          if (level > SILENCE_RMS) { spoke = true; lastLoud = now; }
          if ((spoke && now - lastLoud > silenceMs) || now - started > maxMs || (!spoke && now - started > noSpeechMs)) resolve();
        };
        src.connect(node);
      });
      node.port.onmessage = null;
      src.disconnect();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const all = new Float32Array(total);
      let off = 0;
      for (const c of chunks) { all.set(c, off); off += c.length; }
      const wav = encodeWav(downsample(all, ctx.sampleRate, TARGET_RATE), TARGET_RATE);
      return { wav, spoke };
    } finally {
      this.active = false;
      this.finish = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
    }
  }

  /** Stops early (second press of the talk button). */
  stop() { if (this.finish) this.finish(); }
}
