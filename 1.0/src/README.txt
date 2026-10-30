The Hook-Up 1.0 (The N / THUP Games, v1.5.2, 2007) - standalone edition
==========================================================================

A self-contained version of the restored game for Windows and the Steam Deck.
No browser, no Flash Player, no internet needed. Saves are written to a file in
the "saves" folder right next to the game.


Steam Deck (native, recommended)
--------------------------------
1. Switch to Desktop Mode (Steam button > Power > Switch to Desktop).
2. Copy TheHookUp-1.0-SteamDeck.tar.gz to the Deck, right-click it in Dolphin
   and choose Extract > Extract archive here. You get a "TheHookUp" folder.
   Put it somewhere permanent, for example /home/deck/Games/TheHookUp.
3. Open Steam (still in Desktop Mode): Games > Add a Non-Steam Game to My
   Library > Browse..., set the file type filter to "All Files", pick
   TheHookUp/TheHookUp.sh and click Add Selected Programs.
4. Go back to Game Mode and start "TheHookUp.sh" from your library. You can
   rename it to "The Hook-Up" in its Properties.
   Don't set a Compatibility tool (Proton) for this one: it's a Linux build.
   Leave the controller layout on Steam's default "Gamepad" template.

Steam Deck using the .exe (through Proton)
------------------------------------------
Extract TheHookUp-1.0-Windows.zip, add "The Hook-Up.exe" as a non-Steam game,
then in its Properties > Compatibility, tick "Force the use of a specific
Steam Play compatibility tool" and pick Proton Experimental. The native build
above starts faster and is the better choice on the Deck.

Windows
-------
Extract TheHookUp-1.0-Windows.zip anywhere you can write to (not Program
Files), open the folder and run "The Hook-Up.exe".


Controls
--------
The game is played with a pointer. The controller moves an on-screen pointer.

  Left stick       move the pointer
  Right stick      move the pointer slowly (for small buttons)
  D-pad            nudge the pointer
  A                click (hold to drag)
  RT / LT (hold)   faster / slower pointer
  R3               center the pointer
  Y                on-screen keyboard (click the name box first, then type)
                   A type, B delete, X space, LB shift, Y close
  Start            menu: resume, controls, fullscreen, back up saves, quit
  Select           controls screen
  Touchscreen      tap to click; the trackpads and a mouse work too

Keyboard: Esc menu, F1 controls, F11 fullscreen.
Steam's own keyboard (Steam + X) also works for typing.


Saving
------
- Save with Save/Quit on the in-game toolbar, then pick one of three slots.
  You can save while walking around town, but not inside a place or during a
  conversation or scene.
- The game also autosaves every morning when you wake up, in its own slot.
- Load from the title screen.
- Every save is written straight to disk. A "Saved to disk" message shows in
  the top-right corner each time. If writing ever fails, a red message says
  so and the game keeps retrying.

Where the saves are:
  saves/thehookup-saves.json        all slots and the autosave
  saves/backups/                    the previous 30 versions, made automatically
                                    (and any you make with "Back up saves now")

To back up or move your saves, copy the saves folder. To restore an older
backup, quit the game and copy that backup over saves/thehookup-saves.json.
A file from the web version's "Export saves" button works here too: name it
thehookup-saves.json and put it in the saves folder.

If the game folder isn't writable, the saves go to your user folder instead
(Windows: %APPDATA%\The Hook-Up\saves, Linux: ~/.config/The Hook-Up/saves).
The menu always shows the exact path in use.


Troubleshooting
---------------
- Black or blank window: start it with --software-render (add it to the
  launch options in Steam, or to a Windows shortcut).
- Start in a window instead of fullscreen: --windowed, or turn fullscreen off
  in the menu (the setting is remembered).
- Only one copy of the game runs at a time, so two windows can never
  overwrite each other's saves.
