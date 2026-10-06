#!/usr/bin/env python3
"""Validate data/anime-subs.json (and the bgm id cache, if present).

Rows are produced by scripts/sync_anime_subs.py from Notion. This script
does not fetch. Matching in the browser still uses bgmId, then normalised
title / aliases. schema stays anime-subs.v1; premiere, status, notionId,
bgmIdSource and top-level unresolved are additive.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "anime-subs.json"
CACHE = ROOT / "data" / "anime-bgm-cache.json"
SOURCES = {"notion", "url", "season", "search", "none"}
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}$")


def fail(message):
    sys.exit(message)


def check_subs(data):
    if data.get("schema") != "anime-subs.v1":
        fail(f"unexpected schema: {data.get('schema')}")
    items = data.get("items")
    if not isinstance(items, list):
        fail("items must be a list")
    unresolved = data.get("unresolved", [])
    if not isinstance(unresolved, list):
        fail("unresolved must be a list")
    for i, row in enumerate(unresolved):
        if not isinstance(row, dict) or not (row.get("title") or row.get("titleJa")):
            fail(f"unresolved[{i}] needs title or titleJa")
    for i, row in enumerate(items):
        if not isinstance(row, dict):
            fail(f"items[{i}] must be an object")
        if not isinstance(row.get("title"), str) or not row["title"].strip():
            fail(f"items[{i}].title must be a non-empty string")
        platforms = row.get("platforms")
        if not isinstance(platforms, list) or not platforms:
            fail(f"items[{i}].platforms must be a non-empty list")
        if not all(isinstance(p, str) and p for p in platforms):
            fail(f"items[{i}].platforms must be non-empty strings")
        aliases = row.get("aliases")
        if aliases is not None and (
            not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases)
        ):
            fail(f"items[{i}].aliases must be a list of strings")
        if "bgmId" in row and row["bgmId"] is not None and type(row["bgmId"]) is not int:
            fail(f"items[{i}].bgmId must be an integer")
        if "bgmIdSource" in row and row["bgmIdSource"] not in SOURCES:
            fail(f"items[{i}].bgmIdSource must be one of {sorted(SOURCES)}")
        if "sample" in row and not isinstance(row["sample"], bool):
            fail(f"items[{i}].sample must be a boolean")
        source = row.get("source")
        if source not in (None, "") and (
            not isinstance(source, str) or not source.startswith(("http://", "https://"))
        ):
            fail(f"items[{i}].source must be an http(s) url or omitted")
        for key in ("regionNote", "scheduleHkt", "subtitle", "status", "titleJa", "notionId"):
            if key in row and row[key] is not None and not isinstance(row[key], str):
                fail(f"items[{i}].{key} must be a string")
        premiere = row.get("premiere")
        if premiere not in (None, "") and (not isinstance(premiere, str) or not DATE_RE.fullmatch(premiere)):
            fail(f"items[{i}].premiere must be YYYY-MM-DD")
    print(f"anime-subs.json ok ({len(items)} rows, unresolved {len(unresolved)}).")


def check_cache(data):
    if data.get("schema") != "anime-bgm-cache.v1":
        fail(f"unexpected cache schema: {data.get('schema')}")
    entries = data.get("entries")
    if not isinstance(entries, dict):
        fail("cache entries must be an object")
    for key, entry in entries.items():
        if not isinstance(entry, dict):
            fail(f"cache[{key}] must be an object")
        bgm_id = entry.get("bgmId")
        if bgm_id is not None and type(bgm_id) is not int:
            fail(f"cache[{key}].bgmId must be an integer or null")
    print(f"anime-bgm-cache.json ok ({len(entries)} entries).")


def main():
    check_subs(json.loads(PATH.read_text(encoding="utf-8")))
    if CACHE.exists():
        check_cache(json.loads(CACHE.read_text(encoding="utf-8")))


if __name__ == "__main__":
    main()
