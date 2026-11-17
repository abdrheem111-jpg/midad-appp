// Where Khalfoun is and how he moves around the screen: roaming along the
// floor (the top of the taskbar), running when called, falling with gravity
// after being dropped, staying in a corner in focus mode. Pure: unit-tested.

const GRAVITY = 2600; // px/s^2
const WALK_SPEED = 75; // px/s
const RUN_SPEED = 260;

export class Motion {
  /**
   * @param {{width: number, height: number}} area usable screen area (CSS px)
   * @param {{width: number, height: number}} size character box size
   * @param {() => number} [rng]
   */
  constructor(area, size, rng = Math.random) {
    this.rng = rng;
    this.size = size;
    this.setArea(area);
    this.x = Math.round(this.area.width * 0.7);
    this.y = this.floor;
    this.vy = 0;
    this.mode = 'idle'; // idle | walk | run | fall | drag | sleep | focus
    this.targetX = this.x;
    this.facing = -1;
    this.idleFor = 0;
    this.nextRoamIn = 4 + rng() * 6;
    this.paused = false; // true while talking or busy
    this.focus = false;
  }

  setArea(area) {
    this.area = { width: Math.max(area.width, this.size.width), height: Math.max(area.height, this.size.height) };
    this.floor = this.area.height - this.size.height;
    this.maxX = this.area.width - this.size.width;
    if (this.x !== undefined) {
      this.x = Math.min(Math.max(0, this.x), this.maxX);
      if (this.mode !== 'drag' && this.mode !== 'fall') this.y = this.floor;
    }
  }

  /** Base animation that matches the movement. */
  get baseAnimation() {
    switch (this.mode) {
      case 'walk': return 'walk';
      case 'run': return 'run';
      case 'fall': case 'drag': return 'dangle';
      case 'sleep': return 'sleep';
      default: return 'idle';
    }
  }

  walkTo(x, run = false) {
    if (this.mode === 'drag' || this.mode === 'fall') return;
    this.targetX = Math.min(Math.max(0, x), this.maxX);
    if (Math.abs(this.targetX - this.x) < 2) { this.mode = this.focus ? 'focus' : 'idle'; return; }
    this.facing = this.targetX > this.x ? 1 : -1;
    this.mode = run ? 'run' : 'walk';
  }

  /** Runs to the middle of the floor. */
  come() {
    this.focus = false;
    this.walkTo(this.area.width / 2 - this.size.width / 2, true);
  }

  /** Goes to the bottom-right corner and stays there quietly. */
  goAway() {
    this.focus = true;
    this.walkTo(this.maxX, false);
  }

  sleep() { if (this.mode !== 'drag' && this.mode !== 'fall') this.mode = 'sleep'; }

  wake() { if (this.mode === 'sleep') this.mode = this.focus ? 'focus' : 'idle'; this.idleFor = 0; }

  stop() {
    if (this.mode === 'walk' || this.mode === 'run') this.mode = this.focus ? 'focus' : 'idle';
    this.targetX = this.x;
  }

  startDrag() { this.mode = 'drag'; this.vy = 0; }

  dragTo(x, y) {
    if (this.mode !== 'drag') return;
    this.x = Math.min(Math.max(0, x), this.maxX);
    this.y = Math.min(Math.max(0, y), this.floor);
  }

  endDrag() {
    if (this.mode !== 'drag') return;
    this.mode = this.y < this.floor - 1 ? 'fall' : (this.focus ? 'focus' : 'idle');
    this.vy = 0;
  }

  /**
   * Advances the simulation.
   * @param {number} dt seconds
   * @returns {Array<{type: string, [k: string]: any}>} events: landed, arrived, roam
   */
  update(dt) {
    const events = [];
    const step = Math.min(dt, 0.05);
    switch (this.mode) {
      case 'fall': {
        this.vy += GRAVITY * step;
        this.y += this.vy * step;
        if (this.y >= this.floor) {
          const impact = this.vy;
          this.y = this.floor;
          if (impact > 900) {
            this.vy = -impact * 0.28; // one small bounce
          } else {
            this.vy = 0;
            this.mode = this.focus ? 'focus' : 'idle';
            this.idleFor = 0;
            events.push({ type: 'landed', impact });
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
          const span = Math.min(this.area.width * 0.4, 500);
          let x = this.x + (this.rng() * 2 - 1) * span;
          if (x < 0 || x > this.maxX) x = this.x - (x - this.x);
          this.walkTo(x);
          if (this.mode === 'walk') events.push({ type: 'roam', to: this.targetX });
          else { this.idleFor = 0; this.nextRoamIn = 3 + this.rng() * 5; }
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
