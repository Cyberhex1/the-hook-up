"""Download the pinned build dependencies into .tools/ and verify their checksums.

    python -I tools/fetch_deps.py

Ruffle (web player, shipped in dist/ruffle) and JPEXS FFDec (used at build time to
compile the ActionScript 2 patch into hookup.swf). Both are pinned by version and sha256.
"""
import hashlib
import shutil
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / ".tools"

DEPS = {
    "ruffle": {
        "url": "https://registry.npmjs.org/@ruffle-rs/ruffle/-/ruffle-0.7.1.tgz",
        "file": "ruffle-rs-ruffle-0.7.1.tgz",
        "sha256": "dc9e7407549a91accc41a14932b0b9d9a9d51a3742ce6f020888c8a76682b157",
    },
    "ffdec": {
        "url": "https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version26.3.0/ffdec_26.3.0.zip",
        "file": "ffdec_26.3.0.zip",
        "sha256": "35f4930eb7c380afe66f2117f90b006deac0631473ad7500bb39c78f68645ecd",
    },
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(name, dep):
    dl_dir = TOOLS / f"{name}-dl"
    dl_dir.mkdir(parents=True, exist_ok=True)
    archive = dl_dir / dep["file"]
    if not archive.exists() or sha256(archive) != dep["sha256"]:
        print(f"downloading {dep['url']}")
        with urllib.request.urlopen(dep["url"]) as r, open(archive, "wb") as f:
            shutil.copyfileobj(r, f)
    got = sha256(archive)
    if got != dep["sha256"]:
        sys.exit(f"checksum mismatch for {archive}: {got}")

    out = TOOLS / name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    if archive.suffix == ".tgz":
        with tarfile.open(archive) as t:
            t.extractall(out, filter="data")
    else:
        with zipfile.ZipFile(archive) as z:
            z.extractall(out)
    print(f"{name}: ok -> {out}")


if __name__ == "__main__":
    for name, dep in DEPS.items():
        fetch(name, dep)
