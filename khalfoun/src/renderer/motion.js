// Where Khalfoun is and how he moves around the screen: roaming along the
// floor (the top of the taskbar) and on top of open windows, hopping between
// them, running when called, falling with gravity when dropped or when the
// window under him moves or closes, and staying in a corner in focus mode.
// Pure: unit-tested.

const GRAVITY = 2600; // px/s^2
const WALK_SPEED = 75; // px/s
const RUN_SPEED = 260;
const MAX_HOP_UP = 330; // px he can jump up
const MAX_HOP_DOWN = 520;
const MAX_HOP_SIDE = 420;
const RIDE_TOLERANCE = 24; // a window moving more than this in one update throws him off

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Motion {
  /**
   * @param {{width: number, height: number}} area usable screen area (CSS px)
   * @param {{width: number, height: number}} size character box size
   * @param {() => number} [rng]
   */
  constructor(area, size, rng = Math.random) {
    this.rng = rng;
    this.size = size;
    this.platforms = [];
    this.support = null; // null = the floor, else {id, y} of the window edge he stands on
    this.climb = true; // allowed to use window tops
    this.pending = [];
    this.setArea(area);
    this.x = Math.round(this.area.width * 0.7);
    this.y = this.floor;
    this.vy = 0;
    this.mode = 'idle'; // idle | walk | run | hop | fall | drag | sleep | focus
    this.targetX = this.x;
    this.facing = -1;
    this.idleFor = 0;
    this.nextRoamIn = 4 + rng() * 6;
    this.paused = false; // true while talking or busy
    this.focus = false;
    this.hop = null;
  }

  setArea(area) {
    this.area = { width: Math.max(area.width, this.size.width), height: Math.max(area.height, this.size.height) };
    this.floor = this.area.height - this.size.height;
    this.maxX = this.area.width - this.size.width;
    if (this.x !== undefined) {
      this.x = clamp(this.x, 0, this.maxX);
      if (!this.support && this.mode !== 'drag' && this.mode !== 'fall' && this.mode !== 'hop') this.y = this.floor;
    }
  }

  get center() { return this.x + this.size.width / 2; }

  /** Base animation that matches the movement. */
  get baseAnimation() {
    switch (this.mode) {
      case 'walk': return 'walk';
      case 'run': return 'run';
      case 'hop': return 'leap';
      case 'fall': case 'drag': return 'dangle';
      case 'sleep': return 'sleep';
      default: return 'idle';
    }
  }

  get onWindow() { return Boolean(this.support); }

  /** The platform segment he stands on now, if any. */
  currentSegment() {
    if (!this.support) return null;
    return this.findSegment(this.support.id, this.center);
  }

  findSegment(id, cx) {
    let best = null;
    for (const p of this.platforms) {
      if (p.id !== id || cx < p.x1 || cx > p.x2) continue;
      best = p;
    }
    return best;
  }

  /** Allowed left positions on whatever he stands on. */
  walkRange() {
    const seg = this.currentSegment();
    const half = this.size.width / 2;
    if (!seg) return [0, this.maxX];
    const lo = clamp(seg.x1 + 12 - half, 0, this.maxX);
    const hi = clamp(seg.x2 - 12 - half, 0, this.maxX);
    return lo <= hi ? [lo, hi] : [this.x, this.x];
  }

  /**
   * Window top edges he can stand on (from platforms.js), refreshed as windows move.
   * If the window under him closes, or moves a lot at once, he falls.
   */
  setPlatforms(list) {
    this.platforms = Array.isArray(list) ? list : [];
    if (!this.support || this.mode === 'drag' || this.mode === 'fall' || this.mode === 'hop') return;
    const seg = this.findSegment(this.support.id, this.center);
    if (!seg) { this.startFall('lost'); return; }
    const dy = seg.y - this.support.y;
    if (Math.abs(dy) > RIDE_TOLERANCE) { this.startFall('shaken'); return; }
    this.support.y = seg.y;
    this.y += dy;
  }

  startFall(reason) {
    this.support = null;
    this.hop = null;
    this.mode = 'fall';
    this.vy = reason === 'shaken' ? -320 : 0;
    this.pending.push({ type: 'slip', reason });
  }

  walkTo(x, run = false) {
    if (this.mode === 'drag' || this.mode === 'fall' || this.mode === 'hop') return;
    const [lo, hi] = this.walkRange();
    this.targetX = clamp(x, lo, hi);
    if (Math.abs(this.targetX - this.x) < 2) { this.mode = this.focus ? 'focus' : 'idle'; return; }
    this.facing = this.targetX > this.x ? 1 : -1;
    this.mode = run ? 'run' : 'walk';
  }

  /**
   * Jumps in an arc to a spot. `support` is the window edge to land on, or null for the floor.
   * @param {number} x left position to land at
   * @param {number} y top position to land at
   * @param {{id: any, y: number}|null} support
   */
  hopTo(x, y, support) {
    if (this.mode === 'drag' || this.mode === 'fall') return;
    const x1 = clamp(x, 0, this.maxX);
    const dist = Math.hypot(x1 - this.x, y - this.y);
    const up = this.y - y;
    this.hop = {
      x0: this.x, y0: this.y, x1, y1: y, t: 0,
      T: clamp(0.5 + dist / 900, 0.5, 1.3),
      arc: Math.max(55, up + 70),
      support,
    };
    this.facing = x1 >= this.x ? 1 : -1;
    this.support = null;
    this.mode = 'hop';
  }

  /** Runs to the middle of the floor (jumping down first if he is on a window). */
  come() {
    this.focus = false;
    const x = this.area.width / 2 - this.size.width / 2;
    if (this.support) this.hopTo(x, this.floor, null);
    else this.walkTo(x, true);
  }

  /** Goes to the bottom-right corner and stays there quietly. */
  goAway() {
    this.focus = true;
    if (this.support) this.hopTo(this.maxX, this.floor, null);
    else this.walkTo(this.maxX, false);
  }

  // ----- moving on command («روح يمين», «اطلع فوق», «اثبت مكانك»)

  /** Walks a distance to the right (dx > 0) or left on whatever he stands on. */
  step(dx, run = false) {
    this.walkTo(this.x + dx, run);
    return this.mode === 'walk' || this.mode === 'run';
  }

  /** Runs to the far right (side > 0) or far left. */
  toEdge(side) {
    if (this.support) { this.hopTo(side > 0 ? this.maxX : 0, this.floor, null); return true; }
    this.walkTo(side > 0 ? this.maxX : 0, true);
    return true;
  }

  /** Goes to a screen x (e.g. under the mouse), jumping down first if needed. */
  goToX(cx) {
    const x = cx - this.size.width / 2;
    if (this.support) this.hopTo(x, this.floor, null);
    else this.walkTo(x, true);
    return true;
  }

  /** Jumps up onto the nearest window he can reach. Returns false when none is in reach. */
  climbUp() {
    const options = this.reachable().filter((p) => p.y < this.y + this.size.height - 20);
    if (!options.length) return false;
    const cx = this.center;
    const dist = (p) => (cx < p.x1 ? p.x1 - cx : cx > p.x2 ? cx - p.x2 : 0) + (this.y - p.y) * 0.2;
    const p = options.sort((a, b) => dist(a) - dist(b))[0];
    const half = this.size.width / 2;
    const landX = clamp(cx, p.x1 + half * 0.6, p.x2 - half * 0.6) - half;
    this.hopTo(landX, p.y - this.size.height, { id: p.id, y: p.y });
    return true;
  }

  /** Jumps down to the floor. Returns false when he is already on it. */
  climbDown() {
    if (!this.support) return false;
    this.hopTo(this.x, this.floor, null);
    return true;
  }

  /** «اثبت مكانك»: stays put (no wandering) until told to move freely again. */
  stay() {
    this.stop();
    this.focus = true;
    if (this.mode === 'idle') this.mode = 'focus';
  }

  /** «تحرك براحتك»: wanders again. */
  free() {
    this.focus = false;
    if (this.mode === 'focus') this.mode = 'idle';
    this.idleFor = 0;
  }

  turn() { this.facing = -this.facing; }

  sleep() { if (this.mode !== 'drag' && this.mode !== 'fall' && this.mode !== 'hop') this.mode = 'sleep'; }

  wake() { if (this.mode === 'sleep') this.mode = this.focus ? 'focus' : 'idle'; this.idleFor = 0; }

  stop() {
    if (this.mode === 'walk' || this.mode === 'run') this.mode = this.focus ? 'focus' : 'idle';
    this.targetX = this.x;
  }

  startDrag() { this.mode = 'drag'; this.vy = 0; this.support = null; this.hop = null; }

  dragTo(x, y) {
    if (this.mode !== 'drag') return;
    this.x = clamp(x, 0, this.maxX);
    this.y = clamp(y, 0, this.floor);
  }

  endDrag() {
    if (this.mode !== 'drag') return;
    this.mode = this.y < this.floor - 1 ? 'fall' : (this.focus ? 'focus' : 'idle');
    this.vy = 0;
  }

  /** Window edges he could jump to from where he is. */
  reachable() {
    if (!this.climb) return [];
    const feet = this.y + this.size.height;
    const cx = this.center;
    return this.platforms.filter((p) => {
      if (this.support && p.id === this.support.id) return false;
      const rise = feet - p.y;
      if (rise > MAX_HOP_UP || rise < -MAX_HOP_DOWN || Math.abs(rise) < 20) return false;
      const side = cx < p.x1 ? p.x1 - cx : cx > p.x2 ? cx - p.x2 : 0;
      return side <= MAX_HOP_SIDE && p.x2 - p.x1 >= this.size.width * 0.5;
    });
  }

  roam(events) {
    const r = this.rng();
    const options = this.reachable();
    if (options.length && r < 0.4) {
      const p = options[Math.floor(this.rng() * options.length) % options.length];
      const half = this.size.width / 2;
      const cx = clamp(this.center + (this.rng() * 2 - 1) * 120, p.x1 + 20, p.x2 - 20);
      this.hopTo(cx - half, p.y - this.size.height, { id: p.id, y: p.y });
      events.push({ type: 'hop', to: p.id });
      return;
    }
    if (this.support && r < 0.6) {
      this.hopTo(this.x + (this.rng() * 2 - 1) * 120, this.floor, null);
      events.push({ type: 'hop', to: 'floor' });
      return;
    }
    const span = Math.min(this.area.width * 0.4, 500);
    let x = this.x + (this.rng() * 2 - 1) * span;
    const [lo, hi] = this.walkRange();
    if (x < lo || x > hi) x = this.x - (x - this.x);
    this.walkTo(x);
    if (this.mode === 'walk') events.push({ type: 'roam', to: this.targetX });
    else { this.idleFor = 0; this.nextRoamIn = 3 + this.rng() * 5; }
  }

  landOn(seg, events, impact) {
    this.y = seg.y - this.size.height;
    this.support = { id: seg.id, y: seg.y };
    this.vy = 0;
    this.mode = this.focus ? 'focus' : 'idle';
    this.idleFor = 0;
    events.push({ type: 'landed', impact, onWindow: true });
  }

  /**
   * Advances the simulation.
   * @param {number} dt seconds
   * @returns {Array<{type: string, [k: string]: any}>} events: landed, arrived, roam, hop, slip
   */
  update(dt) {
    const events = this.pending.splice(0);
    const step = Math.min(dt, 0.05);
    switch (this.mode) {
      case 'fall': {
        const prevFeet = this.y + this.size.height;
        this.vy += GRAVITY * step;
        this.y += this.vy * step;
        const feet = this.y + this.size.height;
        if (this.vy > 0 && this.climb) {
          const cx = this.center;
          let landing = null;
          for (const p of this.platforms) {
            if (p.y >= prevFeet - 0.5 && p.y <= feet && cx >= p.x1 && cx <= p.x2 && (!landing || p.y < landing.y)) landing = p;
          }
          if (landing) { this.landOn(landing, events, this.vy); break; }
        }
        if (this.y >= this.floor) {
          const impact = this.vy;
          this.y = this.floor;
          if (impact > 900) {
            this.vy = -impact * 0.28; // one small bounce
          } else {
            this.vy = 0;
            this.mode = this.focus ? 'focus' : 'idle';
            this.idleFor = 0;
            events.push({ type: 'landed', impact, onWindow: false });
          }
        }
        break;
      }
      case 'hop': {
        const h = this.hop;
        h.t += step;
        const u = Math.min(1, h.t / h.T);
        this.x = h.x0 + (h.x1 - h.x0) * u;
        this.y = h.y0 + (h.y1 - h.y0) * u - h.arc * 4 * u * (1 - u);
        if (u >= 1) {
          this.hop = null;
          this.x = h.x1;
          this.y = h.y1;
          if (h.support) {
            const seg = this.findSegment(h.support.id, this.center);
            if (seg && Math.abs(seg.y - h.support.y) <= RIDE_TOLERANCE) {
              this.landOn(seg, events, 0);
            } else {
              this.startFall('lost'); // the window went away while he was in the air
              events.push(...this.pending.splice(0));
            }
          } else {
            this.support = null;
            this.y = this.floor;
            this.mode = this.focus ? 'focus' : 'idle';
            this.idleFor = 0;
            this.nextRoamIn = 5 + this.rng() * 10;
            events.push({ type: 'landed', impact: 0, onWindow: false });
          }
        }
        break;
      }
      case 'walk': case 'run': {
        const speed = this.mode === 'run' ? RUN_SPEED : WALK_SPEED;
        const dir = Math.sign(this.targetX - this.x);
        this.x += dir * speed * step;
        if ((dir > 0 && this.x >= this.targetX) || (dir < 0 && this.x <= this.targetX) || dir === 0) {
          this.x = this.targetX;
          this.mode = this.focus ? 'focus' : 'idle';
          this.idleFor = 0;
          this.nextRoamIn = 5 + this.rng() * 10;
          events.push({ type: 'arrived', x: this.x });
        }
        break;
      }
      case 'idle': {
        if (this.paused) break;
        this.idleFor += step;
        if (this.idleFor >= this.nextRoamIn) {
          this.idleFor = 0;
          this.nextRoamIn = 5 + this.rng() * 10;
          this.roam(events);
        }
        break;
      }
      default: break;
    }
    return events;
  }

  /** True when a screen point (CSS px) is over the character box. */
  hit(px, py) {
    return px >= this.x && px <= this.x + this.size.width && py >= this.y && py <= this.y + this.size.height;
  }
}
