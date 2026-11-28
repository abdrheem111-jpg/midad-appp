// Khalfoun's optional speaking voice. With the person's Azure key, an Omani neural voice
// from the cloud (set `remote`); otherwise the Arabic voice Windows already has, through
// the browser speech API. Off by default.

import { spokenMath, sentenceChunks } from '../core/speech-text.js';
import { forVoice } from '../core/pronounce.js';

/**
 * Text as it should be spoken: no emoji, no «(قول ...)» hints, maths read as words, then the
 * pronunciation dictionary and the natural stop at the end of each sentence (core/pronounce.js).
 * @param {Record<string, string>} [lexicon] the teacher's own corrections
 */
export function speakableText(text, lexicon) {
  return forVoice(spokenMath(String(text || '')
    .replace(/\[[a-z]+\]\s*/gi, ' ')
    .replace(/\((?:قول|اكتب|مثلاً|مثلا)[^)]*\)/g, ' '))
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[«»"“”*#_~|<>]/g, ' ')
    .replace(/[⏱⭐🥁]/gu, ' ')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim(), lexicon);
}

/** The best Arabic voice in a list (Omani or Gulf first), or null. */
export function pickArabicVoice(voices) {
  const ar = (voices || []).filter((v) => /^ar(-|_|$)/i.test(v.lang || ''));
  const order = ['ar-OM', 'ar-AE', 'ar-SA', 'ar-KW', 'ar-QA', 'ar-BH', 'ar-EG'];
  for (const lang of order) {
    const v = ar.find((x) => (x.lang || '').toLowerCase() === lang.toLowerCase());
    if (v) return v;
  }
  return ar[0] || null;
}

export class VoiceOut {
  /** @param {{synth?: SpeechSynthesis, Utterance?: typeof SpeechSynthesisUtterance}} [deps] */
  constructor(deps = {}) {
    this.synth = deps.synth ?? (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null);
    this.Utterance = deps.Utterance ?? (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null);
    this.enabled = false;
    this.speaking = false;
    this.onStart = null;
    this.onEnd = null;
    /** @type {null | ((line: string) => Promise<{ok: boolean, audio?: Uint8Array}>)} cloud voice */
    this.remote = null;
    /** @type {() => Record<string, string>} the teacher's pronunciation corrections */
    this.lexicon = deps.lexicon || (() => ({}));
    this.AudioCtor = deps.Audio ?? (typeof Audio !== 'undefined' ? Audio : null);
    this.seq = 0;
    this.audio = null;
    this.lines = []; // sentences still to say: {text, audio: Promise} (cloud) or strings (Windows voice)
  }

  get voice() {
    return this.synth ? pickArabicVoice(this.synth.getVoices()) : null;
  }

  /** True when this computer has an Arabic voice to speak with. */
  get localAvailable() {
    return Boolean(this.synth && this.Utterance && this.voice);
  }

  get available() {
    return Boolean((this.remote && this.AudioCtor) || this.localAvailable);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.stop();
  }

  /** Speaks a line (replacing whatever he was saying). Returns false when it could not. */
  speak(text) {
    if (!this.enabled || !this.available) return false;
    const line = speakableText(text, this.lexicon());
    if (!line) return false;
    this.stop();
    if (this.remote && this.AudioCtor) return this.queue(text);
    return this.speakLocal(line);
  }

  /**
   * Adds a reply to what he is saying: read sentence by sentence with the cloud voice, the next
   * sentence's sound fetched while this one plays, so there are no pauses between them.
   */
  queue(text) {
    if (!this.enabled || !this.available) return false;
    const chunks = sentenceChunks(speakableText(text, this.lexicon())).filter(Boolean);
    if (!chunks.length) return false;
    if (!(this.remote && this.AudioCtor)) { for (const c of chunks) this.lines.push(c); this.pumpLocal(); return true; }
    const token = this.seq;
    for (const c of chunks) this.lines.push({ text: c, audio: null });
    this.prefetch(token);
    if (!this.speaking) this.playNext(token);
    return true;
  }

  prefetch(token) {
    // the next two sentences are being fetched at any time
    for (const item of this.lines.slice(0, 2)) {
      if (!item.audio) item.audio = this.remote(item.text).catch(() => null);
    }
    void token;
  }

  playNext(token) {
    if (token !== this.seq) return;
    const item = this.lines.shift();
    if (!item) { if (this.speaking) { this.speaking = false; this.audio = null; this.onEnd?.(); } return; }
    if (!this.speaking) { this.speaking = true; this.onStart?.(); }
    if (!item.audio) item.audio = this.remote(item.text).catch(() => null);
    this.prefetch(token);
    item.audio.then((res) => {
      if (token !== this.seq) return;
      if (!res?.ok || !res.audio) { this.speakLocal(item.text, () => this.playNext(token)); return; }
      const url = URL.createObjectURL(new Blob([res.audio], { type: 'audio/mpeg' }));
      const a = new this.AudioCtor(url);
      this.audio = a;
      this.lipSync?.(a); // the mouth follows this sound
      const next = () => { URL.revokeObjectURL(url); if (token === this.seq) this.playNext(token); };
      a.onended = next;
      a.onerror = next;
      a.play().catch(next);
    });
    return true;
  }

  pumpLocal() {
    if (this.synth?.speaking) return;
    const line = this.lines.shift();
    if (typeof line === 'string') this.speakLocal(line, () => this.pumpLocal());
  }

  /** The Windows voice. */
  speakLocal(line, after) {
    if (!this.localAvailable) { after?.(); return false; }
    const u = new this.Utterance(line);
    u.voice = this.voice;
    u.lang = u.voice.lang;
    u.rate = 1.02;
    u.pitch = 1.3; // a little higher: a cartoon voice
    u.onstart = () => { this.speaking = true; this.onStart?.(); };
    // the PC's own voice gives no sound to measure: the mouth moves with each word instead
    u.onboundary = () => { this.onWord?.(); };
    u.onend = () => { this.speaking = false; this.onEnd?.(); after?.(); };
    u.onerror = () => { this.speaking = false; this.onEnd?.(); after?.(); };
    this.synth.speak(u);
    return true;
  }

  stop() {
    this.seq += 1;
    this.lines = [];
    if (this.audio) { try { this.audio.pause(); } catch { /* gone */ } this.audio = null; }
    if (this.synth && (this.speaking || this.synth.speaking)) this.synth.cancel();
    if (this.speaking) { this.speaking = false; this.onEnd?.(); }
  }
}
