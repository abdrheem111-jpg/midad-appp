// Khalfoun desktop app (Electron main process).
// A transparent, always-on-top, click-through window covers the work area;
// only Khalfoun and his panels catch the mouse. The page is served from a
// private app:// protocol, sandboxed, and can reach the system only through
// the small API in preload.cjs. Every action is validated and permission-checked
// again here.

import {
  app, BrowserWindow, ipcMain, protocol, screen, shell, clipboard, desktopCapturer, Tray, Menu,
  nativeImage, globalShortcut, dialog, Notification, session, net, powerMonitor,
} from 'electron';
import { readFile, mkdtemp, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { watch as watchFolder } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, normalize, relative, sep } from 'node:path';
import { tmpdir, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './storage.js';
import { createPlatform } from './actions/platform.js';
import { createExecutor } from './actions/index.js';
import { findWhisper, transcribe } from './stt.js';
import { WindowWatcher } from './windows-watcher.js';
import { ChatClient, findLocalModel, pickVisionModel } from './chat.js';
import { ReminderScheduler } from './reminders.js';
import { writeIntoLatestPdf } from './actions/pdf.js';
import { LEVEL_INFO } from '../core/permissions.js';
import { DiagLog } from './diag.js';
import { ocrImage } from './ocr.js';
import { TASK_MODES, LOOK_MODES } from '../core/chat-prompt.js';
import { PARTIAL_DOWNLOAD, downloadKind } from '../core/desktop.js';
import {
  setupVoice, pullOllamaModel, ollamaStatus, setupErrorText, packSizeMB,
  VOICE_PACKS, WHISPER_PROGRAM, WHISPER_MODELS, BRAIN_MODELS, OLLAMA_DOWNLOAD_PAGE,
} from './setup.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'app://khalfoun';
const START_URL = `${ORIGIN}/src/renderer/index.html`;
const SMOKE = process.env.KHALFOUN_SMOKE === '1';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const DEFAULT_SETTINGS = { onboarded: false, level: 0, kidsMode: false };

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Khalfoun lives in a transparent, click-through window that Windows can wrongly
// treat as hidden or covered; Chromium would then pause his drawing and slow his
// timers (empty speech bubbles, frozen moves). Keep him always running.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling');

// A plain folder name keeps paths simple: %APPDATA%\Khalfoun on Windows.
app.setName('Khalfoun');
if (process.env.KHALFOUN_USER_DATA) app.setPath('userData', process.env.KHALFOUN_USER_DATA);

let win = null;
let tray = null;
let settings = { ...DEFAULT_SETTINGS };
let whisper = { available: false, bin: null, model: null, wakeModel: null };
let watcher = null;
let chat = null; // ChatClient when a local model is found
let chatInfo = null;
let visionModel = null; // a local model that understands images (gemma3, qwen2.5vl, llava...)
let voiceDirs = [];
let diag = { write() {} }; // DiagLog once the profile folder is known
let lookForModel = async () => {};

const send = (type, data = {}) => {
  if (win && !win.isDestroyed()) win.webContents.send('khalfoun:event', { type, ...data });
};

/** Only our own page may call the IPC API. */
const fromApp = (event) => {
  const url = event.senderFrame?.url || '';
  return url.startsWith(`${ORIGIN}/`) && win && event.sender === win.webContents;
};

function serveAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'khalfoun') return new Response('not found', { status: 404 });
    const file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    const rel = relative(ROOT, file);
    const allowed = rel.startsWith(`src${sep}renderer${sep}`) || rel.startsWith(`src${sep}core${sep}`) || rel.startsWith(`assets${sep}`);
    if (!allowed || rel.startsWith('..')) return new Response('forbidden', { status: 403 });
    try {
      const body = await readFile(file);
      return new Response(body, { headers: { 'content-type': MIME[extname(file)] || 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

function fitToWorkArea() {
  if (!win || win.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds(workArea);
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: 'خلفون',
    webPreferences: {
      preload: join(ROOT, 'src', 'main', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault(); });
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => { win = null; });
  win.webContents.on('console-message', (...args) => {
    const e = args[0];
    const level = typeof e === 'object' && e !== null && 'level' in e ? e.level : args[1];
    const message = typeof e === 'object' && e !== null && 'message' in e ? e.message : args[2];
    if (level === 'error' || level === 'warning' || level === 2 || level === 3) diag.write(`page ${level === 'error' || level === 3 ? 'error' : 'warning'}:`, String(message));
  });
  win.webContents.on('render-process-gone', (_e, details) => diag.write('page crashed:', details));
  win.webContents.on('unresponsive', () => diag.write('page not responding'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => diag.write('page failed to load:', code, desc, url));
  win.webContents.on('preload-error', (_e, path, err) => diag.write('preload error:', path, String(err)));
  win.loadURL(START_URL);
}

function trayIcon() {
  const img = nativeImage.createFromPath(join(ROOT, 'assets', 'icon.png'));
  return img.isEmpty() ? img : img.resize({ width: 20, height: 20 });
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('خلفون');
  const showAnd = (type) => () => { if (win) { win.showInactive(); send(type); } };
  const canAutoStart = process.platform === 'win32' || process.platform === 'darwin';
  const menu = Menu.buildFromTemplate([
    { label: 'خلفون', enabled: false },
    { type: 'separator' },
    { label: 'اكتب أمراً  (Ctrl+Shift+K)', click: () => { if (win) { focusOverlay(); send('open-command'); } } },
    { label: 'تحدث  (Ctrl+Shift+Space)', click: showAnd('ptt') },
    { label: 'تعال يا خلفون', click: showAnd('come') },
    { label: 'الإعدادات', click: () => { if (win) { focusOverlay(); send('open-settings'); } } },
    { type: 'separator' },
    { label: 'سجل خلفون (لو في مشكلة)', click: () => { shell.openPath(diag.file || '').catch(() => {}); } },
    { label: 'إخفاء / إظهار', click: () => { if (!win) return; if (win.isVisible()) win.hide(); else win.showInactive(); } },
    ...(canAutoStart ? [{ label: 'تشغيل مع بدء الجهاز', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) }] : []),
    { label: 'خروج', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (win) { win.showInactive(); send('come'); } });
}

function registerShortcuts() {
  const ok1 = globalShortcut.register('CommandOrControl+Shift+Space', () => { if (win) { win.showInactive(); send('ptt'); } });
  const ok2 = globalShortcut.register('CommandOrControl+Shift+K', () => { if (win) { focusOverlay(); send('open-command'); } });
  if (!ok1 || !ok2) console.warn('Some keyboard shortcuts are taken by another program.');
  diag.write('shortcuts', { 'Ctrl+Shift+Space': ok1, 'Ctrl+Shift+K': ok2 });
}

/**
 * Tells the page when a new file lands in Downloads (once it has finished
 * downloading and its size stops changing), so Khalfoun can offer to open it.
 */
function watchDownloads(dir) {
  const seen = new Map();
  try {
    watchFolder(dir, { persistent: false }, (type, name) => {
      if (!name || PARTIAL_DOWNLOAD.test(name) || seen.has(name)) return;
      seen.set(name, Date.now());
      setTimeout(async () => {
        try {
          const a = await stat(join(dir, name));
          await new Promise((r) => setTimeout(r, 1500));
          const b = await stat(join(dir, name));
          if (!b.isFile() || a.size !== b.size || b.size === 0) { seen.delete(name); return; }
          if (Date.now() - b.birthtimeMs > 5 * 60000 && Date.now() - b.mtimeMs > 5 * 60000) return; // an old file, just renamed
          diag.write('download arrived', name);
          send('download', { name, kind: downloadKind(name) });
        } catch { seen.delete(name); }
      }, 800);
      if (seen.size > 200) seen.clear();
    });
  } catch (err) {
    diag.write('cannot watch downloads:', String(err?.message || err));
  }
}

let reminderScheduler = null;

function showReminder(r) {
  if (win) win.showInactive();
  send('reminder', { note: r.note });
  if (Notification.isSupported()) {
    new Notification({ title: 'خلفون', body: r.note ? `تذكير: ${r.note}` : 'جا وقت التذكير!', silent: false }).show();
  }
}

function scheduleReminder(minutes, note, repeat = false) {
  reminderScheduler.add({ minutes, note, repeat });
}

async function captureScreen() {
  const display = screen.getPrimaryDisplay();
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!source) throw new Error('no_screen');
  return source.thumbnail.toPNG();
}

let pdfFontCss = '';

/** Renders overlay HTML to a one-page transparent PDF with Chromium (correct Arabic shaping). */
async function renderOverlayPdf(html, size) {
  const view = new BrowserWindow({ show: false, width: 800, height: 1000, webPreferences: { offscreen: true, javascript: false, sandbox: true } });
  try {
    await view.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await view.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true', true).catch(() => true);
    return await view.webContents.printToPDF({
      pageSize: { width: size.width / 72, height: size.height / 72 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: false,
      preferCSSPageSize: true,
    });
  } finally {
    view.destroy();
  }
}

async function writePdf(text, position, dirs, page = 1) {
  const res = await writeIntoLatestPdf({ dirs, text, position, page, render: renderOverlayPdf, fontCss: pdfFontCss });
  if (res.ok && !SMOKE) shell.openPath(res.data.file);
  return res;
}

/** Hands keyboard focus back to the program the person was using before pasting. */
let focusTimer = null;
let returnPid = null; // the program that was in front when Khalfoun took the focus (Windows)

/**
 * Before typing or pressing keys: hands the focus back to the person's program.
 * Returns that program's process id when Khalfoun had the focus, so the action
 * can bring exactly that program forward (blur alone does not always do it).
 */
function releaseFocus() {
  if (!win || !win.isFocused()) return null;
  win.setFocusable(false);
  win.blur();
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.setFocusable(true); }, 1500);
  return returnPid;
}

/**
 * The program in front right now (Windows): {pid, process, title}, or null.
 * A small PowerShell helper stays running so the answer comes back in milliseconds.
 */
let fgHelper = null;
const FG_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -Name F -Namespace K -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
'@
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $h = [K.F]::GetForegroundWindow(); $p = 0; [void][K.F]::GetWindowThreadProcessId($h, [ref]$p)
  $sb = New-Object System.Text.StringBuilder 512; [void][K.F]::GetWindowText($h, $sb, 512)
  $n = ''; try { $n = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch {}
  [Console]::Out.WriteLine("$p\t$n\t" + ($sb.ToString() -replace '[\r\n\t]', ' ')); [Console]::Out.Flush()
}
`;
function foregroundInfo() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (!fgHelper) {
    const encoded = Buffer.from(FG_SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    fgHelper = { child, waiting: [], buf: '' };
    child.stdout.on('data', (d) => {
      fgHelper.buf += d;
      let nl;
      while ((nl = fgHelper.buf.indexOf('\n')) >= 0) {
        const [pidText, proc = '', ...title] = fgHelper.buf.slice(0, nl).replace(/\r$/, '').split('\t');
        fgHelper.buf = fgHelper.buf.slice(nl + 1);
        const pid = Number(pidText);
        const next = fgHelper.waiting.shift();
        if (next) next(Number.isInteger(pid) && pid > 0 ? { pid, process: proc, title: title.join(' ').trim() } : null);
      }
    });
    const reset = () => { if (fgHelper) for (const w of fgHelper.waiting) w(null); fgHelper = null; };
    child.on('exit', reset);
    child.on('error', reset);
  }
  const helper = fgHelper;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { const k = helper.waiting.indexOf(done); if (k >= 0) helper.waiting.splice(k, 1); resolve(null); }, 2500);
    function done(info) { clearTimeout(timer); resolve(info); }
    helper.waiting.push(done);
    try { helper.child.stdin.write('fg\n'); } catch { done(null); }
  });
}
const foregroundPid = async () => (await foregroundInfo())?.pid ?? null;

/** The person's program (not Khalfoun): the one in front, or the one he took the focus from. */
async function activeWindow() {
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported' };
  const own = new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
  const info = await foregroundInfo();
  if (info && !own.has(info.pid)) return { ok: true, data: { process: info.process, title: info.title } };
  if (lastOther) return { ok: true, data: lastOther };
  return { ok: false, error: 'unknown_window' };
}
let lastOther = null;

/** Reads the screen (without Khalfoun on it) with Windows' own OCR. */
async function readScreen() {
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported' };
  const dir = await mkdtemp(join(tmpdir(), 'khalfoun-ocr-'));
  const file = join(dir, 'screen.png');
  try {
    if (win && !win.isDestroyed()) win.setOpacity(0);
    await new Promise((r) => setTimeout(r, 180));
    const png = await captureScreen();
    await writeFile(file, png);
  } finally {
    if (win && !win.isDestroyed()) win.setOpacity(1);
  }
  try {
    return await ocrImage(file);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Brings Khalfoun's window forward for typing, even right after he gave the focus away. */
async function focusOverlay() {
  if (!win || win.isDestroyed()) return;
  clearTimeout(focusTimer);
  if (!win.isFocused()) {
    // Remember who had the focus, so typing later goes back to that program.
    const info = await foregroundInfo();
    const pid = info?.pid ?? null;
    const own = new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
    if (pid && !own.has(pid)) { returnPid = pid; lastOther = { process: info.process, title: info.title }; }
    diag.write('focus taken from program', pid ?? 'unknown', info?.process || '');
  }
  win.setFocusable(true);
  win.show();
  win.focus();
}

function sanitizeSettingsPatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if ('level' in patch) out.level = Math.min(3, Math.max(1, Math.round(Number(patch.level)) || 1));
  if ('kidsMode' in patch) out.kidsMode = !!patch.kidsMode;
  if (patch.onboarded === true) out.onboarded = true;
  if ('chatEnabled' in patch) out.chatEnabled = !!patch.chatEnabled;
  return out;
}

async function confirmRaise(message, detail) {
  if (SMOKE) return process.env.KHALFOUN_SMOKE_ALLOW_RAISE === '1';
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['نعم، أسمح', 'لا'], defaultId: 1, cancelId: 1, title: 'خلفون', message, detail,
  });
  return response === 0;
}

function setupIpc(stores, executor) {
  ipcMain.handle('state:load', async (event) => {
    if (!fromApp(event)) return null;
    const memory = await stores.memory.read();
    return { memory: Object.keys(memory).length ? memory : null, settings, voice: { available: whisper.available }, chat: { available: Boolean(chat), model: chatInfo?.model || null, vision: visionModel }, platform: process.platform };
  });

  ipcMain.handle('memory:save', async (event, data) => {
    if (!fromApp(event) || !data || typeof data !== 'object') return false;
    const json = JSON.stringify(data);
    if (json.length > 2 * 1024 * 1024) return false;
    const clean = JSON.parse(json);
    // Permission settings live in the main process only.
    delete clean.level; delete clean.kidsMode; delete clean.onboarded;
    await stores.memory.write(clean);
    return true;
  });

  ipcMain.handle('settings:update', async (event, patch) => {
    if (!fromApp(event)) return { ok: false, settings };
    const next = { ...settings, ...sanitizeSettingsPatch(patch) };
    if (settings.onboarded) {
      // Giving Khalfoun more power after setup always needs a real dialog from the system, not the page.
      if (next.level > settings.level) {
        const info = LEVEL_INFO[next.level];
        if (!(await confirmRaise(`تسمح لخلفون بمستوى «${info.name}»؟`, info.can))) return { ok: false, settings };
      }
      if (settings.kidsMode && !next.kidsMode) {
        if (!(await confirmRaise('إيقاف وضع الأطفال؟', 'خلفون بيقدر يعدّل الملفات ويفتح أي موقع حسب مستوى الإذن.'))) return { ok: false, settings };
      }
    } else if (next.onboarded && !next.level) {
      next.level = 1;
    }
    settings = next;
    await stores.settings.write(settings);
    diag.write('settings', { level: settings.level, kidsMode: settings.kidsMode, onboarded: settings.onboarded, chatEnabled: settings.chatEnabled });
    return { ok: true, settings };
  });

  ipcMain.handle('action:run', async (event, action) => {
    if (!fromApp(event)) { diag.write('action refused: not from the app page'); return { ok: false, error: 'forbidden' }; }
    const result = await executor.run(action);
    const seen = typeof result?.data?.text === 'string' ? ` text(${result.data.language || ''}): «${result.data.text.replace(/\s+/g, ' ').slice(0, action?.type === 'read_screen' ? 900 : 160)}»` : '';
    diag.write('action', action?.type, action?.params || {}, '→', result?.ok ? `ok${seen}` : `failed: ${result?.error}`);
    return result;
  });

  let sttBusy = false;
  ipcMain.handle('voice:transcribe', async (event, wav, purpose) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    const bytes = wav instanceof Uint8Array ? wav : new Uint8Array(wav || []);
    const isWake = purpose === 'wake';
    // Wake-word checks are skipped while another recognition runs, so they never pile up.
    if (isWake && sttBusy) return { ok: false, error: 'busy' };
    sttBusy = true;
    try {
      // Use most cores for a command (faster answer), fewer for wake-word checks running in the background.
      const cores = Math.max(1, cpus().length);
      const threads = isWake ? Math.min(4, Math.max(2, cores - 2)) : Math.min(8, Math.max(2, cores - 1));
      let words = [];
      if (!isWake) {
        try { words = Object.keys((await stores.memory.read()).aliases || {}); } catch { words = []; }
      }
      const res = await transcribe(whisper, bytes, { purpose: isWake ? 'wake' : 'command', threads, words });
      if (!isWake || !res.ok) diag.write(`voice (${isWake ? 'wake' : 'command'}, ${bytes.length} bytes) →`, res.ok ? `«${res.text}»` : `failed: ${res.error}`);
      return res;
    } finally {
      sttBusy = false;
    }
  });

  ipcMain.on('ui:focus', (event) => { if (fromApp(event)) focusOverlay(); });

  ipcMain.on('ui:interactive', (event, on) => {
    if (!fromApp(event) || !win) return;
    win.setIgnoreMouseEvents(!on, { forward: true });
  });

  ipcMain.handle('chat:task', async (event, payload) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (!chat || settings.chatEnabled === false) return { ok: false, error: 'chat_unavailable' };
    const p = payload && typeof payload === 'object' ? payload : {};
    if (!TASK_MODES.includes(p.mode)) return { ok: false, error: 'bad_mode' };
    const res = await chat.task({ mode: p.mode, text: String(p.text || '').slice(0, 4000), kidsMode: !!settings.kidsMode });
    diag.write('model task', p.mode, '→', res.ok ? `${res.text.length} chars` : `failed: ${res.error}`);
    return res;
  });

  ipcMain.handle('vision:look', async (event, payload) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (!chat || !visionModel || settings.chatEnabled === false) return { ok: false, error: 'vision_unavailable' };
    if (!settings.level || settings.level < 2) return { ok: false, error: 'level_too_low' };
    const mode = LOOK_MODES.includes(payload?.mode) ? payload.mode : 'describe';
    let image;
    try {
      if (win && !win.isDestroyed()) win.setOpacity(0);
      await new Promise((r) => setTimeout(r, 180));
      const display = screen.getPrimaryDisplay();
      const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
      if (!source) return { ok: false, error: 'no_screen' };
      // Smaller pictures keep the local model fast; 1280 px wide is enough to read a worksheet.
      const shot = source.thumbnail;
      const small = shot.getSize().width > 1280 ? shot.resize({ width: 1280, quality: 'good' }) : shot;
      image = small.toJPEG(82).toString('base64');
    } finally {
      if (win && !win.isDestroyed()) win.setOpacity(1);
    }
    const res = await chat.vision({ mode, image, model: visionModel, kidsMode: !!settings.kidsMode });
    diag.write('vision', mode, visionModel, '→', res.ok ? `${res.text.length} chars` : `failed: ${res.error}`);
    return res;
  });

  ipcMain.handle('chat:reply', async (event, payload) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (!chat || settings.chatEnabled === false) return { ok: false, error: 'chat_unavailable' };
    const p = payload && typeof payload === 'object' ? payload : {};
    const history = Array.isArray(p.history) ? p.history.slice(-4).map((h) => ({ user: String(h?.user || ''), khalfoun: String(h?.khalfoun || '') })) : [];
    // Kids mode comes from the main process settings, not from the page.
    return chat.reply({ text: String(p.text || '').slice(0, 500), name: String(p.name || '').slice(0, 40), humor: Number(p.humor) || 1, history, kidsMode: !!settings.kidsMode });
  });

  // ----- one-click setup (voice and local brain), started from the settings panel
  let setupJob = null; // { kind, controller }
  const progress = (kind) => (p) => send('setup-progress', { kind, ...p });

  ipcMain.handle('setup:status', async (event) => {
    if (!fromApp(event)) return null;
    const dir = voiceDirs[0];
    const has = async (f) => { try { return (await stat(join(dir, f))).size > 0; } catch { return false; } };
    const haveProgram = Boolean(whisper.bin) || (await has(WHISPER_PROGRAM.files[0]));
    const haveModels = [];
    for (const m of Object.keys(WHISPER_MODELS)) if (await has(m)) haveModels.push(m);
    const packs = Object.fromEntries(Object.entries(VOICE_PACKS).map(([id, p]) => [id, { label: p.label, mb: packSizeMB(id, { haveProgram, haveModels }) }]));
    const ollama = await ollamaStatus();
    return {
      busy: setupJob?.kind || null,
      voice: { available: whisper.available, supported: process.platform === 'win32' || haveProgram, packs },
      brain: { ollamaRunning: ollama.running, ollamaModels: ollama.models, chatAvailable: Boolean(chat), model: chatInfo?.model || null, vision: visionModel, choices: BRAIN_MODELS },
    };
  });

  ipcMain.handle('setup:voice', async (event, packId) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (setupJob) return { ok: false, error: 'busy', text: 'فيه تنزيل شغّال الحين.' };
    if (!Object.hasOwn(VOICE_PACKS, packId)) return { ok: false, error: 'unknown_pack' };
    const controller = new AbortController();
    setupJob = { kind: 'voice', controller };
    try {
      await setupVoice({ dir: voiceDirs[0], pack: packId, fetchFn: (url, init) => net.fetch(url, init), signal: controller.signal, onProgress: progress('voice') });
      whisper = await findWhisper({ dirs: voiceDirs });
      send('voice-ready', { available: whisper.available });
      diag.write('voice setup', packId, '→', whisper.available ? 'ready' : 'files missing after download');
      return { ok: whisper.available, error: whisper.available ? undefined : 'not_found', text: whisper.available ? undefined : setupErrorText('') };
    } catch (err) {
      console.warn('voice setup failed:', err);
      diag.write('voice setup', packId, 'failed:', String(err?.message || err));
      return { ok: false, error: String(err?.message || err), text: setupErrorText(err) };
    } finally {
      setupJob = null;
    }
  });

  ipcMain.handle('setup:brain', async (event, choice) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (setupJob) return { ok: false, error: 'busy', text: 'فيه تنزيل شغّال الحين.' };
    if (!Object.hasOwn(BRAIN_MODELS, choice)) return { ok: false, error: 'unknown_choice' };
    const { model } = BRAIN_MODELS[choice];
    const controller = new AbortController();
    setupJob = { kind: 'brain', controller };
    try {
      const status = await ollamaStatus();
      if (!status.running) return { ok: false, error: 'ollama_not_running', text: 'Ollama مو شغّال. ثبّته أو شغّله وبعدين جرّب.' };
      if (!status.models.includes(model)) await pullOllamaModel({ model, signal: controller.signal, onProgress: progress('brain') });
      chat = null;
      await lookForModel(model);
      send('chat-ready', { available: Boolean(chat), model: chatInfo?.model || null, vision: visionModel });
      return { ok: Boolean(chat), model: chatInfo?.model || null, text: chat ? undefined : 'نزل النموذج بس ما قدرت أكلمه. جرّب بعد شوي.' };
    } catch (err) {
      console.warn('brain setup failed:', err);
      diag.write('brain setup', choice, 'failed:', String(err?.message || err));
      return { ok: false, error: String(err?.message || err), text: setupErrorText(err) };
    } finally {
      setupJob = null;
    }
  });

  ipcMain.handle('setup:cancel', (event) => {
    if (!fromApp(event) || !setupJob) return false;
    setupJob.controller.abort();
    return true;
  });

  ipcMain.handle('setup:get-ollama', async (event) => {
    if (!fromApp(event)) return false;
    await shell.openExternal(OLLAMA_DOWNLOAD_PAGE);
    return true;
  });

  ipcMain.on('diag:note', (event, text) => {
    if (fromApp(event)) diag.write('page:', String(text || '').slice(0, 600));
  });

  ipcMain.on('ui:watch-windows', (event, on) => {
    if (!fromApp(event) || !watcher) return;
    if (on) watcher.start().catch((err) => console.warn('window watcher failed:', err));
    else watcher.stop();
  });

  ipcMain.on('app:quit', (event) => { if (fromApp(event)) app.quit(); });
}

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const own = (details.requestingUrl || '').startsWith(`${ORIGIN}/`);
    const audioOnly = permission === 'media' && (details.mediaTypes || []).every((t) => t === 'audio');
    callback(own && audioOnly);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && origin === ORIGIN);
}

async function runSmokeTest(stores) {
  // Automated check used in CI/dev: drives the real app and exits with a report.
  const report = { errors: [], steps: [] };
  win.webContents.on('console-message', (...args) => {
    const e = args[0];
    const level = typeof e === 'object' && e !== null && 'level' in e ? e.level : args[1];
    const message = typeof e === 'object' && e !== null && 'message' in e ? e.message : args[2];
    if (level === 'error' || level === 3) report.errors.push(String(message));
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const waitFor = async (code, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(code)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  };
  const step = (name, ok, extra) => report.steps.push({ name, ok: !!ok, ...(extra ? { extra } : {}) });
  try {
    step('page ready', await waitFor("document.documentElement.dataset.ready === '1'"));
    step('onboarding visible', await js("!document.getElementById('onboarding').hidden"));
    await js(`document.getElementById('ob-name').value = 'تجربة';
      document.querySelector('input[name="ob-level"][value="3"]').checked = true;
      document.getElementById('ob-go').click(); true`);
    step('onboarding saved in main', await waitFor("document.getElementById('onboarding').hidden") && settings.onboarded && settings.level === 3);
    const hear = (t) => js(`window.__khalfoun.hear(${JSON.stringify(t)}); document.getElementById('bubble-text').textContent`);
    await hear('كم الساعة');
    await new Promise((r) => setTimeout(r, 1500));
    step('time reply', /[٠-٩]/.test(await js("document.getElementById('bubble-text').textContent")));
    // Organize a temporary downloads folder through the real IPC path, then undo.
    await hear('رتب التنزيلات');
    const organized = await waitFor("(window.__khalfoun.brain.memory.data.log.at(-1) || {}).summary === 'ترتيب التنزيلات'");
    const logA = await js('window.__khalfoun.brain.memory.data.log.at(-1)');
    step('organize downloads via IPC', organized && logA.ok, logA);
    await hear('تراجع عن الترتيب');
    await waitFor("(window.__khalfoun.brain.memory.data.log.at(-1) || {}).summary === 'تراجع عن الترتيب'");
    step('undo organize via IPC', (await js('window.__khalfoun.brain.memory.data.log.at(-1)')).ok);
    // Write Arabic text into the newest PDF (before organizing moves it), through the real renderer.
    await hear('اكتب السلام عليكم ورحمة الله في ملف البي دي اف');
    const pdfDone = await waitFor("(window.__khalfoun.brain.memory.data.log.at(-1) || {}).summary?.startsWith('كتابة في PDF')", 20000);
    const pdfLog = await js('window.__khalfoun.brain.memory.data.log.at(-1)');
    step('write Arabic text into a PDF copy', pdfDone && pdfLog.ok, pdfLog);
    // Dictation into the PDF, page 2, bottom: lines collected, written at «خلاص».
    for (const line of ['املي عليك في البي دي اف الصفحة الثانية تحت', 'الاسم أحمد', 'الدرجة ١٨ من ٢٠ نقطة', 'خلاص']) {
      await hear(line);
      await new Promise((r) => setTimeout(r, 300));
    }
    const dictDone = await waitFor("(window.__khalfoun.brain.memory.data.log.at(-1) || {}).summary?.startsWith('إملاء في PDF')", 20000);
    const dictLog = await js('window.__khalfoun.brain.memory.data.log.at(-1)');
    step('dictate lines into page 2 of a PDF', dictDone && dictLog.ok, dictLog);
    // Main refuses an action the page should never send.
    const bad = await js("window.khalfoun.runAction({ id: 99, type: 'open_url', params: { url: 'https://evil.example' } })");
    step('main rejects unknown url', bad && bad.ok === false && bad.error === 'bad_url', bad);
    const raise = await js('window.khalfoun.updateSettings({ kidsMode: true }).then(() => window.khalfoun.updateSettings({ kidsMode: false }))');
    step('turning off kids mode needs system confirmation', raise && raise.ok === false, raise);
    await hear('اسمي سعيد');
    await new Promise((r) => setTimeout(r, 1200));
    const saved = await stores.memory.read();
    step('memory saved to disk without permission fields', saved.name === 'سعيد' && !('level' in saved));
    // One-click setup: the page can see what is installed and what each pack costs.
    const st = await js('window.khalfoun.setup.status()');
    step('setup status over IPC', st && st.voice?.packs?.balanced?.mb > 400 && st.brain?.choices?.standard?.model === 'qwen2.5:3b', st);
    if (process.platform !== 'win32') {
      const r = await js("window.khalfoun.setup.voice('light')");
      step('voice setup explains it is Windows-only here', r && r.ok === false && r.error === 'unsupported_platform' && /ويندوز/.test(r.text), r);
    } else if (process.env.KHALFOUN_SMOKE_SETUP === '1') {
      // Real download from the official pages, checksum, unzip, then one real transcription.
      const r = await js("window.khalfoun.setup.voice('light')");
      step('voice setup downloads, verifies and installs whisper', r && r.ok === true && whisper.available, { r, whisper });
      const t = await js(`(() => {
        const n = 16000, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
        v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
        v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 3000 * Math.sin(i / 1600)), true);
        return window.khalfoun.transcribe(new Uint8Array(b), 'command');
      })()`);
      step('installed whisper transcribes a recording', t && t.ok === true, t);
    }
    if (process.env.KHALFOUN_SMOKE_SHOT) {
      await hear('قول نكتة');
      await new Promise((r) => setTimeout(r, 1800));
      const img = await win.webContents.capturePage();
      await writeFile(process.env.KHALFOUN_SMOKE_SHOT, img.toPNG());
    }
  } catch (err) {
    report.errors.push(String(err?.stack || err));
  }
  const ok = report.errors.length === 0 && report.steps.every((s) => s.ok);
  console.log(`KHALFOUN_SMOKE ${JSON.stringify({ ok, ...report })}`);
  app.exit(ok ? 0 : 1);
}

async function start() {
  serveAppProtocol();
  setupPermissions();
  const userData = app.getPath('userData');
  diag = new DiagLog(userData);
  const stores = {
    memory: new JsonStore(userData, 'memory.json', {}),
    settings: new JsonStore(userData, 'settings.json', DEFAULT_SETTINGS),
    journal: new JsonStore(userData, 'organize-journal.json', { moves: [] }),
  };
  settings = { ...DEFAULT_SETTINGS, ...(await stores.settings.read()) };
  voiceDirs = [join(userData, 'voice'), join(ROOT, 'voice')];
  whisper = await findWhisper({ dirs: voiceDirs });
  diag.write('start', { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, level: settings.level, kidsMode: settings.kidsMode, onboarded: settings.onboarded, voice: whisper.available ? { bin: whisper.bin, model: whisper.model } : 'not installed' });

  let downloadsDir = app.getPath('downloads');
  if (SMOKE) {
    downloadsDir = await mkdtemp(join(tmpdir(), 'khalfoun-dl-'));
    await mkdir(downloadsDir, { recursive: true });
    for (const f of ['صورة.jpg', 'اغنية.mp3', 'ملف.unknown']) await writeFile(join(downloadsDir, f), 'x');
    const { default: lib } = await import('pdf-lib');
    const sample = await lib.PDFDocument.create();
    sample.addPage([595, 842]);
    sample.addPage([595, 842]);
    await writeFile(join(downloadsDir, 'نموذج.pdf'), await sample.save());
  }

  const platform = createPlatform({
    shell,
    clipboard,
    capture: captureScreen,
    beforeType: releaseFocus,
    home: app.getPath('home'),
    paths: { downloads: downloadsDir, documents: app.getPath('documents'), pictures: app.getPath('pictures'), desktop: app.getPath('desktop') },
  });
  reminderScheduler = new ReminderScheduler({ store: new JsonStore(userData, 'reminders.json', { items: [] }), onFire: showReminder });
  await reminderScheduler.restore();
  const executor = createExecutor({
    platform, getSettings: () => settings, downloadsDir, journal: stores.journal, scheduleReminder,
    cancelReminders: () => reminderScheduler.cancelAll(),
    readScreen,
    activeWindow,
    writePdf: (text, position, page) => writePdf(text, position, [downloadsDir, app.getPath('documents')], page),
  });
  try {
    const font = await readFile(join(ROOT, 'assets', 'fonts', 'Tajawal-700-arabic.woff2'));
    pdfFontCss = `@font-face { font-family: 'Tajawal'; font-weight: 700; src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); }`;
  } catch { /* system fonts still work */ }
  watcher = new WindowWatcher({
    onChange: (list) => send('windows', { list }),
    toDip: (r) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r),
    getWorkArea: () => screen.getPrimaryDisplay().workArea,
    selfPid: process.pid,
  });
  setupIpc(stores, executor);
  createWindow();
  // Look for a local language model now and every five minutes until one appears.
  lookForModel = async (preferred) => {
    if (chat && visionModel) return;
    const found = await findLocalModel(preferred ? { preferred } : {});
    if (!found) return;
    const hadChat = Boolean(chat);
    const hadVision = visionModel;
    if (!chat) {
      chatInfo = found;
      chat = new ChatClient(found);
      // Load the model now: the first question used to time out while it loaded from disk.
      chat.warmUp().then((r) => diag.write('local model warm-up', r)).catch(() => {});
    }
    visionModel = pickVisionModel(found.models);
    if (!hadChat || hadVision !== visionModel) {
      diag.write('local model', { chat: chatInfo?.model, vision: visionModel });
      send('chat-ready', { available: true, model: chatInfo?.model || null, vision: visionModel });
    }
  };
  if (!SMOKE) {
    lookForModel().catch(() => {});
    setInterval(() => lookForModel().catch(() => {}), 5 * 60 * 1000);
  }
  if (!SMOKE) {
    watchDownloads(downloadsDir);
    powerMonitor.on('resume', () => send('resume'));
    buildTray();
    registerShortcuts();
    foregroundPid().catch(() => {}); // warm up the helper so the first Ctrl+Shift+K is instant
  } else {
    win.webContents.once('did-finish-load', () => runSmokeTest(stores));
  }
  screen.on('display-metrics-changed', fitToWorkArea);
  screen.on('display-added', fitToWorkArea);
  screen.on('display-removed', fitToWorkArea);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.showInactive(); send('come'); } });
  app.whenReady().then(start).catch((err) => {
    console.error('Khalfoun could not start:', err);
    diag.write('could not start:', String(err?.stack || err));
    app.exit(1);
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (fgHelper) { try { fgHelper.child.kill(); } catch { /* gone */ } }
    if (watcher) watcher.stop();
    if (reminderScheduler) reminderScheduler.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
