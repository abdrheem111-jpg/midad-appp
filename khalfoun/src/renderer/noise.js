// The classroom noise meter. `NoiseJudge` is the pure part (unit-tested): it learns how
// quiet the room is, then says when the class gets loud and when it stayed quiet long
// enough for a star. `NoiseMeter` feeds it from the microphone.

export const QUIET_FOR_STAR_S = 180;

export class NoiseJudge {
  constructor({ calibrateS = 3, loudAbove = 16, veryAbove = 26, quietBelow = 9, loudForS = 1.2, quietForStarS = QUIET_FOR_STAR_S } = {}) {
    Object.assign(this, { calibrateS, loudAbove, veryAbove, quietBelow, loudForS, quietForStarS });
    this.samples = [];
    this.base = null; // the room's quiet level in dB
    this.elapsed = 0;
    this.loudS = 0;
    this.quietS = 0;
    this.smooth = null;
  }

  /** 0..1 for the gauge: 0 = the room's quiet, 1 = very loud. */
  get level() {
    if (this.base === null || this.smooth === null) return 0;
    return Math.max(0, Math.min(1, (this.smooth - this.base) / (this.veryAbove + 4)));
  }

  /** 0..1 progress of the quiet stretch toward a star. */
  get quietProgress() { return Math.min(1, this.quietS / this.quietForStarS); }

  /**
   * @param {number} db loudness of the last moment (dBFS, about -90 silent .. 0 max)
   * @param {number} dt seconds since the last call
   * @returns {Array<'loud'|'very'|'quiet'>}
   */
  feed(db, dt) {
    const out = [];
    const v = Number.isFinite(db) ? Math.max(-100, Math.min(0, db)) : -100;
    this.smooth = this.smooth === null ? v : this.smooth * 0.8 + v * 0.2;
    this.elapsed += dt;
    if (this.base === null) {
      this.samples.push(v);
      if (this.elapsed >= this.calibrateS) {
        const sorted = [...this.samples].sort((a, b) => a - b);
        // A low-middle sample: the quiet between sounds, not the loudest moment.
        this.base = Math.min(-30, Math.max(-75, sorted[Math.floor(sorted.length * 0.3)]));
      }
      return out;
    }
    const over = this.smooth - this.base;
    if (over > this.loudAbove) {
      this.loudS += dt;
      this.quietS = Math.max(0, this.quietS - dt * 6); // noise costs quiet time quickly
      if (this.loudS >= this.loudForS) {
        out.push(over > this.veryAbove ? 'very' : 'loud');
        this.loudS = -2; // at most one call every few seconds
      }
    } else {
      this.loudS = Math.max(0, this.loudS - dt);
      if (over < this.quietBelow) this.quietS += dt;
      // The quiet room slowly becomes the new normal (an air conditioner switched on).
      if (over < 3) this.base = this.base * 0.995 + this.smooth * 0.005;
      if (this.quietS >= this.quietForStarS) { out.push('quiet'); this.quietS = 0; }
    }
    return out;
  }
}

/** Loudness in dBFS of a block of samples. */
export function blockDb(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}

export class NoiseMeter {
  /** @param {{onEvent: (e: 'loud'|'very'|'quiet') => void, onLevel?: (level: number, quiet: number) => void, paused?: () => boolean}} opts */
  constructor(opts) {
    this.opts = opts;
    this.active = false;
  }

  async start() {
    if (this.active) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      return false;
    }
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.judge = new NoiseJudge();
    this.active = true;
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (this.opts.paused?.()) return; // his own voice must not count as the class
      this.analyser.getFloatTimeDomainData(this.buf);
      for (const e of this.judge.feed(blockDb(this.buf), dt)) this.opts.onEvent(e);
      this.opts.onLevel?.(this.judge.level, this.judge.quietProgress, this.judge.base === null);
    }, 100);
    return true;
  }

  stop() {
    this.active = false;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
  }
}
