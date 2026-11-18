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
  // ?fakevoice=1 pretends speech recognition is installed and answers from
  // window.__fakeTranscripts, so the whole voice path can be tested in a browser.
  const fakeVoice = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fakevoice');
  const fakeChat = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fakechat');
  const chatCalls = [];
  const transcribeCalls = [];
  const listeners = new Set();
  const emit = (ev) => listeners.forEach((cb) => cb(ev));
  const actionsRun = [];
  // Preview of the one-click setup: downloads are simulated in about two seconds.
  // ?fakeollama pretends Ollama is installed and running.
  const fakeOllama = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fakeollama');
  const setupState = { voice: fakeVoice, chat: fakeChat, model: fakeChat ? 'test-model' : null, busy: null, cancelled: false, calls: [] };
  const simulate = async (kind, total) => {
    setupState.busy = kind;
    setupState.cancelled = false;
    try {
      for (let i = 1; i <= 8; i++) {
        await new Promise((r) => setTimeout(r, 220));
        if (setupState.cancelled) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
        emit({ type: 'setup-progress', kind, step: i < 8 ? 'downloading' : 'done', done: Math.round((total * i) / 8), total });
      }
    } finally {
      setupState.busy = null;
    }
  };
  const setup = {
    async status() {
      return {
        busy: setupState.busy,
        voice: { available: setupState.voice, supported: true, packs: { light: { label: 'خفيف', mb: 152 }, balanced: { label: 'متوازن', mb: 639 }, accurate: { label: 'دقيق', mb: 726 } } },
        brain: {
          ollamaRunning: fakeOllama, ollamaModels: setupState.chat ? [setupState.model] : [], chatAvailable: setupState.chat, model: setupState.model,
          choices: { standard: { model: 'qwen2.5:3b', label: 'عادي', approxMB: 1900 }, strong: { model: 'qwen2.5:7b', label: 'قوي', approxMB: 4700 } },
        },
      };
    },
    async voice(pack) {
      setupState.calls.push(['voice', pack]);
      if (setupState.busy) return { ok: false, error: 'busy', text: 'فيه تنزيل شغّال الحين.' };
      try { await simulate('voice', 639e6); } catch { return { ok: false, error: 'aborted', text: 'وقّفت التنزيل. تقدر تكمله بعدين من نفس المكان.' }; }
      setupState.voice = true;
      emit({ type: 'voice-ready', available: true });
      return { ok: true };
    },
    async brain(choice) {
      setupState.calls.push(['brain', choice]);
      if (!fakeOllama) return { ok: false, error: 'ollama_not_running', text: 'Ollama مو شغّال. ثبّته أو شغّله وبعدين جرّب.' };
      try { await simulate('brain', 1.9e9); } catch { return { ok: false, error: 'aborted', text: 'وقّفت التنزيل. تقدر تكمله بعدين من نفس المكان.' }; }
      setupState.chat = true;
      setupState.model = choice === 'strong' ? 'qwen2.5:7b' : 'qwen2.5:3b';
      emit({ type: 'chat-ready', available: true, model: setupState.model });
      return { ok: true, model: setupState.model };
    },
    async cancel() { if (!setupState.busy) return false; setupState.cancelled = true; return true; },
    async getOllama() { setupState.calls.push(['get-ollama']); return true; },
  };
  return {
    setup,
    platform: 'preview',
    async loadState() {
      return {
        memory: readJSON(MEM_KEY),
        settings: readJSON(SET_KEY) || { onboarded: false, level: 0, kidsMode: false },
        voice: { available: fakeVoice },
        chat: { available: fakeChat, model: fakeChat ? 'test-model' : null },
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
      if (action.type === 'read_selection') return { ok: true, data: { text: window.__fakeSelection || '' } };
      if (action.type === 'read_screen') return window.__fakeScreen === undefined ? { ok: false, error: 'unsupported' } : { ok: true, data: { text: window.__fakeScreen } };
      if (action.type === 'active_window') return window.__fakeWindow ? { ok: true, data: window.__fakeWindow } : { ok: false, error: 'unsupported' };
      if (action.type === 'cancel_reminders') return { ok: true, data: { cancelled: 1 } };
      if (action.type === 'organize_downloads') return { ok: true, data: { moved: 7 } };
      if (action.type === 'undo_organize') return { ok: true, data: { restored: 7 } };
      return { ok: true };
    },
    async transcribe(wav, purpose) {
      if (!fakeVoice) return { ok: false, error: 'stt_unavailable' };
      transcribeCalls.push({ bytes: wav?.length || 0, purpose });
      const queue = window.__fakeTranscripts || [];
      return { ok: true, text: queue.length ? queue.shift() : '' };
    },
    async chat(payload) {
      if (!fakeChat) return { ok: false, error: 'chat_unavailable' };
      chatCalls.push(payload);
      await new Promise((r) => setTimeout(r, 400));
      const queue = window.__fakeChat || [];
      if (!queue.length) return { ok: false, error: 'timeout' };
      const next = queue.shift();
      const m = /^أمر:\s*(.+)$/u.exec(next);
      return m ? { ok: true, command: m[1].trim() } : { ok: true, text: next };
    },
    async chatTask(payload) {
      if (!fakeChat) return { ok: false, error: 'chat_unavailable' };
      chatCalls.push({ task: payload.mode, text: payload.text });
      await new Promise((r) => setTimeout(r, 300));
      const queue = window.__fakeChat || [];
      return queue.length ? { ok: true, text: queue.shift() } : { ok: false, error: 'timeout' };
    },
    setInteractive() {},
    watchWindows() {},
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    quit() {},
    // test helpers
    _emit: emit,
    _actions: actionsRun,
    _transcribeCalls: transcribeCalls,
    _chatCalls: chatCalls,
    _setup: setupState,
  };
}

export function getBridge() {
  if (typeof window !== 'undefined' && window.khalfoun) return window.khalfoun;
  return createPreviewBridge();
}
