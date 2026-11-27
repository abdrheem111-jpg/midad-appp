// Playful effects on anything on the screen, to change the mood of the lesson: a question in the
// PDF crumpled into a paper ball and thrown in a bin, a slide shattered like glass, burnt away,
// folded into a paper plane, a card flipped to show the answer, a lens, a spotlight...
// Khalfoun takes a picture of that part of the screen (the window itself is never touched) and
// animates the picture on his see-through layer; underneath, the place is covered with its own
// background colour while the piece is «gone», then the real screen shows again.

export const REGION_EFFECTS = ['crumple', 'shatter', 'burn', 'plane', 'flip', 'zoom', 'spotlight', 'shake', 'pop', 'melt'];

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeIn = (t) => t * t * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Draws the triangle s0-s1-s2 of the image onto d0-d1-d2 (affine). */
function drawTri(ctx, img, k, s0, s1, s2, d0, d1, d2, shade = 0) {
  const [x0, y0] = [s0[0] * k, s0[1] * k]; const [x1, y1] = [s1[0] * k, s1[1] * k]; const [x2, y2] = [s2[0] * k, s2[1] * k];
  const [u0, v0] = d0; const [u1, v1] = d1; const [u2, v2] = d2;
  const delta = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!delta) return;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / delta;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / delta;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / delta;
  const d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / delta;
  const e = u0 - a * x0 - c * y0; const f = v0 - b * x0 - d * y0;
  // a hair bigger than the triangle, so no seams show between neighbours
  const cx = (u0 + u1 + u2) / 3; const cy = (v0 + v1 + v2) / 3;
  const grow = (u, v) => [u + Math.sign(u - cx) * 0.7, v + Math.sign(v - cy) * 0.7];
  const [g0, g1, g2] = [grow(u0, v0), grow(u1, v1), grow(u2, v2)];
  ctx.save();
  ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
  if (shade) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(u0, v0); ctx.lineTo(u1, v1); ctx.lineTo(u2, v2); ctx.closePath();
    ctx.fillStyle = shade > 0 ? `rgba(0,0,0,${shade})` : `rgba(255,255,255,${-shade})`;
    ctx.fill();
    ctx.restore();
  }
}

/** The picture's edge colour: what the place looks like empty (white for a PDF page). */
function edgeColour(img) {
  try {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let i = 0; i < 16; i += 1) for (const [px, py] of [[i, 0], [i, 15], [0, i], [15, i]]) { const o = (py * 16 + px) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; n += 1; }
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  } catch { return '#ffffff'; }
}

function loadImage(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
}

export class ScreenFx {
  constructor(parent = document.body, { celebrate, enabled } = {}) {
    this.o = { enabled };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'screen-fx';
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '40' });
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.celebrate = celebrate || (() => {});
    this.items = []; // running effects: { draw(now) → alive }
    this.holes = []; // covered places: { rect, colour, until, fade }
    this.raf = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
  }

  get busy() { return this.items.length > 0 || this.holes.length > 0; }

  clear() { this.items = []; this.holes = []; this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  loop() {
    if (this.raf) return;
    const tick = (now) => {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.holes = this.holes.filter((h) => h.until === Infinity || now < h.until + 500);
      for (const h of this.holes) {
        const a = h.until === Infinity ? 1 : clamp01((h.until + 500 - now) / 500);
        ctx.globalAlpha = a;
        ctx.fillStyle = h.colour;
        ctx.fillRect(h.rect.x - 1, h.rect.y - 1, h.rect.w + 2, h.rect.h + 2);
        ctx.globalAlpha = 1;
      }
      this.items = this.items.filter((it) => { ctx.save(); const alive = it.draw(now); ctx.restore(); if (!alive) it.done?.(); return alive; });
      if (this.items.length || this.holes.length) this.raf = requestAnimationFrame(tick);
      else { this.raf = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    };
    this.raf = requestAnimationFrame(tick);
  }

  /**
   * @param {{effect: string, rect: {x:number,y:number,w:number,h:number}, image?: string, text?: string, keep?: boolean, hold?: number, color?: string}} p
   * @returns {Promise<boolean>} resolves when the animation is over
   */
  async play(p) {
    if (this.o?.enabled && !this.o.enabled()) return false; // the teacher switched effects off for now
    const rect = { x: Math.round(p.rect.x), y: Math.round(p.rect.y), w: Math.max(8, Math.round(p.rect.w)), h: Math.max(8, Math.round(p.rect.h)) };
    const img = p.image ? await loadImage(p.image).catch(() => null) : null;
    if (!img && p.effect !== 'spotlight') return false;
    const k = img ? img.naturalWidth / rect.w : 1;
    const holdMs = Math.max(1, Math.min(60, Number(p.hold) || (p.effect === 'flip' ? 10 : p.effect === 'zoom' || p.effect === 'spotlight' ? 7 : 4))) * 1000;
    const start = performance.now();
    const hide = (ms) => { const colour = edgeColour(img); this.holes.push({ rect, colour, until: p.keep ? Infinity : start + ms }); };
    const builder = this[`fx_${p.effect}`];
    if (!builder) return false;
    return new Promise((resolve) => {
      const item = builder.call(this, { rect, img, k, start, holdMs, hide, text: String(p.text || ''), color: p.color || '#1f6f5c', resolve });
      item.done = () => resolve(true);
      this.items.push(item);
      this.loop();
    });
  }

  // ---------------------------------------------------------------- crumple into a paper ball and throw it in a bin
  fx_crumple({ rect, img, k, start, holdMs, hide }) {
    const N = 8;
    const r = rng(rect.w * 7 + rect.h);
    const cx = rect.x + rect.w / 2; const cy = rect.y + rect.h / 2;
    const R = Math.max(26, Math.min(80, Math.min(rect.w, rect.h) * 0.22));
    const pts = []; // grid vertices: source and target in the ball
    for (let j = 0; j <= N; j += 1) for (let i = 0; i <= N; i += 1) {
      const ang = r() * Math.PI * 2; const rad = R * Math.sqrt(r()) * 0.95;
      pts.push({ sx: (i / N) * rect.w, sy: (j / N) * rect.h, tx: cx + Math.cos(ang) * rad, ty: cy + Math.sin(ang) * rad, w: (r() - 0.5) * 2 });
    }
    const shades = Array.from({ length: N * N * 2 }, () => r() * 0.35);
    const binW = Math.max(70, R * 2.4); const binH = binW * 1.1;
    const binX = Math.min(innerWidth - binW - 30, cx + Math.max(220, rect.w * 0.6)); const binY = innerHeight - binH - 30;
    const T1 = 900; const T2 = 1900; const T3 = 2600;
    hide(T3 + holdMs);
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        if (t < T1) {
          const e = ease(t / T1);
          const wob = Math.sin(Math.PI * Math.min(1, t / T1)) * R * 0.35;
          const pos = pts.map((q) => [rect.x + q.sx + (q.tx - rect.x - q.sx) * e + q.w * wob, rect.y + q.sy + (q.ty - rect.y - q.sy) * e + q.w * wob * 0.8]);
          let s = 0;
          for (let j = 0; j < N; j += 1) for (let i = 0; i < N; i += 1) {
            const a = j * (N + 1) + i; const b = a + 1; const c = a + N + 1; const d = c + 1;
            const sa = [pts[a].sx, pts[a].sy]; const sb = [pts[b].sx, pts[b].sy]; const sc = [pts[c].sx, pts[c].sy]; const sd = [pts[d].sx, pts[d].sy];
            drawTri(ctx, img, k, sa, sb, sc, pos[a], pos[b], pos[c], shades[s++] * e);
            drawTri(ctx, img, k, sb, sd, sc, pos[b], pos[d], pos[c], -shades[s++] * e * 0.6);
          }
          return true;
        }
        // the bin
        const binIn = clamp01((t - T1) / 300);
        const wobble = t > T2 ? Math.sin((t - T2) / 40) * Math.max(0, 1 - (t - T2) / 500) * 0.12 : 0;
        const binAlpha = t > T3 + 300 ? clamp01(1 - (t - T3 - 300) / 400) : binIn;
        ctx.save();
        ctx.globalAlpha = binAlpha;
        ctx.translate(binX + binW / 2, binY + binH);
        ctx.rotate(wobble);
        ctx.fillStyle = '#5d7a8c'; ctx.strokeStyle = '#3e5664'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-binW / 2, -binH); ctx.lineTo(binW / 2, -binH); ctx.lineTo(binW * 0.4, 0); ctx.lineTo(-binW * 0.4, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        for (let i = -1; i <= 1; i += 1) { ctx.beginPath(); ctx.moveTo(i * binW * 0.2, -binH * 0.85); ctx.lineTo(i * binW * 0.16, -binH * 0.1); ctx.stroke(); }
        ctx.fillStyle = '#7f9cad'; ctx.fillRect(-binW * 0.55, -binH - 8, binW * 1.1, 10);
        ctx.restore();
        if (t > T2) return t < T3 + 700;
        // the ball flies in an arc into the bin
        const f = clamp01((t - T1) / (T2 - T1));
        const bx = cx + (binX + binW / 2 - cx) * f;
        const top = Math.min(cy, binY) - 160;
        const by = (1 - f) * (1 - f) * cy + 2 * (1 - f) * f * top + f * f * (binY - R * 0.4);
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(f * Math.PI * 4);
        const rr = R * (1 - f * 0.25);
        ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(img, -rr * 1.3, -rr * 1.3, rr * 2.6, rr * 2.6);
        const g = ctx.createRadialGradient(-rr * 0.35, -rr * 0.35, rr * 0.1, 0, 0, rr);
        g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
        ctx.fillStyle = g; ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.2;
        const rc = rng(7);
        for (let i = 0; i < 9; i += 1) { ctx.beginPath(); const a1 = rc() * 6.3; const a2 = a1 + 1 + rc() * 2; ctx.moveTo(Math.cos(a1) * rr, Math.sin(a1) * rr); ctx.quadraticCurveTo((rc() - 0.5) * rr, (rc() - 0.5) * rr, Math.cos(a2) * rr, Math.sin(a2) * rr); ctx.stroke(); }
        ctx.restore();
        return true;
      },
    };
  }

  // ---------------------------------------------------------------- shattered like glass
  fx_shatter({ rect, img, k, start, holdMs, hide }) {
    const r = rng(rect.w + rect.h * 3);
    const cols = 7; const rows = Math.max(4, Math.round((7 * rect.h) / rect.w));
    const grid = [];
    for (let j = 0; j <= rows; j += 1) for (let i = 0; i <= cols; i += 1) {
      const edge = i === 0 || j === 0 || i === cols || j === rows;
      grid.push([(i / cols) * rect.w + (edge ? 0 : (r() - 0.5) * (rect.w / cols) * 0.7), (j / rows) * rect.h + (edge ? 0 : (r() - 0.5) * (rect.h / rows) * 0.7)]);
    }
    const shards = [];
    const ix = rect.w * (0.35 + r() * 0.3); const iy = rect.h * (0.35 + r() * 0.3); // where it was hit
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) {
      const a = j * (cols + 1) + i; const tri = [[a, a + 1, a + cols + 1], [a + 1, a + cols + 2, a + cols + 1]];
      for (const t of tri) {
        const s = t.map((n) => grid[n]);
        const mx = (s[0][0] + s[1][0] + s[2][0]) / 3; const my = (s[0][1] + s[1][1] + s[2][1]) / 3;
        const dx = mx - ix; const dy = my - iy; const dist = Math.hypot(dx, dy) || 1;
        shards.push({ s, mx, my, vx: (dx / dist) * (60 + r() * 140), vy: (dy / dist) * 60 - 80 - r() * 120, rot: (r() - 0.5) * 6, delay: dist * 0.6 });
      }
    }
    const T = 2200;
    hide(T + holdMs);
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        // the cracks first
        if (t < 250) {
          for (const sh of shards) drawTri(ctx, img, k, sh.s[0], sh.s[1], sh.s[2], ...sh.s.map((p) => [rect.x + p[0], rect.y + p[1]]));
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
          for (const sh of shards) { ctx.beginPath(); sh.s.forEach((p, n) => (n ? ctx.lineTo(rect.x + p[0], rect.y + p[1]) : ctx.moveTo(rect.x + p[0], rect.y + p[1]))); ctx.closePath(); ctx.stroke(); }
          return true;
        }
        let alive = false;
        for (const sh of shards) {
          const tt = Math.max(0, (t - 250 - sh.delay) / 1000);
          const ox = sh.vx * tt; const oy = sh.vy * tt + 900 * tt * tt;
          const a = sh.rot * tt;
          const cxs = rect.x + sh.mx; const cys = rect.y + sh.my;
          const dst = sh.s.map(([px, py]) => {
            const x = rect.x + px - cxs; const y = rect.y + py - cys;
            return [cxs + ox + x * Math.cos(a) - y * Math.sin(a), cys + oy + x * Math.sin(a) + y * Math.cos(a)];
          });
          if (dst.some(([, y]) => y < innerHeight + 50)) alive = true;
          ctx.globalAlpha = clamp01(1 - tt * 0.6);
          drawTri(ctx, img, k, sh.s[0], sh.s[1], sh.s[2], dst[0], dst[1], dst[2], -0.12);
        }
        ctx.globalAlpha = 1;
        return alive && t < T + 1500;
      },
    };
  }

  // ---------------------------------------------------------------- burnt away, with glowing edges and embers
  fx_burn({ rect, img, start, holdMs, hide }) {
    const cell = 4;
    const cw = Math.ceil(rect.w / cell); const ch = Math.ceil(rect.h / cell);
    const r = rng(rect.w * 13 + rect.h);
    // the fire starts at a few hot spots and spreads with a wavy (smooth-noise) front
    const spots = Array.from({ length: 3 }, () => [r() * cw, r() * ch]);
    const G = 10; const gw = Math.ceil(cw / G) + 2; const gh = Math.ceil(ch / G) + 2;
    const grid = Array.from({ length: gw * gh }, () => r());
    const smooth = (x, y) => {
      const gx = x / G; const gy = y / G; const x0 = Math.floor(gx); const y0 = Math.floor(gy); const fx = gx - x0; const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => grid[(j % gh) * gw + (i % gw)];
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
    const n = new Float32Array(cw * ch);
    const far = Math.hypot(cw, ch);
    for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) {
      const d = Math.min(...spots.map(([sx, sy]) => Math.hypot(x - sx, y - sy))) / far;
      n[y * cw + x] = d * 0.75 + smooth(x, y) * 0.25;
    }
    const off = document.createElement('canvas'); off.width = rect.w; off.height = rect.h;
    const o = off.getContext('2d');
    const embers = [];
    const T = 2600;
    hide(T + holdMs);
    return {
      draw: (now) => {
        const t = now - start;
        const th = easeIn(clamp01(t / T)) * 1.1;
        o.globalCompositeOperation = 'source-over';
        o.clearRect(0, 0, rect.w, rect.h);
        o.drawImage(img, 0, 0, rect.w, rect.h);
        o.globalCompositeOperation = 'destination-out';
        o.beginPath();
        for (let i = 0; i < n.length; i += 1) if (n[i] < th) o.rect((i % cw) * cell, Math.floor(i / cw) * cell, cell + 0.5, cell + 0.5);
        o.fill();
        o.globalCompositeOperation = 'source-atop';
        o.fillStyle = 'rgba(60,25,0,0.85)';
        o.beginPath();
        for (let i = 0; i < n.length; i += 1) if (n[i] >= th && n[i] < th + 0.05) o.rect((i % cw) * cell - 1, Math.floor(i / cw) * cell - 1, cell + 2, cell + 2);
        o.fill();
        const ctx = this.ctx;
        ctx.drawImage(off, rect.x, rect.y);
        // the burning edge glows
        ctx.fillStyle = 'rgba(255,150,30,0.85)';
        ctx.shadowColor = 'rgba(255,120,0,0.9)'; ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let i = 0; i < n.length; i += 1) if (n[i] >= th && n[i] < th + 0.018) {
          const x = rect.x + (i % cw) * cell; const y = rect.y + Math.floor(i / cw) * cell;
          ctx.rect(x, y, cell, cell);
          if (r() < 0.04 && embers.length < 300) embers.push({ x, y, vx: (r() - 0.5) * 30, vy: -40 - r() * 60, life: 1 });
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        for (const e of embers) {
          e.x += e.vx / 60; e.y += e.vy / 60; e.life -= 0.012;
          ctx.fillStyle = `rgba(255,${120 + Math.round(e.life * 100)},30,${Math.max(0, e.life)})`;
          ctx.fillRect(e.x, e.y, 2.5, 2.5);
        }
        return t < T + 900;
      },
    };
  }

  // ---------------------------------------------------------------- folded into a paper plane that flies away
  fx_plane({ rect, img, start, holdMs, hide }) {
    const cx = rect.x + rect.w / 2; const cy = rect.y + rect.h / 2;
    const S = Math.max(60, Math.min(140, Math.min(rect.w, rect.h) * 0.5));
    const T1 = 800; const T2 = 2600;
    hide(T2 + holdMs);
    // up if there is room above, else down: it stays on the screen until it leaves at the side
    const up = cy > 300;
    const amp = Math.min(220, up ? cy - 80 : innerHeight - cy - 120);
    const path = (f) => ({ x: cx + f * (innerWidth + S * 2 - cx) - Math.sin(f * Math.PI * 2) * 140, y: cy + (up ? -1 : 1) * Math.sin(f * Math.PI) * amp + Math.cos(f * Math.PI * 2) * 30 - 30 });
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        if (t < T1) {
          // the page folds: it narrows to a triangle
          const e = ease(t / T1);
          const w = rect.w * (1 - e) + S * 1.6 * e; const h = rect.h * (1 - e) + S * 0.6 * e;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.beginPath();
          ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2 - (w * 0.5) * e, -h / 2 + (h / 2) * e); ctx.lineTo(w / 2, 0);
          ctx.lineTo(w / 2 - (w * 0.5) * e, h / 2 - (h / 2) * e); ctx.lineTo(-w / 2, h / 2); ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
          ctx.fillStyle = `rgba(0,0,0,${0.15 * e})`; ctx.fillRect(-w / 2, 0, w, h / 2);
          ctx.restore();
          return true;
        }
        const f = clamp01((t - T1) / (T2 - T1));
        const p = path(f); const q = path(Math.min(1, f + 0.01));
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        // the trail
        ctx.strokeStyle = 'rgba(31,111,92,0.45)'; ctx.setLineDash([6, 8]); ctx.lineWidth = 2;
        ctx.beginPath();
        for (let g = 0; g <= f; g += 0.02) { const a = path(g); if (g === 0) ctx.moveTo(a.x, a.y); else ctx.lineTo(a.x, a.y); }
        ctx.stroke(); ctx.setLineDash([]);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(S * 0.8, 0); ctx.lineTo(-S * 0.8, -S * 0.42); ctx.lineTo(-S * 0.45, 0); ctx.lineTo(-S * 0.8, S * 0.42); ctx.closePath();
        ctx.save(); ctx.clip(); ctx.drawImage(img, -S * 0.8, -S * 0.42, S * 1.6, S * 0.84); ctx.restore();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(S * 0.8, 0); ctx.lineTo(-S * 0.45, 0); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.moveTo(S * 0.8, 0); ctx.lineTo(-S * 0.45, 0); ctx.lineTo(-S * 0.8, S * 0.42); ctx.closePath(); ctx.fill();
        ctx.restore();
        return f < 1;
      },
    };
  }

  // ---------------------------------------------------------------- a card that flips to show the answer
  fx_flip({ rect, img, start, holdMs, hide, text, color }) {
    const T = 600;
    hide(T * 2 + holdMs);
    const back = text || '؟';
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        const cx = rect.x + rect.w / 2;
        let phase; let sx;
        if (t < T) { phase = t / T; sx = Math.cos(phase * Math.PI); } // turning to the back
        else if (t < T + holdMs) sx = -1;
        else { phase = clamp01((t - T - holdMs) / T); sx = -Math.cos(phase * Math.PI); }
        const lift = Math.sin(Math.min(1, Math.abs(sx) < 1 ? (1 - Math.abs(sx)) : 0) * Math.PI / 2) * 10;
        ctx.save();
        ctx.translate(cx, rect.y + rect.h / 2 - lift);
        ctx.scale(Math.max(0.001, Math.abs(sx)), 1);
        ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
        if (sx > 0) {
          ctx.drawImage(img, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
        } else {
          const rr = Math.min(18, rect.h / 4);
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.roundRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h, rr); ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.roundRect(-rect.w / 2 + 8, -rect.h / 2 + 8, rect.w - 16, rect.h - 16, rr * 0.7); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
          let size = Math.min(rect.h * 0.45, 64);
          ctx.font = `700 ${size}px Tajawal, Tahoma, sans-serif`;
          while (ctx.measureText(back).width > rect.w * 0.86 && size > 14) { size -= 2; ctx.font = `700 ${size}px Tajawal, Tahoma, sans-serif`; }
          ctx.fillText(back, 0, 0);
        }
        ctx.restore();
        return t < T * 2 + holdMs;
      },
    };
  }

  // ---------------------------------------------------------------- a magnifying lens
  fx_zoom({ rect, img, start, holdMs }) {
    const R = Math.max(80, Math.min(260, Math.max(rect.w, rect.h) * 0.7));
    const cx = Math.max(R + 10, Math.min(innerWidth - R * 1.3, rect.x + rect.w / 2));
    const cy = Math.max(R + 10, Math.min(innerHeight - R * 1.3, rect.y + rect.h / 2));
    const Z = 1.9;
    const T = 350;
    const bg = edgeColour(img);
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        const a = t < T ? ease(t / T) : t > T + holdMs ? 1 - ease(clamp01((t - T - holdMs) / T)) : 1;
        const rr = R * (0.6 + 0.4 * a);
        ctx.globalAlpha = a;
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = bg; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
        ctx.drawImage(img, cx - (rect.w * Z) / 2, cy - (rect.h * Z) / 2, rect.w * Z, rect.h * Z);
        ctx.restore();
        ctx.lineWidth = 8; ctx.strokeStyle = '#2a1a10'; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(cx, cy, rr - 6, -2.4, -1.4); ctx.stroke();
        ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.strokeStyle = '#6b4a2b';
        ctx.beginPath(); ctx.moveTo(cx + rr * 0.72, cy + rr * 0.72); ctx.lineTo(cx + rr * 1.15, cy + rr * 1.15); ctx.stroke();
        ctx.globalAlpha = 1;
        return t < T * 2 + holdMs;
      },
    };
  }

  // ---------------------------------------------------------------- a spotlight: everything dark except it
  fx_spotlight({ rect, start, holdMs }) {
    const T = 400;
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        const a = t < T ? ease(t / T) : t > T + holdMs ? 1 - ease(clamp01((t - T - holdMs) / T)) : 1;
        const pad = 14;
        ctx.fillStyle = `rgba(0,0,0,${0.68 * a})`;
        ctx.beginPath();
        ctx.rect(0, 0, innerWidth, innerHeight);
        ctx.roundRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2, 18);
        ctx.fill('evenodd');
        ctx.strokeStyle = `rgba(255,220,120,${0.9 * a})`; ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(255,210,90,0.9)'; ctx.shadowBlur = 20 * a;
        ctx.beginPath(); ctx.roundRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2, 18); ctx.stroke();
        return t < T * 2 + holdMs;
      },
    };
  }

  // ---------------------------------------------------------------- shake it (a wake-up call for that line)
  fx_shake({ rect, img, start, hide }) {
    const T = 1300;
    hide(T);
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        const amp = Math.max(0, 1 - t / T);
        const dx = Math.sin(t / 28) * 12 * amp; const rot = Math.sin(t / 45) * 0.04 * amp;
        const sc = 1 + Math.sin(t / 60) * 0.03 * amp;
        ctx.translate(rect.x + rect.w / 2 + dx, rect.y + rect.h / 2);
        ctx.rotate(rot); ctx.scale(sc, sc);
        ctx.drawImage(img, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
        return t < T;
      },
    };
  }

  // ---------------------------------------------------------------- blown up like a balloon until it pops
  fx_pop({ rect, img, start, holdMs, hide }) {
    const T1 = 900;
    const r = rng(rect.w * 3 + 11);
    const bits = [];
    hide(T1 + 1600 + holdMs);
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        const cx = rect.x + rect.w / 2; const cy = rect.y + rect.h / 2;
        if (t < T1) {
          const e = t / T1;
          const sc = 1 + e * 0.25 + Math.sin(t / 50) * 0.03 * e;
          ctx.translate(cx, cy); ctx.scale(sc, sc * (1 + Math.sin(t / 70) * 0.02));
          ctx.drawImage(img, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
          return true;
        }
        if (!bits.length) {
          const colours = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#e67e22'];
          for (let i = 0; i < 160; i += 1) {
            const a = r() * Math.PI * 2; const v = 200 + r() * 500;
            bits.push({ x: cx + (r() - 0.5) * rect.w, y: cy + (r() - 0.5) * rect.h, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, c: colours[i % colours.length], s: 4 + r() * 7, rot: r() * 6 });
          }
          this.celebrate('pop', cx, cy);
        }
        const tt = (t - T1) / 1000;
        for (const b of bits) {
          ctx.save();
          ctx.globalAlpha = clamp01(1 - tt / 1.6);
          ctx.translate(b.x + b.vx * tt, b.y + b.vy * tt + 700 * tt * tt); ctx.rotate(b.rot + tt * 8);
          ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
          ctx.restore();
        }
        // the «pop» word for a moment
        if (tt < 0.5) {
          ctx.globalAlpha = 1 - tt * 2;
          ctx.fillStyle = '#e74c3c'; ctx.font = `900 ${Math.min(90, rect.h * 0.6) * (1 + tt)}px Tajawal, Tahoma, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('بووم!', cx, cy);
        }
        return tt < 1.7;
      },
    };
  }

  // ---------------------------------------------------------------- melting down like ice cream
  fx_melt({ rect, img, k, start, holdMs, hide }) {
    const col = 6;
    const n = Math.ceil(rect.w / col);
    const r = rng(rect.h * 5 + 3);
    const speed = Array.from({ length: n }, (_, i) => 0.6 + r() * 0.8 + Math.sin(i / 5) * 0.2);
    const T = 2400;
    hide(T + holdMs);
    return {
      draw: (now) => {
        const t = now - start;
        const ctx = this.ctx;
        const e = easeIn(clamp01(t / T));
        for (let i = 0; i < n; i += 1) {
          const drop = e * speed[i] * (innerHeight - rect.y);
          const stretch = 1 + e * speed[i] * 0.8;
          ctx.globalAlpha = clamp01(1 - e * 0.9);
          ctx.drawImage(img, i * col * k, 0, col * k, rect.h * k, rect.x + i * col, rect.y + drop, col + 0.6, rect.h * stretch);
        }
        ctx.globalAlpha = 1;
        return t < T;
      },
    };
  }
}
