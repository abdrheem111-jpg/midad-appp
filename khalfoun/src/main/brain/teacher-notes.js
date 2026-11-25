// What Khalfoun has learned about the teacher, so every week he understands him better:
//  - notes: his own words and what he means by them, how he likes things done, what he
//    corrected, facts about his classes and files. Claude writes them (tool «learn») and reads
//    them at the start of every session.
//  - habits: a command he gives again and again that Claude did with simple steps (open this
//    file, this program, this site, clear the screen...). After it went the same way twice,
//    Khalfoun does it at once next time, without waiting for Claude.
// Kept in userData/teacher-notes.json on his computer.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalize } from '../../core/arabic.js';

export const NOTE_KINDS = { word: 'كلماته', like: 'طريقته المفضلة', fix: 'صحّحني فيها', fact: 'عن صفه وشغله' };
const MAX_NOTES = 150;
const MAX_HABITS = 80;
/** Tools whose steps can be repeated as they are, with no screen to look at first. */
export const REPLAYABLE = new Set(['open_app', 'open_file', 'open_website', 'screen_clear', 'classroom']);
const FILLERS = ['يا خلفون', 'خلفون', 'لو سمحت', 'الله يخليك', 'من فضلك', 'ممكن', 'اريدك', 'ابغاك', 'ابيك', 'ابغيك', 'يا ريت', 'بليز'];

/** A spoken command as a habit key: no fillers, no punctuation, normalized letters. */
export function habitKey(text) {
  let t = ` ${normalize(String(text || '')).replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  for (const f of FILLERS.map(normalize)) t = t.split(` ${f} `).join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

const sameNote = (a, b) => {
  const x = habitKey(a); const y = habitKey(b);
  return x === y || (x.length > 12 && (x.includes(y) || y.includes(x)));
};

export class TeacherNotes {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.data = { notes: [], habits: {} };
    this.nextId = 1;
  }

  async load() {
    try {
      const d = JSON.parse(await readFile(this.file, 'utf8'));
      this.data = { notes: Array.isArray(d.notes) ? d.notes : [], habits: d.habits && typeof d.habits === 'object' ? d.habits : {} };
    } catch { /* first time */ }
    this.nextId = this.data.notes.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0) + 1;
    return this;
  }

  async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.data, null, 1));
  }

  /** A new thing learned (or the same thing again: it gets stronger, not duplicated). */
  async add(kind, text) {
    const k = NOTE_KINDS[kind] ? kind : 'fact';
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (t.length < 3) return null;
    const same = this.data.notes.find((n) => n.kind === k && sameNote(n.text, t));
    if (same) { same.text = t; same.uses = (same.uses || 1) + 1; same.at = this.now(); await this.save(); return same; }
    const note = { id: this.nextId++, kind: k, text: t, at: this.now(), uses: 1 };
    this.data.notes.push(note);
    if (this.data.notes.length > MAX_NOTES) {
      // forget the oldest that were used least
      const drop = [...this.data.notes].sort((a, b) => (a.uses || 1) - (b.uses || 1) || a.at - b.at)[0];
      this.data.notes = this.data.notes.filter((n) => n !== drop);
    }
    await this.save();
    return note;
  }

  async remove(id) {
    const before = this.data.notes.length;
    this.data.notes = this.data.notes.filter((n) => String(n.id) !== String(id));
    const wasHabit = Boolean(this.data.habits[id]);
    if (wasHabit) delete this.data.habits[id];
    const changed = before !== this.data.notes.length || wasHabit;
    if (changed) await this.save();
    return changed;
  }

  /**
   * After a turn: the steps Claude took for this command. Only simple, repeatable steps count;
   * the same steps twice make a habit.
   * @param {string} said
   * @param {{name: string, input: object, ok: boolean}[]} steps
   */
  async record(said, steps) {
    const key = habitKey(said);
    if (!key || key.length < 3 || !steps.length || steps.length > 4) return null;
    if (!steps.every((s) => s.ok && REPLAYABLE.has(s.name))) { if (this.data.habits[key]) { delete this.data.habits[key]; await this.save(); } return null; }
    const plan = steps.map((s) => ({ name: s.name, input: s.input || {} }));
    const sig = JSON.stringify(plan);
    const h = this.data.habits[key];
    if (h && JSON.stringify(h.plan) === sig) { h.count += 1; h.at = this.now(); h.phrase = String(said).slice(0, 120); }
    else this.data.habits[key] = { phrase: String(said).slice(0, 120), plan, count: 1, at: this.now() };
    const keys = Object.keys(this.data.habits);
    if (keys.length > MAX_HABITS) delete this.data.habits[keys.sort((a, b) => this.data.habits[a].at - this.data.habits[b].at)[0]];
    await this.save();
    return this.data.habits[key];
  }

  /** A habit to do at once for this command, if it has gone the same way at least twice. */
  habitFor(said) {
    const h = this.data.habits[habitKey(said)];
    return h && h.count >= 2 ? h : null;
  }

  /** The command was done at once: one more use. */
  async used(said) {
    const h = this.data.habits[habitKey(said)];
    if (h) { h.count += 1; h.at = this.now(); await this.save(); }
  }

  /** «لا، مو كذا»: the habit was wrong, Claude does it properly next time. */
  async forgetHabit(said) {
    const key = habitKey(said);
    if (!this.data.habits[key]) return false;
    delete this.data.habits[key];
    await this.save();
    return true;
  }

  list() {
    return {
      notes: [...this.data.notes].sort((a, b) => b.at - a.at),
      habits: Object.entries(this.data.habits).filter(([, h]) => h.count >= 2).map(([key, h]) => ({ id: key, phrase: h.phrase, count: h.count, steps: h.plan.map((p) => p.name) })),
    };
  }

  /** What Claude reads at the start of a session (short: the most used and the newest). */
  promptBlock(maxChars = 3500) {
    const lines = [];
    for (const [kind, title] of Object.entries(NOTE_KINDS)) {
      const notes = this.data.notes.filter((n) => n.kind === kind).sort((a, b) => (b.uses || 1) - (a.uses || 1) || b.at - a.at).slice(0, 25);
      if (notes.length) lines.push(`${title}:`, ...notes.map((n) => `- ${n.text}`));
    }
    const habits = Object.values(this.data.habits).filter((h) => h.count >= 2).sort((a, b) => b.count - a.count).slice(0, 15);
    if (habits.length) lines.push('أوامر يكررها (خلفون يسويها لحاله على طول):', ...habits.map((h) => `- «${h.phrase}» → ${h.plan.map((p) => `${p.name} ${JSON.stringify(p.input)}`).join('، ')}`));
    let out = lines.join('\n');
    if (out.length > maxChars) out = `${out.slice(0, maxChars)}…`;
    return out;
  }
}
