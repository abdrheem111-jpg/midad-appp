// Khalfoun remembers the lessons like a person would: what was explained, which students took
// part, where the class stopped. Each lesson becomes a short «episode» (closed when the period
// changes or after a long quiet); the last ones are told to Claude with every request, and
// «وين وقفنا؟» is answered from them at once, without asking Claude.

const KEEP = 80; // episodes kept (about a month of lessons)
const GAP = 40 * 60000; // a quiet this long ends a lesson
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export class LessonMemory {
  /** @param {{episodes?: object[], open?: object|null}} data */
  constructor(data = {}, now = () => Date.now()) {
    this.now = now;
    this.episodes = Array.isArray(data.episodes) ? data.episodes.slice(-KEEP) : [];
    this.open = data.open && typeof data.open === 'object' ? data.open : null;
  }

  toJSON() { return { episodes: this.episodes, open: this.open }; }

  /**
   * Something happened in the lesson.
   * @param {'topic'|'student'|'stop'} kind topic: what was taught ("حل 2x+3=11"); student: who took part; stop: where they stopped
   * @param {string} text
   * @param {string} [period] the timetable's period now (a new period starts a new lesson)
   */
  note(kind, text, period = '') {
    const t = this.now();
    const value = String(text || '').trim().slice(0, 120);
    if (!value) return;
    if (this.open && (t - this.open.last > GAP || (period && this.open.period && period !== this.open.period))) this.close();
    if (!this.open) this.open = { start: t, last: t, period: period || '', topics: [], students: [], stop: '' };
    const e = this.open;
    e.last = t;
    if (period && !e.period) e.period = period;
    if (kind === 'topic' && !e.topics.includes(value)) { e.topics.push(value); e.stop = value; if (e.topics.length > 12) e.topics.shift(); }
    if (kind === 'student' && !e.students.includes(value)) { e.students.push(value); if (e.students.length > 30) e.students.shift(); }
    if (kind === 'stop') e.stop = value;
  }

  /** Ends the lesson in progress (keeps it only if something was taught). */
  close() {
    const e = this.open;
    this.open = null;
    if (!e || !e.topics.length) return null;
    this.episodes.push(e);
    if (this.episodes.length > KEEP) this.episodes.splice(0, this.episodes.length - KEEP);
    return e;
  }

  /** The lesson in progress, closed first if it has gone quiet. */
  tick() { if (this.open && this.now() - this.open.last > GAP) this.close(); }

  static when(e, now) {
    const d = new Date(e.start); const today = new Date(now);
    const sameDay = d.toDateString() === today.toDateString();
    const yesterday = new Date(now - 86400000).toDateString() === d.toDateString();
    const day = sameDay ? 'اليوم' : yesterday ? 'أمس' : `يوم ${DAYS[d.getDay()]}`;
    return `${day}${e.period ? ` (${e.period})` : ''}`;
  }

  /** The last lesson (not the one in progress), optionally for a given period/class. */
  last(period = '') {
    for (let i = this.episodes.length - 1; i >= 0; i -= 1) if (!period || this.episodes[i].period === period) return this.episodes[i];
    return null;
  }

  /** «وين وقفنا؟» — an answer in Arabic, or null when nothing is remembered yet. */
  whereWeStopped(period = '') {
    const e = this.last(period) || this.last();
    if (!e) return null;
    const what = e.topics.slice(-3).join('، ');
    return `آخر مرة ${LessonMemory.when(e, this.now())} شرحنا: ${what}.${e.stop ? ` ووقفنا عند: ${e.stop}.` : ''}${e.students.length ? ` شارك: ${e.students.slice(-5).join('، ')}.` : ''}`;
  }

  /** A few lines for Claude with every request (short: it costs from the plan). */
  forClaude(period = '') {
    const lines = [];
    const prev = this.last(period) || this.last();
    if (prev) lines.push(`آخر حصة (${LessonMemory.when(prev, this.now())}): ${prev.topics.slice(-4).join('، ')}${prev.stop ? ` — وقفنا عند ${prev.stop}` : ''}`);
    if (this.open?.topics.length) lines.push(`هالحصة لين الحين: ${this.open.topics.slice(-5).join('، ')}${this.open.students.length ? ` — شارك ${this.open.students.slice(-6).join('، ')}` : ''}`);
    return lines.join(' | ').slice(0, 600);
  }
}

/** «وين وقفنا؟ / وش شرحنا آخر مرة؟ / وين كنا؟» */
export function asksWhereWeStopped(normalized) {
  return /^(?:يا خلفون )?(?:وين|وش|شو|ايش) (?:وقفنا|كنا|شرحنا|خذينا|درسنا)(?: (?:اخر مره|المره اللي فاتت|الحصه اللي فاتت|امس|اخر حصه))?\??$|^(?:ذكرني|ذكرنا) (?:وين وقفنا|بالدرس اللي فات|باخر حصه)$/.test(String(normalized || ''));
}
