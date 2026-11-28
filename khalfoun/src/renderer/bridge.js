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
    ear: {
      async save(kind, bytes) {
        const st = window.__earStats || (window.__earStats = { call: 0, other: 0, room: 0, 'tts-call': 0, 'tts-other': 0, azure: true });
        st[kind] = (st[kind] || 0) + 1;
        window.__earSaved = [...(window.__earSaved || []), { kind, bytes: bytes.length }];
        return { ok: true };
      },
      async stats() { return { ...(window.__earStats || { call: 0, other: 0, room: 0, 'tts-call': 0, 'tts-other': 0, azure: true }) }; },
      async voices() { const st = window.__earStats || (window.__earStats = {}); st['tts-call'] = 120; st['tts-other'] = 200; return { ok: true, made: 320, voices: 20 }; },
      async models() {
        const u = window.__earModelUrls; // set by the UI tests: { mel, emb, cls }
        if (!u) return null;
        const get = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
        return { mel: await get(u.mel), emb: await get(u.emb), cls: await get(u.cls), config: window.__earConfig || { mode: 'shadow', threshold: 0.5, high: 0.85, version: 'test' } };
      },
    },
    steps: { keys(on) { window.__stepKeys = Boolean(on); } },
    safety: {
      answer(id, ok) { (window.__softAnswers ||= []).push({ id, ok }); },
      async emergency(on) { return { ok: true, on }; },
      async undo() { return window.__undoResult || { ok: false, error: 'nothing' }; },
    },
    lesson: {
      save(st) { window.__lessonSaved = st; try { sessionStorage.setItem('kh-lesson', JSON.stringify({ at: Date.now(), state: st })); } catch { /* preview */ } },
      async load() { try { return JSON.parse(sessionStorage.getItem('kh-lesson') || 'null'); } catch { return null; } },
    },
    metrics: {
      note(kind, ms) { (window.__metrics ||= []).push({ kind, ms }); },
      async report() { return { report: [], lines: ['• ما انقاس بعد'] }; },
    },
    math: { async solve() { return { ok: false, error: 'preview' }; } },
    screen: {
      async region(r) { // a made-up question, the size of the rectangle
        const c = document.createElement('canvas'); c.width = Math.max(40, r.w * 2); c.height = Math.max(30, r.h * 2);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111'; x.font = `${Math.round(c.height / 3)}px Tahoma`; x.textAlign = 'center'; x.direction = 'rtl';
        x.fillText('س٣: حل المعادلة ٢س + ٣ = ١١', c.width / 2, c.height / 1.7);
        window.__regionAsked = r;
        return { ok: true, image: c.toDataURL('image/png') };
      },
    },
    actions: { async recent() { return [{ at: Date.now(), type: 'open_app', what: 'word', ok: true, error: '' }]; } },
    inbox: { async add(it) { (window.__inbox ||= []).push(it); return { id: `i${window.__inbox.length}` }; } },
    report: { async weekly() { return { ok: true, file: 'x.xlsx', summary: 'تجربة' }; } },
    phone: {
      state(st) { window.__phoneState = st; },
      async start() { window.__phoneOn = true; return this.info(); },
      async stop() { window.__phoneOn = false; return { ok: true }; },
      async info() {
        if (!window.__phoneOn) return { ok: false, error: 'off' };
        const url = 'https://192.168.43.10:47823/?k=test-key-1234';
        return { ok: true, url, urls: [url], qr: 'data:image/png;base64,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', port: 47823, connected: false, streaming: false };
      },
    },
    remote: {
      async set(accel) {
        window.__remoteCalls = [...(window.__remoteCalls || []), accel];
        if (accel === 'F9' && window.__remoteTaken) return { ok: false, error: 'taken' };
        const cur = readJSON(SET_KEY) || {};
        if (accel === null) delete cur.remoteKey; else cur.remoteKey = accel;
        writeJSON(SET_KEY, cur);
        return accel === null ? { ok: true } : { ok: true, accel };
      },
      async pause(on) { window.__remotePaused = Boolean(on); return true; },
    },
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
      async learned() { return window.__learned || { notes: [{ id: 1, kind: 'word', text: '«الكتاب» يعني ملف كتاب الطالب PDF', at: 1, uses: 2 }], habits: [{ id: 'افتح الكتاب', phrase: 'افتح الكتاب', count: 3, steps: ['open_file'] }] }; },
      async forget(id) { const l = await this.learned(); window.__learned = { notes: l.notes.filter((n) => String(n.id) !== String(id)), habits: l.habits.filter((h) => h.id !== id) }; return true; },
      prefetch() { window.__mindPrefetch = (window.__mindPrefetch || 0) + 1; },
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
