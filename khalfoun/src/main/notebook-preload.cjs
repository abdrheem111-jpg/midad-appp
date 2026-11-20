// The notebook window's only bridge to the system: its own notes file, the local model
// for summaries, questions and cards, and a way to tell Khalfoun what happened.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notebookHost', {
  load: () => ipcRenderer.invoke('nb:load'),
  save: (data) => ipcRenderer.invoke('nb:save', data),
  task: (mode, text) => ipcRenderer.invoke('nb:task', { mode: String(mode), text: String(text || '') }),
  tell: (what, data) => ipcRenderer.send('nb:tell', String(what), data && typeof data === 'object' ? { count: Number(data.count) || 0 } : {}),
  openBoard: () => ipcRenderer.send('nb:board'),
  // A note added from outside (the camera solve): reload and show it.
  onRefresh: (fn) => ipcRenderer.on('nb:refresh', (_e, d) => fn({ id: String(d?.id || '') })),
});
