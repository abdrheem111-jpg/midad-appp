// Body animations as pure functions of time. Each returns a partial pose the
// character rig understands (angles in degrees, offsets in SVG units).
// Pure: no DOM, so they are unit-tested in Node.

import { MORE_ANIMATIONS } from './animations-more.js';

const S = Math.sin;
const PI2 = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
const hop = (t) => 4 * t * (1 - t); // 0 -> 1 -> 0 parabola

/** @typedef {{loop: boolean, dur: number, pose: (t: number, k: number) => object}} Anim */

/** @type {Record<string, Anim>} */
export const ANIMATIONS = {
  idle: { loop: true, dur: 3.2, pose: (t) => ({ bodyY: S(t * PI2 / 3.2) * 1.2, sy: 1 + S(t * PI2 / 3.2) * 0.008, armL: S(t * 1.9) * 1.5, armR: -S(t * 1.9) * 1.5, tassel: S(t * 2.1) * 4 }) },
  walk: { loop: true, dur: 0.6, pose: (t) => { const p = (t / 0.6) * PI2; return { legL: S(p) * 22, legR: -S(p) * 22, armL: -S(p) * 14, armR: S(p) * 10, bodyY: -Math.abs(S(p)) * 4, headRot: S(p) * 2, tassel: S(p) * 10, cane: S(p) * 6 }; } },
  run: { loop: true, dur: 0.36, pose: (t) => { const p = (t / 0.36) * PI2; return { legL: S(p) * 32, legR: -S(p) * 32, armL: -S(p) * 30, armR: S(p) * 24, bodyY: -Math.abs(S(p)) * 7, rot: 6, tassel: S(p) * 18, kummaY: -Math.abs(S(p)) * 2 }; } },
  jump: { loop: false, dur: 0.9, pose: (t) => { const u = t / 0.9; const air = clamp01((u - 0.2) / 0.6); const crouch = u < 0.2 ? S((u / 0.2) * Math.PI) : u > 0.8 ? S(((u - 0.8) / 0.2) * Math.PI) : 0; return { y: -hop(air) * 70, sy: 1 - crouch * 0.18 + (air > 0 && air < 1 ? 0.06 : 0), sx: 1 + crouch * 0.1, armL: hop(air) * 120, armR: hop(air) * 120, legL: hop(air) * 12, legR: -hop(air) * 12, kummaY: -hop(air) * 10 }; } },
  celebrate: { loop: false, dur: 1.6, pose: (t) => { const u = t / 1.6; const a = clamp01(u / 0.5); const b = clamp01((u - 0.5) / 0.5); return { y: -hop(a) * 60 - hop(b) * 40, armL: 122 + S(t * 18) * 10, armR: 122 - S(t * 18) * 10, kummaY: -hop(a) * 40, kummaRot: hop(a) * 30, legL: hop(a) * 15, legR: -hop(a) * 15, fx: 'sparkles', eyeMode: 'stars', mouth: 'laugh' }; } },
  wave: { loop: false, dur: 1.6, pose: (t) => ({ armL: 112 + S(t * 12) * 18, headRot: S(t * 4) * 4, bodyRot: -3 }) },
  cast: { loop: false, dur: 1.2, pose: (t) => { const u = t / 1.2; const up = ease(clamp01(u / 0.35)); const swing = u > 0.35 ? S((u - 0.35) / 0.65 * Math.PI * 3) * 25 * (1 - u) : 0; return { armR: 115 * up + swing, cane: -30 * up, bodyRot: 3 * up, headRot: -4 * up, fx: u > 0.3 ? 'cast' : null }; } },
  think: { loop: true, dur: 2, pose: (t) => ({ armL: -116, mouth: 'smirkDown', headRot: 7 + S(t * 2) * 2, bodyRot: 2, legR: S(t * 3) * 2, glasses: true }) },
  listen: { loop: true, dur: 2, pose: (t) => ({ armL: 116, headRot: -9, bodyRot: -4 + S(t * 2) * 1, eyeMul: 1.1 }) },
  laugh: { loop: false, dur: 1.6, pose: (t) => ({ bodyY: S(t * 30) * 2, headRot: -8 + S(t * 30) * 3, rot: S(t * 15) * 2, armL: -25, armR: -25, mouth: 'laugh', eyeMode: t % 0.8 < 0.5 ? 'x' : 'arc' }) },
  dance: { loop: true, dur: 1.2, pose: (t) => { const p = (t / 1.2) * PI2; return { rot: S(p) * 8, armL: 95 + S(p * 2) * 28, armR: 95 - S(p * 2) * 28, legL: S(p) * 20, legR: S(p) * 20, y: -Math.abs(S(p)) * 14, headRot: -S(p) * 8, kummaRot: S(p) * 6, fx: 'notes', mouth: 'laugh' }; } },
  shy: { loop: false, dur: 2, pose: (t) => ({ armL: -22, armR: -22, bodyRot: S(t * 3) * 4, headRot: 10, legL: -6, legR: 6 }) },
  sulk: { loop: false, dur: 2.2, pose: () => ({ armL: -80, armR: -80, headRot: -14, bodyRot: -4, sx: 0.98 }) },
  sad: { loop: false, dur: 2.2, pose: (t) => ({ headRot: 6, headY: 4, bodyY: 2, armL: -4, armR: -4, rot: S(t * 2) * 1 }) },
  knock: { loop: true, dur: 0.8, pose: (t) => { const p = (t / 0.8) * PI2; return { armL: 100 + Math.max(0, S(p * 2)) * 22, headRot: -5, bodyRot: -3 }; } },
  sleep: { loop: true, dur: 4, pose: (t) => ({ headRot: 18, headY: 8, bodyY: 4 + S(t * PI2 / 4) * 1.5, sy: 0.96, armL: -8, armR: -8, eyesClosed: true, mouth: 'o', fx: 'zzz' }) },
  yawn: { loop: false, dur: 1.8, pose: (t) => { const u = hop(clamp01(t / 1.8)); return { armL: 128 * u, armR: 128 * u, headRot: -10 * u, mouth: u > 0.3 ? 'bigO' : null, eyesClosed: u > 0.5, sy: 1 + 0.04 * u }; } },
  stretch: { loop: false, dur: 2, pose: (t) => { const u = hop(clamp01(t / 2)); return { armL: 132 * u, armR: 132 * u, sy: 1 + 0.07 * u, sx: 1 - 0.03 * u, eyesClosed: u > 0.6 }; } },
  nod: { loop: false, dur: 0.9, pose: (t) => ({ headRot: 0, headY: Math.max(0, S(t * 14)) * 5 }) },
  shush: { loop: false, dur: 1.6, pose: () => ({ armL: -158, headRot: 4, mouth: 'pout' }) },
  alarm: { loop: false, dur: 1.6, pose: (t) => ({ rot: S(t * 40) * 6, armL: 122, armR: 122, y: -Math.abs(S(t * 20)) * 8, fx: 'exclaim' }) },
  trip: { loop: false, dur: 1.8, pose: (t) => { const u = t / 1.8; const fall = ease(clamp01(u / 0.35)); const up = ease(clamp01((u - 0.6) / 0.4)); return { rot: 70 * fall * (1 - up), y: -10 * hop(clamp01(u / 0.35)), armL: 120 * fall * (1 - up), armR: 80 * fall * (1 - up), kummaY: -18 * fall * (1 - up), kummaRot: 40 * fall * (1 - up), fx: u > 0.3 && u < 0.7 ? 'dust' : null, eyeMode: u > 0.3 && u < 0.85 ? 'spiral' : null }; } },
  dust: { loop: false, dur: 1.4, pose: (t) => ({ armL: -20 - S(t * 20) * 15, armR: -20 + S(t * 20) * 15, bodyRot: S(t * 10) * 2, headRot: 6, fx: t < 0.7 ? 'dust' : null, eyeMode: t < 0.6 ? 'spiral' : null }) },
  dangle: { loop: true, dur: 1, pose: (t) => ({ legL: S(t * 7) * 18, legR: S(t * 7 + 1.2) * 18, armL: 112 + S(t * 6) * 14, armR: 112 - S(t * 6) * 14, rot: S(t * 4) * 6, sy: 1.04, mouth: 'o' }) },
  freeze: { loop: false, dur: 1, pose: () => ({ armL: 12, armR: 12, sy: 1.02, mouth: 'flat' }) },
  // Holding a marker and writing on the board (the screen): arm out, small strokes, eyes on the work.
  write: { loop: false, dur: 2.4, pose: (t) => { const u = clamp01(t / 2.4); const up = clamp01(u / 0.15) * (1 - clamp01((u - 0.88) / 0.12)); return { armL: up * (72 + S(t * 17) * 5 + S(t * 5.3) * 3), armR: up * -6, headRot: up * -9, bodyRot: up * -3, pen: true, mouth: 'small', legL: up * 2 }; } },
  coffee: { loop: false, dur: 2.4, pose: (t) => { const u = clamp01(t / 2.4); const lift = hop(clamp01((u - 0.1) / 0.8)); return { armL: -150 * lift, headRot: -6 * lift, cup: true, eyesClosed: lift > 0.7, mouth: lift > 0.4 ? 'small' : null }; } },
  adjust: { loop: false, dur: 1.4, pose: (t) => { const u = hop(clamp01(t / 1.4)); return { armL: 160 * u, armR: 160 * u, kummaRot: S(t * 9) * 6 * u, headRot: 3 * u }; } },
  point: { loop: false, dur: 1.4, pose: () => ({ armR: 85, cane: -40, bodyRot: 4, headRot: -6 }) },
  whistle: { loop: true, dur: 2, pose: (t) => ({ mouth: 'o', headRot: S(t * 3) * 5, legR: Math.max(0, S(t * 6)) * 6, fx: 'notes' }) },
  proud: { loop: false, dur: 1.8, pose: () => ({ sy: 1.04, sx: 1.04, headRot: -6, armL: 18, armR: 18, bodyY: -2 }) },
  amazed: { loop: false, dur: 1, pose: (t) => ({ y: -hop(clamp01(t / 0.4)) * 25, rot: -4, armL: 60, armR: 60, kummaY: -hop(clamp01(t / 0.4)) * 14 }) },
  confused: { loop: false, dur: 1.8, pose: (t) => ({ armL: 160 + S(t * 14) * 8, headRot: -10 }) },
  happy: { loop: false, dur: 0.9, pose: (t) => ({ y: -hop(clamp01(t / 0.6)) * 18, armL: 30, armR: 30 }) },
  excited: { loop: false, dur: 1.4, pose: (t) => ({ y: -Math.abs(S(t * 10)) * 16, armL: 70, armR: 70 }) },
  bow: { loop: false, dur: 1.6, pose: (t) => { const u = hop(clamp01(t / 1.6)); return { bodyRot: 0, headRot: 0, headY: 10 * u, rot: 0, sy: 1 - 0.08 * u, armL: -20 * u, armR: -20 * u, eyesClosed: u > 0.5 }; } },
  clap: { loop: false, dur: 1.5, pose: (t) => { const c = Math.max(0, S(t * 22)); return { armL: -50 - c * 25, armR: -50 - c * 25, y: -Math.abs(S(t * 6)) * 6, mouth: 'grin' }; } },
  peek: { loop: false, dur: 2.2, pose: (t) => { const u = hop(clamp01(t / 2.2)); return { rot: -18 * u, headRot: -10 * u, x: -14 * u, armL: 40 * u }; } },
  spin: { loop: false, dur: 1.1, pose: (t) => { const u = ease(clamp01(t / 1.1)); return { sx: Math.cos(u * PI2 * 2), y: -hop(u) * 20, armL: 90, armR: 90, kummaY: -hop(u) * 8 }; } },
  scratch: { loop: false, dur: 1.6, pose: (t) => ({ armR: 160 + S(t * 26) * 6, cane: 60, headRot: 8, mouth: 'wavy' }) },
  sneeze: { loop: false, dur: 1.6, pose: (t) => { const u = t / 1.6; const build = clamp01(u / 0.6); const blast = u > 0.6 ? hop(clamp01((u - 0.6) / 0.25)) : 0; return { headRot: -10 * build + 22 * blast, eyesClosed: build > 0.5, mouth: blast > 0.1 ? 'bigO' : 'o', kummaY: -26 * blast, kummaRot: -20 * blast, y: -6 * blast }; } },
  flex: { loop: false, dur: 1.8, pose: (t) => ({ armL: 100 + S(t * 8) * 6, armR: 100 - S(t * 8) * 6, sy: 1.04, sx: 1.06, headRot: -5, mouth: 'cheeky' }) },
  look_around: { loop: false, dur: 2.4, pose: (t) => ({ headRot: S(t * 2.6) * 12, bodyRot: S(t * 2.6) * 2, eyeMul: 1.05 }) },
  cheeky: { loop: false, dur: 1.4, pose: (t) => ({ mouth: 'cheeky', headRot: -8 + S(t * 6) * 4, eyeMode: 'arc', armL: -20 }) },
  leap: { loop: true, dur: 0.5, pose: (t) => ({ armL: 105 + S(t * 12) * 8, armR: 105 - S(t * 12) * 8, legL: 16, legR: -16, sy: 1.05, sx: 0.97, kummaY: -3, mouth: 'o', tassel: -12 }) },
  // Omani greeting: right hand on the heart, a small bow of the head
  omani_greet: { loop: false, dur: 2, pose: (t) => { const u = hop(clamp01(t / 2)); return { armL: -100 * Math.min(1, t * 3), headY: 6 * u, headRot: 3 * u, mouth: 'smile', eyeMode: u > 0.5 ? 'arc' : null }; } },
  // inspired by the razha: cane raised and twirled, hopping steps
  cane_dance: { loop: true, dur: 1.4, pose: (t) => { const p = (t / 1.4) * PI2; return { armR: 135 + S(p * 2) * 12, cane: (t * 540) % 360, armL: 60 + S(p) * 20, y: -Math.abs(S(p * 2)) * 16, legL: S(p) * 18, legR: -S(p) * 18, headRot: S(p) * 6, kummaRot: S(p) * 5, mouth: 'laugh', fx: 'notes' }; } },
  shrug: { loop: false, dur: 1.4, pose: (t) => { const u = hop(clamp01(t / 1.4)); return { armL: 38 * u, armR: 38 * u, bodyY: -3 * u, headRot: -8 * u, mouth: 'flat' }; } },
  facepalm: { loop: false, dur: 1.8, pose: (t) => { const u = clamp01(t / 0.4) * (1 - clamp01((t - 1.4) / 0.4)); return { armL: -168 * u, headRot: 10 * u, headY: 5 * u, eyesClosed: u > 0.6, mouth: 'flat' }; } },
  shiver: { loop: false, dur: 1.8, pose: (t) => ({ x: S(t * 70) * 1.6, rot: S(t * 55) * 1.5, armL: -78, armR: -78, mouth: 'teeth', sy: 0.97 }) },
  fan: { loop: false, dur: 2.4, pose: (t) => ({ armL: -132 + S(t * 26) * 14, headRot: -6, mouth: 'o', fx: 'sweat' }) },
  tiptoe: { loop: false, dur: 2, pose: (t) => { const p = t * 9; return { sy: 1.05, legL: S(p) * 8, legR: -S(p) * 8, y: -Math.abs(S(p)) * 4, armL: 30, armR: 30, rot: -4, headRot: 8, mouth: 'pout' }; } },
  stomp: { loop: false, dur: 1.6, pose: (t) => { const p = t * 10; return { armL: -82, armR: -82, legL: Math.max(0, S(p)) * 22, legR: Math.max(0, -S(p)) * 22, y: Math.abs(S(p)) * -3, headRot: -10, mouth: 'pout', fx: 'puff' }; } },
  peekaboo: { loop: false, dur: 2.2, pose: (t) => { const hide = t < 1.2; return { armL: hide ? -160 : 70, armR: hide ? -160 : 70, eyesClosed: hide, mouth: hide ? 'small' : 'laugh', y: hide ? 0 : -hop(clamp01((t - 1.2) / 0.5)) * 18 }; } },
  heart: { loop: false, dur: 2, pose: (t) => ({ armL: -120, armR: -120, headRot: S(t * 3) * 5, mouth: 'smile', fx: 'hearts', eyeMode: 'arc' }) },
  head_shake: { loop: false, dur: 1.2, pose: (t) => ({ headRot: S(t * 18) * 12 * (1 - t / 1.2), mouth: 'flat' }) },
  bounce: { loop: false, dur: 1.6, pose: (t) => ({ y: -Math.abs(S(t * 8)) * 10, sy: 1 + S(t * 16) * 0.03, armL: 20, armR: 20 }) },
  cheer: { loop: false, dur: 1.6, pose: (t) => ({ armL: 128 + S(t * 14) * 18, armR: 128 - S(t * 14) * 18, y: -Math.abs(S(t * 7)) * 14, mouth: 'laugh', fx: 'sparkles' }) },
  idea: { loop: false, dur: 1.6, pose: (t) => ({ armR: 150, cane: -50, y: -hop(clamp01(t / 0.5)) * 14, mouth: 'grin', fx: 'exclaim', eyeMode: t > 0.3 && t < 1 ? 'stars' : null }) },
  read: { loop: true, dur: 3, pose: (t) => ({ armL: -100, headY: 4, headRot: 4 + S(t * 1.5) * 2, glasses: true, mouth: 'small' }) },
  sway: { loop: true, dur: 2.4, pose: (t) => { const p = (t / 2.4) * PI2; return { rot: S(p) * 5, headRot: -S(p) * 6, armL: 20 + S(p) * 10, armR: 20 - S(p) * 10, mouth: 'smile', fx: 'notes' }; } },
  calm: { loop: false, dur: 0.6, pose: () => ({}) },
  wake: { loop: false, dur: 1.2, pose: (t) => ({ y: -hop(clamp01(t / 0.5)) * 30, armL: 90, armR: 90, fx: t < 0.6 ? 'exclaim' : null }) },
};

/** The animation that shows an emotion when the brain gives no explicit hint. */
// Khalfoun 3.1: the big library of extra moves joins the core ones (a core move keeps its name).
for (const [name, a] of Object.entries(MORE_ANIMATIONS)) if (!ANIMATIONS[name]) ANIMATIONS[name] = a;

/** Every move with a few Arabic words about it (for Claude's tool description and the teacher). */
export const MOVE_NAMES = Object.keys(ANIMATIONS);

export const EMOTION_ANIMATION = {
  calm: null, happy: 'happy', proud: 'proud', excited: 'excited', amazed: 'amazed', curious: 'think',
  focused: 'cast', confused: 'confused', shy: 'shy', grateful: 'nod', longing: 'celebrate', sad: 'sad',
  sulky: 'sulk', jealous: 'sulk', scared: 'amazed', bored: 'yawn', sleepy: 'sleep',
};

export function resolveAnimation(name) {
  return name && Object.hasOwn(ANIMATIONS, name) ? name : null;
}

/**
 * Plays animations on top of a looping base (idle/walk/run/sleep/dangle).
 */
export class Animator {
  constructor() {
    this.base = 'idle';
    this.baseT = 0;
    this.action = null; // {name, t}
  }

  setBase(name) {
    const n = resolveAnimation(name) || 'idle';
    if (n !== this.base) { this.base = n; this.baseT = 0; }
  }

  /** Plays a one-shot (or looping, for `holdSec`) action over the base. */
  play(name, holdSec = 0) {
    const n = resolveAnimation(name);
    if (!n) return false;
    this.action = { name: n, t: 0, hold: holdSec || (ANIMATIONS[n].loop ? 3 : 0) };
    return true;
  }

  stop() { this.action = null; }

  get playing() { return this.action ? this.action.name : null; }

  /** Advances time and returns the merged pose. */
  update(dt) {
    this.baseT += dt;
    const base = ANIMATIONS[this.base].pose(this.baseT, 1);
    if (!this.action) return base;
    this.action.t += dt;
    const anim = ANIMATIONS[this.action.name];
    const limit = anim.loop ? this.action.hold : anim.dur;
    if (this.action.t >= limit) {
      this.action = null;
      return base;
    }
    const pose = anim.pose(this.action.t, 1);
    // Legs keep walking under an upper-body action while moving.
    const moving = this.base === 'walk' || this.base === 'run';
    const merged = { ...base, ...pose };
    if (moving) { merged.legL = base.legL; merged.legR = base.legR; merged.y = base.y; }
    return merged;
  }
}
