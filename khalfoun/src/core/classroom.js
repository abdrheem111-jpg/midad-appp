// Classroom helpers for the teacher: the class list, picking a student at
// random (nobody twice until everyone has had a turn), splitting the class into
// groups, and points per student. Pure logic; the brain keeps the data in memory.

import { normalize } from './arabic.js';
import { levenshtein } from './wake.js';

/** «أحمد، سعيد و مريم - فاطمة» → ['أحمد', 'سعيد', 'مريم', 'فاطمة'] (max 60 names). */
export function parseNames(raw) {
  const out = [];
  for (let part of String(raw || '').split(/[،,;؛\n\-–]+|\s+و\s+/u)) {
    part = part.replace(/^\s*و(?=\S{2,})/u, '').replace(/[.!؟?«»"]/g, '').trim();
    if (!part || part.length > 30) continue;
    if (!out.some((n) => normalize(n) === normalize(part))) out.push(part);
  }
  return out.slice(0, 60);
}

/** Fisher–Yates with an injectable random source. */
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LOG_MAX = 4000;

export class Classroom {
  /** @param {{students?: string[], points?: Record<string, number>, picked?: string[]}} [data] */
  constructor(data = {}) {
    this.students = Array.isArray(data.students) ? [...data.students] : [];
    this.points = data.points && typeof data.points === 'object' ? { ...data.points } : {};
    this.picked = Array.isArray(data.picked) ? [...data.picked] : [];
    // Khalfoun 3: what each student did and when (picked, a star, present…), for the fair pick and the weekly report
    this.log = Array.isArray(data.log) ? data.log.filter((e) => e && typeof e.n === 'string' && Number.isFinite(e.at)).slice(-LOG_MAX) : [];
  }

  toJSON() {
    return { students: this.students, points: this.points, picked: this.picked, log: this.log };
  }

  /** Notes a moment of taking part. kind: pick | star | answer | present | absent | grade */
  note(name, kind, at = Date.now(), extra = {}) {
    const who = this.find(name) || name;
    if (!who) return;
    this.log.push({ n: who, k: kind, at, ...extra });
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
  }

  /** How many times each student took part (picked, a star, an answer) in the last `days`. */
  participation(days = 14, now = Date.now()) {
    const from = now - days * 86400000;
    const out = Object.fromEntries(this.students.map((s) => [s, 0]));
    for (const e of this.log) if (e.at >= from && ['pick', 'star', 'answer'].includes(e.k) && e.n in out) out[e.n] += 1;
    return out;
  }

  /** Why this student was chosen, in a sentence the teacher can ask for («ليش هو؟»). */
  why(name, now = Date.now()) {
    const counts = this.participation(14, now);
    const c = counts[name] ?? 0;
    const last = [...this.log].reverse().find((e) => e.n === name && e.k !== 'pick-now');
    const avg = Object.values(counts).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(counts).length);
    if (!c) return `${name} ما شارك ولا مرة في الأسبوعين اللي فاتوا، فكان له الحظ الأكبر.`;
    if (c < avg) return `${name} شارك ${c === 1 ? 'مرة وحدة' : `${c} مرات`} في الأسبوعين اللي فاتوا، أقل من متوسط الصف، فكان حظه أكبر.`;
    return `${name} طلع بالقرعة العادية (كل الطلاب لهم فرصة، واللي شاركوا أقل حظهم أكبر شوي).${last ? '' : ''}`;
  }

  setStudents(names) {
    this.students = names.slice(0, 60);
    this.picked = [];
    return this.students.length;
  }

  add(name) {
    if (!name || this.find(name)) return false;
    this.students.push(name);
    return true;
  }

  remove(name) {
    const found = this.find(name);
    if (!found) return null;
    this.students = this.students.filter((n) => n !== found);
    this.picked = this.picked.filter((n) => n !== found);
    return found;
  }

  /** The student whose name matches (tolerating «ال», hamza forms and one letter off). */
  find(name) {
    const n = normalize(name).replace(/^ال/, '');
    if (!n) return null;
    const exact = this.students.find((s) => normalize(s).replace(/^ال/, '') === n);
    if (exact) return exact;
    const near = this.students.filter((s) => levenshtein(normalize(s), n) <= (n.length >= 4 ? 1 : 0));
    return near.length === 1 ? near[0] : null;
  }

  /**
   * A random student who has not been picked yet this round — weighted so that those who took
   * part less in the last two weeks are more likely (never certain: everyone keeps a chance).
   */
  pick(rng = Math.random, now = Date.now()) {
    if (!this.students.length) return null;
    let pool = this.students.filter((s) => !this.picked.includes(s));
    let newRound = false;
    if (!pool.length) { this.picked = []; pool = [...this.students]; newRound = true; }
    const counts = this.participation(14, now);
    const weights = pool.map((s) => 1 / (1 + (counts[s] || 0)));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let name = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i += 1) { r -= weights[i]; if (r < 0) { name = pool[i]; break; } }
    this.picked.push(name);
    this.note(name, 'pick', now);
    return { name, left: pool.length - 1, newRound };
  }

  /** Splits the class into `count` groups (or groups of `size`), as even as possible. */
  groups({ count, size } = {}, rng = Math.random) {
    if (!this.students.length) return [];
    const n = size ? Math.max(1, Math.ceil(this.students.length / size)) : Math.max(1, Math.min(count || 2, this.students.length));
    const order = shuffle(this.students, rng);
    const out = Array.from({ length: n }, () => []);
    order.forEach((name, i) => out[i % n].push(name));
    return out;
  }

  /** Adds points (or takes them away with a negative delta); unknown names are added to the class. */
  award(name, delta = 1) {
    const who = this.find(name) || String(name).trim();
    if (!who) return null;
    if (!this.students.includes(who)) this.students.push(who);
    this.points[who] = Math.max(0, (this.points[who] || 0) + delta);
    if (delta > 0) this.note(who, 'star', Date.now(), { d: delta });
    // escalating celebrations: every 5th star is bigger, every 10th the biggest
    const p = this.points[who];
    const level = delta > 0 ? (p % 10 === 0 ? 3 : p % 5 === 0 ? 2 : 1) : 0;
    return { name: who, points: p, level };
  }

  board(limit = 10) {
    return Object.entries(this.points).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, points]) => ({ name, points }));
  }

  resetPoints() { this.points = {}; }
}
