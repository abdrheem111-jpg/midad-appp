// Attendance by voice: «غايب أحمد ومريم», «سالم تأخر», «حضر أحمد». One record per school
// day, kept in memory; exported as a spreadsheet the teacher can open in Excel.

import { normalize } from './arabic.js';

const MAX_DAYS = 400;

export function dayKey(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Attendance {
  /** @param {{days?: Record<string, {absent: string[], late: string[]}>}} [data] */
  constructor(data = {}) {
    this.days = {};
    for (const [k, v] of Object.entries(data?.days || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v) continue;
      this.days[k] = { absent: [...new Set((v.absent || []).map(String))].slice(0, 80), late: [...new Set((v.late || []).map(String))].slice(0, 80) };
    }
  }

  toJSON() {
    const keys = Object.keys(this.days).sort().slice(-MAX_DAYS);
    return { days: Object.fromEntries(keys.map((k) => [k, this.days[k]])) };
  }

  day(key) {
    if (!this.days[key]) this.days[key] = { absent: [], late: [] };
    return this.days[key];
  }

  /** Marks names as absent / late / present for a day. Returns the names changed. */
  mark(key, names, kind) {
    const d = this.day(key);
    const changed = [];
    for (const name of names) {
      if (kind === 'present') {
        const before = d.absent.length + d.late.length;
        d.absent = d.absent.filter((n) => n !== name);
        d.late = d.late.filter((n) => n !== name);
        if (d.absent.length + d.late.length < before) changed.push(name);
        continue;
      }
      const list = kind === 'late' ? d.late : d.absent;
      const other = kind === 'late' ? 'absent' : 'late';
      d[other] = d[other].filter((n) => n !== name); // late replaces absent and the other way round
      if (!list.includes(name)) { list.push(name); changed.push(name); }
    }
    return changed;
  }

  /** Days each student was absent or late (newest first), for the export and «كم غاب أحمد». */
  summary() {
    const out = {};
    for (const [day, d] of Object.entries(this.days)) {
      for (const n of d.absent) (out[n] ||= { absent: 0, late: 0, days: [] }).absent += 1;
      for (const n of d.late) (out[n] ||= { absent: 0, late: 0, days: [] }).late += 1;
      for (const n of [...d.absent, ...d.late]) out[n].days.push(day);
    }
    return out;
  }

  /**
   * Rows for the spreadsheet: one per student per day with a status, plus a summary block.
   * @param {string[]} students the class list, so present students appear too
   */
  rows(students = [], fromKey = '0000-00-00') {
    const keys = Object.keys(this.days).filter((k) => k >= fromKey).sort();
    const names = [...new Set([...students, ...keys.flatMap((k) => [...this.days[k].absent, ...this.days[k].late])])];
    const header = ['الطالب', ...keys, 'أيام الغياب', 'مرات التأخر'];
    const body = names.map((n) => {
      let absent = 0;
      let late = 0;
      const cells = keys.map((k) => {
        const d = this.days[k];
        if (d.absent.includes(n)) { absent += 1; return 'غائب'; }
        if (d.late.includes(n)) { late += 1; return 'متأخر'; }
        return 'حاضر';
      });
      return [n, ...cells, String(absent), String(late)];
    });
    return [header, ...body];
  }
}

/**
 * Finds which class names a sentence mentions: «غايب احمد وسالم ومريم».
 * @param {string} text the names part of the sentence
 * @param {(name: string) => string|null} find the classroom's fuzzy name finder
 * @returns {{found: string[], unknown: string[]}}
 */
export function namesIn(text, find) {
  const parts = String(text || '').split(/[،,]|\s+و\s*|\s+/u).map((p) => p.replace(/^و(?=\S{2,})/u, '').trim()).filter(Boolean);
  const found = [];
  const unknown = [];
  const SKIP = new Set(['اليوم', 'الحين', 'كلهم', 'يا', 'خلفون', 'و', 'بعد', 'كمان', 'برضو', 'والله', 'تراه', 'تراهم', 'هم', 'هو', 'هي', 'غايب', 'غايبين', 'غايبه', 'متاخر', 'متاخرين', 'تاخر', 'تاخرت', 'حاضر', 'حضر', 'حضرت', 'الطالب', 'الطالبه'].map(normalize));
  for (let i = 0; i < parts.length; i += 1) {
    if (SKIP.has(normalize(parts[i]))) continue;
    // Two-word names first: «عبد الله», «ام كلثوم».
    const two = i + 1 < parts.length ? find(`${parts[i]} ${parts[i + 1]}`) : null;
    if (two && !found.includes(two)) { found.push(two); i += 1; continue; }
    const one = find(parts[i]);
    if (one) { if (!found.includes(one)) found.push(one); } else if (parts[i].length > 1) unknown.push(parts[i]);
  }
  return { found, unknown };
}

/** A CSV that Excel opens with Arabic intact (UTF-8 with BOM). */
export function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
