// Voice activity detection: finds where someone starts and stops talking in a
// stream of microphone samples, with a noise floor that adapts to the room.
// Nothing is kept except the current sentence. Pure: unit-tested in Node.

import { rms } from './wav.js';

export class VoiceActivityDetector {
  /**
   * @param {{sampleRate: number, frameMs?: number, minSpeechMs?: number, endSilenceMs?: number,
   *   maxMs?: number, preRollMs?: number, minThreshold?: number}} opts
   */
  constructor(opts) {
    this.rate = opts.sampleRate;
    this.frameLen = Math.max(1, Math.round((this.rate * (opts.frameMs || 20)) / 1000));
    this.minSpeech = opts.minSpeechMs ?? 180;
    this.endSilence = opts.endSilenceMs ?? 650;
    this.maxMs = opts.maxMs ?? 6000;
    this.preRollFrames = Math.ceil((opts.preRollMs ?? 250) / (opts.frameMs || 20));
    this.minThreshold = opts.minThreshold ?? 0.008;
    this.frameMs = opts.frameMs || 20;
    this.noise = this.minThreshold / 3;
    this.pending = [];
    this.pendingLen = 0;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.preRoll = [];
    this.loudMs = 0;
    this.silentMs = 0;
    this.segment = [];
    this.segmentMs = 0;
  }

  get threshold() {
    return Math.min(0.08, Math.max(this.minThreshold, this.noise * 3.5));
  }

  /**
   * Feeds raw samples (any chunk size).
   * @param {Float32Array} chunk
   * @returns {Array<{type: 'start'} | {type: 'segment', samples: Float32Array, ms: number, cut: boolean}>}
   */
  push(chunk) {
    const events = [];
    this.pending.push(chunk);
    this.pendingLen += chunk.length;
    while (this.pendingLen >= this.frameLen) {
      const frame = new Float32Array(this.frameLen);
      let filled = 0;
      while (filled < this.frameLen) {
        const head = this.pending[0];
        const take = Math.min(head.length, this.frameLen - filled);
        frame.set(head.subarray(0, take), filled);
        filled += take;
        if (take === head.length) this.pending.shift();
        else this.pending[0] = head.subarray(take);
      }
      this.pendingLen -= this.frameLen;
      this.frame(frame, events);
    }
    return events;
  }

  frame(frame, events) {
    const level = rms(frame);
    const loud = level > this.threshold;
    if (this.state === 'idle') {
      if (!loud) this.noise = this.noise * 0.97 + level * 0.03;
      this.preRoll.push(frame);
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      this.loudMs = loud ? this.loudMs + this.frameMs : 0;
      if (this.loudMs >= this.minSpeech) {
        this.state = 'speech';
        this.segment = [...this.preRoll];
        this.segmentMs = this.segment.length * this.frameMs;
        this.silentMs = 0;
        events.push({ type: 'start' });
      }
      return;
    }
    this.segment.push(frame);
    this.segmentMs += this.frameMs;
    this.silentMs = loud ? 0 : this.silentMs + this.frameMs;
    const cut = this.segmentMs >= this.maxMs;
    if (this.silentMs >= this.endSilence || cut) {
      const total = this.segment.reduce((n, f) => n + f.length, 0);
      const samples = new Float32Array(total);
      let off = 0;
      for (const f of this.segment) { samples.set(f, off); off += f.length; }
      events.push({ type: 'segment', samples, ms: this.segmentMs, cut });
      this.reset();
    }
  }
}
