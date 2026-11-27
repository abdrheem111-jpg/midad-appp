// The only bridge between Khalfoun's page and the system. The page cannot use
// Node or Electron directly; it can only call these functions.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('khalfoun', {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke('state:load'),
  saveMemory: (data) => ipcRenderer.invoke('memory:save', data),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  ear: {
    save: (kind, bytes) => ipcRenderer.invoke('ear:save', String(kind || ''), bytes instanceof Uint8Array ? bytes : new Uint8Array(0)),
    stats: () => ipcRenderer.invoke('ear:stats'),
    voices: () => ipcRenderer.invoke('ear:tts'),
    models: () => ipcRenderer.invoke('ear:models'),
  },
  phone: {
    start: () => ipcRenderer.invoke('phone:start'),
    stop: () => ipcRenderer.invoke('phone:stop'),
    info: () => ipcRenderer.invoke('phone:info'),
    state: (st) => ipcRenderer.send('phone:state', st && typeof st === 'object' ? st : {}),
    unpair: () => ipcRenderer.invoke('phone:unpair'),
  },
  steps: {
    keys: (on) => ipcRenderer.send('steps:keys', on === true),
  },
  safety: {
    answer: (id, ok) => ipcRenderer.send('soft-confirm:answer', { id: String(id || ''), ok: ok !== false }),
    emergency: (on) => ipcRenderer.invoke('emergency:set', on === true),
    undo: () => ipcRenderer.invoke('actions:undo'),
  },
  lesson: {
    save: (st) => ipcRenderer.send('lesson:save', st && typeof st === 'object' ? st : {}),
    load: () => ipcRenderer.invoke('lesson:load'),
  },
  metrics: {
    note: (kind, ms) => ipcRenderer.send('metrics:note', { kind: String(kind || ''), ms: Number(ms) }),
    report: () => ipcRenderer.invoke('metrics:report'),
  },
  stt: {
    streamStart: () => ipcRenderer.invoke('stt:stream-start'),
    streamPush: (samples) => { if (samples instanceof Float32Array) ipcRenderer.send('stt:stream-push', samples); },
    streamEnd: () => ipcRenderer.invoke('stt:stream-end'),
    streamCancel: () => ipcRenderer.send('stt:stream-cancel'),
  },
  actions: { recent: () => ipcRenderer.invoke('actions:recent') },
  inbox: { add: (it) => ipcRenderer.invoke('inbox:add', it && typeof it === 'object' ? it : {}) },
  report: { weekly: (data) => ipcRenderer.invoke('report:weekly', data && typeof data === 'object' ? data : {}) },
  math: {
    solve: (task, expr, opts) => ipcRenderer.invoke('math:solve', { task: String(task || ''), expr: String(expr || '').slice(0, 300), opts: opts && typeof opts === 'object' ? opts : {} }),
  },
  remote: {
    set: (accel) => ipcRenderer.invoke('remote:set', accel === null ? null : String(accel || '').slice(0, 40)),
    pause: (on) => ipcRenderer.invoke('remote:pause', on === true),
  },
  runAction: (action) => ipcRenderer.invoke('action:run', action),
  chat: (payload) => ipcRenderer.invoke('chat:reply', payload),
  chatTask: (payload) => ipcRenderer.invoke('chat:task', payload),
  visionLook: (payload) => ipcRenderer.invoke('vision:look', payload),
  compose: (req) => ipcRenderer.invoke('office:compose', req && typeof req === 'object' ? { kind: String(req.kind || ''), topic: String(req.topic || ''), count: Number(req.count) || null, raw: String(req.raw || ''), digits: req.digits === 'latin' ? 'latin' : 'arabic' } : {}),
  camera: (payload) => ipcRenderer.invoke('vision:camera', { image: String(payload?.image || ''), mode: payload?.mode === 'look' ? 'look' : 'solve' }),
  agent: (payload) => ipcRenderer.invoke('agent:respond', payload),
  speak: (text) => ipcRenderer.invoke('voice:speak', String(text || '').slice(0, 600)),
  previewVoice: (voice) => ipcRenderer.invoke('voice:preview', String(voice || '').slice(0, 40)),
  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    set: (patch) => ipcRenderer.invoke('cloud:set', patch),
    test: () => ipcRenderer.invoke('cloud:test'),
  },
  mind: {
    status: () => ipcRenderer.invoke('mind:status'),
    install: () => ipcRenderer.invoke('mind:install'),
    signIn: () => ipcRenderer.invoke('mind:signin'),
    code: (c) => ipcRenderer.invoke('mind:code', String(c || '').slice(0, 500)),
    signOut: () => ipcRenderer.invoke('mind:signout'),
    ask: (text, context, image) => ipcRenderer.invoke('mind:ask', { text: String(text || '').slice(0, 3000), context: context && typeof context === 'object' ? context : {}, image: image && typeof image === 'object' ? { data: String(image.data || ''), mime: String(image.mime || '') } : null }),
    stop: () => ipcRenderer.send('mind:stop'),
    prefetch: () => ipcRenderer.send('mind:prefetch'),
    learned: () => ipcRenderer.invoke('mind:learned'),
    forget: (id) => ipcRenderer.invoke('mind:forget', id),
    reset: () => ipcRenderer.send('mind:reset'),
    model: (m) => ipcRenderer.send('mind:model', String(m)),
    reply: (id, result) => ipcRenderer.send('mind:ui-reply', { id: Number(id), result }),
  },
  transcribe: (wav, purpose) => ipcRenderer.invoke('voice:transcribe', wav, purpose === 'wake' ? 'wake' : 'command'),
  setup: {
    status: () => ipcRenderer.invoke('setup:status'),
    voice: (pack) => ipcRenderer.invoke('setup:voice', String(pack)),
    brain: (choice) => ipcRenderer.invoke('setup:brain', String(choice)),
    cancel: () => ipcRenderer.invoke('setup:cancel'),
    getOllama: () => ipcRenderer.invoke('setup:get-ollama'),
  },
  note: (text) => ipcRenderer.send('diag:note', String(text).slice(0, 600)),
  focus: () => ipcRenderer.send('ui:focus'),
  giveBack: () => ipcRenderer.send('ui:give-back'),
  setInteractive: (on) => ipcRenderer.send('ui:interactive', Boolean(on)),
  watchWindows: (on) => ipcRenderer.send('ui:watch-windows', Boolean(on)),
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('khalfoun:event', handler);
    return () => ipcRenderer.removeListener('khalfoun:event', handler);
  },
  quit: () => ipcRenderer.send('app:quit'),
});
