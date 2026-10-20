The Hook-Up (The N / THUP Games, v1.5.2, 2007) - restored edition
=====================================================================

There are two ways to play. Both use the same patched hookup.swf.

1) In your browser (recommended)
   - Double-click play_in_browser.py (needs Python 3), or run:
         python play_in_browser.py
   - Your browser opens http://127.0.0.1:8770/ . Keep the console window open
     while you play.
   - Browsers can't run the game straight from index.html (file://), which is
     why the small local server is needed.

2) In the bundled Adobe Flash Player
   - Double-click "Play in Flash Player.bat", or open flashplayer_32_sa.exe
     and choose File > Open > hookup.swf.

Saving
------
- Save/Quit on the in-game toolbar opens a list of three save slots. You can
  save while walking around town, but not inside a place or during a
  conversation or scene. Picking a filled slot asks for a second click
  before it's replaced.
- The game autosaves every morning when you wake up, into its own
  "Autosave" slot.
- Load Game on the title screen lists all slots, including the autosave.
- Where saves are kept:
    browser:      in that browser's storage for http://127.0.0.1:8770
                  (use Export saves / Import saves under the game to back
                  them up or move them to another browser or computer)
    Flash Player: %APPDATA%\Macromedia\Flash Player\#SharedObjects\...\thehookup.sol
  Browser saves and Flash Player saves are separate.

What changed from the original
------------------------------
- Saving and loading work. The original sent saves to TheN.com
  (save.php / loadsavexml.php), which no longer exists. Clicking Save used to
  navigate away and lose your game, and Load sent you to a login page.
- Pending text-message dates no longer block saving; they're saved too.
- Fixed the game initializing twice at startup, which loaded all content
  twice and caused a "Nugget Not Found" error popup on the title screen.
- Fixed a bug where, after loading a save, every map change stacked another
  repeating timer and re-ran the load step.
- Fixed listeners that piled up with every map change and scripted-event
  replay, slowing the game down over long sessions.
- Fixed "OK"-only messages (like "You can not save now.") unfreezing the
  game in the middle of a conversation or scene.
- The town billboard no longer opens google.com (a leftover placeholder).
- Debug logging and developer error popups are off.
- Browser version: current Ruffle (0.7.1) with text editing that supports
  select-all and a visible cursor in the name field, and the correct
  770x560 size.

Test switches (browser only): add ?debug=1 to the address to log to the
browser console, or ?fasttime=1 to run the game clock 30x faster.
