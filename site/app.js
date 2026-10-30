// TheHookupRevived: the web player plus a save manager.
//
// The patched SWF keeps every save in one SharedObject ("thehookup"), which Ruffle stores
// in localStorage. This page never touches the game; it watches that key and:
//  - lists the slots (it decodes the SharedObject's AMF0 data to read names and dates),
//  - keeps a backup history in IndexedDB each time the saves change,
//  - downloads and restores backups (the same file format as the desktop app),
//  - optionally mirrors the saves into a folder on disk (File System Access API).
(() => {
  "use strict";

  const SO_NAME = "thehookup";
  const FORMAT = "thehookup-saves";
  const SAVE_FILE = "thehookup-saves.json";
  const SLOTS = [["slot1", "Slot 1"], ["slot2", "Slot 2"], ["slot3", "Slot 3"], ["auto", "Autosave"]];
  const POLL_MS = 1500;
  const KEEP_FOLDER_BACKUPS = 30;

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const el = (tag, props, ...kids) => {
    const n = Object.assign(document.createElement(tag), props || {});
    n.append(...kids);
    return n;
  };

  // ===========================================================================
  // Settings (per browser; the key isn't a SharedObject key, so saves code ignores it)
  // ===========================================================================
  const SETTINGS_KEY = "thehookuprevived-settings";
  const DEFAULTS = {
    volume: 100, muted: false, background: "mute",
    quality: "high", scale: "showAll", panel: "side",
    keepBackups: 30, reminder: "week", toasts: true, warnLeave: true,
    lastDownloadAt: 0,
  };
  const CHOICES = {
    background: ["play", "mute", "pause"],
    quality: ["low", "medium", "high", "best"],
    scale: ["showAll", "exactFit"],
    panel: ["side", "below"],
    keepBackups: [10, 30, 100],
    reminder: ["off", "day", "week"],
  };
  const settings = (() => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { /* defaults */ }
    const s = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      const v = stored[k];
      if (v === undefined || typeof v !== typeof DEFAULTS[k]) continue;
      if (CHOICES[k] && !CHOICES[k].includes(v)) continue;
      s[k] = k === "volume" ? Math.min(100, Math.max(0, v)) : v;
    }
    return s;
  })();
  const storeSettings = () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
  };

  // ===========================================================================
  // Saves in localStorage
  // ===========================================================================
  // Ruffle keys each SharedObject as "<host>/<path>/<name>"; files store the part after the host.
  const isSaveKey = (k) => k.split("/").pop() === SO_NAME;
  const pathOf = (k) => k.slice(k.indexOf("/"));
  const sortKeys = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

  function storageSaves() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && isSaveKey(k)) out[pathOf(k)] = localStorage.getItem(k);
      }
    } catch (e) { /* storage blocked */ }
    return sortKeys(out);
  }

  function writeStorage(entries) {
    for (const k of Object.keys(localStorage)) if (isSaveKey(k)) localStorage.removeItem(k);
    for (const [p, v] of Object.entries(entries)) localStorage.setItem(location.hostname + p, v);
  }

  const hasSaves = (entries) => Object.keys(entries).length > 0;
  const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

  // ===========================================================================
  // Reading slot details: Ruffle stores the .sol bytes base64-encoded; the body is AMF0.
  // ===========================================================================
  function parseSol(text) {
    let u;
    try {
      const bin = atob(text);
      u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    } catch (e) {
      return null;
    }
    if (u.length < 20 || u[0] !== 0x00 || u[1] !== 0xbf) return null;
    const dv = new DataView(u.buffer);
    const td = new TextDecoder();
    let p = 16;                                   // 2 magic + 4 length + "TCSO" + 6 padding
    const str = (n) => { const s = td.decode(u.subarray(p, p + n)); p += n; return s; };
    const str16 = () => { const n = dv.getUint16(p); p += 2; return str(n); };
    const str32 = () => { const n = dv.getUint32(p); p += 4; return str(n); };
    str16();                                      // SharedObject name
    if (dv.getUint32(p) !== 0) return null;       // AMF3 isn't used by AVM1 games
    p += 4;
    const refs = [];
    const props = (o) => {
      for (;;) {
        const k = str16();
        if (k === "" && u[p] === 0x09) { p++; return o; }
        o[k] = value();
      }
    };
    const value = () => {
      const m = u[p++];
      switch (m) {
        case 0x00: { const v = dv.getFloat64(p); p += 8; return v; }
        case 0x01: return u[p++] !== 0;
        case 0x02: return str16();
        case 0x03: { const o = {}; refs.push(o); return props(o); }
        case 0x05: return null;
        case 0x06: return undefined;
        case 0x07: { const i = dv.getUint16(p); p += 2; return refs[i]; }
        case 0x08: { p += 4; const o = {}; refs.push(o); return props(o); }
        case 0x0a: {
          const n = dv.getUint32(p); p += 4;
          const a = []; refs.push(a);
          for (let i = 0; i < n; i++) a.push(value());
          return a;
        }
        case 0x0b: { const v = dv.getFloat64(p); p += 10; return new Date(v); }
        case 0x0c: return str32();
        case 0x10: { str16(); const o = {}; refs.push(o); return props(o); }
        default: throw new Error("unknown AMF0 marker " + m);
      }
    };
    const data = {};
    try {
      while (p < u.length) {
        const k = str16();
        data[k] = value();
        p++;                                      // trailing 0x00 after each member
      }
    } catch (e) {
      if (!Object.keys(data).length) return null;
    }
    return data;
  }

  // -> { slot1: {name, savedAt}, ... } for the filled slots, or null if the data can't be read
  function slotsOf(entries) {
    const out = {};
    let readable = false;
    for (const v of Object.values(entries)) {
      const d = parseSol(v);
      if (!d) continue;
      readable = true;
      for (const [id] of SLOTS) {
        const r = d[id];
        if (r && typeof r === "object" && r.xml) out[id] = { name: r.name || "", savedAt: r.savedAt || 0 };
      }
    }
    return readable ? out : null;
  }

  function summary(entries) {
    const slots = slotsOf(entries);
    if (!slots) return "Saves (details unavailable)";
    const ids = Object.keys(slots);
    if (!ids.length) return "No filled slots";
    const names = [...new Set(ids.map((id) => slots[id].name).filter(Boolean))];
    const n = ids.length;
    return (names.length ? names.join(", ") + " · " : "") + n + (n === 1 ? " slot" : " slots");
  }

  // ===========================================================================
  // Formatting
  // ===========================================================================
  const fmtTime = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return fmtTime(ms);
  }
  const stamp = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };
  const fileText = (entries, at) => JSON.stringify({
    format: FORMAT, version: 1, savedAt: new Date(at || Date.now()).toISOString(), entries: sortKeys(entries),
  }, null, 2);

  function parseFile(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error("That file isn't valid JSON."); }
    if (!data || data.format !== FORMAT || typeof data.entries !== "object" || data.entries === null) {
      throw new Error("That file isn't a Hook-Up saves file.");
    }
    const entries = {};
    for (const [k, v] of Object.entries(data.entries)) if (isSaveKey(k) && typeof v === "string") entries[k] = v;
    const at = Date.parse(data.savedAt || data.exportedAt || "") || null;
    return { entries: sortKeys(entries), at };
  }

  // ===========================================================================
  // Toast and dialog
  // ===========================================================================
  let toastTimer = 0;
  function toast(text, isErr) {
    const t = $("toast");
    t.textContent = text;
    t.className = "show" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = isErr ? "err" : ""; }, isErr ? 6000 : 2800);
  }

  // ask("Title", "text", [["yes", "Label", true], ["no", "Cancel"]]) -> resolves to the chosen key;
  // the third item is true for the primary button, or a class name such as "danger"
  function ask(title, text, choices) {
    const dlg = $("dlg");
    $("dlg-title").textContent = title;
    $("dlg-text").textContent = text;
    return new Promise((resolve) => {
      const actions = $("dlg-actions");
      actions.replaceChildren(...choices.map(([key, label, style]) => {
        const b = el("button", { type: "button", textContent: label, className: style === true ? "primary" : (style || "") });
        b.addEventListener("click", () => dlg.close(key));
        return b;
      }));
      dlg.addEventListener("close", () => resolve(dlg.returnValue || "no"), { once: true });
      dlg.returnValue = "";
      dlg.showModal();
    });
  }

  // ===========================================================================
  // Downloads
  // ===========================================================================
  function download(entries, at) {
    const blob = new Blob([fileText(entries, at)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `thehookup-saves-${stamp(new Date(at || Date.now()))}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    settings.lastDownloadAt = Date.now();
    storeSettings();
    checkReminder();
  }

  // ===========================================================================
  // Backup reminder
  // ===========================================================================
  const REMIND_MS = { day: 24 * 3600e3, week: 7 * 24 * 3600e3 };
  function checkReminder() {
    const box = $("reminder");
    const due = settings.reminder !== "off" && hasSaves(storageSaves())
      && Date.now() - settings.lastDownloadAt > REMIND_MS[settings.reminder];
    box.hidden = !due;
    if (due) {
      $("reminder-text").textContent = settings.lastDownloadAt
        ? `Your last downloaded backup was ${ago(settings.lastDownloadAt)}.`
        : "You haven't downloaded a backup yet.";
    }
  }

  // ===========================================================================
  // Backup history (IndexedDB)
  // ===========================================================================
  const db = (() => {
    let opening = null;
    const open = () => opening || (opening = new Promise((resolve, reject) => {
      const r = indexedDB.open("thehookuprevived", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true });
        r.result.createObjectStore("kv");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
    const run = async (store, mode, fn) => {
      const d = await open();
      return new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = t.onabort = () => reject(t.error);
      });
    };
    return {
      all: () => run("snapshots", "readonly", (s) => s.getAll()),
      add: (snap) => run("snapshots", "readwrite", (s) => s.add(snap)),
      remove: (id) => run("snapshots", "readwrite", (s) => s.delete(id)),
      clear: () => run("snapshots", "readwrite", (s) => s.clear()),
      get: (k) => run("kv", "readonly", (s) => s.get(k)),
      set: (k, v) => run("kv", "readwrite", (s) => s.put(v, k)),
      del: (k) => run("kv", "readwrite", (s) => s.delete(k)),
    };
  })();
  let historyOk = true;

  const REASONS = { auto: "", manual: "Kept", restore: "Before restore", import: "Imported", folder: "From folder" };

  async function addSnapshot(reason, entries) {
    if (!historyOk || !hasSaves(entries)) return false;
    const list = await db.all();
    const latest = list[list.length - 1];
    if (reason === "auto" && latest && same(latest.entries, entries)) return false;
    await db.add({ at: Date.now(), reason, entries });
    await pruneHistory();
    renderHistory();
    return true;
  }

  // keep the newest settings.keepBackups entries; the ones made with "Back up now" always stay
  async function pruneHistory() {
    const autos = (await db.all()).filter((s) => s.reason !== "manual");
    for (const old of autos.slice(0, Math.max(0, autos.length - settings.keepBackups))) await db.remove(old.id);
  }

  async function renderHistory() {
    const ul = $("history");
    let list;
    try {
      list = await db.all();
    } catch (e) {
      historyOk = false;
      ul.replaceChildren(el("li", { className: "muted", textContent: "This browser blocks storage for backup history (private window?). Use Download backup instead." }));
      $("backup-now").disabled = true;
      return;
    }
    if (!list.length) {
      ul.replaceChildren(el("li", { className: "muted", textContent: "No backups yet. One is made each time you save." }));
      return;
    }
    ul.replaceChildren(...list.reverse().map((s) => {
      const tag = REASONS[s.reason] ? el("span", { className: "tag" + (s.reason === "manual" ? " manual" : ""), textContent: REASONS[s.reason] }) : "";
      const dl = el("button", { type: "button", className: "small", textContent: "Download", title: "Download this backup" });
      dl.addEventListener("click", () => download(s.entries, s.at));
      const rs = el("button", { type: "button", className: "small", textContent: "Restore", title: "Restore this backup" });
      rs.addEventListener("click", () => restore(s.entries, `Restore the backup from ${fmtTime(s.at)}?`, null));
      return el("li", {},
        el("div", { className: "what" }, el("b", {}, fmtTime(s.at), tag), el("small", { textContent: summary(s.entries) })),
        dl, rs);
    }));
  }

  // ===========================================================================
  // Slot list
  // ===========================================================================
  function renderSlots(entries) {
    const slots = slotsOf(entries);
    const ul = $("slots");
    if (hasSaves(entries) && !slots) {
      ul.replaceChildren(el("li", {}, el("span", { className: "id", textContent: "Saves" }), el("span", { className: "who", textContent: "Found, but the slot details can't be read." })));
      return;
    }
    ul.replaceChildren(...SLOTS.map(([id, label]) => {
      const s = slots && slots[id];
      const who = s
        ? el("span", { className: "who" }, s.name || "Unnamed", el("small", { textContent: s.savedAt ? fmtTime(s.savedAt) : "" }))
        : el("span", { className: "who", textContent: "Empty" });
      return el("li", { className: s ? "" : "empty" }, el("span", { className: "id", textContent: label }), who);
    }));
    $("download").disabled = !hasSaves(entries);
    $("backup-now").disabled = !hasSaves(entries) || !historyOk;
  }

  async function renderPersist() {
    const pill = $("persist");
    let persisted = false;
    try { persisted = navigator.storage && navigator.storage.persisted && await navigator.storage.persisted(); } catch (e) { /* unknown */ }
    pill.className = "pill " + (persisted ? "ok" : "warn");
    pill.textContent = persisted ? "Saved on this device · protected" : "Saved on this device · download backups";
    pill.title = persisted
      ? "The browser won't clear these saves to free up space."
      : "The browser may clear site data when space runs low, or when you clear your history. Keep a downloaded backup or link a save folder.";
  }

  // ===========================================================================
  // Save folder (Chrome, Edge and other Chromium browsers)
  // ===========================================================================
  const folder = { supported: "showDirectoryPicker" in window, dir: null, ok: false, lastJson: null, lastAt: 0, queue: Promise.resolve() };

  async function readFolderFile() {
    try {
      const fh = await folder.dir.getFileHandle(SAVE_FILE);
      return parseFile(await (await fh.getFile()).text());
    } catch (e) {
      if (e.name === "NotFoundError") return null;
      throw e;
    }
  }

  async function writeFolder(entries) {
    const dir = folder.dir;
    // keep the previous file in backups/ before replacing it
    try {
      const old = await (await (await dir.getFileHandle(SAVE_FILE)).getFile()).text();
      const bdir = await dir.getDirectoryHandle("backups", { create: true });
      const bw = await (await bdir.getFileHandle(`thehookup-saves-${stamp()}.json`, { create: true })).createWritable();
      await bw.write(old);
      await bw.close();
      const names = [];
      for await (const [name, h] of bdir.entries()) if (h.kind === "file" && name.endsWith(".json")) names.push(name);
      names.sort();
      for (const n of names.slice(0, Math.max(0, names.length - KEEP_FOLDER_BACKUPS))) await bdir.removeEntry(n);
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
    }
    // createWritable writes to a temporary file and swaps it in on close
    const w = await (await dir.getFileHandle(SAVE_FILE, { create: true })).createWritable();
    await w.write(fileText(entries));
    await w.close();
    folder.lastJson = JSON.stringify(entries);
    folder.lastAt = Date.now();
  }

  function mirrorToFolder(entries) {
    if (!folder.ok || !hasSaves(entries) || JSON.stringify(entries) === folder.lastJson) return;
    folder.queue = folder.queue.then(() => writeFolder(entries)).then(renderFolder, (e) => {
      if (e.name === "NotAllowedError" || e.name === "SecurityError") folder.ok = false;
      toast(`Couldn't write to your save folder: ${e.message}`, true);
      renderFolder();
    });
  }

  // after linking or reconnecting: make the folder and the browser agree
  async function syncFolder() {
    let file;
    try {
      file = await readFolderFile();
    } catch (e) {
      toast(`Couldn't read the save folder: ${e.message}`, true);
      return;
    }
    const current = storageSaves();
    if (file && hasSaves(file.entries) && !same(file.entries, current)) {
      const when = file.at ? fmtTime(file.at) : "an unknown date";
      if (!hasSaves(current)) {
        const c = await ask("Load the saves from this folder?", `The folder has saves from ${when}. Loading them restarts the game.`, [["no", "Not now"], ["yes", "Load them", true]]);
        if (c === "yes") return restartWith(file.entries, "folder");
        folder.lastJson = JSON.stringify(file.entries);   // leave the file alone until the next save
        return;
      }
      const c = await ask("This folder already has saves",
        `The folder's saves are from ${when} and differ from the ones in this browser. Which should both use? Nothing is lost: the other copy goes to the backup history or the folder's backups/.`,
        [["browser", "Keep this browser's"], ["folder", "Use the folder's", true]]);
      if (c === "folder") return restartWith(file.entries, "folder");
      if (c !== "browser") {                              // dismissed: touch nothing until the next save
        folder.lastJson = JSON.stringify(current);
        return renderFolder();
      }
    } else if (file && same(file.entries, current)) {
      folder.lastJson = JSON.stringify(current);          // already up to date
    }
    if (hasSaves(current)) mirrorToFolder(current);
    else renderFolder();
  }

  async function linkFolder() {
    try {
      folder.dir = await showDirectoryPicker({ id: "thehookup-saves", mode: "readwrite", startIn: "documents" });
    } catch (e) {
      if (e.name !== "AbortError") toast(`Couldn't open that folder: ${e.message}`, true);
      return;
    }
    folder.ok = true;
    folder.lastJson = null;
    try { await db.set("dir", folder.dir); } catch (e) { /* remembered for this visit only */ }
    renderFolder();
    await syncFolder();
  }

  async function reconnectFolder() {
    try {
      folder.ok = (await folder.dir.requestPermission({ mode: "readwrite" })) === "granted";
    } catch (e) {
      folder.ok = false;
    }
    renderFolder();
    if (folder.ok) await syncFolder();
  }

  async function unlinkFolder() {
    folder.dir = null;
    folder.ok = false;
    folder.lastJson = null;
    try { await db.del("dir"); } catch (e) { /* nothing stored */ }
    renderFolder();
  }

  function renderFolder() {
    const actions = $("folder-actions");
    const text = $("folder-text");
    const btn = (label, fn, primary) => {
      const b = el("button", { type: "button", textContent: label, className: primary ? "primary" : "" });
      b.addEventListener("click", fn);
      return b;
    };
    if (!folder.dir) {
      text.innerHTML = "Pick a folder and every save is also written there as <b>thehookup-saves.json</b>, with older versions kept in <b>backups/</b>. The desktop app uses the same file, so you can point both at one folder.";
      actions.replaceChildren(btn("Choose a save folder", linkFolder, false));
      return;
    }
    const name = el("b", { textContent: folder.dir.name });
    if (!folder.ok) {
      text.replaceChildren("Linked to ", name, ". The browser needs your OK again before this page can write there.");
      actions.replaceChildren(btn("Reconnect folder", reconnectFolder, true), btn("Unlink", unlinkFolder));
      return;
    }
    text.replaceChildren("Writing to ", name, folder.lastAt ? ` · last saved ${ago(folder.lastAt)}.` : ". Saves are written here each time you save.");
    actions.replaceChildren(btn("Change folder", linkFolder), btn("Unlink", unlinkFolder));
  }

  async function initFolder() {
    if (!folder.supported) return;
    $("folder-card").hidden = false;
    try { folder.dir = (await db.get("dir")) || null; } catch (e) { folder.dir = null; }
    if (folder.dir) {
      try { folder.ok = (await folder.dir.queryPermission({ mode: "readwrite" })) === "granted"; } catch (e) { folder.ok = false; }
    }
    renderFolder();
    if (folder.ok) await syncFolder();
  }

  // ===========================================================================
  // Restore
  // ===========================================================================
  let player = null;
  let playing = false;
  let leaving = false;

  // Ruffle writes SharedObjects back as the player shuts down, so stop it first.
  async function restartWith(entries, reason) {
    try { await addSnapshot("restore", storageSaves()); } catch (e) { /* history unavailable */ }
    leaving = true;
    try { player && player.remove(); } catch (e) { /* already gone */ }
    setTimeout(async () => {
      writeStorage(entries);
      if (reason) { try { await addSnapshot(reason, entries); } catch (e) { /* history unavailable */ } }
      location.reload();
    }, 150);
  }

  async function restore(entries, question, reason) {
    const c = await ask(question, "The game restarts, so anything you haven't saved is lost. Your current saves are kept in the backup history first.", [["no", "Cancel"], ["yes", "Restore and restart", true]]);
    if (c === "yes") restartWith(entries, reason);
  }

  // ===========================================================================
  // Watching for saves
  // ===========================================================================
  let lastSeen = null;
  function poll() {
    const cur = storageSaves();
    const json = JSON.stringify(cur);
    if (json === lastSeen) return;
    const first = lastSeen === null;
    lastSeen = json;
    renderSlots(cur);
    addSnapshot("auto", cur).then((made) => {
      if (made && !first && settings.toasts) toast("Game saved · backup kept" + (folder.ok ? " · written to your folder" : ""));
    }, () => { /* history unavailable */ });
    mirrorToFolder(cur);
    checkReminder();
  }

  // ===========================================================================
  // Player
  // ===========================================================================
  window.RufflePlayer = window.RufflePlayer || {};
  window.RufflePlayer.config = {
    autoplay: "on",
    unmuteOverlay: "hidden",
    splashScreen: false,
    letterbox: "on",
    backgroundColor: "#000000",
    menu: false,
    contextMenu: "rightClickOnly",
    allowScriptAccess: false,
    openUrlMode: "confirm",
    logLevel: params.has("debug") ? "info" : "warn",
    maxExecutionDuration: 15,
    base: ".",
  };

  function start() {
    const ruffle = window.RufflePlayer.newest();
    if (!ruffle) {
      $("fallback").textContent = "The Flash player (Ruffle) failed to load. Try reloading the page.";
      return;
    }
    player = ruffle.createPlayer();
    $("stage").replaceChildren(player);
    // test switches: ?debug=1 (log to console), ?fasttime=1 (30x game clock)
    const flashvars = ["debug", "fasttime"].filter((k) => params.has(k)).map((k) => k + "=1").join("&");
    loadedWith = { quality: settings.quality, scale: settings.scale };
    player.ruffle().load({ url: "hookup.swf", parameters: flashvars, ...loadedWith }).then(applySound, (e) => {
      $("stage").replaceChildren(el("div", { id: "fallback", textContent: "The game couldn't start: " + e.message }));
    });
    player.addEventListener("pointerdown", () => { playing = true; }, { once: true });
  }

  // ===========================================================================
  // Full screen: the stage element itself goes full screen, so the page around it disappears
  // ===========================================================================
  // Where the browser refuses (iPhone Safari, some embedded browsers), the game fills the
  // window instead ("maximized").
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  let fsFallbackTimer = 0;

  function setMaximized(on) {
    document.body.classList.toggle("maximized", on);
    updateFullscreenUi();
  }

  function toggleFullscreen() {
    if (fsElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    if (document.body.classList.contains("maximized")) return setMaximized(false);
    const stage = $("stage");
    const request = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (!request) return setMaximized(true);
    let call;
    try { call = request.call(stage, { navigationUI: "hide" }); } catch (e) { return setMaximized(true); }
    if (call && call.catch) call.catch(() => setMaximized(true));
    clearTimeout(fsFallbackTimer);
    fsFallbackTimer = setTimeout(() => { if (!fsElement()) setMaximized(true); }, 800);
  }

  function updateFullscreenUi() {
    const native = fsElement() === $("stage");
    if (native) document.body.classList.remove("maximized");
    const on = native || document.body.classList.contains("maximized");
    $("fullscreen").textContent = on ? "Exit full screen" : "Full screen";
    $("exit-max").hidden = !document.body.classList.contains("maximized");
    // keep save notices visible: in native full screen only the stage is drawn
    (native ? $("stage") : document.body).append($("toast"));
    try { player && player.focus(); } catch (e) { /* not focusable yet */ }
  }

  $("fullscreen").addEventListener("click", toggleFullscreen);
  $("exit-max").addEventListener("click", () => setMaximized(false));
  document.addEventListener("fullscreenchange", updateFullscreenUi);
  document.addEventListener("webkitfullscreenchange", updateFullscreenUi);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("maximized")) setMaximized(false);
  }, true);

  addEventListener("beforeunload", (e) => {
    if (!playing || leaving || !settings.warnLeave) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // ===========================================================================
  // Wiring
  // ===========================================================================
  $("download").addEventListener("click", () => {
    const cur = storageSaves();
    if (!hasSaves(cur)) return toast("No saves yet. Save in the game first.", true);
    download(cur);
    toast("Backup downloaded");
  });

  $("backup-now").addEventListener("click", async () => {
    const cur = storageSaves();
    if (!hasSaves(cur)) return toast("No saves yet. Save in the game first.", true);
    try {
      await addSnapshot("manual", cur);
      toast("Backup kept in this browser. It won't be rotated out.");
    } catch (e) {
      toast("Couldn't store the backup: " + e.message, true);
    }
  });

  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    let parsed;
    try {
      parsed = parseFile(await file.text());
    } catch (err) {
      return toast(err.message, true);
    }
    if (!hasSaves(parsed.entries)) return toast("That file doesn't contain any saves.", true);
    const when = parsed.at ? ` from ${fmtTime(parsed.at)}` : "";
    restore(parsed.entries, `Restore the saves in this file (${summary(parsed.entries)})${when}?`, "import");
  });

  // Ask the browser not to evict our storage. Chrome decides silently; Firefox asks the
  // player, so wait for a click on the page first.
  addEventListener("pointerdown", async () => {
    try {
      if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch (e) { /* not supported */ }
    renderPersist();
  }, { once: true });

  // ===========================================================================
  // Settings menu
  // ===========================================================================
  let loadedWith = null;      // quality and scale the running game started with
  let pausedForBackground = false;

  const api = () => { try { return player && player.ruffle(); } catch (e) { return null; } };

  function applySound() {
    const r = api();
    if (!r) return;
    const silent = settings.muted || (document.hidden && settings.background === "mute");
    try { r.volume = silent ? 0 : settings.volume / 100; } catch (e) { /* player not ready */ }
  }

  document.addEventListener("visibilitychange", () => {
    const r = api();
    if (r && settings.background === "pause" && document.hidden && r.isPlaying) {
      r.suspend();
      pausedForBackground = true;
    } else if (r && !document.hidden && pausedForBackground) {
      r.resume();
      pausedForBackground = false;
    }
    applySound();
  });

  const applyPanel = () => document.body.classList.toggle("panel-below", settings.panel === "below");

  // control id -> setting; ranges and selects of numbers are stored as numbers
  const FIELDS = {
    "s-volume": "volume", "s-muted": "muted", "s-background": "background",
    "s-quality": "quality", "s-scale": "scale", "s-panel": "panel",
    "s-keep": "keepBackups", "s-reminder": "reminder", "s-toasts": "toasts", "s-warn": "warnLeave",
  };

  function renderSettings() {
    for (const [id, key] of Object.entries(FIELDS)) {
      const input = $(id);
      if (input.type === "checkbox") input.checked = settings[key];
      else input.value = String(settings[key]);
    }
    $("s-volume-out").textContent = settings.muted ? "muted" : settings.volume + "%";
    $("keep-n").textContent = settings.keepBackups;
    $("s-restart").hidden = !loadedWith || (loadedWith.quality === settings.quality && loadedWith.scale === settings.scale);
  }

  function onSettingChange(e) {
    const key = FIELDS[e.target.id];
    if (!key) return;
    const input = e.target;
    settings[key] = input.type === "checkbox" ? input.checked
      : typeof DEFAULTS[key] === "number" ? Number(input.value) : input.value;
    storeSettings();
    if (key === "volume" || key === "muted" || key === "background") applySound();
    if (key === "background" && settings.background !== "pause" && pausedForBackground) {
      api() && api().resume();
      pausedForBackground = false;
    }
    if (key === "panel") applyPanel();
    if (key === "keepBackups") pruneHistory().then(renderHistory, () => {});
    if (key === "reminder") checkReminder();
    renderSettings();
  }

  async function restartGame() {
    const c = await ask("Restart the game?", "The new display settings need a restart. Anything you haven't saved is lost.", [["no", "Cancel"], ["yes", "Restart", true]]);
    if (c !== "yes") return;
    leaving = true;
    try { player && player.remove(); } catch (e) { /* already gone */ }
    setTimeout(() => location.reload(), 150);
  }

  async function resetSettings() {
    const c = await ask("Reset all settings?", "Sound, display and backup settings go back to their defaults. Your saves and backups aren't touched.", [["no", "Cancel"], ["yes", "Reset", true]]);
    if (c !== "yes") return;
    const keepDownload = settings.lastDownloadAt;
    Object.assign(settings, DEFAULTS, { lastDownloadAt: keepDownload });
    storeSettings();
    applySound();
    applyPanel();
    pruneHistory().then(renderHistory, () => {});
    checkReminder();
    renderSettings();
  }

  async function deleteEverything() {
    for (;;) {
      const c = await ask("Delete all saves and backups?",
        "This removes every save slot and the whole backup history from this browser, and unlinks the save folder (files already in that folder are kept). It can't be undone.",
        [["no", "Cancel"], ["download", "Download a backup first"], ["yes", "Delete everything", "danger"]]);
      if (c === "download") {
        const cur = storageSaves();
        if (hasSaves(cur)) download(cur);
        else toast("There are no saves to download.", true);
        continue;
      }
      if (c !== "yes") return;
      break;
    }
    $("settings").close();
    leaving = true;
    try { player && player.remove(); } catch (e) { /* already gone */ }
    setTimeout(async () => {
      for (const k of Object.keys(localStorage)) if (isSaveKey(k)) localStorage.removeItem(k);
      try { await db.clear(); await db.del("dir"); } catch (e) { /* history unavailable */ }
      location.reload();
    }, 150);
  }

  $("open-settings").addEventListener("click", () => {
    renderSettings();
    $("settings").showModal();
  });
  $("settings").addEventListener("input", onSettingChange);
  $("settings").addEventListener("change", onSettingChange);
  $("s-restart-btn").addEventListener("click", restartGame);
  $("s-reset").addEventListener("click", resetSettings);
  $("s-wipe").addEventListener("click", deleteEverything);
  $("reminder-dl").addEventListener("click", () => $("download").click());

  window.addEventListener("load", () => {
    applyPanel();
    $("keep-n").textContent = settings.keepBackups;
    start();
    renderPersist();
    renderHistory();
    poll();
    setInterval(poll, POLL_MS);
    setInterval(checkReminder, 10 * 60e3);
    setInterval(() => folder.ok && renderFolder(), 30000);
    initFolder();
  });
})();
