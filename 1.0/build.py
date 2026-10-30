"""Build The Hook-Up 1.0, the standalone desktop / Steam Deck version.

    python -I "1.0/build.py"              # rebuild the patched game, then package
    python -I "1.0/build.py" --skip-game  # reuse the current dist/

Writes to 1.0/release/:
  TheHookUp-1.0-Windows/            The Hook-Up.exe and its files (also runs on a
  TheHookUp-1.0-Windows.zip         Steam Deck through Proton)
  TheHookUp-1.0-SteamDeck.tar.gz    native Linux build for the Steam Deck (recommended there)

The game inside is exactly dist/ from tools/build.py (the patched hookup.swf with the
save-slot and freeze fixes, plus Ruffle), wrapped in a pinned Electron runtime.
"""
import io
import json
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = HERE / "src"
DIST = ROOT / "dist"
TOOLS = ROOT / ".tools"
STAGE = HERE / "build"
RELEASE = HERE / "release"

sys.path.insert(0, str(ROOT / "tools"))
from fetch_deps import sha256  # noqa: E402

VERSION = "1.0.0"
NAME = "TheHookUp-1.0"
ELECTRON = "44.5.1"
ELECTRON_ZIPS = {
    "win32-x64": "9b382492dcfee91f8f9e92c91f7972550a1b95d2299cac72279dab33a600d7db",
    "linux-x64": "5bcd217611d6843ececd6c9e9c1fcd1da3ab066c43d8b1a9e4b44689a1fba6f5",
}

# dist/ files that belong to the browser / Flash Player versions only
NOT_SHIPPED = {"flashplayer_32_sa.exe", "index.html", "play_in_browser.py", "Play in Flash Player.bat", "README.txt"}


def run(cmd):
    print("+", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True)


def electron_zip(platform):
    want = ELECTRON_ZIPS[platform]
    name = f"electron-v{ELECTRON}-{platform}.zip"
    dl = TOOLS / "electron-dl"
    dl.mkdir(parents=True, exist_ok=True)
    path = dl / name
    if not path.exists() or sha256(path) != want:
        url = f"https://github.com/electron/electron/releases/download/v{ELECTRON}/{name}"
        print(f"downloading {url}")
        with urllib.request.urlopen(url) as r, open(path, "wb") as f:
            shutil.copyfileobj(r, f)
    got = sha256(path)
    if got != want:
        sys.exit(f"checksum mismatch for {path}: {got}")
    return path


def stage_app():
    """The Electron app folder: main process, preload, and the game with its page."""
    if STAGE.exists():
        shutil.rmtree(STAGE)
    app = STAGE / "app"
    game = app / "game"
    game.mkdir(parents=True)
    for f in ("main.js", "preload.js"):
        shutil.copy2(SRC / f, app / f)
    (app / "package.json").write_text(json.dumps({
        "name": "the-hook-up",
        "productName": "The Hook-Up",
        "version": VERSION,
        "description": "The Hook-Up (The N, 2007), restored standalone edition",
        "main": "main.js",
    }, indent=2) + "\n")
    for src in DIST.rglob("*"):
        rel = src.relative_to(DIST)
        if src.is_dir() or rel.as_posix() in NOT_SHIPPED:
            continue
        dst = game / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    for f in ("index.html", "desktop.js"):
        shutil.copy2(SRC / f, game / f)
    return app


def build_windows(app):
    out = RELEASE / f"{NAME}-Windows"
    with zipfile.ZipFile(electron_zip("win32-x64")) as z:
        z.extractall(out)
    (out / "electron.exe").rename(out / "The Hook-Up.exe")
    (out / "resources" / "default_app.asar").unlink(missing_ok=True)
    shutil.copytree(app, out / "resources" / "app")
    shutil.copy2(SRC / "README.txt", out / "README.txt")
    archive = RELEASE / f"{NAME}-Windows.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in sorted(out.rglob("*")):
            z.write(f, Path(NAME) / f.relative_to(out))
    print(f"windows: {out}\n         {archive}")


def build_linux(app):
    """A tar.gz, so the executable bits survive being built on Windows."""
    archive = RELEASE / f"{NAME}-SteamDeck.tar.gz"
    top = "TheHookUp"

    def add_bytes(tar, name, data, mode):
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mode = mode
        info.mtime = int(Path(__file__).stat().st_mtime)
        tar.addfile(info, fileobj=io.BytesIO(data))

    with tarfile.open(archive, "w:gz", compresslevel=6) as tar:
        with zipfile.ZipFile(electron_zip("linux-x64")) as z:
            for entry in z.infolist():
                if entry.is_dir() or entry.filename == "resources/default_app.asar":
                    continue
                mode = (entry.external_attr >> 16) & 0o777 or 0o644
                name = "hookup" if entry.filename == "electron" else entry.filename
                if name == "hookup":
                    mode = 0o755
                add_bytes(tar, f"{top}/app/{name}", z.read(entry), mode)
        for f in sorted(app.rglob("*")):
            if f.is_file():
                add_bytes(tar, f"{top}/app/resources/app/{f.relative_to(app).as_posix()}", f.read_bytes(), 0o644)
        script = (SRC / "TheHookUp.sh").read_bytes().replace(b"\r\n", b"\n")
        add_bytes(tar, f"{top}/TheHookUp.sh", script, 0o755)
        add_bytes(tar, f"{top}/README.txt", (SRC / "README.txt").read_bytes(), 0o644)
    print(f"steam deck: {archive}")


def main():
    if "--skip-game" not in sys.argv:
        run([sys.executable, "-I", ROOT / "tools" / "build.py"])
    if not (DIST / "hookup.swf").exists() or not (DIST / "ruffle").exists():
        sys.exit("dist/ is missing: run  python -I tools/build.py")
    app = stage_app()
    # empty release/ rather than delete it, so an open Explorer window or shell there doesn't break the build
    RELEASE.mkdir(exist_ok=True)
    for old in RELEASE.iterdir():
        shutil.rmtree(old) if old.is_dir() else old.unlink()
    build_windows(app)
    build_linux(app)
    print("done")


if __name__ == "__main__":
    main()
