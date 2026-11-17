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
  transcribe: (wav, purpose) => ipcRenderer.invoke('voice:transcribe', wav, purpose === 'wake' ? 'wake' : 'command'),
  setup: {
    status: () => ipcRenderer.invoke('setup:status'),
    voice: (pack) => ipcRenderer.invoke('setup:voice', String(pack)),
    brain: (choice) => ipcRenderer.invoke('setup:brain', String(choice)),
    cancel: () => ipcRenderer.invoke('setup:cancel'),
    getOllama: () => ipcRenderer.invoke('setup:get-ollama'),
  },
  note: (text) => ipcRenderer.send('diag:note', String(text).slice(0, 600)),
  setInteractive: (on) => ipcRenderer.send('ui:interactive', Boolean(on)),
  watchWindows: (on) => ipcRenderer.send('ui:watch-windows', Boolean(on)),
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('khalfoun:event', handler);
    return () => ipcRenderer.removeListener('khalfoun:event', handler);
  },
  quit: () => ipcRenderer.send('app:quit'),
});
