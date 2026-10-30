"""Build the TheHookupRevived website (Cloudflare Pages) into dist-site/.

    python -I tools/build_site.py               # rebuild dist/ with tools/build.py, then the site
    python -I tools/build_site.py --skip-game   # reuse the existing dist/
    python -I tools/build_site.py --deploy      # build, then upload with wrangler

The site is the patched game from dist/ (without the Windows-only Flash Player files)
plus site/ (the page, the save manager, Cloudflare _headers) and the project icon.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SITE = ROOT / "site"
OUT = ROOT / "dist-site"
PROJECT = "thehookuprevived"           # Cloudflare Pages project: thehookuprevived.pages.dev

# dist/ files that only make sense in the downloadable folder
SKIP = {"index.html", "flashplayer_32_sa.exe", "Play in Flash Player.bat", "play_in_browser.py", "README.txt"}
MAX_FILE = 25 * 1024 * 1024            # Cloudflare Pages per-file limit


def run(cmd):
    print("+", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True)


def main():
    if "--skip-game" not in sys.argv:
        run([sys.executable, "-I", ROOT / "tools" / "build.py"])
    if not (DIST / "hookup.swf").exists():
        sys.exit("dist/ is missing: run  python -I tools/build.py")
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(DIST, OUT, ignore=lambda d, names: [n for n in names if Path(d) == DIST and n in SKIP])
    for src in SITE.iterdir():
        shutil.copy2(src, OUT / src.name)
    for name in ("icon.png", "icon.svg"):
        shutil.copy2(ROOT / "assets" / name, OUT / name)

    too_big = [p for p in OUT.rglob("*") if p.is_file() and p.stat().st_size > MAX_FILE]
    if too_big:
        sys.exit("over the 25 MiB Pages limit: " + ", ".join(str(p.relative_to(OUT)) for p in too_big))
    files = [p for p in OUT.rglob("*") if p.is_file()]
    print(f"built {len(files)} files, {sum(p.stat().st_size for p in files) / 1e6:.1f} MB in {OUT}")

    if "--deploy" in sys.argv:
        npx = shutil.which("npx") or sys.exit("npx not found: install Node.js")
        run([npx, "wrangler", "pages", "deploy", OUT, "--project-name", PROJECT, "--branch", "main",
             "--commit-dirty=true"])


if __name__ == "__main__":
    main()
