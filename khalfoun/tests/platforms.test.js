import test from 'node:test';
import assert from 'node:assert/strict';
import { visiblePlatforms } from '../src/renderer/platforms.js';
import { Motion } from '../src/renderer/motion.js';

const area = { width: 1920, height: 1040 };
const size = { width: 170, height: 210 };
const run = (m, seconds, dt = 1 / 60) => { const ev = []; for (let t = 0; t < seconds; t += dt) ev.push(...m.update(dt)); return ev; };

test('window top edges become platforms; covered parts are cut away', () => {
  const wins = [
    { id: 'front', x: 500, y: 300, w: 400, h: 400 }, // on top, covers part of back's edge
    { id: 'back', x: 300, y: 400, w: 800, h: 300 },
  ];
  const p = visiblePlatforms(wins, area, size);
  assert.deepEqual(p.find((s) => s.id === 'front'), { id: 'front', x1: 500, x2: 900, y: 300 });
  const back = p.filter((s) => s.id === 'back').map((s) => [s.x1, s.x2]);
  assert.deepEqual(back, [[300, 500], [900, 1100]]);
});

test('edges too high, too low, too narrow or broken are ignored', () => {
  const wins = [
    { id: 'max', x: 0, y: 0, w: 1920, h: 1040 },
    { id: 'low', x: 100, y: 1000, w: 500, h: 40 },
    { id: 'thin', x: 100, y: 500, w: 60, h: 300 },
    { id: 'bad', x: NaN, y: 500, w: 300, h: 300 },
  ];
  assert.deepEqual(visiblePlatforms(wins, area, size), []);
  assert.deepEqual(visiblePlatforms(null, area, size), []);
});

function onWindow(rng = () => 0.5) {
  const m = new Motion(area, size, rng);
  m.setPlatforms([{ id: 7, x1: 400, x2: 1000, y: 500 }]);
  m.startDrag();
  m.dragTo(600, 200);
  m.endDrag();
  const ev = run(m, 2);
  return { m, ev };
}

test('dropped above a window he lands on it, not on the floor', () => {
  const { m, ev } = onWindow();
  assert.ok(ev.some((e) => e.type === 'landed' && e.onWindow));
  assert.equal(m.y, 500 - size.height);
  assert.deepEqual(m.support, { id: 7, y: 500 });
});

test('he walks only within the window he stands on', () => {
  const { m } = onWindow();
  m.paused = true; // no wandering off during this test
  m.walkTo(5000);
  run(m, 20);
  assert.ok(m.center <= 1000 - 12 + 0.5, `center ${m.center}`);
  m.walkTo(-5000);
  run(m, 20);
  assert.ok(m.center >= 400 + 12 - 0.5);
  assert.equal(m.y, 500 - size.height);
});

test('a window moving slowly carries him; a fast move or closing throws him off', () => {
  const { m } = onWindow();
  m.setPlatforms([{ id: 7, x1: 400, x2: 1000, y: 510 }]);
  assert.equal(m.y, 510 - size.height, 'rides small moves');
  m.setPlatforms([{ id: 7, x1: 400, x2: 1000, y: 700 }]);
  const ev = run(m, 3);
  assert.ok(ev.some((e) => e.type === 'slip' && e.reason === 'shaken'));
  assert.ok(ev.some((e) => e.type === 'landed'));
  const b = onWindow().m;
  b.setPlatforms([]);
  const ev2 = run(b, 3);
  assert.ok(ev2.some((e) => e.type === 'slip' && e.reason === 'lost'));
  assert.equal(b.y, b.floor);
  assert.equal(b.support, null);
});

test('falling off one window he can land on another below', () => {
  const { m } = onWindow();
  m.setPlatforms([{ id: 8, x1: 300, x2: 1100, y: 800 }]);
  run(m, 3);
  assert.deepEqual(m.support, { id: 8, y: 800 });
});

test('he hops up onto a nearby window by himself and back down', () => {
  const m = new Motion(area, size, () => 0.1); // low numbers: choose to hop
  m.x = 600;
  m.setPlatforms([{ id: 3, x1: 500, x2: 1100, y: 760 }]); // 280 px up: within reach
  const ev = run(m, 7);
  assert.ok(ev.some((e) => e.type === 'hop' && e.to === 3), JSON.stringify(ev.slice(0, 5)));
  assert.ok(ev.some((e) => e.type === 'landed' && e.onWindow));
  assert.ok(m.support && m.support.id === 3);
  m.paused = true;
  m.come();
  assert.equal(m.mode, 'hop');
  run(m, 3);
  assert.equal(m.support, null);
  assert.equal(m.y, m.floor);
});

test('no hopping when climbing is off or the window is out of reach', () => {
  const m = new Motion(area, size, () => 0.1);
  m.climb = false;
  m.setPlatforms([{ id: 3, x1: 500, x2: 1100, y: 700 }]);
  assert.ok(!run(m, 20).some((e) => e.type === 'hop'));
  const far = new Motion(area, size, () => 0.1);
  far.setPlatforms([{ id: 4, x1: 500, x2: 1100, y: 200 }]); // 600 px up: too high
  assert.ok(!run(far, 20).some((e) => e.type === 'hop'));
});

test('a window that disappears mid-jump makes him fall instead of floating', () => {
  const m = new Motion(area, size, () => 0.5);
  m.x = 600;
  m.setPlatforms([{ id: 3, x1: 500, x2: 1100, y: 700 }]);
  m.hopTo(650, 700 - size.height, { id: 3, y: 700 });
  run(m, 0.2);
  m.setPlatforms([]);
  const ev = run(m, 3);
  assert.ok(ev.some((e) => e.type === 'slip'));
  assert.equal(m.y, m.floor);
});
