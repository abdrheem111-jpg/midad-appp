// Always-on listening for «يا خلفون». The microphone feeds a voice detector;
// only short spoken sentences are turned into a WAV and handed on for local
// recognition. Silence and background noise never leave this page.

import { VoiceActivityDetector } from './vad.js';
import { downsample, encodeWav } from './wav.js';

const TARGET_RATE = 16000;
const MIN_SENTENCE_MS = 350;

export class WakeListener {
  /**
   * @param {{onSentence: (wav: Uint8Array, ms: number) => void, onError?: (err: Error) => void}} opts
   */
  constructor(opts) {
    this.onSentence = opts.onSentence;
    this.onError = opts.onError || (() => {});
    this.active = false;
    this.paused = false;
  }

  async start() {
    if (this.active) return;
    this.active = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.ctx = new AudioContext();
      await this.ctx.audioWorklet.addModule('recorder-worklet.js');
      this.vad = new VoiceActivityDetector({ sampleRate: this.ctx.sampleRate, maxMs: 5000 });
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'khalfoun-recorder');
      this.node.port.onmessage = (e) => {
        if (this.paused) return;
        for (const ev of this.vad.push(e.data)) {
          if (ev.type === 'segment' && ev.ms >= MIN_SENTENCE_MS) {
            const wav = encodeWav(downsample(ev.samples, this.ctx.sampleRate, TARGET_RATE), TARGET_RATE);
            this.onSentence(wav, ev.ms);
          }
        }
      };
      this.src.connect(this.node);
    } catch (err) {
      this.stop();
      this.onError(err);
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
  }

  resume() {
    this.paused = false;
    this.vad?.reset();
  }
}
