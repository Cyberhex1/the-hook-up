# The Hook-Up: plan to make it fully playable

## Status (2026-10-20)

Implemented, and tested in the browser (Ruffle 0.7.1):
- three save slots, autosave each morning, a slot picker inside Flash;
- export/import of saves on the web page;
- pending text-message appointments are saved, so they no longer block saving;
- Ruffle upgrade (fixes select-all and the caret in the name field);
- fixes: duplicate `Game.init()`, the load-state timer and listener leak, the `NPCScheduleItemPosition` and `ScriptedEvent` listener leaks, info prompts unfreezing the game, the placeholder billboard URL.

Build with `python -I tools/fetch_deps.py` once, then `python -I tools/build.py`, which writes `dist/`.

Not yet verified: the patched SWF in `flashplayer_32_sa.exe`. Computer use can't attach to the portable exe, so this needs a manual check.

Freeze: with these fixes and Ruffle 0.7.1, the longest main-thread task measured was about 150 ms during startup, loading a save, and entering a location. The original 15 s freeze wasn't reproduced; it was most likely the old Ruffle build plus the duplicate init.

Decisions taken: both targets, three slots plus autosave, export/import. Publishing comes later.

---

The original plan follows.

---

## 1. What's in the folder

| Item | Notes |
|---|---|
| `hookup.swf` | Main game. SWF v7, zlib-compressed, **ActionScript 2 (AVM1)**, stage **770×560**, 16 fps, 2 frames. About 160 AS2 classes under `com.thup.dboy.*`. Version string reads "v1.5.2 (8/14/2007)"; the internal `SaveManager.GAME_VERSION` is `"1.1"`. |
| `map_*.swf`, `location_*.swf`, `character_*.swf`, `clothing_store.swf` | Loaded at runtime with `MovieClipLoader`, using relative paths. |
| `xml/*.xml` | Game content: 964 conversation steps, 662 options, 253 nuggets (max id 275), quests, schedules, scripted events, intense-conversation (`ic_*`) decks. |
| `mp3/*.mp3` | Streamed music and ambience (`Sound.loadSound`). |
| `billboards/` | Placeholder ad images. `billboards.xml` points the town billboard at `http://www.google.com`. |
| `hookup.html` | Bare `<object>` embed at **750×550**, which is the wrong size. |
| `flashplayer_32_sa.exe` | Adobe standalone projector. |

The reference port (pazaz.github.io/the-n/hookup) is the same files, a corrected 770×560 `<object>`, and a self-hosted **Ruffle build from Nov 17, 2022**. The game itself was not modified. archive.org hosts the same zip.

## 2. Root causes of the known issues

### 2.1 No save/load (confirmed by disassembling `SaveManager`, `Game`, `GameStateStartLoadGame`)

The game was built for TheN.com's PHP backend:

- **Identity:** `Game` reads the FlashVars `_root.userOid` (logged-in user id) and `_root.fastload`.
- **Save:** toolbar Save → `SaveManager.save()`, which:
  - refuses unless the state is "world walk", the game isn't frozen, and there's no pending phone appointment;
  - builds `<SAVEGAME CURTIME NAME VER><APPOINTMENTS/><OUTFIT/><NPCS/><MEMORY>0101…</MEMORY></SAVEGAME>`;
  - builds the nugget bit-string over several frames;
  - runs `savedata.getURL("save.php", "_self", "POST")` with the XML as variable `savexml`.
  This **navigates the whole page away.** The server stored the save and presumably sent the player back to `hookup.php?fastload=1`, which auto-loaded it.
- **Load:** title-screen Load → `Game.startLoadGame()`. With no `userOid` it calls `getURL("/login.php?redirect=/games/hookup/hookup.php", "_self")`. Otherwise it sets `GameStateStartLoadGame`, which runs `SaveManager.startLoad(oid)` → `XML.load("loadsavexml.php?oid=" + oid)` → `parseLoad()`. That function restores time, name, appointments, NPC opinions, outfit, and nugget memory, then fast-forwards the clock back to the saved time.
- None of those endpoints exist on GitHub Pages or with `file://`. Consequences:
  - **On the reference port, clicking Save navigates to a 404 and wipes the running game.** This is a data-loss bug, not just a missing feature.
  - **Clicking Load navigates to `/login.php` (404).**
  - In the standalone projector, `getURL(_self)` tries to open a browser.

What the save covers: time and date, name, appointments, outfit and colours, all NPC like/respect/desire/trust/happy/relationship values, and every known nugget. Quests and journal entries are derived from nuggets, so the existing format is complete enough. **We keep the format and only replace the transport.**

### 2.2 Name field can't select-all
This is a Ruffle limitation from 2022. Edit-text caret, selection, and Ctrl+A have improved a lot in Ruffle since then. **First fix: upgrade Ruffle. Fallback: a small patch that clears the name field on focus.**

### 2.3 Freezes of up to 15 s
**15 s is exactly Ruffle's default `maxExecutionDuration`.** A single script runs long enough that Ruffle kills it, and then the game carries on. That matches "waiting is typically enough." Static review found **no unbounded loops**:
- A* has `MAX_SEARCH`/`MAX_ITERATIONS`, a `getTimer` budget, and gives up after 50 searches.
- Content parsing is chunked at 100 steps per frame.
- Scripted-event sleep is timer-driven, not a busy-wait.

So the likely cause is heavy per-frame work being slow in the 2022 AVM1 interpreter. Candidates, all to be measured, not assumed:
1. **The debug logger.** Every `DebugHandler.msg` goes to `net.hiddenresource.util.Debug.trace` (the Alcon debugger), which creates a `LocalConnection` and sends to `_alcon_lc` **for each message**. The game logs constantly: every A* think, every scripted-event sleep tick, "LOADING CS x to y", and on save/load it concatenates the **entire save XML** into log strings.
2. XML DOM traversal during content parsing. Each iteration re-reads `_convXML.firstChild.childNodes` and `node.childNodes`, which was very slow in older Ruffle.
3. Shape-flag `hitTest` calls in A* grid setup (`collisionMask.hitTest(x, y, true)`).

### 2.4 Other bugs found (not on your list)
| # | Bug | Fix |
|---|---|---|
| B1 | Save on the web port navigates away and loses progress (see 2.1). | Replaced by the new save transport. |
| B2 | Load redirects to `/login.php`. | Patched. |
| B3 | `hookup.html` embeds at 750×550, but the stage is 770×560, so it's scaled or cropped. | New page at 770×560 with letterboxing. |
| B4 | The town billboard opens `http://www.google.com` in a new tab (leftover placeholder). | Set `URL=""`. The code already skips the click handler for an empty URL, as the warehouse billboard does. |
| B5 | `parseLoad()`'s failure path calls `Game.gsm.current.loadFailed()` synchronously. If the load ever resolves in the same frame, which a local-storage load would, `gsm.current` is still the *previous* state, because `setState` hasn't assigned the new one yet. | The patched load must defer by at least one frame. |
| B6 | Nothing warns before closing or reloading the tab. | Add a `beforeunload` guard on the web page. |
| B7 | Very noisy debug logging (see 2.3 #1). | Stub the Alcon `Debug.trace` call. |

Items to check during testing (suspected only, not confirmed):
- Does replaying nuggets on load (`player.addNugget` for each known nugget) spam "gained!" alert boxes?
- Does the "Your save is from an old version" prompt misfire? It compares `GAME_VERSION "1.1"` to the saved `VER`. New saves will match.

---

## 3. Approach

**Patch `hookup.swf` itself (append one DoAction), and serve it through a current self-hosted Ruffle page.** The same patched SWF also works in `flashplayer_32_sa.exe`.

**Saves go to a Flash `SharedObject`**, not a fake server. Reasons:
- It works in every target: Ruffle web (stored in `localStorage`), Ruffle desktop, and the Adobe projector (its own `#SharedObjects` folder).
- No page navigation. Saving happens in place and play continues.
- The data is the original `<SAVEGAME>` XML string, so the existing `parseLoad` restores it unchanged. The string is about 2–4 KB, well under Flash's 100 KB no-prompt limit.

I considered emulating `save.php` and `loadsavexml.php` with a service worker, which needs no SWF changes. I rejected it: it works only in a browser over http(s), it reloads the page on every save, and it does nothing for the projector.

**Patch mechanism:** append a `DoAction` tag that runs after the AS2 classes are registered (`DoInitAction`s) and before `Game.init` runs. It overrides methods on the class prototypes at runtime. No existing bytecode is edited, which keeps the risk low and makes the patch easy to review and revert. The overrides:

```actionscript
// runs once, before Game.init
_root.userOid = "local";                       // satisfies Game.startLoadGame()'s login check

var SM = com.thup.dboy.SaveManager.prototype;
SM.saveComplete = function () {                // replaces the getURL("save.php", POST)
    var mem = this.saveXML.createElement("MEMORY");
    mem.appendChild(this.saveXML.createTextNode(this._curString));
    this.topnode.appendChild(mem);
    this.saveXML.appendChild(this.topnode);
    var so = SharedObject.getLocal("thehookup", "/");
    so.data.savexml = this.saveXML.toString();
    so.data.savedAt = new Date().toString();
    var ok = so.flush();
    new com.thup.dboy.Prompt(ok ? "Game saved!" : "Save failed.", true);
};
SM.startLoad = function (oid) {                // replaces XML.load("loadsavexml.php?oid=")
    this.saveXML = new XML(); this.saveXML.ignoreWhite = true;
    var so = SharedObject.getLocal("thehookup", "/");
    var me = this;
    // defer one frame so gsm.current is the load state (bug B5)
    var mc = _root.createEmptyMovieClip("__loaddefer", _root.getNextHighestDepth());
    mc.onEnterFrame = function () {
        this.removeMovieClip();
        if (so.data.savexml == undefined) { com.thup.dboy.Game.gsm.current.loadFailed(); return; }
        me.saveXML.parseXML(so.data.savexml);
        me.parseLoad();
    };
};
// B7: silence Alcon LocalConnection logging; keep a switch for debugging
net.hiddenresource.util.Debug.trace = function () {};
```

This is pseudocode. The real argument orders come from the disassembly; for example, `Prompt` is `new Prompt(text, isBig)`.

---

## 4. Implementation phases

### Phase 0: Project setup
1. `git init` at `C:\code\The Hook-Up`. Commit the pristine game folder as the baseline.
2. Layout:
   - `The Hook-Up/`: the original download, **never modified**.
   - `tools/`: Python build tools, all run with `python -I`.
   - `web/`: `index.html` source.
   - `dist/`: generated playable build.
3. Move the throwaway analysis scripts into `tools/` and finish them: `swf.py` (parse and re-serialize tags, recompress) and `avm1dis.py` (disassembler, kept for verification).

### Phase 1: Web player (fixes B3, B6, and likely the caret and freeze issues)
1. Vendor a **pinned** Ruffle web build: the `@ruffle-rs/ruffle` npm package, a nightly at least two weeks old. Self-host it in `dist/ruffle/` so the build works offline and can't break when upstream changes.
2. Write `web/index.html`:
   - 770×560 container with letterbox scaling.
   - Black background; known-issues and help text.
   - Ruffle config: `autoplay: "on"`, `unmuteOverlay: "hidden"`, `splashScreen: false`, `letterbox: "on"`, `allowScriptAccess: false`, `maxExecutionDuration: 15` (kept at 15 so a real runaway still recovers; revisit after Phase 3), `base: "."`, `menu: false`.
   - `beforeunload` confirmation while a game is running.
3. A local run script: `tools/serve.py`, or a `.claude/launch.json` entry for `python -m http.server`, because Ruffle needs http(s), not `file://`.
4. **Checkpoint:** load the original, unpatched SWF in the new page. Re-test the caret/select-all and the freeze. That tells us how much the Ruffle upgrade alone fixed before we patch anything.

### Phase 2: Save/load patch (fixes the core issue, B1, B2, B5)
1. `tools/avm1asm.py`: a small AVM1 assembler covering ConstantPool, Push (string, int, double, bool, null, undefined, register, constant), Get/SetVariable, Get/SetMember, CallMethod, CallFunction, NewObject, NewMethod, DefineFunction2, If, Jump, Not, Equals2, Pop, StoreRegister, and Return.
   - I'll write the patch in readable assembly with labels.
   - **Alternative:** if you're OK downloading JPEXS FFDec (Java 8 is installed), we can compile real AS2 source with it and use it as a second-opinion decompiler.
2. `tools/patch.py`:
   - Decompress `hookup.swf`.
   - Find the frame boundary after the last `DoInitAction` and before the first frame-script `DoAction` that calls `Game.init`. **Verify the ordering first.**
   - Insert the patch `DoAction` there.
   - Fix the header length, recompress, and write `dist/hookup.swf`.
   - Self-check: every original tag must round-trip byte-for-byte, and the only diff is the inserted tag.
3. Patch contents, as in §3:
   - `_root.userOid`
   - `SaveManager.prototype.saveComplete` (SharedObject + "Game saved!" prompt)
   - `SaveManager.prototype.startLoad` (SharedObject + one-frame defer + "No save game was found!" path)
   - `Debug.trace` stub, with an opt-in debug flag such as `?debug=1` → FlashVar → keep logging
4. Optional, needs your OK:
   - Speed up `SaveManager.think`/`loadThink` from 10 nuggets per frame to all at once, since 275 chars is trivial.
   - Autosave when the player goes to sleep (hook `Player.wakeUp`).

### Phase 3: Freeze investigation (profile before fixing)
1. Run the patched build in the built-in browser. Capture timestamps around:
   - the loader, from start to the title screen (XML parse);
   - the first map load;
   - entering locations;
   - starting an intense conversation;
   - save and load.
   Watch the console for Ruffle's "script took too long" warning.
2. Fix only what the measurements show. In order of preference:
   - a newer Ruffle (Phase 1);
   - the logging stub (Phase 2);
   - a targeted prototype override of the slow method, for example caching `childNodes` in the content parser or memoizing the A* grid `hitTest`;
   - as a last resort, lowering `_stepsPerBlock` so loading shows progress instead of hanging.

### Phase 4: Small content and UX fixes
1. B4: copy `billboards.xml` into `dist/` with the Google URL blanked. Optionally replace the placeholder JPGs.
2. Name-field fallback: only if Phase 1 didn't fix select-all, override the customize-screen name field's `onSetFocus` so it clears the default text.
3. Optional web extras:
   - "Export save" and "Import save" buttons. These read and write the Ruffle `localStorage` key for the `thehookup` SharedObject, as a backup against cleared browser data.
   - A "Saved at …" indicator.

### Phase 5: Build and package
1. `tools/build.py` assembles `dist/`:
   - copies all assets (SWFs, xml, mp3, billboards) unchanged;
   - writes the patched `hookup.swf`, `index.html`, and `ruffle/`;
   - includes a `README` covering how to play in a browser (local server or static hosting) and in the standalone projector (File → Open `dist/hookup.swf`, saves now work there too).
2. Optional: publish `dist/` to GitHub Pages. Needs your OK; it's an outward-facing action.

### Phase 6: Verification (playthrough checklist)
- **New game:** customize (all outfit, colour, and hair options), then type a name, backspace, and select-all.
- **World:** walk town, burbs, and warehouse. Enter every location (17 location SWFs). Clothing store. Music and ambience toggles.
- **Conversations:**
  - Chat options and an intense conversation, including both a win and a loss.
  - Book an appointment, keep it, and miss one.
  - Book a phone appointment and confirm Save is blocked with "You can not save now.", which is the original design.
- **Sleep:** go home and sleep through the night prompt.
- **Save, then fully reload the page (and separately close and reopen the browser), then Load.** Compare against notes taken before saving:
  - time and day;
  - name;
  - outfit and colours;
  - NPC meters on the Characters screen;
  - Journal nuggets;
  - Planner to-dos and appointments.
- Load with no save → "No save game was found!", and you're back at the title screen in a usable state.
- Repeat save and load in `flashplayer_32_sa.exe` with the patched SWF.
- Regressions: no navigation away from the page anywhere; no 404s in the network log; no freeze over a few seconds during the run (record times).

---

## 5. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Inserting the DoAction at the wrong point (before the classes exist, or after `Game.init` has already run) | Verify the frame and tag order by disassembly. The patch checks for the classes itself and retries on the next frame if they're missing. |
| My assembler emits subtly wrong bytecode | Round-trip it through the disassembler, test in both Ruffle and Adobe Flash Player, and optionally cross-check in JPEXS. |
| Ruffle `SharedObject` key changes between Ruffle versions | Ruffle is pinned. The export/import feature gives a manual backup. |
| The cause of the 15 s freeze isn't on the suspect list | Phase 3 measures before fixing. Don't "fix" blind. |
| Load replays nugget alerts or misbehaves in edge cases | Covered by the Phase 6 checklist. Fix with a targeted override if seen. |

## 6. Decisions I need from you
1. **Targets:** browser (Ruffle) as the main target, plus the patched SWF working in the bundled standalone player? *(Recommended: both. The SharedObject approach covers both at no extra cost.)*
2. **Downloads:** OK to fetch the Ruffle web build (npm `@ruffle-rs/ruffle`, pinned)? And optionally JPEXS FFDec as a compiler and verifier, or should I stick to my own Python assembler?
3. **Save slots:** one slot, as in the original, or a few named slots?
4. **Optional extras:** autosave on sleep, export/import save buttons, replacement billboard art, GitHub Pages publishing. Which ones do you want?
