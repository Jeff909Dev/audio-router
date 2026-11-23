// Exposes a narrow, typed bridge to the renderer (see src/lib/bridge.ts).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioRouter', {
  getState: () => ipcRenderer.invoke('state:get'),
  install: (id) => ipcRenderer.invoke('driver:install', id),
  uninstall: (id) => ipcRenderer.invoke('driver:uninstall', id),
  setDefault: (kind, uid) => ipcRenderer.invoke('device:set-default', kind, uid),
  setRate: (uid, rate) => ipcRenderer.invoke('device:set-rate', uid, rate),
  multiOutput: (listenUid, routerUid) => ipcRenderer.invoke('device:multi-output', listenUid, routerUid),
  removeMultiOutput: (uid) => ipcRenderer.invoke('device:remove-multi-output', uid),
  requestMic: () => ipcRenderer.invoke('media:request-mic'),
});
