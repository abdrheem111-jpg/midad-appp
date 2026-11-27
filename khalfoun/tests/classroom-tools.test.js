import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import selfsigned from 'selfsigned';
import { decodeYunet, mergeFaces, tilesFor, chooseFace, sureFaces, SENSITIVITY, YUNET_SIZE } from '../src/core/faces.js';
import { parse, evaluate, roots, paramsOf, autoRange, niceStep, prepare } from '../src/core/math-expr.js';
import { stepWord } from '../src/renderer/steps.js';
import { createPhoneMic, PHONE_COMMANDS, signPhone } from '../src/main/phone-mic.js';
import { normalize } from '../src/core/arabic.js';

// ---------------------------------------------------------------- faces (camera pick)

function yunetOut(cells) {
  // fake YuNet outputs: a face in each given stride-32 cell
  const out = {};
  for (const st of [8, 16, 32]) {
    const n = (YUNET_SIZE / st) ** 2;
    out[`cls_${st}`] = { data: new Float32Array(n) }; out[`obj_${st}`] = { data: new Float32Array(n) };
    out[`bbox_${st}`] = { data: new Float32Array(n * 4) }; out[`kps_${st}`] = { data: new Float32Array(n * 10) };
  }
  for (const [r, c, score] of cells) {
    const i = r * 20 + c;
    out.cls_32.data[i] = score; out.obj_32.data[i] = score;
  }
  return out;
}

test('faces: YuNet outputs become boxes where the faces are', () => {
  const f = decodeYunet(yunetOut([[2, 3, 0.9], [10, 15, 0.8], [5, 5, 0.2]]), 0.5);
  assert.equal(f.length, 2);
  assert.deepEqual([f[0].x, f[0].y, f[0].w, f[0].h], [3 * 32 - 16, 2 * 32 - 16, 32, 32]);
  assert.ok(Math.abs(f[0].score - 0.9) < 1e-6);
});

test('faces: tiles from several views merge into one box per face; odd shapes and tiny boxes in a row are dropped', () => {
  const face = { x: 100, y: 100, w: 30, h: 36, score: 0.9 };
  const dupe = { x: 102, y: 101, w: 29, h: 35, score: 0.8 }; // the same face seen in a tile
  const thin = { x: 300, y: 100, w: 30, h: 90, score: 0.9 }; // not a face shape
  assert.deepEqual(mergeFaces([dupe, face, thin]), [face]);
  const row = Array.from({ length: 7 }, (_, i) => ({ x: 50 + i * 60, y: 200, w: 30, h: 34, score: 0.9 }));
  const tiny = { x: 470, y: 205, w: 10, h: 12, score: 0.9 }; // a tie or a hand in that row
  assert.equal(mergeFaces([...row, tiny]).length, 7);
  // views: the whole photo and an overlapping grid
  const v = tilesFor(2000, 1200, 3);
  assert.equal(v.length, 10);
  assert.deepEqual(v[0], { x: 0, y: 0, w: 2000, h: 1200 });
  assert.ok(v.slice(1).every((t) => t.x >= 0 && t.y >= 0 && t.x + t.w <= 2000 && t.y + t.h <= 1200));
  assert.equal(v.at(-1).x + v.at(-1).w, 2000);
  assert.ok(SENSITIVITY.max.threshold < SENSITIVITY.normal.threshold && SENSITIVITY.max.grid > SENSITIVITY.normal.grid);
});

test('faces: the pick is fair: nobody twice while others are left, then everyone again', () => {
  const faces = [0, 1, 2].map((i) => ({ x: 100 + i * 300, y: 100, w: 40, h: 46, score: 0.9 }));
  const picked = [];
  const seen = new Set();
  for (let k = 0; k < 3; k += 1) {
    const f = chooseFace(faces, picked, { width: 1000, height: 400 });
    assert.ok(!seen.has(f.x), 'chosen twice');
    seen.add(f.x);
    picked.push({ x: (f.x + f.w / 2) / 1000, y: (f.y + f.h / 2) / 400 });
  }
  assert.ok(chooseFace(faces, picked, { width: 1000, height: 400 })); // all had a turn: any again
  // unsure boxes are left out when there are enough sure faces
  assert.equal(sureFaces([...faces, { x: 5, y: 5, w: 20, h: 22, score: 0.5 }]).length, 3);
  assert.equal(sureFaces([{ x: 5, y: 5, w: 20, h: 22, score: 0.5 }]).length, 1);
  assert.equal(chooseFace([], [], { width: 1, height: 1 }), null);
});

// ---------------------------------------------------------------- live graphs

test('graphs: the teacher\'s way of writing functions is read safely', () => {
  const at = (e, x, p) => evaluate(parse(e), x, p);
  assert.equal(at('ص = ٢س² − ٣س + ١', 2), 3);
  assert.equal(at('جا س', Math.PI / 2), 1);
  assert.equal(at('2(x+1)', 1), 4);
  assert.equal(at('x(x-1)', 3), 6);
  assert.equal(at('|x-3|', 1), 2);
  assert.equal(at('أس + ب', 2, { a: 3, b: -1 }), 5);
  assert.equal(at('2^x', 3), 8);
  assert.equal(at('-x^2', 3), -9);
  assert.ok(Number.isNaN(at('1/x', 0)));
  assert.deepEqual(roots(parse('x^2 - 4'), -10, 10), [-2, 2]);
  assert.deepEqual(paramsOf(parse('a x^2 + b x')), ['a', 'b']);
  assert.match(prepare('ص = ٣س + ٢'), /^3 x \+ 2$/);
  // nothing but maths
  for (const bad of ['process.exit()', 'x+', '(x', 'alert`1`', 'x;y']) assert.throws(() => parse(bad), bad);
  const [lo, hi] = autoRange([parse('x^2')], -3, 3);
  assert.ok(lo < 0 && hi >= 9 * 0.9);
  assert.equal(niceStep(20, 10), 2);
});

// ---------------------------------------------------------------- steps

test('steps: «كمل» / «ارجع» move the steps; «كمل وراي» is not a step word', () => {
  assert.equal(stepWord(normalize('كمل')), 'next');
  assert.equal(stepWord(normalize('الخطوة الجاية')), 'next');
  assert.equal(stepWord(normalize('يا خلفون اللي بعده')), 'next');
  assert.equal(stepWord(normalize('ارجع')), 'back');
  assert.equal(stepWord(normalize('الخطوة السابقة')), 'back');
  assert.equal(stepWord(normalize('كمل وراي')), null);
  assert.equal(stepWord(normalize('ارجع للصفحة الأولى')), null);
});

// ---------------------------------------------------------------- the phone's new buttons

function call(url, { method = 'GET', body, type } = {}) {
  return new Promise((resolve, reject) => {
    const headers = type ? { 'content-type': type } : {};
    const u = new URL(url); const k = u.searchParams.get('k');
    if (k !== null && !(method === 'GET' && u.pathname === '/')) {
      u.searchParams.delete('k'); const ts = Date.now();
      headers['x-kh-ts'] = String(ts); headers['x-kh-sig'] = signPhone(k, method, u.pathname, u.searchParams, ts);
      url = u.toString();
    }
    const req = request(url, { method, rejectUnauthorized: false, headers }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('phone: control buttons (only known ones), whisper, photos (only pictures), state shown back', async () => {
  const got = { cmd: [], whisper: [], photo: [] };
  const mic = createPhoneMic({
    dir: await mkdtemp(join(tmpdir(), 'kh-phone2-')), pagePath: new URL('../src/phone/index.html', import.meta.url),
    makeCert: (a, o) => selfsigned.generate(a, o), toQr: async (u) => u,
    onAudio() {}, onSay() {}, onStatus() {},
    onCommand: (n) => got.cmd.push(n), onWhisper: (t) => got.whisper.push(t), onPhoto: (p, b) => got.photo.push([p, b.length]),
    getState: () => ({ muted: true, bubbleHidden: false, step: 2, steps: 5 }),
    addresses: () => [{ address: '127.0.0.1' }], ports: [0],
  });
  const info = await mic.start();
  const base = info.url.split('?')[0];
  const key = new URL(info.url).searchParams.get('k');
  try {
    const page = await call(info.url);
    for (const id of ['step_next', 'step_back', 'mute', 'bubble', 'random_student', 'data-photo="pick"', 'data-photo="doc"', 'data-photo="grade"', 'whisper']) assert.ok(page.text.includes(id), id);
    const r = await call(`${base}cmd?k=${key}&name=mute`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text).state, { muted: true, bubbleHidden: false, step: 2, steps: 5 });
    assert.equal((await call(`${base}cmd?k=${key}&name=format_disk`, { method: 'POST' })).status, 400);
    assert.equal((await call(`${base}cmd?k=bad&name=mute`, { method: 'POST' })).status, 403);
    assert.equal((await call(`${base}whisper?k=${key}`, { method: 'POST', body: 'ارسم مثلث\u0000', type: 'text/plain;charset=utf-8' })).status, 204);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500)]);
    assert.equal((await call(`${base}photo?k=${key}&purpose=pick`, { method: 'POST', body: jpeg })).status, 204);
    assert.equal((await call(`${base}photo?k=${key}&purpose=pick`, { method: 'POST', body: Buffer.alloc(500) })).status, 400); // not a picture
    assert.equal((await call(`${base}photo?k=${key}&purpose=upload`, { method: 'POST', body: jpeg })).status, 400);
    const hello = JSON.parse((await call(`${base}hello?k=${key}`, { method: 'POST' })).text);
    assert.equal(hello.state.steps, 5);
    assert.deepEqual(got.cmd, ['mute']);
    assert.deepEqual(got.whisper, ['ارسم مثلث']);
    assert.deepEqual(got.photo, [['pick', 504]]);
    assert.ok(PHONE_COMMANDS.includes('step_next') && PHONE_COMMANDS.includes('bubble'));
  } finally { mic.stop(); }
});

test('the overlay page may show photos made on the spot (notebook from the phone, class photo)', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const img = /img-src ([^;]+);/.exec(html)[1];
  assert.match(img, /\bblob:/);
  assert.doesNotMatch(img, /\*|https?:/); // still nothing from the internet
});
