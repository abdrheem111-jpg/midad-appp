// Khalfoun's quiet initiative during a lesson, and what he learns from the teacher:
//   • suggestions by the lesson's moment (a new lesson, after a concept, a long explanation, a
//     review, a common mistake) — silent, at most one every N minutes, and the teacher can turn
//     them off; the decision is always his;
//   • routines the teacher records by voice («سجل روتين ابدأ الحصة» … «خلاص الروتين»), run with
//     their name, and offered when Khalfoun notices the same commands done together again;
//   • the dialect dictionary: «لما أقول X أقصد Y».

import { normalize } from './arabic.js';

// ---------------------------------------------------------------- suggestions

const IDEAS = {
  lesson_start: { title: 'بداية درس جديد', body: 'أجهز لك أهداف الدرس في ٣ نقاط قصيرة تعرضها على الصف؟', say: 'جهز أهداف الدرس الحالي في ٣ نقاط قصيرة واكتبها على الشاشة' },
  concept_done: { title: 'خلصنا شرح فكرة', body: 'نسوي سؤال تحقق سريع (٣ أسئلة اختيار من متعدد) على اللي شرحناه؟', say: 'جهز ٣ أسئلة تحقق سريعة اختيار من متعدد على اللي شرحناه الحين بأداة quiz_make' },
  long_talk: { title: 'شرح طويل', body: 'الشرح صار له وقت. نسوي نشاط تفاعلي قصير؟ (طالب عشوائي يحل مثال، أو تصويت بالأيدي)', say: 'اقترح نشاط تفاعلي قصير دقيقتين على الدرس الحالي واختار طالب عشوائي يبدأ' },
  review: { title: 'مراجعة', body: 'أجهز اختبار سريع من ٥ أسئلة متدرجة للمراجعة؟', say: 'جهز اختبار مراجعة سريع ٥ أسئلة متدرجة من الدرس بأداة quiz_make' },
  group_error: { title: 'خطأ متكرر عند الطلاب', body: 'أكثر من طالب غلط في نفس الفكرة. أجهز شرح بديل بمثال مختلف وخطوات أبسط؟', say: 'أكثر الطلاب غلطوا في نفس الفكرة: اشرحها بطريقة مختلفة بمثال جديد خطوة خطوة بأداة math' },
};

export class Suggester {
  /** @param {{enabled?: () => boolean, everyMin?: () => number, now?: () => number}} o */
  constructor(o = {}) {
    this.o = o;
    this.lastAt = -Infinity;
    this.lastKind = {};
  }

  /**
   * A moment of the lesson happened: a suggestion to offer, or null (off, too soon, same idea lately).
   * @param {'lesson_start'|'concept_done'|'long_talk'|'review'|'group_error'} kind
   */
  moment(kind) {
    const now = this.o.now ? this.o.now() : Date.now();
    if (this.o.enabled && !this.o.enabled()) return null;
    const idea = IDEAS[kind];
    if (!idea) return null;
    const every = Math.max(5, Math.min(60, Number(this.o.everyMin?.() || 10))) * 60000;
    if (now - this.lastAt < every) return null;
    if (now - (this.lastKind[kind] ?? -Infinity) < 30 * 60000) return null;
    this.lastAt = now;
    this.lastKind[kind] = now;
    return { kind: 'suggest', title: `💡 ${idea.title}`, body: idea.body, actions: [{ id: 'do', label: 'سوّه', main: true }, { id: 'dismiss', label: 'لا شكراً' }], data: { say: idea.say, moment: kind } };
  }
}

/** Notices the lesson's moments from what happens: how long he has been talking without a command, a review, mistakes. */
export class LessonWatch {
  constructor(now = () => Date.now()) { this.now = now; this.lastCommand = 0; this.talkMs = 0; this.talkFrom = 0; this.lowGrades = []; }

  /** A command to Khalfoun: the explanation was interrupted. Returns 'lesson_start' after a long quiet. */
  command() {
    const t = this.now();
    const fresh = this.lastCommand && t - this.lastCommand > 40 * 60000;
    const first = !this.lastCommand;
    this.lastCommand = t; this.talkMs = 0; this.talkFrom = t;
    return fresh || first ? 'lesson_start' : null;
  }

  /** The teacher spoke (a sentence not for Khalfoun). 'long_talk' after 12 minutes of talk in 20 without a command. */
  talk(ms) {
    const t = this.now();
    if (!this.talkFrom || t - this.talkFrom > 20 * 60000) { this.talkFrom = t; this.talkMs = 0; }
    this.talkMs += ms;
    if (this.talkMs >= 12 * 60000) { this.talkMs = 0; this.talkFrom = t; return 'long_talk'; }
    return null;
  }

  /** A grade the teacher approved. 'group_error' when three of the last 30 minutes are below half. */
  grade(score, total) {
    const t = this.now();
    if (total > 0 && score / total < 0.5) this.lowGrades.push(t);
    this.lowGrades = this.lowGrades.filter((x) => t - x < 30 * 60000);
    if (this.lowGrades.length >= 3) { this.lowGrades = []; return 'group_error'; }
    return null;
  }
}

/** «نراجع / مراجعة» → review; «اغلبهم غلطوا / كلهم غلطوا» → a common mistake. */
export function momentFromWords(text) {
  const t = normalize(text);
  if (/(نراجع|مراجعه|خلونا نراجع|بنراجع)/.test(t)) return 'review';
  if (/(اغلبهم|كلهم|اكثرهم|معظمهم) (غلطوا|خطوا|ما فهموا|غلط)/.test(t)) return 'group_error';
  return null;
}

// ---------------------------------------------------------------- routines

const REC_START = /^(?:يا خلفون )?(?:سجل|سو|سوي|علمني|احفظ) (?:لي )?روتين (.{2,40})$/;
const REC_END = /^(?:خلاص|انتهى|خلص|وقف) (?:ال)?روتين$/;
const DEL = /^(?:احذف|امسح|الغ) (?:ال)?روتين (.{2,40})$/;
const LIST = /^(?:وش|شو|ايش)? ?(?:ال)?روتينات(?:ي)?$|^روتيناتي$/;

/**
 * What a sentence means for routines.
 * @returns {{op: 'start', name: string}|{op: 'end'}|{op: 'delete', name: string}|{op: 'list'}|{op: 'run', name: string}|null}
 */
export function routineCommand(text, routines = {}) {
  const t = normalize(text).replace(/^يا خلفون /, '');
  let m = REC_START.exec(t); if (m) return { op: 'start', name: m[1].trim() };
  if (REC_END.test(t)) return { op: 'end' };
  m = DEL.exec(t); if (m) return { op: 'delete', name: m[1].trim() };
  if (LIST.test(t)) return { op: 'list' };
  if (Object.prototype.hasOwnProperty.call(routines, t)) return { op: 'run', name: t };
  return null;
}

/**
 * Commands done together again and again: the same two or three, in order, within three minutes,
 * on two different days → offered as a routine.
 * @param {{text: string, at: number}[]} history
 * @returns {{steps: string[]}|null}
 */
export function routinePattern(history, now = Date.now()) {
  const recent = history.filter((h) => now - h.at < 30 * 86400000);
  const seqs = new Map(); // key → Set of days
  for (let i = 0; i < recent.length; i += 1) {
    for (const len of [3, 2]) {
      const part = recent.slice(i, i + len);
      if (part.length < len || part.at(-1).at - part[0].at > 3 * 60000) continue;
      const texts = part.map((p) => normalize(p.text));
      if (new Set(texts).size < len) continue;
      const key = texts.join(' | ');
      const day = new Date(part[0].at).toDateString();
      if (!seqs.has(key)) seqs.set(key, { days: new Set(), steps: part.map((p) => p.text) });
      seqs.get(key).days.add(day);
    }
  }
  for (const v of seqs.values()) if (v.days.size >= 2) return { steps: v.steps };
  return null;
}

// ---------------------------------------------------------------- the dialect dictionary

const DICT_SET = /^(?:يا خلفون )?(?:لما|اذا|يوم) (?:اقول|قلت) (.{1,30}?) (?:اقصد|يعني|معناها) (.{1,40})$|^(?:يا خلفون )?صحح:? (.{1,30}?) (?:يعني|معناها) (.{1,40})$/;

/** «لما أقول الشنطه أقصد الملف» → {from: 'الشنطه', to: 'الملف'} */
export function dictionaryCommand(text) {
  const m = DICT_SET.exec(normalize(text));
  if (!m) return null;
  const from = (m[1] || m[3]).trim(); const to = (m[2] || m[4]).trim();
  return from && to && from !== to ? { from, to } : null;
}

/** The teacher's words replaced by what he means, whole words only. */
export function applyDictionary(text, dict = {}) {
  const entries = Object.entries(dict || {}).filter(([k, v]) => k && v).sort((a, b) => b[0].length - a[0].length);
  if (!entries.length) return text;
  let t = ` ${normalize(text)} `;
  let changed = false;
  for (const [from, to] of entries) {
    const re = new RegExp(`(?<=\\s)${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s)`, 'g');
    if (re.test(t)) { t = t.replace(re, to); changed = true; }
  }
  return changed ? t.trim() : text;
}
