// The Hook-Up 1.0: standalone desktop / Steam Deck build.
//
// Runs the patched game in Ruffle inside an Electron window and keeps the saves in a
// real file next to the app (saves/thehookup-saves.json), with rolling backups.
// Everything is local: the page, the player and the game files are served from this
// folder through the app:// scheme, and nothing is fetched from the network.
"use strict";
const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const GAME_DIR = path.join(__dirname, "game");
const SAVE_FILE = "thehookup-saves.json";
const SAVE_FORMAT = "thehookup-saves"; // same format as the web version's "Export saves"
const KEEP_BACKUPS = 30;

// --- where everything lives -------------------------------------------------
// HOOKUP_HOME is set by the Steam Deck launcher (TheHookUp.sh) to its own folder.
// Otherwise use the folder holding the .exe. If that isn't writable, fall back to the
// per-user app data folder, so a save never silently goes nowhere.
function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

const HOME = (() => {
  const preferred = process.env.HOOKUP_HOME || path.dirname(process.execPath);
  if (isWritableDir(path.join(preferred, "saves"))) return preferred;
  return path.join(app.getPath("appData"), "The Hook-Up");
})();
const SAVES_DIR = path.join(HOME, "saves");
const BACKUP_DIR = path.join(SAVES_DIR, "backups");
const DATA_DIR = path.join(HOME, "data"); // Chromium profile + settings, also kept local
fs.mkdirSync(SAVES_DIR, { recursive: true });
app.setPath("userData", DATA_DIR);

// --- Proton / Wine and Linux ------------------------------------------------
// Chromium's sandbox can't start under Wine (the .exe on a Steam Deck through Proton).
// The window only ever shows this folder's own files, so turning it off there is safe.
function underWine() {
  if (process.platform !== "win32") return false;
  if (process.env.STEAM_COMPAT_DATA_PATH || process.env.WINEPREFIX || process.env.WINELOADER) return true;
  try {
    return spawnSync("reg", ["query", "HKCU\\Software\\Wine"], { windowsHide: true, timeout: 3000 }).status === 0;
  } catch (e) {
    return false;
  }
}
const WINE = underWine();
if (WINE) {
  app.commandLine.appendSwitch("no-sandbox");
  app.disableHardwareAcceleration();
}
if (process.argv.includes("--software-render")) app.disableHardwareAcceleration();
// music and ambience start without needing a click first
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// --- settings ---------------------------------------------------------------
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  } catch (e) { /* settings are a convenience only */ }
}

// --- save file --------------------------------------------------------------
const savePath = () => path.join(SAVES_DIR, SAVE_FILE);
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function parseSaveFile(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || data.format !== SAVE_FORMAT || typeof data.entries !== "object" || data.entries === null) {
    throw new Error("not a Hook-Up saves file");
  }
  const entries = {};
  for (const [k, v] of Object.entries(data.entries)) {
    if (typeof v === "string" && k.split("/").pop() === "thehookup") entries[k] = v;
  }
  return { entries, savedAt: data.savedAt || data.exportedAt || null };
}

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(BACKUP_DIR, f));
  } catch (e) {
    return [];
  }
}

// Write atomically: a crash or power loss mid-write leaves the old file intact.
function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function backup(reason) {
  const file = savePath();
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `thehookup-saves-${stamp()}${reason ? "-" + reason : ""}.json`);
  fs.copyFileSync(file, dest);
  const all = listBackups();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) {
    try { fs.unlinkSync(old); } catch (e) { /* keep going */ }
  }
  return dest;
}

let lastWritten = null; // JSON of the entries last on disk

function loadSaves() {
  const file = savePath();
  if (!fs.existsSync(file)) return { entries: null, file };
  try {
    const { entries, savedAt } = parseSaveFile(file);
    lastWritten = JSON.stringify(entries);
    return { entries, savedAt, file };
  } catch (e) {
    // keep the damaged file for inspection and fall back to the newest good backup
    const broken = `${file}.damaged-${stamp()}`;
    try { fs.renameSync(file, broken); } catch (err) { /* ignore */ }
    for (const b of listBackups().reverse()) {
      try {
        const { entries, savedAt } = parseSaveFile(b);
        writeFileAtomic(file, fs.readFileSync(b, "utf8"));
        lastWritten = JSON.stringify(entries);
        return { entries, savedAt, file, warning: `The saves file was damaged (kept as ${path.basename(broken)}). Restored the backup from ${path.basename(b)}.` };
      } catch (err) { /* try the next one */ }
    }
    return { entries: null, file, warning: `The saves file was damaged (kept as ${path.basename(broken)}) and no backup could be read.` };
  }
}

function writeSaves(entries) {
  const json = JSON.stringify(entries);
  if (json === lastWritten) return { ok: true, unchanged: true, file: savePath() };
  try {
    if (lastWritten !== null) backup();
    const savedAt = new Date().toISOString();
    writeFileAtomic(savePath(), JSON.stringify({ format: SAVE_FORMAT, version: 1, savedAt, entries }, null, 2));
    lastWritten = json;
    return { ok: true, file: savePath(), savedAt };
  } catch (e) {
    return { ok: false, file: savePath(), error: e.message };
  }
}

// Saves found in the browser storage that differ from the file are kept as a backup
// before the file's saves replace them, so nothing is ever thrown away.
function stashStorage(entries) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dest = path.join(BACKUP_DIR, `thehookup-saves-${stamp()}-from-app-storage.json`);
    fs.writeFileSync(dest, JSON.stringify({ format: SAVE_FORMAT, version: 1, savedAt: new Date().toISOString(), entries }, null, 2));
    return dest;
  } catch (e) {
    return null;
  }
}

// --- app:// scheme serving the bundled game ----------------------------------
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function serveGame(request) {
  let rel = decodeURIComponent(new URL(request.url).pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(GAME_DIR, rel));
  if (!file.startsWith(GAME_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return new Response("Not found", { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

// --- window -------------------------------------------------------------------
let win = null;
let readyToClose = false;

function createWindow() {
  const settings = readSettings();
  const fullscreen = process.argv.includes("--windowed") ? false : settings.fullscreen !== false;
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    fullscreen,
    backgroundColor: "#000000",
    title: "The Hook-Up",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => { win.show(); win.focus(); });

  const wc = win.webContents;
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      e.preventDefault();
      setFullscreen(!win.isFullScreen());
    }
  });
  win.on("enter-full-screen", () => wc.send("window:fullscreen", true));
  win.on("leave-full-screen", () => wc.send("window:fullscreen", false));

  // On close, let the page stop the player (Ruffle writes its storage then) and copy
  // the saves to disk one last time before the window goes away.
  win.on("close", (e) => {
    if (readyToClose) return;
    e.preventDefault();
    wc.send("app:closing");
    setTimeout(() => { readyToClose = true; if (win && !win.isDestroyed()) win.close(); }, 3000);
  });
  win.on("closed", () => { win = null; });

  const query = new URLSearchParams();
  for (const flag of ["debug", "fasttime"]) if (process.argv.includes(`--${flag}`)) query.set(flag, "1");
  win.loadURL(`app://hookup/index.html${query.size ? "?" + query : ""}`);
}

function setFullscreen(on) {
  if (!win) return false;
  win.setFullScreen(on);
  writeSettings({ fullscreen: on });
  return on;
}

// --- IPC from the page --------------------------------------------------------
ipcMain.on("saves:load", (e) => { e.returnValue = loadSaves(); });
ipcMain.on("saves:write", (e, entries) => { e.returnValue = writeSaves(entries); });
ipcMain.on("saves:stash", (e, entries) => { e.returnValue = stashStorage(entries); });
ipcMain.handle("saves:backup", () => {
  try {
    const dest = backup("manual");
    return dest ? { ok: true, file: dest } : { ok: false, error: "There are no saves yet." };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("saves:open-folder", () => shell.openPath(SAVES_DIR));
ipcMain.on("app:info", (e) => {
  e.returnValue = {
    version: app.getVersion(),
    savesDir: SAVES_DIR,
    saveFile: savePath(),
    platform: process.platform,
    wine: WINE,
    fullscreen: win ? win.isFullScreen() : true,
  };
});
ipcMain.handle("window:fullscreen", (e, on) => setFullscreen(on === undefined ? !win.isFullScreen() : !!on));
ipcMain.on("app:ready-to-close", () => {
  readyToClose = true;
  if (win && !win.isDestroyed()) win.close();
});
ipcMain.on("app:quit", () => { if (win) win.close(); });

// Controller input arrives as real mouse and keyboard events, exactly as if a mouse
// had been used, so the game and Ruffle need no changes.
ipcMain.on("input:mouse", (e, ev) => {
  if (!win || win.isDestroyed()) return;
  const x = Math.round(ev.x);
  const y = Math.round(ev.y);
  if (ev.type === "move") {
    win.webContents.sendInputEvent({ type: "mouseMove", x, y });
  } else if (ev.type === "down" || ev.type === "up") {
    win.webContents.sendInputEvent({ type: ev.type === "down" ? "mouseDown" : "mouseUp", x, y, button: ev.button || "left", clickCount: 1 });
  }
});
ipcMain.on("input:key", (e, ev) => {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  // Ruffle reads the typed character from the key event, so capitals need Shift held
  const modifiers = ev.char && ev.char !== ev.char.toLowerCase() ? ["shift"] : [];
  wc.sendInputEvent({ type: "keyDown", keyCode: ev.keyCode, modifiers });
  if (ev.char) wc.sendInputEvent({ type: "char", keyCode: ev.char, modifiers });
  wc.sendInputEvent({ type: "keyUp", keyCode: ev.keyCode, modifiers });
});

// --- lifecycle ----------------------------------------------------------------
// One copy at a time, so two windows can never overwrite each other's saves.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle("app", serveGame);
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
