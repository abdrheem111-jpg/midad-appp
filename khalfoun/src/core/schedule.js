// The teacher's timetable: «كل أحد الساعة ٨ عندي حصة رياضيات وافتح البوربوينت».
// Khalfoun reminds five minutes before each class and can run a command for it
// (open the slides, the class file...). Pure logic; entries live in memory.

import { normalize, parseClock, toArabicDigits } from './arabic.js';

/** Weekday words (normalized) → JavaScript day numbers (Sunday = 0). */
export const WEEKDAYS = new Map([
  ['الاحد', 0], ['احد', 0], ['الاثنين', 1], ['اثنين', 1], ['الاتنين', 1], ['الثلاثاء', 2], ['الثلاثا', 2], ['ثلاثاء', 2],
  ['الاربعاء', 3], ['الاربعا', 3], ['اربعاء', 3], ['الخميس', 4], ['خميس', 4], ['الجمعه', 5], ['جمعه', 5], ['السبت', 6], ['سبت', 6],
]);
export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const SCHOOL_DAYS = [0, 1, 2, 3, 4]; // Sunday to Thursday in Oman

/** Weekdays mentioned in a sentence; «كل يوم» means the school week. */
export function parseDays(text) {
  const t = ` ${normalize(text)} `;
  if (/ (كل يوم|يوميا|كل الايام|ايام الدوام|ايام المدرسه) /.test(t)) return [...SCHOOL_DAYS];
  const days = [];
  for (const w of t.trim().split(' ')) {
    const d = WEEKDAYS.get(w.replace(/^و(?=ال)/, ''));
    if (d !== undefined && !days.includes(d)) days.push(d);
  }
  return days;
}

/** A class hour said without morning/evening: 6–11 is the morning, 12 noon, 1–5 the afternoon. */
export function schoolHour(clock) {
  let h = clock.hour;
  if (clock.period === 'am') h = h === 12 ? 0 : h;
  else if (clock.period === 'pm' || clock.period === 'noon') h = h < 12 ? h + 12 : h;
  else if (h >= 1 && h <= 5) h += 12;
  return h;
}

/**
 * «كل أحد وثلاثاء الساعة ٨ عندي حصة رياضيات الصف الخامس وافتح البوربوينت»
 * → {days, hour, minute, subject, command}; null if it is not a timetable entry.
 */
export function parseClassEntry(raw) {
  const text = normalize(raw);
  if (!/(^| )(حصه|حصتي|درس|حصص)( |$)/.test(text)) return null;
  const days = parseDays(raw);
  const clock = parseClock(raw);
  if (!days.length || !clock) return null;
  // The command part: «وافتح ...», «و افتح ...», «وشغل ...»
  const parts = String(raw).split(/\s+و\s*(?=(?:افتح|شغل|فج|ذكرني)\s)|\s+(?=(?:وافتح|وشغل|وفج)\s)/u);
  let command = null;
  if (parts.length > 1) command = parts.slice(1).join(' ').replace(/^و(?=افتح|شغل|فج)/u, '').trim() || null;
  const main = parts[0];
  // Subject: the words after «حصة/درس», minus day and time words.
  const words = main.split(/\s+/);
  const at = words.findIndex((w) => /^(حص(ة|ه)|حصتي|درس)$/u.test(normalize(w)));
  const skip = (w) => {
    const n = normalize(w).replace(/^و(?=ال)/, '');
    return WEEKDAYS.has(n) || /^(كل|يوم|الساعه|ساعه|الساعة|عندي|عندنا|في|ص|م|الصبح|الصباح|الظهر|العصر|المسا|المساء|ونص|وربع|الا|ربع|نص)$/.test(n)
      || /^[\d٠-٩:.]+$/.test(w) || /^(واحد|وحده|اثنين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره|احدعش|اثنعش)$/.test(n);
  };
  let subjectWords = at >= 0 ? words.slice(at + 1) : [];
  const stop = subjectWords.findIndex((w) => skip(w));
  if (stop >= 0) subjectWords = subjectWords.slice(0, stop);
  const subject = subjectWords.join(' ').replace(/[.،,!؟?]+$/u, '').trim() || 'حصة';
  return { days, hour: schoolHour(clock), minute: clock.minute, subject, command };
}

const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

/** Today's classes in order. */
export function classesOn(schedule, date) {
  const day = date.getDay();
  return (schedule || []).filter((c) => c.days.includes(day)).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

/** The next class from now (today or a later day), with how many minutes until it starts. */
export function nextClass(schedule, now) {
  const base = new Date(now);
  for (let add = 0; add < 8; add += 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + add);
    for (const c of classesOn(schedule, day)) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), c.hour, c.minute).getTime();
      if (start > now) return { entry: c, start, minutes: Math.round((start - now) / 60000), dayOffset: add };
    }
  }
  return null;
}

/** Classes starting within `before` minutes that have not been announced today. */
export function dueClasses(schedule, now, before = 5) {
  const d = new Date(now);
  const today = d.toDateString();
  const nowMin = minutesOfDay(d);
  return classesOn(schedule, d).filter((c) => {
    const start = c.hour * 60 + c.minute;
    return start - nowMin <= before && start - nowMin >= 0 && c.notified !== today;
  });
}

/** «الساعة ٨:٠٠» style time for a class. */
export function classTime(c) {
  const h12 = c.hour % 12 === 0 ? 12 : c.hour % 12;
  const part = c.hour < 12 ? 'الصبح' : c.hour < 15 ? 'الظهر' : 'العصر';
  return `${toArabicDigits(h12)}:${toArabicDigits(String(c.minute).padStart(2, '0'))} ${part}`;
}
