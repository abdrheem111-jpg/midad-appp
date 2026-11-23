// The page side of the Claude mind: sends what the teacher says to Claude, shows and speaks
// what Claude says (each piece as it comes), plays Khalfoun's feelings, draws on the screen
// where Claude decided, asks the teacher yes/no questions, runs the ready classroom features
// and keeps what Claude chose to remember.

import { normalize } from '../core/arabic.js';
import { splitFeeling } from '../core/claude-persona.js';

/** Claude's feelings → Khalfoun's face and body. */
export const FEELING_LOOK = {
  happy: ['happy', 'happy'], excited: ['excited', 'excited'], proud: ['proud', 'proud'], thinking: ['focused', 'think'],
  curious: ['curious', 'look_around'], focused: ['focused', 'cast'], surprised: ['amazed', 'amazed'], shy: ['shy', 'shy'],
  sad: ['sad', 'sad'], sorry: ['shy', 'facepalm'], laughing: ['happy', 'laugh'], calm: ['calm', null], love: ['grateful', 'heart'],
  tired: ['sleepy', 'yawn'],
};

const YES = new Set(['نعم', 'ايه', 'اي', 'ايوه', 'اكيد', 'تمام', 'اوكي', 'موافق', 'سوها', 'سويها', 'يلا', 'طيب', 'ok', 'yes', 'نعم سوها', 'ايه سوها', 'اوكي سوها', 'ايوا']);
const NO = new Set(['لا', 'لاء', 'لا لا', 'خلاص لا', 'لا تسوي', 'لا تسويها', 'وقف', 'الغي', 'لا شكرا', 'no', 'بلاش', 'لا خلها']);

export function yesNo(text) {
  const t = normalize(String(text || '')).replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (YES.has(t) || /^(?:نعم|ايه|اي|ايوه|اكيد|تمام|اوكي|موافق)(?: |$)/.test(t)) return 'yes';
  if (NO.has(t) || /^(?:لا|لاء|بلاش)(?: |$)/.test(t)) return 'no';
  return null;
}

/** Sentences that stop Claude at once, without asking it. */
const STOP = new Set(['وقف', 'وقف وقف', 'بس', 'بس خلاص', 'خلاص وقف', 'الغي', 'الغيه', 'كنسل', 'stop']);
export const isStop = (text) => STOP.has(normalize(String(text || '')).replace(/[^\p{L}\p{N} ]/gu, '').trim());

export class MindClient {
  /**
   * @param {object} d page helpers: bridge, brain, ink, character, animator, sounds, voiceOut,
   *   showBubble(text, mood, long), handle(reply), localHear(text) (the classic engine, quiet), note()
   */
  constructor(d) {
    this.d = d;
    this.info = { installed: false, loggedIn: false, on: false };
    this.busy = false;
    this.question = null; // { id, ask } while a yes/no question waits
    this.speech = [];
    this.spoken = '';
    this.mood = 'calm';
    this.live = '';
    this.timer = setInterval(() => this.speakNext(), 200);
  }

  get on() { return Boolean(this.info.on && this.info.loggedIn); }

  async refresh() {
    try { this.info = (await this.d.bridge.mind?.status()) || this.info; } catch { /* keeps the last */ }
    return this.info;
  }

  // ---------------------------------------------------------------- speaking

  say(text, { long = false } = {}) {
    const t = String(text || '').trim();
    if (!t) return;
    this.d.showBubble(t, this.mood, long || t.length > 140);
    if (this.d.voiceOut.enabled) this.speech.push(t);
  }

  speakNext() {
    if (!this.speech.length || this.d.voiceOut.speaking || this.d.recorderActive?.()) return;
    this.d.voiceOut.speak(this.speech.shift());
  }

  feel(feeling) {
    const look = FEELING_LOOK[feeling];
    if (!look) return;
    this.mood = look[0];
    this.d.character.setEmotion({ emotion: look[0], intensity: 2 });
    if (look[1]) this.d.animator.play(look[1]);
  }

  // ---------------------------------------------------------------- one sentence

  /**
   * @param {string} text what the teacher said
   * @param {{via?: 'voice'|'typed'}} [opts]
   * @returns {Promise<boolean>} false when Claude could not take it (the classic engine should)
   */
  async ask(text, opts = {}) {
    if (this.question) {
      const a = yesNo(text);
      if (a) { this.answer(a); return true; }
    }
    if (isStop(text)) {
      if (this.busy) { this.d.bridge.mind.stop(); this.speech = []; this.d.voiceOut.stop?.(); this.feel('calm'); this.say('وقفت.'); return true; }
      return false;
    }
    this.busy = true;
    this.spoken = '';
    this.feel('thinking');
    const thinking = setTimeout(() => { if (this.busy && !this.spoken) this.d.showBubble('…', 'focused'); }, 900);
    const m = this.d.brain.memory.data;
    const res = await this.d.bridge.mind.ask(text, {
      via: opts.via || 'voice', name: m.name || '', students: m.classroom?.students || [], notes: m.claudeNotes || [],
      period: this.d.periodNow?.() || '',
    });
    clearTimeout(thinking);
    this.busy = false;
    this.lastAct = Date.now();
    if (res?.ok) {
      const finalText = String(res.say || '').trim();
      // The last piece is usually what was already spoken while Claude worked.
      if (finalText && !this.spoken.includes(finalText.slice(0, 40))) this.say(finalText);
      if (!finalText && !this.spoken) this.d.character.setEmotion({ emotion: 'calm', intensity: 1 });
      this.d.note?.(`claude answered in ${(res.ms / 1000).toFixed(1)} s`);
      return true;
    }
    this.d.note?.(`claude failed: ${res?.error}`);
    if (res?.error === 'stopped') return true;
    if (res?.error === 'auth') { this.info.loggedIn = false; this.feel('sorry'); this.say('اشتراك Claude مو مربوط. افتح الإعدادات واضغط «اربط اشتراكي».'); return true; }
    if (res?.error === 'limit') { this.feel('tired'); this.say('خلص رصيد Claude لهالفترة. برد عليك بمخي العادي لين يرجع.'); return false; }
    if (res?.error === 'no_program') { this.feel('sorry'); this.say('برنامج Claude مو منزّل. من الإعدادات اضغط «نزّل مخ Claude».'); return true; }
    return false; // offline, busy, failed: the classic engine answers
  }

  // ---------------------------------------------------------------- what Claude sends

  /** Live events while Claude works. */
  onEvent(e) {
    if (!e) return;
    if (e.type === 'text') {
      // «[happy] هلا والله»: the feeling plays on his face, the words are said.
      const { feeling, text: words } = splitFeeling(e.text);
      if (feeling) this.feel(feeling);
      const t = words.replace(/\[[a-z]+\]\s*/gi, '').trim();
      if (!t) return;
      this.spoken += `${t}\n`;
      this.say(t);
    } else if (e.type === 'tool') {
      this.d.onTool?.(e.name, e.input);
      if (['click', 'type_text', 'press_keys', 'drag', 'scroll'].includes(e.name)) this.d.animator.play('point');
      if (e.name === 'look_screen' || e.name === 'find_text') this.d.animator.play('look_around');
    } else if (e.type === 'login' || e.type === 'install') {
      this.d.onSetup?.(e);
    }
  }

  /** A tool needs the page: returns the answer to main. */
  async onUi(msg) {
    const { id, kind, payload: p = {} } = msg || {};
    const reply = (result) => this.d.bridge.mind.reply(id, result);
    try {
      switch (kind) {
        case 'feel': this.feel(p.feeling); return reply({ ok: true });
        case 'ink': return reply(this.ink(p));
        case 'ask': return this.ask_(id, p.question, reply);
        case 'classroom': return reply(this.classroom(p.command));
        case 'remember': return reply(this.remember(p.fact));
        default: return reply({ ok: false });
      }
    } catch (err) {
      this.d.note?.(`mind ui ${kind} failed: ${err?.message || err}`);
      return reply({ ok: false });
    }
  }

  ink(p) {
    const { ink, character, animator } = this.d;
    const hexOf = (c) => (c && /^[a-z]+$/.test(c) ? c : 'blue');
    if (p.op === 'clear') { ink.clear(); return { ok: true }; }
    if (p.op === 'write') ink.write(p.text, { at: p.at, anchor: p.anchor || 'right', size: p.size || 0, color: hexOf(p.color) });
    else if (p.op === 'shape') ink.draw({ shape: p.shape, color: p.color, box: p.box, text: p.label || '' });
    else if (p.op === 'mark') ink.mark(p.boxes, { mark: p.mark, color: p.color });
    character.setPenColor?.(this.d.colorHex?.(p.color) || '#1D70B8');
    animator.play('write');
    return { ok: true };
  }

  ask_(id, question, reply) {
    this.feel('curious');
    const timer = setTimeout(() => { if (this.question?.id === id) this.answer(null); }, 58000);
    this.question = { id, reply, timer };
    this.say(String(question || ''), { long: true });
    this.d.showChoices?.(['نعم', 'لا'], (a) => this.answer(a === 'نعم' ? 'yes' : 'no'));
  }

  answer(a) {
    const q = this.question;
    if (!q) return;
    this.question = null;
    clearTimeout(q.timer);
    this.d.hideChoices?.();
    q.reply({ answer: a || 'none' });
  }

  classroom(command) {
    const r = this.d.localHear(String(command || ''));
    const understood = Boolean(r) && !['not_understood', 'confused'].includes(r.situation);
    return { understood, situation: r?.situation || null, say: r?.say || '' };
  }

  remember(fact) {
    const f = String(fact || '').trim().slice(0, 200);
    if (!f) return { ok: false };
    const m = this.d.brain.memory;
    const notes = Array.isArray(m.data.claudeNotes) ? m.data.claudeNotes : [];
    if (!notes.includes(f)) notes.push(f);
    m.set({ claudeNotes: notes.slice(-40) });
    return { ok: true };
  }
}
