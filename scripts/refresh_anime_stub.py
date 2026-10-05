#!/usr/bin/env python3
"""Validate data/anime-subs.json. Weekly platform scrape is not wired yet."""
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
        if not isinstance(row["platforms"], list):
            sys.exit(f"items[{i}].platforms must be a list")
    print(f"anime-subs.json ok ({len(items)} rows). Scraper not configured; this stub only checks the schema.")


if __name__ == "__main__":
    main()
