// How fast Khalfoun really is, measured on the teacher's own PC. Every answer notes its time;
// the settings show how close each kind is to its target, and the log keeps every line.

export const TARGETS = Object.freeze({
  wake: { ms: 300, name: 'سماع «يا خلفون»' },
  local: { ms: 1000, name: 'الأمر السريع (بدون Claude)' },
  claude_first: { ms: 2500, name: 'بداية رد Claude' },
  stt: { ms: 1500, name: 'تحويل الكلام لنص' },
});
const KEEP = 200;

export class LatencyMeter {
  constructor(data = {}) {
    this.data = {};
    for (const k of Object.keys(TARGETS)) this.data[k] = Array.isArray(data[k]) ? data[k].filter(Number.isFinite).slice(-KEEP) : [];
  }

  note(kind, ms) {
    if (!(kind in TARGETS) || !Number.isFinite(ms) || ms < 0 || ms > 120000) return false;
    this.data[kind].push(Math.round(ms));
    if (this.data[kind].length > KEEP) this.data[kind].splice(0, this.data[kind].length - KEEP);
    return true;
  }

  static pct(list, p) {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  }

  /** @returns {{kind: string, name: string, target: number, count: number, median: number|null, p90: number|null, ok: boolean|null}[]} */
  report() {
    return Object.entries(TARGETS).map(([kind, t]) => {
      const list = this.data[kind];
      const median = LatencyMeter.pct(list, 50); const p90 = LatencyMeter.pct(list, 90);
      return { kind, name: t.name, target: t.ms, count: list.length, median, p90, ok: median === null ? null : median <= t.ms };
    });
  }

  /** Lines for the settings panel, in Arabic. */
  lines() {
    const ar = (n) => Number(n).toLocaleString('ar-EG');
    return this.report().map((r) => (r.count
      ? `${r.ok ? '✅' : '⚠️'} ${r.name}: الوسط ${ar(r.median)} مللي ثانية (الهدف أقل من ${ar(r.target)})، من ${ar(r.count)} مرة`
      : `• ${r.name}: ما انقاس بعد`));
  }

  toJSON() { return this.data; }
}
