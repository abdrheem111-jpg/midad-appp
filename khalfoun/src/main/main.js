// Khalfoun desktop app (Electron main process).
// A transparent, always-on-top, click-through window covers the work area;
// only Khalfoun and his panels catch the mouse. The page is served from a
// private app:// protocol, sandboxed, and can reach the system only through
// the small API in preload.cjs. Every action is validated and permission-checked
// again here.

import {
  app, BrowserWindow, ipcMain, protocol, screen, shell, clipboard, desktopCapturer, Tray, Menu,
  nativeImage, globalShortcut, dialog, Notification, session,
} from 'electron';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './storage.js';
import { createPlatform } from './actions/platform.js';
import { createExecutor } from './actions/index.js';
import { findWhisper, transcribe } from './stt.js';
import { WindowWatcher } from './windows-watcher.js';
import { ChatClient, findLocalModel } from './chat.js';
import { LEVEL_INFO } from '../core/permissions.js';

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

// A plain folder name keeps paths simple: %APPDATA%\Khalfoun on Windows.
app.setName('Khalfoun');
if (process.env.KHALFOUN_USER_DATA) app.setPath('userData', process.env.KHALFOUN_USER_DATA);

let win = null;
let tray = null;
let settings = { ...DEFAULT_SETTINGS };
let whisper = { available: false, bin: null, model: null, wakeModel: null };
const reminders = new Set();
let watcher = null;
let chat = null; // ChatClient when a local model is found
let chatInfo = null;

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
    { label: 'اكتب أمراً  (Ctrl+Shift+K)', click: () => { if (win) { win.show(); win.focus(); send('open-command'); } } },
    { label: 'تحدث  (Ctrl+Shift+Space)', click: showAnd('ptt') },
    { label: 'تعال يا خلفون', click: showAnd('come') },
    { label: 'الإعدادات', click: () => { if (win) { win.show(); win.focus(); send('open-settings'); } } },
    { type: 'separator' },
    { label: 'إخفاء / إظهار', click: () => { if (!win) return; if (win.isVisible()) win.hide(); else win.showInactive(); } },
    ...(canAutoStart ? [{ label: 'تشغيل مع بدء الجهاز', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) }] : []),
    { label: 'خروج', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (win) { win.showInactive(); send('come'); } });
}

function registerShortcuts() {
  const ok1 = globalShortcut.register('CommandOrControl+Shift+Space', () => { if (win) { win.showInactive(); send('ptt'); } });
  const ok2 = globalShortcut.register('CommandOrControl+Shift+K', () => { if (win) { win.show(); win.focus(); send('open-command'); } });
  if (!ok1 || !ok2) console.warn('Some keyboard shortcuts are taken by another program.');
}

function scheduleReminder(minutes, note) {
  const timer = setTimeout(() => {
    reminders.delete(timer);
    if (win) win.showInactive();
    send('reminder', { note });
    if (Notification.isSupported()) {
      new Notification({ title: 'خلفون', body: note ? `تذكير: ${note}` : 'جا وقت التذكير!', silent: false }).show();
    }
  }, minutes * 60 * 1000);
  reminders.add(timer);
}

async function captureScreen() {
  const display = screen.getPrimaryDisplay();
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!source) throw new Error('no_screen');
  return source.thumbnail.toPNG();
}

/** Hands keyboard focus back to the program the person was using before pasting. */
function releaseFocus() {
  if (!win || !win.isFocused()) return;
  win.setFocusable(false);
  win.blur();
  setTimeout(() => { if (win && !win.isDestroyed()) win.setFocusable(true); }, 1500);
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
    return { memory: Object.keys(memory).length ? memory : null, settings, voice: { available: whisper.available }, chat: { available: Boolean(chat), model: chatInfo?.model || null }, platform: process.platform };
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
    return { ok: true, settings };
  });

  ipcMain.handle('action:run', async (event, action) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    return executor.run(action);
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
      return await transcribe(whisper, bytes, { purpose: isWake ? 'wake' : 'command' });
    } finally {
      sttBusy = false;
    }
  });

  ipcMain.on('ui:interactive', (event, on) => {
    if (!fromApp(event) || !win) return;
    win.setIgnoreMouseEvents(!on, { forward: true });
  });

  ipcMain.handle('chat:reply', async (event, payload) => {
    if (!fromApp(event)) return { ok: false, error: 'forbidden' };
    if (!chat || settings.chatEnabled === false) return { ok: false, error: 'chat_unavailable' };
    const p = payload && typeof payload === 'object' ? payload : {};
    const history = Array.isArray(p.history) ? p.history.slice(-4).map((h) => ({ user: String(h?.user || ''), khalfoun: String(h?.khalfoun || '') })) : [];
    // Kids mode comes from the main process settings, not from the page.
    return chat.reply({ text: String(p.text || '').slice(0, 500), name: String(p.name || '').slice(0, 40), humor: Number(p.humor) || 1, history, kidsMode: !!settings.kidsMode });
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
    // Main refuses an action the page should never send.
    const bad = await js("window.khalfoun.runAction({ id: 99, type: 'open_url', params: { url: 'https://evil.example' } })");
    step('main rejects unknown url', bad && bad.ok === false && bad.error === 'bad_url', bad);
    const raise = await js('window.khalfoun.updateSettings({ kidsMode: true }).then(() => window.khalfoun.updateSettings({ kidsMode: false }))');
    step('turning off kids mode needs system confirmation', raise && raise.ok === false, raise);
    await hear('اسمي سعيد');
    await new Promise((r) => setTimeout(r, 1200));
    const saved = await stores.memory.read();
    step('memory saved to disk without permission fields', saved.name === 'سعيد' && !('level' in saved));
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
  const stores = {
    memory: new JsonStore(userData, 'memory.json', {}),
    settings: new JsonStore(userData, 'settings.json', DEFAULT_SETTINGS),
    journal: new JsonStore(userData, 'organize-journal.json', { moves: [] }),
  };
  settings = { ...DEFAULT_SETTINGS, ...(await stores.settings.read()) };
  whisper = await findWhisper({ dirs: [join(userData, 'voice'), join(ROOT, 'voice')] });

  let downloadsDir = app.getPath('downloads');
  if (SMOKE) {
    downloadsDir = await mkdtemp(join(tmpdir(), 'khalfoun-dl-'));
    await mkdir(downloadsDir, { recursive: true });
    for (const f of ['صورة.jpg', 'تقرير.pdf', 'اغنية.mp3', 'ملف.unknown']) await writeFile(join(downloadsDir, f), 'x');
  }

  const platform = createPlatform({
    shell,
    clipboard,
    capture: captureScreen,
    beforeType: releaseFocus,
    home: app.getPath('home'),
    paths: { downloads: downloadsDir, documents: app.getPath('documents'), pictures: app.getPath('pictures') },
  });
  const executor = createExecutor({ platform, getSettings: () => settings, downloadsDir, journal: stores.journal, scheduleReminder });
  watcher = new WindowWatcher({
    onChange: (list) => send('windows', { list }),
    toDip: (r) => (process.platform === 'win32' ? screen.screenToDipRect(null, r) : r),
    getWorkArea: () => screen.getPrimaryDisplay().workArea,
    selfPid: process.pid,
  });
  setupIpc(stores, executor);
  createWindow();
  // Look for a local language model now and every five minutes until one appears.
  const lookForModel = async () => {
    if (chat) return;
    chatInfo = await findLocalModel();
    if (chatInfo) chat = new ChatClient(chatInfo);
  };
  if (!SMOKE) {
    lookForModel().catch(() => {});
    setInterval(() => lookForModel().catch(() => {}), 5 * 60 * 1000);
  }
  if (!SMOKE) {
    buildTray();
    registerShortcuts();
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
    app.exit(1);
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (watcher) watcher.stop();
    for (const t of reminders) clearTimeout(t);
  });
  app.on('window-all-closed', () => app.quit());
}
