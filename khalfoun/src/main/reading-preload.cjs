// The reading window's only bridge to the system: turn a recording into text, and tell
// Khalfoun how the reading went so he can cheer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('readingHost', {
  info: () => ipcRenderer.invoke('rd:info'),
  transcribe: (wav) => ipcRenderer.invoke('rd:transcribe', wav instanceof Uint8Array ? wav : new Uint8Array(0)),
  tell: (what, data) => ipcRenderer.send('rd:tell', String(what), data && typeof data === 'object' ? { count: Number(data.count) || 0 } : {}),
});
