# The Hook-Up 1.0: standalone / Steam Deck edition

A self-contained desktop build of the restored game: the patched `hookup.swf` from
`dist/` (save slots, autosave, freeze and leak fixes) running in Ruffle 0.7.1 inside a
pinned Electron 44.5.1 window. Built for the Steam Deck, and also runs on Windows.

## Build

```bash
python -I tools/fetch_deps.py
```

```bash
python -I "1.0/build.py"
```

`build.py` rebuilds `dist/` with `tools/build.py` (pass `--skip-game` to reuse it), downloads
the pinned Electron runtimes into `.tools/electron-dl/` (checked by sha256), and writes
`1.0/release/`:

| Output | What it is |
|---|---|
| `TheHookUp-1.0-SteamDeck.tar.gz` | Native Linux x64 build. Run `TheHookUp.sh`. Recommended on the Deck. |
| `TheHookUp-1.0-Windows.zip` | `The Hook-Up.exe`. Runs on Windows, and on the Deck through Proton. |
| `TheHookUp-1.0-Windows/` | The same, unzipped, for testing. |

`build/` and `release/` are generated and not tracked. The player instructions are in
`src/README.txt`, which ships inside both packages.

## Saves

- The file `saves/thehookup-saves.json`, next to the exe or `TheHookUp.sh`, is the source of
  truth. It uses the same format as the web version's "Export saves", so files move between
  the two.
- On start, the page copies the file's saves into Ruffle's storage before the player exists.
  While playing, it checks storage every 0.5 s and writes any change straight to disk:
  atomically (temp file, fsync, rename), with the previous version copied to
  `saves/backups/` (the last 30 are kept).
- Ruffle writes SharedObjects by direct property assignment on `localStorage`, not
  `setItem`, which is why the page polls instead of wrapping `setItem`.
- On close, the page stops the player (Ruffle flushes storage) and writes once more before
  the window is allowed to close.
- If the game folder isn't writable, everything goes to the per-user app data folder
  instead. The menu always shows the path in use.
- The Chromium profile (`data/`) also lives next to the app, so nothing is left in the
  user's profile.

## Controls

The game is mouse-only, apart from typing a name. Controller input becomes real mouse and
keyboard events through `webContents.sendInputEvent`, so neither the game nor Ruffle
changes.

- Left stick, right stick (slow) and D-pad (nudge) move an on-screen pointer. RT and LT
  change its speed.
- A clicks.
- Y opens an on-screen keyboard.
- Start opens a pause menu (it calls Ruffle's `suspend`).
- Select shows the controls.
- A real mouse, trackpad or touch takes over automatically.

## Files

| File | Role |
|---|---|
| `src/main.js` | Electron main process: `app://` scheme, save file I/O, input injection, window, Wine detection |
| `src/preload.js` | `window.hookupDesktop` bridge |
| `src/index.html` | Page and overlay styling (menu, controls, on-screen keyboard, pointer) |
| `src/desktop.js` | Ruffle setup, save sync, controller handling |
| `src/TheHookUp.sh` | Linux launcher: sets `HOOKUP_HOME`, passes `--no-sandbox` and forces X11 |

## Testing

Start the exe with `--windowed --remote-debugging-port=9333` and drive it over the DevTools
protocol. To simulate a pad, override `navigator.getGamepads`. Turn on
`Emulation.setFocusEmulationEnabled` first: in a background window, Ruffle ignores typed
keys.

Verified on Windows:
- the controller pointer clicks through menus, character creation and the world;
- on-screen keyboard typing;
- saving to slots 1 and 2 writes the file and makes a backup;
- a fresh install with only the saves file copied in lists and loads the slot;
- quitting from the menu and from the window's close button both shut down cleanly.

The Linux tarball was checked for structure only (file modes, ELF binary, LF launcher). It
hasn't been run, because this PC's WSL distro is broken.
