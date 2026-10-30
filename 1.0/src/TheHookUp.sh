#!/bin/sh
# The Hook-Up 1.0 launcher for Steam Deck / Linux.
# Saves go to the "saves" folder next to this script.
HERE="$(cd "$(dirname "$0")" && pwd)"
export HOOKUP_HOME="$HERE"
# X11 works in both Game Mode (gamescope) and Desktop Mode; Wayland only where there's no X.
if [ -n "$DISPLAY" ]; then PLATFORM=x11; else PLATFORM=auto; fi
# --no-sandbox: Chromium's sandbox helper needs root setup that a game folder can't
# have; the window only ever shows this folder's own files.
exec "$HERE/app/hookup" --no-sandbox --ozone-platform="$PLATFORM" "$@"
