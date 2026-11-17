// Knows the days that matter in Oman so Khalfoun can greet, joke and dress
// for them: National Day (18 November), the new Gregorian year, Ramadan, the
// two Eids, the Day of Arafah, the Hijri new year and Fridays. Hijri dates use
// the Umm al-Qura calendar built into the JavaScript runtime; the actual
// sighting in Oman can differ by a day.

const HIJRI = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** @returns {{day: number, month: number, year: number}} */
export function hijriDate(date) {
  const parts = Object.fromEntries(HIJRI.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number.parseInt(p.value, 10)]));
  return { day: parts.day, month: parts.month, year: parts.year };
}

export const OCCASIONS = {
  national_day: { name: 'العيد الوطني', costume: 'flag' },
  new_year: { name: 'رأس السنة الميلادية', costume: null },
  ramadan: { name: 'رمضان', costume: 'lantern' },
  eid_fitr: { name: 'عيد الفطر', costume: 'bisht' },
  arafah: { name: 'يوم عرفة', costume: null },
  eid_adha: { name: 'عيد الأضحى', costume: 'bisht' },
  hijri_new_year: { name: 'رأس السنة الهجرية', costume: null },
  friday: { name: 'الجمعة', costume: null },
};

/**
 * The occasion for a date, most important first, or null.
 * @param {Date} date
 * @returns {{id: string, name: string, costume: string|null, day?: number} | null}
 */
export function occasionFor(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = hijriDate(date);
  const make = (id, extra = {}) => ({ id, ...OCCASIONS[id], ...extra });
  if (h.month === 10 && h.day <= 3) return make('eid_fitr', { day: h.day });
  if (h.month === 12 && h.day >= 10 && h.day <= 13) return make('eid_adha', { day: h.day - 9 });
  if (h.month === 12 && h.day === 9) return make('arafah');
  if (h.month === 9) return make('ramadan', { day: h.day });
  if (m === 11 && (d === 18 || d === 19)) return make('national_day');
  if (h.month === 1 && h.day === 1) return make('hijri_new_year');
  if (m === 1 && d === 1) return make('new_year');
  if (date.getDay() === 5) return make('friday');
  return null;
}
