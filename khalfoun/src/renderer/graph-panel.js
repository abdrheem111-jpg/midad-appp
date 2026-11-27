// Live graphs on the screen: «ارسم ص = ٢س + ١، وبعدها غيّر الميل». A board that appears beside
// the lesson, with س and ص axes in Arabic numbers, the curves traced like a pen, where they cross
// the axis marked, and a parameter that moves so the class sees what it changes.

import { parse, evaluate, roots, autoRange, niceStep, paramsOf } from '../core/math-expr.js';
import { mathText, tickText, arabicDigits } from '../core/math-sketch.js';
import { paintMath } from './ink.js';

const COLORS = ['#1D70B8', '#C0392B', '#1E8449', '#8E44AD', '#D35400'];
const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const AR_PARAM = { a: 'أ', b: 'ب', c: 'ج', d: 'د', k: 'ك', m: 'م', n: 'ن' };

export class GraphPanel {
  constructor(parent = document.body) {
    this.parent = parent;
    this.root = null;
    this.raf = 0;
  }

  get open() { return Boolean(this.root); }

  /** Where the board goes: beside the lesson (right half by default), or a given rectangle. */
  placeOf(place) {
    const W = innerWidth; const H = innerHeight;
    if (place && typeof place === 'object') return place;
    if (place === 'left') return { x: W * 0.03, y: H * 0.08, w: W * 0.45, h: H * 0.8 };
    if (place === 'center' || place === 'full') return { x: W * 0.12, y: H * 0.06, w: W * 0.76, h: H * 0.86 };
    return { x: W * 0.52, y: H * 0.08, w: W * 0.45, h: H * 0.8 };
  }

  /**
   * @param {{functions: {expr: string, color?: string, label?: string}[], x?: number[], y?: number[], params?: object,
   *   animate?: {param: string, from: number, to: number, seconds?: number}, roots?: boolean, points?: {x: number, y: number, label?: string}[],
   *   place?: string|object, digits?: string}} g
   * @returns {{ok: boolean, error?: string}}
   */
  show(g) {
    const fns = [];
    for (const [i, f] of (g.functions || []).slice(0, 5).entries()) {
      try { fns.push({ tree: parse(f.expr), expr: f.expr, color: f.color || COLORS[i % COLORS.length], label: f.label || f.expr }); } catch (err) { return { ok: false, error: `${f.expr}: ${err.message}` }; }
    }
    if (!fns.length) return { ok: false, error: 'ما فيه دالة' };
    this.close();
    this.spec = g; // kept for the lesson's saved state
    const rect = this.placeOf(g.place);
    const root = el('section', 'graph-panel');
    Object.assign(root.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    const close = el('button', 'graph-close fx-ui', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'سكّر الرسم');
    close.addEventListener('click', () => this.close());
    const canvas = el('canvas', 'graph-canvas');
    root.append(canvas, close);
    this.parent.append(root);
    this.root = root;
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(rect.w * dpr); canvas.height = Math.round(rect.h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const digits = g.digits === 'latin' ? 'latin' : 'arabic';
    const params = { ...(g.params || {}) };
    const anim = g.animate && Number.isFinite(g.animate.from) && Number.isFinite(g.animate.to) ? { ...g.animate, seconds: Math.max(1, Math.min(20, g.animate.seconds || 4)) } : null;
    if (anim) params[anim.param] = anim.from;
    for (const f of fns) for (const p of paramsOf(f.tree)) if (!(p in params)) params[p] = 1;
    const x0 = Number.isFinite(g.x?.[0]) ? g.x[0] : -10; const x1 = Number.isFinite(g.x?.[1]) && g.x[1] > x0 ? g.x[1] : x0 + 20;
    // the y range takes the whole animation into account, so the axes do not jump
    let yr = Number.isFinite(g.y?.[0]) && Number.isFinite(g.y?.[1]) && g.y[1] > g.y[0] ? [g.y[0], g.y[1]] : null;
    if (!yr) {
      const r1 = autoRange(fns.map((f) => f.tree), x0, x1, params);
      const r2 = anim ? autoRange(fns.map((f) => f.tree), x0, x1, { ...params, [anim.param]: anim.to }) : r1;
      yr = [Math.min(r1[0], r2[0]), Math.max(r1[1], r2[1])];
    }
    const [y0, y1] = yr;
    const pad = { l: 46, r: 22, t: 46, b: 40 };
    const W = rect.w; const H = rect.h;
    const px = (x) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
    const py = (y) => H - pad.b - ((y - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    const sx = niceStep(x1 - x0, Math.max(4, Math.round(W / 70))); const sy = niceStep(y1 - y0, Math.max(4, Math.round(H / 60)));
    const start = performance.now();
    const traceMs = 1100;
    const total = fns.length * traceMs + (anim ? anim.seconds * 1000 : 0);

    const drawAxes = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      ctx.beginPath(); ctx.roundRect(0, 0, W, H, 16); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.rect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); ctx.clip();
      ctx.strokeStyle = '#e6edf3'; ctx.lineWidth = 1;
      for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) { ctx.beginPath(); ctx.moveTo(px(x), pad.t); ctx.lineTo(px(x), H - pad.b); ctx.stroke(); }
      for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) { ctx.beginPath(); ctx.moveTo(pad.l, py(y)); ctx.lineTo(W - pad.r, py(y)); ctx.stroke(); }
      ctx.restore();
      // the axes (where 0 is, or at the edge)
      const ax = Math.min(Math.max(px(0), pad.l), W - pad.r); const ay = Math.min(Math.max(py(0), pad.t), H - pad.b);
      ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pad.l - 6, ay); ctx.lineTo(W - pad.r + 8, ay); ctx.moveTo(ax, H - pad.b + 6); ctx.lineTo(ax, pad.t - 10); ctx.stroke();
      ctx.fillStyle = '#2a1a10';
      ctx.beginPath(); ctx.moveTo(W - pad.r + 12, ay); ctx.lineTo(W - pad.r + 2, ay - 5); ctx.lineTo(W - pad.r + 2, ay + 5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(ax, pad.t - 14); ctx.lineTo(ax - 5, pad.t - 4); ctx.lineTo(ax + 5, pad.t - 4); ctx.fill();
      ctx.font = '700 16px Tajawal, Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(digits === 'arabic' ? 'س' : 'x', W - pad.r + 4, ay + 16);
      ctx.fillText(digits === 'arabic' ? 'ص' : 'y', ax + 14, pad.t - 18);
      ctx.font = '13px Tajawal, Tahoma, sans-serif'; ctx.fillStyle = '#555';
      for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) if (Math.abs(x) > sx / 2) ctx.fillText(tickText(x, digits), px(x), ay + 14);
      ctx.textAlign = 'right';
      for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) if (Math.abs(y) > sy / 2) ctx.fillText(tickText(y, digits), ax - 6, py(y));
    };

    const curve = (f, upto, p) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); ctx.clip();
      ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      let pen = false; let lastY = 0;
      const n = Math.max(60, Math.round((W - pad.l - pad.r) / 2));
      const end = Math.round(n * upto);
      for (let i = 0; i <= end; i += 1) {
        const x = x0 + ((x1 - x0) * i) / n; const y = evaluate(f.tree, x, p);
        const Y = py(y);
        // a jump (tan, 1/x) or a gap breaks the line
        if (!Number.isFinite(y) || (pen && Math.abs(Y - lastY) > H * 1.5)) { pen = false; continue; }
        if (pen) ctx.lineTo(px(x), Y); else { ctx.moveTo(px(x), Y); pen = true; }
        lastY = Y;
      }
      ctx.stroke();
      ctx.restore();
    };

    const labels = (p) => {
      ctx.save();
      ctx.font = '700 17px Tajawal, Tahoma, sans-serif'; ctx.direction = 'rtl'; ctx.textBaseline = 'middle';
      fns.forEach((f, i) => {
        ctx.fillStyle = f.color;
        let t = mathText(/^\s*(ص|y)\s*=/.test(f.label) ? f.label : `ص = ${f.label}`, { digits });
        if (digits === 'arabic') t = t.replace(/(?<![A-Za-z])([abcdkmn])(?![A-Za-z])/g, (m) => AR_PARAM[m] || m); // a → أ
        paintMath(ctx, t, W - pad.r - 110, 20 + i * 22, 17, (tt, xx, yy) => ctx.fillText(tt, xx, yy));
      });
      if (anim) {
        const v = Math.round(p[anim.param] * 100) / 100;
        ctx.fillStyle = '#2a1a10';
        const name = digits === 'arabic' ? (AR_PARAM[anim.param] || anim.param) : anim.param;
        ctx.textAlign = 'left'; ctx.direction = 'ltr';
        ctx.fillText(`${name} = ${digits === 'arabic' ? arabicDigits(String(v)) : v}`, pad.l + 4, 20);
      }
      ctx.restore();
    };

    const marks = (p) => {
      ctx.save();
      ctx.font = '13px Tajawal, Tahoma, sans-serif'; ctx.textAlign = 'center';
      if (g.roots) {
        for (const f of fns) for (const r of roots(f.tree, x0, x1, p)) {
          ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(px(r), py(0), 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2a1a10'; ctx.fillText(`(${tickText(r, digits)}، ${tickText(0, digits)})`, px(r), py(0) - 16);
        }
      }
      for (const pt of g.points || []) {
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
        ctx.fillStyle = '#C0392B'; ctx.beginPath(); ctx.arc(px(pt.x), py(pt.y), 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a1a10'; ctx.fillText(pt.label ? mathText(pt.label, { digits }) : `(${tickText(pt.x, digits)}، ${tickText(pt.y, digits)})`, px(pt.x), py(pt.y) - 16);
      }
      ctx.restore();
    };

    const frame = (now) => {
      if (!this.root) return;
      const t = now - start;
      const p = { ...params };
      if (anim && t > fns.length * traceMs) {
        const k = ease(Math.min(1, (t - fns.length * traceMs) / (anim.seconds * 1000)));
        p[anim.param] = anim.from + (anim.to - anim.from) * k;
      }
      drawAxes();
      fns.forEach((f, i) => curve(f, Math.max(0, Math.min(1, (t - i * traceMs) / traceMs)), p));
      if (t > fns.length * traceMs) marks(p);
      labels(p);
      if (t < total + 50) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    return { ok: true };
  }

  close() {
    this.spec = null;
    cancelAnimationFrame(this.raf);
    this.root?.remove();
    this.root = null;
  }
}
