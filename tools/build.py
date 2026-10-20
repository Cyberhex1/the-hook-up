"""Build the playable game into dist/.

    python -I tools/fetch_deps.py     # once: pinned Ruffle + JPEXS FFDec into .tools/
    python -I tools/build.py          # patched build
    python -I tools/build.py --no-patch   # original SWF, for comparison

dist/ then holds:
  index.html + ruffle/   browser version (serve with play_in_browser.py)
  hookup.swf             patched game, also playable in flashplayer_32_sa.exe
  everything else        the original assets, unchanged (except billboards.xml)
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "The Hook-Up"           # original download, never modified
PATCH = ROOT / "patch"                # ActionScript sources imported into hookup.swf
WEB = ROOT / "web"
TOOLS = ROOT / ".tools"
DIST = ROOT / "dist"

# files from the original download that the build doesn't ship as-is
SKIP = {"hookup.html", "hookup.swf", "0.EXTRACT-EVERYTHING.txt", "1.README.txt"}


def run(cmd):
    print("+", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True)


def copy_assets():
    for src in GAME.rglob("*"):
        rel = src.relative_to(GAME)
        if src.is_dir() or rel.as_posix() in SKIP:
            continue
        dst = DIST / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    # content overrides (same relative paths as the original)
    overrides = PATCH / "content"
    for src in overrides.rglob("*"):
        if src.is_file():
            dst = DIST / src.relative_to(overrides)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            print(f"override {src.relative_to(overrides).as_posix()}")


def build_swf(patched):
    out = DIST / "hookup.swf"
    if not patched:
        shutil.copy2(GAME / "hookup.swf", out)
        return
    ffdec = TOOLS / "ffdec" / "ffdec.jar"
    if not ffdec.exists():
        sys.exit("JPEXS FFDec missing: run  python -I tools/fetch_deps.py")
    scripts = sorted((PATCH / "scripts").rglob("*.as"))
    run(["java", "-jar", ffdec, "-importScript", GAME / "hookup.swf", out, PATCH])
    # every imported .as file replaces exactly one script tag; nothing else may change
    run([sys.executable, "-I", ROOT / "tools" / "swfcheck.py", GAME / "hookup.swf", out,
         "--expect", str(len(scripts))])


def copy_web():
    shutil.copy2(WEB / "index.html", DIST / "index.html")
    for name in ("play_in_browser.py", "Play in Flash Player.bat", "README.txt"):
        shutil.copy2(WEB / name, DIST / name)
    ruffle_src = TOOLS / "ruffle" / "package"
    if not ruffle_src.exists():
        sys.exit("Ruffle missing: run  python -I tools/fetch_deps.py")
    ruffle_dst = DIST / "ruffle"
    ruffle_dst.mkdir()
    for f in ruffle_src.iterdir():
        if f.suffix in (".js", ".wasm") or f.name.startswith("LICENSE"):
            shutil.copy2(f, ruffle_dst / f.name)


def main():
    patched = "--no-patch" not in sys.argv
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    copy_assets()
    build_swf(patched)
    copy_web()
    print(f"built {'patched' if patched else 'ORIGINAL'} game in {DIST}")


if __name__ == "__main__":
    main()
