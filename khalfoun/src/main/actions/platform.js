// How each action is carried out on Windows, macOS and Linux. Every command
// target comes from a fixed list below; nothing the person says is ever passed
// to a shell. The OS hooks (launching, shell, clipboard, screen capture) are
// injected so the logic can be tested without touching the real system.

import { spawn, execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { matchInstalled } from '../../core/app-match.js';

const WIN_START = {
  calculator: 'calc.exe', notepad: 'notepad.exe', paint: 'mspaint.exe', explorer: 'explorer.exe',
  word: 'winword', excel: 'excel', powerpoint: 'powerpnt',
};
const MAC_APPS = {
  calculator: ['Calculator'], notepad: ['TextEdit'], paint: ['Preview'], explorer: ['Finder'],
  word: ['Microsoft Word', 'Pages'], excel: ['Microsoft Excel', 'Numbers'], powerpoint: ['Microsoft PowerPoint', 'Keynote'],
};
const LINUX_APPS = {
  calculator: [['gnome-calculator'], ['kcalc'], ['galculator'], ['mate-calc']],
  notepad: [['gnome-text-editor'], ['gedit'], ['kate'], ['mousepad'], ['xed']],
  paint: [['pinta'], ['kolourpaint'], ['gimp']],
  explorer: [['xdg-open', '~']],
  word: [['libreoffice', '--writer']], excel: [['libreoffice', '--calc']], powerpoint: [['libreoffice', '--impress']],
  settings: [['gnome-control-center'], ['systemsettings']],
};
const URL_APPS = { browser: 'https://www.google.com' };
/** Program files each app runs as, for closing it politely (like pressing its ✕). */
const WIN_PROCESSES = {
  calculator: ['CalculatorApp.exe', 'calc.exe'], notepad: ['notepad.exe'], paint: ['mspaint.exe'],
  word: ['WINWORD.EXE'], excel: ['EXCEL.EXE'], powerpoint: ['POWERPNT.EXE'],
  browser: ['msedge.exe', 'chrome.exe', 'firefox.exe', 'brave.exe', 'opera.exe'], settings: ['SystemSettings.exe'],
};
const MAC_QUIT = { ...MAC_APPS, browser: ['Safari', 'Google Chrome', 'Firefox', 'Microsoft Edge'], settings: ['System Settings', 'System Preferences'] };
const LINUX_PROCESSES = {
  calculator: ['gnome-calculator', 'kcalc', 'galculator', 'mate-calc'], notepad: ['gnome-text-editor', 'gedit', 'kate', 'mousepad', 'xed'],
  paint: ['pinta', 'kolourpaint', 'gimp'], browser: ['firefox', 'chrome', 'chromium'], word: ['soffice.bin'], excel: ['soffice.bin'], powerpoint: ['soffice.bin'],
};
/** Folder windows («سكر الملفات») close through the shell, never by stopping explorer.exe itself. */
const FOLDER_IDS = new Set(['explorer', 'downloads', 'documents', 'pictures']);

export const SEARCH_URLS = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
};

/** Default launcher: resolves true once the program started, false if it is missing. */
export function launchDetached(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch {
      resolve(false);
    }
  });
}

/** Default runner for short commands that must finish. */
export function runCommand(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(err.message || err) : null });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{platform?: string, launch?: typeof launchDetached, run?: typeof runCommand,
 *   shell: {openExternal: (u: string) => Promise<void>, openPath: (p: string) => Promise<string>},
 *   clipboard?: {readText: () => string, writeText: (t: string) => void},
 *   capture?: () => Promise<Buffer>, paths: Record<string, string>, home?: string,
 *   beforeType?: () => void, wait?: (ms: number) => Promise<void>}} deps
 */
export function createPlatform(deps) {
  const platform = deps.platform || process.platform;
  const launch = deps.launch || launchDetached;
  const run = deps.run || runCommand;
  const wait = deps.wait || sleep;
  const { shell } = deps;

  const powershell = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);

  async function openApp(app) {
    if (URL_APPS[app]) { await shell.openExternal(URL_APPS[app]); return { ok: true }; }
    if (platform === 'win32') {
      if (app === 'settings') { await shell.openExternal('ms-settings:'); return { ok: true }; }
      const target = WIN_START[app];
      if (!target) return { ok: false, error: 'unknown_app' };
      // `start` finds Office apps through the App Paths registry. Target is from the fixed list above.
      const started = await launch('cmd.exe', ['/d', '/c', `start "" ${target}`], { windowsVerbatimArguments: true });
      return started ? { ok: true } : { ok: false, error: 'launch_failed' };
    }
    if (platform === 'darwin') {
      if (app === 'settings') { await shell.openExternal('x-apple.systempreferences:'); return { ok: true }; }
      for (const name of MAC_APPS[app] || []) {
        const r = await run('open', ['-a', name]);
        if (r.ok) return { ok: true };
      }
      return { ok: false, error: 'app_not_found' };
    }
    for (const [cmd, ...args] of LINUX_APPS[app] || []) {
      const real = args.map((a) => (a === '~' ? (deps.home || '.') : a));
      if (await launch(cmd, real)) return { ok: true };
    }
    return { ok: false, error: 'app_not_found' };
  }

  /** Closes an app the same way its ✕ button would, so it can still ask to save. */
  async function closeApp(app) {
    if (platform === 'win32') {
      if (FOLDER_IDS.has(app)) {
        const r = await powershell('$n = 0; (New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.FullName -like "*explorer.exe" } | ForEach-Object { $_.Quit(); $n++ }; Write-Output $n');
        if (!r.ok) return { ok: false, error: 'close_failed' };
        return Number(r.stdout.trim()) > 0 ? { ok: true } : { ok: false, error: 'not_running' };
      }
      const names = WIN_PROCESSES[app];
      if (!names) return { ok: false, error: 'cannot_close' };
      let closed = false;
      for (const name of names) {
        const r = await run('taskkill.exe', ['/IM', name]);
        if (r.ok) closed = true;
      }
      return closed ? { ok: true } : { ok: false, error: 'not_running' };
    }
    if (platform === 'darwin') {
      for (const name of MAC_QUIT[app] || []) {
        const r = await run('osascript', ['-e', `if application "${name}" is running then tell application "${name}" to quit`]);
        if (r.ok) return { ok: true };
      }
      return { ok: false, error: 'not_running' };
    }
    let closed = false;
    for (const name of LINUX_PROCESSES[app] || []) {
      const r = await run('pkill', ['-x', name]);
      if (r.ok) closed = true;
    }
    return closed ? { ok: true } : { ok: false, error: LINUX_PROCESSES[app] ? 'not_running' : 'cannot_close' };
  }

  // ----- any installed program, by the name the person says
  let installedCache = null;
  /** Programs on the Start menu (Windows) or in Applications (macOS), cached for ten minutes. */
  async function listInstalled() {
    if (installedCache && Date.now() - installedCache.at < 10 * 60000) return installedCache.apps;
    let apps = [];
    if (platform === 'win32') {
      const r = await powershell('[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress');
      if (r.ok && r.stdout.trim()) {
        try {
          const data = JSON.parse(r.stdout.trim());
          apps = (Array.isArray(data) ? data : [data]).map((a) => ({ name: String(a.Name || ''), id: String(a.AppID || '') })).filter((a) => a.name && a.id);
        } catch { apps = []; }
      }
    } else if (platform === 'darwin') {
      for (const dir of ['/Applications', '/System/Applications', join(deps.home || '', 'Applications')]) {
        try {
          for (const f of await readdir(dir)) if (f.endsWith('.app')) apps.push({ name: f.slice(0, -4), id: join(dir, f) });
        } catch { /* missing folder */ }
      }
    }
    installedCache = { at: Date.now(), apps };
    return apps;
  }

  async function openInstalled(name) {
    const app = matchInstalled(name, await listInstalled());
    if (!app) return { ok: false, error: 'not_installed' };
    if (platform === 'win32') {
      // The id comes from Windows' own Start menu list; no shell is involved.
      const started = await launch('explorer.exe', [`shell:AppsFolder\\${app.id}`]);
      return started ? { ok: true, data: { name: app.name } } : { ok: false, error: 'launch_failed' };
    }
    if (platform === 'darwin') {
      const r = await run('open', [app.id]);
      return r.ok ? { ok: true, data: { name: app.name } } : { ok: false, error: 'launch_failed' };
    }
    return { ok: false, error: 'not_installed' };
  }

  async function openUrl(url) {
    await shell.openExternal(url);
    return { ok: true };
  }

  async function openFolder(folder) {
    const dir = deps.paths[folder];
    if (!dir) return { ok: false, error: 'unknown_folder' };
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true };
  }

  async function search(query, engine) {
    const make = SEARCH_URLS[engine] || SEARCH_URLS.google;
    await shell.openExternal(make(query));
    return { ok: true };
  }

  async function volume(direction) {
    if (platform === 'win32') {
      const key = direction === 'up' ? 175 : direction === 'down' ? 174 : 173;
      const times = direction === 'mute' ? 1 : 5;
      const r = await powershell(`$w = New-Object -ComObject WScript.Shell; 1..${times} | ForEach-Object { $w.SendKeys([char]${key}) }`);
      return r.ok ? { ok: true } : { ok: false, error: 'volume_failed' };
    }
    if (platform === 'darwin') {
      const script = direction === 'mute'
        ? 'set volume output muted not (output muted of (get volume settings))'
        : `set volume output volume ((output volume of (get volume settings)) ${direction === 'up' ? '+' : '-'} 10)`;
      const r = await run('osascript', ['-e', script]);
      return r.ok ? { ok: true } : { ok: false, error: 'volume_failed' };
    }
    const args = direction === 'mute' ? ['set-sink-mute', '@DEFAULT_SINK@', 'toggle'] : ['set-sink-volume', '@DEFAULT_SINK@', direction === 'up' ? '+10%' : '-10%'];
    const r = await run('pactl', args);
    return r.ok ? { ok: true } : { ok: false, error: 'volume_failed' };
  }

  async function typeText(text) {
    const cb = deps.clipboard;
    if (!cb) return { ok: false, error: 'no_clipboard' };
    const previous = cb.readText();
    cb.writeText(text);
    if (deps.beforeType) deps.beforeType(); // let the window the person was using get the focus back
    await wait(300);
    let r;
    if (platform === 'win32') r = await powershell("$w = New-Object -ComObject WScript.Shell; $w.SendKeys('^v')");
    else if (platform === 'darwin') r = await run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    else r = await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
    await wait(500);
    cb.writeText(previous);
    return r.ok ? { ok: true } : { ok: false, error: 'paste_failed' };
  }

  async function screenshot(now = new Date()) {
    if (!deps.capture) return { ok: false, error: 'no_capture' };
    const png = await deps.capture();
    const dir = join(deps.paths.pictures, 'خلفون');
    await mkdir(dir, { recursive: true });
    const pad = (n) => String(n).padStart(2, '0');
    const name = `لقطة-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
    const file = join(dir, name);
    await writeFile(file, png);
    return { ok: true, data: { file } };
  }

  return { platform, openApp, closeApp, openInstalled, listInstalled, openUrl, openFolder, search, volume, typeText, screenshot };
}
