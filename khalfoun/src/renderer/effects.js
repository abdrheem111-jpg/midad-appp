// Screen effects drawn on one transparent canvas over the desktop: confetti, fireworks,
// rain, snow, Ramadan lanterns, Eid balloons, stars, hearts, soap bubbles and Omani flags
// for National Day. Clicks pass through; the canvas only draws while an effect runs.

const TAU = Math.PI * 2;
const OMAN = ['#db161b', '#ffffff', '#008000'];
const PARTY = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#8ecae6', '#c77dff', '#43aa8b', '#ff70a6'];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** How long each effect lasts (seconds) unless stopped. */
export const EFFECT_SECONDS = {
  confetti: 7, fireworks: 9, national: 16, rain: 30, snow: 30, lanterns: 26, balloons: 13, stars: 7, hearts: 7, bubbles: 14,
};

export class Effects {
  constructor(parent = document.body) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.parts = [];
    this.spawners = [];
    this.running = null; // name of the effect now on screen
    this.until = 0;
    this.raf = 0;
    this.last = 0;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Starts an effect by name ('none' clears the screen). Returns false for an unknown name. */
  play(name) {
    if (name === 'none' || !name) { this.stop(); return true; }
    if (!EFFECT_SECONDS[name]) return false;
    this.parts = [];
    this.spawners = [];
    this.running = name;
    const secs = this.reduced ? Math.min(4, EFFECT_SECONDS[name]) : EFFECT_SECONDS[name];
    this.until = performance.now() + secs * 1000;
    this.setup(name);
    this.canvas.classList.add('on');
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.frame(t)); }
    return true;
  }

  stop() {
    this.parts = [];
    this.spawners = [];
    this.running = null;
    this.canvas.classList.remove('on');
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Adds a spawner: `fn(dt)` adds particles while the effect is on. */
  every(perSecond, fn) {
    this.spawners.push({ perSecond, acc: 0, fn });
  }

  setup(name) {
    const { w, h } = this;
    switch (name) {
      case 'confetti':
        for (let i = 0; i < 180; i += 1) this.confetti(rnd(0, w), rnd(-h * 0.6, -10), PARTY);
        this.every(18, () => this.confetti(rnd(0, w), -10, PARTY));
        break;
      case 'fireworks':
        this.every(1.8, () => this.rocket(PARTY));
        this.rocket(PARTY);
        break;
      case 'national':
        for (let i = 0; i < 7; i += 1) this.flag((w / 7) * (i + 0.5), rnd(40, 110), rnd(46, 70));
        for (let i = 0; i < 120; i += 1) this.confetti(rnd(0, w), rnd(-h * 0.7, -10), OMAN);
        this.every(10, () => this.confetti(rnd(0, w), -10, OMAN));
        this.every(1.1, () => this.rocket(OMAN));
        break;
      case 'rain':
        this.tint = 'rgba(40, 60, 90, 0.10)';
        this.every(140, () => this.parts.push({ kind: 'drop', x: rnd(-40, w), y: rnd(-60, -5), vx: 120, vy: rnd(900, 1300), len: rnd(14, 26), life: 3 }));
        break;
      case 'snow':
        this.every(40, () => this.parts.push({ kind: 'flake', x: rnd(0, w), y: -8, vy: rnd(35, 80), r: rnd(2, 5.5), phase: rnd(0, TAU), life: 30 }));
        break;
      case 'lanterns':
        this.parts.push({ kind: 'moon', x: w - 120, y: 110, life: 999 });
        for (let i = 0; i < 9; i += 1) this.lantern(rnd(0, w), rnd(h * 0.3, h + 200));
        this.every(0.9, () => this.lantern(rnd(0, w), h + 60));
        break;
      case 'balloons':
        for (let i = 0; i < 14; i += 1) this.balloon(rnd(0, w), rnd(h * 0.6, h + 300));
        this.every(2.2, () => this.balloon(rnd(0, w), h + 80));
        break;
      case 'stars':
        this.every(16, () => this.parts.push({ kind: 'star', x: rnd(0, w), y: rnd(-30, h * 0.2), vy: rnd(60, 140), r: rnd(6, 13), spin: rnd(-2, 2), a: rnd(0, TAU), color: pick(['#ffd166', '#fff3b0', '#ffe066', '#ffffff']), life: 6 }));
        break;
      case 'hearts':
        this.every(9, () => this.parts.push({ kind: 'heart', x: rnd(0, w), y: h + 20, vy: -rnd(70, 140), r: rnd(10, 20), phase: rnd(0, TAU), color: pick(['#ef476f', '#ff70a6', '#ffd166', '#e63946']), life: 12 }));
        break;
      case 'bubbles':
        this.every(4, () => this.parts.push({ kind: 'bubble', x: rnd(0, w), y: h + 30, vy: -rnd(50, 110), r: rnd(14, 38), phase: rnd(0, TAU), popAt: rnd(h * 0.05, h * 0.7), life: 20 }));
        break;
      default: break;
    }
  }

  confetti(x, y, colors) {
    this.parts.push({ kind: 'confetti', x, y, vx: rnd(-40, 40), vy: rnd(60, 180), w: rnd(6, 11), h: rnd(9, 16), a: rnd(0, TAU), spin: rnd(-7, 7), color: pick(colors), life: 9 });
  }

  rocket(colors) {
    const { w, h } = this;
    this.parts.push({ kind: 'rocket', x: rnd(w * 0.12, w * 0.88), y: h + 10, vx: rnd(-40, 40), vy: -rnd(h * 0.95, h * 1.25), colors, life: 2.4, burstAt: rnd(h * 0.12, h * 0.42) });
  }

  burst(x, y, colors) {
    const n = this.reduced ? 30 : 70;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * TAU + rnd(-0.05, 0.05);
      const speed = rnd(120, 330);
      this.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, color: pick(colors), life: rnd(1.1, 1.8), max: 1.8 });
    }
  }

  lantern(x, y) {
    this.parts.push({ kind: 'lantern', x, y, vy: -rnd(25, 55), s: rnd(0.7, 1.25), phase: rnd(0, TAU), color: pick(['#f4a261', '#e9c46a', '#e76f51', '#ffb703']), life: 40 });
  }

  balloon(x, y) {
    this.parts.push({ kind: 'balloon', x, y, vy: -rnd(60, 120), r: rnd(20, 32), phase: rnd(0, TAU), color: pick(PARTY), life: 20 });
  }

  flag(x, y, size) {
    this.parts.push({ kind: 'flag', x, y, size, phase: rnd(0, TAU), life: 999 });
  }

  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const ending = t > this.until;
    if (!ending) {
      for (const s of this.spawners) {
        s.acc += s.perSecond * dt;
        while (s.acc >= 1) { s.acc -= 1; s.fn(); }
      }
    }
    if (this.parts.length > 1400) this.parts.splice(0, this.parts.length - 1400);
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.running === 'rain' && !ending) { ctx.fillStyle = this.tint; ctx.fillRect(0, 0, this.w, this.h); }
    const keep = [];
    for (const p of this.parts) {
      p.life -= dt;
      // When the effect ends, the decorations that stay put (flags, the moon) fade away.
      if (ending && (p.kind === 'flag' || p.kind === 'moon')) p.life = Math.min(p.life, 1.2);
      if (p.life <= 0) continue;
      if (this.step(p, dt)) keep.push(p);
    }
    this.parts = keep;
    if (ending && !this.parts.length) { this.stop(); return; }
    this.raf = requestAnimationFrame((n) => this.frame(n));
  }

  /** Moves and draws one particle; false to drop it. */
  step(p, dt) {
    const { ctx } = this;
    const fade = Math.min(1, p.life / 1.2);
    switch (p.kind) {
      case 'confetti': {
        p.vy = Math.min(p.vy + 40 * dt, 260);
        p.x += (p.vx + Math.sin(p.a * 2) * 30) * dt;
        p.y += p.vy * dt;
        p.a += p.spin * dt;
        if (p.y > this.h + 20) return false;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.scale(1, Math.abs(Math.cos(p.a * 1.7)) + 0.15);
        ctx.fillStyle = p.color;
        if (p.color === '#ffffff') { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h); }
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        return true;
      }
      case 'rocket': {
        p.vy += 380 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.fillStyle = '#fff6d5';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 220, 150, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); ctx.stroke();
        if (p.y <= p.burstAt || p.vy > -40) { this.burst(p.x, p.y, p.colors); return false; }
        return true;
      }
      case 'spark': {
        p.vx *= 0.985; p.vy = p.vy * 0.985 + 160 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, TAU); ctx.fill();
        if (p.color === '#ffffff') { ctx.strokeStyle = 'rgba(200,200,200,0.6)'; ctx.stroke(); }
        ctx.globalAlpha = 1;
        return true;
      }
      case 'drop': {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y > this.h) return false;
        ctx.strokeStyle = 'rgba(190, 215, 255, 0.75)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * 0.1, p.y - p.len); ctx.stroke();
        return true;
      }
      case 'flake': {
        p.phase += dt;
        p.x += Math.sin(p.phase) * 20 * dt; p.y += p.vy * dt;
        if (p.y > this.h + 10) return false;
        ctx.globalAlpha = 0.9 * fade;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(120,150,190,0.8)'; ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        return true;
      }
      case 'lantern': {
        p.phase += dt;
        p.y += p.vy * dt; p.x += Math.sin(p.phase * 0.8) * 12 * dt;
        if (p.y < -80) return false;
        this.drawLantern(p.x, p.y, p.s, p.color, Math.sin(p.phase * 2) * 0.12, fade);
        return true;
      }
      case 'moon': {
        ctx.globalAlpha = fade;
        ctx.fillStyle = '#ffe9a8';
        ctx.shadowColor = '#ffe9a8'; ctx.shadowBlur = 24;
        ctx.beginPath(); ctx.arc(p.x, p.y, 46, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(p.x + 20, p.y - 12, 42, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        return true;
      }
      case 'balloon': {
        p.phase += dt;
        p.y += p.vy * dt; p.x += Math.sin(p.phase) * 18 * dt;
        if (p.y < -p.r * 4) return false;
        ctx.globalAlpha = fade;
        ctx.strokeStyle = 'rgba(80,60,40,0.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y + p.r * 1.2);
        ctx.quadraticCurveTo(p.x + Math.sin(p.phase * 2) * 10, p.y + p.r * 2.2, p.x, p.y + p.r * 3.2); ctx.stroke();
        const g = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.45, p.r * 0.1, p.x, p.y, p.r * 1.25);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, p.color); g.addColorStop(1, p.color);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 1.22, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(p.x - 4, p.y + p.r * 1.3); ctx.lineTo(p.x + 4, p.y + p.r * 1.3); ctx.lineTo(p.x, p.y + p.r * 1.18); ctx.fill();
        ctx.globalAlpha = 1;
        return true;
      }
      case 'star': {
        p.y += p.vy * dt; p.a += p.spin * dt;
        if (p.y > this.h + 20) return false;
        ctx.globalAlpha = fade * (0.6 + 0.4 * Math.abs(Math.sin(p.a * 3)));
        this.drawStar(p.x, p.y, p.r, p.a, p.color);
        ctx.globalAlpha = 1;
        return true;
      }
      case 'heart': {
        p.phase += dt;
        p.y += p.vy * dt; p.x += Math.sin(p.phase * 1.5) * 20 * dt;
        if (p.y < -40) return false;
        ctx.globalAlpha = fade * 0.9;
        this.drawHeart(p.x, p.y, p.r, p.color);
        ctx.globalAlpha = 1;
        return true;
      }
      case 'bubble': {
        p.phase += dt;
        p.y += p.vy * dt; p.x += Math.sin(p.phase * 1.2) * 16 * dt;
        if (p.y < p.popAt) {
          for (let i = 0; i < 8; i += 1) {
            const a = (i / 8) * TAU;
            this.parts.push({ kind: 'spark', x: p.x + Math.cos(a) * p.r, y: p.y + Math.sin(a) * p.r, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, color: '#d8f3ff', life: 0.4, max: 0.4 });
          }
          return false;
        }
        ctx.globalAlpha = fade;
        const g = ctx.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.4, p.r * 0.05, p.x, p.y, p.r);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(200,235,255,0.15)'); g.addColorStop(0.85, 'rgba(160,200,255,0.25)'); g.addColorStop(1, 'rgba(255,170,240,0.55)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        return true;
      }
      case 'flag': {
        p.phase += dt * 3;
        ctx.globalAlpha = fade;
        this.drawOmanFlag(p.x, p.y, p.size, p.phase);
        ctx.globalAlpha = 1;
        return true;
      }
      default: return false;
    }
  }

  drawStar(x, y, r, a, color) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const rr = i % 2 ? r * 0.45 : r;
      const an = (i / 10) * TAU - Math.PI / 2;
      ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawHeart(x, y, r, color) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.35);
    ctx.bezierCurveTo(x - r * 1.1, y - r * 0.5, x - r * 0.45, y - r * 1.15, x, y - r * 0.5);
    ctx.bezierCurveTo(x + r * 0.45, y - r * 1.15, x + r * 1.1, y - r * 0.5, x, y + r * 0.35);
    ctx.fill();
  }

  drawLantern(x, y, s, color, tilt, alpha) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(s, s); ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#6b4a1e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, -26); ctx.stroke();
    ctx.fillStyle = '#8a5a1c';
    ctx.beginPath(); ctx.moveTo(-10, -26); ctx.lineTo(10, -26); ctx.lineTo(14, -18); ctx.lineTo(-14, -18); ctx.closePath(); ctx.fill();
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
    g.addColorStop(0, '#fff7d6'); g.addColorStop(0.5, color); g.addColorStop(1, '#a8471c');
    ctx.fillStyle = g;
    ctx.shadowColor = color; ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.moveTo(-14, -18); ctx.quadraticCurveTo(-22, 2, -12, 20); ctx.lineTo(12, 20); ctx.quadraticCurveTo(22, 2, 14, -18); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(90,50,20,0.55)'; ctx.lineWidth = 1.2;
    for (const dx of [-6, 0, 6]) { ctx.beginPath(); ctx.moveTo(dx, -18); ctx.lineTo(dx * 0.9, 20); ctx.stroke(); }
    ctx.fillStyle = '#8a5a1c';
    ctx.fillRect(-12, 20, 24, 5);
    ctx.restore();
  }

  /** Oman's flag, waving: the red band at the hoist, then white, red and green stripes. */
  drawOmanFlag(x, y, size, phase) {
    const { ctx } = this;
    const w = size * 1.6;
    const h = size;
    ctx.save();
    ctx.translate(x - w / 2, y);
    ctx.fillStyle = '#5b3a1a';
    ctx.fillRect(-4, -6, 4, h + 40);
    const cols = 16;
    for (let i = 0; i < cols; i += 1) {
      const x0 = (i / cols) * w;
      const x1 = ((i + 1) / cols) * w + 0.6;
      const wave = Math.sin(phase + i * 0.45) * (i / cols) * size * 0.12;
      const shade = 0.88 + 0.12 * Math.cos(phase + i * 0.45);
      const band = x0 < w * 0.25;
      const rows = band ? [['#db161b', 0, 1]] : [['#ffffff', 0, 1 / 3], ['#db161b', 1 / 3, 2 / 3], ['#008000', 2 / 3, 1]];
      for (const [color, a, b] of rows) {
        ctx.fillStyle = color;
        ctx.fillRect(x0, a * h + wave, x1 - x0, (b - a) * h + 0.6);
      }
      // The fold of the cloth: a light shadow on part of each wave.
      ctx.fillStyle = `rgba(0, 0, 0, ${(1 - shade).toFixed(3)})`;
      ctx.fillRect(x0, wave, x1 - x0, h + 0.6);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.strokeRect(0, 0, w, h);
    ctx.restore();
  }
}
