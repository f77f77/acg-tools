#!/usr/bin/env python3
"""Deprecated: cutting hundreds of per-species PNGs is no longer supported.

Delegates to scripts/build-sprite-atlas.py (master sheet + CSS → atlas).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    print(
        "cut-sprite-poke3-templates.py is deprecated.\n"
        "Templates are in-memory crops from public/sprites/sprite_poke.png,\n"
        "keyed by nationalDex (public/sprites/atlas.json).\n"
        "Delegating to scripts/build-sprite-atlas.py …\n",
        file=sys.stderr,
    )
    cmd = [sys.executable, str(ROOT / "scripts/build-sprite-atlas.py"), *sys.argv[1:]]
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
