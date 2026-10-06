#!/usr/bin/env python3
"""Sync data/events.json events[] from the Notion database 「香港ACG情報看板」.

Stdlib only. Without NOTION_TOKEN the script exits 0 and leaves the JSON
untouched, so forks and pull-request CI stay green. deadlines[] are kept
from the existing file; rows marked sample or example are dropped.

  python3 scripts/sync_events.py
  python3 scripts/sync_events.py --validate
  python3 scripts/sync_events.py --fixture scripts/fixtures/notion_events_sample.json --offline --check

Status is recomputed from the date range in Hong Kong time when dates exist.
Notion page URLs are never written. The 2022-06-28 query endpoint does not
send the data source id (documented in data/README.md).
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "events.json"
DEFAULT_DB_ID = "2f23c58c-f253-4aa4-ad5d-3ac848727cc6"
# Data source id 5378fc90-4211-40d6-bdac-041980476c56 is documented in data/README.md.
NOTION_VERSION = "2022-06-28"
UA = "f77f77/acg-tools (+https://github.com/f77f77/acg-tools)"
HKT = timezone(timedelta(hours=8))
SCHEMA = "events.v2"
NOTE_LIMIT = 120
RECENT_DAYS = 7
STATUSES = ("即將開始", "進行中", "已完結")
ARCHIVE = "封存"
MAPS = "https://www.google.com/maps/search/?api=1&query="
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NOTION_URL_RE = re.compile(r"https?://([^/]*\.)?(notion\.so|notion\.site)(/|$)", re.I)
NOTE = (
    "活動由 Notion「香港ACG情報看板」每日同步（香港時間）。"
    "狀態會按日期重算：開始至結束當日係進行中，未開始係即將開始，完結七日內先保留。"
    "周邊截止仍然手改 deadlines[]；標成示例嘅截止唔會保留。"
)


def hkt_today():
    return datetime.now(HKT).strftime("%Y-%m-%d")


def page_hash(page_id):
    return hashlib.sha256(str(page_id).encode("utf-8")).hexdigest()[:16]


def parse_day(value):
    raw = str(value or "")
    if not DATE_RE.fullmatch(raw):
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def to_hkt_date(value):
    """Calendar date in HKT. Date-only values stay as written; datetimes convert."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    if DATE_RE.fullmatch(raw):
        return raw
    text = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        head = raw[:10]
        return head if DATE_RE.fullmatch(head) else ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=HKT)
    return dt.astimezone(HKT).strftime("%Y-%m-%d")


def recompute_status(notion_status, start, end, today):
    start_d = parse_day(start) or parse_day(end)
    end_d = parse_day(end) or start_d
    today_d = parse_day(today)
    if not start_d or not end_d or not today_d:
        return notion_status if notion_status in STATUSES else ""
    if today_d < start_d:
        return "即將開始"
    if today_d > end_d:
        return "已完結"
    return "進行中"


def include_event(notion_status, status, start, end, today):
    if notion_status == ARCHIVE or notion_status not in STATUSES:
        return False
    if status not in STATUSES:
        return False
    if status in ("即將開始", "進行中"):
        return True
    end_d = parse_day(end) or parse_day(start)
    today_d = parse_day(today)
    if not end_d or not today_d:
        return False
    delta = (today_d - end_d).days
    return 0 <= delta <= RECENT_DAYS


def trim_note(text):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= NOTE_LIMIT:
        return text
    return text[: NOTE_LIMIT - 1].rstrip() + "…"


def maps_url(place):
    place = (place or "").strip()
    if not place:
        return ""
    return MAPS + quote(place, safe="-_.!~*'()")


def safe_http(url):
    url = (url or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return ""
    if NOTION_URL_RE.search(url):
        return ""
    return url


def is_sample_deadline(row):
    if not isinstance(row, dict):
        return True
    if row.get("sample") is True or row.get("example") is True:
        return True
    return False


def kept_deadlines(rows):
    return [row for row in (rows or []) if not is_sample_deadline(row)]


def self_test():
    errors = []

    def check(cond, message):
        if not cond:
            errors.append(message)

    today = "2026-10-06"
    check(to_hkt_date("2026-10-05T20:00:00.000Z") == "2026-10-06", "UTC evening should be next HKT day")
    check(to_hkt_date("2026-10-05T20:00:00.000+08:00") == "2026-10-05", "+08 datetime should stay that day")
    check(to_hkt_date("2026-10-11") == "2026-10-11", "date-only should not shift")
    check(to_hkt_date("2026-10-06T00:30:00") == "2026-10-06", "naive datetime should be read as HKT")
    check(
        recompute_status("即將開始", "2026-10-01", "2026-10-10", today) == "進行中",
        "ongoing window should override 即將開始",
    )
    check(
        recompute_status("進行中", "2026-10-12", "2026-10-12", today) == "即將開始",
        "future start should override 進行中",
    )
    check(recompute_status("進行中", "2026-10-06", "2026-10-06", today) == "進行中", "today is still 進行中")
    check(recompute_status("即將開始", "", "", today) == "即將開始", "no dates keep Notion status")
    check(include_event("封存", "進行中", "2026-10-01", "2026-10-10", today) is False, "封存 must be excluded")
    check(
        include_event("已完結", "已完結", "2026-09-01", "2026-09-29", today) is True,
        "ended 7 days ago should stay",
    )
    check(
        include_event("已完結", "已完結", "2026-09-01", "2026-09-28", today) is False,
        "ended 8 days ago should drop",
    )
    check(
        include_event("即將開始", "已完結", "2026-08-01", "2026-09-01", today) is False,
        "stale 即將開始 that already ended should drop",
    )
    long = "甲" * 150
    trimmed = trim_note(long)
    check(trimmed == ("甲" * 119) + "…" and len(trimmed) == NOTE_LIMIT, f"trim → {trimmed!r}")
    check(trim_note("甲" * 120) == "甲" * 120, "120 chars should stay")
    check(trim_note("  a \n b ") == "a b", "whitespace should collapse")
    check(
        maps_url("銅鑼灣希慎廣場") == MAPS + "%E9%8A%85%E9%91%BC%E7%81%A3%E5%B8%8C%E6%85%8E%E5%BB%A3%E5%A0%B4",
        "maps query encoding",
    )
    check(maps_url("  ") == "", "blank place has no map")
    check(page_hash("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") == "303617b9730210ef", "stable page hash")
    kept = kept_deadlines(
        [
            {"id": "a", "sample": False},
            {"id": "b", "sample": True},
            {"id": "c", "example": True, "sample": False},
            "nope",
        ]
    )
    check([row["id"] for row in kept] == ["a"], f"deadlines kept {kept!r}")

    page = {
        "object": "page",
        "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "url": "https://www.notion.so/secret-page",
        "properties": {
            "活動名": {"type": "title", "title": [{"plain_text": "測試"}]},
            "狀態": {"type": "select", "select": {"name": "即將開始"}},
            "日期": {"type": "date", "date": {"start": "2026-10-01", "end": "2026-10-10"}},
            "地點": {"type": "rich_text", "rich_text": [{"plain_text": "銅鑼灣希慎廣場"}]},
            "來源連結": {"type": "url", "url": "https://www.notion.so/not-this"},
            "備註": {"type": "rich_text", "rich_text": [{"plain_text": long}]},
            "重點IP": {"type": "checkbox", "checkbox": True},
            "原狀態": {"type": "rich_text", "rich_text": [{"plain_text": "不應出現"}]},
            "IP／作品": {
                "type": "multi_select",
                "multi_select": [{"name": "原神"}, {"name": "原神"}, {"name": "星鐵"}],
            },
        },
    }
    row = parse_page(page, today)
    check(row is not None and row["include"] and row["status"] == "進行中", f"parse row {row}")
    item = build_item(row)
    blob = json.dumps(item, ensure_ascii=False)
    check(item["id"] == "303617b9730210ef", "item id")
    check("notion.so" not in blob and "notion.site" not in blob, "notion url leaked")
    check("不應出現" not in blob, "原狀態 leaked")
    check(item["ips"] == ["原神", "星鐵"], f"ips {item['ips']}")
    check(item["sample"] is False and item["featured"] is True, "flags")
    check(item["notes"] == trimmed, "notes trim on page")
    if errors:
        for message in errors:
            print("self-test fail:", message)
        sys.exit(1)
    print("self-test ok (status, window, dates, notes, maps, deadlines)")


def prop_text(prop):
    if not isinstance(prop, dict):
        return ""
    typ = prop.get("type")
    chunks = None
    if typ == "title":
        chunks = prop.get("title")
    elif typ in ("rich_text", "text"):
        chunks = prop.get(typ) or prop.get("rich_text")
    elif typ == "select":
        sel = prop.get("select") or {}
        return str(sel.get("name") or "").strip()
    elif typ == "status":
        sel = prop.get("status") or {}
        return str(sel.get("name") or "").strip()
    elif typ == "url":
        return str(prop.get("url") or "").strip()
    else:
        for key in ("title", "rich_text"):
            if isinstance(prop.get(key), list):
                chunks = prop[key]
                break
    if not isinstance(chunks, list):
        return ""
    return "".join(str(c.get("plain_text") or "") for c in chunks if isinstance(c, dict)).strip()


def prop_multi(prop):
    if not isinstance(prop, dict):
        return []
    names = []
    for row in prop.get("multi_select") or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
    return names


def prop_checkbox(prop):
    if not isinstance(prop, dict):
        return False
    return bool(prop.get("checkbox"))


def prop_date_range(prop):
    if not isinstance(prop, dict):
        return "", ""
    date = prop.get("date")
    if not isinstance(date, dict):
        return "", ""
    return to_hkt_date(date.get("start")), to_hkt_date(date.get("end"))


def parse_page(page, today):
    if not isinstance(page, dict) or page.get("object") not in (None, "page"):
        return None
    if page.get("archived") or page.get("in_trash"):
        return None
    props = page.get("properties") or {}
    if not isinstance(props, dict):
        return None
    title = prop_text(props.get("活動名"))
    notion_id = str(page.get("id") or "").strip()
    if not title or not notion_id:
        return None
    notion_status = prop_text(props.get("狀態"))
    start, end = prop_date_range(props.get("日期"))
    verified, _end_verified = prop_date_range(props.get("最後核實日期"))
    status = recompute_status(notion_status, start, end, today)
    date = start or end
    end_date = end or start
    return {
        "notion_id": notion_id,
        "title": title,
        "notion_status": notion_status,
        "status": status,
        "category": prop_text(props.get("類別")),
        "ips": prop_multi(props.get("IP／作品")),
        "date": date,
        "end": end_date,
        "time_note": prop_text(props.get("時間備註")),
        "place": prop_text(props.get("地點")),
        "price": prop_text(props.get("票價／入場")),
        "ticket_url": safe_http(prop_text(props.get("票務連結"))),
        "ticket_note": prop_text(props.get("票務說明")),
        "source": safe_http(prop_text(props.get("來源連結"))),
        "notes": prop_text(props.get("備註")),
        "featured": prop_checkbox(props.get("重點IP")),
        "verified_at": verified,
        "include": include_event(notion_status, status, date, end_date, today),
    }


def build_item(row):
    return {
        "id": page_hash(row["notion_id"]),
        "title": row["title"],
        "status": row["status"],
        "notionStatus": row["notion_status"],
        "category": row["category"],
        "ips": list(row["ips"]),
        "date": row["date"],
        "endDate": row["end"],
        "timeNote": row["time_note"],
        "place": row["place"],
        "mapUrl": maps_url(row["place"]),
        "price": row["price"],
        "ticketUrl": row["ticket_url"],
        "ticketNote": row["ticket_note"],
        "source": row["source"],
        "notes": trim_note(row["notes"]),
        "featured": bool(row["featured"]),
        "verifiedAt": row["verified_at"],
        "sample": False,
    }


def sort_key(item):
    return (
        item.get("date") or "9999-99-99",
        item.get("endDate") or "",
        item.get("title") or "",
        item.get("id") or "",
    )


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_fixture(path):
    data = load_json(path)
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        sys.exit(f"fixture {path} must be a Notion query response with results[]")
    expect = data.get("expect") if isinstance(data.get("expect"), dict) else {}
    today = str(data.get("today") or "")
    prior = data.get("priorDeadlines") if isinstance(data.get("priorDeadlines"), list) else []
    return data["results"], expect, today, prior


def notion_query(token, db_id):
    endpoint = f"https://api.notion.com/v1/databases/{db_id}/query"
    headers = {
        "Authorization": "Bearer " + token,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        "User-Agent": UA,
    }
    results = []
    cursor = None
    for _ in range(50):
        payload = {"page_size": 100}
        if cursor:
            payload["start_cursor"] = cursor
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:500]
            sys.exit(f"Notion query failed: HTTP {exc.code} {body}")
        batch = data.get("results") or []
        if not isinstance(batch, list):
            sys.exit("Notion query response has no results list")
        results.extend(batch)
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        if not cursor:
            break
    else:
        sys.exit("Notion query pagination exceeded 50 pages")
    return results


def deadlines_from_file(path):
    data = load_json(path)
    if data.get("schema") not in ("events.v1", "events.v2"):
        sys.exit(f"unexpected schema in {path}: {data.get('schema')}")
    rows = data.get("deadlines")
    if not isinstance(rows, list):
        sys.exit(f"{path} deadlines must be a list")
    return kept_deadlines(rows)


def content_changed(path, payload):
    if not path.exists():
        return True
    try:
        old = load_json(path)
    except json.JSONDecodeError:
        return True
    if not isinstance(old, dict):
        return True
    old.pop("updatedAt", None)
    new = json.loads(json.dumps(payload, ensure_ascii=False))
    new.pop("updatedAt", None)
    return old != new


def write_payload(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_payload(pages, today, deadlines):
    items = []
    skipped = []
    for page in pages:
        row = parse_page(page, today)
        if not row:
            continue
        if not row["include"]:
            skipped.append(row["title"])
            continue
        items.append(build_item(row))
    items.sort(key=sort_key)
    payload = {
        "schema": SCHEMA,
        "updatedAt": today,
        "note": NOTE,
        "events": items,
        "deadlines": deadlines,
    }
    return payload, sorted(skipped)


def check_expect(payload, skipped, expect, pages, today):
    errors = []

    def fail(message):
        errors.append(message)

    if payload.get("schema") != SCHEMA:
        fail(f"schema {payload.get('schema')!r}")
    if payload.get("updatedAt") != today:
        fail(f"updatedAt {payload.get('updatedAt')!r} != {today}")
    events = payload.get("events") or []
    exp = expect.get("events") or []
    titles = [item.get("title") for item in events]
    exp_titles = [item.get("title") for item in exp]
    if titles != exp_titles:
        fail(f"titles {titles!r} != {exp_titles!r}")
    notion_by_title = {}
    for page in pages:
        if not isinstance(page, dict):
            continue
        props = page.get("properties") or {}
        title = prop_text(props.get("活動名")) if isinstance(props, dict) else ""
        if title and title not in notion_by_title:
            notion_by_title[title] = str(page.get("id") or "")
    for got, exp_item in zip(events, exp):
        title = got.get("title")
        for key, val in exp_item.items():
            if got.get(key) != val:
                fail(f"{title}.{key}: {got.get(key)!r} != {val!r}")
        nid = notion_by_title.get(title)
        if not nid or got.get("id") != page_hash(nid):
            fail(f"{title} id {got.get('id')!r} != hash({nid})")
        blob = json.dumps(got, ensure_ascii=False)
        if "notion.so" in blob or "notion.site" in blob:
            fail(f"{title} publishes a Notion URL")
        if "不應出現" in blob:
            fail(f"{title} published 原狀態")
        if got.get("sample") is not False:
            fail(f"{title} sample")
        if got.get("status") not in STATUSES:
            fail(f"{title} status {got.get('status')!r}")
        notes = got.get("notes") or ""
        if len(notes) > NOTE_LIMIT:
            fail(f"{title} notes length {len(notes)}")
        if got.get("place") and not str(got.get("mapUrl") or "").startswith(MAPS):
            fail(f"{title} missing mapUrl")
        if not got.get("place") and got.get("mapUrl"):
            fail(f"{title} mapUrl without place")
    if skipped != sorted(expect.get("skippedTitles") or []):
        fail(f"skipped {skipped!r} != {sorted(expect.get('skippedTitles') or [])!r}")
    if payload.get("deadlines") != expect.get("deadlines"):
        fail(f"deadlines {payload.get('deadlines')!r} != {expect.get('deadlines')!r}")
    raw = json.dumps(payload, ensure_ascii=False)
    if "notion.so" in raw or "notion.site" in raw:
        fail("payload contains a Notion URL")
    if errors:
        for message in errors:
            print("check fail:", message)
        return 1
    print(
        f"fixture check ok ({len(events)} events, {len(skipped)} skipped, "
        f"{len(payload.get('deadlines') or [])} deadlines)"
    )
    return 0


def print_report(payload, skipped, written):
    events = payload.get("events") or []
    print(
        f"events: {len(events)} items, skipped {len(skipped)}, "
        f"deadlines {len(payload.get('deadlines') or [])}"
    )
    for item in events:
        notion = item.get("notionStatus") or ""
        status = item.get("status") or ""
        arrow = status if status == notion or not notion else f"{status}←{notion}"
        ips = ", ".join(item.get("ips") or [])
        print(
            f"  [{arrow}] {item.get('date') or ''}–{item.get('endDate') or ''} "
            f"{item.get('title')} | {item.get('category') or '—'} | {item.get('place') or '—'}"
            + (f" | {ips}" if ips else "")
            + (" | 重點" if item.get("featured") else "")
        )
    if skipped:
        print("skipped:")
        for title in skipped:
            print(f"  - {title}")
    if written:
        for path in written:
            print(f"wrote {path}")
    else:
        print("left existing file unchanged")


def validate_file(path):
    data = load_json(path)
    if data.get("schema") != SCHEMA:
        sys.exit(f"unexpected schema: {data.get('schema')}")
    events = data.get("events")
    deadlines = data.get("deadlines")
    if not isinstance(events, list):
        sys.exit("events must be a list")
    if not isinstance(deadlines, list):
        sys.exit("deadlines must be a list")
    seen = set()
    for i, row in enumerate(events):
        if not isinstance(row, dict):
            sys.exit(f"events[{i}] must be an object")
        for key in ("id", "title", "date", "status"):
            if not isinstance(row.get(key), str) or not row.get(key):
                sys.exit(f"events[{i}].{key} must be a non-empty string")
        if row["status"] not in STATUSES:
            sys.exit(f"events[{i}].status {row['status']!r}")
        if row.get("sample") is not False:
            sys.exit(f"events[{i}].sample must be false")
        if not DATE_RE.fullmatch(row["date"]):
            sys.exit(f"events[{i}].date {row['date']!r}")
        end = row.get("endDate")
        if end not in (None, "") and not (isinstance(end, str) and DATE_RE.fullmatch(end)):
            sys.exit(f"events[{i}].endDate {end!r}")
        if row["id"] in seen:
            sys.exit(f"duplicate event id {row['id']}")
        seen.add(row["id"])
        if "ips" in row and not (isinstance(row["ips"], list) and all(isinstance(x, str) for x in row["ips"])):
            sys.exit(f"events[{i}].ips must be a string list")
        if "featured" in row and not isinstance(row["featured"], bool):
            sys.exit(f"events[{i}].featured must be a boolean")
        for key in ("source", "ticketUrl", "mapUrl"):
            url = row.get(key) or ""
            if not url:
                continue
            if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
                sys.exit(f"events[{i}].{key} must be http(s)")
            if NOTION_URL_RE.search(url):
                sys.exit(f"events[{i}].{key} must not be a Notion URL")
        notes = row.get("notes") or ""
        if notes and len(notes) > NOTE_LIMIT:
            sys.exit(f"events[{i}].notes longer than {NOTE_LIMIT}")
    for i, row in enumerate(deadlines):
        if not isinstance(row, dict):
            sys.exit(f"deadlines[{i}] must be an object")
        if is_sample_deadline(row):
            sys.exit(f"deadlines[{i}] is marked sample/example")
        if not row.get("id") or not row.get("deadline"):
            sys.exit(f"deadlines[{i}] needs id and deadline")
        if not DATE_RE.fullmatch(str(row.get("deadline"))):
            sys.exit(f"deadlines[{i}].deadline {row.get('deadline')!r}")
    updated = data.get("updatedAt")
    if updated not in (None, "") and not (isinstance(updated, str) and DATE_RE.fullmatch(updated)):
        sys.exit(f"updatedAt {updated!r}")
    print(f"events.json ok ({len(events)} events, {len(deadlines)} deadlines, schema {SCHEMA})")
    return 0


def parse_args():
    parser = argparse.ArgumentParser(description="Sync events.json from Notion")
    parser.add_argument("--fixture", help="Notion query JSON instead of the API")
    parser.add_argument("--offline", action="store_true", help="Do not call the Notion API")
    parser.add_argument("--out", help="Write events.json here (default: data/events.json)")
    parser.add_argument("--today", help="Override the HKT date used for status (YYYY-MM-DD)")
    parser.add_argument("--check", action="store_true", help="Assert fixture expect{} and exit non-zero on mismatch")
    parser.add_argument("--validate", action="store_true", help="Check data/events.json schema and exit")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.validate and not args.fixture:
        self_test()
        return validate_file(DEFAULT_OUT)

    token = os.environ.get("NOTION_TOKEN", "").strip()
    if not args.fixture and (args.offline or not token):
        if not token:
            print("NOTION_TOKEN is not set; leaving data/events.json unchanged.")
            print("Add the existing GitHub Actions secret NOTION_TOKEN, and share that integration with 「香港ACG情報看板」 (… → Connections).")
            print("Optional secret NOTION_EVENTS_DB_ID overrides the default database id.")
        else:
            print("offline without --fixture; leaving data/events.json unchanged.")
        return 0

    self_test()
    fixture_today = ""
    expect = {}
    prior = []
    if args.fixture:
        pages, expect, fixture_today, prior = load_fixture(args.fixture)
        print(f"fixture {args.fixture}: {len(pages)} pages; offline={bool(args.offline)}")
    else:
        db_id = os.environ.get("NOTION_EVENTS_DB_ID", "").strip() or DEFAULT_DB_ID
        print(f"query Notion database {db_id}")
        pages = notion_query(token, db_id)
        print(f"Notion returned {len(pages)} pages")

    today = args.today or fixture_today or hkt_today()
    if not DATE_RE.fullmatch(today):
        sys.exit(f"today must be YYYY-MM-DD, got {today!r}")

    out_path = Path(args.out) if args.out else (None if args.fixture else DEFAULT_OUT)
    if out_path and out_path.exists():
        deadlines = deadlines_from_file(out_path)
    else:
        deadlines = kept_deadlines(prior)

    payload, skipped = build_payload(pages, today, deadlines)
    if not payload["events"]:
        print("warning: sync produced 0 events")

    written = []
    if out_path:
        if content_changed(out_path, payload):
            write_payload(out_path, payload)
            written.append(out_path)
    print_report(payload, skipped, written)
    if args.check:
        if not expect:
            print("check fail: fixture has no expect object")
            return 1
        return check_expect(payload, skipped, expect, pages, today)
    return 0


if __name__ == "__main__":
    sys.exit(main())
