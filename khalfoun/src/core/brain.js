// The brain ties everything together: hears a sentence, understands it, checks
// permission, plans an action for the shell to run, updates emotions and picks
// a reply. It never touches the OS itself, so it is fully testable.

import { recognize, splitCommands, nearestApp, phraseKey, APPS } from './intents.js';
import { EmotionEngine } from './emotions.js';
import { ResponseEngine } from './responses.js';
import { decide, LEVEL_INFO } from './permissions.js';
import { Memory } from './memory.js';
import { normalize, toArabicDigits } from './arabic.js';
import { TEMPLATES, APP_NAMES } from './templates/ar-om.js';
import { Quiz, parseArabicNumber } from './quiz.js';
import { occasionFor } from './occasions.js';

const FEELING_LABEL = { tired: 'تعبان', sad: 'متضايق', sick: 'مريض', stressed: 'مضغوط' };
const HOUR = 60 * 60 * 1000;

const LAUGH_RE = /(ههه|خخخ|ضحكتني|حلوه|حلوة|يضحك|مضحك|😂|🤣)/u;
const BOO_RE = /(بايخه|بايخ|سخيفه|سخيف|مب حلوه|ما ضحكت|ماضحكت|ثقيله)/u;
const FEEDBACK_WINDOW_MS = 30000;
const STREAK_WINDOW_MS = 2 * 60 * 1000;

/** "بعد 5 دقايق" with correct Arabic number agreement. */
export function durationPhrase(minutes) {
  const m = Math.round(minutes);
  if (m % 60 === 0 && m >= 60) {
    const h = m / 60;
    if (h === 1) return 'ساعة';
    if (h === 2) return 'ساعتين';
    if (h <= 10) return `${toArabicDigits(h)} ساعات`;
    return `${toArabicDigits(h)} ساعة`;
  }
  if (m === 1) return 'دقيقة';
  if (m === 2) return 'دقيقتين';
  if (m <= 10) return `${toArabicDigits(m)} دقايق`;
  return `${toArabicDigits(m)} دقيقة`;
}

export class Brain {
  /**
   * @param {{memory?: Memory, memoryData?: object, onMemoryChange?: (d: object) => void,
   *          rng?: () => number, clock?: () => number, locale?: string}} [opts]
   */
  constructor(opts = {}) {
    this.clock = opts.clock || (() => Date.now());
    this.memory = opts.memory || new Memory(opts.memoryData, opts.onMemoryChange);
    const em = this.memory.data.emotion;
    this.emotions = new EmotionEngine({ ...em, now: this.clock() });
    this.responses = new ResponseEngine({ templates: TEMPLATES, rng: opts.rng || Math.random, memory: this.memory });
    this.locale = opts.locale || 'ar-OM';
    this.pending = null; // action waiting for a spoken yes/no
    this.inflight = new Map(); // action id -> spec waiting for a result from the shell
    this.nextId = 1;
    this.lastHumorous = null; // {cat, at} for learning from reactions
    this.successes = [];
    this.focus = false;
    this.quiz = null;
    this.chatHistory = [];
    this.quizTries = 0;
    this.rng = opts.rng || Math.random;
    this.lastIdleTalk = this.clock();
    // Conversation context: what was last opened, the last command (for «مرة ثانية»),
    // the last sentence he did not understand (to learn the person's own words),
    // and commands still waiting from a sentence that held several.
    this.context = { lastOpen: null, lastCommand: null, lastUnknown: null };
    this.queue = [];
  }

  get settings() {
    const d = this.memory.data;
    return { level: d.level, kidsMode: d.kidsMode, humor: d.humor, name: d.name, onboarded: d.onboarded };
  }

  // ------------------------------------------------------------------ public

  /** Called once when the app starts. Returns a welcome reply (or null before onboarding). */
  start() {
    const now = this.clock();
    if (!this.memory.data.onboarded) return null;
    const days = this.memory.touch(now);
    const occasion = this.currentOccasion();
    const today = new Date(now).toDateString();
    if (occasion && this.memory.data.occasionSeen !== `${occasion.id}:${today}`) {
      this.memory.set({ occasionSeen: `${occasion.id}:${today}` });
      this.emotions.feel(occasion.id === 'friday' ? 'greet' : 'celebrate', now);
      return this.reply(`occasion_${occasion.id}`, { costume: occasion.costume });
    }
    if (days >= 2) {
      this.emotions.feel('return_after_days', now);
      return this.reply('return_long', { vars: { days: toArabicDigits(days) } });
    }
    const last = this.memory.data.lastFeeling;
    if (last && FEELING_LABEL[last.kind] && now - last.at > 6 * HOUR && now - last.at < 48 * HOUR) {
      this.memory.set({ lastFeeling: null });
      this.emotions.feel('care', now);
      return this.reply('feel_followup', { vars: { feeling: FEELING_LABEL[last.kind] } });
    }
    this.emotions.feel('greet', now);
    return this.reply(this.greetSituation('any'));
  }

  /** Today's Omani occasion (national day, Ramadan, Eid, Friday...) or null. */
  currentOccasion() {
    return occasionFor(new Date(this.clock()));
  }

  /** Finishes onboarding with the choices made on the welcome screen. */
  completeOnboarding({ name = '', level = 1, kidsMode = false, humor = 1, alwaysListen = false } = {}) {
    this.memory.set({
      onboarded: true, name: String(name).trim().slice(0, 40), level: Math.min(3, Math.max(1, Number(level) || 1)),
      kidsMode: !!kidsMode, humor: Math.min(2, Math.max(0, Number(humor))), alwaysListen: !!alwaysListen,
    });
    this.emotions.feel('greet', this.clock());
    return this.reply('onboard_done');
  }

  /** Changes settings from the settings panel. */
  updateSettings(patch) {
    const allowed = {};
    if ('name' in patch) allowed.name = String(patch.name).trim().slice(0, 40);
    if ('level' in patch) allowed.level = Math.min(3, Math.max(1, Number(patch.level) || 1));
    if ('kidsMode' in patch) allowed.kidsMode = !!patch.kidsMode;
    if ('humor' in patch) allowed.humor = Math.min(2, Math.max(0, Number(patch.humor) || 0));
    if ('alwaysListen' in patch) allowed.alwaysListen = !!patch.alwaysListen;
    this.memory.set(allowed);
    if ('level' in allowed) return this.reply('level_set', { vars: { level: LEVEL_INFO[allowed.level].name } });
    return null;
  }

  setFocus(on) { this.focus = !!on; }

  /**
   * Handles one sentence from the person.
   * @param {string} raw
   */
  hear(raw) {
    const now = this.clock();
    this.memory.touch(now);
    this.learnFromReaction(raw, now);
    // A sentence with several commands runs them one after another.
    if (!this.pending && !this.quiz) {
      const parts = splitCommands(raw);
      if (parts.length > 1) {
        this.queue = parts.slice(1);
        return this.withMore(this.hearOne(parts[0], now));
      }
    }
    this.queue = [];
    return this.hearOne(raw, now);
  }

  /** The next command from a sentence that held several (the shell calls this after a short pause). */
  continueQueue() {
    const next = this.queue.shift();
    if (!next) return null;
    return this.withMore(this.hearOne(next, this.clock()));
  }

  withMore(reply) {
    if (!reply) return reply;
    if (reply.awaitingConfirm) { this.queue = []; return reply; } // wait for the answer instead
    return this.queue.length ? { ...reply, more: true } : reply;
  }

  hearOne(raw, now) {
    // Phrases the person taught («لما أقول صباحو يعني افتح المتصفح»).
    const taught = (this.memory.data.aliases || {})[phraseKey(raw)];
    const heard = taught ? taught : raw;
    const r = recognize(heard);
    this.memory.recordCommand(r.intent);

    if (this.pending) {
      const pending = this.pending;
      if (pending.kind === 'routine') {
        if (r.intent === 'yes') {
          this.pending = null;
          const routines = (this.memory.data.routines || []).filter((x) => x.key !== pending.key);
          routines.push({ key: pending.key, hour: pending.hour, action: pending.action, summary: pending.summary, lastRun: '' });
          this.memory.set({ routines });
          this.emotions.feel('celebrate', now);
          return this.reply('routine_saved', { vars: { app: pending.appName, time: pending.timeText } });
        }
        if (r.intent === 'no' || r.intent === 'stop') {
          this.pending = null;
          this.memory.set({ routineAsked: { ...(this.memory.data.routineAsked || {}), [pending.key]: true } });
          return this.reply('cancelled', { event: null });
        }
      }
      if (pending.kind === 'suggest' || pending.kind === 'learn') {
        if (r.intent === 'yes') {
          this.pending = null;
          if (pending.kind === 'suggest') return this.route(pending.intent, pending.raw, now);
          this.saveAlias(pending.phrase, pending.command);
          this.emotions.feel('celebrate', now);
          return this.reply('learn_saved', { vars: { phrase: pending.phrase, command: pending.command } });
        }
        if (r.intent === 'no' || r.intent === 'stop') {
          this.pending = null;
          return this.reply('cancelled', { event: null });
        }
      }
      if (r.intent === 'yes' && !pending.kind) {
        this.pending = null;
        return this.launch(pending.action, pending.spec, now, 'confirmed');
      }
      if (r.intent === 'no' || r.intent === 'stop') {
        this.pending = null;
        return this.reply('cancelled', { event: null });
      }
      this.pending = null; // anything else cancels and is handled normally
    }

    if (this.quiz) {
      const handled = this.quizTurn(r, raw, now);
      if (handled) return handled;
    }

    const out = this.route(r, heard, now);
    this.remember(r, heard, out, now);
    return out;
  }

  /** Keeps the context used by follow-ups and by learning the person's words. */
  remember(r, raw, out, now) {
    const REPEATABLE = ['volume', 'joke', 'dance', 'jump', 'open', 'search', 'time', 'quiz', 'screenshot'];
    if (REPEATABLE.includes(r.intent)) this.context.lastCommand = { raw, at: now };
    if (out?.situation === 'not_understood') this.context.lastUnknown = { raw, at: now };
    else if (r.intent !== 'repeat' && out?.action && this.context.lastUnknown) {
      const unknown = this.context.lastUnknown;
      this.context.lastUnknown = null;
      // A rephrase that worked right after something he did not get: offer to remember it.
      if (now - unknown.at < 60000 && unknown.raw.length <= 40 && out.action.id && !normalize(raw).includes(normalize(unknown.raw))) {
        const spec = this.inflight.get(out.action.id);
        if (spec) spec.learnFrom = { phrase: unknown.raw, command: raw };
      }
    }
  }

  saveAlias(phrase, command) {
    const aliases = { ...(this.memory.data.aliases || {}) };
    aliases[phraseKey(phrase)] = command;
    const keys = Object.keys(aliases);
    if (keys.length > 200) delete aliases[keys[0]];
    this.memory.set({ aliases });
  }

  /**
   * Non-verbal events from the shell: poke, tickle, drag, dropped, listening,
   * stt_unavailable, stt_empty, reminder_fire, other_assistant, setup_start,
   * setup_done, setup_failed ({kind: 'voice'|'brain'}).
   */
  event(name, data = {}) {
    const now = this.clock();
    switch (name) {
      case 'poke': this.emotions.feel('poke', now); return this.reply('poke');
      case 'tickle': this.emotions.feel('tickle', now); return this.reply('tickle');
      case 'drag': this.emotions.feel('dropped', now); return this.reply('drag');
      case 'dropped': this.emotions.feel('dropped', now); return this.reply('dropped');
      case 'slip': this.emotions.feel('dropped', now); return this.reply('slip');
      case 'hop_window': this.emotions.feel('curious', now); return this.reply('hop_window');
      case 'listening': this.emotions.feel('listening', now); return this.reply('listening');
      case 'stt_unavailable': this.emotions.feel('not_understood', now); return this.reply('stt_unavailable');
      case 'stt_empty': this.emotions.feel('not_understood', now); return this.reply('stt_empty');
      case 'mic_error': this.emotions.feel('error', now); return this.reply('mic_error');
      case 'reminder_fire': {
        this.emotions.feel('greet', now);
        return this.reply('reminder_fire', { vars: { noteSuffix: noteSuffix(data.note) } });
      }
      case 'setup_start':
        this.emotions.feel('focus_mode', now);
        return this.reply(data.kind === 'brain' ? 'setup_brain_start' : 'setup_voice_start');
      case 'setup_done':
        this.emotions.feel('celebrate', now);
        return this.reply(data.kind === 'brain' ? 'setup_brain_done' : 'setup_voice_done', { vars: { model: data.model || '' } });
      case 'setup_failed':
        this.emotions.feel('error', now);
        return this.reply('setup_failed', { vars: { reason: data.reason || 'صار خطأ أثناء التجهيز.' } });
      case 'wake_call':
        if (this.emotions.asleep) { this.emotions.feel('wake', now); return this.reply('wake', { behavior: 'wake' }); }
        this.emotions.feel('listening', now);
        return this.reply('call');
      default: return null;
    }
  }

  /**
   * The shell reports how an action went.
   * @param {number} id
   * @param {{ok: boolean, data?: any, error?: string}} result
   */
  actionResult(id, result) {
    const spec = this.inflight.get(id);
    if (!spec) return null;
    this.inflight.delete(id);
    const now = this.clock();
    this.memory.log({ action: spec.action.type, ok: !!result?.ok, error: result?.error || null, summary: spec.summary || '' }, now);
    if (!result || !result.ok) {
      this.emotions.feel('error', now);
      if (result?.error === 'not_running') return this.reply('close_not_running', { vars: spec.vars || {} });
      if (result?.error === 'cannot_close') return this.reply('close_tab', { vars: spec.vars || {} });
      if (result?.error === 'level_too_low') return this.reply('need_level');
      if (result?.error === 'kids_mode') return this.reply('kids_blocked');
      if (result?.error === 'no_pdf') return this.reply('pdf_none');
      return this.reply('failed');
    }
    this.markSuccess(now);
    if (spec.learnFrom && !this.pending) {
      this.pending = { kind: 'learn', ...spec.learnFrom };
      this.emotions.feel('curious', now);
      return this.reply('learn_offer', { vars: spec.learnFrom, awaitingConfirm: true });
    }
    if (['open_app', 'open_url', 'open_folder'].includes(spec.action.type) && !spec.routine) {
      const offer = this.learnHabit(spec, now);
      if (offer) return offer;
    }
    if (spec.sayOn === 'result') {
      const vars = { ...(spec.vars || {}) };
      let situation = spec.situation;
      if (spec.action.type === 'organize_downloads') {
        const count = result.data?.moved ?? 0;
        if (!count) situation = 'organize_empty';
        vars.count = toArabicDigits(count);
      }
      if (spec.action.type === 'cancel_reminders') {
        const count = result.data?.cancelled ?? 0;
        if (!count) situation = 'reminders_none';
        vars.count = toArabicDigits(count);
      }
      if (spec.action.type === 'undo_organize') {
        const count = result.data?.restored ?? 0;
        if (!count) situation = 'undo_none';
        vars.count = toArabicDigits(count);
      }
      return this.reply(situation, { vars });
    }
    return null;
  }

  /** Called every few seconds by the shell; may return an idle remark. */
  tick() {
    const now = this.clock();
    const before = this.emotions.current.emotion;
    const snap = this.emotions.tick(now);
    if (this.focus || snap.asleep) {
      if (snap.asleep && before !== 'sleepy') return this.reply('sleep', { behavior: 'sleep', event: null });
      return null;
    }
    if (snap.emotion === 'bored' && before !== 'bored') {
      this.lastIdleTalk = now;
      return this.reply('idle_bored', { event: null });
    }
    const humor = this.memory.data.humor;
    const gap = humor === 2 ? 3 * 60e3 : 6 * 60e3;
    if (humor > 0 && snap.idleMs > 60e3 && now - this.lastIdleTalk > gap) {
      this.lastIdleTalk = now;
      return this.reply('idle_comment', { event: null });
    }
    return null;
  }

  // ----------------------------------------------------------------- routing

  route(r, raw, now) {
    const s = r.slots;
    switch (r.intent) {
      case 'empty': return null;
      case 'call':
        if (this.emotions.asleep) { this.emotions.feel('wake', now); return this.reply('wake', { behavior: 'wake' }); }
        this.emotions.feel('listening', now); return this.reply('call');
      case 'yes': return this.reply('call');
      case 'no': return this.reply('cancelled');
      case 'stop': this.inflight.clear(); return this.reply('stop', { behavior: 'stop' });
      case 'greet': this.emotions.feel('greet', now); return this.reply(this.greetSituation(s.part));
      case 'how_are_you': this.emotions.feel('curious', now); return this.reply('how_are_you');
      case 'who': this.emotions.feel('curious', now); return this.reply('who');
      case 'thanks': this.emotions.feel('thanks', now); return this.reply('thanks');
      case 'praise': this.emotions.feel('praise', now); return this.reply('praise');
      case 'scold': this.emotions.feel('scold', now); return this.reply('scold');
      case 'goodbye': this.emotions.sleep(now); return this.reply('goodbye', { behavior: 'sleep' });
      case 'joke': this.emotions.feel('joke', now); return this.reply('joke');
      case 'help': this.emotions.feel('curious', now); return this.reply('help');
      case 'time': this.emotions.feel('success', now); return this.reply('time', { vars: { time: this.formatTime(now) } });
      case 'date': this.emotions.feel('success', now); return this.reply('date', { vars: { date: this.formatDate(now), day: this.formatDay(now) } });
      case 'sleep': this.emotions.sleep(now); return this.reply('sleep', { behavior: 'sleep', event: null });
      case 'wake': this.emotions.feel('wake', now); return this.reply('wake', { behavior: 'wake' });
      case 'come': this.focus = false; this.emotions.feel('curious', now); return this.reply('come', { behavior: 'come' });
      case 'away': this.focus = true; this.emotions.feel('focus_mode', now); return this.reply('away', { behavior: 'away' });
      case 'dance': this.emotions.feel('dance', now); return this.reply('dance', { behavior: 'dance' });
      case 'jump': this.emotions.feel('joke', now); return this.reply('jump', { behavior: 'jump' });
      case 'open_settings': return this.reply('settings_open', { behavior: 'open_settings' });
      case 'setup': this.emotions.feel('curious', now); return this.reply(s.part === 'brain' ? 'setup_hint_brain' : 'setup_hint_voice', { behavior: 'open_settings' });
      case 'sounds':
        this.memory.set({ sounds: s.on });
        this.emotions.feel(s.on ? 'joke' : 'focus_mode', now);
        return this.reply(s.on ? 'sounds_on' : 'sounds_off');
      case 'feeling': return this.feeling(s.kind, now);
      case 'costume':
        this.emotions.feel(s.name ? 'joke' : 'focus_mode', now);
        return this.reply(s.name ? `costume_${s.name}` : 'costume_off', { costume: s.name });
      case 'quiz': return this.startQuiz(now);
      case 'dont_know': case 'next_question':
        this.emotions.feel('curious', now);
        return this.reply('help');
      case 'humor': return this.changeHumor(s.delta, now);
      case 'set_name':
        this.memory.set({ name: s.name });
        this.emotions.feel('greet', now);
        return this.reply('set_name');
      case 'delete':
        this.emotions.feel('danger', now);
        return this.reply('feature_soon');
      case 'close': return this.planClose(s, now);
      case 'open_again': {
        const last = this.context.lastOpen;
        if (!last) { this.emotions.feel('curious', now); return this.reply('open_which'); }
        return this.planOpen(last.slots, now);
      }
      case 'repeat': {
        const last = this.context.lastCommand;
        if (!last || now - last.at > 10 * 60000) { this.emotions.feel('curious', now); return this.reply('repeat_nothing'); }
        const again = recognize(last.raw);
        last.at = now;
        return this.route(again, last.raw, now);
      }
      case 'teach': {
        const target = recognize(s.command);
        if (['unknown', 'open_unknown', 'teach', 'repeat'].includes(target.intent)) {
          this.emotions.feel('not_understood', now);
          return this.reply('teach_bad', { vars: { command: s.command } });
        }
        this.saveAlias(s.phrase, s.command);
        this.emotions.feel('celebrate', now);
        return this.reply('learn_saved', { vars: { phrase: s.phrase, command: s.command } });
      }
      case 'open_unknown': {
        const near = s.name ? nearestApp(s.name) : null;
        if (near) {
          // «افتح الحاسوب» → «تقصد الحاسبة؟»
          this.pending = { kind: 'suggest', raw, intent: { intent: 'open', slots: { app: near.id, kind: near.kind, url: near.url || null }, confidence: 0.8, text: raw } };
          this.emotions.feel('curious', now);
          return this.reply('suggest_app', { vars: { app: APP_NAMES[near.id] || near.id, target: s.name }, awaitingConfirm: true });
        }
        this.emotions.feel('not_understood', now);
        return this.reply('open_unknown', { vars: { target: s.name || 'هذا' } });
      }
      case 'open': return this.planOpen(s, now);
      case 'search': {
        if (!s.query) { this.emotions.feel('not_understood', now); return this.reply('search_empty'); }
        return this.plan({ type: 'search', params: { query: s.query, engine: s.engine } },
          { situation: 'search_ok', sayOn: 'start', vars: { query: s.query }, summary: `بحث: ${s.query}` }, now);
      }
      case 'volume':
        return this.plan({ type: 'volume', params: { direction: s.direction } },
          { situation: `volume_${s.direction}`, sayOn: 'start', summary: `الصوت: ${s.direction}` }, now);
      case 'screenshot':
        return this.plan({ type: 'screenshot', params: {} }, { situation: 'screenshot_ok', sayOn: 'result', summary: 'لقطة شاشة' }, now);
      case 'type_text': {
        if (!s.text) { this.emotions.feel('not_understood', now); return this.reply('type_empty'); }
        const preview = s.text.length > 40 ? `${s.text.slice(0, 40)}…` : s.text;
        return this.plan({ type: 'type_text', params: { text: s.text } },
          { situation: 'type_ok', sayOn: 'result', confirmWhat: `أكتب «${preview}» حيث المؤشر`, summary: `كتابة: ${preview}` }, now);
      }
      case 'pdf_write': case 'pdf_sign': {
        let text = s.text;
        if (r.intent === 'pdf_sign') {
          if (!this.memory.data.name) { this.emotions.feel('curious', now); return this.reply('pdf_need_name'); }
          text = `${this.memory.data.name} — ${this.formatDate(now)}`;
        }
        if (!text) { this.emotions.feel('not_understood', now); return this.reply('pdf_empty'); }
        const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
        return this.plan({ type: 'pdf_write', params: { text, position: s.position || 'top' } },
          { situation: 'pdf_ok', sayOn: 'result', confirmWhat: `أكتب «${preview}» في آخر ملف PDF (في نسخة جديدة، والأصل يبقى مثل ما هو)`, summary: `كتابة في PDF: ${preview}` }, now);
      }
      case 'reminder': {
        if (!s.minutes) { this.emotions.feel('not_understood', now); return this.reply('reminder_no_time'); }
        if (s.repeat && s.minutes < 5) { this.emotions.feel('not_understood', now); return this.reply('reminder_too_often'); }
        return this.plan({ type: 'reminder', params: { minutes: s.minutes, note: s.note || '', repeat: Boolean(s.repeat) } },
          { situation: s.repeat ? 'reminder_set_repeat' : 'reminder_set', sayOn: 'start', vars: { duration: durationPhrase(s.minutes), noteSuffix: noteSuffix(s.note) }, summary: `${s.repeat ? 'تذكير كل' : 'تذكير بعد'} ${durationPhrase(s.minutes)}` }, now);
      }
      case 'cancel_reminders':
        return this.plan({ type: 'cancel_reminders', params: {} }, { situation: 'reminders_cancelled', sayOn: 'result', summary: 'إلغاء التذكيرات' }, now);
      case 'clear_routines': {
        const had = (this.memory.data.routines || []).length;
        this.memory.set({ routines: [] });
        this.emotions.feel('focus_mode', now);
        return this.reply(had ? 'routines_cleared' : 'routines_none');
      }
      case 'organize_downloads':
        return this.plan({ type: 'organize_downloads', params: {} },
          { situation: 'organize_ok', sayOn: 'result', confirmWhat: 'أرتب ملفات التنزيلات في مجلدات حسب نوعها', summary: 'ترتيب التنزيلات' }, now);
      case 'undo_organize':
        return this.plan({ type: 'undo_organize', params: {} },
          { situation: 'undo_ok', sayOn: 'result', confirmWhat: 'أرجع ملفات التنزيلات مثل ما كانت', summary: 'تراجع عن الترتيب' }, now);
      default:
        this.emotions.feel('not_understood', now);
        return this.reply('not_understood', { unknownText: raw });
    }
  }

  planClose(s, now) {
    let app = s.app;
    if (!app) {
      const last = this.context.lastOpen;
      if (!last || now - last.at > 60 * 60000) { this.emotions.feel('curious', now); return this.reply('close_which'); }
      app = last.slots.app;
    }
    const appName = APP_NAMES[app] || app;
    const known = APPS.find((a) => a.id === app);
    if (known?.kind === 'url') { this.emotions.feel('confused', now); return this.reply('close_tab', { vars: { app: appName } }); }
    return this.plan({ type: 'close_app', params: { app } },
      { situation: 'close_ok', sayOn: 'start', vars: { app: appName }, confirmWhat: `أسكر ${appName}`, summary: `إغلاق ${appName}` }, now);
  }

  planOpen(s, now) {
    this.context.lastOpen = { slots: { app: s.app, kind: s.kind, url: s.url }, at: now };
    const appName = APP_NAMES[s.app] || s.app;
    let action;
    if (s.kind === 'url') action = { type: 'open_url', params: { url: s.url } };
    else if (s.kind === 'folder') action = { type: 'open_folder', params: { folder: s.app } };
    else action = { type: 'open_app', params: { app: s.app } };
    return this.plan(action, { situation: 'open_ok', sayOn: 'start', vars: { app: appName }, summary: `فتح ${appName}` }, now);
  }

  plan(action, spec, now) {
    const verdict = decide(action, this.memory.data);
    if (!verdict.allowed) {
      this.emotions.feel('error', now);
      return this.reply(verdict.reason === 'kids_mode' ? 'kids_blocked' : 'need_level');
    }
    if (verdict.confirm) {
      this.pending = { action, spec };
      this.emotions.feel('curious', now);
      return this.reply('confirm_ask', { vars: { what: spec.confirmWhat || spec.summary || 'هذا' }, awaitingConfirm: true });
    }
    return this.launch(action, spec, now, null);
  }

  launch(action, spec, now, preface) {
    const id = this.nextId;
    this.nextId += 1;
    const fullAction = { id, ...action };
    this.inflight.set(id, { ...spec, action: fullAction });
    this.emotions.feel('working', now);
    if (spec.sayOn === 'start') {
      const rep = this.reply(spec.situation, { vars: spec.vars, event: null });
      return { ...rep, action: fullAction };
    }
    const rep = preface ? this.reply(preface, { event: null }) : this.silent();
    return { ...rep, action: fullAction };
  }

  changeHumor(delta, now) {
    const cur = this.memory.data.humor;
    const next = Math.min(2, Math.max(0, cur + delta));
    if (next === cur) return this.reply(delta > 0 ? 'humor_max' : 'humor_min');
    this.memory.set({ humor: next });
    if (delta < 0 && this.lastHumorous && now - this.lastHumorous.at < FEEDBACK_WINDOW_MS) {
      this.memory.feedback(this.lastHumorous.cat, false);
    }
    this.emotions.feel(delta > 0 ? 'joke' : 'focus_mode', now);
    return this.reply(delta > 0 ? 'humor_up' : 'humor_down');
  }

  // -------------------------------------------------------------- habits

  /** Remembers when things are opened; after three different days around the same hour, offers to do it alone. */
  learnHabit(spec, now) {
    const a = spec.action;
    const key = `${a.type}:${a.params.app || a.params.url || a.params.folder}`;
    const habits = { ...(this.memory.data.habits || {}) };
    const times = [...(habits[key] || []), now].slice(-20);
    habits[key] = times;
    this.memory.set({ habits });
    if ((this.memory.data.routineAsked || {})[key]) return null;
    if ((this.memory.data.routines || []).some((x) => x.key === key)) return null;
    const hour = new Date(now).getHours();
    const days = new Set(times.filter((t) => Math.abs(new Date(t).getHours() - hour) <= 1).map((t) => new Date(t).toDateString()));
    if (days.size < 3) return null;
    const appName = spec.vars?.app || '';
    const timeText = new Intl.DateTimeFormat(this.locale, { hour: 'numeric' }).format(new Date(now));
    const { id, ...action } = a;
    this.pending = { kind: 'routine', key, hour, action, appName, timeText, summary: spec.summary };
    this.emotions.feel('curious', now);
    return this.reply('routine_offer', { vars: { app: appName, time: timeText }, awaitingConfirm: true });
  }

  /**
   * Routines due now (each at most once a day), as actions for the shell to run.
   * Still checked against the current permission level.
   */
  dueRoutines() {
    const now = this.clock();
    const d = new Date(now);
    const today = d.toDateString();
    const out = [];
    const routines = (this.memory.data.routines || []).map((r) => ({ ...r }));
    for (const r of routines) {
      if (r.lastRun === today || Math.abs(d.getHours() - r.hour) > 1) continue;
      if (!decide(r.action, this.memory.data).allowed) continue;
      r.lastRun = today;
      const id = this.nextId;
      this.nextId += 1;
      const action = { id, ...r.action };
      this.inflight.set(id, { situation: 'done', sayOn: 'none', summary: r.summary || 'عادة يومية', routine: true, action });
      out.push(action);
    }
    if (out.length) this.memory.set({ routines });
    return out;
  }

  // ---------------------------------------------------------------- chat

  /** Builds a reply from a sentence the local model wrote for him. */
  chatReply(userText, text) {
    const now = this.clock();
    this.chatHistory.push({ user: String(userText), khalfoun: String(text) });
    if (this.chatHistory.length > 6) this.chatHistory.shift();
    const happy = /(ههه|حلو|زين|ممتاز|مبروك|يا سلام|ابشر)/.test(text);
    const question = /[؟?]\s*$/.test(text);
    this.emotions.feel(happy ? 'joke' : question ? 'curious' : 'thanks', now);
    this.memory.set({ emotion: this.emotions.toJSON() });
    return {
      say: text, templateId: null, animation: happy ? 'happy' : question ? 'think' : 'nod', situation: 'chat',
      emotion: this.emotions.snapshot(now), behavior: null, awaitingConfirm: false, unknownText: null, action: null,
    };
  }

  // ------------------------------------------------------------ feelings

  feeling(kind, now) {
    this.memory.set({ lastFeeling: { kind, at: now } });
    const caring = ['tired', 'sad', 'sick', 'stressed', 'sleepy'];
    if (caring.includes(kind)) this.emotions.feel('care', now);
    else if (kind === 'success' || kind === 'happy') this.emotions.feel('celebrate', now);
    else this.emotions.feel('joke', now);
    const behavior = kind === 'success' ? 'dance' : null;
    return this.reply(`feel_${kind}`, { behavior });
  }

  // ---------------------------------------------------------------- quiz

  startQuiz(now) {
    this.quiz = new Quiz({ level: this.memory.data.quizLevel || 1, rng: this.rng });
    this.quizTries = 0;
    this.emotions.feel('joke', now);
    return this.reply('quiz_start', { vars: { q: this.quiz.next().text } });
  }

  endQuiz(now) {
    const q = this.quiz;
    this.quiz = null;
    this.memory.set({ quizLevel: q.level });
    if (!q.total) return this.reply('quiz_end_none');
    this.emotions.feel(q.right >= q.total / 2 ? 'celebrate' : 'care', now);
    return this.reply('quiz_end', { vars: { score: toArabicDigits(q.right), total: toArabicDigits(q.total) } });
  }

  /** Handles a turn while a quiz is running; returns null to let normal commands through. */
  quizTurn(r, raw, now) {
    if (r.intent === 'stop' || r.intent === 'goodbye') return this.endQuiz(now);
    if (r.intent === 'quiz') return this.reply('quiz_question', { vars: { q: this.quiz.current.text } });
    if (r.intent === 'dont_know') {
      const { answer } = this.quiz.skip();
      this.quizTries = 0;
      this.emotions.feel('care', now);
      return this.reply('quiz_skip', { vars: { answer: toArabicDigits(answer), q: this.quiz.next().text } });
    }
    if (r.intent === 'next_question') {
      this.quizTries = 0;
      return this.reply('quiz_question', { vars: { q: this.quiz.next().text } });
    }
    const value = parseArabicNumber(raw);
    const answerLike = ['unknown', 'yes', 'no', 'call', 'empty'].includes(r.intent);
    if (value === null || !answerLike) return null;
    const correctNow = value === this.quiz.current.answer;
    if (!correctNow && this.quizTries === 0) {
      // First miss: a hint and another try, without counting it yet.
      this.quizTries = 1;
      this.emotions.feel('quiz_wrong', now);
      return this.reply('quiz_try_again', { vars: { hint: value < this.quiz.current.answer ? 'أكبر شوي' : 'أصغر شوي' } });
    }
    const res = this.quiz.answer(value);
    this.quizTries = 0;
    this.memory.set({ quizLevel: this.quiz.level, quizRight: (this.memory.data.quizRight || 0) + (res.correct ? 1 : 0), quizTotal: (this.memory.data.quizTotal || 0) + 1 });
    const next = this.quiz.next().text;
    if (res.correct) {
      this.emotions.feel(res.levelChange > 0 ? 'streak' : 'quiz_right', now);
      return this.reply(res.levelChange > 0 ? 'quiz_level_up' : 'quiz_right', { vars: { q: next } });
    }
    this.emotions.feel('care', now);
    return this.reply(res.levelChange < 0 ? 'quiz_easier' : 'quiz_wrong', { vars: { answer: toArabicDigits(res.answer), q: next } });
  }

  // ----------------------------------------------------------------- helpers

  learnFromReaction(raw, now) {
    if (!this.lastHumorous || now - this.lastHumorous.at > FEEDBACK_WINDOW_MS) return;
    const n = normalize(raw);
    if (LAUGH_RE.test(raw) || LAUGH_RE.test(n)) {
      this.memory.feedback(this.lastHumorous.cat, true);
      this.lastHumorous = null;
    } else if (BOO_RE.test(n)) {
      this.memory.feedback(this.lastHumorous.cat, false);
      this.lastHumorous = null;
    }
  }

  markSuccess(now) {
    this.successes = this.successes.filter((t) => now - t < STREAK_WINDOW_MS);
    this.successes.push(now);
    if (this.successes.length >= 3) {
      this.emotions.feel('streak', now);
      this.successes = [];
    } else {
      this.emotions.feel('success', now);
    }
  }

  greetSituation(part) {
    if (part === 'morning') return 'greet_morning';
    if (part === 'evening') return 'greet_evening';
    const h = new Date(this.clock()).getHours();
    if (h >= 4 && h < 12) return 'greet_morning';
    if (h >= 16 && h < 23) return 'greet_evening';
    return 'greet';
  }

  formatTime(now) {
    return new Intl.DateTimeFormat(this.locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(now));
  }

  formatDate(now) {
    return new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(now));
  }

  formatDay(now) {
    return new Intl.DateTimeFormat(this.locale, { weekday: 'long' }).format(new Date(now));
  }

  silent() {
    return { say: null, templateId: null, animation: null, emotion: this.emotions.snapshot(this.clock()), behavior: null, awaitingConfirm: false, action: null };
  }

  /**
   * Builds a reply object for a situation.
   * @param {string} situation
   * @param {{vars?: object, behavior?: string, awaitingConfirm?: boolean, unknownText?: string, event?: null}} [opts]
   */
  reply(situation, opts = {}) {
    const now = this.clock();
    const snap = this.emotions.snapshot(now);
    const picked = this.responses.say(situation, {
      emotion: snap.emotion, humor: this.memory.data.humor, vars: opts.vars || {}, name: this.memory.data.name,
    });
    if (picked?.cat) this.lastHumorous = { cat: picked.cat, at: now };
    this.memory.set({ emotion: this.emotions.toJSON() });
    return {
      say: picked ? picked.text : null,
      templateId: picked ? picked.id : null,
      animation: picked ? picked.animation : null,
      situation,
      emotion: snap,
      behavior: opts.behavior || null,
      awaitingConfirm: !!opts.awaitingConfirm,
      unknownText: opts.unknownText || null,
      costume: 'costume' in opts ? opts.costume : undefined,
      action: null,
    };
  }
}

function noteSuffix(note) {
  return note ? `: ${note}` : '';
}
