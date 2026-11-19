// The brain ties everything together: hears a sentence, understands it, checks
// permission, plans an action for the shell to run, updates emotions and picks
// a reply. It never touches the OS itself, so it is fully testable.

import { recognize, splitCommands, nearestApp, phraseKey, APPS } from './intents.js';
import { EmotionEngine } from './emotions.js';
import { ResponseEngine } from './responses.js';
import { decide, LEVEL_INFO } from './permissions.js';
import { Memory } from './memory.js';
import { normalize, toArabicDigits, clockToTime } from './arabic.js';
import { TEMPLATES, APP_NAMES } from './templates/ar-om.js';
import { Quiz, parseArabicNumber } from './quiz.js';
import { occasionFor } from './occasions.js';
import { calculate } from './calc.js';
import { KEYS } from './keys.js';
import { isKnownProgramName } from './app-match.js';
import { Classroom } from './classroom.js';
import { classesOn, nextClass, dueClasses, classTime, DAY_NAMES } from './schedule.js';

const FEELING_LABEL = { tired: 'تعبان', sad: 'متضايق', sick: 'مريض', stressed: 'مضغوط' };
const HOUR = 60 * 60 * 1000;

const LAUGH_RE = /(ههه|خخخ|ضحكتني|حلوه|حلوة|يضحك|مضحك|😂|🤣)/u;
const BOO_RE = /(بايخه|بايخ|سخيفه|سخيف|مب حلوه|ما ضحكت|ماضحكت|ثقيله)/u;
const FEEDBACK_WINDOW_MS = 30000;
const STREAK_WINDOW_MS = 2 * 60 * 1000;

/** "بعد 5 دقايق" with correct Arabic number agreement. */
export function durationPhrase(minutes) {
  const m = Math.round(minutes);
  const hours = (h) => (h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h <= 10 ? `${toArabicDigits(h)} ساعات` : `${toArabicDigits(h)} ساعة`);
  if (m % 60 === 0 && m >= 60) return hours(m / 60);
  // «ساعة ونص», «ساعتين وربع», «ساعة و٢٠ دقيقة»: how people say it, not «٩٠ دقيقة».
  if (m > 60 && m < 24 * 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (rest === 30) return `${hours(h)} ونص`;
    if (rest === 15) return `${hours(h)} وربع`;
    return `${hours(h)} و${durationPhrase(rest)}`;
  }
  if (m === 1) return 'دقيقة';
  if (m === 2) return 'دقيقتين';
  if (m <= 10) return `${toArabicDigits(m)} دقايق`;
  return `${toArabicDigits(m)} دقيقة`;
}

/**
 * A counted noun with Arabic number agreement: countPhrase(1, COUNTED.file) → «ملف واحد»,
 * 2 → «ملفين», 5 → «٥ ملفات», 12 → «١٢ ملف».
 * @param {number} n
 * @param {[string, string, string, string]} forms one, two, 3-10, 11+
 */
export function countPhrase(n, [one, two, few, many]) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${toArabicDigits(n)} ${few}`;
  return `${toArabicDigits(n)} ${many}`;
}

export const COUNTED = {
  file: ['ملف واحد', 'ملفين', 'ملفات', 'ملف'],
  name: ['اسم واحد', 'اسمين', 'أسماء', 'اسم'],
  lesson: ['حصة وحدة', 'حصتين', 'حصص', 'حصة'],
  group: ['مجموعة وحدة', 'مجموعتين', 'مجموعات', 'مجموعة'],
  sentence: ['جملة وحدة', 'جملتين', 'جمل', 'جملة'],
  reminder: ['تذكير واحد', 'تذكيرين', 'تذكيرات', 'تذكير'],
  student: ['طالب واحد', 'طالبين', 'طلاب', 'طالب'],
};

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
    this.context = { lastOpen: null, lastCommand: null, lastUnknown: null, lastText: null, lastAnswer: null };
    this.queue = [];
    this.dictation = null; // {target: 'window'|'pdf', lines, page, position, lastAt}
    this.chatAvailable = false; // set by the shell when a local model is ready (summaries, questions...)
    this.visionAvailable = false; // a local model that understands images is ready
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
    if (!this.pending && !this.quiz && !this.dictation) {
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
    if (this.dictation && !this.pending) return this.dictate(raw, now);
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
      if (pending.kind === 'dictate') {
        this.pending = null;
        if (r.intent === 'yes') return pending.start();
        if (r.intent === 'no' || r.intent === 'stop') return this.reply('cancelled', { event: null });
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

  /**
   * One sentence while dictating: typed where the cursor is (or collected for
   * the PDF), with spoken punctuation, until «خلاص».
   */
  dictate(raw, now) {
    const d = this.dictation;
    d.lastAt = now;
    const n = phraseKey(raw);
    if (DICTATION_END.has(n)) return this.finishDictation(now);
    if (DICTATION_CANCEL.has(n)) {
      this.dictation = null;
      this.emotions.feel('focus_mode', now);
      return this.reply('dictation_cancelled', { behavior: 'dictation_off' });
    }
    if (DICTATION_UNDO.has(n)) {
      if (d.target === 'pdf') {
        const removed = d.lines.pop();
        return this.reply(removed ? 'dictation_removed' : 'dictation_nothing');
      }
      return this.launch({ type: 'press_key', params: { key: 'undo' } }, { situation: 'dictation_removed', sayOn: 'start', summary: 'إملاء: مسح آخر جملة', dictation: true }, now, null);
    }
    const text = spokenPunctuation(raw);
    if (!text.trim() && text !== '\n') return this.silent();
    if (d.target === 'pdf') {
      d.lines.push(text);
      const preview = text.length > 50 ? `${text.slice(0, 50)}…` : text;
      return { ...this.reply('dictation_line', { vars: { text: preview }, event: null }), animation: 'nod' };
    }
    d.typed += 1;
    // Each sentence is followed by a space, so the next one does not stick to it.
    const typed = /[\n]$/.test(text) ? text : `${text} `;
    const id = this.nextId;
    this.nextId += 1;
    const action = { id, type: 'type_text', params: { text: typed } };
    this.inflight.set(id, { situation: 'dictation_typed', sayOn: 'none', summary: `إملاء: ${text.slice(0, 30)}`, action, dictation: true });
    return { ...this.silent(), animation: 'nod', situation: 'dictation_typed', action };
  }

  finishDictation(now) {
    const d = this.dictation;
    this.dictation = null;
    if (d.target === 'pdf') {
      const text = d.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) { this.emotions.feel('confused', now); return this.reply('dictation_empty', { behavior: 'dictation_off' }); }
      const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
      const out = this.launch({ type: 'pdf_write', params: { text: text.slice(0, 3000), position: d.position, page: d.page } },
        { situation: 'pdf_ok', sayOn: 'result', summary: `إملاء في PDF: ${preview}` }, now, 'dictation_writing');
      return { ...out, behavior: 'dictation_off' };
    }
    this.emotions.feel('success', now);
    return this.reply(d.typed ? 'dictation_done' : 'dictation_empty', { vars: { count: countPhrase(d.typed, COUNTED.sentence) }, behavior: 'dictation_off' });
  }

  // ------------------------------------------------------------ classroom

  room() { return new Classroom(this.memory.data.classroom || {}); }

  saveRoom(room) { this.memory.set({ classroom: room.toJSON() }); }

  // ------------------------------------------------------------ eyes

  setChatAvailable(on) { this.chatAvailable = !!on; }

  setVisionAvailable(on) { this.visionAvailable = !!on; }

  /** What he read (selection or screen) arrives: remember it and do what was asked with it. */
  afterSee(see, result, now) {
    let text = String(result?.data?.text || '').trim();
    if (!text) {
      const last = this.context.lastText;
      if (see.op !== 'read' && last && now - last.at < 10 * 60000) text = last.text;
      else { this.emotions.feel('confused', now); return this.reply(see.source === 'screen' ? 'screen_nothing' : 'see_nothing'); }
    }
    this.context.lastText = { text, at: now, source: see.source };
    return this.actOnText(see.op, text, see.source, now);
  }

  actOnText(op, text, source, now) {
    const flat = text.replace(/\s+/g, ' ').trim();
    const words = flat ? flat.split(' ').length : 0;
    switch (op) {
      case 'read': {
        const preview = flat.length > 170 ? `${flat.slice(0, 170)}…` : flat;
        this.emotions.feel('curious', now);
        return this.reply(source === 'screen' ? 'screen_read' : 'see_read', { vars: { preview, words: toArabicDigits(words) } });
      }
      case 'count': {
        const lines = text.split('\n').filter((l) => l.trim()).length;
        this.emotions.feel('success', now);
        return this.reply('see_count', { vars: { words: toArabicDigits(words), chars: toArabicDigits(flat.length), lines: toArabicDigits(lines) } });
      }
      case 'search':
        return this.plan({ type: 'search', params: { query: flat.slice(0, 200), engine: 'google' } },
          { situation: 'search_ok', sayOn: 'start', vars: { query: flat.slice(0, 40) }, summary: `بحث: ${flat.slice(0, 30)}` }, now);
      case 'translate':
        return this.plan({ type: 'search', params: { query: flat.slice(0, 300), engine: 'translate' } },
          { situation: 'see_translate', sayOn: 'start', summary: 'ترجمة النص المحدد' }, now);
      case 'meaning':
        return this.plan({ type: 'search', params: { query: flat.split(' ')[0], engine: 'meaning' } },
          { situation: 'see_meaning', sayOn: 'start', vars: { word: flat.split(' ')[0] }, summary: `معنى: ${flat.split(' ')[0]}` }, now);
      case 'solve': {
        const math = calculate(flat.replace(/[=؟?]+\s*$/u, '').replace(/^(كم|احسب|حل)\s+/u, ''));
        if (math?.ok) {
          this.context.lastAnswer = { text: `${math.expr} = ${math.text}`, at: now };
          this.emotions.feel('success', now);
          return this.reply('calc_result', { vars: { expr: math.expr, result: math.text } });
        }
        if (this.chatAvailable) return this.askModel('solve', text, now);
        this.emotions.feel('confused', now);
        return this.reply('solve_need_brain');
      }
      case 'summarize': case 'explain': case 'questions':
        if (this.chatAvailable) return this.askModel(op, text, now);
        this.emotions.feel('confused', now);
        return this.reply('see_need_brain', { vars: { what: TASK_LABEL[op] } });
      default:
        return this.reply('see_read', { vars: { preview: flat.slice(0, 170), words: toArabicDigits(words) } });
    }
  }

  /** Asks the shell to have the local model work on the text; the answer comes back through taskReply. */
  askModel(mode, text, now) {
    this.emotions.feel('focus_mode', now);
    return { ...this.reply('see_thinking', { vars: { what: TASK_LABEL[mode] } }), ask: { mode, text: text.slice(0, 4000) } };
  }

  /** The local model's answer to a task (summary, explanation, questions, solution). */
  taskReply(mode, res) {
    const now = this.clock();
    if (!res?.ok || !res.text) {
      this.emotions.feel('error', now);
      return this.reply('task_failed');
    }
    this.context.lastAnswer = { text: res.text, at: now };
    this.emotions.feel('streak', now);
    const hint = mode === 'questions' ? 'قول «اكتبها» وأكتب الأسئلة في الملف.' : 'قول «اكتبها» وأكتبه لك في الملف.';
    return {
      ...this.reply('task_answer', { event: null }), say: `${res.text}\n\n(${hint})`, situation: 'task_answer', animation: 'proud', long: true,
    };
  }

  /** «شو أقدر أسوي هنا»: suggestions for the program the person is using. */
  contextHelp(win, now) {
    const proc = String(win.process || '').toLowerCase();
    const title = String(win.title || '');
    let situation = 'ctx_other';
    if (/winword/.test(proc)) situation = 'ctx_word';
    else if (/acro|foxit|sumatra|pdf/.test(proc) || /\.pdf\b/i.test(title)) situation = 'ctx_pdf';
    else if (/msedge|chrome|firefox|brave|opera/.test(proc)) situation = 'ctx_browser';
    else if (/powerpnt/.test(proc)) situation = 'ctx_powerpoint';
    else if (/excel/.test(proc)) situation = 'ctx_excel';
    else if (/notepad/.test(proc)) situation = 'ctx_notepad';
    this.emotions.feel('curious', now);
    return this.reply(situation, { vars: { app: title.slice(0, 40) || proc || 'هذا البرنامج' } });
  }

  /** Keeps the context used by follow-ups and by learning the person's words. */
  remember(r, raw, out, now) {
    const REPEATABLE = ['move', 'key', 'volume', 'joke', 'calc', 'dance', 'jump', 'open', 'search', 'time', 'quiz', 'screenshot'];
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
      case 'stt_failed': this.emotions.feel('confused', now); return this.reply('stt_failed');
      case 'cloud_problem': this.emotions.feel('confused', now); return this.reply(data.error === 'no_credit' ? 'cloud_no_credit' : 'cloud_bad_key');
      // ---- his own tools: the whiteboard and the notebook tell him what happens there
      case 'tool_closed':
        if (this.focus || this.emotions.asleep) return null;
        return this.rng() < 0.6 ? this.reply(data.tool === 'board' ? 'tool_closed_board' : 'tool_closed_notebook') : null;
      case 'tool_busy': this.emotions.feel('curious', now); return this.reply('nb_thinking');
      case 'tool_done':
        if (!data.ok) { this.emotions.feel('error', now); return this.reply('nb_failed'); }
        this.emotions.feel('success', now);
        return this.reply(data.mode === 'cards' ? 'nb_done_cards' : 'nb_done', { behavior: 'jump' });
      case 'tool_event': {
        if (this.focus || this.emotions.asleep) return null;
        if (data.what === 'card_right') { this.emotions.feel('praise', now); return this.rng() < 0.35 ? this.reply('nb_card_right') : null; }
        if (data.what === 'card_wrong') { this.emotions.feel('care', now); return this.rng() < 0.35 ? this.reply('nb_card_wrong') : null; }
        if (data.what === 'review_done') {
          this.emotions.feel('celebrate', now);
          return this.reply(data.count > 0 ? 'nb_review_done' : 'nb_review_zero', { vars: { count: toArabicDigits(data.count || 0) }, behavior: data.count > 0 ? 'dance' : null });
        }
        if (data.what === 'note_new') return this.rng() < 0.5 ? this.reply('nb_note_new') : null;
        return null;
      }
      case 'mic_error': this.emotions.feel('error', now); return this.reply('mic_error');
      case 'reminder_fire': {
        this.emotions.feel('greet', now);
        return this.reply('reminder_fire', { vars: { noteSuffix: noteSuffix(data.note) } });
      }
      // ---- living Khalfoun: what happens on the desktop
      case 'window_opened': {
        if (this.focus || this.emotions.asleep || this.dictation) return null;
        const situation = `win_${data.kind}`;
        if (data.kind === 'other' && this.rng() > 0.25) return null;
        this.emotions.feel('curious', now);
        return this.reply(TEMPLATES.some((t) => t.s === situation) ? situation : 'win_other', { vars: { title: data.title || '' }, behavior: 'look_window' });
      }
      case 'window_closed':
        if (this.focus || this.emotions.asleep || this.dictation || this.rng() > 0.35) return null;
        return this.reply('win_closed', { vars: { title: data.title || '' } });
      case 'download_new': {
        if (this.emotions.asleep || this.dictation) return null;
        this.emotions.feel('curious', now);
        const file = String(data.name || '');
        this.pending = { kind: 'suggest', raw: file, intent: { intent: 'open_download', slots: { name: file }, confidence: 0.9, text: file } };
        return this.reply(data.kind === 'pdf' ? 'dl_pdf' : 'dl_file', { vars: { file: file.length > 40 ? `${file.slice(0, 37)}…` : file }, awaitingConfirm: true });
      }
      case 'resume':
        this.emotions.feel('greet', now);
        return this.reply('welcome_back');
      case 'game_catch':
        this.emotions.feel('tickle', now);
        return this.reply('game_caught', { event: null });
      case 'game_over':
        this.emotions.feel('celebrate', now);
        if (data.game === 'chase') return this.reply('game_chase_over', { vars: { score: toArabicDigits(data.score || 0) } });
        return this.reply(data.found ? 'game_found' : 'game_not_found', { vars: { seconds: toArabicDigits(Math.max(1, Math.round(data.seconds || 0))) } });
      case 'dizzy':
        this.emotions.feel('dropped', now);
        return this.reply('dizzy');
      case 'timer_done':
        this.emotions.feel('celebrate', now);
        return this.reply('timer_done');
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
      if (spec.dictation && this.dictation) { this.dictation = null; return this.reply('dictation_failed', { behavior: 'dictation_off' }); }
      if (spec.see) {
        if (result?.error === 'unsupported') return this.reply(spec.see.source === 'screen' ? 'screen_unsupported' : 'failed');
        if (result?.error === 'no_ocr_language') return this.reply('screen_no_language');
        return this.reply(spec.see.source === 'screen' ? 'screen_failed' : 'see_failed');
      }
      if (spec.contextHelp) return this.reply('help');
      if (result?.error === 'not_running') return this.reply('close_not_running', { vars: spec.vars || {} });
      if (result?.error === 'not_installed') {
        const target = spec.vars?.target || '';
        if (spec.playFallback && target) {
          // «شغل سورة الرحمن»: not a program, so offer to play it on YouTube.
          this.pending = { kind: 'suggest', raw: target, intent: { intent: 'search', slots: { query: target, engine: 'youtube' }, confidence: 0.8, text: target } };
          this.emotions.feel('curious', now);
          return this.reply('suggest_youtube', { vars: { target }, awaitingConfirm: true });
        }
        this.emotions.feel('not_understood', now);
        return this.reply('open_unknown', { vars: { target: target || 'هذا' } });
      }
      if (result?.error === 'cannot_close') return this.reply('close_tab', { vars: spec.vars || {} });
      if (result?.error === 'level_too_low') return this.reply('need_level');
      if (result?.error === 'kids_mode') return this.reply('kids_blocked');
      if (result?.error === 'no_pdf') return this.reply('pdf_none');
      return this.reply('failed');
    }
    if (spec.dictation) return spec.sayOn === 'result' ? this.reply(spec.situation) : null;
    if (spec.see) return this.afterSee(spec.see, result, now);
    if (spec.contextHelp) return this.contextHelp(result.data || {}, now);
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
      if (spec.action.type === 'open_installed' && result.data?.name) vars.app = result.data.name;
      let situation = spec.situation;
      if (spec.action.type === 'organize_downloads') {
        const count = result.data?.moved ?? 0;
        if (!count) situation = 'organize_empty';
        vars.count = countPhrase(count, COUNTED.file);
      }
      if (spec.action.type === 'cancel_reminders') {
        const count = result.data?.cancelled ?? 0;
        if (!count) situation = 'reminders_none';
        vars.count = countPhrase(count, COUNTED.reminder);
      }
      if (spec.action.type === 'undo_organize') {
        const count = result.data?.restored ?? 0;
        if (!count) situation = 'undo_none';
        vars.count = countPhrase(count, COUNTED.file);
      }
      return this.reply(situation, { vars });
    }
    return null;
  }

  /** Called every few seconds by the shell; may return an idle remark. */
  tick() {
    const now = this.clock();
    const due = dueClasses(this.memory.data.schedule, now, 5);
    if (due.length) {
      const c = due[0];
      const today = new Date(now).toDateString();
      this.memory.set({ schedule: (this.memory.data.schedule || []).map((x) => (x.id === c.id ? { ...x, notified: today } : x)) });
      const minutes = Math.max(0, c.hour * 60 + c.minute - (new Date(now).getHours() * 60 + new Date(now).getMinutes()));
      this.emotions.feel('greet', now);
      const rep = this.reply(minutes ? 'class_soon' : 'class_now', { vars: { subject: c.subject, duration: durationPhrase(Math.max(1, minutes)) }, behavior: 'come' });
      // Run the class's command (e.g. open the slides) right after, through the usual permission check.
      if (c.command && !this.pending) { this.queue = [c.command]; return { ...rep, more: true }; }
      return rep;
    }
    if (this.dictation && now - this.dictation.lastAt > 10 * 60000) {
      if (this.dictation.target === 'window') { this.dictation = null; return this.reply('dictation_timeout', { behavior: 'dictation_off' }); }
    }
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
    // He learns to be quiet: each remark the person ignored doubles the wait for the next
    // (up to eight times); anything the person says or does resets it.
    if (snap.idleMs < now - this.lastIdleTalk) this.idleBackoff = 1;
    const gap = (humor === 2 ? 3 * 60e3 : 6 * 60e3) * (this.idleBackoff || 1);
    if (humor > 0 && snap.idleMs > 60e3 && now - this.lastIdleTalk > gap) {
      if (this.spokeIdle && snap.idleMs > now - this.lastIdleTalk) this.idleBackoff = Math.min(8, (this.idleBackoff || 1) * 2);
      this.lastIdleTalk = now;
      this.spokeIdle = true;
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
      case 'open_tool': {
        const name = s.tool === 'board' ? 'السبورة' : 'الدفتر';
        return this.plan({ type: 'open_tool', params: { tool: s.tool } },
          { situation: `tool_open_${s.tool}`, sayOn: 'start', summary: `فتح ${name}` }, now);
      }
      case 'close_tool': {
        const name = s.tool === 'board' ? 'السبورة' : 'الدفتر';
        return this.plan({ type: 'close_tool', params: { tool: s.tool } },
          { situation: 'tool_close', sayOn: 'start', vars: { app: name }, summary: `إغلاق ${name}` }, now);
      }
      case 'hear_check': this.emotions.feel('greet', now); return this.reply('hear_check');
      case 'fine': this.emotions.feel('greet', now); return this.reply('fine');
      case 'praise': this.emotions.feel('praise', now); return this.reply('praise');
      case 'scold': this.emotions.feel('scold', now); return this.reply('scold');
      case 'goodbye': this.emotions.sleep(now); return this.reply('goodbye', { behavior: 'sleep' });
      case 'joke': this.emotions.feel('joke', now); return this.reply('joke');
      case 'help': this.emotions.feel('curious', now); return this.reply('help');
      case 'time': this.emotions.feel('success', now); return this.reply('time', { vars: { time: this.formatTime(now) } });
      case 'date': this.emotions.feel('success', now); return this.reply('date', { vars: { date: this.formatDate(now), day: this.formatDay(now) } });
      case 'sleep': this.emotions.sleep(now); return this.reply('sleep', { behavior: 'sleep', event: null });
      case 'wake': this.emotions.feel('wake', now); return this.reply('wake', { behavior: 'wake' });
      case 'move':
        if (s.dir === 'stay') this.focus = true;
        if (s.dir === 'free') this.focus = false;
        this.emotions.feel(s.dir === 'stay' ? 'focus_mode' : 'curious', now);
        return this.reply(`move_${s.dir}`, { behavior: `move:${s.dir}` });
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
      case 'dictate': {
        // Typing is an edit: check the permission once for the whole session.
        const probe = s.target === 'pdf' ? { type: 'pdf_write', params: { text: 'x', position: 'top' } } : { type: 'type_text', params: { text: 'x' } };
        const verdict = decide(probe, this.memory.data);
        if (!verdict.allowed) { this.emotions.feel('error', now); return this.reply(verdict.reason === 'kids_mode' ? 'kids_blocked' : 'need_level'); }
        const start = () => {
          this.dictation = { target: s.target, lines: [], page: s.page || 1, position: s.position || 'top', lastAt: now, typed: 0 };
          this.emotions.feel('listening', now);
          return this.reply(s.target === 'pdf' ? 'dictation_start_pdf' : 'dictation_start', { behavior: 'dictation_on' });
        };
        if (verdict.confirm) {
          this.pending = { kind: 'dictate', start };
          this.emotions.feel('curious', now);
          return this.reply('confirm_ask', { vars: { what: s.target === 'pdf' ? 'أكتب كل اللي تمليه علي في آخر ملف PDF' : 'أكتب كل اللي تقوله حيث المؤشر لين تقول «خلاص»' }, awaitingConfirm: true });
        }
        return start();
      }
      // ---- classroom tools
      case 'students_set': {
        const room = this.room();
        const count = room.setStudents(s.names || []);
        this.saveRoom(room);
        if (!count) { this.emotions.feel('not_understood', now); return this.reply('students_none'); }
        this.emotions.feel('celebrate', now);
        return this.reply('students_saved', { vars: { count: countPhrase(count, COUNTED.name), names: s.names.slice(0, 6).join('، ') } });
      }
      case 'student_add': {
        const room = this.room();
        const added = room.add(String(s.name).trim());
        this.saveRoom(room);
        return this.reply(added ? 'student_added' : 'student_exists', { vars: { student: s.name, count: toArabicDigits(room.students.length) } });
      }
      case 'student_remove': {
        const room = this.room();
        const gone = room.remove(s.name);
        this.saveRoom(room);
        return this.reply(gone ? 'student_removed' : 'student_unknown', { vars: { student: gone || s.name } });
      }
      // ---- the teacher's timetable
      case 'schedule_add': {
        const schedule = [...(this.memory.data.schedule || [])];
        const entry = { id: `c${Date.now().toString(36)}${schedule.length}`, days: s.days, hour: s.hour, minute: s.minute, subject: s.subject, command: s.command || null };
        schedule.push(entry);
        this.memory.set({ schedule: schedule.slice(-60) });
        this.emotions.feel('celebrate', now);
        return this.reply(entry.command ? 'schedule_added_cmd' : 'schedule_added', { vars: { subject: entry.subject, days: s.days.map((d) => DAY_NAMES[d]).join(' و'), time: classTime(entry), command: entry.command || '' } });
      }
      case 'schedule_today': {
        const today = classesOn(this.memory.data.schedule, new Date(now));
        if (!today.length) return this.reply('schedule_today_none');
        const list = today.map((c) => `${classTime(c)}: ${c.subject}`).join('\n');
        const head = this.reply('schedule_today', { vars: { count: countPhrase(today.length, COUNTED.lesson) } });
        return { ...head, say: `${head.say}\n${list}`, long: true };
      }
      case 'schedule_next': {
        const next = nextClass(this.memory.data.schedule, now);
        if (!next) return this.reply('schedule_empty');
        const when = next.dayOffset === 0 ? (next.minutes < 60 ? `بعد ${durationPhrase(next.minutes)}` : `اليوم ${classTime(next.entry)}`)
          : next.dayOffset === 1 ? `بكرة ${classTime(next.entry)}` : `يوم ${DAY_NAMES[new Date(next.start).getDay()]} ${classTime(next.entry)}`;
        return this.reply('schedule_next', { vars: { subject: next.entry.subject, when } });
      }
      case 'schedule_show': {
        const schedule = this.memory.data.schedule || [];
        if (!schedule.length) return this.reply('schedule_empty');
        const lines = [];
        for (let d = 0; d < 7; d += 1) {
          const day = schedule.filter((c) => c.days.includes(d)).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
          if (day.length) lines.push(`${DAY_NAMES[d]}: ${day.map((c) => `${c.subject} (${classTime(c)})`).join('، ')}`);
        }
        this.context.lastAnswer = { text: lines.join('\n'), at: now };
        return { ...this.reply('schedule_show'), say: `${this.reply('schedule_show').say}\n${lines.join('\n')}`, long: true };
      }
      case 'schedule_clear':
        this.memory.set({ schedule: [] });
        return this.reply('schedule_cleared');
      case 'schedule_remove': {
        const schedule = this.memory.data.schedule || [];
        const key = normalize(s.subject);
        const keep = schedule.filter((c) => !normalize(c.subject).includes(key) && !key.includes(normalize(c.subject)));
        if (keep.length === schedule.length) return this.reply('schedule_not_found', { vars: { subject: s.subject } });
        this.memory.set({ schedule: keep });
        return this.reply('schedule_removed', { vars: { subject: s.subject } });
      }
      case 'speak':
        this.memory.set({ speak: !!s.on });
        this.emotions.feel(s.on ? 'joke' : 'focus_mode', now);
        return this.reply(s.on ? 'speak_on' : 'speak_off', { behavior: s.on ? 'speak:on' : 'speak:off' });
      case 'game':
        this.focus = false;
        this.emotions.feel('joke', now);
        return this.reply(s.name === 'hide' ? 'game_hide_start' : 'game_chase_start', { behavior: `game:${s.name}` });
      case 'open_download':
        return this.plan({ type: 'open_download', params: { name: s.name } }, { situation: 'open_ok', sayOn: 'start', vars: { app: s.name }, summary: `فتح ${s.name}` }, now);
      case 'students_count': {
        const n = this.room().students.length;
        if (!n) { this.emotions.feel('curious', now); return this.reply('pick_need_names'); }
        return this.reply('students_count', { vars: { count: countPhrase(n, COUNTED.student) } });
      }
      case 'random_number': {
        const span = Math.min(10000, s.max - s.min);
        const n = s.min + Math.floor(this.rng() * (span + 1));
        this.context.lastAnswer = { text: String(n), at: now };
        this.emotions.feel('celebrate', now);
        return this.reply(s.dice ? 'dice_result' : 'random_result', { vars: { number: toArabicDigits(n), from: toArabicDigits(s.min), to: toArabicDigits(s.min + span) }, behavior: 'drumroll' });
      }
      case 'pick_student': {
        const room = this.room();
        const pick = room.pick(this.rng);
        this.saveRoom(room);
        if (!pick) { this.emotions.feel('curious', now); return this.reply('pick_need_names'); }
        this.emotions.feel('celebrate', now);
        return this.reply(pick.newRound ? 'pick_new_round' : 'pick_result', { vars: { student: pick.name, left: toArabicDigits(pick.left) }, behavior: 'drumroll' });
      }
      case 'groups': {
        const room = this.room();
        const groups = room.groups({ count: s.count, size: s.size }, this.rng);
        if (!groups.length) { this.emotions.feel('curious', now); return this.reply('pick_need_names'); }
        const list = groups.map((g, i) => `المجموعة ${toArabicDigits(i + 1)}: ${g.join('، ')}`).join('\n');
        this.context.lastAnswer = { text: list, at: now };
        this.emotions.feel('celebrate', now);
        const head = this.reply('groups_result', { vars: { count: countPhrase(groups.length, COUNTED.group) } });
        return { ...head, say: `${head.say}\n${list}`, long: true };
      }
      case 'award': {
        const room = this.room();
        const res = room.award(s.name, s.delta);
        this.saveRoom(room);
        if (!res) return this.reply('not_understood');
        this.emotions.feel(s.delta > 0 ? 'celebrate' : 'care', now);
        const n = Math.abs(s.delta);
        const stars = n === 1 ? 'نجمة' : n === 2 ? 'نجمتين' : n <= 10 ? `${toArabicDigits(n)} نجوم` : `${toArabicDigits(n)} نجمة`;
        return this.reply(s.delta > 0 ? 'award_ok' : 'award_minus', { vars: { student: res.name, points: toArabicDigits(res.points), stars }, behavior: s.delta > 0 ? 'star' : null });
      }
      case 'points_board': {
        const board = this.room().board(10);
        if (!board.length) return this.reply('board_empty');
        const medals = ['🥇', '🥈', '🥉'];
        const list = board.map((b, i) => `${medals[i] || `${toArabicDigits(i + 1)}.`} ${b.name}: ${toArabicDigits(b.points)}`).join('\n');
        this.context.lastAnswer = { text: list.replace(/[🥇🥈🥉]/gu, '').trim(), at: now };
        this.emotions.feel('celebrate', now);
        const head = this.reply('board_result', { vars: { first: board[0].name } });
        return { ...head, say: `${head.say}\n${list}`, long: true };
      }
      case 'points_reset': {
        const room = this.room();
        room.resetPoints();
        this.saveRoom(room);
        return this.reply('points_cleared');
      }
      case 'timer': {
        if (!s.minutes || s.minutes > 180) { this.emotions.feel('not_understood', now); return this.reply('timer_no_time'); }
        this.emotions.feel('focus_mode', now);
        return this.reply('timer_started', { vars: { duration: durationPhrase(s.minutes) }, behavior: `timer:${Math.round(s.minutes * 60)}` });
      }
      case 'timer_stop': return this.reply('timer_stopped', { behavior: 'timer:stop' });
      case 'see': {
        // AI eyes: a vision model looks at the screen itself (pictures, drawings, worksheets).
        const LOOKS = { read: 'describe', describe: 'describe', explain: 'explain', solve: 'solve', questions: 'questions', summarize: 'summarize' };
        if (s.source === 'screen' && this.visionAvailable && LOOKS[s.op]) {
          const mode = LOOKS[s.op];
          this.emotions.feel('focus_mode', now);
          return { ...this.reply('look_thinking', { vars: { what: LOOK_LABEL[mode] } }), look: { mode } };
        }
        if (s.op === 'describe') s.op = 'read';
        const read = s.source === 'screen' ? { type: 'read_screen', params: {} } : { type: 'read_selection', params: {} };
        return this.plan(read, { situation: s.source === 'screen' ? 'screen_looking' : 'see_looking', sayOn: 'start', see: s,
          summary: s.source === 'screen' ? 'قراءة الشاشة' : 'قراءة النص المحدد' }, now);
      }
      case 'type_last': {
        const last = this.context.lastAnswer;
        if (!last || now - last.at > 30 * 60000) { this.emotions.feel('confused', now); return this.reply('type_last_none'); }
        return this.plan({ type: 'type_text', params: { text: last.text.slice(0, 2000) } },
          { situation: 'type_ok', sayOn: 'result', confirmWhat: 'أكتب الجواب الأخير حيث المؤشر', summary: 'كتابة الجواب' }, now);
      }
      case 'context_help':
        return this.plan({ type: 'active_window', params: {} }, { situation: 'help', sayOn: 'result', contextHelp: true, summary: 'معرفة البرنامج المفتوح' }, now);
      case 'key': {
        const name = KEYS[s.key]?.ar || s.key;
        return this.plan({ type: 'press_key', params: { key: s.key } },
          { situation: 'key_ok', sayOn: 'start', vars: { key: name }, confirmWhat: `أضغط «${name}»`, summary: `زر: ${name}` }, now);
      }
      case 'calc': {
        const res = calculate(s.expr);
        if (!res?.ok) {
          this.emotions.feel('confused', now);
          return this.reply(res?.error === 'div_zero' ? 'calc_div_zero' : 'calc_fail');
        }
        this.emotions.feel('success', now);
        return this.reply('calc_result', { vars: { expr: res.expr, result: res.text } });
      }
      case 'delete':
        this.emotions.feel('danger', now);
        return this.reply('feature_soon');
      case 'close': return this.planClose(s, now);
      case 'open_which': {
        // «افتح» alone: guess from what the person usually opens.
        const guess = this.usualApp();
        if (guess) {
          this.pending = { kind: 'suggest', raw, intent: { intent: 'open', slots: guess.slots, confidence: 0.7, text: raw } };
          this.emotions.feel('curious', now);
          return this.reply('open_usual', { vars: { app: guess.name }, awaitingConfirm: true });
        }
        this.emotions.feel('curious', now);
        return this.reply('open_which');
      }
      case 'forget_phrase': {
        const aliases = { ...(this.memory.data.aliases || {}) };
        const key = phraseKey(s.phrase);
        if (!(key in aliases)) { this.emotions.feel('confused', now); return this.reply('forget_none', { vars: { phrase: s.phrase } }); }
        delete aliases[key];
        this.memory.set({ aliases });
        this.emotions.feel('focus_mode', now);
        return this.reply('forget_done', { vars: { phrase: s.phrase } });
      }
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
        // «افتح الايميل» is the Mail program, not «تقصد إكسل؟».
        const near = s.name && !isKnownProgramName(s.name) ? nearestApp(s.name) : null;
        if (near) {
          // «افتح الحاسوب» → «تقصد الحاسبة؟»
          this.pending = { kind: 'suggest', raw, intent: { intent: 'open', slots: { app: near.id, kind: near.kind, url: near.url || null }, confidence: 0.8, text: raw } };
          this.emotions.feel('curious', now);
          return this.reply('suggest_app', { vars: { app: APP_NAMES[near.id] || near.id, target: s.name }, awaitingConfirm: true });
        }
        if (!s.name) { this.emotions.feel('not_understood', now); return this.reply('open_unknown', { vars: { target: 'هذا' } }); }
        // Maybe it is a program on this computer («افتح سبوتيفاي»): main looks in the Start menu.
        return this.plan({ type: 'open_installed', params: { name: s.name } },
          { situation: 'open_ok', sayOn: 'result', vars: { app: s.name, target: s.name }, playFallback: !!s.play, summary: `فتح ${s.name}` }, now);
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
        // «اكتب التاريخ» / «اكتب الوقت» / «اكتب اسمي»: the value, not the word.
        const filled = this.typedValue(s.text, now);
        if (filled) s.text = filled;
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
        return this.plan({ type: 'pdf_write', params: { text, position: s.position || 'top', page: s.page || 1 } },
          { situation: 'pdf_ok', sayOn: 'result', confirmWhat: `أكتب «${preview}» في آخر ملف PDF (في نسخة جديدة، والأصل يبقى مثل ما هو)`, summary: `كتابة في PDF: ${preview}` }, now);
      }
      case 'reminder': {
        if (s.clock && !s.minutes) {
          // «ذكرني الساعة خمس العصر»: work out how long until then.
          const at = clockToTime(s.clock, now);
          const minutes = Math.max(1, Math.round((at - now) / 60000));
          if (minutes > 7 * 24 * 60) { this.emotions.feel('not_understood', now); return this.reply('reminder_no_time'); }
          const time = this.formatClock(at, now);
          return this.plan({ type: 'reminder', params: { minutes, note: s.note || '', repeat: false } },
            { situation: 'reminder_set_at', sayOn: 'start', vars: { time, noteSuffix: noteSuffix(s.note) }, summary: `تذكير ${time}` }, now);
        }
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

  /** The app the person opens most (from the habit log), as open slots + name. */
  usualApp() {
    const habits = this.memory.data.habits || {};
    let best = null;
    for (const [key, times] of Object.entries(habits)) {
      if (!Array.isArray(times) || times.length < 2) continue;
      if (!best || times.length > best.n) best = { key, n: times.length };
    }
    if (!best) return null;
    const [type, id] = best.key.split(':');
    const app = APPS.find((a) => a.id === id || a.url === id);
    if (!app) return null;
    const kind = type === 'open_url' ? 'url' : type === 'open_folder' ? 'folder' : 'app';
    return { slots: { app: app.id, kind, url: app.url || null }, name: APP_NAMES[app.id] || app.id };
  }

  /** Taught phrases for the settings panel: [{key, command}]. */
  taughtPhrases() {
    return Object.entries(this.memory.data.aliases || {}).map(([key, command]) => ({ key, command }));
  }

  forgetPhrase(key) {
    const aliases = { ...(this.memory.data.aliases || {}) };
    delete aliases[key];
    this.memory.set({ aliases });
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
  /**
   * The local model understood a sentence the rules did not, as a command.
   * He checks it with his own rules and, if it is a real command, asks first:
   * «فهمت إنك تبغى: افتح الحاسبة. أسويها؟».
   */
  modelCommand(userText, command) {
    const now = this.clock();
    const r = recognize(command);
    const COMMANDS = ['open', 'close', 'search', 'type_text', 'volume', 'reminder', 'screenshot', 'time', 'date', 'organize_downloads', 'quiz', 'joke', 'open_unknown', 'calc'];
    if (!COMMANDS.includes(r.intent)) return null;
    if (['time', 'date', 'joke', 'quiz', 'calc'].includes(r.intent)) return this.route(r, command, now); // harmless: just do it
    this.pending = { kind: 'suggest', raw: command, intent: r };
    this.emotions.feel('curious', now);
    return this.reply('model_command', { vars: { command }, awaitingConfirm: true });
  }

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
    if (part === 'salam') return 'greet_salam';
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

  /** «الساعة ٥:٠٠ م» today, «بكرة الساعة ٧:٠٠ ص», or the weekday further on. */
  formatClock(at, now) {
    const t = new Intl.DateTimeFormat(this.locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(at));
    const day = (x) => { const d = new Date(x); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const days = Math.round((day(at) - day(now)) / 86400000);
    if (days === 0) return `الساعة ${t}`;
    if (days === 1) return `بكرة الساعة ${t}`;
    if (days === 2) return `بعد بكرة الساعة ${t}`;
    return `يوم ${this.formatDay(at)} الساعة ${t}`;
  }

  /** What «اكتب التاريخ», «اكتب الساعة» or «اكتب اسمي» should type, or null for ordinary text. */
  typedValue(text, now) {
    const t = normalize(text);
    if (['التاريخ', 'تاريخ اليوم', 'التاريخ اليوم', 'تاريخ اليوم الحين'].includes(t)) return this.formatDate(now);
    if (['اليوم والتاريخ', 'اليوم و التاريخ', 'اليوم مع التاريخ'].includes(t)) return `${this.formatDay(now)} ${this.formatDate(now)}`;
    if (['الوقت', 'الساعه', 'الوقت الحين', 'الساعه الحين'].includes(t)) return this.formatTime(now);
    if (['اسمي', 'اسمي الكامل'].includes(t) && this.memory.data.name) return this.memory.data.name;
    return null;
  }

  formatDate(now) {
    return new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(now));
  }

  /**
   * What the local model should know right now so its answer fits this person and this
   * moment: the date and time, today's classes, how they said they feel, what they like.
   * Short plain lines; nothing leaves the computer.
   */
  chatContext(now = this.clock()) {
    const d = this.memory.data;
    const lines = [`اليوم ${this.formatDay(now)} ${this.formatDate(now)}، والساعة ${this.formatTime(now)}.`];
    const today = classesOn(d.schedule, new Date(now));
    if (today.length) lines.push(`حصص الشخص اليوم: ${today.map((c) => `${c.subject} ${classTime(c)}`).join('، ')}.`);
    const next = nextClass(d.schedule, now);
    if (next && next.minutes <= 180) lines.push(`حصته الجاية: ${next.entry.subject} بعد ${durationPhrase(Math.max(1, next.minutes))}.`);
    const f = d.lastFeeling;
    if (f && FEELING_LABEL[f.kind] && now - f.at < 12 * HOUR) lines.push(`قال قبل شوي إنه ${FEELING_LABEL[f.kind]}؛ كن لطيفاً معه.`);
    const students = (d.classroom?.students || []).length;
    if (students) lines.push(`عنده قائمة فيها ${students} طالب.`);
    const em = this.emotions.current?.emotion;
    const EM_AR = { happy: 'فرحان', proud: 'فخور', excited: 'متحمس', amazed: 'مندهش', curious: 'فضولي', focused: 'مركز', confused: 'محتار', shy: 'مستحي',
      grateful: 'ممتن', longing: 'مشتاق', sad: 'زعلان', sulky: 'زعلان شوي', jealous: 'غيران', scared: 'خايف', bored: 'طفشان', sleepy: 'نعسان' };
    if (EM_AR[em]) lines.push(`مزاجك أنت الحين: ${EM_AR[em]}.`);
    return lines.join('\n').slice(0, 600);
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

const LOOK_LABEL = { describe: 'الشاشة', explain: 'شرح اللي في الشاشة', solve: 'حل التمرين', questions: 'الأسئلة', summarize: 'التلخيص' };
const TASK_LABEL = { summarize: 'التلخيص', explain: 'الشرح', questions: 'الأسئلة', solve: 'حل المسألة' };
const DICTATION_END = new Set(['خلاص', 'خلصت', 'انتهيت', 'تم', 'بس خلاص', 'خلاص بس', 'وقف الاملاء', 'خلاص الاملاء', 'انهي الاملاء', 'وقف', 'بس', 'خلصنا', 'كفايه'].map(normalize));
const DICTATION_CANCEL = new Set(['الغ الاملاء', 'الغي الاملاء', 'كنسل الاملاء', 'لا تكتب شي', 'انس اللي قلته'].map(normalize));
const DICTATION_UNDO = new Set(['امسح اخر جمله', 'امسح الجمله', 'امسح اللي قلته', 'امسح الجمله الاخيره', 'شيل اخر جمله', 'امسحها', 'غلط امسحها'].map(normalize));
const PUNCT = [
  [/(^|\s)(سطر جديد|سطر ثاني|نزل سطر)(?=\s|$)/gu, '\n'], [/(^|\s)(علامه|علامة) (استفهام)(?=\s|$)/gu, '؟'], [/(^|\s)(علامه|علامة) (تعجب)(?=\s|$)/gu, '!'],
  [/(^|\s)(نقطتين)(?=\s|$)/gu, ':'], [/(^|\s)(فاصله|فاصلة)(?=\s|$)/gu, '،'], [/(^|\s)(نقطه|نقطة)(?=\s|$)/gu, '.'],
];

/** «السلام عليكم فاصلة كيف حالك علامة استفهام» → «السلام عليكم، كيف حالك؟». */
export function spokenPunctuation(raw) {
  let t = ` ${String(raw || '').trim()} `;
  for (const [re, mark] of PUNCT) t = t.replace(re, mark === '\n' ? '\n' : mark);
  return t.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]+([.،؟!:])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/g, '');
}

function noteSuffix(note) {
  return note ? `: ${note}` : '';
}
