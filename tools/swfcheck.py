"""Compare two SWFs tag by tag and report what changed.

    python -I tools/swfcheck.py original.swf patched.swf [--expect N]

Tags are compared by (code, payload), so differences in how the length header is
encoded don't count as changes. With --expect N it exits non-zero unless exactly N
tags differ, so the build fails if the patch touched anything it shouldn't have.
"""
import difflib
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swflib import TAGS, iter_tags, load, skip_rect


def header(b):
    end = skip_rect(b, 0)
    return b[:end + 4]  # rect + frame rate + frame count


def tags(b):
    out = []
    for code, data, _ in iter_tags(b, skip_rect(b, 0) + 4, len(b)):
        out.append((code, bytes(data)))
    return out


def label(tag):
    code, data = tag
    name = TAGS.get(code, str(code))
    if code in (39, 59) and len(data) >= 2:
        name += f"#{struct.unpack('<H', data[:2])[0]}"
    return f"{name}({len(data)}b)"


def main():
    args = sys.argv[1:]
    expect = None
    if "--expect" in args:
        i = args.index("--expect")
        expect = int(args[i + 1])
        del args[i:i + 2]
    va, _, a = load(args[0])
    vb, _, b = load(args[1])
    if va != vb or header(a) != header(b):
        sys.exit(f"header differs (version {va} vs {vb})")
    ta, tb = tags(a), tags(b)
    changes = 0
    sm = difflib.SequenceMatcher(a=ta, b=tb, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            continue
        changes += max(i2 - i1, j2 - j1)
        print(f"{op}: {[label(t) for t in ta[i1:i2]]} -> {[label(t) for t in tb[j1:j2]]}")
    print(f"{len(ta)} tags vs {len(tb)} tags, {changes} changed")
    if expect is not None and changes != expect:
        sys.exit(f"expected {expect} changed tags, found {changes}")


if __name__ == "__main__":
    main()
