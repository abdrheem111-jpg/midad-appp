// The only bridge between Khalfoun's page and the system. The page cannot use
// Node or Electron directly; it can only call these functions.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('khalfoun', {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke('state:load'),
  saveMemory: (data) => ipcRenderer.invoke('memory:save', data),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  runAction: (action) => ipcRenderer.invoke('action:run', action),
  chat: (payload) => ipcRenderer.invoke('chat:reply', payload),
  chatTask: (payload) => ipcRenderer.invoke('chat:task', payload),
  visionLook: (payload) => ipcRenderer.invoke('vision:look', payload),
  compose: (req) => ipcRenderer.invoke('office:compose', req && typeof req === 'object' ? { kind: String(req.kind || ''), topic: String(req.topic || ''), count: Number(req.count) || null, raw: String(req.raw || ''), digits: req.digits === 'latin' ? 'latin' : 'arabic' } : {}),
  camera: (payload) => ipcRenderer.invoke('vision:camera', { image: String(payload?.image || ''), mode: payload?.mode === 'look' ? 'look' : 'solve' }),
  agent: (payload) => ipcRenderer.invoke('agent:respond', payload),
  speak: (text) => ipcRenderer.invoke('voice:speak', String(text || '').slice(0, 600)),
  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    set: (patch) => ipcRenderer.invoke('cloud:set', patch),
    test: () => ipcRenderer.invoke('cloud:test'),
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
  setInteractive: (on) => ipcRenderer.send('ui:interactive', Boolean(on)),
  watchWindows: (on) => ipcRenderer.send('ui:watch-windows', Boolean(on)),
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('khalfoun:event', handler);
    return () => ipcRenderer.removeListener('khalfoun:event', handler);
  },
  quit: () => ipcRenderer.send('app:quit'),
});
