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
/** How each key id is pressed: SendKeys on Windows, System Events on macOS, xdotool on Linux. */
const KEY_WIN = {
  enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', space: ' ', backspace: '{BACKSPACE}', delete_word: '^{BACKSPACE}',
  copy: '^c', paste: '^v', cut: '^x', select_all: '^a', save: '^s', print: '^p', undo: '^z', redo: '^y', find: '^f',
  new_tab: '^t', close_tab: '^w', next_tab: '^{TAB}', prev_tab: '^+{TAB}', reopen_tab: '^+t',
  page_down: '{PGDN}', page_up: '{PGUP}', top: '^{HOME}', bottom: '^{END}',
  zoom_in: '^{ADD}', zoom_out: '^{SUBTRACT}', zoom_reset: '^0', switch_window: '%{TAB}', fullscreen: '{F11}', refresh: '{F5}',
};
const KEY_MAC = {
  enter: ['key code 36'], tab: ['key code 48'], escape: ['key code 53'], space: ['key code 49'], backspace: ['key code 51'],
  delete_word: ['key code 51 using option down'], copy: ['keystroke "c" using command down'], paste: ['keystroke "v" using command down'],
  cut: ['keystroke "x" using command down'], select_all: ['keystroke "a" using command down'], save: ['keystroke "s" using command down'],
  print: ['keystroke "p" using command down'], undo: ['keystroke "z" using command down'], redo: ['keystroke "z" using {command down, shift down}'],
  find: ['keystroke "f" using command down'], new_tab: ['keystroke "t" using command down'], close_tab: ['keystroke "w" using command down'],
  next_tab: ['keystroke "]" using {command down, shift down}'], prev_tab: ['keystroke "[" using {command down, shift down}'],
  reopen_tab: ['keystroke "t" using {command down, shift down}'], page_down: ['key code 121'], page_up: ['key code 116'],
  top: ['key code 126 using command down'], bottom: ['key code 125 using command down'], zoom_in: ['keystroke "=" using command down'],
  zoom_out: ['keystroke "-" using command down'], zoom_reset: ['keystroke "0" using command down'], switch_window: ['key code 48 using command down'],
  show_desktop: ['key code 103'], fullscreen: ['keystroke "f" using {command down, control down}'], refresh: ['keystroke "r" using command down'],
};
const KEY_LINUX = {
  enter: 'Return', tab: 'Tab', escape: 'Escape', space: 'space', backspace: 'BackSpace', delete_word: 'ctrl+BackSpace', copy: 'ctrl+c',
  paste: 'ctrl+v', cut: 'ctrl+x', select_all: 'ctrl+a', save: 'ctrl+s', print: 'ctrl+p', undo: 'ctrl+z', redo: 'ctrl+y', find: 'ctrl+f',
  new_tab: 'ctrl+t', close_tab: 'ctrl+w', next_tab: 'ctrl+Tab', prev_tab: 'ctrl+shift+Tab', reopen_tab: 'ctrl+shift+t',
  page_down: 'Next', page_up: 'Prior', top: 'ctrl+Home', bottom: 'ctrl+End', zoom_in: 'ctrl+plus', zoom_out: 'ctrl+minus',
  zoom_reset: 'ctrl+0', switch_window: 'alt+Tab', show_desktop: 'super+d', fullscreen: 'F11', refresh: 'F5',
};

/** Folder windows («سكر الملفات») close through the shell, never by stopping explorer.exe itself. */
const FOLDER_IDS = new Set(['explorer', 'downloads', 'documents', 'pictures', 'desktop']);

export const SEARCH_URLS = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  translate: (q) => `https://translate.google.com/?sl=auto&tl=${/[\u0600-\u06FF]/.test(q) ? 'en' : 'ar'}&op=translate&text=${encodeURIComponent(q)}`,
  meaning: (q) => `https://www.almaany.com/ar/dict/ar-ar/${encodeURIComponent(q.trim().split(/\s+/)[0])}/`,
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

/** PowerShell that brings a program (by process id) to the front before typing; empty when unknown. */
function activate(pid) {
  return Number.isInteger(pid) && pid > 0 ? `$null = $w.AppActivate(${pid}); Start-Sleep -Milliseconds 200; ` : '';
}

/**
 * @param {{platform?: string, launch?: typeof launchDetached, run?: typeof runCommand,
 *   shell: {openExternal: (u: string) => Promise<void>, openPath: (p: string) => Promise<string>},
 *   clipboard?: {readText: () => string, writeText: (t: string) => void},
 *   capture?: () => Promise<Buffer>, paths: Record<string, string>, home?: string,
 *   beforeType?: () => (number|null|void), wait?: (ms: number) => Promise<void>}} deps
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

  /** Opens a file with its usual program (callers check the path first). */
  async function openPath(file) {
    return shell.openPath(file);
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
    // Give the focus back to the person's window; on Windows, bring that exact program forward.
    const target = deps.beforeType ? deps.beforeType() : null;
    await wait(300);
    let r;
    if (platform === 'win32') r = await powershell(`$w = New-Object -ComObject WScript.Shell; ${activate(target)}$w.SendKeys('^v')`);
    else if (platform === 'darwin') r = await run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    else r = await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
    await wait(500);
    cb.writeText(previous);
    return r.ok ? { ok: true } : { ok: false, error: 'paste_failed' };
  }

  /**
   * Reads the text selected in the person's window: copies it (Ctrl+C), reads
   * the clipboard, then puts the clipboard back the way it was.
   */
  async function readSelection() {
    const cb = deps.clipboard;
    if (!cb) return { ok: false, error: 'no_clipboard' };
    const previous = cb.readText();
    cb.writeText('');
    const target = deps.beforeType ? deps.beforeType() : null;
    await wait(250);
    let r;
    if (platform === 'win32') r = await powershell(`$w = New-Object -ComObject WScript.Shell; ${activate(target)}$w.SendKeys('^c')`);
    else if (platform === 'darwin') r = await run('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down']);
    else r = await run('xdotool', ['key', '--clearmodifiers', 'ctrl+c']);
    await wait(400);
    const text = cb.readText();
    cb.writeText(previous);
    if (!r.ok) return { ok: false, error: 'copy_failed' };
    return { ok: true, data: { text: String(text || '').slice(0, 6000) } };
  }

  /** Presses one key or shortcut from the fixed list in the window the person was using. */
  async function pressKey(key) {
    const target = deps.beforeType ? deps.beforeType() : null; // give the focus back to the person's window
    await wait(250);
    let r;
    if (platform === 'win32') {
      if (key === 'show_desktop') r = await powershell('(New-Object -ComObject Shell.Application).ToggleDesktop()');
      else if (KEY_WIN[key]) r = await powershell(`$w = New-Object -ComObject WScript.Shell; ${activate(target)}$w.SendKeys('${KEY_WIN[key]}')`);
      else return { ok: false, error: 'bad_key' };
    } else if (platform === 'darwin') {
      const k = KEY_MAC[key];
      if (!k) return { ok: false, error: 'bad_key' };
      r = await run('osascript', ['-e', `tell application "System Events" to ${k[0]}`]);
    } else {
      if (!KEY_LINUX[key]) return { ok: false, error: 'bad_key' };
      r = await run('xdotool', ['key', '--clearmodifiers', KEY_LINUX[key]]);
    }
    return r.ok ? { ok: true } : { ok: false, error: 'key_failed' };
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

  return { platform, openApp, closeApp, openInstalled, listInstalled, pressKey, readSelection, openPath, openUrl, openFolder, search, volume, typeText, screenshot };
}
