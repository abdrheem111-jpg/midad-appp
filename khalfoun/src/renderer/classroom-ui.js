// Classroom pieces drawn over the desktop: the name wheel, the camel race board, the noise
// meter gauge, the camera panel for «حل من الكاميرا» and the voice test. Each one is a small
// element with the class «fx-ui» (the overlay makes those clickable).

import { NoiseMeter, QUIET_FOR_STAR_S } from './noise.js';

const ar = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const WHEEL_COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#457b9d', '#c77dff', '#43aa8b', '#ff70a6', '#8d6e63', '#118ab2'];

// ------------------------------------------------------------------ name wheel

export class NameWheel {
  constructor(parent = document.body) {
    this.parent = parent;
    this.root = null;
  }

  /**
   * Spins to the chosen name and resolves when it stops.
   * @param {{names: string[], chosen: string, angle: number}} spin
   */
  spin({ names, chosen, angle }, { reduced = false } = {}) {
    this.close();
    const root = el('div', 'fx-ui wheel-box');
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', `عجلة الأسماء: ${chosen}`);
    const size = 420;
    const r = size / 2 - 8;
    const s = svg('svg', { viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`, class: 'wheel-svg' });
    const disc = svg('g', { class: 'wheel-disc' });
    const n = names.length;
    const slice = (Math.PI * 2) / n;
    names.forEach((name, i) => {
      // Slice i spans i*slice .. (i+1)*slice, measured clockwise from the top.
      const a0 = i * slice - Math.PI / 2;
      const a1 = (i + 1) * slice - Math.PI / 2;
      const large = slice > Math.PI ? 1 : 0;
      const path = svg('path', {
        d: `M0 0 L${(Math.cos(a0) * r).toFixed(2)} ${(Math.sin(a0) * r).toFixed(2)} A${r} ${r} 0 ${large} 1 ${(Math.cos(a1) * r).toFixed(2)} ${(Math.sin(a1) * r).toFixed(2)} Z`,
        fill: WHEEL_COLORS[i % WHEEL_COLORS.length], stroke: '#fff', 'stroke-width': 2,
      });
      disc.append(path);
      const mid = (a0 + a1) / 2;
      const tx = (Math.cos(mid) * r * 0.62).toFixed(1);
      const ty = (Math.sin(mid) * r * 0.62).toFixed(1);
      // Few names: written across the slice, so the winner reads upright at the top.
      // Many names: along the radius, flipped on the left so none is upside down.
      let deg = (mid * 180) / Math.PI;
      if (n <= 12) deg += 90;
      else if (Math.cos(mid) < 0) deg += 180;
      const t = svg('text', {
        x: tx, y: ty,
        transform: `rotate(${deg.toFixed(1)} ${tx} ${ty})`,
        class: 'wheel-name', 'font-size': n > 20 ? 13 : n > 12 ? 16 : 20,
      });
      t.textContent = name.length > 12 ? `${name.slice(0, 11)}…` : name;
      disc.append(t);
    });
    disc.append(svg('circle', { r: 26, fill: '#fffdf7', stroke: '#2a1a10', 'stroke-width': 3 }));
    s.append(disc);
    s.append(svg('path', { d: `M-16 ${-size / 2 + 2} L16 ${-size / 2 + 2} L0 ${-size / 2 + 36} Z`, fill: '#2a1a10', stroke: '#fff', 'stroke-width': 2 }));
    const label = el('div', 'wheel-label', '…');
    root.append(s, label);
    this.parent.append(root);
    this.root = root;
    root.addEventListener('click', () => this.close());
    return new Promise((resolve) => {
      const secs = reduced ? 0.8 : 5.2;
      disc.style.transition = `transform ${secs}s cubic-bezier(0.12, 0.7, 0.12, 1)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { disc.style.transform = `rotate(${angle}deg)`; }));
      const done = () => {
        if (this.root !== root) return resolve();
        label.textContent = chosen;
        root.classList.add('done');
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => { if (this.root === root) this.close(); }, 6000);
        resolve();
      };
      disc.addEventListener('transitionend', done, { once: true });
      setTimeout(done, secs * 1000 + 300); // in case transitionend does not fire
    });
  }

  close() {
    clearTimeout(this.hideTimer);
    this.root?.remove();
    this.root = null;
  }
}

// ------------------------------------------------------------------ camel race

export class RaceBoard {
  constructor(parent = document.body) {
    this.parent = parent;
    this.root = null;
  }

  /** @param {{teams: number, goal: number, positions: number[], winner: number|null, names: string[]} | null} race */
  show(race, onClose) {
    if (!race) { this.close(); return; }
    if (!this.root || this.root.dataset.teams !== String(race.teams)) {
      this.close();
      const root = el('section', 'fx-ui race-board');
      root.dataset.teams = String(race.teams);
      root.setAttribute('aria-label', 'سباق الهجن');
      const head = el('div', 'race-head');
      head.append(el('b', '', '🐪 سباق الهجن'));
      const x = el('button', 'race-close', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'سكّر السباق');
      x.addEventListener('click', () => { this.close(); onClose?.(); });
      head.append(x);
      root.append(head);
      this.lanes = race.names.map((name, i) => {
        const lane = el('div', 'race-lane');
        const tag = el('span', 'race-team', `الفريق ${name}`);
        const track = el('div', 'race-track');
        const camel = el('span', 'race-camel', '🐪');
        const score = el('span', 'race-score', '٠');
        track.append(camel, el('span', 'race-finish', '🏁'));
        lane.append(tag, track, score);
        root.append(lane);
        lane.style.setProperty('--hue', String((i * 67) % 360));
        return { lane, camel, score };
      });
      this.parent.append(root);
      this.root = root;
    }
    race.positions.forEach((p, i) => {
      const l = this.lanes[i];
      if (!l) return;
      // RTL: the camels run from the right (start) to the left (finish).
      l.camel.style.insetInlineStart = `calc(${((p / race.goal) * 100).toFixed(1)}% - ${((p / race.goal) * 40).toFixed(1)}px)`;
      l.camel.classList.remove('hop');
      void l.camel.offsetWidth;
      l.camel.classList.add('hop');
      l.score.textContent = ar(p);
      l.lane.classList.toggle('winner', race.winner === i + 1);
    });
    this.root.classList.toggle('finished', Boolean(race.winner));
  }

  close() {
    this.root?.remove();
    this.root = null;
  }
}

// ------------------------------------------------------------------ noise gauge

export class NoiseGauge {
  constructor(parent = document.body) {
    this.parent = parent;
    this.root = null;
    this.meter = null;
  }

  /**
   * @param {{onEvent: (e: string) => void, paused: () => boolean, onClose: () => void}} opts
   * @returns {Promise<boolean>} false when the microphone is not available
   */
  async start(opts) {
    if (this.meter?.active) return true;
    const root = el('section', 'fx-ui noise-box');
    root.setAttribute('aria-label', 'مقياس الهدوء');
    const face = el('div', 'noise-face', '🤫');
    const bar = el('div', 'noise-bar');
    const fill = el('span', 'noise-fill');
    bar.append(fill);
    const label = el('div', 'noise-label', 'أتعرف على هدوء الصف…');
    const ring = el('div', 'noise-quiet');
    const x = el('button', 'race-close', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'وقف مقياس الهدوء');
    x.addEventListener('click', () => { this.stop(); opts.onClose?.(); });
    root.append(x, face, bar, label, ring);
    this.parent.append(root);
    this.root = root;
    this.meter = new NoiseMeter({
      onEvent: opts.onEvent,
      paused: opts.paused,
      onLevel: (level, quiet, calibrating) => {
        fill.style.height = `${Math.round(level * 100)}%`;
        const state = level > 0.75 ? 'very' : level > 0.5 ? 'loud' : level > 0.3 ? 'mid' : 'calm';
        root.dataset.state = state;
        face.textContent = { calm: '😊', mid: '🙂', loud: '😮', very: '🙉' }[state];
        ring.style.setProperty('--p', String(quiet));
        if (!calibrating) label.textContent = `هدوء: ${ar(Math.round(quiet * QUIET_FOR_STAR_S / 60 * 10) / 10)} من ${ar(QUIET_FOR_STAR_S / 60)} دقايق للنجمة`;
      },
    });
    const ok = await this.meter.start();
    if (!ok) this.stop();
    return ok;
  }

  stop() {
    this.meter?.stop();
    this.meter = null;
    this.root?.remove();
    this.root = null;
  }

  get active() { return Boolean(this.meter?.active); }
}

// ------------------------------------------------------------------ camera panel

export class CameraPanel {
  /** @param {{solve: (image: string, mode: string) => Promise<any>, onResult: (res: any) => void, onOpen: () => void, onClose: () => void}} opts */
  constructor(opts, parent = document.body) {
    this.opts = opts;
    this.parent = parent;
    this.root = null;
  }

  get open() { return Boolean(this.root); }

  async show(mode = 'solve') {
    this.close();
    this.mode = mode;
    const root = el('section', 'panel fx-ui camera-panel');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'حل من الكاميرا');
    const title = el('h2', '', mode === 'solve' ? 'حل من الكاميرا' : 'شوف بالكاميرا');
    const video = el('video', 'camera-video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    const still = el('canvas', 'camera-still');
    still.hidden = true;
    const status = el('p', 'camera-status', 'وجّه الكاميرا على السؤال، وخل الإضاءة زينة.');
    const answer = el('div', 'camera-answer');
    answer.hidden = true;
    const row = el('div', 'row');
    const shoot = el('button', 'primary', mode === 'solve' ? '📸 صوّر وحل' : '📸 صوّر');
    shoot.type = 'button';
    const again = el('button', '', 'صورة ثانية');
    again.type = 'button';
    again.hidden = true;
    const close = el('button', '', 'سكّر');
    close.type = 'button';
    row.append(shoot, again, close);
    root.append(title, video, still, status, answer, row);
    this.parent.append(root);
    this.root = root;
    this.opts.onOpen?.();
    close.addEventListener('click', () => this.close());
    again.addEventListener('click', () => { still.hidden = true; video.hidden = false; answer.hidden = true; again.hidden = true; shoot.hidden = false; status.textContent = 'جاهز للصورة الجاية.'; });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }, audio: false });
      if (this.root !== root) { this.stopStream(); return; }
      video.srcObject = this.stream;
    } catch (err) {
      status.textContent = 'ما لقيت كاميرا، أو ما عندي إذن لها.';
      shoot.disabled = true;
      this.opts.onResult({ ok: false, reason: 'no_camera', error: String(err?.name || err) });
      return;
    }
    shoot.addEventListener('click', async () => {
      if (!video.videoWidth) return;
      const scale = Math.min(1, 1280 / video.videoWidth);
      still.width = Math.round(video.videoWidth * scale);
      still.height = Math.round(video.videoHeight * scale);
      still.getContext('2d').drawImage(video, 0, 0, still.width, still.height);
      const image = still.toDataURL('image/jpeg', 0.85).split(',')[1];
      video.hidden = true;
      still.hidden = false;
      shoot.hidden = true;
      status.textContent = mode === 'solve' ? 'خلفون يحل… (ثواني)' : 'خلفون يشوف…';
      root.classList.add('busy');
      const res = await this.opts.solve(image, mode);
      root.classList.remove('busy');
      if (this.root !== root) return;
      again.hidden = false;
      if (res?.ok) {
        status.textContent = res.saved ? 'الحل محفوظ في الدفتر.' : '';
        answer.textContent = res.text;
        answer.hidden = false;
      } else {
        status.textContent = res?.error === 'no_cloud' ? 'قراءة الصور تحتاج مفتاح Gemini أو Claude (الإعدادات ← السرعة والذكاء).' : 'ما قدرت أقرأ الصورة. قرّبها وجرب مرة ثانية.';
      }
      this.opts.onResult(res?.ok ? { ok: true, text: res.text, saved: res.saved } : { ok: false, reason: res?.error === 'no_cloud' ? 'no_cloud' : 'failed', error: res?.error });
    });
  }

  stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  close() {
    this.stopStream();
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.opts.onClose?.();
  }
}

// ------------------------------------------------------------------ voice test

/** Sentences a teacher really says, with what Khalfoun should understand from each. */
export const VOICE_TEST = [
  ['افتح الحاسبة', 'open'], ['ارفع الصوت', 'volume'], ['كم الساعة', 'time'], ['اختار طالب', 'pick_student'],
  ['شغل مؤقت خمس دقايق', 'timer'], ['سكر الوورد', 'close'], ['قول نكتة', 'joke'], ['دور عن الطقس في مسقط', 'search'],
  ['ذكرني بعد عشر دقايق بالاجتماع', 'reminder'], ['نجمة للصف', 'class_star'], ['عطني لغز', 'riddle'], ['قسمهم أربع مجموعات', 'groups'],
];

export class VoiceTestPanel {
  /**
   * @param {{record: () => Promise<{wav: Uint8Array, spoke: boolean}>, transcribe: (wav: Uint8Array) => Promise<any>,
   *   recognize: (text: string) => {intent: string}, onDone: (score: number, avgS: number) => void, onOpen: () => void, onClose: () => void, note?: (t: string) => void}} opts
   */
  constructor(opts, parent = document.body) {
    this.opts = opts;
    this.parent = parent;
    this.root = null;
  }

  get open() { return Boolean(this.root); }

  show() {
    this.close();
    this.i = 0;
    this.results = [];
    const root = el('section', 'panel fx-ui voice-test');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'اختبار السمع');
    root.append(el('h2', '', 'اختبار السمع'));
    root.append(el('p', 'lead', 'اقرأ كل جملة بصوتك العادي من مكانك في الصف. خلفون يقيس كم يفهم، وكم ياخذ وقت.'));
    this.counter = el('p', 'vt-count');
    this.phrase = el('p', 'vt-phrase');
    this.heard = el('p', 'vt-heard');
    const row = el('div', 'row');
    this.rec = el('button', 'primary', '🎤 سجّل');
    this.rec.type = 'button';
    this.skip = el('button', '', 'تخطّ');
    this.skip.type = 'button';
    const close = el('button', '', 'سكّر');
    close.type = 'button';
    row.append(this.rec, this.skip, close);
    this.list = el('ol', 'vt-list');
    root.append(this.counter, this.phrase, this.heard, row, this.list);
    this.parent.append(root);
    this.root = root;
    this.opts.onOpen?.();
    close.addEventListener('click', () => this.close());
    this.skip.addEventListener('click', () => this.record(true));
    this.rec.addEventListener('click', () => this.record(false));
    this.render();
  }

  render() {
    const [text] = VOICE_TEST[this.i] || [];
    this.counter.textContent = `جملة ${ar(this.i + 1)} من ${ar(VOICE_TEST.length)}`;
    this.phrase.textContent = text ? `«${text}»` : '';
  }

  async record(skip) {
    if (this.busy || !this.root) return;
    const [text, intent] = VOICE_TEST[this.i];
    let ok = false;
    let heard = '';
    let secs = 0;
    if (!skip) {
      this.busy = true;
      this.rec.disabled = true;
      this.rec.textContent = '🔴 أسمعك…';
      try {
        const { wav, spoke } = await this.opts.record();
        if (!this.root) return;
        if (spoke) {
          this.rec.textContent = '… يفكر';
          const t0 = performance.now();
          const res = await this.opts.transcribe(wav);
          secs = (performance.now() - t0) / 1000;
          heard = res?.ok ? res.text || '' : '';
          ok = Boolean(heard) && this.opts.recognize(heard).intent === intent;
        }
      } catch { /* the mic failed: counts as not understood */ } finally {
        this.busy = false;
        if (this.rec) { this.rec.disabled = false; this.rec.textContent = '🎤 سجّل'; }
      }
    }
    if (!this.root) return;
    this.results.push({ text, heard, ok, secs, skip });
    this.opts.note?.(`voice test: «${text}» → «${heard}» ${ok ? 'ok' : skip ? 'skipped' : 'wrong'} (${secs.toFixed(1)} s)`);
    const li = el('li', ok ? 'ok' : skip ? 'skip' : 'bad');
    li.textContent = `${ok ? '✓' : skip ? '–' : '✗'} ${text}${heard && !ok ? ` ← سمعت: «${heard}»` : ''}${secs ? ` (${ar(secs.toFixed(1))} ث)` : ''}`;
    this.list.append(li);
    this.heard.textContent = skip ? '' : heard ? `سمعت: «${heard}»` : 'ما سمعت كلام واضح.';
    this.i += 1;
    if (this.i >= VOICE_TEST.length) this.finish();
    else this.render();
  }

  finish() {
    const tried = this.results.filter((r) => !r.skip);
    const right = tried.filter((r) => r.ok).length;
    const score = tried.length ? Math.round((right / tried.length) * 100) : 0;
    const timed = tried.filter((r) => r.secs);
    const avg = timed.length ? timed.reduce((n, r) => n + r.secs, 0) / timed.length : 0;
    this.counter.textContent = 'خلص الاختبار';
    this.phrase.textContent = `فهمت ${ar(score)}٪ · متوسط الوقت ${ar(avg.toFixed(1))} ثانية`;
    const tips = [];
    if (avg > 4) tips.push('السمع بطيء على هالجهاز: فعّل Azure أو Gemini من «السرعة والذكاء».');
    if (score < 80) tips.push('جرّب مايك أقرب (سماعة بمايك أو مايك USB)، وقلّل الضجة حوله.');
    if (!tips.length) tips.push('ممتاز! تقدر تعتمد على الأوامر الصوتية.');
    this.heard.textContent = tips.join(' ');
    this.rec.hidden = true;
    this.skip.hidden = true;
    this.opts.onDone(score, avg);
  }

  close() {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.opts.onClose?.();
  }
}
