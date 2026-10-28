const { contextBridge, ipcRenderer } = require('electron')
const { CHANNELS } = require('./lib/channels')

contextBridge.exposeInMainWorld('electron', {
  invoke: (channel, data) => {
    if (!CHANNELS.includes(channel)) throw new Error(`Canal no permitido: ${channel}`)
    return ipcRenderer.invoke(channel, data)
  },
  on: (channel, cb) => {
    const sub = (_, v) => cb(v)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
})
