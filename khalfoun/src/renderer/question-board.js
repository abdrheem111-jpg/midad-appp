// The question board: a question taken from anywhere on the screen (a PDF, a website, the book)
// and put alone on a clean white page, big and easy to read, with room under it to explain and
// solve — the pen, the steps and the graphs all work on top of it.
//
//   «شل السؤال» → the teacher draws a rectangle round the question → it goes on the board.
//   «اكتبه نظيف» → Claude retypes it in clear large type (Arabic maths notation).

const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

export class QuestionBoard {
  /**
   * @param {{grab: (r: {x: number, y: number, w: number, h: number}) => Promise<{ok: boolean, image?: string}>,
   *   write?: (t: string) => string, pen?: (on: boolean) => void, retype?: (image: string) => void,
   *   onOpen?: Function, onClose?: Function, note?: Function}} d
   */
  constructor(parent, d) { this.parent = parent; this.d = d; this.root = null; this.picker = null; this.zoom = 1; this.image = null; this.text = ''; }

  get open() { return Boolean(this.root); }
  get picking() { return Boolean(this.picker); }

  /** Lets the teacher draw a rectangle round the question. Resolves with the board shown (or false). */
  pick() {
    this.cancelPick();
    return new Promise((resolve) => {
      const layer = el('div', 'qb-pick fx-ui');
      const hint = el('div', 'qb-pick-hint', 'ارسم مربع حول السؤال بالماوس ✍️  (Esc للإلغاء)');
      const box = el('div', 'qb-pick-box');
      layer.append(hint, box);
      this.parent.append(layer);
      this.picker = { layer, resolve };
      this.d.onOpen?.();
      let start = null;
      layer.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; layer.setPointerCapture(e.pointerId); Object.assign(box.style, { left: `${start.x}px`, top: `${start.y}px`, width: '0px', height: '0px', display: 'block' }); });
      layer.addEventListener('pointermove', (e) => {
        if (!start) return;
        const x = Math.min(start.x, e.clientX); const y = Math.min(start.y, e.clientY);
        Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(e.clientX - start.x)}px`, height: `${Math.abs(e.clientY - start.y)}px` });
      });
      layer.addEventListener('pointerup', async (e) => {
        if (!start) return;
        const r = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
        start = null;
        this.cancelPick(false);
        if (r.w < 20 || r.h < 14) { resolve(false); this.d.onClose?.(); return; }
        const res = await this.d.grab(r);
        if (!res?.ok || !res.image) { resolve(false); this.d.onClose?.(); return; }
        resolve(this.show({ image: res.image }));
      });
    });
  }

  cancelPick(tell = true) {
    if (!this.picker) return;
    const p = this.picker; this.picker = null;
    p.layer.remove();
    if (tell) { p.resolve(false); this.d.onClose?.(); }
  }

  /** @param {{image?: string, text?: string, title?: string}} q */
  show(q) {
    if (!q?.image && !q?.text) return false;
    const keep = this.open;
    if (q.image) this.image = q.image;
    if (q.text !== undefined) this.text = String(q.text || '').slice(0, 1500);
    if (!q.text && q.image) this.text = '';
    if (q.title !== undefined) this.title = String(q.title || '').slice(0, 60);
    if (!keep) { this.zoom = 1; this.root = el('section', 'qboard'); this.parent.append(this.root); this.d.onOpen?.(); }
    this.render();
    this.d.note?.(`question board: ${this.text ? 'typed' : 'picture'}`);
    return true;
  }

  render() {
    const r = this.root;
    r.textContent = '';
    const bar = el('div', 'qboard-bar fx-ui');
    const btn = (label, title, fn) => { const b = el('button', '', label); b.type = 'button'; b.title = title; b.addEventListener('click', fn); bar.append(b); return b; };
    btn('✎ قلم', 'اكتب واشرح بالقلم', () => this.d.pen?.(true));
    btn('＋', 'كبّر السؤال', () => { this.zoom = Math.min(2.2, this.zoom + 0.2); this.render(); });
    btn('－', 'صغّر السؤال', () => { this.zoom = Math.max(0.5, this.zoom - 0.2); this.render(); });
    if (this.image && this.d.retype) btn('🔤 اكتبه نظيف', 'خلفون يكتب السؤال بخط واضح', () => this.d.retype(this.image));
    if (this.text && this.image) btn('🖼 الصورة', 'رجّع صورة السؤال', () => { this.text = ''; this.render(); });
    const x = btn('✕', 'سكّر السبورة', () => this.close()); x.className = 'qboard-x';
    const q = el('div', 'qboard-q');
    if (this.title) q.append(el('div', 'qboard-title', this.title));
    if (this.text) {
      const t = el('div', 'qboard-text');
      t.style.fontSize = `${Math.round(44 * this.zoom)}px`;
      for (const line of this.text.split(/\n/)) t.append(el('p', '', this.d.write ? this.d.write(line) : line));
      q.append(t);
    } else if (this.image) {
      const img = el('img', 'qboard-img');
      img.src = this.image; img.alt = 'السؤال';
      img.style.maxHeight = `${Math.round(42 * this.zoom)}vh`;
      img.style.maxWidth = `${Math.min(96, Math.round(78 * this.zoom))}vw`;
      q.append(img);
    }
    r.append(bar, q, el('div', 'qboard-space'));
  }

  close() {
    this.cancelPick(false);
    if (!this.root) return;
    this.root.remove(); this.root = null;
    this.d.pen?.(false);
    this.d.onClose?.();
  }
}
