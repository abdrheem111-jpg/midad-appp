// Desktop awareness: turns the list of open windows into events Khalfoun can
// react to («فتحت ملف PDF»، «سكرت الوورد»), without nagging: the first list
// after start-up is only remembered, and each kind of remark has a cool-down.

/** What a window is, from its title. */
export function classifyWindow(title) {
  const t = String(title || '');
  const l = t.toLowerCase();
  if (/\.pdf\b/i.test(t) || /adobe acrobat|acrobat reader|foxit|sumatrapdf/.test(l)) return 'pdf';
  if (/youtube|يوتيوب/.test(l)) return 'youtube';
  if (/\.docx?\b/.test(l) || / - word$|microsoft word/.test(l)) return 'word';
  if (/\.xlsx?\b/.test(l) || / - excel$|microsoft excel/.test(l)) return 'excel';
  if (/\.pptx?\b/.test(l) || / - powerpoint$|microsoft powerpoint/.test(l)) return 'powerpoint';
  if (/notepad|المفكرة/.test(l)) return 'notepad';
  if (/calculator|الحاسبة/.test(l)) return 'calculator';
  if (/paint|الرسام/.test(l)) return 'paint';
  if (/zoom|microsoft teams|google meet/.test(l)) return 'meeting';
  if (/edge|chrome|firefox|brave|opera/.test(l)) return 'browser';
  if (/file explorer|مستكشف الملفات|downloads|التنزيلات|documents|المستندات/.test(l)) return 'explorer';
  return 'other';
}

/** The file or page name inside a title: «الدرس ٣.pdf - Adobe Acrobat» → «الدرس ٣.pdf». */
export function shortTitle(title) {
  const t = String(title || '').trim();
  const first = t.split(/\s[-–—|]\s/)[0].trim();
  return (first || t).slice(0, 40);
}

export class DesktopWatcher {
  /** @param {{cooldownMs?: number, globalMs?: number}} [opts] */
  constructor(opts = {}) {
    this.known = null; // id → {kind, title}
    this.lastByKind = new Map();
    this.lastAny = -Infinity;
    this.cooldownMs = opts.cooldownMs ?? 90_000;
    this.globalMs = opts.globalMs ?? 25_000;
  }

  /**
   * Compares a new window list with the previous one.
   * @param {Array<{id: any, x: number, y: number, w: number, h: number, t?: string}>} list
   * @param {number} now
   * @returns {Array<{type: 'opened'|'closed', kind: string, title: string, rect?: object}>} at most one event
   */
  update(list, now) {
    const next = new Map((list || []).map((w) => [w.id, { kind: classifyWindow(w.t), title: shortTitle(w.t), rect: { x: w.x, y: w.y, w: w.w, h: w.h } }]));
    const prev = this.known;
    this.known = next;
    if (!prev) return []; // first look after start-up: just remember
    const events = [];
    for (const [id, w] of next) if (!prev.has(id) && w.title) events.push({ type: 'opened', ...w });
    for (const [id, w] of prev) if (!next.has(id) && w.title) events.push({ type: 'closed', kind: w.kind, title: w.title });
    // One remark at a time, the most interesting first, respecting the cool-downs.
    const rank = (e) => (e.type === 'opened' ? 0 : 10) + (e.kind === 'other' ? 5 : 0);
    for (const e of events.sort((a, b) => rank(a) - rank(b))) {
      if (now - this.lastAny < this.globalMs) break;
      const key = `${e.type}:${e.kind}`;
      if (now - (this.lastByKind.get(key) ?? -Infinity) < this.cooldownMs) continue;
      this.lastByKind.set(key, now);
      this.lastAny = now;
      return [e];
    }
    return [];
  }
}

/** What kind of file a download is, from its name. */
export function downloadKind(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['ppt', 'pptx'].includes(ext)) return 'powerpoint';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  return 'file';
}

/** Names that are still downloading or are temporary files. */
export const PARTIAL_DOWNLOAD = /\.(crdownload|part|partial|tmp|download|opdownload)$|^~\$|^\./i;
