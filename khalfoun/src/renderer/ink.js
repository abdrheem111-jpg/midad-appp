// Writing and drawing on the screen itself, like a pen on a Samsung tablet: Khalfoun writes
// words and maths in a marker hand, draws shapes and circles, and in pen mode the teacher
// draws with the mouse (colours, highlighter, eraser, undo). Everything stays until cleared.

import { SHAPES, COLORS } from '../core/office-plan.js';
import { mathRuns, tickText, MARK } from '../core/math-sketch.js';

const HAS_MARK = new RegExp(`[${MARK.supOpen}${MARK.subOpen}]`);
const SMALL = 0.62; // raised/lowered pieces (powers, indices) are this much of the text size

/** Width of a line of screen maths at the current font (powers drawn small). */
export function mathWidth(ctx, text, size) {
  if (!HAS_MARK.test(text)) return ctx.measureText(text).width;
  const font = ctx.font;
  let w = 0;
  for (const r of mathRuns(text)) {
    ctx.font = r.kind === 'base' ? font : font.replace(/\d+px/, `${Math.round(size * SMALL)}px`);
    w += ctx.measureText(r.text).width;
  }
  ctx.font = font;
  return w;
}

/**
 * Draws a line of screen maths centred on (x, y), right to left as Arabic is written: a power sits
 * small and raised on the left of its base (س٢), an index small and lowered. `paint(text, x, y)`
 * does the actual stroke/fill at the current font with textAlign 'right'.
 */
export function paintMath(ctx, text, x, y, size, paint) {
  if (!HAS_MARK.test(text)) { ctx.textAlign = 'center'; paint(text, x, y); return; }
  const font = ctx.font;
  const align = ctx.textAlign;
  const total = mathWidth(ctx, text, size);
  let right = x + total / 2;
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  for (const r of mathRuns(text)) {
    const small = r.kind !== 'base';
    ctx.font = small ? font.replace(/\d+px/, `${Math.round(size * SMALL)}px`) : font;
    const w = ctx.measureText(r.text).width;
    paint(r.text, right, y + (r.kind === 'sup' ? -size * 0.38 : r.kind === 'sub' ? size * 0.3 : 0));
    right -= w;
  }
  ctx.font = font;
  ctx.textAlign = align;
}

const PEN_COLORS = [
  ['red', '#E63946'], ['blue', '#1D70B8'], ['green', '#2A9D5C'], ['black', '#222222'], ['yellow', '#F4C430'], ['white', '#FFFFFF'],
];

const jitter = (seed) => {
  let s = seed || 1;
  return () => { s = (s * 16807) % 2147483647; return (s / 2147483647) - 0.5; };
};

export class InkLayer {
  /** @param {{onChange?: (on: boolean) => void, parent?: HTMLElement}} [opts] */
  constructor(opts = {}) {
    const parent = opts.parent || document.body;
    this.onChange = opts.onChange || (() => {});
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ink-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.items = []; // everything drawn: strokes, texts and shapes, for undo and redraw
    this.pen = false;
    this.color = '#E63946';
    this.width = 5;
    this.tool = 'pen'; // pen | marker | eraser
    this.nextY = 0.18; // where the next written line goes (fraction of the height)
    this.pointer = null;
    this.anim = 0;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.bindPointer();
  }

  get hasInk() { return this.items.length > 0; }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  /** The mouse position (the overlay sees it even when clicks pass through). */
  setPointer(x, y) { this.pointer = { x, y }; }

  // ------------------------------------------------------------ voice: write and draw

  /** Writes a line in a marker hand; maths keeps its symbols. Animated like real writing. */
  /**
   * Writes on the screen. `at` {x, y}: the top-right corner of the text (Arabic starts on the
   * right), in overlay pixels — the Claude mind places writing exactly there.
   */
  write(text, { color = '#1D70B8', size = 0, at = null, anchor = 'right' } = {}) {
    const t = String(text || '').trim().slice(0, 300);
    if (!t) return null;
    const hex = COLORS[color] ? `#${COLORS[color].hex}` : (/^#[0-9a-f]{6}$/i.test(color) ? color : '#1D70B8');
    const fontSize = size || Math.max(36, Math.min(72, Math.round(this.w / (Math.max(8, t.length) * 0.9))));
    let x = this.w / 2;
    let y;
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      this.ctx.save();
      this.ctx.font = `700 ${fontSize}px 'Tajawal', 'Segoe UI', sans-serif`;
      const width = mathWidth(this.ctx, t, fontSize);
      this.ctx.restore();
      const cx = anchor === 'center' ? at.x : Math.min(this.w - 4, at.x) - width / 2;
      x = Math.max(width / 2 + 4, Math.min(this.w - width / 2 - 4, cx));
      y = Math.max(fontSize * 0.6, anchor === 'center' ? at.y + fontSize * 0.3 : at.y + fontSize * 0.6);
    } else {
      y = this.nextY * this.h;
      this.nextY = this.nextY + (fontSize * 1.5) / this.h;
      if (this.nextY > 0.8) this.nextY = 0.18;
    }
    const item = { kind: 'text', text: t, x, y, size: fontSize, color: hex, reveal: 0 };
    this.items.push(item);
    this.show();
    this.animate(item);
    return item;
  }

  /**
   * Draws shapes in a hand-drawn style. `at`: 'pointer' puts it where the mouse is
   * (a circle «على هذا»), otherwise the middle of the screen.
   */
  draw({ shape = 'circle', color = 'red', count = 1, text = '', at = null, outline = false, box = null }) {
    const hex = `#${COLORS[color]?.hex || COLORS.red.hex}`;
    if (box && box.w > 0 && box.h > 0) {
      // A shape exactly in a box the Claude mind chose.
      const item = { kind: 'shape', shape: SHAPES[shape] ? shape : 'circle', x: box.x + box.w / 2, y: box.y + box.h / 2, size: Math.min(box.w, box.h), color: hex, text, outline, seed: Math.floor(Math.random() * 1e6), reveal: 0 };
      this.items.push(item);
      this.animate(item);
      this.show();
      return [item];
    }
    const n = Math.max(1, Math.min(12, count));
    const size = Math.min(220, (this.w * 0.7) / n);
    const cy = at === 'pointer' && this.pointer ? this.pointer.y : this.h * 0.5;
    const cx0 = at === 'pointer' && this.pointer ? this.pointer.x : this.w / 2;
    const span = n * size * 1.15;
    const added = [];
    for (let i = 0; i < n; i += 1) {
      const cx = n === 1 ? cx0 : cx0 + span / 2 - (i + 0.5) * size * 1.15; // right to left
      const item = { kind: 'shape', shape: SHAPES[shape] ? shape : 'circle', x: cx, y: cy, size: at === 'pointer' ? 140 : size, color: hex, text, outline: outline || at === 'pointer', seed: Math.floor(Math.random() * 1e6), reveal: 0 };
      this.items.push(item);
      added.push(item);
      this.animate(item);
    }
    this.show();
    return added;
  }

  /**
   * Marks words found on the screen exactly where they are: a hand-drawn oval around them,
   * a line under them, or a highlighter stroke over them. Boxes are in overlay pixels.
   */
  mark(boxes, { mark = 'circle', color = 'red' } = {}) {
    const hex = `#${COLORS[color]?.hex || COLORS.red.hex}`;
    const added = [];
    for (const b of (boxes || []).slice(0, 8)) {
      if (!(b.w > 0 && b.h > 0)) continue;
      const item = { kind: 'mark', mark, x: b.x, y: b.y, w: b.w, h: b.h, color: hex, seed: Math.floor(Math.random() * 1e6), reveal: 0 };
      this.items.push(item);
      added.push(item);
      this.animate(item);
    }
    if (added.length) this.show();
    return added;
  }

  /**
   * A maths drawing from the Claude mind (core/math-sketch cleanSketch output, overlay
   * pixels): drawn piece by piece, like a teacher at the board.
   */
  sketch(shapes, { color = 'blue' } = {}) {
    if (!Array.isArray(shapes) || !shapes.length) return null;
    const hex = COLORS[color] ? `#${COLORS[color].hex}` : (/^#[0-9a-f]{6}$/i.test(color) ? color : `#${COLORS.blue.hex}`);
    const item = { kind: 'sketch', shapes, color: hex, reveal: 0 };
    this.items.push(item);
    this.animate(item, Math.min(2200, 350 + shapes.length * 220));
    this.show();
    return item;
  }

  clear() {
    this.items = [];
    this.nextY = 0.18;
    this.redraw();
    if (!this.pen) this.canvas.classList.remove('on');
  }

  undo() {
    this.items.pop();
    this.redraw();
  }

  show() { this.canvas.classList.add('on'); }

  animate(item, ms = 0) {
    const start = performance.now();
    const dur = ms || (item.kind === 'text' ? Math.min(1600, 300 + item.text.length * 60) : 700);
    const step = (t) => {
      item.reveal = Math.min(1, (t - start) / dur);
      this.redraw();
      if (item.reveal < 1 && this.items.includes(item)) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ pen mode (the teacher draws)

  setPen(on) {
    this.pen = Boolean(on);
    this.canvas.classList.toggle('pen', this.pen);
    this.canvas.classList.toggle('fx-ui', this.pen);
    if (this.pen) { this.show(); this.toolbar(); } else { this.bar?.remove(); this.bar = null; if (!this.items.length) this.canvas.classList.remove('on'); }
    this.onChange(this.pen);
  }

  /** «لون القلم أزرق», «قلم عريض»: the pen changes by voice; the toolbar shows the choice. */
  setStyle({ color, width } = {}) {
    if (color && COLORS[color]) { this.color = `#${COLORS[color].hex}`; this.tool = 'pen'; if (this.width > 12) this.width = 5; }
    if (width) this.width = Math.max(2, Math.min(40, width));
    if (this.bar) { this.bar.remove(); this.bar = null; if (this.pen) this.toolbar(); }
  }

  toolbar() {
    if (this.bar) return;
    const bar = document.createElement('div');
    bar.className = 'fx-ui ink-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'قلم الشاشة');
    const btn = (label, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ink-btn ${cls}`;
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', fn);
      bar.append(b);
      return b;
    };
    const pick = (b) => { for (const x of bar.querySelectorAll('.ink-btn.sel')) x.classList.remove('sel'); b.classList.add('sel'); };
    const colors = PEN_COLORS.some(([, hex]) => hex.toUpperCase() === this.color.toUpperCase())
      ? PEN_COLORS : [...PEN_COLORS, ['', this.color]]; // a colour asked by voice gets its own swatch
    for (const [name, hex] of colors) {
      const b = btn('', name || 'اللون المختار', () => { this.color = hex; this.tool = 'pen'; this.width = 5; pick(b); }, 'swatch');
      b.style.setProperty('--c', hex);
      if (this.tool === 'pen' && hex.toUpperCase() === this.color.toUpperCase()) b.classList.add('sel');
    }
    const marker = btn('🖍', 'قلم تظليل', () => { this.tool = 'marker'; this.width = 26; pick(marker); });
    const eraser = btn('🧽', 'ممحاة', () => { this.tool = 'eraser'; this.width = 34; pick(eraser); });
    btn('↶', 'تراجع', () => this.undo());
    btn('🗑', 'امسح الكل', () => this.clear());
    btn('✕', 'وقف القلم', () => this.setPen(false), 'close');
    document.body.append(bar);
    this.bar = bar;
  }

  bindPointer() {
    let stroke = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.pen) return;
      this.canvas.setPointerCapture(e.pointerId);
      stroke = { kind: 'stroke', tool: this.tool, color: this.color, width: this.width, points: [[e.clientX, e.clientY]] };
      this.items.push(stroke);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      this.setPointer(e.clientX, e.clientY);
      if (!stroke) return;
      stroke.points.push([e.clientX, e.clientY]);
      this.redraw();
    });
    const end = () => { stroke = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  // ------------------------------------------------------------ drawing

  redraw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    for (const it of this.items) {
      if (it.kind === 'stroke') this.drawStroke(it);
      else if (it.kind === 'text') this.drawText(it);
      else if (it.kind === 'shape') this.drawShape(it);
      else if (it.kind === 'mark') this.drawMark(it);
      else if (it.kind === 'sketch') this.drawSketch(it);
    }
  }

  drawSketch(item) {
    const { ctx } = this;
    const n = item.shapes.length;
    const shown = item.reveal * n;
    const colorOf = (sh) => (COLORS[sh.color] ? `#${COLORS[sh.color].hex}` : (/^#[0-9a-f]{6}$/i.test(sh.color || '') ? sh.color : item.color));
    const font = (size) => `700 ${Math.round(size)}px 'Tajawal', 'Segoe UI', 'Cambria Math', sans-serif`;
    const label = (text, x, y, size, color) => {
      if (!text) return;
      ctx.save();
      ctx.font = font(size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, size / 7);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.fillStyle = color;
      ctx.lineJoin = 'round';
      paintMath(ctx, text, x, y, size, (tt, xx, yy) => { ctx.strokeText(tt, xx, yy); ctx.fillText(tt, xx, yy); });
      ctx.restore();
    };
    const arrowHead = (x1, y1, x2, y2, w) => {
      const a = Math.atan2(y2 - y1, x2 - x1); const l = Math.max(10, w * 4);
      ctx.beginPath();
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - l * Math.cos(a - 0.45), y2 - l * Math.sin(a - 0.45));
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - l * Math.cos(a + 0.45), y2 - l * Math.sin(a + 0.45));
      ctx.stroke();
    };
    for (let i = 0; i < n; i += 1) {
      if (i >= shown) break;
      const part = Math.min(1, shown - i); // the piece being drawn now
      const sh = item.shapes[i];
      const color = colorOf(sh);
      const w = sh.width || 4;
      ctx.save();
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (sh.dashed) ctx.setLineDash([w * 3, w * 2.5]);
      switch (sh.type) {
        case 'point':
          ctx.beginPath(); ctx.arc(sh.x, sh.y, Math.max(4, sh.size / 2) * part, 0, Math.PI * 2); ctx.fill();
          label(sh.label, sh.x + 16, sh.y - 18, 26, color);
          break;
        case 'line': {
          const x2 = sh.x1 + (sh.x2 - sh.x1) * part; const y2 = sh.y1 + (sh.y2 - sh.y1) * part;
          ctx.beginPath(); ctx.moveTo(sh.x1, sh.y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.setLineDash([]);
          if (part === 1 && (sh.arrow === 'end' || sh.arrow === 'both')) arrowHead(sh.x1, sh.y1, sh.x2, sh.y2, w);
          if (part === 1 && (sh.arrow === 'start' || sh.arrow === 'both')) arrowHead(sh.x2, sh.y2, sh.x1, sh.y1, w);
          if (part === 1) label(sh.label, (sh.x1 + sh.x2) / 2, (sh.y1 + sh.y2) / 2 - 20, 24, color);
          break;
        }
        case 'circle':
          ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * part); ctx.stroke();
          if (part === 1) label(sh.label, sh.x, sh.y - sh.r - 20, 24, color);
          break;
        case 'rect':
          ctx.globalAlpha = part; ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
          break;
        case 'polygon': case 'curve': {
          const pts = sh.points; const segs = sh.closed ? pts.length : pts.length - 1;
          const upto = segs * part;
          ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
          if (sh.type === 'curve' && pts.length > 2) {
            for (let k = 1; k < pts.length && k <= upto + 1; k += 1) {
              const pm = pts[k - 1]; const pk = pts[k];
              ctx.quadraticCurveTo(pm.x, pm.y, (pm.x + pk.x) / 2, (pm.y + pk.y) / 2);
            }
          } else {
            for (let k = 1; k <= segs && k <= Math.ceil(upto); k += 1) {
              const a = pts[k - 1]; const b = pts[k % pts.length]; const f = Math.min(1, upto - (k - 1));
              ctx.lineTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
            }
          }
          ctx.stroke();
          if (part === 1) {
            const cx = pts.reduce((t, p) => t + p.x, 0) / pts.length; const cy = pts.reduce((t, p) => t + p.y, 0) / pts.length;
            sh.labels.forEach((l, k) => {
              const p = pts[k]; const dx = p.x - cx; const dy = p.y - cy; const d = Math.hypot(dx, dy) || 1;
              label(l, p.x + (dx / d) * 22, p.y + (dy / d) * 22, 26, color);
            });
          }
          break;
        }
        case 'angle': {
          const a1 = (-sh.from * Math.PI) / 180; const a2 = (-sh.to * Math.PI) / 180;
          if (sh.right) {
            const s = sh.r * 0.6; const u = { x: Math.cos(a1), y: Math.sin(a1) }; const v = { x: Math.cos(a2), y: Math.sin(a2) };
            ctx.beginPath(); ctx.moveTo(sh.x + u.x * s, sh.y + u.y * s); ctx.lineTo(sh.x + (u.x + v.x) * s, sh.y + (u.y + v.y) * s); ctx.lineTo(sh.x + v.x * s, sh.y + v.y * s); ctx.stroke();
          } else {
            ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, a1, a1 + (a2 - a1) * part, a2 < a1); ctx.stroke();
          }
          if (part === 1) { const m = (a1 + a2) / 2; label(sh.label, sh.x + Math.cos(m) * (sh.r + 22), sh.y + Math.sin(m) * (sh.r + 22), 24, color); }
          break;
        }
        case 'text':
          ctx.globalAlpha = part; label(sh.text, sh.x, sh.y, sh.size, color);
          break;
        case 'fraction': {
          ctx.globalAlpha = part;
          ctx.font = font(sh.size);
          const wide = Math.max(mathWidth(ctx, sh.top, sh.size), mathWidth(ctx, sh.bottom, sh.size)) + 14;
          label(sh.top, sh.x, sh.y - sh.size * 0.62, sh.size, color);
          ctx.lineWidth = Math.max(3, sh.size / 12);
          ctx.beginPath(); ctx.moveTo(sh.x - wide / 2, sh.y); ctx.lineTo(sh.x + wide / 2, sh.y); ctx.stroke();
          label(sh.bottom, sh.x, sh.y + sh.size * 0.66, sh.size, color);
          break;
        }
        case 'axes': {
          ctx.lineWidth = 3; ctx.globalAlpha = part;
          ctx.beginPath(); ctx.moveTo(sh.x - sh.left, sh.y); ctx.lineTo(sh.x + sh.right, sh.y); ctx.moveTo(sh.x, sh.y + sh.down); ctx.lineTo(sh.x, sh.y - sh.up); ctx.stroke();
          arrowHead(sh.x - sh.left, sh.y, sh.x + sh.right, sh.y, 3); arrowHead(sh.x, sh.y + sh.down, sh.x, sh.y - sh.up, 3);
          ctx.lineWidth = 2;
          for (let k = -Math.floor(sh.left / sh.step); k <= Math.floor(sh.right / sh.step); k += 1) {
            if (!k) continue; const x = sh.x + k * sh.step;
            ctx.beginPath(); ctx.moveTo(x, sh.y - 6); ctx.lineTo(x, sh.y + 6); ctx.stroke();
            if (sh.labels) label(tickText(k, sh.digits), x, sh.y + 20, 16, color);
          }
          for (let k = -Math.floor(sh.down / sh.step); k <= Math.floor(sh.up / sh.step); k += 1) {
            if (!k) continue; const y = sh.y - k * sh.step;
            ctx.beginPath(); ctx.moveTo(sh.x - 6, y); ctx.lineTo(sh.x + 6, y); ctx.stroke();
            if (sh.labels) label(tickText(k, sh.digits), sh.x - 20, y, 16, color);
          }
          const ar = sh.digits === 'arabic';
          label(ar ? 'س' : 'x', sh.x + sh.right - 6, sh.y - 18, 20, color); label(ar ? 'ص' : 'y', sh.x + 30, sh.y - sh.up + 2, 20, color);
          break;
        }
        case 'numberline': {
          ctx.globalAlpha = part; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(sh.x1, sh.y); ctx.lineTo(sh.x2, sh.y); ctx.stroke();
          arrowHead(sh.x1, sh.y, sh.x2, sh.y, 3); arrowHead(sh.x2, sh.y, sh.x1, sh.y, 3);
          const count = Math.round((sh.to - sh.from) / sh.step);
          const px = (v) => sh.x1 + 18 + ((v - sh.from) / (sh.to - sh.from)) * (sh.x2 - sh.x1 - 36);
          ctx.lineWidth = 2;
          for (let k = 0; k <= count; k += 1) {
            const v = sh.from + k * sh.step; const x = px(v);
            ctx.beginPath(); ctx.moveTo(x, sh.y - 8); ctx.lineTo(x, sh.y + 8); ctx.stroke();
            label(tickText(v, sh.digits), x, sh.y + 24, 17, color);
          }
          for (const m of sh.marks) { ctx.beginPath(); ctx.arc(px(m), sh.y, 7, 0, Math.PI * 2); ctx.fill(); }
          break;
        }
        case 'check': {
          const s = sh.size; ctx.lineWidth = Math.max(5, s / 7);
          const pts = [[sh.x - s * 0.45, sh.y], [sh.x - s * 0.1, sh.y + s * 0.35], [sh.x + s * 0.5, sh.y - s * 0.4]];
          ctx.beginPath(); ctx.moveTo(...pts[0]);
          if (part > 0.4) ctx.lineTo(...pts[1]); else ctx.lineTo(pts[0][0] + (pts[1][0] - pts[0][0]) * part / 0.4, pts[0][1] + (pts[1][1] - pts[0][1]) * part / 0.4);
          if (part > 0.4) { const f = (part - 0.4) / 0.6; ctx.lineTo(pts[1][0] + (pts[2][0] - pts[1][0]) * f, pts[1][1] + (pts[2][1] - pts[1][1]) * f); }
          ctx.stroke();
          break;
        }
        case 'cross': {
          const s = sh.size * 0.4; ctx.lineWidth = Math.max(5, sh.size / 7);
          ctx.beginPath(); ctx.moveTo(sh.x - s, sh.y - s); ctx.lineTo(sh.x - s + 2 * s * Math.min(1, part * 2), sh.y - s + 2 * s * Math.min(1, part * 2));
          if (part > 0.5) { const f = (part - 0.5) * 2; ctx.moveTo(sh.x + s, sh.y - s); ctx.lineTo(sh.x + s - 2 * s * f, sh.y - s + 2 * s * f); }
          ctx.stroke();
          break;
        }
        default: break;
      }
      ctx.restore();
    }
  }

  drawMark(m) {
    const { ctx } = this;
    const rnd = jitter(m.seed);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (m.mark === 'highlight') {
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = m.color;
      const pad = Math.max(3, m.h * 0.15);
      ctx.fillRect(m.x + m.w + pad - (m.w + pad * 2) * m.reveal, m.y - pad, (m.w + pad * 2) * m.reveal, m.h + pad * 2); // right to left
    } else if (m.mark === 'underline') {
      ctx.strokeStyle = m.color;
      ctx.lineWidth = Math.max(3, m.h * 0.14);
      const y = m.y + m.h + Math.max(3, m.h * 0.2);
      const x0 = m.x + m.w + 4; const x1 = x0 - (m.w + 8) * m.reveal;
      ctx.beginPath();
      ctx.moveTo(x0, y + rnd() * 2);
      ctx.quadraticCurveTo((x0 + x1) / 2, y + 3 + rnd() * 2, x1, y + rnd() * 2);
      ctx.stroke();
    } else {
      // An oval a little bigger than the words, drawn in one go like a teacher's pen.
      ctx.strokeStyle = m.color;
      ctx.lineWidth = Math.max(3, Math.min(7, m.h * 0.13));
      const cx = m.x + m.w / 2; const cy = m.y + m.h / 2;
      const rx = m.w / 2 + Math.max(10, m.h * 0.45); const ry = m.h / 2 + Math.max(8, m.h * 0.4);
      const steps = 48; const total = Math.max(2, Math.round((steps + 6) * m.reveal));
      ctx.beginPath();
      for (let i = 0; i < total; i += 1) {
        const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
        const wob = 1 + rnd() * 0.04;
        const x = cx + Math.cos(a) * rx * wob; const y = cy + Math.sin(a) * ry * wob;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawStroke(s) {
    const { ctx } = this;
    if (s.points.length < 1) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s.width;
    if (s.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    else if (s.tool === 'marker') { ctx.globalAlpha = 0.35; ctx.strokeStyle = s.color; }
    else ctx.strokeStyle = s.color;
    ctx.beginPath();
    ctx.moveTo(s.points[0][0], s.points[0][1]);
    for (let i = 1; i < s.points.length; i += 1) {
      const [x0, y0] = s.points[i - 1];
      const [x1, y1] = s.points[i];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.1, s.points[0][1]);
    ctx.stroke();
    ctx.restore();
  }

  drawText(t) {
    const { ctx } = this;
    ctx.save();
    ctx.font = `700 ${t.size}px 'Tajawal', 'Segoe UI', sans-serif`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = mathWidth(ctx, t.text, t.size);
    // Revealed from the right, the way Arabic is written.
    ctx.beginPath();
    ctx.rect(t.x + width / 2 + 10 - (width + 20) * t.reveal, t.y - t.size, (width + 20) * t.reveal, t.size * 2);
    ctx.clip();
    ctx.lineWidth = Math.max(6, t.size / 7);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineJoin = 'round';
    ctx.fillStyle = t.color;
    paintMath(ctx, t.text, t.x, t.y, t.size, (tt, xx, yy) => { ctx.strokeText(tt, xx, yy); ctx.fillText(tt, xx, yy); });
    ctx.restore();
  }

  drawShape(s) {
    const { ctx } = this;
    const r = s.size / 2;
    const rnd = jitter(s.seed);
    ctx.save();
    ctx.lineWidth = Math.max(4, s.size / 30);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.outline ? 'transparent' : `${s.color}33`;
    const pts = shapePoints(s.shape, s.x, s.y, r);
    const total = Math.max(2, Math.round(pts.length * s.reveal));
    ctx.beginPath();
    for (let i = 0; i < total; i += 1) {
      const [x, y] = pts[i];
      const wob = s.size * 0.012;
      if (i === 0) ctx.moveTo(x + rnd() * wob, y + rnd() * wob);
      else ctx.lineTo(x + rnd() * wob, y + rnd() * wob);
    }
    if (s.reveal >= 1 && !SHAPES[s.shape]?.line && s.shape !== 'arrow') ctx.closePath();
    if (s.reveal >= 1 && !s.outline && !SHAPES[s.shape]?.line) ctx.fill();
    ctx.stroke();
    if (s.text && s.reveal >= 1) {
      ctx.font = `700 ${Math.max(18, r / 3)}px 'Tajawal', 'Segoe UI', sans-serif`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#222';
      ctx.fillText(s.text, s.x, s.y);
    }
    ctx.restore();
  }
}

/** The outline of a shape as points (in drawing order, so it can be revealed stroke by stroke). */
export function shapePoints(shape, cx, cy, r) {
  const pts = [];
  const poly = (n, rot = -Math.PI / 2, rx = r, ry = r) => { for (let i = 0; i <= n; i += 1) { const a = rot + (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } };
  switch (shape) {
    case 'square': case 'rectangle': case 'rounded': {
      const w = shape === 'square' ? r : r * 1.4;
      const h = shape === 'square' ? r : r * 0.85;
      const c = [[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h], [cx - w, cy - h]];
      for (let i = 0; i < 4; i += 1) for (let k = 0; k <= 10; k += 1) pts.push([c[i][0] + ((c[i + 1][0] - c[i][0]) * k) / 10, c[i][1] + ((c[i + 1][1] - c[i][1]) * k) / 10]);
      break;
    }
    case 'triangle': poly(3); break;
    case 'pentagon': poly(5); break;
    case 'hexagon': poly(6, 0); break;
    case 'diamond': poly(4, -Math.PI / 2, r * 0.75, r); break;
    case 'star':
      for (let i = 0; i <= 10; i += 1) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2; const rr = i % 2 ? r * 0.42 : r; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      break;
    case 'heart':
      for (let i = 0; i <= 60; i += 1) { const t = (i / 60) * Math.PI * 2; pts.push([cx + r * 0.06 * 16 * Math.sin(t) ** 3, cy - r * 0.06 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); }
      break;
    case 'line': case 'arrow': case 'left_arrow': case 'up_arrow': case 'down_arrow': {
      const dir = { arrow: [1, 0], left_arrow: [-1, 0], up_arrow: [0, -1], down_arrow: [0, 1], line: [1, 0] }[shape];
      const x0 = cx - dir[0] * r; const y0 = cy - dir[1] * r; const x1 = cx + dir[0] * r; const y1 = cy + dir[1] * r;
      for (let k = 0; k <= 20; k += 1) pts.push([x0 + ((x1 - x0) * k) / 20, y0 + ((y1 - y0) * k) / 20]);
      if (shape !== 'line') {
        const back = [-dir[0] * r * 0.3, -dir[1] * r * 0.3];
        const side = [-dir[1] * r * 0.22, dir[0] * r * 0.22];
        pts.push([x1 + back[0] + side[0], y1 + back[1] + side[1]], [x1, y1], [x1 + back[0] - side[0], y1 + back[1] - side[1]]);
      }
      break;
    }
    default: poly(48, -Math.PI / 2, shape === 'circle' || shape === 'smiley' || shape === 'sun' ? r : r * 1.15, r); // circle, cloud...: an ellipse
  }
  return pts;
}
