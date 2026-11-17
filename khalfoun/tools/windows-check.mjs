// Live checks that only make sense on a real Windows machine (run in CI on
// windows-latest): reading open windows through the PowerShell helper and
// carrying out actions with the real system.
import { execFileSync, spawn } from 'node:child_process';
import { WindowWatcher } from '../src/main/windows-watcher.js';
import { createPlatform } from '../src/main/actions/platform.js';
import { visiblePlatforms } from '../src/renderer/platforms.js';

if (process.platform !== 'win32') {
  console.log('هذا الفحص لويندوز فقط.');
  process.exit(0);
}

const results = [];
const check = async (name, fn) => {
  try {
    const extra = await fn();
    results.push({ name, ok: true });
    console.log(`ok - ${name}${extra ? ` (${extra})` : ''}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`not ok - ${name}\n  ${err.message}`);
  }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = (image) => execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { encoding: 'utf8' }).toLowerCase().includes(image.toLowerCase());
const kill = (image) => { try { execFileSync('taskkill', ['/IM', image, '/F'], { stdio: 'ignore' }); } catch { /* not running */ } };
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();

const platform = createPlatform({
  shell: { openExternal: async () => {}, openPath: async () => '' },
  clipboard: { readText: () => ps('Get-Clipboard -Raw'), writeText: (t) => ps(`Set-Clipboard -Value '${String(t).replace(/'/g, "''")}'`) },
  paths: { downloads: '.', documents: '.', pictures: '.' },
});

await check('opening Notepad through the real command starts it', async () => {
  kill('notepad.exe');
  const r = await platform.openApp('notepad');
  assert(r.ok, JSON.stringify(r));
  let ok = false;
  for (let i = 0; i < 20 && !ok; i += 1) { await sleep(500); ok = running('notepad.exe'); }
  assert(ok, 'notepad.exe not running');
});

await check('the window helper lists real open windows with sane positions', async () => {
  const lists = [];
  const watcher = new WindowWatcher({
    onChange: (l) => lists.push(l), toDip: (r) => r, getWorkArea: () => ({ x: 0, y: 0 }), selfPid: process.pid, intervalMs: 400,
  });
  assert(await watcher.start(), 'did not start');
  for (let i = 0; i < 40 && !lists.some((l) => l.length); i += 1) await sleep(250);
  watcher.stop();
  const list = lists.find((l) => l.length);
  assert(list, `no windows reported: ${JSON.stringify(lists)}`);
  for (const w of list) assert(Number.isFinite(w.x) && w.w > 0 && w.h > 0, JSON.stringify(w));
  const plats = visiblePlatforms(list, { width: 3840, height: 2160 }, { width: 170, height: 209 });
  return `${list.length} windows, ${plats.length} platforms`;
});

await check('a window that moves is reported again with its new position', async () => {
  const lists = [];
  const watcher = new WindowWatcher({ onChange: (l) => lists.push(l), toDip: (r) => r, getWorkArea: () => ({ x: 0, y: 0 }), selfPid: process.pid, intervalMs: 300 });
  await watcher.start();
  for (let i = 0; i < 30 && !lists.some((l) => l.length); i += 1) await sleep(200);
  const before = lists.length;
  ps(`Add-Type @"
using System; using System.Runtime.InteropServices;
public static class MoveIt { [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r); }
"@
$p = Get-Process notepad | Select-Object -First 1
[void][MoveIt]::MoveWindow($p.MainWindowHandle, 200, 300, 640, 400, $true)`);
  for (let i = 0; i < 20 && lists.length === before; i += 1) await sleep(200);
  watcher.stop();
  assert(lists.length > before, 'move not reported');
  const moved = lists.at(-1).find((w) => Math.abs(w.y - 300) < 12 && Math.abs(w.x - 200) < 12);
  assert(moved, `no window near (200,300): ${JSON.stringify(lists.at(-1))}`);
});

await check('volume keys run without errors', async () => {
  const r = await platform.volume('up');
  assert(r.ok, JSON.stringify(r));
  const d = await platform.volume('down');
  assert(d.ok, JSON.stringify(d));
});

await check('typing pastes into the program in front and keeps the clipboard', async () => {
  ps("Set-Clipboard -Value 'before-khalfoun'");
  ps('$w = New-Object -ComObject WScript.Shell; [void]$w.AppActivate((Get-Process notepad | Select-Object -First 1).Id)');
  await sleep(500);
  const r = await platform.typeText('السلام عليكم');
  assert(r.ok, JSON.stringify(r));
  assert(ps('Get-Clipboard -Raw') === 'before-khalfoun', 'clipboard not restored');
});

kill('notepad.exe');
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} فحص فشل على ويندوز.` : '\nكل فحوصات ويندوز الحقيقية نجحت.');
process.exit(failed ? 1 : 0);
