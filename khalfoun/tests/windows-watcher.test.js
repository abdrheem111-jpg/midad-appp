import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WindowWatcher, parseWindowList, toOverlay, PS_SCRIPT } from '../src/main/windows-watcher.js';

test('parses the helper output and drops malformed entries', () => {
  assert.deepEqual(parseWindowList('[{"id":1,"x":10,"y":20,"w":300,"h":200},{"id":2,"x":"a"},{"id":3,"x":0,"y":0,"w":0,"h":5}]'), [{ id: 1, x: 10, y: 20, w: 300, h: 200, t: '' }]);
  assert.deepEqual(parseWindowList('[{"id":1,"x":0,"y":0,"w":9,"h":9,"t":"ورقة.pdf - Adobe Acrobat"}]')[0].t, 'ورقة.pdf - Adobe Acrobat');
  assert.equal(parseWindowList('not json'), null);
  assert.equal(parseWindowList('{"id":1}'), null);
});

test('converts physical pixels to overlay coordinates', () => {
  const half = (r) => ({ x: r.x / 2, y: r.y / 2, width: r.width / 2, height: r.height / 2 }); // 200% scaling
  assert.deepEqual(toOverlay([{ id: 1, x: 400, y: 600, w: 800, h: 400 }], half, { x: 0, y: 10 }), [{ id: 1, x: 200, y: 290, w: 400, h: 200, t: '' }]);
});

test('the PowerShell helper uses the Win32 calls it needs and skips its own windows', () => {
  for (const s of ['GetWindowText', 'OutputEncoding', 'EnumWindows', 'DwmGetWindowAttribute', 'IsIconic', 'GetWindowThreadProcessId', 'SetProcessDpiAwarenessContext', 'pid == skipPid']) assert.ok(PS_SCRIPT.includes(s), s);
  assert.ok(!PS_SCRIPT.includes('${'), 'no JavaScript interpolation leaked into the script');
  assert.ok(PS_SCRIPT.includes('"{\\"id\\":"'), 'JSON quotes are escaped for C#');
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit('exit', 0);
  return child;
}

test('the watcher asks, parses and reports only changes; failure means no windows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'khalfoun-ww-'));
  const child = fakeChild();
  let spawned = null;
  const changes = [];
  const asked = [];
  child.stdin.on('data', (d) => asked.push(String(d)));
  const w = new WindowWatcher({
    platform: 'win32', scriptDir: dir, selfPid: 4242, intervalMs: 10_000,
    toDip: (r) => r, getWorkArea: () => ({ x: 0, y: 0 }), onChange: (l) => changes.push(l),
    spawnFn: (cmd, args) => { spawned = { cmd, args }; return child; },
  });
  assert.equal(await w.start(), true);
  assert.equal(spawned.cmd, 'powershell.exe');
  assert.ok(spawned.args.includes('-File'));
  assert.ok((await readFile(join(dir, 'windows.ps1'), 'utf8')).includes('EnumWindows'));
  assert.deepEqual(asked, ['4242\n']);
  child.stdout.write('Some PowerShell banner\n[{"id":5,"x":1,"y":2,"w":300,"h":200}]\n');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(changes, [[{ id: 5, x: 1, y: 2, w: 300, h: 200, t: '' }]]);
  w.ask();
  child.stdout.write('[{"id":5,"x":1,"y":2,"w":300,"h":200}]\n');
  await new Promise((r) => setImmediate(r));
  assert.equal(changes.length, 1, 'same list is not reported twice');
  child.emit('exit', 1);
  assert.deepEqual(changes.at(-1), []);
  assert.equal(w.running, false);
  await rm(dir, { recursive: true, force: true });
});

test('the watcher does nothing outside Windows', async () => {
  const w = new WindowWatcher({ platform: 'linux', onChange: () => {}, toDip: (r) => r, getWorkArea: () => ({ x: 0, y: 0 }), selfPid: 1 });
  assert.equal(await w.start(), false);
  w.stop();
});
