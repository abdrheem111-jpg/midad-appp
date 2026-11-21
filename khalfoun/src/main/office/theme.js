// One look for everything Khalfoun makes: the colours of an Omani classroom (deep teal,
// sand, gold, palm green) and fonts that read well in Arabic on Windows.

export const THEME = {
  primary: '0E5E6F', // deep teal
  primaryDark: '0A4552',
  accent: 'C9962C', // gold
  sand: 'F7F1E3',
  sandDark: 'EADFC6',
  green: '2A7D4F',
  ink: '2A1A10',
  inkSoft: '6B5A4C',
  white: 'FFFFFF',
  // Fonts: Arabic text uses the complex-script font; all ship with Windows 10/11.
  bodyFont: 'Sakkal Majalla',
  bodyFontCs: 'Simplified Arabic',
  headFont: 'Segoe UI',
  slideFont: 'Segoe UI',
};

/** A safe file name from a title: letters, digits, spaces and dashes; never empty. */
export function fileTitle(title, fallback = 'خلفون') {
  const t = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/[^\p{L}\p{N} _-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || fallback;
}

/** Today in Arabic digits, for document headers. */
export function arabicDate(now = new Date()) {
  const d = now.toLocaleDateString('ar-OM', { day: 'numeric', month: 'long', year: 'numeric' });
  return d;
}
