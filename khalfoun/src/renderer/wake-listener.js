// Always-on listening for «يا خلفون». The microphone feeds a voice detector;
// only short spoken sentences are turned into a WAV and handed on for local
// recognition. Silence and background noise never leave this page.

import { VoiceActivityDetector } from './vad.js';
import { downsample, encodeWav } from './wav.js';

const TARGET_RATE = 16000;
const MIN_SENTENCE_MS = 350;
/** «يا خلفون» comes at the start: only this much is sent to check for his name. */
export const HEAD_MS = 2500;

/** The microphone he chose in settings (a wireless one), or the computer's default. */
let chosenMic = '';
export function setMicChoice(id) { chosenMic = typeof id === 'string' ? id : ''; }
export const micChoice = () => (chosenMic ? { deviceId: { ideal: chosenMic } } : {});

export class WakeListener {
  /**
   * @param {{onSentence: (wav: Uint8Array, ms: number, head: Uint8Array) => void, onError?: (err: Error) => void,
   *   onAudio?: (samples16k: Float32Array) => void}} opts
   *   head: the first HEAD_MS of the sentence (enough to hear his name, a fraction of the cost)
   *   onAudio: all the sound at 16 kHz, in batches of about 85 ms (Khalfoun's own ear listens to it)
   */
  constructor(opts) {
    this.onSentence = opts.onSentence;
    this.onAudio = opts.onAudio || null;
    this.batch = [];
    this.batchLen = 0;
    this.onError = opts.onError || (() => {});
    this.active = false;
    this.paused = false;
  }

  async start() {
    if (this.active) return;
    this.active = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...micChoice() } });
      this.ctx = new AudioContext();
      await this.ctx.audioWorklet.addModule('recorder-worklet.js');
      // Long enough for a whole question read from the board (was 9 s: questions were cut).
      this.vad = new VoiceActivityDetector({ sampleRate: this.ctx.sampleRate, maxMs: 25000 });
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'khalfoun-recorder');
      this.node.port.onmessage = (e) => {
        if (this.paused || this.external) return; // the phone is the microphone now
        if (this.onAudio) {
          this.batch.push(e.data);
          this.batchLen += e.data.length;
          if (this.batchLen >= this.ctx.sampleRate * 0.085) {
            const all = new Float32Array(this.batchLen);
            let off = 0;
            for (const c of this.batch) { all.set(c, off); off += c.length; }
            this.batch = []; this.batchLen = 0;
            this.onAudio(downsample(all, this.ctx.sampleRate, TARGET_RATE));
          }
        }
        for (const ev of this.vad.push(e.data)) {
          if (ev.type === 'segment' && ev.ms >= MIN_SENTENCE_MS) this.sentence(downsample(ev.samples, this.ctx.sampleRate, TARGET_RATE), ev.ms);
        }
      };
      this.src.connect(this.node);
    } catch (err) {
      this.stop();
      this.onError(err);
    }
  }

  sentence(pcm, ms) {
    const wav = encodeWav(pcm, TARGET_RATE);
    const headLen = Math.round((HEAD_MS / 1000) * TARGET_RATE);
    const head = pcm.length > headLen ? encodeWav(pcm.subarray(0, headLen), TARGET_RATE) : wav;
    this.onSentence(wav, ms, head);
  }

  /**
   * The phone as the microphone: its sound (16 kHz, -1..1) goes through the same steps (his
   * ear, sentences, «يا خلفون»), and the computer's microphone is ignored meanwhile.
   * @param {boolean} on
   */
  useExternal(on) {
    this.external = Boolean(on);
    if (on && !this.extVad) this.extVad = new VoiceActivityDetector({ sampleRate: TARGET_RATE, maxMs: 25000 });
    if (!on) this.extVad = null;
  }

  /** @param {Float32Array} samples16k */
  feed(samples16k) {
    if (!this.external || this.paused) return;
    this.onAudio?.(samples16k);
    for (const ev of this.extVad.push(samples16k)) {
      if (ev.type === 'segment' && ev.ms >= MIN_SENTENCE_MS) this.sentence(ev.samples, ev.ms);
    }
  }

  /** Stops listening and releases the microphone. */
  stop() {
    this.active = false;
    try { this.src?.disconnect(); } catch { /* already gone */ }
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.src = null;
    this.node = null;
  }

  /** Ignores sound for a while (e.g. during a push-to-talk command) without closing the mic. */
  pause() {
    this.paused = true;
    this.vad?.reset();
    this.extVad?.reset();
  }

  resume() {
    this.paused = false;
    this.vad?.reset();
    this.extVad?.reset();
  }
}
