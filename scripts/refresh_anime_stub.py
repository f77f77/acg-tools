#!/usr/bin/env python3
"""Validate data/anime-subs.json.

This file is the 中文字幕 overlay merged into 新番表. It is not a separate page.
Matching is done in the browser (bgmId, then normalized title/aliases).
Weekly platform scrape is not wired yet.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "anime-subs.json"
REQUIRED = ("title", "platforms", "regionNote", "scheduleHkt", "source")


def main():
    data = json.loads(PATH.read_text(encoding="utf-8"))
    if data.get("schema") != "anime-subs.v1":
        sys.exit(f"unexpected schema: {data.get('schema')}")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        sys.exit("items must be a non-empty list")
    for i, row in enumerate(items):
        missing = [key for key in REQUIRED if not row.get(key)]
        if missing:
            sys.exit(f"items[{i}] missing {missing}")
        if not isinstance(row["platforms"], list) or not row["platforms"]:
            sys.exit(f"items[{i}].platforms must be a non-empty list")
        aliases = row.get("aliases")
        if aliases is not None and (
            not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases)
        ):
            sys.exit(f"items[{i}].aliases must be a list of strings")
        if "bgmId" in row and row["bgmId"] is not None and not isinstance(row["bgmId"], int):
            sys.exit(f"items[{i}].bgmId must be an integer")
    print(
        f"anime-subs.json ok ({len(items)} rows). "
        "Overlay for 新番表; scraper not configured."
    )


if __name__ == "__main__":
    main()
