// The Hook-Up 1.0 desktop page: starts the game in Ruffle, keeps the saves file on
// disk in step with the player's storage, and adds controller support (an on-screen
// pointer, an on-screen keyboard, a pause menu).
(() => {
  "use strict";
  const desk = window.hookupDesktop;
  const SO_NAME = "thehookup";            // SharedObject name used by the patched SWF
  const SYNC_MS = 500;                    // how often storage is checked for new saves
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  if (!desk) {
    $("fallback").textContent = "This page is part of The Hook-Up desktop app. Start the game with The Hook-Up.exe or TheHookUp.sh.";
    return;
  }
  const info = desk.info();

  // ===========================================================================
  // Saves: the file on disk is the source of truth.
  // Ruffle keeps each SharedObject in localStorage under "<host>/<path>/<name>". On
  // start the file's saves are copied into storage before the player exists; while
  // playing, any change in storage is written straight back to the file.
  // ===========================================================================
  const isSaveKey = (k) => k.split("/").pop() === SO_NAME;
  const pathOf = (k) => k.slice(k.indexOf("/"));       // drop the host part

  function storageSaves() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isSaveKey(k)) out[pathOf(k)] = localStorage.getItem(k);
    }
    return sortKeys(out);
  }
  function sortKeys(obj) {
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = obj[k];
    return out;
  }

  let lastSynced = null;   // JSON of the saves last confirmed on disk
  let lastWriteAt = null;
  let syncTimer = null;

  function restoreSaves() {
    const res = desk.loadSaves();
    const inStorage = storageSaves();
    if (res.entries) {
      const fromFile = sortKeys(res.entries);
      if (Object.keys(inStorage).length && JSON.stringify(inStorage) !== JSON.stringify(fromFile)) {
        desk.stashStorage(inStorage); // never drop anything: keep the old copy as a backup
      }
      for (const k of Object.keys(localStorage)) if (isSaveKey(k)) localStorage.removeItem(k);
      for (const [p, v] of Object.entries(fromFile)) localStorage.setItem(location.hostname + p, v);
      lastSynced = JSON.stringify(fromFile);
      if (res.savedAt) lastWriteAt = new Date(res.savedAt);
    } else if (Object.keys(inStorage).length) {
      // no file yet but saves in storage: write them out now
      const w = desk.writeSaves(inStorage);
      lastSynced = w.ok ? JSON.stringify(inStorage) : null;
    } else {
      lastSynced = JSON.stringify({});
    }
    if (res.warning) showBanner(res.warning, false);
  }

  function syncSaves(quiet) {
    let current;
    try {
      current = storageSaves();
    } catch (e) {
      return;
    }
    const json = JSON.stringify(current);
    if (json === lastSynced) return;
    const res = desk.writeSaves(current);
    if (res.ok) {
      lastSynced = json;
      lastWriteAt = new Date(res.savedAt || Date.now());
      hideBanner();
      if (!quiet && !res.unchanged) toast("Saved to disk", res.file.split(/[\\/]/).slice(-2).join("/"));
    } else {
      // keep lastSynced as it was, so the next check tries again
      showBanner(`Couldn't write your save to ${res.file}: ${res.error}. The game will keep trying. Don't quit until this message goes away.`, true);
    }
    updateSaveInfo();
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
    contextMenu: "off",
    allowScriptAccess: false,
    openUrlMode: "deny",
    quality: "high",
    logLevel: params.has("debug") ? "info" : "warn",
    maxExecutionDuration: 15,
    base: ".",
  };

  let player = null;

  function start() {
    restoreSaves();
    const ruffle = window.RufflePlayer.newest();
    if (!ruffle) {
      $("fallback").textContent = "The Ruffle player failed to load.";
      return;
    }
    player = ruffle.createPlayer();
    $("stage").replaceChildren(player);
    const flashvars = ["debug", "fasttime"].filter((k) => params.has(k)).map((k) => k + "=1").join("&");
    player.ruffle().load({ url: "hookup.swf", parameters: flashvars }).catch((e) => {
      $("stage").replaceChildren(Object.assign(document.createElement("div"), { id: "fallback", textContent: "The game couldn't start: " + e.message }));
    });
    player.focus();
    syncTimer = setInterval(() => syncSaves(false), SYNC_MS);
    requestAnimationFrame(tick);
    setTimeout(() => $("hint").classList.add("gone"), 9000);
  }

  // Closing the window: stop the player (Ruffle writes its storage as it shuts down),
  // copy the saves to disk one last time, then let the window close.
  desk.onClosing(() => {
    clearInterval(syncTimer);
    try { player && player.remove(); } catch (e) { /* already gone */ }
    setTimeout(() => {
      syncSaves(true);
      desk.readyToClose();
    }, 150);
  });

  function suspendGame(on) {
    if (!player || !player.ruffle) return;
    try {
      const r = player.ruffle();
      if (on) r.suspend(); else r.resume();
    } catch (e) { /* older API */ }
  }

  // ===========================================================================
  // Toasts, banner, save info
  // ===========================================================================
  let toastTimer = null;
  function toast(text, detail, warn) {
    const el = $("toast");
    el.replaceChildren(document.createTextNode(text));
    if (detail) el.append(Object.assign(document.createElement("small"), { textContent: detail }));
    el.classList.toggle("warn", !!warn);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }
  function showBanner(text, isError) {
    const el = $("banner");
    el.replaceChildren();
    if (isError) el.append(Object.assign(document.createElement("b"), { textContent: "Save problem. " }));
    el.append(document.createTextNode(text));
    el.classList.add("show");
    if (!isError) setTimeout(hideBanner, 12000);
  }
  function hideBanner() { $("banner").classList.remove("show"); }

  function updateSaveInfo() {
    $("save-path").textContent = info.saveFile;
    $("save-when").textContent = lastWriteAt
      ? `Last written to disk ${lastWriteAt.toLocaleString()}.`
      : "No saves on disk yet. Save from the in-game toolbar.";
  }

  // ===========================================================================
  // Overlays: menu and controls
  // ===========================================================================
  let overlay = null;          // "menu" | "help" | null
  let menuIndex = 0;

  function menuButtons() {
    const list = $("quit-confirm").hidden ? $("menu-main") : $("quit-confirm");
    return [...list.querySelectorAll("button")].filter((b) => !b.hidden);
  }
  function highlight(i) {
    const btns = menuButtons();
    menuIndex = (i + btns.length) % btns.length;
    document.querySelectorAll("#menu button").forEach((b) => b.classList.remove("sel"));
    btns[menuIndex].classList.add("sel");
  }
  function openOverlay(name) {
    closeOsk();
    if (overlay && overlay !== name) $(overlay).classList.remove("show");
    overlay = name;
    $(name).classList.add("show");
    document.body.classList.add("overlay-open");
    if (name === "menu") {
      $("quit-confirm").hidden = true;
      $("menu-main").hidden = false;
      $("fs-val").textContent = isFullscreen ? "On" : "Off";
      updateSaveInfo();
      highlight(0);
    }
    if (pointerDown) releasePointer();
    suspendGame(true);
  }
  function closeOverlay() {
    if (!overlay) return;
    $(overlay).classList.remove("show");
    overlay = null;
    document.body.classList.remove("overlay-open");
    suspendGame(false);
    if (player) player.focus();
  }
  function back() {
    if (overlay === "menu" && !$("quit-confirm").hidden) return menuAction("quit-no");
    closeOverlay();
  }

  async function menuAction(act) {
    switch (act) {
      case "resume": return closeOverlay();
      case "controls": return openOverlay("help");
      case "fullscreen": {
        isFullscreen = await desk.setFullscreen(!isFullscreen);
        $("fs-val").textContent = isFullscreen ? "On" : "Off";
        return;
      }
      case "backup": {
        syncSaves(true);
        const r = await desk.backupNow();
        if (r.ok) toast("Backup saved", r.file); else toast("No backup made", r.error, true);
        return;
      }
      case "folder": return desk.openSavesFolder();
      case "quit":
        $("menu-main").hidden = true;
        $("quit-confirm").hidden = false;
        return highlight(1);
      case "quit-no":
        $("quit-confirm").hidden = true;
        $("menu-main").hidden = false;
        return highlight(menuButtons().length - 1);
      case "quit-yes": return desk.quit();
    }
  }
  $("menu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (b) menuAction(b.dataset.act);
    else if (e.target === $("menu")) closeOverlay();
  });
  $("menu").addEventListener("mousemove", (e) => {
    const b = e.target.closest("button[data-act]");
    if (b && !padMode) highlight(menuButtons().indexOf(b));
  });
  $("help").addEventListener("click", () => closeOverlay());

  let isFullscreen = info.fullscreen;
  desk.onFullscreen((on) => { isFullscreen = on; $("fs-val").textContent = on ? "On" : "Off"; });

  // keyboard shortcuts (F11 is handled by the app itself)
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (oskOpen) closeOsk(); else if (overlay) back(); else openOverlay("menu");
    } else if (e.key === "F1") {
      e.preventDefault();
      overlay === "help" ? closeOverlay() : openOverlay("help");
    } else if (overlay === "menu") {
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(menuIndex + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(menuIndex - 1); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); menuButtons()[menuIndex].click(); }
    }
  }, true);

  // ===========================================================================
  // Controller pointer
  // ===========================================================================
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const DEADZONE = 0.16;
  const vcursor = $("vcursor");
  let cx = innerWidth / 2, cy = innerHeight / 2;
  let padMode = false;
  let pointerDown = false;
  let sent = { x: -1, y: -1 };
  let prevButtons = [];
  let lastFrame = performance.now();

  function setPadMode(on) {
    padMode = on;
    document.body.classList.toggle("pad-mode", on);
  }
  function drawCursor() {
    vcursor.style.transform = `translate(${cx - 6}px, ${cy - 3}px)`;
  }
  function sendMove() {
    const x = Math.round(cx), y = Math.round(cy);
    if (x === sent.x && y === sent.y) return;
    sent = { x, y };
    desk.mouse("move", x, y);
  }
  function pressPointer() {
    pointerDown = true;
    vcursor.classList.add("down");
    sendMove();
    desk.mouse("down", Math.round(cx), Math.round(cy), "left");
  }
  function releasePointer() {
    pointerDown = false;
    vcursor.classList.remove("down");
    desk.mouse("up", Math.round(cx), Math.round(cy), "left");
  }

  // A real mouse, trackpad or touch takes over: hide the controller pointer and
  // carry on from wherever that pointer is. Our own synthetic moves land exactly on
  // the last position we sent, which is how they're told apart.
  function realPointer(e) {
    if (Math.abs(e.clientX - sent.x) <= 1 && Math.abs(e.clientY - sent.y) <= 1) return;
    cx = e.clientX; cy = e.clientY;
    if (padMode) setPadMode(false);
  }
  addEventListener("pointermove", realPointer, true);
  addEventListener("pointerdown", realPointer, true);

  // Show a hand over things Ruffle marks as clickable.
  function updateCursorShape() {
    if (!player) return;
    const el = document.elementFromPoint(cx, cy);
    let cur = "";
    if (el) {
      const inner = el.shadowRoot ? el.shadowRoot.elementFromPoint(cx, cy) : null;
      cur = getComputedStyle(inner || el).cursor;
    }
    vcursor.classList.toggle("hand", cur === "pointer");
  }

  function axis(v) {
    const m = Math.abs(v);
    if (m < DEADZONE) return 0;
    const n = (m - DEADZONE) / (1 - DEADZONE);
    return Math.sign(v) * n * n;
  }

  // held-direction repeat for menus, the keyboard and the D-pad nudge
  const repeat = {};
  function repeating(name, held, now) {
    if (!held) { delete repeat[name]; return false; }
    if (!(name in repeat)) { repeat[name] = now + 380; return true; }
    if (now >= repeat[name]) { repeat[name] = now + 95; return true; }
    return false;
  }

  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let best = null;
    for (const p of pads) if (p && p.connected && (!best || p.timestamp > best.timestamp)) best = p;
    return best;
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const pad = readPad();
    if (pad) handlePad(pad, now, dt);
    requestAnimationFrame(tick);
  }

  function handlePad(pad, now, dt) {
    const btn = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
    const val = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    const pressed = (i) => btn(i) && !prevButtons[i];
    const released = (i) => !btn(i) && prevButtons[i];
    const lx = axis(pad.axes[0] || 0), ly = axis(pad.axes[1] || 0);
    const rx = axis(pad.axes[2] || 0), ry = axis(pad.axes[3] || 0);
    const any = pad.buttons.some((b) => b && b.pressed) || lx || ly || rx || ry;
    if (any && !padMode) setPadMode(true);

    const up = btn(B.UP) || ly < -0.35, down = btn(B.DOWN) || ly > 0.35;
    const left = btn(B.LEFT) || lx < -0.35, right = btn(B.RIGHT) || lx > 0.35;

    if (pressed(B.START)) {
      if (overlay === "menu") closeOverlay(); else openOverlay("menu");
    } else if (pressed(B.SELECT)) {
      if (overlay === "help") closeOverlay(); else openOverlay("help");
    } else if (overlay === "menu") {
      if (repeating("up", up, now)) highlight(menuIndex - 1);
      if (repeating("down", down, now)) highlight(menuIndex + 1);
      if (pressed(B.A)) menuButtons()[menuIndex].click();
      if (pressed(B.B)) back();
    } else if (overlay === "help") {
      if (pressed(B.A) || pressed(B.B)) closeOverlay();
    } else if (oskOpen) {
      if (repeating("up", up, now)) oskMove(0, -1);
      if (repeating("down", down, now)) oskMove(0, 1);
      if (repeating("left", left, now)) oskMove(-1, 0);
      if (repeating("right", right, now)) oskMove(1, 0);
      if (pressed(B.A)) oskPress(oskSelected());
      if (pressed(B.B)) oskPress("backspace");
      if (pressed(B.X)) oskPress("space");
      if (pressed(B.LB) || pressed(B.L3)) oskPress("shift");
      if (pressed(B.Y)) closeOsk();
      // the right stick still moves the pointer, to click a different text box
      movePointer(rx * 0.35, ry * 0.35, 1, dt);
    } else {
      // pointer speed scales with the window, so it feels the same at any size
      let speed = 1;
      if (val(B.RT) > 0.2) speed *= 1 + 1.4 * val(B.RT);
      if (val(B.LT) > 0.2) speed *= 1 - 0.65 * val(B.LT);
      let mx = lx + rx * 0.3, my = ly + ry * 0.3;
      if (repeating("nudge-l", btn(B.LEFT), now)) cx -= 3;
      if (repeating("nudge-r", btn(B.RIGHT), now)) cx += 3;
      if (repeating("nudge-u", btn(B.UP), now)) cy -= 3;
      if (repeating("nudge-d", btn(B.DOWN), now)) cy += 3;
      if (pressed(B.R3)) { cx = innerWidth / 2; cy = innerHeight / 2; }
      movePointer(mx, my, speed, dt);
      if (pressed(B.A)) pressPointer();
      if (released(B.A) && pointerDown) releasePointer();
      if (pressed(B.Y)) openOsk();
    }
    if (padMode) {
      cx = Math.max(0, Math.min(innerWidth - 1, cx));
      cy = Math.max(0, Math.min(innerHeight - 1, cy));
      if (!overlay) sendMove();
      drawCursor();
      updateCursorShape();
    }
    prevButtons = pad.buttons.map((b) => !!(b && (b.pressed || b.value > 0.5)));
  }

  function movePointer(mx, my, speed, dt) {
    const base = innerHeight * 1.15; // px per second at full tilt
    cx += mx * base * speed * dt;
    cy += my * base * speed * dt;
  }

  // ===========================================================================
  // On-screen keyboard: sends real key presses to whatever has focus in the game.
  // ===========================================================================
  const OSK_ROWS = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "'"],
    ["shift", "z", "x", "c", "v", "b", "n", "m", "-", "backspace"],
    ["space", "done"],
  ];
  const OSK_LABEL = { shift: "⇧ Shift", backspace: "⌫", space: "Space", done: "Done" };
  let oskOpen = false, oskShift = false, oskRow = 1, oskCol = 0;

  function buildOsk() {
    const osk = $("osk");
    OSK_ROWS.forEach((row, r) => {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      row.forEach((k, c) => {
        const el = document.createElement("div");
        el.className = "key" + (k === "space" ? " wide" : k.length > 1 ? " mid" : "");
        el.dataset.key = k;
        el.dataset.r = r;
        el.dataset.c = c;
        rowEl.append(el);
      });
      osk.append(rowEl);
    });
    osk.append(Object.assign(document.createElement("div"), {
      className: "legend",
      innerHTML: '<span class="btn a">A</span> type &nbsp;<span class="btn b">B</span> delete &nbsp;<span class="btn x">X</span> space &nbsp;<span class="btn wide">LB</span> shift &nbsp;<span class="btn y">Y</span> close &nbsp;·&nbsp; right stick moves the pointer',
    }));
    // clicking or tapping keys must not take focus away from the game
    osk.addEventListener("mousedown", (e) => e.preventDefault());
    osk.addEventListener("pointerdown", (e) => e.preventDefault());
    osk.addEventListener("click", (e) => {
      const el = e.target.closest(".key");
      if (!el) return;
      oskRow = +el.dataset.r; oskCol = +el.dataset.c;
      oskPress(el.dataset.key);
    });
    renderOsk();
  }
  function renderOsk() {
    for (const el of $("osk").querySelectorAll(".key")) {
      const k = el.dataset.key;
      el.textContent = OSK_LABEL[k] || (oskShift ? k.toUpperCase() : k);
      el.classList.toggle("sel", +el.dataset.r === oskRow && +el.dataset.c === oskCol);
      el.classList.toggle("on", k === "shift" && oskShift);
    }
  }
  function oskSelected() { return OSK_ROWS[oskRow][oskCol]; }
  function oskMove(dx, dy) {
    if (dy) {
      const from = OSK_ROWS[oskRow].length;
      oskRow = (oskRow + dy + OSK_ROWS.length) % OSK_ROWS.length;
      const to = OSK_ROWS[oskRow].length;
      oskCol = Math.min(to - 1, Math.floor(((oskCol + 0.5) / from) * to));
    }
    if (dx) oskCol = (oskCol + dx + OSK_ROWS[oskRow].length) % OSK_ROWS[oskRow].length;
    renderOsk();
  }
  function oskPress(k) {
    const el = $("osk").querySelector(`.key[data-key="${CSS.escape(k)}"]`);
    if (el) { el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 120); }
    if (k === "shift") { oskShift = !oskShift; renderOsk(); return; }
    if (k === "done") { closeOsk(); return; }
    if (k === "backspace") { desk.key("Backspace"); return; }
    if (k === "space") { desk.key("Space", " "); return; }
    const ch = oskShift ? k.toUpperCase() : k;
    desk.key(ch, ch);
    if (oskShift) { oskShift = false; renderOsk(); }
  }
  function openOsk() {
    if (pointerDown) releasePointer();
    oskOpen = true;
    // sit on the other half of the screen from the pointer, so the text box stays visible
    $("osk").classList.toggle("top", cy > innerHeight * 0.45);
    $("osk").classList.add("show");
    renderOsk();
  }
  function closeOsk() {
    oskOpen = false;
    $("osk").classList.remove("show");
  }

  buildOsk();
  updateSaveInfo();
  if (document.readyState === "complete") start(); else addEventListener("load", start);
})();
