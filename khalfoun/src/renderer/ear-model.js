// Khalfoun's own ear: listens on the teacher's computer, all the time, for «يا خلفون» only.
// Three small ONNX models, the same steps as the training code (tools/ear/features.py):
// every 80 ms of 16 kHz sound → mel frames → one 96-number embedding → the last 16 embeddings
// (1.28 s) → a score from 0 to 1 from the classifier trained on his voice.
// The ONNX runtime is passed in (the page's WebAssembly one, or Node's in the tests).

export const CHUNK = 1280; // 80 ms at 16 kHz
const CTX = 480; // the mel model needs a little sound before the chunk
const WIN = 76; // mel frames per embedding
const N_EMB = 16; // embeddings the classifier looks at

export class EarStream {
  /**
   * @param {object} ort onnxruntime (web or node build)
   * @param {{mel: Uint8Array, emb: Uint8Array, cls: Uint8Array}} models
   */
  static async create(ort, models) {
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const [mel, emb, cls] = await Promise.all([
      ort.InferenceSession.create(models.mel, opts),
      ort.InferenceSession.create(models.emb, opts),
      ort.InferenceSession.create(models.cls, opts),
    ]);
    return new EarStream(ort, mel, emb, cls);
  }

  constructor(ort, mel, emb, cls) {
    this.ort = ort;
    this.mel = mel;
    this.emb = emb;
    this.cls = cls;
    this.busy = false;
    this.reset();
  }

  reset() {
    this.raw = new Float32Array(CTX);
    this.frames = []; // rows of 32
    for (let i = 0; i < WIN; i += 1) this.frames.push(new Float32Array(32).fill(1));
    this.embs = [];
    this.pending = new Float32Array(0);
  }

  /**
   * One 80 ms chunk (1280 samples at int16 scale) → its score once 16 embeddings exist, else null.
   * @param {Float32Array} chunk
   */
  async step(chunk) {
    const buf = new Float32Array(CTX + CHUNK);
    buf.set(this.raw.subarray(this.raw.length - CTX), 0);
    buf.set(chunk, CTX);
    this.raw = buf;
    const melOut = await this.mel.run({ input: new this.ort.Tensor('float32', buf, [1, buf.length]) });
    const m = Object.values(melOut)[0];
    const rows = m.data.length / 32; // output is (1, 1, frames, 32)
    const data = m.data;
    for (let r = Math.max(0, rows - 8); r < rows; r += 1) {
      const row = new Float32Array(32);
      for (let k = 0; k < 32; k += 1) row[k] = data[r * 32 + k] / 10 + 2;
      this.frames.push(row);
    }
    if (this.frames.length > WIN + 8) this.frames.splice(0, this.frames.length - (WIN + 8));
    const win = new Float32Array(WIN * 32);
    const start = this.frames.length - WIN;
    for (let i = 0; i < WIN; i += 1) win.set(this.frames[start + i], i * 32);
    const e = Object.values(await this.emb.run({ input_1: new this.ort.Tensor('float32', win, [1, WIN, 32, 1]) }))[0].data;
    this.embs.push(Float32Array.from(e));
    if (this.embs.length > N_EMB) this.embs.shift();
    if (this.embs.length < N_EMB) return null;
    const x = new Float32Array(N_EMB * 96);
    this.embs.forEach((v, i) => x.set(v, i * 96));
    const s = Object.values(await this.cls.run({ x: new this.ort.Tensor('float32', x, [1, N_EMB, 96]) }))[0].data[0];
    return s;
  }

  /**
   * Feeds 16 kHz sound (-1..1) of any length; returns the highest score among the new chunks.
   * Sound that arrives while the last batch is still being scored waits for the next call.
   * @param {Float32Array} samples
   */
  async push(samples) {
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending, 0);
    joined.set(samples, this.pending.length);
    this.pending = joined;
    if (this.busy) return null;
    this.busy = true;
    let best = null;
    try {
      while (this.pending.length >= CHUNK) {
        const chunk = new Float32Array(CHUNK);
        for (let i = 0; i < CHUNK; i += 1) chunk[i] = this.pending[i] * 32767;
        this.pending = this.pending.slice(CHUNK);
        const s = await this.step(chunk);
        if (s !== null && (best === null || s > best)) best = s;
        if (this.pending.length > CHUNK * 25) this.pending = this.pending.slice(this.pending.length - CHUNK * 2); // fell behind: skip
      }
    } finally { this.busy = false; }
    return best;
  }
}

/**
 * When a score means «he called me»: above the threshold twice in a row, or once well above
 * it. Then a pause, so one call is one wake.
 */
export class EarTrigger {
  constructor({ threshold = 0.5, high = 0.85, refractoryMs = 2000 } = {}) {
    this.threshold = threshold;
    this.high = high;
    this.refractoryMs = refractoryMs;
    this.prev = 0;
    this.lastAt = -Infinity;
    this.peak = 0;
  }

  /** @returns {boolean} true when this score completes a call */
  feed(score, now = Date.now()) {
    if (score === null || score === undefined) return false;
    this.peak = Math.max(this.peak, score);
    const hit = now - this.lastAt > this.refractoryMs && (score >= this.high || (score >= this.threshold && this.prev >= this.threshold));
    this.prev = score;
    if (hit) this.lastAt = now;
    return hit;
  }

  /** Highest score since last asked (written to the log beside the cloud's answer). */
  takePeak() { const p = this.peak; this.peak = 0; return p; }
}
