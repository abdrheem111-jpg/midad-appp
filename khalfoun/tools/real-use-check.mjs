// Windows only. Uses Khalfoun the way a person does: starts the real app (not
// the self-test mode), presses Ctrl+Shift+K on the real keyboard, types an
// Arabic command with real key presses and Enter, then checks that the
// command ran. Prints Khalfoun's own diagnostics log at the end.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

if (process.platform !== 'win32') { console.log('Windows only; skipped.'); process.exit(0); }

const root = fileURLToPath(new URL('..', import.meta.url));
const userData = await mkdtemp(join(tmpdir(), 'khalfoun-real-'));
await writeFile(join(userData, 'settings.json'), JSON.stringify({ onboarded: true, level: 3, kidsMode: false }));
await writeFile(join(userData, 'memory.json'), JSON.stringify({ name: 'تجربة', humor: 1, onboarded: true, level: 3, interactions: 5 }));
const logFile = join(userData, 'khalfoun-log.txt');
const readLog = async () => { try { return await readFile(logFile, 'utf8'); } catch { return ''; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(300); }
  return false;
}

const exe = process.env.KHALFOUN_APP_EXE;
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env, KHALFOUN_USER_DATA: userData };
delete env.NODE_OPTIONS;
delete env.KHALFOUN_SMOKE;
const app = spawn(exe || electron, exe ? [] : [root], { env, stdio: 'ignore' });

const PS = String.raw`
param([string]$Text)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Keys {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  static INPUT K(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.ki.wVk = vk; i.ki.wScan = scan; i.ki.dwFlags = flags; return i; }
  public static void Send(INPUT[] a) { SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))); }
  public static void Combo(ushort[] vks) {
    var list = new System.Collections.Generic.List<INPUT>();
    foreach (var v in vks) list.Add(K(v, 0, 0));
    for (int i = vks.Length - 1; i >= 0; i--) list.Add(K(vks[i], 0, 2));
    Send(list.ToArray());
  }
  public static void Type(string s) {
    foreach (char c in s) { Send(new[] { K(0, c, 4), K(0, c, 4 | 2) }); System.Threading.Thread.Sleep(15); }
  }
}
"@
[Keys]::Combo(@(0x11, 0x10, 0x4B))   # Ctrl+Shift+K
Start-Sleep -Milliseconds 1500
[Keys]::Type($Text)
Start-Sleep -Milliseconds 300
[Keys]::Combo(@(0x0D))               # Enter
`;
const psFile = join(userData, 'keys.ps1');
await writeFile(psFile, `﻿${PS}`, 'utf8');
const typeCommand = (text) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile, '-Text', text], { stdio: 'inherit' });
const notepadCount = () => {
  try { return execFileSync('powershell', ['-NoProfile', '-Command', '(Get-Process notepad -ErrorAction SilentlyContinue | Measure-Object).Count'], { encoding: 'utf8' }).trim(); } catch { return '0'; }
};

const results = [];
const step = (name, ok, extra) => { results.push({ name, ok }); console.log(`${ok ? 'ok' : 'not ok'} - ${name}${!ok && extra ? `\n  ${extra}` : ''}`); };
try {
  step('app starts and writes its log', await until(async () => /shortcuts/.test(await readLog()), 30000));
  step('keyboard shortcuts registered', /"Ctrl\+Shift\+K":true/.test(await readLog()), (await readLog()).split('\n').find((l) => l.includes('shortcuts')));
  await sleep(4000); // let the greeting finish

  typeCommand('كم الساعة');
  step('typed «كم الساعة» reaches him', await until(async () => /heard «كم الساعة» → time/.test(await readLog()), 10000));

  const before = Number(notepadCount());
  typeCommand('افتح المفكرة');
  const heard = await until(async () => /heard «افتح المفكرة»/.test(await readLog()), 10000);
  step('typed «افتح المفكرة» reaches him', heard);
  step('the open action runs', await until(async () => /action open .*→ ok/.test(await readLog()), 10000));
  step('Notepad actually opens', await until(async () => Number(notepadCount()) > before, 10000), `notepad processes: ${notepadCount()}`);
} finally {
  console.log('\n----- khalfoun-log.txt -----');
  console.log(await readLog());
  console.log('----------------------------');
  app.kill();
  try { execFileSync('taskkill', ['/IM', 'notepad.exe', '/F'], { stdio: 'ignore' }); } catch { /* none */ }
  await sleep(1000);
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} step(s) failed.` : '\nاستخدام حقيقي بالكيبورد نجح.');
process.exit(failed.length ? 1 : 0);
