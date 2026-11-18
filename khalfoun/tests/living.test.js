// Living Khalfoun: what he notices on the desktop and the games he plays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWindow, shortTitle, DesktopWatcher, downloadKind, PARTIAL_DOWNLOAD } from '../src/core/desktop.js';
import { Brain } from '../src/core/brain.js';
import { defaultMemory } from '../src/core/memory.js';
import { recognize } from '../src/core/intents.js';
import { validateAction, createExecutor } from '../src/main/actions/index.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('windows are recognised from their titles', () => {
  const cases = [['ورقة عمل.pdf - Adobe Acrobat Reader', 'pdf'], ['الدرس.docx - Word', 'word'], ['Untitled - Notepad', 'notepad'], ['(1) YouTube - Google Chrome', 'youtube'],
    ['عرض.pptx - PowerPoint', 'powerpoint'], ['درجات.xlsx - Excel', 'excel'], ['Calculator', 'calculator'], ['New tab - Microsoft Edge', 'browser'], ['Zoom Meeting', 'meeting'], ['Spotify Premium', 'other']];
  for (const [t, kind] of cases) assert.equal(classifyWindow(t), kind, t);
  assert.equal(shortTitle('ورقة عمل.pdf - Adobe Acrobat Reader'), 'ورقة عمل.pdf');
  assert.equal(downloadKind('درس.PDF'), 'pdf');
  assert.ok(PARTIAL_DOWNLOAD.test('file.pdf.crdownload') && !PARTIAL_DOWNLOAD.test('file.pdf'));
});

test('the desktop watcher reports one new thing at a time, with cool-downs, and stays quiet at start-up', () => {
  const w = new DesktopWatcher({ cooldownMs: 60000, globalMs: 20000 });
  const notes = { id: 1, x: 0, y: 0, w: 400, h: 300, t: 'Untitled - Notepad' };
  const pdf = { id: 2, x: 500, y: 100, w: 600, h: 500, t: 'الدرس.pdf - Adobe Acrobat' };
  const word = { id: 3, x: 50, y: 50, w: 600, h: 500, t: 'ورقة.docx - Word' };
  assert.deepEqual(w.update([notes], 0), []);
  const [opened] = w.update([notes, pdf, word], 1000);
  assert.equal(opened.type, 'opened');
  assert.equal(opened.title.length > 0, true);
  assert.deepEqual(w.update([notes, pdf, word], 2000), [], 'same list: nothing');
  assert.deepEqual(w.update([notes, word], 5000), [], 'global cool-down');
  const [closed] = w.update([word], 30000);
  assert.deepEqual([closed.type, closed.kind], ['closed', 'notepad']);
});

function makeBrain(overrides = {}, rng = () => 0.1) {
  const now = new Date(2026, 10, 18, 10).getTime();
  return new Brain({ memoryData: { ...defaultMemory(now), onboarded: true, level: 3, ...overrides }, clock: () => now, rng });
}

test('remarks about the desktop, and silence when he should be quiet', () => {
  const b = makeBrain();
  const r = b.event('window_opened', { kind: 'pdf', title: 'الدرس.pdf' });
  assert.equal(r.situation, 'win_pdf');
  assert.equal(r.behavior, 'look_window');
  assert.equal(b.event('window_closed', { kind: 'word', title: 'ورقة' }).situation, 'win_closed');
  assert.equal(makeBrain({}, () => 0.9).event('window_opened', { kind: 'other', title: 'x' }), null, 'unknown windows are mostly ignored');
  b.hear('خلني اركز');
  assert.equal(b.event('window_opened', { kind: 'pdf', title: 'x' }), null, 'focus mode: quiet');
});

test('a new download: he offers to open it, and yes opens just that file', () => {
  const b = makeBrain();
  const offer = b.event('download_new', { name: 'جدول الاختبارات.pdf', kind: 'pdf' });
  assert.equal(offer.situation, 'dl_pdf');
  assert.equal(offer.awaitingConfirm, true);
  assert.deepEqual(b.hear('ايوه').action.params, { name: 'جدول الاختبارات.pdf' });
  assert.equal(validateAction({ type: 'open_download', params: { name: '..\\secret.txt' } }), 'bad_file');
  assert.equal(validateAction({ type: 'open_download', params: { name: 'a/b.pdf' } }), 'bad_file');
  assert.equal(validateAction({ type: 'open_download', params: { name: 'درس.pdf' } }), null);
});

test('main opens a download only if it is really in the Downloads folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'khalfoun-dl-'));
  await writeFile(join(dir, 'درس.pdf'), 'x');
  const opened = [];
  const ex = createExecutor({ platform: { openPath: async (f) => { opened.push(f); return ''; } }, getSettings: () => ({ level: 3 }), downloadsDir: dir, journal: null, scheduleReminder: () => {} });
  assert.deepEqual(await ex.run({ type: 'open_download', params: { name: 'درس.pdf' } }), { ok: true });
  assert.equal(opened[0], join(dir, 'درس.pdf'));
  assert.deepEqual(await ex.run({ type: 'open_download', params: { name: 'missing.pdf' } }), { ok: false, error: 'no_file' });
});

test('games: chase and hide-and-seek', () => {
  assert.deepEqual(recognize('طاردني').slots, { name: 'chase' });
  assert.deepEqual(recognize('نلعب غميضة').slots, { name: 'hide' });
  assert.equal(recognize('خلنا نلعب').intent, 'quiz');
  const b = makeBrain();
  assert.equal(b.hear('طاردني').behavior, 'game:chase');
  assert.equal(b.hear('غميضة').behavior, 'game:hide');
  assert.ok(b.event('game_over', { game: 'chase', score: 4 }).say.includes('٤'));
  assert.equal(b.event('game_over', { game: 'hide', found: true, seconds: 7.4 }).situation, 'game_found');
  assert.equal(b.event('game_over', { game: 'hide', found: false }).situation, 'game_not_found');
  assert.equal(b.event('dizzy').situation, 'dizzy');
  assert.equal(b.event('resume').situation, 'welcome_back');
});
