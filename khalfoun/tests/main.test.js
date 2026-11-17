import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { organizeFolder, undoMoves, categoryFor } from '../src/main/actions/organize.js';
import { createPlatform, SEARCH_URLS } from '../src/main/actions/platform.js';
import { createExecutor, validateAction } from '../src/main/actions/index.js';
import { findWhisper, cleanTranscript, transcribe } from '../src/main/stt.js';
import { JsonStore } from '../src/main/storage.js';
import { encodeWav, downsample, rms } from '../src/renderer/wav.js';

const tmp = () => mkdtemp(join(tmpdir(), 'khalfoun-test-'));

test('organize moves known types into Arabic folders and undo restores them', async () => {
  const dir = await tmp();
  for (const f of ['صورة.JPG', 'تقرير.pdf', 'اغنية.mp3', 'برنامج.exe', 'مجهول.xyz', '.hidden.png', 'تحميل.crdownload', 'desktop.ini']) await writeFile(join(dir, f), 'x');
  await mkdir(join(dir, 'مجلد قديم'));
  await mkdir(join(dir, 'صور'));
  await writeFile(join(dir, 'صور', 'صورة.JPG'), 'old');
  const { moves } = await organizeFolder(dir);
  assert.equal(moves.length, 4);
  assert.deepEqual((await readdir(join(dir, 'صور'))).sort(), ['صورة (2).JPG', 'صورة.JPG'].sort());
  assert.equal(await readFile(join(dir, 'صور', 'صورة.JPG'), 'utf8'), 'old', 'never overwrites');
  const left = await readdir(dir);
  for (const f of ['مجهول.xyz', '.hidden.png', 'تحميل.crdownload', 'desktop.ini', 'مجلد قديم']) assert.ok(left.includes(f), `${f} must stay`);
  const { restored } = await undoMoves(moves);
  assert.equal(restored, 4);
  assert.ok((await readdir(dir)).includes('تقرير.pdf'));
  await rm(dir, { recursive: true, force: true });
});

test('undo never overwrites a file that came back in the meantime', async () => {
  const dir = await tmp();
  await writeFile(join(dir, 'a.pdf'), 'one');
  const { moves } = await organizeFolder(dir);
  await writeFile(join(dir, 'a.pdf'), 'new');
  const r = await undoMoves(moves);
  assert.deepEqual(r, { restored: 0, failed: 1 });
  assert.equal(await readFile(join(dir, 'a.pdf'), 'utf8'), 'new');
  await rm(dir, { recursive: true, force: true });
});

test('categoryFor', () => {
  assert.equal(categoryFor('x.DOCX'), 'مستندات');
  assert.equal(categoryFor('x.mkv'), 'فيديو');
  assert.equal(categoryFor('x'), null);
});

function fakePlatform(platform, extra = {}) {
  const calls = [];
  const shell = { openExternal: async (u) => { calls.push(['external', u]); }, openPath: async (p) => { calls.push(['path', p]); return ''; } };
  const p = createPlatform({
    platform,
    shell,
    launch: async (cmd, args, opts) => { calls.push(['launch', cmd, args, opts]); return true; },
    run: async (cmd, args) => { calls.push(['run', cmd, args]); return { ok: true }; },
    wait: async () => {},
    paths: { downloads: '/d', documents: '/docs', pictures: '/pics' },
    ...extra,
  });
  return { p, calls };
}

test('windows: apps start from the fixed list through start, volume uses media keys', async () => {
  const { p, calls } = fakePlatform('win32');
  assert.deepEqual(await p.openApp('word'), { ok: true });
  assert.deepEqual(calls[0], ['launch', 'cmd.exe', ['/d', '/c', 'start "" winword'], { windowsVerbatimArguments: true }]);
  await p.openApp('browser');
  assert.deepEqual(calls[1], ['external', 'https://www.google.com']);
  await p.openApp('settings');
  assert.deepEqual(calls[2], ['external', 'ms-settings:']);
  assert.equal((await p.openApp('hacker')).ok, false);
  await p.volume('up');
  assert.equal(calls[3][1], 'powershell.exe');
  assert.match(calls[3][2].at(-1), /\[char\]175/);
  await p.volume('mute');
  assert.match(calls[4][2].at(-1), /1\.\.1 .*\[char\]173/);
});

test('search urls are encoded', async () => {
  const { p, calls } = fakePlatform('win32');
  await p.search('مطاعم & مسقط', 'youtube');
  assert.equal(calls[0][1], SEARCH_URLS.youtube('مطاعم & مسقط'));
  assert.ok(!calls[0][1].includes(' '));
  assert.ok(calls[0][1].includes('%26'));
});

test('typing pastes through the clipboard and restores it', async () => {
  let clip = 'قديم';
  let released = 0;
  const { p, calls } = fakePlatform('win32', { clipboard: { readText: () => clip, writeText: (t) => { clip = t; } }, beforeType: () => { released += 1; } });
  const r = await p.typeText('مرحبا');
  assert.deepEqual(r, { ok: true });
  assert.equal(released, 1);
  assert.match(calls[0][2].at(-1), /\^v/);
  assert.equal(clip, 'قديم');
});

test('linux and mac fall back sensibly', async () => {
  const lin = fakePlatform('linux', { home: '/home/me' });
  await lin.p.openApp('explorer');
  assert.deepEqual(lin.calls[0].slice(0, 3), ['launch', 'xdg-open', ['/home/me']]);
  await lin.p.volume('down');
  assert.deepEqual(lin.calls[1], ['run', 'pactl', ['set-sink-volume', '@DEFAULT_SINK@', '-10%']]);
  const mac = fakePlatform('darwin');
  await mac.p.openApp('calculator');
  assert.deepEqual(mac.calls[0], ['run', 'open', ['-a', 'Calculator']]);
});

test('screenshot is saved into Pictures/خلفون', async () => {
  const dir = await tmp();
  const { p } = fakePlatform('win32', { paths: { pictures: dir }, capture: async () => Buffer.from('png') });
  const r = await p.screenshot(new Date(2026, 10, 17, 9, 5, 3));
  assert.ok(r.ok);
  assert.ok(r.data.file.endsWith(join('خلفون', 'لقطة-20261117-090503.png')), r.data.file);
  await rm(dir, { recursive: true, force: true });
});

test('validateAction rejects anything outside the allowed lists', () => {
  assert.equal(validateAction(null), 'bad_action');
  assert.equal(validateAction({ type: 'open_app', params: { app: 'calculator' } }), null);
  assert.equal(validateAction({ type: 'open_app', params: { app: 'cmd' } }), 'bad_app');
  assert.equal(validateAction({ type: 'open_url', params: { url: 'https://www.youtube.com' } }), null);
  assert.equal(validateAction({ type: 'open_url', params: { url: 'file:///etc/passwd' } }), 'bad_url');
  assert.equal(validateAction({ type: 'open_folder', params: { folder: '../../' } }), 'bad_folder');
  assert.equal(validateAction({ type: 'search', params: { query: '', engine: 'google' } }), 'bad_search');
  assert.equal(validateAction({ type: 'search', params: { query: 'x', engine: 'bing' } }), 'bad_search');
  assert.equal(validateAction({ type: 'volume', params: { direction: 'loud' } }), 'bad_volume');
  assert.equal(validateAction({ type: 'type_text', params: { text: 'x'.repeat(2001) } }), 'bad_text');
  assert.equal(validateAction({ type: 'reminder', params: { minutes: 0 } }), 'bad_reminder');
  assert.equal(validateAction({ type: 'reminder', params: { minutes: 5, note: 'x' } }), null);
  assert.equal(validateAction({ type: 'rm', params: {} }), 'unknown_action');
});

test('executor enforces the permission level stored in main', async () => {
  const { p } = fakePlatform('win32');
  let settings = { level: 1, kidsMode: false };
  const reminders = [];
  const ex = createExecutor({ platform: p, getSettings: () => settings, downloadsDir: '/d', journal: { read: async () => ({}), write: async () => {} }, scheduleReminder: (m, n) => reminders.push([m, n]) });
  assert.deepEqual(await ex.run({ type: 'open_app', params: { app: 'calculator' } }), { ok: false, error: 'level_too_low' });
  assert.deepEqual(await ex.run({ type: 'reminder', params: { minutes: 3, note: 'شاي' } }), { ok: true });
  assert.deepEqual(reminders, [[3, 'شاي']]);
  settings = { level: 2, kidsMode: true };
  assert.deepEqual(await ex.run({ type: 'type_text', params: { text: 'x' } }), { ok: false, error: 'kids_mode' });
  assert.deepEqual(await ex.run({ type: 'open_app', params: { app: 'calculator' } }), { ok: true });
});

test('executor reports platform failures instead of throwing', async () => {
  const broken = { openApp: async () => { throw new Error('boom'); } };
  const ex = createExecutor({ platform: broken, getSettings: () => ({ level: 3 }), downloadsDir: '/d', journal: null, scheduleReminder: () => {} });
  assert.deepEqual(await ex.run({ type: 'open_app', params: { app: 'notepad' } }), { ok: false, error: 'boom' });
});

test('whisper is found in a voice folder and transcripts are cleaned', async () => {
  const dir = await tmp();
  assert.equal((await findWhisper({ dirs: [dir], env: {} })).available, false);
  await writeFile(join(dir, 'whisper-cli'), '');
  await writeFile(join(dir, 'ggml-tiny.bin'), '');
  await writeFile(join(dir, 'ggml-small.bin'), '');
  const w = await findWhisper({ dirs: ['/nope', dir], env: {} });
  assert.equal(w.available, true);
  assert.ok(w.model.endsWith('ggml-small.bin'), 'prefers the better model');
  assert.equal(cleanTranscript(' [موسيقى] افتح  الحاسبة (تصفيق) '), 'افتح الحاسبة');
  const fakeRun = (bin, args, opts, cb) => { assert.ok(args.includes('ar')); cb(null, ' افتح المتصفح\n'); };
  assert.deepEqual(await transcribe(w, encodeWav(new Float32Array(1600), 16000), { run: fakeRun }), { ok: true, text: 'افتح المتصفح' });
  assert.equal((await transcribe({ bin: null, model: null }, new Uint8Array(100))).error, 'stt_unavailable');
  assert.equal((await transcribe(w, new Uint8Array(10), { run: fakeRun })).error, 'bad_audio');
  await rm(dir, { recursive: true, force: true });
});

test('JSON store writes atomically and survives broken files', async () => {
  const dir = await tmp();
  const s = new JsonStore(dir, 'x.json', { a: 1 });
  assert.deepEqual(await s.read(), { a: 1 });
  await Promise.all([s.write({ a: 2 }), s.write({ a: 3 })]);
  assert.deepEqual(await s.read(), { a: 3 });
  await writeFile(join(dir, 'x.json'), '{broken');
  assert.deepEqual(await s.read(), { a: 1 });
  await rm(dir, { recursive: true, force: true });
});

test('wav encoding, downsampling and loudness', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getInt16(46, true), 32767);
  assert.equal(v.getInt16(48, true), -32768);
  assert.equal(downsample(new Float32Array(48000), 48000, 16000).length, 16000);
  assert.equal(rms(new Float32Array([1, -1])), 1);
});
