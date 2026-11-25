// Khalfoun desktop app (Electron main process).
// A transparent, always-on-top, click-through window covers the work area;
// only Khalfoun and his panels catch the mouse. The page is served from a
// private app:// protocol, sandboxed, and can reach the system only through
// the small API in preload.cjs. Every action is validated and permission-checked
// again here.

import {
  app, BrowserWindow, ipcMain, protocol, screen, shell, clipboard, desktopCapturer, Tray, Menu,
  nativeImage, globalShortcut, dialog, Notification, session, net, powerMonitor, safeStorage,
} from 'electron';
import { readFile, readdir, mkdtemp, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { watch as watchFolder } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, normalize, relative, sep, basename } from 'node:path';
import { tmpdir, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './storage.js';
import { createPlatform } from './actions/platform.js';
import { createExecutor } from './actions/index.js';
import { findWhisper, transcribe, wavSeconds } from './stt.js';
import { transcribeAzure, speakAzure, sampleAzure, verifyAzure, ClaudeAgent, GeminiAgent, chainAgents, screenPrompt } from './cloud.js';
import { CloudSecrets, DEFAULT_CLOUD } from './secrets.js';
import { WindowWatcher } from './windows-watcher.js';
import { ChatClient, findLocalModel, pickVisionModel } from './chat.js';
import { ReminderScheduler } from './reminders.js';
import { writeIntoLatestPdf } from './actions/pdf.js';
import { LEVEL_INFO } from '../core/permissions.js';
import { DiagLog } from './diag.js';
import { ocrImage } from './ocr.js';
import { TASK_MODES, LOOK_MODES, lookTask } from '../core/chat-prompt.js';
import { findOnScreen, layoutHint } from '../core/screen-find.js';
import { createClaudeMind } from './brain/index.js';
import { FG_SCRIPT } from './foreground-script.js';
import { REMOTE_ACCEL } from '../core/remote-keys.js';
import { EAR_KINDS, EAR_VOICES, earTtsPlan } from '../core/ear-plan.js';
import { createPhoneMic } from './phone-mic.js';
import { request as httpsRequest } from 'node:https';
import selfsigned from 'selfsigned';
import QRCode from 'qrcode';
import { Notebook } from '../core/notebook.js';
import { OfficeHost } from './office/office-host.js';
import { createOfficeActions } from './office/index.js';
import { composePrompt, extractJson, cleanPlan, KINDS } from '../core/office-plan.js';
const KIND_SET = new Set(Object.keys(KINDS));
import { PARTIAL_DOWNLOAD, downloadKind } from '../core/desktop.js';
import {
  setupVoice, pullOllamaModel, ollamaStatus, setupErrorText, packSizeMB,
  VOICE_PACKS, WHISPER_PROGRAM, WHISPER_MODELS, BRAIN_MODELS, OLLAMA_DOWNLOAD_PAGE,
} from './setup.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'app://khalfoun';
const START_URL = `${ORIGIN}/src/renderer/index.html`;
const SMOKE = process.env.KHALFOUN_SMOKE === '1';
// The maths whiteboard «مِداد» ships next to Khalfoun: the repository root when run from
// the code, resources/midad in the installed app (see "extraResources" in package.json).
const MIDAD_ROOT = app.isPackaged ? join(process.resourcesPath, 'midad') : join(ROOT, '..');
const MIDAD_ALLOWED = ['index.html', 'manifest.webmanifest', `js${sep}`, `css${sep}`, `assets${sep}`];
const MIME = {
  '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
};
// The ear's WebAssembly runtime: exactly these three files of onnxruntime-web, nothing else of node_modules.
const ORT_FILES = new Set(['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map((f) => join('node_modules', 'onnxruntime-web', 'dist', f)));
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
let downloadsDirForSmoke = '';
let officeHost = null; // the PowerShell that writes and draws inside Office (Windows)
let handsHost = null; // the PowerShell that moves the mouse and presses keys for the Claude mind
let mind = null; // the Claude mind (the teacher's own Claude subscription) // the smoke test's own Downloads/Documents folder
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
    const path = decodeURIComponent(url.pathname);
    let file;
    if (path.startsWith('/midad/')) {
      // The whiteboard: only its own page, scripts, styles and assets.
      file = normalize(join(MIDAD_ROOT, path.slice('/midad/'.length)));
      const rel = relative(MIDAD_ROOT, file);
      if (rel.startsWith('..') || !MIDAD_ALLOWED.some((a) => rel === a || rel.startsWith(a))) return new Response('forbidden', { status: 403 });
    } else {
      file = normalize(join(ROOT, path));
      const rel = relative(ROOT, file);
      const allowed = rel.startsWith(`src${sep}renderer${sep}`) || rel.startsWith(`src${sep}core${sep}`) || rel.startsWith(`src${sep}notebook${sep}`) || rel.startsWith(`src${sep}reading${sep}`) || rel.startsWith(`assets${sep}`) || ORT_FILES.has(rel);
      if (!allowed || rel.startsWith('..')) return new Response('forbidden', { status: 403 });
    }
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

// ------------------------------------------------------------------ his tools
// The whiteboard (مِداد) and the AI notebook open as normal windows of Khalfoun's own app.
const TOOL_PAGES = {
  board: { url: `${ORIGIN}/midad/index.html`, title: 'سبورة خلفون — مِداد', width: 1280, height: 820 },
  notebook: { url: `${ORIGIN}/src/notebook/index.html`, title: 'دفتر خلفون', width: 1180, height: 780, preload: 'notebook-preload.cjs' },
  reading: { url: `${ORIGIN}/src/reading/index.html`, title: 'اختبار القراءة — خلفون', width: 1100, height: 760, preload: 'reading-preload.cjs' },
};
const toolWindows = {};

let secrets = { status: () => ({}), data: { use: {} }, azure: null, allowWake: () => false };
let agent = null;
let saveUsageTimer = null;
// Hearing in the cloud: Azure when its key is set, else Gemini with the same free key as the brain.
const cloudHears = () => Boolean(secrets.data.use?.hear && (secrets.azure || secrets.data.gemini));
let geminiEars = null;
function cloudTranscribe(bytes, isWake) {
  if (secrets.azure) return transcribeAzure(secrets.azure, bytes, { timeoutMs: isWake ? 6000 : 8000 }).then((r) => ({ ...r, service: 'azure' }));
  if (!geminiEars) geminiEars = new GeminiAgent({ key: secrets.geminiKey, fetchFn: (url, init) => net.fetch(url, init) });
  return geminiEars.transcribe(bytes, { timeoutMs: isWake ? 7000 : 9000 }).then((r) => ({ ...r, service: 'gemini' }));
}
// With the Claude mind on (the teacher's subscription), no other cloud mind is used.
const cloudThinks = () => settings?.mind !== 'claude' && Boolean(secrets.data.use?.brain && secrets.brain);
/**
 * The cloud brain: Claude when its key is set, Gemini otherwise — and Gemini also steps in when
 * Claude has no credit, a bad key or is busy (seen: a Claude key without credit blocked Gemini).
 */
function getAgent() {
  if (agent) return agent;
  const fetchFn = (url, init) => net.fetch(url, init);
  const claude = secrets.data.claude ? new ClaudeAgent({ key: secrets.claudeKey, fetchFn }) : null;
  const gemini = secrets.data.gemini ? new GeminiAgent({ key: secrets.geminiKey, fetchFn }) : null;
  agent = {
    respond: (p) => chainAgents([claude, gemini]).respond(p),
    // Writing: Gemini first (free and usually there); the same agent object keeps what it
    // learned about busy models between requests.
    write: (p) => chainAgents([gemini, claude]).write(p),
    vision: (image, opts) => chainAgents([gemini, claude]).vision(image, opts),
    async verifyAll() {
      const out = {};
      if (claude) out.claude = await claude.verify();
      if (gemini) out.gemini = await gemini.verify();
      return out;
    },
  };
  return agent;
}

function openTool(tool) {
  const page = TOOL_PAGES[tool];
  if (!page) return { ok: false, error: 'bad_tool' };
  const existing = toolWindows[tool];
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true, data: { already: true } };
  }
  const { workArea } = screen.getPrimaryDisplay();
  const w = new BrowserWindow({
    width: Math.min(page.width, workArea.width - 40),
    height: Math.min(page.height, workArea.height - 40),
    title: page.title,
    icon: join(ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#fffdf7',
    webPreferences: {
      preload: page.preload ? join(ROOT, 'src', 'main', page.preload) : undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  w.setMenuBarVisibility(false);
  w.webContents.setWindowOpenHandler(({ url }) => {
    // Links inside the tools open in the person's browser, never inside the app.
    if (/^https:\/\//.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault(); });
  w.once('ready-to-show', () => { w.show(); w.focus(); });
  w.on('closed', () => {
    if (toolWindows[tool] === w) delete toolWindows[tool];
    send('tool-closed', { tool });
    diag.write('tool closed', tool);
  });
  toolWindows[tool] = w;
  w.loadURL(page.url).catch((err) => diag.write('tool load failed', tool, String(err?.message || err)));
  diag.write('tool opened', tool);
  return { ok: true };
}

function closeTool(tool) {
  const w = toolWindows[tool];
  if (!w || w.isDestroyed()) return { ok: false, error: 'not_running' };
  w.close();
  return { ok: true };
}

/** Only the notebook window may use the notebook's IPC. */
const fromNotebook = (event) => {
  const w = toolWindows.notebook;
  return Boolean(w && !w.isDestroyed() && event.sender === w.webContents && (event.senderFrame?.url || '').startsWith(`${ORIGIN}/src/notebook/`));
};

/** Only the reading window may use the reading IPC. */
const fromReading = (event) => {
  const w = toolWindows.reading;
  return Boolean(w && !w.isDestroyed() && event.sender === w.webContents && (event.senderFrame?.url || '').startsWith(`${ORIGIN}/src/reading/`));
};

/** Puts a note into the notebook file (used by the camera solve) and refreshes an open notebook. */
async function addNotebookNote(store, title, body) {
  const nb = new Notebook(await store.read());
  const note = nb.add({ title, body });
  await store.write(nb.data);
  const w = toolWindows.notebook;
  if (w && !w.isDestroyed()) w.webContents.send('nb:refresh', { id: note.id });
  return note;
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
  win.setAlwaysOnTop(true, 'screen-saver');
  // A watchdog: if another program pushed Khalfoun behind it (a PDF in full screen, a window
  // brought forward), he comes back on top within a second and a half. Cheap: no focus taken.
  setInterval(() => { if (win && !win.isDestroyed() && win.isVisible() && !win.isFocused()) keepOnTop(); }, 1500);
  win.on('always-on-top-changed', (_e, on) => { if (!on) setTimeout(keepOnTop, 50); });
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
  if (settings.remoteKey) diag.write('remote button', settings.remoteKey, registerRemote(settings.remoteKey) ? 'ready' : 'taken by another program');
}

// The teacher's presenter remote: one learned button makes Khalfoun listen, from anywhere.
let phoneMic = null;
let remoteAccel = null;
let remoteLast = 0;
function registerRemote(accel) {
  if (remoteAccel) { try { globalShortcut.unregister(remoteAccel); } catch { /* already gone */ } remoteAccel = null; }
  if (!accel || !REMOTE_ACCEL.test(accel)) return false;
  let ok = false;
  try {
    ok = globalShortcut.register(accel, () => {
      // A remote can repeat a held key: one press is one listen.
      if (Date.now() - remoteLast < 700 || !win) return;
      remoteLast = Date.now();
      diag.write('remote button pressed');
      win.showInactive();
      send('ptt');
    });
  } catch { ok = false; }
  if (ok) remoteAccel = accel;
  return ok;
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

let docFontCss = '';

/** Prints a whole document page (HTML) to an A4 PDF file. */
async function printPlanPdf(html, file) {
  const view = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { offscreen: true, javascript: false, sandbox: true } });
  try {
    await view.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await view.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    await writeFile(file, pdf);
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
let returnHwnd = null; // its exact window (one program can have several, like Notepad)

/**
 * Before typing or pressing keys: hands the focus back to the person's program.
 * Returns that program's process id when Khalfoun had the focus, so the action
 * can bring exactly that program forward (blur alone does not always do it).
 */
/**
 * Khalfoun stays above every window. On Windows, changing whether the window can take the
 * focus (and other programs coming forward) can drop it behind them: put it back on top,
 * without taking the focus.
 */
function keepOnTop() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

function releaseFocus() {
  if (!win || !win.isFocused()) return null;
  win.setFocusable(false);
  win.blur();
  keepOnTop();
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => { if (win && !win.isDestroyed()) { win.setFocusable(true); keepOnTop(); } }, 1500);
  return returnPid;
}

/**
 * The command box closed: the focus goes back to exactly the program the person was in.
 * (blur alone lets Windows pick the next window, often a folder left open behind.)
 */
async function giveFocusBack() {
  const pid = releaseFocus();
  if (!pid || process.platform !== 'win32') return null;
  // The exact window first (Notepad keeps several windows in one program), else the program.
  let fg = returnHwnd ? await foregroundInfo(`acth ${returnHwnd}`).catch(() => null) : null;
  if (!fg || fg.pid !== pid) fg = await foregroundInfo(`act ${pid}`).catch(() => null);
  diag.write('focus given back to', fg?.process || '?', `«${String(fg?.title || '').slice(0, 50)}»`, fg?.hwnd === returnHwnd ? '(same window)' : '');
  keepOnTop();
  return fg;
}

/**
 * The program in front right now (Windows): {pid, process, title}, or null.
 * A small PowerShell helper stays running so the answer comes back in milliseconds.
 */
let fgHelper = null;

function foregroundInfo(request = 'fg') {
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
        const [pidText, proc = '', hwndText = '', ...title] = fgHelper.buf.slice(0, nl).replace(/\r$/, '').split('\t');
        fgHelper.buf = fgHelper.buf.slice(nl + 1);
        const pid = Number(pidText);
        const next = fgHelper.waiting.shift();
        if (next) next(Number.isInteger(pid) && pid > 0 ? { pid, process: proc, hwnd: /^\d+$/.test(hwndText) ? hwndText : null, title: title.join(' ').trim() } : null);
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
    try { helper.child.stdin.write(`${/^acth? \d+$/.test(request) ? request : 'fg'}\n`); } catch { done(null); }
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

/**
 * «حط دايرة على كلمة الماء»: reads the whole screen at full resolution with word positions
 * and returns where the words are, in the overlay window's own coordinates.
 */
async function findOnScreenWords(text) {
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported' };
  const dir = await mkdtemp(join(tmpdir(), 'khalfoun-find-'));
  const file = join(dir, 'screen.png');
  const display = screen.getPrimaryDisplay();
  try {
    if (win && !win.isDestroyed()) win.setOpacity(0);
    await new Promise((r) => setTimeout(r, 180));
    await writeFile(file, await captureScreen());
  } finally {
    if (win && !win.isDestroyed()) win.setOpacity(1);
  }
  try {
    const res = await ocrImage(file, { words: true });
    if (!res.ok) return res;
    const scale = display.scaleFactor || 1;
    const wa = display.workArea; const bd = display.bounds;
    const boxes = findOnScreen(res.data.words || [], text, { scale })
      .map((b) => ({ ...b, x: b.x - (wa.x - bd.x), y: b.y - (wa.y - bd.y) }));
    diag.write('find on screen', `«${String(text).slice(0, 40)}» →`, `${boxes.length} found among ${(res.data.words || []).length} words (${res.data.language || '?'})`);
    return { ok: true, data: { boxes, language: res.data.language } };
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
    if (pid && !own.has(pid)) { returnPid = pid; returnHwnd = info.hwnd || null; lastOther = { process: info.process, title: info.title }; }
    diag.write('focus taken from program', pid ?? 'unknown', info?.process || '');
  }
  win.setFocusable(true);
  win.show();
  win.focus();
  keepOnTop();
}

function sanitizeSettingsPatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if ('level' in patch) out.level = Math.min(3, Math.max(1, Math.round(Number(patch.level)) || 1));
  if ('kidsMode' in patch) out.kidsMode = !!patch.kidsMode;
  if (patch.onboarded === true) out.onboarded = true;
  if ('chatEnabled' in patch) out.chatEnabled = !!patch.chatEnabled;
  if ('mind' in patch) out.mind = patch.mind === 'claude' ? 'claude' : 'classic';
  if ('mindModel' in patch && ['fast', 'smart', 'best'].includes(patch.mindModel)) out.mindModel = patch.mindModel;
  if ('digits' in patch && ['arabic', 'latin'].includes(patch.digits)) out.digits = patch.digits;
  return out; // remoteKey is set through remote:set (checked and registered there)
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
    return {
      memory: Object.keys(memory).length ? memory : null, settings,
      voice: { available: whisper.available || cloudHears(), cloud: cloudHears() },
      chat: { available: Boolean(chat) || cloudThinks(), model: chatInfo?.model || null, vision: visionModel, cloud: cloudThinks() },
      cloud: secrets.status(), platform: process.platform,
    };
  });

  // ----- the cloud: Azure hearing and voice, Claude brain (only with the person's own keys)
  ipcMain.handle('cloud:status', (event) => (fromApp(event) ? secrets.status() : null));
  ipcMain.handle('cloud:set', async (event, patch) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    let err;
    try { err = await secrets.update(patch); } catch (e) { err = String(e?.message || e); }
    agent = null; // rebuilt with the new key on next use
    geminiEars = null;
    diag.write('cloud settings', { ...secrets.status(), error: err || undefined });
    return err ? { ok: false, error: err, status: secrets.status() } : { ok: true, status: secrets.status() };
  });
  ipcMain.handle('cloud:test', async (event) => {
    if (!fromApp(event)) return null;
    const out = {};
    if (secrets.brain) Object.assign(out, await getAgent().verifyAll());
    if (secrets.azure) out.azure = await verifyAzure(secrets.azure);
    diag.write('cloud test', out);
    return out;
  });
  ipcMain.handle('agent:respond', async (event, payload) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (!cloudThinks()) return { ok: false, error: 'not_configured' };
    const p = payload && typeof payload === 'object' ? payload : {};
    const history = Array.isArray(p.history) ? p.history.slice(-6).map((h) => ({ user: String(h?.user || '').slice(0, 400), khalfoun: String(h?.khalfoun || '').slice(0, 400) })) : [];
    const res = await getAgent().respond({
      text: String(p.text || '').slice(0, 800), history, name: String(p.name || '').slice(0, 40),
      context: String(p.context || '').slice(0, 600), kidsMode: !!settings.kidsMode, level: settings.level,
    });
    diag.write(secrets.brain || 'brain', `«${String(p.text || '').slice(0, 80)}» →`, res.ok ? `${res.addressed ? '' : '(not for me) '}«${res.say}» ${JSON.stringify(res.commands)} ${res.ms} ms${res.model ? ` ${res.model}` : ''}` : `failed: ${res.error}${res.detail ? ` (${res.detail})` : ''}`);
    return res;
  });
  // Writing a document, deck, table or diagram with the cloud brain (or the local model).
  ipcMain.handle('office:compose', async (event, payload) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (settings.mind === 'claude') return { ok: false, error: 'claude_only' }; // Claude writes through its own tools
    const p = payload && typeof payload === 'object' ? payload : {};
    const kind = KIND_SET.has(p.kind) ? p.kind : 'text';
    const req = { kind, topic: String(p.topic || '').slice(0, 300), count: Number(p.count) || null, raw: String(p.raw || '').slice(0, 400) };
    const prompt = composePrompt(req);
    const digitsLine = p.digits === 'latin' ? 'اكتب الأرقام بالأرقام 0123456789.' : 'اكتب كل الأرقام بالأرقام العربية المشرقية: ٠١٢٣٤٥٦٧٨٩.';
    const kidsLine = settings.kidsMode ? '\nالقارئ طفل: كلمات بسيطة جداً وجمل قصيرة.' : '';
    const system = `${prompt.system}\n${digitsLine}${kidsLine}`;
    const t0 = Date.now();
    let res;
    if (secrets.brain) {
      res = await getAgent().write({ system, user: prompt.user, timeoutMs: 40000 });
    } else if (chat && settings.chatEnabled !== false) {
      res = await chat.compose({ system, user: prompt.user });
    } else {
      return { ok: false, error: 'no_cloud' };
    }
    if (!res.ok) { diag.write('compose', kind, 'failed:', res.error); return { ok: false, error: res.error }; }
    const plan = cleanPlan(kind, extractJson(res.text));
    diag.write('compose', kind, `«${req.topic.slice(0, 40)}» →`, plan ? `ok (${res.service || 'local'}, ${((Date.now() - t0) / 1000).toFixed(1)} s)` : 'unusable answer');
    return plan ? { ok: true, plan } : { ok: false, error: 'unusable' };
  });
  ipcMain.handle('voice:speak', async (event, text) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (!secrets.data.use.voice || !secrets.azure) return { ok: false, error: 'not_configured' };
    const res = await speakAzure(secrets.azure, String(text || ''));
    if (!res.ok) diag.write('cloud voice failed', res.error);
    return res;
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

  // ----- Khalfoun's own ear: the teacher's recordings (and Azure voices) to train it on his name.
  // Kept on his computer in userData/wake-data; nothing is sent anywhere from here.
  const earDir = join(app.getPath('userData'), 'wake-data');
  ipcMain.handle('ear:save', async (event, kind, bytes) => {
    if (!fromApp(event) || !['call', 'other', 'room'].includes(kind)) return { ok: false, error: 'forbidden' };
    const b = bytes instanceof Uint8Array ? bytes : null;
    if (!b || b.length < 44 || b.length > 12e6 || String.fromCharCode(...b.subarray(0, 4)) !== 'RIFF') return { ok: false, error: 'bad_audio' };
    await mkdir(join(earDir, kind), { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`;
    await writeFile(join(earDir, kind, name), b);
    return { ok: true, name };
  });
  ipcMain.handle('ear:stats', async (event) => {
    if (!fromApp(event)) return null;
    const out = {};
    for (const k of EAR_KINDS) { try { out[k] = (await readdir(join(earDir, k))).filter((n) => n.endsWith('.wav')).length; } catch { out[k] = 0; } }
    out.azure = Boolean(secrets.azure);
    return out;
  });
  // The trained ear (khalfoun-ear.onnx + ear.json in userData/ear), with the two shared models.
  ipcMain.handle('ear:models', async (event) => {
    if (!fromApp(event)) return null;
    const dir = join(app.getPath('userData'), 'ear');
    let cls; let config = {};
    try { cls = await readFile(join(dir, 'khalfoun-ear.onnx')); } catch { return null; }
    try { config = JSON.parse(await readFile(join(dir, 'ear.json'), 'utf8')); } catch { /* defaults */ }
    const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
    const [mel, emb] = await Promise.all([readFile(join(ROOT, 'assets', 'ear', 'melspectrogram.onnx')), readFile(join(ROOT, 'assets', 'ear', 'embedding_model.onnx'))]);
    const out = {
      mel: new Uint8Array(mel), emb: new Uint8Array(emb), cls: new Uint8Array(cls),
      config: { mode: config.mode === 'on' ? 'on' : 'shadow', threshold: num(config.threshold, 0.5, 0.05, 0.99), high: num(config.high, 0.85, 0.1, 1), version: String(config.version || '').slice(0, 40) },
    };
    diag.write('ear model', out.config);
    return out;
  });
  let earTtsRunning = false;
  ipcMain.handle('ear:tts', async (event) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (!secrets.azure) return { ok: false, error: 'not_configured' };
    if (earTtsRunning) return { ok: false, error: 'busy' };
    earTtsRunning = true;
    const plan = earTtsPlan();
    const skipVoices = new Set(); // not offered in this Azure region
    let done = 0; let failed = 0; let made = 0;
    try {
      for (const k of ['tts-call', 'tts-other']) await mkdir(join(earDir, k), { recursive: true });
      const queue = [...plan];
      const worker = async () => {
        while (queue.length) {
          const c = queue.shift();
          const file = join(earDir, c.kind, `${c.name}.wav`);
          if (skipVoices.has(c.voice) || (await stat(file).then(() => true, () => false))) { done += 1; continue; }
          const r = await sampleAzure(secrets.azure, c);
          if (r.ok) { await writeFile(file, r.wav); made += 1; } else {
            failed += 1;
            if (r.error === 'http_400' || r.error === 'http_404') skipVoices.add(c.voice);
            if (r.error === 'bad_key') { queue.length = 0; }
          }
          done += 1;
          if (done % 5 === 0 || !queue.length) send('ear-progress', { done, total: plan.length });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      diag.write('ear voices', { made, failed, skipped: [...skipVoices] });
      return { ok: true, made, failed, voices: EAR_VOICES.length - skipVoices.size };
    } finally { earTtsRunning = false; }
  });

  // ----- the teacher's phone as a wireless microphone (only while he turns it on)
  phoneMic = createPhoneMic({
    dir: app.getPath('userData'),
    pagePath: join(ROOT, 'src', 'phone', 'index.html'),
    makeCert: (attrs, opts) => selfsigned.generate(attrs, opts),
    toQr: (url) => QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: 'M' }),
    onAudio: (pcm) => send('phone-audio', { pcm }),
    onSay: (wav) => { if (win) win.showInactive(); send('phone-say', { wav }); },
    onStatus: (st) => { diag.write('phone mic', st); send('phone-status', st); },
    log: (...a) => diag.write(...a),
  });
  const phoneAnswer = async () => {
    const info = await phoneMic.info();
    return info.ok ? info : { ok: false, error: info.error };
  };
  ipcMain.handle('phone:start', async (event) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    const r = await phoneMic.start().catch((err) => ({ ok: false, error: String(err?.message || err) }));
    if (r.ok) { settings = { ...settings, phoneMic: true }; await stores.settings.write(settings); }
    return r.ok ? phoneAnswer() : r;
  });
  ipcMain.handle('phone:stop', async (event) => {
    if (!fromApp(event)) return { ok: false };
    phoneMic.stop();
    settings = { ...settings, phoneMic: false }; await stores.settings.write(settings);
    return { ok: true };
  });
  ipcMain.handle('phone:info', async (event) => (fromApp(event) ? phoneAnswer() : null));
  if (settings.phoneMic && !SMOKE) phoneMic.start().catch((err) => diag.write('phone mic failed to start', String(err?.message || err)));

  // ----- the presenter remote: learn one button (the page sends the key it saw), or forget it
  ipcMain.handle('remote:set', async (event, accel) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (accel === null) {
      registerRemote(null);
      settings = { ...settings }; delete settings.remoteKey;
      await stores.settings.write(settings);
      diag.write('remote button', 'forgotten');
      return { ok: true };
    }
    if (typeof accel !== 'string' || !REMOTE_ACCEL.test(accel)) return { ok: false, error: 'bad_key' };
    if (!registerRemote(accel)) {
      if (settings.remoteKey) registerRemote(settings.remoteKey); // keep the old one working
      return { ok: false, error: 'taken' };
    }
    settings = { ...settings, remoteKey: accel };
    await stores.settings.write(settings);
    diag.write('remote button', accel, 'learned');
    return { ok: true, accel };
  });
  // While he presses the remote in settings, the learned button must not fire: paused, then back.
  ipcMain.handle('remote:pause', async (event, on) => {
    if (!fromApp(event)) return false;
    if (on) registerRemote(null); else if (settings.remoteKey) registerRemote(settings.remoteKey);
    return true;
  });

  // ----- the Claude mind (the teacher's own Claude subscription, signed in with Claude's own program)
  ipcMain.handle('mind:status', async (event) => (fromApp(event) && mind ? mind.status() : null));
  ipcMain.handle('mind:install', async (event) => {
    if (!fromApp(event) || !mind) return { ok: false, error: 'forbidden' };
    diag.write('claude install', 'start');
    const r = await mind.install((done, total, phase) => send('mind', { data: { type: 'install', done, total, phase } }));
    diag.write('claude install', r.ok ? 'ok' : `failed: ${r.error}`);
    return r;
  });
  ipcMain.handle('mind:signin', async (event) => (fromApp(event) && mind ? mind.signIn() : { ok: false }));
  ipcMain.handle('mind:code', async (event, code) => (fromApp(event) && mind ? mind.signInCode(code) : { ok: false }));
  ipcMain.handle('mind:signout', async (event) => (fromApp(event) && mind ? mind.signOut() : { ok: false }));
  ipcMain.handle('mind:ask', async (event, payload) => {
    if (!fromApp(event) || !mind) return { ok: false, error: 'forbidden' };
    if (settings.mind !== 'claude') return { ok: false, error: 'off' };
    const text = String(payload?.text || '').slice(0, 3000);
    if (!text.trim()) return { ok: false, error: 'empty' };
    const c = payload?.context && typeof payload.context === 'object' ? payload.context : {};
    const fg = await activeWindow().catch(() => null);
    return mind.ask(text, {
      name: String(c.name || '').slice(0, 60), via: c.via === 'typed' ? 'typed' : 'voice', session: c.session === true,
      students: Array.isArray(c.students) ? c.students.map((x) => String(x).slice(0, 40)).slice(0, 40) : [],
      notes: Array.isArray(c.notes) ? c.notes.map((x) => String(x).slice(0, 200)).slice(-12) : [],
      period: String(c.period || '').slice(0, 80),
      window: fg?.ok ? fg.data.title : '', app: fg?.ok ? fg.data.process : '',
    });
  });
  ipcMain.on('mind:stop', (event) => { if (fromApp(event)) mind?.stop(); });
  // A voice sentence just ended: take the screenshot while its words are recognised.
  ipcMain.on('mind:prefetch', (event) => { if (fromApp(event) && settings.mind === 'claude') mind?.prefetch(); });
  ipcMain.on('mind:reset', (event) => { if (fromApp(event)) mind?.reset(); });
  ipcMain.on('mind:model', (event, m) => { if (fromApp(event) && ['fast', 'smart', 'best'].includes(m)) mind?.setModel(m); });
  ipcMain.on('mind:ui-reply', (event, msg) => { if (fromApp(event) && msg && Number.isInteger(msg.id)) mind?.uiReply(msg.id, msg.result ?? null); });

  ipcMain.handle('action:run', async (event, action) => {
    if (!fromApp(event)) { diag.write('action refused: not from the app page'); return { ok: false, error: 'forbidden' }; }
    const result = await executor.run(action);
    const seen = typeof result?.data?.text === 'string' ? ` text(${result.data.language || ''}): «${result.data.text.replace(/\s+/g, ' ').slice(0, action?.type === 'read_screen' ? 900 : 160)}»` : '';
    diag.write('action', action?.type, action?.params || {}, '→', result?.ok ? `ok${seen}` : `failed: ${result?.error}`);
    return result;
  });

  let sttBusy = false;
  let sttQueue = Promise.resolve();
  // Learned on this computer: when the accurate model is too slow, commands use the quick one.
  let sttFast = false;
  // What always-on listening did, written to the log every 50 checks (and every name heard).
  const wakeHeard = { checks: 0, names: 0, failed: 0, limitTold: false };
  const noteWake = (t) => {
    wakeHeard.checks += 1;
    if (t && /خل.?ف|خالف/.test(t)) { wakeHeard.names += 1; diag.write(`voice (wake) «${String(t).slice(0, 60)}»`); }
    if (wakeHeard.checks % 50 === 0) diag.write('voice (wake) stats', { ...wakeHeard, usedToday: Math.round(secrets.data.usage?.wakeSeconds || 0) });
  };
  ipcMain.handle('voice:transcribe', async (event, wav, purpose) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    const bytes = wav instanceof Uint8Array ? wav : new Uint8Array(wav || []);
    const isWake = purpose === 'wake';
    // Wake-word checks are skipped while another recognition runs, so they never pile up.
    if (isWake && sttBusy) return { ok: false, error: 'busy' };
    // One whisper at a time: several at once (seen when the mic was pressed again and again)
    // made each of them so slow that all were stopped.
    const turn = sttQueue;
    let release;
    sttQueue = new Promise((r) => { release = r; });
    await turn;
    sttBusy = true;
    try {
      // The cloud first when the person set it up: about a second instead of many on a slow PC.
      // Gemini's free tier counts requests per day, so always-on listening gets a smaller share there.
      if (isWake && cloudHears() && !secrets.allowWake(secrets.azure ? undefined : 3 * 60)) {
        // Today's listening time for «يا خلفون» is used up. The PC's own recogniser takes 25-45 s
        // a sentence on the teacher's laptop (seen in his log) and made everything crawl, so the
        // name is not checked locally: he is told once, and the button still works.
        if (!wakeHeard.limitTold) { wakeHeard.limitTold = true; diag.write('voice (wake) daily cloud time used up: name checks paused until tomorrow'); send('wake-limit', {}); }
        return { ok: true, text: '' };
      }
      if (cloudHears() && (!isWake || secrets.allowWake(secrets.azure ? undefined : 3 * 60))) {
        const cloud = await cloudTranscribe(bytes, isWake);
        if (cloud.ok) {
          secrets.count(wavSeconds(bytes), isWake);
          clearTimeout(saveUsageTimer);
          saveUsageTimer = setTimeout(() => secrets.save().catch(() => {}), 5000);
          if (!isWake) diag.write(`voice (command, ${bytes.length} bytes) → «${cloud.text}» (${(cloud.ms / 1000).toFixed(1)} s, ${cloud.service})`);
          else noteWake(cloud.text);
          return { ...cloud, model: cloud.service };
        }
        diag.write(`voice (${isWake ? 'wake' : 'command'}) ${cloud.service} failed: ${cloud.error}${cloud.detail ? ` (${cloud.detail})` : ''}${whisper.available && !isWake ? ' → whisper' : ''}`);
        if (isWake) wakeHeard.failed += 1;
        // Always-on listening skips the sentence instead of making the PC crawl with whisper.
        if (isWake) return { ok: true, text: '' };
        if (!whisper.available) return { ok: false, error: `stt_failed: ${cloud.error}` };
      }
      // Use most cores for a command (faster answer), fewer for wake-word checks running in the background.
      const cores = Math.max(1, cpus().length);
      const threads = isWake ? Math.min(4, Math.max(2, cores - 2)) : Math.min(8, Math.max(2, cores - 1));
      let words = [];
      if (!isWake) {
        try { words = Object.keys((await stores.memory.read()).aliases || {}); } catch { words = []; }
      }
      const res = await transcribe(whisper, bytes, { purpose: isWake ? 'wake' : 'command', threads, words, fast: sttFast });
      if (!isWake && res.ok) {
        if (res.model !== whisper.model || res.ms > 15000) sttFast = Boolean(whisper.wakeModel && whisper.wakeModel !== whisper.model);
        else if (res.ms < 5000) sttFast = false;
      }
      if (!isWake || !res.ok) {
        const how = res.ok ? ` (${(res.ms / 1000).toFixed(1)} s, ${basename(res.model || '')}${sttFast ? ', quick mode' : ''})` : '';
        diag.write(`voice (${isWake ? 'wake' : 'command'}, ${bytes.length} bytes) →`, res.ok ? `«${res.text}»${how}` : `failed: ${res.error}`);
      }
      return res;
    } finally {
      sttBusy = false;
      release();
    }
  });

  ipcMain.on('ui:focus', (event) => { if (fromApp(event)) focusOverlay(); });
  ipcMain.on('ui:give-back', (event) => { if (fromApp(event)) giveFocusBack(); });

  ipcMain.on('ui:interactive', (event, on) => {
    if (!fromApp(event) || !win) return;
    win.setIgnoreMouseEvents(!on, { forward: true });
  });

  // ----- the AI notebook window
  const notebookStore = stores.notebook;
  ipcMain.handle('nb:load', async (event) => {
    if (!fromNotebook(event)) return null;
    return { data: await notebookStore.read(), ai: Boolean(chat && settings.chatEnabled !== false), kidsMode: !!settings.kidsMode };
  });
  ipcMain.handle('nb:save', async (event, data) => {
    if (!fromNotebook(event)) return { ok: false, error: 'forbidden' };
    if (!data || typeof data !== 'object' || JSON.stringify(data).length > 8 * 1024 * 1024) return { ok: false, error: 'too_big' };
    await notebookStore.write(data);
    return { ok: true };
  });
  ipcMain.handle('nb:task', async (event, payload) => {
    if (!fromNotebook(event)) return { ok: false, error: 'forbidden' };
    if (!chat || settings.chatEnabled === false) return { ok: false, error: 'chat_unavailable' };
    const p = payload && typeof payload === 'object' ? payload : {};
    if (!TASK_MODES.includes(p.mode)) return { ok: false, error: 'bad_mode' };
    send('tool-busy', { tool: 'notebook', mode: p.mode });
    const res = await chat.task({ mode: p.mode, text: String(p.text || '').slice(0, 4000), kidsMode: !!settings.kidsMode });
    diag.write('notebook task', p.mode, '→', res.ok ? `${res.text.length} chars` : `failed: ${res.error}`);
    send('tool-done', { tool: 'notebook', mode: p.mode, ok: res.ok });
    return res;
  });
  // The notebook tells Khalfoun what happened so he can react (a card answered, a note saved...).
  ipcMain.on('nb:tell', (event, what, data) => {
    if (!fromNotebook(event)) return;
    const allowed = ['card_right', 'card_wrong', 'review_done', 'note_saved', 'note_new', 'note_deleted'];
    if (!allowed.includes(what)) return;
    const d = data && typeof data === 'object' ? data : {};
    send('tool-event', { tool: 'notebook', what, count: Math.max(0, Math.min(999, Number(d.count) || 0)) });
  });
  ipcMain.on('nb:board', (event) => { if (fromNotebook(event)) openTool('board'); });

  // «حل من الكاميرا»: a photo from the webcam, read by the cloud brain (or a local vision model).
  ipcMain.handle('vision:camera', async (event, payload) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    const p = payload && typeof payload === 'object' ? payload : {};
    const image = typeof p.image === 'string' ? p.image : '';
    const mode = p.mode === 'look' ? 'look' : 'solve';
    if (!/^[A-Za-z0-9+/=]{100,8000000}$/.test(image)) return { ok: false, error: 'bad_image' };
    let res;
    if (settings.mind === 'claude' && mind) {
      // The Claude mind looks at the photo itself (the teacher's subscription; no other cloud).
      const task = mode === 'look'
        ? 'هذي صورة من كاميرا الصف. قل لي باختصار شو فيها، بدون ما تسوي أي شي على الشاشة.'
        : 'هذي صورة من كاميرا الصف فيها مسألة أو سؤال. حلّه خطوة خطوة باختصار وبوضوح للطلاب، والجواب النهائي في الآخر. لا تسوي أي شي على الشاشة.';
      const r = await mind.ask(task, { via: 'typed' }, { data: image, mime: 'image/jpeg' });
      diag.write('vision (claude mind)', mode, '→', r.ok ? `${String(r.say).length} chars` : `failed: ${r.error}`);
      return r.ok ? { ok: true, text: r.say } : { ok: false, error: r.error };
    }
    if (secrets.brain) {
      const fetchFn = (url, init) => net.fetch(url, init);
      const chain = chainAgents([
        secrets.data.claude ? new ClaudeAgent({ key: secrets.claudeKey, fetchFn }) : null,
        secrets.data.gemini ? new GeminiAgent({ key: secrets.geminiKey, fetchFn }) : null,
      ]);
      res = await chain.vision(image, { mime: 'image/jpeg', mode });
    } else if (chat && visionModel && settings.chatEnabled !== false) {
      res = await chat.vision({ mode: mode === 'look' ? 'describe' : 'solve', image, model: visionModel, kidsMode: !!settings.kidsMode });
      if (res.ok) res.service = visionModel;
    } else {
      return { ok: false, error: 'no_cloud' };
    }
    diag.write('camera', mode, '→', res.ok ? `${res.text.length} chars (${res.service || ''}, ${((res.ms || 0) / 1000).toFixed(1)} s)` : `failed: ${res.error}`);
    if (!res.ok) return res;
    let saved = false;
    if (mode === 'solve') {
      try {
        const d = new Date();
        const q = (/السؤال:\s*(.+)/.exec(res.text)?.[1] || '').slice(0, 60);
        await addNotebookNote(stores.notebook, `حل من الكاميرا ${q ? `— ${q}` : ''} (${d.getDate()}/${d.getMonth() + 1})`.trim(), res.text);
        openTool('notebook');
        saved = true;
      } catch (err) { diag.write('camera note failed', String(err?.message || err)); }
    }
    return { ok: true, text: res.text, saved };
  });

  // The reading-aloud check: the student's recording becomes text, compared on the page.
  ipcMain.handle('rd:transcribe', async (event, wav) => {
    if (!fromReading(event)) return { ok: false, error: 'forbidden' };
    const bytes = wav instanceof Uint8Array ? wav : new Uint8Array(wav || []);
    if (bytes.length < 1000 || bytes.length > 4 * 1024 * 1024) return { ok: false, error: 'bad_audio' };
    const t0 = Date.now();
    let res;
    if (secrets.azure && secrets.data.use?.hear !== false) {
      res = await transcribeAzure(secrets.azure, bytes, { timeoutMs: 30000 });
      if (res.ok) res.service = 'azure';
    }
    if ((!res || !res.ok) && secrets.data.gemini) {
      if (!geminiEars) geminiEars = new GeminiAgent({ key: secrets.geminiKey, fetchFn: (url, init) => net.fetch(url, init) });
      res = await geminiEars.transcribe(bytes, { timeoutMs: 45000, reading: true });
      if (res.ok) res.service = 'gemini';
    }
    if ((!res || !res.ok) && whisper.available) {
      res = await transcribe(whisper, bytes, { purpose: 'reading', threads: Math.min(8, Math.max(2, cpus().length - 1)) });
      if (res.ok) res.service = 'whisper';
    }
    if (!res) return { ok: false, error: 'no_hearing' };
    diag.write('reading', `${wavSeconds(bytes).toFixed(0)} s →`, res.ok ? `${res.text.split(/\s+/).length} words (${res.service}, ${((Date.now() - t0) / 1000).toFixed(1)} s)` : `failed: ${res.error}`);
    return res.ok ? { ok: true, text: res.text, service: res.service } : { ok: false, error: res.error };
  });
  ipcMain.handle('rd:info', (event) => {
    if (!fromReading(event)) return null;
    return { cloud: Boolean(secrets.azure || secrets.data.gemini), azure: Boolean(secrets.azure), whisper: whisper.available, kidsMode: !!settings.kidsMode };
  });
  ipcMain.on('rd:tell', (event, what, data) => {
    if (!fromReading(event)) return;
    if (!['reading_done', 'reading_started'].includes(what)) return;
    const d = data && typeof data === 'object' ? data : {};
    send('tool-event', { tool: 'reading', what, count: Math.max(0, Math.min(100, Math.round(Number(d.count) || 0))) });
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
    const cloud = cloudThinks();
    if (!cloud && (!chat || !visionModel || settings.chatEnabled === false)) return { ok: false, error: 'vision_unavailable' };
    if (!settings.level || settings.level < 2) return { ok: false, error: 'level_too_low' };
    const mode = LOOK_MODES.includes(payload?.mode) ? payload.mode : 'describe';
    const t0 = Date.now();
    let shot;
    let png = null;
    try {
      if (win && !win.isDestroyed()) win.setOpacity(0);
      await new Promise((r) => setTimeout(r, 180));
      const display = screen.getPrimaryDisplay();
      const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
      if (!source) return { ok: false, error: 'no_screen' };
      shot = source.thumbnail;
      if (cloud && process.platform === 'win32') png = shot.toPNG();
    } finally {
      if (win && !win.isDestroyed()) win.setOpacity(1);
    }
    let res = null;
    if (cloud) {
      // The cloud eyes get the screen at its real resolution (up to 2560 px wide) and the
      // words Windows read with their places, for exact reading of small text and numbers.
      const full = shot.getSize();
      const big = full.width > 2560 ? shot.resize({ width: 2560, quality: 'best' }) : shot;
      let layout = '';
      if (png) {
        const dir = await mkdtemp(join(tmpdir(), 'khalfoun-look-'));
        try {
          await writeFile(join(dir, 'screen.png'), png);
          const ocr = await ocrImage(join(dir, 'screen.png'), { words: true });
          if (ocr.ok) layout = layoutHint(ocr.data.words || [], { scale: full.width / big.getSize().width });
        } catch { /* the picture alone */ } finally { rm(dir, { recursive: true, force: true }).catch(() => {}); }
      }
      const { width, height } = big.getSize();
      res = await getAgent().vision(big.toJPEG(90).toString('base64'), {
        mime: 'image/jpeg', timeoutMs: 40000, prompt: screenPrompt(lookTask(mode), { width, height, layout, kidsMode: !!settings.kidsMode }),
      });
      diag.write('vision (cloud)', mode, `${width}x${height}${layout ? ` +${layout.split('\n').length} lines` : ''}`, '→', res.ok ? `${res.text.length} chars ${((Date.now() - t0) / 1000).toFixed(1)} s` : `failed: ${res.error}`);
      if (res.ok) return res;
    }
    if (!chat || !visionModel || settings.chatEnabled === false) return res || { ok: false, error: 'vision_unavailable' };
    // Smaller pictures keep the local model fast; 1280 px wide is enough to read a worksheet.
    const small = shot.getSize().width > 1280 ? shot.resize({ width: 1280, quality: 'good' }) : shot;
    res = await chat.vision({ mode, image: small.toJPEG(82).toString('base64'), model: visionModel, kidsMode: !!settings.kidsMode });
    diag.write('vision', mode, visionModel, '→', res.ok ? `${res.text.length} chars` : `failed: ${res.error}`);
    return res;
  });

  ipcMain.handle('chat:reply', async (event, payload) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (!chat || settings.chatEnabled === false) return { ok: false, error: 'chat_unavailable' };
    const p = payload && typeof payload === 'object' ? payload : {};
    const history = Array.isArray(p.history) ? p.history.slice(-4).map((h) => ({ user: String(h?.user || ''), khalfoun: String(h?.khalfoun || '') })) : [];
    // Kids mode comes from the main process settings, not from the page.
    return chat.reply({ text: String(p.text || '').slice(0, 500), name: String(p.name || '').slice(0, 40), humor: Number(p.humor) || 1, history, context: String(p.context || '').slice(0, 600), kidsMode: !!settings.kidsMode });
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
    // The microphone, and the camera for «حل من الكاميرا»; only for our own pages.
    const media = permission === 'media' && (details.mediaTypes || []).every((t) => t === 'audio' || t === 'video');
    callback(own && media);
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
    // Cloud keys through the real IPC: checked, encrypted on disk, never returned to the page.
    const badKey = await js("window.khalfoun.cloud.set({ claudeKey: 'hello' })");
    step('a wrong Claude key is refused', badKey && badKey.ok === false && badKey.error === 'bad_claude_key', badKey);
    if (safeStorage.isEncryptionAvailable()) {
      const fake = `sk-ant-api03-${'q'.repeat(40)}`;
      const set = await js(`window.khalfoun.cloud.set({ claudeKey: '${fake}', azureKey: '${'z'.repeat(32)}', azureRegion: 'uaenorth' })`);
      const onDisk = JSON.stringify(await stores.cloud.read());
      step('cloud keys are stored encrypted and not handed back', set?.ok && set.status.claude && set.status.azure && !onDisk.includes(fake) && !JSON.stringify(set).includes(fake), set);
      await js("window.khalfoun.cloud.set({ claudeKey: '', azureKey: '', azureRegion: '' })");
    }
    // His own tools: the whiteboard (مِداد) and the AI notebook open as real windows.
    const toolJs = (tool, code) => toolWindows[tool].webContents.executeJavaScript(code, true);
    const waitTool = async (tool, code, ms = 20000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        try { if (toolWindows[tool] && !toolWindows[tool].webContents.isLoading() && await toolJs(tool, code)) return true; } catch { /* still loading */ }
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    };
    const boardSaid = await hear('افتح السبورة');
    step('«افتح السبورة» opens the whiteboard window', await waitTool('board', "document.querySelectorAll('canvas').length > 0"), { said: boardSaid });
    const nbSaid = await hear('افتح الدفتر');
    const nbReady = await waitTool('notebook', 'window.__notebookReady === true');
    step('«افتح الدفتر» opens the notebook window', nbReady, { said: nbSaid });
    if (nbReady) {
      await toolJs('notebook', `document.getElementById('new-note').click();
        const b = document.getElementById('body'); b.value = 'الكسور العشرية تكتب بعد الفاصلة. الجزء من عشرة يسمى عشراً. الجزء من مئة يسمى جزءاً من مئة. نقارن الكسور العشرية بمقارنة الأرقام من اليسار.';
        b.dispatchEvent(new Event('input')); document.querySelector('[data-mode="summarize"]').click(); true`);
      await new Promise((r) => setTimeout(r, 1500));
      const saved = await stores.notebook.read();
      step('a note written in the notebook is saved to notebook.json', saved.notes?.length === 1 && /الكسور/.test(saved.notes[0].body), { notes: saved.notes?.length });
      const summary = await toolJs('notebook', "document.getElementById('result-body').textContent");
      step('offline summary works without a model', /الكسور|العشري/.test(summary), { summary: summary.slice(0, 80) });
    }
    // Khalfoun X: the camera solve lands in the notebook, the reading window, and the attendance sheet.
    if (nbReady) {
      await addNotebookNote(stores.notebook, 'حل من الكاميرا (فحص)', 'السؤال: ٢+٣\nالجواب: ٥');
      const merged = await waitTool('notebook', "[...document.querySelectorAll('#notes .note-title')].some((n) => /حل من الكاميرا/.test(n.textContent))", 6000);
      const onDisk = await stores.notebook.read();
      step('a camera answer appears in the open notebook and is kept with the old note', merged && onDisk.notes?.length === 2, { notes: onDisk.notes?.length });
    }
    const badCam = await js("window.khalfoun.camera({ image: 'not an image', mode: 'solve' })");
    step('the camera IPC refuses a bad image', badCam && badCam.ok === false && badCam.error === 'bad_image', badCam);
    const noCloud = await js(`window.khalfoun.camera({ image: '${'A'.repeat(400)}', mode: 'solve' })`);
    step('the camera IPC says when no cloud brain is set', noCloud && noCloud.ok === false && ['no_cloud', 'bad_key', 'offline', 'timeout'].includes(noCloud.error), noCloud);
    const rdSaid = await hear('افتح اختبار القراءة');
    const rdReady = await waitTool('reading', 'window.__readingReady === true');
    step('«افتح اختبار القراءة» opens the reading window', rdReady, { said: rdSaid });
    if (rdReady) {
      const info = await toolJs('reading', 'window.readingHost.info()');
      step('the reading window can ask what hearing is ready', info && typeof info.cloud === 'boolean', info);
      const tooSmall = await toolJs('reading', 'window.readingHost.transcribe(new Uint8Array(10))');
      step('the reading IPC refuses a recording that is too short', tooSmall && tooSmall.ok === false && tooSmall.error === 'bad_audio', tooSmall);
      const blocked = await js("typeof window.readingHost === 'undefined'");
      step('the overlay page has no reading bridge', blocked);
    }
    await hear('أسماء الطلاب: أحمد، مريم، سالم');
    await hear('غايب أحمد ومريم');
    const sheetSaid = await hear('صدر كشف الغياب');
    let sheet = '';
    for (let i = 0; i < 20 && !sheet; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      const d = new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      sheet = await readFile(join(downloadsDirForSmoke, 'خلفون', `الغياب ${day}.csv`), 'utf8').catch(() => '');
    }
    step('«صدر كشف الغياب» writes a spreadsheet Excel can read', sheet.startsWith('\uFEFF') && /أحمد,غائب/.test(sheet) && /سالم,حاضر/.test(sheet), { said: sheetSaid, head: sheet.slice(0, 60) });
    // Writing into Office: with no Office here, the words go into a new designed Word file.
    // (Kids mode was switched on by an earlier step and rightly blocks editing; this part is for the teacher.)
    settings = { ...settings, kidsMode: false, level: 3 };
    await js('window.__khalfoun.brain.memory.set({ kidsMode: false, level: 3 })');
    const wroteSaid = await hear('اكتب في الوورد: السلام عليكم يا طلاب الصف 5');
    let docx = null;
    for (let i = 0; i < 25 && !docx; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      docx = await readFile(join(downloadsDirForSmoke, 'خلفون', 'الفقرة.docx')).catch(() => null);
    }
    let docText = '';
    if (docx) { try { const { default: Zip } = await import('jszip'); docText = await (await Zip.loadAsync(docx)).file('word/document.xml').async('string'); } catch { docText = ''; } }
    step('«اكتب في الوورد: ...» makes a right-to-left Word file with the words (Arabic digits)', /السلام عليكم يا طلاب الصف ٥/.test(docText) && /<w:bidi\/>/.test(docText), { said: wroteSaid, bytes: docx?.length || 0 });
    const pdfRes = await js(`window.khalfoun.runAction({ id: 9001, type: 'office_put', params: { app: 'pdf', plan: { kind: 'worksheet', title: 'ورقة فحص', blocks: [{ type: 'questions', items: [{ q: 'كم ٢ + ٢؟', choices: ['٣', '٤'], answer: '٤', lines: 0 }] }] } } })`);
    const pdfBytes = pdfRes?.data?.file ? await readFile(pdfRes.data.file).catch(() => null) : null;
    step('a worksheet prints to a PDF file', Boolean(pdfBytes && pdfBytes.slice(0, 5).toString() === '%PDF-' && pdfBytes.length > 3000), { res: pdfRes, bytes: pdfBytes?.length || 0 });
    const badPut = await js(`window.khalfoun.runAction({ id: 9002, type: 'office_put', params: { app: 'notepad', plan: { kind: 'text', blocks: [] } } })`);
    step('a malformed office action is refused in the main process', badPut && badPut.ok === false, badPut);
    const drawSaid = await hear('ارسم دايرة حمرا');
    await new Promise((r) => setTimeout(r, 800));
    const inked = await js('window.__khalfoun.ink.items.length');
    step('«ارسم دايرة حمرا» with no Office draws on the screen', inked >= 1, { said: drawSaid, inked });
    await hear('امسح الشاشة');
    const compose = await js("window.khalfoun.compose({ kind: 'text', topic: 'النخلة', raw: 'اكتب عن النخلة' })");
    step('composing without a cloud key says so (no crash, no hang)', compose && compose.ok === false, compose);
    // The Claude mind: Claude's real program runs inside the app with Khalfoun's tools; with no
    // sign-in it must say «not signed in» cleanly (CI has no subscription).
    const mindStatus = await js('window.khalfoun.mind.status()');
    step('the Claude mind reports its state', mindStatus && typeof mindStatus.installed === 'boolean' && typeof mindStatus.loggedIn === 'boolean', mindStatus);
    if (process.env.KHALFOUN_CLAUDE_EXE) {
      settings = { ...settings, mind: 'claude' };
      const asked = await js("window.khalfoun.mind.ask('هلا يا خلفون', { name: 'فحص' })");
      step('Claude\'s real program answers inside the app (not signed in on CI: says so, no crash)', asked && (asked.ok === true || ['auth', 'offline', 'limit'].includes(asked.error)), asked);
      settings = { ...settings, mind: 'classic' };
    }
    // Khalfoun's own ear: the WebAssembly runtime and the three models load inside the real app
    // (packaged on CI) and score a known sound exactly as the training code does.
    {
      const earDir = join(app.getPath('userData'), 'ear');
      await mkdir(earDir, { recursive: true });
      await writeFile(join(earDir, 'khalfoun-ear.onnx'), await readFile(join(ROOT, 'assets', 'ear', 'selftest-ear.onnx')));
      await writeFile(join(earDir, 'ear.json'), JSON.stringify({ mode: 'shadow', version: 'selftest' }));
      const expected = JSON.parse(await readFile(join(ROOT, 'assets', 'ear', 'selftest.json'), 'utf8')).max;
      await js('window.__khalfoun.loadEar()');
      const best = await js(`(async () => {
        const e = window.__khalfoun.ear; if (!e) return null;
        e.stream.reset();
        const a = new Float32Array(32000);
        for (let i = 0; i < a.length; i += 1) { const t = i / 16000; a[i] = (3000 * Math.sin(2 * Math.PI * 220 * t) * Math.sin(2 * Math.PI * 1.5 * t) + 400 * Math.sin(2 * Math.PI * 1700 * t)) / 32767; }
        return e.stream.push(a);
      })()`);
      step('Khalfoun\'s own ear loads in the app and scores sound like the training code', typeof best === 'number' && Math.abs(best - expected) < 2e-3, { best, expected, error: await js('window.__khalfoun.earError') });
      await rm(earDir, { recursive: true, force: true });
    }
    // The phone microphone: Khalfoun's own certificate, the QR code and the page with its key.
    {
      const ph = await js('window.khalfoun.phone.start()');
      let page = null;
      if (ph?.ok) {
        const local = ph.url.replace(/^https:\/\/[^/:]+/, 'https://127.0.0.1');
        page = await new Promise((resolve) => {
          const req = httpsRequest(local, { rejectUnauthorized: false }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, ok: /مايك خلفون/.test(t) })); });
          req.on('error', (err) => resolve({ error: err.message }));
          req.end();
        });
      }
      step('the phone microphone page is served with its pairing key (or no network on this machine)', (ph?.ok && /^data:image\/png/.test(ph.qr || '') && page?.status === 200 && page.ok) || ph?.error === 'no_network', { url: ph?.url, error: ph?.error, page });
      await js('window.khalfoun.phone.stop()');
    }
    if (process.env.KHALFOUN_SMOKE_TOOLSHOTS) {
      for (const tool of ['board', 'notebook', 'reading']) {
        if (!toolWindows[tool]) continue;
        const img = await toolWindows[tool].webContents.capturePage();
        await writeFile(join(process.env.KHALFOUN_SMOKE_TOOLSHOTS, `${tool}.png`), img.toPNG());
      }
    }
    closeTool('board');
    closeTool('notebook');
    closeTool('reading');
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
    notebook: new JsonStore(userData, 'notebook.json', { version: 1, notes: [], cards: [] }),
    cloud: new JsonStore(userData, 'cloud.json', DEFAULT_CLOUD),
  };
  secrets = await new CloudSecrets(stores.cloud, safeStorage).load();
  settings = { ...DEFAULT_SETTINGS, ...(await stores.settings.read()) };
  voiceDirs = [join(userData, 'voice'), join(ROOT, 'voice')];
  whisper = await findWhisper({ dirs: voiceDirs });
  diag.write('start', { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, level: settings.level, kidsMode: settings.kidsMode, onboarded: settings.onboarded, voice: whisper.available ? { bin: whisper.bin, model: whisper.model } : 'not installed' });

  let downloadsDir = app.getPath('downloads');
  if (SMOKE) {
    downloadsDir = await mkdtemp(join(tmpdir(), 'khalfoun-dl-'));
    downloadsDirForSmoke = downloadsDir;
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
  officeHost = new OfficeHost({ tempDir: join(app.getPath('temp'), 'khalfoun'), log: (...a) => diag.write(...a) });
  const office = createOfficeActions({
    host: officeHost,
    documentsDir: SMOKE ? downloadsDir : app.getPath('documents'),
    openPath: (f) => shell.openPath(f),
    personProcess: async () => { const w = await activeWindow(); return w.ok ? w.data.process : null; },
    printPdf: printPlanPdf,
    fontCss: async () => docFontCss,
    pressKey: (k) => platform.pressKey(k),
    typeText: (t) => platform.typeText(t),
    openFiles: !SMOKE,
    log: (...a) => diag.write(...a),
  });
  handsHost = new OfficeHost({ tempDir: join(app.getPath('temp'), 'khalfoun'), scriptPath: join(ROOT, 'src', 'main', 'brain', 'hands.ps1'), copyName: 'khalfoun-hands.ps1', sta: false, timeoutMs: 15000, log: (...a) => diag.write(...a) });
  const executor = createExecutor({
    platform, getSettings: () => settings, downloadsDir, journal: stores.journal, scheduleReminder, office, hands: handsHost,
    cancelReminders: () => reminderScheduler.cancelAll(),
    readScreen,
    findOnScreen: findOnScreenWords,
    activeWindow,
    writePdf: (text, position, page) => writePdf(text, position, [downloadsDir, app.getPath('documents')], page),
    openTool,
    closeTool,
    documentsDir: SMOKE ? downloadsDir : app.getPath('documents'),
    openSaved: !SMOKE,
    // The teacher's own folders, where «افتح البي دي إف حق الصف العاشر» looks.
    fileRoots: SMOKE ? [downloadsDir] : [...new Set([app.getPath('desktop'), app.getPath('documents'), downloadsDir])],
  });
  try {
    const font = await readFile(join(ROOT, 'assets', 'fonts', 'Tajawal-700-arabic.woff2'));
    pdfFontCss = `@font-face { font-family: 'Tajawal'; font-weight: 700; src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); }`;
    const regular = await readFile(join(ROOT, 'assets', 'fonts', 'Tajawal-400-arabic.woff2'));
    docFontCss = `${pdfFontCss}\n@font-face { font-family: 'Tajawal'; font-weight: 400; src: url(data:font/woff2;base64,${regular.toString('base64')}) format('woff2'); }`;
  } catch { /* system fonts still work */ }
  watcher = new WindowWatcher({
    onChange: (list) => send('windows', { list }),
    toDip: (r) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r),
    getWorkArea: () => screen.getPrimaryDisplay().workArea,
    selfPid: process.pid,
  });
  mind = createClaudeMind({
    userData: app.getPath('userData'),
    electron: { screen, desktopCapturer },
    run: async (action) => {
      // Keys and typing must reach the teacher's program, never Khalfoun's own window.
      if (['type_text', 'key_combo'].includes(action?.type) && win && !win.isDestroyed() && win.isFocused()) {
        await giveFocusBack();
        await new Promise((r) => setTimeout(r, 150));
      }
      const r = await executor.run(action);
      // Tell Claude which window the typing really went to, so it never claims a wrong result.
      if (action?.type === 'type_text' && process.platform === 'win32') {
        const fg = await foregroundInfo().catch(() => null);
        const own = new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
        if (r?.ok && fg) r.data = { ...(r.data || {}), window: own.has(fg.pid) ? 'خلفون نفسه (ما وصلت لأي برنامج!)' : `${fg.title || ''} — ${fg.process || ''}` };
      }
      diag.write('action (claude)', action?.type, JSON.stringify(action?.params || {}).slice(0, 200), '→', r?.ok ? 'ok' : `failed: ${r?.error}`);
      return r;
    },
    ocrImage,
    hands: handsHost,
    activeWindow,
    hideWhile: async (fn) => {
      if (win && !win.isDestroyed()) win.setOpacity(0);
      await new Promise((r) => setTimeout(r, 160));
      try { return await fn(); } finally { if (win && !win.isDestroyed()) win.setOpacity(1); }
    },
    send: (channel, data) => send(channel === 'mind:event' ? 'mind' : 'mind_ui', { data }),
    log: (...a) => diag.write(...a),
    getSettings: () => settings,
    fetchFn: (url, init) => net.fetch(url, init),
    ...(SMOKE && process.env.KHALFOUN_CLAUDE_EXE ? { exePath: process.env.KHALFOUN_CLAUDE_EXE } : {}),
  });
  setupIpc(stores, executor);
  createWindow();
  // The Claude mind starts in the background (its program, the screen reader) so the first
  // sentence does not wait for it.
  if (settings.mind === 'claude' && !SMOKE) setTimeout(() => mind.warm().catch(() => {}), 4000);
  // Look for a local language model now and every five minutes until one appears.
  lookForModel = async (preferred) => {
    if (chat && visionModel) return;
    // With the Claude mind on, the local model is never used: loading it only took the PC's
    // memory and processor while Claude worked (seen: gemma3 4b warmed up during a lesson).
    if (settings.mind === 'claude') return;
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
    officeHost?.stop();
    handsHost?.stop();
    phoneMic?.stop();
    mind?.close();
    if (watcher) watcher.stop();
    if (reminderScheduler) reminderScheduler.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
