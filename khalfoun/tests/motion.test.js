import test from 'node:test';
import assert from 'node:assert/strict';
import { Motion } from '../src/renderer/motion.js';
import { ANIMATIONS, Animator, EMOTION_ANIMATION, resolveAnimation } from '../src/renderer/animations.js';
import { TEMPLATES } from '../src/core/templates/ar-om.js';
import { EMOTIONS } from '../src/core/emotions.js';

const area = { width: 1920, height: 1040 };
const size = { width: 170, height: 210 };
const run = (m, seconds, dt = 1 / 60) => { const ev = []; for (let t = 0; t < seconds; t += dt) ev.push(...m.update(dt)); return ev; };

test('starts standing on the floor inside the screen', () => {
  const m = new Motion(area, size, () => 0.5);
  assert.equal(m.y, area.height - size.height);
  assert.ok(m.x >= 0 && m.x <= area.width - size.width);
});

test('walks to a target and reports arrival', () => {
  const m = new Motion(area, size, () => 0.5);
  m.walkTo(100);
  assert.equal(m.mode, 'walk');
  assert.equal(m.facing, -1);
  const ev = run(m, 30);
  assert.ok(ev.some((e) => e.type === 'arrived'));
  assert.equal(m.x, 100);
});

test('never leaves the screen even when asked to', () => {
  const m = new Motion(area, size, () => 0.5);
  m.walkTo(-500);
  run(m, 40);
  assert.equal(m.x, 0);
  m.walkTo(99999, true);
  run(m, 20);
  assert.equal(m.x, area.width - size.width);
});

test('dropped from high falls, bounces, lands with an event', () => {
  const m = new Motion(area, size, () => 0.5);
  m.startDrag();
  m.dragTo(500, 50);
  assert.equal(m.y, 50);
  m.endDrag();
  assert.equal(m.mode, 'fall');
  const ev = run(m, 3);
  const landed = ev.find((e) => e.type === 'landed');
  assert.ok(landed, 'should land');
  assert.equal(m.y, m.floor);
  assert.equal(m.mode, 'idle');
});

test('roams on his own after a while, but not when paused or focused', () => {
  const m = new Motion(area, size, () => 0.9);
  const ev = run(m, 20);
  assert.ok(ev.some((e) => e.type === 'roam'));
  const p = new Motion(area, size, () => 0.9);
  p.paused = true;
  assert.equal(run(p, 20).filter((e) => e.type === 'roam').length, 0);
  const f = new Motion(area, size, () => 0.9);
  f.goAway();
  run(f, 40);
  assert.equal(f.mode, 'focus');
  assert.equal(f.x, area.width - size.width);
  assert.equal(run(f, 30).filter((e) => e.type === 'roam').length, 0);
  f.come();
  assert.equal(f.mode, 'run');
});

test('sleep and wake, and resizing keeps him visible', () => {
  const m = new Motion(area, size);
  m.sleep();
  assert.equal(m.baseAnimation, 'sleep');
  m.wake();
  assert.equal(m.mode, 'idle');
  m.x = 1700;
  m.setArea({ width: 800, height: 600 });
  assert.equal(m.x, 800 - size.width);
  assert.equal(m.y, 600 - size.height);
  assert.ok(m.hit(m.x + 10, m.y + 10));
  assert.ok(!m.hit(0, 0));
});

test('every animation produces finite numbers for its whole duration', () => {
  for (const [name, anim] of Object.entries(ANIMATIONS)) {
    for (let t = 0; t <= anim.dur * 1.5; t += anim.dur / 25) {
      const pose = anim.pose(t, 1);
      for (const [k, v] of Object.entries(pose)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}.${k} at ${t} = ${v}`);
      }
    }
  }
  assert.ok(Object.keys(ANIMATIONS).length >= 60, `${Object.keys(ANIMATIONS).length} animations`);
});

test('every animation hint in the reply bank and every emotion has an animation', () => {
  for (const t of TEMPLATES) if (t.a) assert.ok(resolveAnimation(t.a), `missing animation "${t.a}" (template ${t.id})`);
  for (const e of EMOTIONS) {
    assert.ok(e in EMOTION_ANIMATION, `emotion ${e} not mapped`);
    const a = EMOTION_ANIMATION[e];
    if (a) assert.ok(resolveAnimation(a), `emotion ${e} -> ${a}`);
  }
  assert.equal(resolveAnimation('toString'), null);
});

test('animator plays one-shots over the base and returns to it', () => {
  const a = new Animator();
  a.setBase('walk');
  assert.ok(a.play('wave'));
  assert.equal(a.playing, 'wave');
  const mid = a.update(0.5);
  assert.ok(mid.armL > 100, 'arm is raised while waving');
  assert.ok('legL' in mid, 'legs keep walking');
  a.update(2);
  assert.equal(a.playing, null);
  assert.equal(a.play('nope'), false);
});
