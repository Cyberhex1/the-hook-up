// Bridge between the game page and the desktop app (saves on disk, controller input,
// fullscreen, quit). The page sees it as window.hookupDesktop.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hookupDesktop", {
  info: () => ipcRenderer.sendSync("app:info"),
  // synchronous on purpose: a save is on disk before the call returns
  loadSaves: () => ipcRenderer.sendSync("saves:load"),
  writeSaves: (entries) => ipcRenderer.sendSync("saves:write", entries),
  stashStorage: (entries) => ipcRenderer.sendSync("saves:stash", entries),
  backupNow: () => ipcRenderer.invoke("saves:backup"),
  openSavesFolder: () => ipcRenderer.invoke("saves:open-folder"),
  setFullscreen: (on) => ipcRenderer.invoke("window:fullscreen", on),
  onFullscreen: (fn) => ipcRenderer.on("window:fullscreen", (e, on) => fn(on)),
  onClosing: (fn) => ipcRenderer.on("app:closing", () => fn()),
  readyToClose: () => ipcRenderer.send("app:ready-to-close"),
  quit: () => ipcRenderer.send("app:quit"),
  mouse: (type, x, y, button) => ipcRenderer.send("input:mouse", { type, x, y, button }),
  key: (keyCode, char) => ipcRenderer.send("input:key", { keyCode, char }),
});
