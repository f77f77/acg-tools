#!/usr/bin/env python3
"""Fetch Bangumi calendar and write slim season.json for GitHub Pages."""
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BGM = "https://api.bgm.tv/calendar"
UA = "ACG-Tools/1.0 (personal; https://github.com/f77f77/acg-tools)"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "season.json"


def slim(raw):
    days = []
    for day in raw or []:
        items = []
        for it in day.get("items") or []:
            images = it.get("images") or {}
            cover = images.get("common") or images.get("medium") or images.get("large") or ""
            rating = it.get("rating") or {}
            sid = it.get("id")
            url = it.get("url") or (f"https://bgm.tv/subject/{sid}" if sid else "")
            items.append({
                "id": sid,
                "url": str(url).replace("http://", "https://"),
                "name": it.get("name") or "",
                "name_cn": it.get("name_cn") or "",
                "air_date": it.get("air_date") or "",
                "images": {"common": str(cover).replace("http://", "https://")},
                "rating": {"score": rating.get("score") or 0},
            })
        days.append({"weekday": day.get("weekday") or {}, "items": items})
    return {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": BGM,
        "days": days,
    }


def main():
    req = urllib.request.Request(BGM, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = json.loads(res.read().decode("utf-8"))
    payload = slim(raw)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(d["items"]) for d in payload["days"])
    print(f"wrote {OUT} ({n} titles)")


if __name__ == "__main__":
    main()
