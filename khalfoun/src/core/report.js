// The weekly participation report the teacher can open in Excel: attendance, how often each
// student took part, the stars of the week and in total, and the grades the teacher approved.
// It never claims a student's level without enough data: with too little, it says so.

import { dayKey } from './attendance.js';

const DAY = 86400000;
const MIN_FOR_NOTE = 3; // fewer records than this → «بيانات قليلة»

/**
 * @param {{students?: string[], points?: Record<string, number>, log?: {n: string, k: string, at: number, d?: number, score?: number, total?: number}[]}} room
 * @param {{days?: Record<string, {absent: string[], late: string[]}>}} attendance
 * @param {{now?: number, days?: number}} [o]
 * @returns {{title: string, columns: string[], rows: (string|number)[][], summary: string}}
 */
export function weeklyReport(room = {}, attendance = {}, o = {}) {
  const now = o.now ?? Date.now();
  const span = o.days ?? 7;
  const from = now - span * DAY;
  const students = [...new Set([...(room.students || []), ...Object.keys(room.points || {})])];
  const schoolDays = [];
  for (let t = from + DAY; t <= now; t += DAY) { const d = new Date(t).getDay(); if (d !== 5 && d !== 6) schoolDays.push(dayKey(t)); } // Fri/Sat off in Oman
  const recorded = schoolDays.filter((k) => attendance.days?.[k]);
  const rows = students.map((name) => {
    const log = (room.log || []).filter((e) => e.n === name && e.at >= from && e.at <= now);
    const absent = recorded.filter((k) => attendance.days[k].absent.includes(name)).length;
    const late = recorded.filter((k) => attendance.days[k].late.includes(name)).length;
    const took = log.filter((e) => ['pick', 'star', 'answer'].includes(e.k)).length;
    const stars = log.filter((e) => e.k === 'star').reduce((a, e) => a + (e.d || 1), 0);
    const grades = log.filter((e) => e.k === 'grade' && Number.isFinite(e.score) && Number.isFinite(e.total) && e.total > 0);
    const avg = grades.length ? Math.round((grades.reduce((a, g) => a + g.score / g.total, 0) / grades.length) * 100) : null;
    const records = log.length + absent + late;
    let note = '';
    if (records < MIN_FOR_NOTE) note = 'بيانات قليلة هالأسبوع';
    else if (took === 0) note = 'ما شارك هالأسبوع';
    else if (absent >= 2) note = `غاب ${absent} أيام`;
    return [name, recorded.length ? recorded.length - absent : '—', absent, late, took, stars, room.points?.[name] || 0, avg === null ? '—' : `${avg}٪`, note];
  });
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ar'));
  const active = rows.filter((r) => r[4] > 0).length;
  const summary = `${students.length} طالب، شارك منهم ${active} هالأسبوع، وأيام الحضور المسجّلة ${recorded.length} من ${schoolDays.length}.`;
  return {
    title: `تقرير المشاركة الأسبوعي — حتى ${dayKey(now)}`,
    columns: ['الطالب', 'حضر (أيام)', 'غاب', 'تأخر', 'شارك (مرات)', 'نجوم الأسبوع', 'كل النجوم', 'متوسط الدرجات', 'ملاحظة'],
    rows,
    summary,
  };
}
