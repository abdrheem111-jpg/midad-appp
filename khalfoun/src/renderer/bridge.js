// The page talks to the system only through this bridge. Inside the desktop app
// it is `window.khalfoun` from the preload script; in a plain browser (preview
// and automated UI tests) a harmless stand-in keeps everything in localStorage
// and only pretends to run actions.

const MEM_KEY = 'khalfoun.memory';
const SET_KEY = 'khalfoun.settings';

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: ignore */ }
}

function createPreviewBridge() {
  const listeners = new Set();
  const emit = (ev) => listeners.forEach((cb) => cb(ev));
  const actionsRun = [];
  return {
    platform: 'preview',
    async loadState() {
      return {
        memory: readJSON(MEM_KEY),
        settings: readJSON(SET_KEY) || { onboarded: false, level: 0, kidsMode: false },
        voice: { available: false },
        platform: 'preview',
      };
    },
    async saveMemory(data) { writeJSON(MEM_KEY, data); return true; },
    async updateSettings(patch) {
      const cur = readJSON(SET_KEY) || { onboarded: false, level: 0, kidsMode: false };
      const next = { ...cur, ...patch };
      writeJSON(SET_KEY, next);
      return { ok: true, settings: next };
    },
    async runAction(action) {
      actionsRun.push(action);
      await new Promise((r) => setTimeout(r, 250));
      if (action.type === 'reminder') {
        // Preview: one "minute" lasts one second so the reminder can be seen.
        setTimeout(() => emit({ type: 'reminder', note: action.params.note }), action.params.minutes * 1000);
      }
      if (action.type === 'organize_downloads') return { ok: true, data: { moved: 7 } };
      if (action.type === 'undo_organize') return { ok: true, data: { restored: 7 } };
      return { ok: true };
    },
    async transcribe() { return { ok: false, error: 'stt_unavailable' }; },
    setInteractive() {},
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    quit() {},
    // test helpers
    _emit: emit,
    _actions: actionsRun,
  };
}

export function getBridge() {
  if (typeof window !== 'undefined' && window.khalfoun) return window.khalfoun;
  return createPreviewBridge();
}
