// Khalfoun's optional speaking voice: the Arabic text-to-speech voice that
// Windows (or macOS) already has, through the browser speech API. Off by
// default; nothing is sent anywhere.

/** Text as it should be spoken: no emoji, no «(قول ...)» hints, no symbols read aloud. */
export function speakableText(text) {
  return String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[«»"“”*#_~|<>]/g, ' ')
    .replace(/[⏱⭐🥁]/gu, ' ')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
  }

  get voice() {
    return this.synth ? pickArabicVoice(this.synth.getVoices()) : null;
  }

  /** True when this computer has an Arabic voice to speak with. */
  get available() {
    return Boolean(this.synth && this.Utterance && this.voice);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.stop();
  }

  /** Speaks a line (replacing whatever he was saying). Returns false when it could not. */
  speak(text) {
    if (!this.enabled || !this.available) return false;
    const line = speakableText(text);
    if (!line) return false;
    this.stop();
    const u = new this.Utterance(line);
    u.voice = this.voice;
    u.lang = u.voice.lang;
    u.rate = 1.02;
    u.pitch = 1.3; // a little higher: a cartoon voice
    u.onstart = () => { this.speaking = true; this.onStart?.(); };
    u.onend = () => { this.speaking = false; this.onEnd?.(); };
    u.onerror = () => { this.speaking = false; this.onEnd?.(); };
    this.synth.speak(u);
    return true;
  }

  stop() {
    if (this.synth && (this.speaking || this.synth.speaking)) this.synth.cancel();
    this.speaking = false;
  }
}
