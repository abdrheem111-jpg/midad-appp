// «علّم خلفون صوتك»: the teacher records himself calling Khalfoun (and saying other things), so
// that Khalfoun's own ear can be trained on his voice. Each step records by itself, one clip
// after another, so he only has to talk. The clips stay on his computer.

import { EAR_CALLS, EAR_OTHERS, goodCall } from '../core/ear-plan.js';

const ar = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const ROOM_MS = 3 * 60000;

export class EarTrainerPanel {
  /**
   * @param {{record: (opts: object) => Promise<{wav: Uint8Array, spoke: boolean, ms: number}>, stop: () => void,
   *   save: (kind: string, wav: Uint8Array) => Promise<{ok: boolean}>, stats: () => Promise<object>, voices: () => Promise<object>,
   *   onOpen?: () => void, onClose?: () => void, note?: (t: string) => void}} opts
   */
  constructor(opts, parent = document.body) {
    this.opts = opts;
    this.parent = parent;
    this.root = null;
    this.running = false;
  }

  get open() { return Boolean(this.root); }

  async show() {
    this.close();
    const root = el('section', 'panel fx-ui ear-trainer');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'علّم خلفون صوتك');
    root.append(el('h2', '', 'علّم خلفون صوتك 👂'));
    root.append(el('p', 'lead', 'هذي التسجيلات أدرّب عليها أذن خلفون الخاصة، عشان يسمع اسمه على جهازك بدون إنترنت. تبقى في جهازك.'));
    this.stepEl = el('p', 'vt-count');
    this.phrase = el('p', 'vt-phrase');
    this.tip = el('p', 'ear-tip');
    this.status = el('p', 'vt-heard');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    const row = el('div', 'row');
    this.btnCalls = this.button('🎤 ابدأ: نادِ خلفون', 'primary', () => this.run('call'));
    this.btnOthers = this.button('🗣️ جمل ثانية', '', () => this.run('other'));
    this.btnRoom = this.button('🏫 صوت الصف (٣ دقايق)', '', () => this.run('room'));
    this.btnVoices = this.button('🤖 أصوات Azure', '', () => this.makeVoices());
    this.btnStop = this.button('⏸️ وقّف', '', () => this.pause());
    this.btnStop.hidden = true;
    const close = this.button('سكّر', '', () => this.close());
    row.append(this.btnCalls, this.btnOthers, this.btnRoom, this.btnVoices, this.btnStop, close);
    this.counts = el('p', 'fine ear-counts');
    root.append(this.stepEl, this.phrase, this.tip, this.status, row, this.counts);
    this.parent.append(root);
    this.root = root;
    this.opts.onOpen?.();
    await this.refresh();
    this.showStep('call');
  }

  button(text, cls, fn) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  async refresh() {
    const s = (await this.opts.stats().catch(() => null)) || {};
    this.stats = s;
    if (!this.root) return;
    this.counts.textContent = `عندي: ${ar(s.call || 0)} نداء بصوتك · ${ar(s.other || 0)} جملة ثانية · ${ar(s.room || 0)} تسجيل للصف · ${ar((s['tts-call'] || 0) + (s['tts-other'] || 0))} صوت من Azure`;
    this.btnVoices.hidden = !s.azure;
  }

  showStep(kind) {
    const s = this.stats || {};
    if (kind === 'call') {
      const i = Math.min(s.call || 0, EAR_CALLS.length - 1);
      this.stepEl.textContent = `النداء ${ar(Math.min((s.call || 0) + 1, EAR_CALLS.length))} من ${ar(EAR_CALLS.length)}`;
      this.phrase.textContent = `«${EAR_CALLS[i][0]}»`;
      this.tip.textContent = EAR_CALLS[i][1];
    } else if (kind === 'other') {
      const i = (s.other || 0) % EAR_OTHERS.length;
      this.stepEl.textContent = `الجملة ${ar(((s.other || 0) % EAR_OTHERS.length) + 1)} من ${ar(EAR_OTHERS.length)}`;
      this.phrase.textContent = `«${EAR_OTHERS[i]}»`;
      this.tip.textContent = 'قولها عادي. هذي مو اسمه، عشان يتعلم الفرق.';
    } else {
      this.stepEl.textContent = 'صوت الصف';
      this.phrase.textContent = 'خلّ المايك يسمع ٣ دقايق من حصة عادية';
      this.tip.textContent = 'اشرح عادي، والطلاب يتكلمون. لا تقول «خلفون» خلال هالوقت.';
    }
  }

  /** Records one clip after another for this step, until it is done or he presses «وقّف». */
  async run(kind) {
    if (this.running || !this.root) return;
    this.running = true;
    this.kind = kind;
    this.btnStop.hidden = false;
    for (const b of [this.btnCalls, this.btnOthers, this.btnRoom, this.btnVoices]) b.disabled = true;
    try {
      while (this.running && this.root) {
        const s = this.stats || {};
        if (kind === 'call' && (s.call || 0) >= EAR_CALLS.length) { this.status.textContent = 'تمام! خلصت النداءات. الحين «جمل ثانية».'; break; }
        if (kind === 'other' && (s.other || 0) >= EAR_OTHERS.length) { this.status.textContent = 'تمام! خلصت الجمل.'; break; }
        this.showStep(kind);
        const withCommand = kind === 'call' && EAR_CALLS[Math.min(s.call || 0, EAR_CALLS.length - 1)][0].split(' ').length > 2;
        this.status.textContent = kind === 'room' ? '🔴 أسمع الصف… (٣ دقايق)' : '🔴 قول الحين';
        let rec;
        try {
          rec = await this.opts.record(kind === 'room' ? { maxMs: ROOM_MS, silenceMs: null, noSpeechMs: ROOM_MS } : { maxMs: withCommand ? 6500 : 4000, noSpeechMs: 6000 });
        } catch {
          this.status.textContent = 'ما قدرت أفتح المايك.';
          break;
        }
        if (!this.running || !this.root) break;
        if (kind !== 'room' && !goodCall(rec.ms, rec.spoke, withCommand || kind === 'other')) {
          this.status.textContent = rec.spoke ? 'طويلة أو مقطوعة شوي، نعيدها.' : 'ما سمعت شي، قولها مرة ثانية.';
          await new Promise((r) => setTimeout(r, 900));
          continue;
        }
        const saved = await this.opts.save(kind, rec.wav);
        if (!saved?.ok) { this.status.textContent = 'ما قدرت أحفظ التسجيل.'; break; }
        this.opts.note?.(`ear: saved ${kind} (${Math.round(rec.ms)} ms)`);
        await this.refresh();
        if (kind === 'room') { this.status.textContent = 'تمام، انحفظ صوت الصف. تقدر تسجّل مرة ثانية في حصة ثانية.'; break; }
        this.status.textContent = '✓ انحفظت';
        await new Promise((r) => setTimeout(r, 650)); // a breath before the next one
      }
    } finally {
      this.running = false;
      if (this.root) {
        this.btnStop.hidden = true;
        for (const b of [this.btnCalls, this.btnOthers, this.btnRoom, this.btnVoices]) b.disabled = false;
        this.showStep(kind === 'call' && (this.stats?.call || 0) >= EAR_CALLS.length ? 'other' : kind);
      }
    }
  }

  pause() {
    this.running = false;
    this.opts.stop();
    this.status.textContent = 'وقّفت. تقدر تكمل وقت ما تبغى، وما يضيع شي.';
  }

  async makeVoices() {
    if (this.running || !this.root) return;
    this.btnVoices.disabled = true;
    this.status.textContent = '🤖 Azure يقول اسمه بأصوات عربية مختلفة… (دقايق قليلة)';
    const r = await this.opts.voices().catch(() => null);
    if (!this.root) return;
    this.btnVoices.disabled = false;
    await this.refresh();
    this.status.textContent = r?.ok ? `تمام! ${ar(r.made)} تسجيل جديد من ${ar(r.voices)} صوت.` : r?.error === 'busy' ? 'شغال عليها…' : 'ما زبطت أصوات Azure الحين. جرّب بعدين.';
  }

  progress(p) {
    if (this.root && p?.total) this.status.textContent = `🤖 أصوات Azure: ${ar(p.done)} من ${ar(p.total)}`;
  }

  close() {
    if (this.running) { this.running = false; this.opts.stop(); }
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.opts.onClose?.();
  }
}
