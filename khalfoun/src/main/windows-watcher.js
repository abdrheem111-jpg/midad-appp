// Reads the list of open windows on Windows so Khalfoun can walk on them.
// A small PowerShell helper (using the Win32 API: EnumWindows + the DWM frame
// bounds) runs in the background; every half second we ask it for the visible
// top-level windows, top-most first, and pass changes to the page.
// On other systems, or if the helper fails, he simply stays on the floor.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class KhalfounWindows {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  public static string List(uint skipPid) {
    StringBuilder sb = new StringBuilder("[");
    bool first = true;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      if (GetWindowTextLength(h) == 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;   // tool windows
      if (GetWindow(h, 4) != IntPtr.Zero) return true;         // owned popups
      int cloaked = 0;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // hidden on another desktop
      uint pid = 0;
      GetWindowThreadProcessId(h, out pid);
      if (pid == skipPid) return true;
      RECT r;
      if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return true; // real frame without the invisible border
      if (r.R - r.L <= 0 || r.B - r.T <= 0) return true;
      if (!first) sb.Append(',');
      first = false;
      sb.Append("{\"id\":").Append(h.ToInt64()).Append(",\"x\":").Append(r.L).Append(",\"y\":").Append(r.T)
        .Append(",\"w\":").Append(r.R - r.L).Append(",\"h\":").Append(r.B - r.T).Append('}');
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }
}
"@
try { [void][KhalfounWindows]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'quit') { break }
  try { [Console]::Out.WriteLine([KhalfounWindows]::List([uint32]$line)) } catch { [Console]::Out.WriteLine('[]') }
  [Console]::Out.Flush()
}
`;

/**
 * Parses one line from the helper. Returns null for anything malformed.
 * @param {string} line
 */
export function parseWindowList(line) {
  let data;
  try { data = JSON.parse(line); } catch { return null; }
  if (!Array.isArray(data)) return null;
  return data.filter((w) => w && ['id', 'x', 'y', 'w', 'h'].every((k) => Number.isFinite(w[k])) && w.w > 0 && w.h > 0)
    .map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h }));
}

/**
 * Converts physical screen rectangles to positions inside the overlay window.
 * @param {Array<{id: number, x: number, y: number, w: number, h: number}>} list
 * @param {(r: {x: number, y: number, width: number, height: number}) => {x: number, y: number, width: number, height: number}} toDip
 * @param {{x: number, y: number}} workArea overlay position on screen (DIP)
 */
export function toOverlay(list, toDip, workArea) {
  return list.map((w) => {
    const r = toDip({ x: w.x, y: w.y, width: w.w, height: w.h });
    return { id: w.id, x: Math.round(r.x - workArea.x), y: Math.round(r.y - workArea.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

export class WindowWatcher {
  /**
   * @param {{onChange: (list: Array<object>) => void, toDip: Function, getWorkArea: () => {x: number, y: number},
   *   selfPid: number, intervalMs?: number, spawnFn?: typeof spawn, scriptDir?: string, platform?: string}} opts
   */
  constructor(opts) {
    this.opts = { intervalMs: 500, spawnFn: spawn, platform: process.platform, ...opts };
    this.child = null;
    this.timer = null;
    this.waiting = false;
    this.last = '';
    this.buffer = '';
    this.failures = 0;
  }

  get running() { return Boolean(this.child); }

  async start() {
    if (this.child || this.opts.platform !== 'win32') return false;
    const dir = this.opts.scriptDir || (await mkdtemp(join(tmpdir(), 'khalfoun-win-')));
    const script = join(dir, 'windows.ps1');
    await writeFile(script, PS_SCRIPT, 'utf8');
    const child = this.opts.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onData(chunk));
    child.on('error', () => this.onExit());
    child.on('exit', () => this.onExit());
    this.timer = setInterval(() => this.ask(), this.opts.intervalMs);
    this.ask();
    return true;
  }

  ask() {
    if (!this.child || this.waiting) return;
    this.waiting = true;
    try { this.child.stdin.write(`${this.opts.selfPid}\n`); } catch { this.onExit(); }
  }

  onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.startsWith('[')) continue; // ignore anything else PowerShell prints
      this.waiting = false;
      const parsed = parseWindowList(line);
      if (!parsed) continue;
      const list = toOverlay(parsed, this.opts.toDip, this.opts.getWorkArea());
      const key = JSON.stringify(list);
      if (key !== this.last) {
        this.last = key;
        this.opts.onChange(list);
      }
    }
  }

  onExit() {
    if (!this.child) return;
    this.child = null;
    clearInterval(this.timer);
    this.timer = null;
    this.waiting = false;
    this.last = '';
    this.opts.onChange([]);
    this.failures += 1;
  }

  stop() {
    const child = this.child;
    if (!child) return;
    clearInterval(this.timer);
    this.timer = null;
    this.child = null;
    try { child.stdin.write('quit\n'); child.stdin.end(); } catch { /* already closed */ }
    setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 500);
    this.last = '';
  }
}
