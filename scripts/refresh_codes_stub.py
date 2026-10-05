#!/usr/bin/env python3
"""Validate data/codes.json. Remote Mystery Gift fetch is not wired yet."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "codes.json"
REQUIRED = ("code", "contentZh", "games", "status")


def main():
    data = json.loads(PATH.read_text(encoding="utf-8"))
    if data.get("schema") != "codes.v1":
        sys.exit(f"unexpected schema: {data.get('schema')}")
    codes = data.get("codes")
    if not isinstance(codes, list) or not codes:
        sys.exit("codes must be a non-empty list")
    for i, row in enumerate(codes):
        missing = [key for key in REQUIRED if key not in row]
        if missing:
            sys.exit(f"codes[{i}] missing {missing}")
        if row["status"] not in ("active", "expired"):
            sys.exit(f"codes[{i}].status must be active or expired")
        if not isinstance(row["games"], list):
            sys.exit(f"codes[{i}].games must be a list")
    print(f"codes.json ok ({len(codes)} rows). No remote source configured; edit the JSON or replace this stub.")


if __name__ == "__main__":
    main()
