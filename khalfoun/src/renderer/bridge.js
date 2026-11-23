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
  const fakeVision = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fakevision');
  // ?fakeagent pretends a Claude key is set and answers from window.__fakeAgent ({addressed, say, commands}).
  const fakeAgent = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fakeagent');
  const agentCalls = [];
  const chatCalls = [];
  const transcribeCalls = [];
  const listeners = new Set();
  const mindAsks = [];
  const mindReplies = new Map();
  let mindUiId = 0;
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
          vision: fakeVision ? 'gemma3:4b' : null,
          choices: { standard: { model: 'qwen2.5:3b', label: 'عادي', approxMB: 1900 }, strong: { model: 'qwen2.5:7b', label: 'قوي', approxMB: 4700 }, vision: { model: 'gemma3:4b', label: 'عقل + عيون ذكية (يفهم الصور)', approxMB: 3300 } },
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
        chat: { available: fakeChat || fakeAgent, model: fakeChat ? 'test-model' : null, vision: fakeVision ? 'gemma3:4b' : null, cloud: fakeAgent },
        cloud: { claude: fakeAgent, brain: fakeAgent ? 'claude' : null, azure: false, azureRegion: '', use: { hear: true, brain: true, voice: true }, encryption: true },
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
      if (action.type === 'find_on_screen') return { ok: true, data: { boxes: (window.__fakeWords || []).filter((w) => w.text.includes(action.params.text)) } };
      if (action.type === 'read_screen') return window.__fakeScreen === undefined ? { ok: false, error: 'unsupported' } : { ok: true, data: { text: window.__fakeScreen } };
      if (action.type === 'active_window') return window.__fakeWindow ? { ok: true, data: window.__fakeWindow } : { ok: false, error: 'unsupported' };
      if (action.type === 'cancel_reminders') return { ok: true, data: { cancelled: 1 } };
      // Preview: no Office here, so drawing and circles land on the screen; documents become «files».
      if (/^office_(draw|equation|circle|format|slide|pdf)$/.test(action.type) && !window.__fakeOffice) return { ok: false, error: 'no_office' };
      if (action.type === 'office_put') return { ok: true, data: { mode: window.__fakeOffice ? 'inserted' : 'file', app: action.params.app } };
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
    async visionLook(payload) {
      if (!fakeVision) return { ok: false, error: 'vision_unavailable' };
      chatCalls.push({ look: payload.mode });
      await new Promise((r) => setTimeout(r, 300));
      const queue = window.__fakeChat || [];
      return queue.length ? { ok: true, text: queue.shift() } : { ok: false, error: 'timeout' };
    },
    async chatTask(payload) {
      if (!fakeChat) return { ok: false, error: 'chat_unavailable' };
      chatCalls.push({ task: payload.mode, text: payload.text });
      await new Promise((r) => setTimeout(r, 300));
      const queue = window.__fakeChat || [];
      return queue.length ? { ok: true, text: queue.shift() } : { ok: false, error: 'timeout' };
    },
    async agent(payload) {
      if (!fakeAgent) return { ok: false, error: 'not_configured' };
      agentCalls.push(payload);
      await new Promise((r) => setTimeout(r, 150));
      const queue = window.__fakeAgent || [];
      return queue.length ? { ok: true, ms: 150, ...queue.shift() } : { ok: false, error: 'timeout' };
    },
    async speak() { return { ok: false, error: 'not_configured' }; },
    async compose(req) {
      chatCalls.push({ compose: req.kind, topic: req.topic });
      await new Promise((r) => setTimeout(r, 300));
      if (window.__fakeCompose) return window.__fakeCompose;
      const plans = {
        slides: { kind: 'slides', title: req.topic, subtitle: '', slides: [{ title: 'مقدمة', bullets: ['نقطة', 'نقطة ثانية'], note: '' }] },
        table: { kind: 'table', title: req.topic, columns: ['أ', 'ب'], rows: [['١', '٢']] },
        diagram: { kind: 'diagram', title: req.topic, layout: 'cycle', nodes: [{ id: 'a', text: 'أ', color: null }, { id: 'b', text: 'ب', color: null }, { id: 'c', text: 'ج', color: null }], links: [] },
      };
      return { ok: true, plan: plans[req.kind] || { kind: req.kind, title: req.topic, blocks: [{ type: 'paragraph', text: `فقرة عن ${req.topic}.` }] } };
    },
    async camera(payload) {
      chatCalls.push({ camera: payload.mode, bytes: payload.image.length });
      await new Promise((r) => setTimeout(r, 200));
      return window.__fakeCamera || { ok: false, error: 'no_cloud' };
    },
    cloud: {
      async status() { return { claude: fakeAgent, azure: false, azureRegion: '', use: { hear: true, brain: true, voice: true }, encryption: true }; },
      async set(patch) { return { ok: true, status: { claude: fakeAgent || Boolean(patch?.claudeKey), azure: Boolean(patch?.azureKey), azureRegion: patch?.azureRegion || '', use: { hear: true, brain: true, voice: true }, encryption: true } }; },
      async test() { return {}; },
    },
    // The Claude mind in the preview: a scripted Claude (window.__fakeMind(text) → steps) so the
    // page side (speaking, feelings, ink, questions, classroom) is checked in a browser.
    mind: {
      async status() {
        const st = readJSON(SET_KEY) || {};
        return { supported: true, installed: true, loggedIn: Boolean(window.__mindLoggedIn), on: st.mind === 'claude', model: st.mindModel || 'smart', plan: 'pro' };
      },
      async install() { return { ok: true }; },
      async signIn() { window.__mindLoggedIn = true; emit({ type: 'mind', data: { type: 'login', step: 'done' } }); return { ok: true }; },
      async code() { return { ok: true }; },
      async signOut() { window.__mindLoggedIn = false; return { ok: true }; },
      async ask(text, context) {
        mindAsks.push({ text, context });
        const steps = window.__fakeMind ? window.__fakeMind(text) : [{ text: `سمعتك: ${text}` }];
        let last = '';
        for (const st of steps) {
          await new Promise((r) => setTimeout(r, 60));
          if (st.error) return { ok: false, error: st.error };
          if (st.text) { last = st.text; emit({ type: 'mind', data: { type: 'text', text: st.text } }); }
          if (st.ui) {
            const id = ++mindUiId;
            const answer = new Promise((r) => { mindReplies.set(id, r); });
            emit({ type: 'mind_ui', data: { id, kind: st.ui, payload: st.payload || {} } });
            st.result = await answer;
            window.__mindResults = [...(window.__mindResults || []), { kind: st.ui, result: st.result }];
          }
        }
        return { ok: true, say: last, ms: 300 };
      },
      stop() { window.__mindStopped = (window.__mindStopped || 0) + 1; },
      reset() {},
      model() {},
      reply(id, result) { const r = mindReplies.get(id); if (r) { mindReplies.delete(id); r(result); } },
    },
    setInteractive() {},
    watchWindows() {},
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    quit() {},
    // test helpers
    _emit: emit,
    _mindAsks: mindAsks,
    _actions: actionsRun,
    _transcribeCalls: transcribeCalls,
    _chatCalls: chatCalls,
    _agentCalls: agentCalls,
    _setup: setupState,
  };
}

export function getBridge() {
  if (typeof window !== 'undefined' && window.khalfoun) return window.khalfoun;
  return createPreviewBridge();
}
