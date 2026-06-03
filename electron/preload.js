const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("delpaDB", {
  load: () => ipcRenderer.invoke("db:load"),
  save: (data) => ipcRenderer.invoke("db:save", data),
  backup: () => ipcRenderer.invoke("db:backup"),
});