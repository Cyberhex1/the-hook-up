"""Serve this folder on http://127.0.0.1:8770/ and open the game in your browser.

Browsers won't run the game straight from a file:// path, so this starts a small
local web server. Close this window (or press Ctrl+C) to stop it.
"""
import functools
import http.server
import mimetypes
import os
import sys
import threading
import webbrowser

PORT = 8770
HERE = os.path.dirname(os.path.abspath(__file__))

# Windows' registry often lacks this; Ruffle loads much faster with the right type.
mimetypes.add_type("application/wasm", ".wasm")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm"}

    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    def end_headers(self):
        # always serve fresh files, so a rebuilt game is picked up on reload
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    handler = functools.partial(Handler, directory=HERE)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"The Hook-Up is running at {url}")
    print("Keep this window open while you play. Press Ctrl+C to stop.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
