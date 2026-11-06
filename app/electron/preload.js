const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("gitlog", { run: req => ipcRenderer.invoke("gitlog:run", req) });
