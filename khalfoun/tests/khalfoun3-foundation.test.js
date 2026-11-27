import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerEnv, providerKind, limitNotice } from '../src/main/brain/provider.js';
import { childEnv } from '../src/main/brain/index.js';
import { sensitiveRects, maskBitmap } from '../src/core/privacy.js';
import { migrateFromV2, v2Dir, sharedDirs } from '../src/main/migrate.js';
import { LatencyMeter, TARGETS } from '../src/core/latency.js';
import { isFast, fastPlan, splitCompound, FAST_INTENTS } from '../src/core/fast-layer.js';
import { recognize } from '../src/core/intents.js';
import { colorOf, undoFor, describeAction } from '../src/core/permissions.js';
import { createPlatform } from '../src/main/actions/platform.js';
import { createExecutor } from '../src/main/actions/index.js';

test('provider: the subscription never carries a key; the API key only when chosen and well-formed', () => {
  const base = { ANTHROPIC_API_KEY: 'sk-ant-machine', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', PATH: '/bin' };
  const sub = providerEnv('subscription', {}, base);
  assert.equal(sub.ok, true);
  assert.equal(sub.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(sub.env.CLAUDE_CODE_OAUTH_TOKEN, undefined); // Khalfoun never passes a sign-in token
  assert.equal(sub.env.PATH, '/bin');
  assert.equal(sub.env.CLAUDE_AGENT_SDK_CLIENT_APP, 'khalfoun/3');
  const key = `sk-ant-api03-${'a'.repeat(40)}`;
  assert.equal(providerEnv('apikey', { apiKey: key }, base).env.ANTHROPIC_API_KEY, key);
  assert.equal(providerEnv('apikey', { apiKey: 'hello' }, base).ok, false);
  assert.equal(providerKind({ provider: 'apikey' }), 'apikey');
  assert.equal(providerKind({}), 'subscription');
  assert.equal(childEnv(base).ANTHROPIC_API_KEY, undefined);
  assert.match(limitNotice('subscription'), /المؤقت/);
});

test('privacy: camera and video-call windows are found and painted over; others are left', () => {
  const wins = [
    { program: 'WindowsCamera', state: 'normal', rect: '100,100,640,480', title: 'الكاميرا' },
    { program: 'ApplicationFrameHost', state: 'normal', rect: '0,0,800,600', title: 'Camera' },
    { program: 'chrome', state: 'max', rect: '0,0,1920,1080', title: 'Google Meet - meet.google.com' },
    { program: 'Zoom', state: 'min', rect: '0,0,800,600', title: 'Zoom Meeting' }, // minimised: nothing to cover
    { program: 'WINWORD', state: 'max', rect: '0,0,1920,1080', title: 'الدرس - Word' },
    { program: 'Microsoft.Photos', state: 'normal', rect: '10,10,300,300', title: 'صورة' },
  ];
  const r = sensitiveRects(wins);
  assert.deepEqual(r.map((x) => x.why), ['windowscamera', 'camera', 'meeting']);
  assert.equal(sensitiveRects(wins, { photos: true }).length, 4);
  const w = 20; const h = 10; const buf = new Uint8Array(w * h * 4).fill(255);
  assert.equal(maskBitmap(buf, w, h, [{ x: 5, y: 2, w: 100, h: 3 }, { x: 50, y: 50, w: 5, h: 5 }]), 1);
  assert.equal(buf[(3 * w + 10) * 4], 70); // painted (frame colour on a thin box)
  assert.equal(buf[(0 * w + 0) * 4], 255); // outside untouched
});

test('Khalfoun 3 copies Khalfoun 2\'s data once, never changes it, never overwrites its own', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kh3-'));
  const v2 = join(root, 'Khalfoun'); const v3 = join(root, 'Khalfoun3');
  await mkdir(join(v2, 'ear'), { recursive: true });
  await writeFile(join(v2, 'memory.json'), '{"name":"شاهر"}');
  await writeFile(join(v2, 'settings.json'), '{"level":2}');
  await writeFile(join(v2, 'Local State'), '{}');
  await writeFile(join(v2, 'ear', 'khalfoun-ear.onnx'), 'x');
  await mkdir(join(v2, 'voice')); await writeFile(join(v2, 'voice', 'ggml-base.bin'), 'big');
  assert.equal(v2Dir(v3), v2);
  const r = migrateFromV2(v3);
  assert.equal(r.done, true);
  assert.deepEqual(r.copied.sort(), ['Local State', 'ear/', 'memory.json', 'settings.json'].sort());
  assert.equal(await readFile(join(v3, 'memory.json'), 'utf8'), '{"name":"شاهر"}');
  assert.ok(!existsSync(join(v3, 'voice'))); // the big download is used from Khalfoun 2's folder
  assert.deepEqual(sharedDirs(v3, 'voice'), [join(v3, 'voice'), join(v2, 'voice')]);
  assert.deepEqual((await readdir(v2)).sort(), ['Local State', 'ear', 'memory.json', 'settings.json', 'voice'].sort()); // untouched
  await writeFile(join(v3, 'memory.json'), '{"name":"جديد"}');
  assert.equal(migrateFromV2(v3).reason, 'already');
  assert.equal(await readFile(join(v3, 'memory.json'), 'utf8'), '{"name":"جديد"}');
  // a Khalfoun 3 with its own data and no mark is left alone
  const other = join(root, 'x', 'Khalfoun3'); await mkdir(other, { recursive: true }); await writeFile(join(other, 'settings.json'), '{}');
  assert.equal(migrateFromV2(other).reason, 'own_data');
});

test('latency: every answer is measured against its target', () => {
  const m = new LatencyMeter();
  for (const ms of [120, 200, 260, 900]) m.note('wake', ms);
  assert.equal(m.note('nope', 5), false);
  assert.equal(m.note('local', -1), false);
  const wake = m.report().find((r) => r.kind === 'wake');
  assert.equal(wake.target, TARGETS.wake.ms);
  assert.equal(wake.count, 4);
  assert.equal(wake.median, 260);
  assert.equal(wake.ok, true);
  assert.match(m.lines()[0], /✅/);
  assert.match(m.lines()[1], /ما انقاس/);
  const again = new LatencyMeter(JSON.parse(JSON.stringify(m)));
  assert.equal(again.report()[0].count, 4);
});

test('fast layer: known commands are done here; compound ones only when every part is known', () => {
  assert.ok(isFast(recognize('اختار طالب عشوائي')));
  assert.ok(isFast(recognize('الصفحة الجاية')));
  assert.ok(!isFast(recognize('ارسم الدالة ص = ٢س')));
  assert.deepEqual(fastPlan('شغل مؤقت ٥ دقايق واختار طالب عشوائي', recognize), ['شغل مؤقت ٥ دقايق', 'اختار طالب عشوائي']);
  assert.equal(fastPlan('افتح ملف الدرس، وروح الصفحة الخامسة، وارسم الدالة', recognize), null); // Claude takes it whole
  assert.equal(fastPlan('خلفون وقف المؤقت', recognize), null); // «وقف» is not «و + قف»
  assert.deepEqual(splitCompound('اختار طالب'), ['اختار طالب']);
  for (const i of ['timer', 'pick_student', 'award', 'screen_clear', 'key']) assert.ok(FAST_INTENTS.includes(i), i);
});

test('colours: deleting is red, closing a window is yellow, typing is green; «تراجع» knows what to undo', () => {
  const s = { level: 3 };
  assert.equal(colorOf({ type: 'delete_files', params: {} }, s), 'red');
  assert.equal(colorOf({ type: 'window_op', params: { hwnd: '1', op: 'close' } }, s), 'yellow');
  assert.equal(colorOf({ type: 'close_app', params: { app: 'word' } }, s), 'yellow');
  assert.equal(colorOf({ type: 'type_text', params: { text: 'x' } }, s), 'green');
  assert.deepEqual(undoFor({ type: 'type_text', params: { text: 'x' } }), { type: 'key_combo', params: { keys: 'ctrl+z' } });
  assert.deepEqual(undoFor({ type: 'window_op', params: { hwnd: '7', op: 'minimize' } }), { type: 'window_op', params: { hwnd: '7', op: 'restore' } });
  assert.equal(undoFor({ type: 'open_app', params: {} }), null);
  assert.match(describeAction({ type: 'office_pdf' }), /PDF/);
});

test('executor: the emergency stop blocks everything, yellow waits for the teacher, «تراجع» takes back', async () => {
  const keys = [];
  const p = createPlatform({ platform: 'win32', shell: { openExternal: async () => {}, openPath: async () => '' }, launch: async () => true, run: async () => ({ ok: true }), wait: async () => {}, paths: { downloads: '/d', documents: '/docs', pictures: '/p' } });
  let halted = false; let answer = true; const asked = [];
  const hands = { call: async (op, a) => { keys.push([op, a]); return { ok: true, data: '' }; } };
  const ex = createExecutor({
    platform: p, getSettings: () => ({ level: 3 }), downloadsDir: '/d', journal: { read: async () => ({}), write: async () => {} }, scheduleReminder: () => {},
    hands, isHalted: () => halted, softConfirm: async (a) => { asked.push(a.type); return answer; }, beforeClick: async (pt) => keys.push(['marker', pt.x]),
  });
  halted = true;
  assert.deepEqual(await ex.run({ type: 'reminder', params: { minutes: 3, note: 'x' } }), { ok: false, error: 'halted' });
  halted = false;
  answer = false;
  assert.deepEqual(await ex.run({ type: 'window_op', params: { hwnd: '12', op: 'close' } }), { ok: false, error: 'cancelled' });
  assert.deepEqual(asked, ['window_op']);
  answer = true;
  await ex.run({ type: 'mouse_click', params: { x: 10, y: 20 } });
  assert.deepEqual(keys.slice(0, 2).map((k) => k[0]), ['marker', 'click']); // the ring shows before the click
  assert.deepEqual(await ex.undo(), { ok: false, error: 'nothing' });
  await ex.run({ type: 'window_op', params: { hwnd: '12', op: 'minimize' } });
  const u = await ex.undo();
  assert.equal(u.ok, true);
  assert.deepEqual(keys.at(-1), ['win_do', { hwnd: '12', op: 'restore' }]);
  assert.deepEqual(await ex.undo(), { ok: false, error: 'nothing' }); // once
});
