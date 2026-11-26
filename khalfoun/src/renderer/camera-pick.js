// «اختار طالب بالكاميرا»: a photo of the class (from the teacher's phone or the computer's
// camera) → Khalfoun finds every face on this computer → a light scans them, jumps from face to
// face slowing down like a wheel, lands on one student and zooms in. Fair: a student already
// chosen this lesson is not chosen again while others are left. The photo never leaves the PC.

import { findFaces, chooseFace, sureFaces, YUNET_SIZE } from '../core/faces.js';

const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LESSON_MS = 60 * 60000;

export class CameraPick {
  /**
   * @param {{session: () => Promise<object>, Tensor: () => Function, onOpen?: Function, onClose?: Function,
   *   say?: (t: string) => void, cue?: (name: string) => void, celebrate?: () => void, level?: () => string, note?: Function}} deps
   */
  constructor(deps, parent = document.body) {
    this.d = deps;
    this.parent = parent;
    this.root = null;
    this.picked = []; // {x, y, at}: places chosen this lesson, as fractions of the photo
    this.faces = [];
    this.photo = null;
  }

  get open() { return Boolean(this.root); }

  /** Pixels of a view of the photo, letterboxed into 640×640, as YuNet wants them (BGR planes). */
  pixelsOf(bitmap) {
    const c = document.createElement('canvas'); c.width = YUNET_SIZE; c.height = YUNET_SIZE;
    const x = c.getContext('2d', { willReadFrequently: true });
    return (v) => {
      const s = YUNET_SIZE / Math.max(v.w, v.h);
      x.fillStyle = '#000'; x.fillRect(0, 0, YUNET_SIZE, YUNET_SIZE);
      x.drawImage(bitmap, v.x, v.y, v.w, v.h, 0, 0, Math.round(v.w * s), Math.round(v.h * s));
      const d = x.getImageData(0, 0, YUNET_SIZE, YUNET_SIZE).data;
      const P = YUNET_SIZE * YUNET_SIZE;
      const out = new Float32Array(3 * P);
      for (let i = 0, j = 0; i < P; i += 1, j += 4) { out[i] = d[j + 2]; out[P + i] = d[j + 1]; out[2 * P + i] = d[j]; }
      return { data: out, scale: s };
    };
  }

  /**
   * @param {{blob?: Blob, image?: string}} src a photo (from the phone) or a data URL (a camera frame)
   */
  async pick(src) {
    this.close();
    const url = src.blob ? URL.createObjectURL(src.blob) : src.image;
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { this.d.say?.('ما قدرت أفتح الصورة.'); return null; }
    this.show(img);
    this.status('👀 أدوّر الوجوه…');
    const t0 = performance.now();
    let faces = [];
    try {
      const bitmap = await createImageBitmap(img);
      const session = await this.d.session();
      faces = await findFaces(session, { width: bitmap.width, height: bitmap.height, pixels: this.pixelsOf(bitmap) }, { level: this.d.level?.() || 'high', Tensor: this.d.Tensor() });
    } catch (err) {
      this.d.note?.(`camera pick failed: ${err?.message || err}`);
      this.status('ما قدرت أشوف الوجوه في هالصورة.');
      return null;
    }
    this.d.note?.(`camera pick: ${faces.length} faces (${sureFaces(faces).length} sure) in ${Math.round(performance.now() - t0)} ms`);
    if (!this.root) return null;
    this.photo = { width: img.naturalWidth, height: img.naturalHeight };
    this.faces = sureFaces(faces);
    if (!this.faces.length) {
      this.status('ما شفت وجوه واضحة 🤔 قرّب شوي أو زيد الإضاءة، أو ارفع الحساسية من الإعدادات.');
      return null;
    }
    return this.run();
  }

  show(img) {
    const root = el('section', 'camera-pick');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'اختيار طالب بالكاميرا');
    const head = el('div', 'cp-head');
    head.append(el('h2', '', '🎯 مين عليه الدور؟'));
    this.statusEl = el('p', 'cp-status');
    this.statusEl.setAttribute('role', 'status');
    head.append(this.statusEl);
    const stage = el('div', 'cp-stage');
    const frame = el('div', 'cp-frame');
    img.className = 'cp-photo';
    img.alt = '';
    frame.append(img);
    this.layer = el('div', 'cp-layer');
    frame.append(this.layer);
    stage.append(frame);
    const row = el('div', 'cp-row');
    this.again = el('button', 'cp-btn', '🔁 غيره');
    this.again.type = 'button';
    this.again.hidden = true;
    this.again.addEventListener('click', () => this.run());
    const close = el('button', 'cp-btn ghost', '✕ سكّر');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    row.append(this.again, close);
    root.append(head, stage, row);
    this.parent.append(root);
    this.root = root;
    this.frame = frame;
    this.img = img;
    this.d.onOpen?.();
  }

  status(t) { if (this.statusEl) this.statusEl.textContent = t; }

  /** Where a face sits on the shown photo, in % (so it follows any size). */
  place(f) {
    return { left: (f.x / this.photo.width) * 100, top: (f.y / this.photo.height) * 100, w: (f.w / this.photo.width) * 100, h: (f.h / this.photo.height) * 100 };
  }

  async run() {
    if (!this.root || !this.faces.length) return null;
    const token = (this.token = (this.token || 0) + 1);
    this.again.hidden = true;
    this.frame.style.transform = '';
    this.frame.classList.remove('zoomed');
    this.layer.replaceChildren();
    this.picked = this.picked.filter((p) => Date.now() - p.at < LESSON_MS);
    const n = this.faces.length;
    this.status(`شفت ${n.toLocaleString('ar-EG')} ${n === 1 ? 'وجه' : n === 2 ? 'وجهين' : n <= 10 ? 'وجوه' : 'وجه'}… 🥁`);
    // every face lights up, a sweep from right to left (the way we read)
    const rings = this.faces.map((f) => {
      const p = this.place(f);
      const r = el('div', 'cp-ring');
      Object.assign(r.style, { left: `${p.left}%`, top: `${p.top}%`, width: `${p.w}%`, height: `${p.h}%` });
      if (this.picked.some((q) => Math.hypot((f.x + f.w / 2) / this.photo.width - q.x, (f.y + f.h / 2) / this.photo.height - q.y) < 0.06)) r.classList.add('done');
      this.layer.append(r);
      return r;
    });
    const order = this.faces.map((f, i) => [i, f.x]).sort((a, b) => b[1] - a[1]).map(([i]) => i);
    for (let k = 0; k < order.length; k += 1) {
      rings[order[k]].classList.add('seen');
      if (k % Math.max(1, Math.round(order.length / 25)) === 0) await wait(30);
      if (token !== this.token) return null;
    }
    await wait(250);
    // the light jumps from face to face, slowing down, and stops on the chosen one
    const chosen = chooseFace(this.faces, this.picked, { width: this.photo.width, height: this.photo.height });
    const target = this.faces.indexOf(chosen);
    const hops = Math.min(22, 8 + n);
    let last = -1;
    for (let h = 0; h < hops; h += 1) {
      let i;
      if (h === hops - 1) i = target;
      else { do { i = Math.floor(Math.random() * n); } while (n > 2 && (i === last || i === target)); }
      if (last >= 0) rings[last].classList.remove('lit');
      rings[i].classList.add('lit');
      this.d.cue?.('tick');
      last = i;
      await wait(55 + (h / hops) ** 2.4 * 520);
      if (token !== this.token) return null;
    }
    // zoom on the chosen student
    const c = this.place(chosen);
    const cx = c.left + c.w / 2; const cy = c.top + c.h / 2;
    const zoom = Math.max(1.6, Math.min(4, 22 / Math.max(c.w, c.h)));
    this.frame.style.transformOrigin = `${cx}% ${cy}%`;
    this.frame.classList.add('zoomed');
    this.frame.style.transform = `scale(${zoom})`;
    rings[target].classList.add('chosen');
    this.picked.push({ x: (chosen.x + chosen.w / 2) / this.photo.width, y: (chosen.y + chosen.h / 2) / this.photo.height, at: Date.now() });
    this.d.cue?.('win');
    this.d.celebrate?.();
    const left = this.faces.filter((f) => !this.picked.some((q) => Math.hypot((f.x + f.w / 2) / this.photo.width - q.x, (f.y + f.h / 2) / this.photo.height - q.y) < 0.06)).length;
    this.status(left ? `أنت! 👏 (باقي ${left.toLocaleString('ar-EG')} ما جاهم الدور)` : 'أنت! 👏 (كلكم جاكم الدور، نبدأ من جديد)');
    if (!left) this.picked = [];
    this.d.say?.('جاء دورك يا بطل!');
    this.again.hidden = false;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), 20000);
    return chosen;
  }

  close() {
    clearTimeout(this.idle);
    this.token = (this.token || 0) + 1;
    if (!this.root) return;
    if (this.img?.src?.startsWith('blob:')) URL.revokeObjectURL(this.img.src);
    this.root.remove();
    this.root = null;
    this.d.onClose?.();
  }
}
