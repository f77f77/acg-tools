#!/usr/bin/env python3
"""Sync data/anime-subs.json from the Notion database 「中文字幕動畫播放表」.

Stdlib only. Without NOTION_TOKEN the script exits 0 and leaves the JSON
untouched, so forks and pull-request CI stay green.

  python3 scripts/sync_anime_subs.py
  python3 scripts/sync_anime_subs.py --fixture scripts/fixtures/notion_query_sample.json --offline --check

bgmId resolution order: Notion property, bgm.tv/subject/N in 官方來源連結,
normalised title match against season.json, then Bangumi search
(cached in data/anime-bgm-cache.json). Title normalisation is the same
as modules.js normTitle; the 繁→簡 pair list is read from that file.
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "anime-subs.json"
DEFAULT_CACHE = ROOT / "data" / "anime-bgm-cache.json"
DEFAULT_SEASON = ROOT / "season.json"
DEFAULT_DB_ID = "80d65f30-2ea5-42f0-a11f-24f1f6d5f883"
# Data source id f97f3175-feef-4ebe-a82d-d5c94bcb0e2c is documented in data/README.md.
# This script calls the 2022-06-28 databases query endpoint and does not send it.
NOTION_VERSION = "2022-06-28"
BGM_SEARCH = "https://api.bgm.tv/v0/search/subjects?limit=20"
UA = "f77f77/acg-tools (+https://github.com/f77f77/acg-tools)"
HKT = timezone(timedelta(hours=8))
SCHEMA = "anime-subs.v1"
CACHE_SCHEMA = "anime-bgm-cache.v1"
FINISHED = "已完結"
SHORT_NOTE = 40
NONE_RETRY_DAYS = 7
NOTE = (
    "由 Notion「中文字幕動畫播放表」同步。"
    "bgmId 以 Notion 欄位優先，其次來源網址、本季 season.json 標題、Bangumi 搜尋。"
    "未能對上嘅作品列喺 unresolved，請喺 Notion 填 bgmId。"
)

BGM_URL_RE = re.compile(r"bgm\.tv/subject/(\d+)", re.I)
PUNCT_RE = re.compile(
    r"[\s\u3000·・･．.。、，,：:；;！!？?～〜\-–—_／/\\()（）[\]【】「」『』《》〈〉\"'“”‘’#&+]+"
)
SEASON_ORDINAL_RE = re.compile(r"([0-9]+)\s*(?:st|nd|rd|th)\s*season")
SEASON_WORD_RE = re.compile(r"season\s*([0-9]+)")
SEASON_CN_RE = re.compile(r"第\s*([0-9]+|[零〇一二三四五六七八九十]+)\s*(?:期|季|部)")
CN_DIGIT = {"零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}

_SIMP = None
_LAST_SEARCH = 0.0


def hkt_today():
    return datetime.now(HKT).strftime("%Y-%m-%d")


def load_simp_map():
    global _SIMP
    if _SIMP is not None:
        return _SIMP
    js = (ROOT / "modules.js").read_text(encoding="utf-8")
    start = js.find("('藥药 偵侦")
    end = js.find("').split", start if start >= 0 else 0)
    if start < 0 or end < 0:
        sys.exit("cannot find trad→simp map in modules.js (expected ('藥药 …').split)")
    blob = js[start + 2 : end]
    mapping = {}
    for pair in blob.split():
        if len(pair) == 2:
            mapping[pair[0]] = pair[1]
    if len(mapping) < 50:
        sys.exit("trad→simp map in modules.js looks incomplete")
    _SIMP = mapping
    return mapping


def trad_to_simp(text):
    mapping = load_simp_map()
    return "".join(mapping.get(ch, ch) for ch in text)


def decode_entities(text):
    return (
        str(text or "")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )


def cn_to_int(raw):
    s = str(raw or "")
    if re.fullmatch(r"[0-9]+", s):
        return str(int(s, 10))
    if s == "十":
        return "10"
    ten = s.find("十")
    if ten < 0:
        if len(s) == 1 and s in CN_DIGIT:
            return str(CN_DIGIT[s])
        return ""
    hi = 1 if ten == 0 else CN_DIGIT.get(s[0])
    lo = 0 if ten == len(s) - 1 else CN_DIGIT.get(s[ten + 1])
    if hi is None or lo is None:
        return ""
    return str(hi * 10 + lo)


def norm_title(value):
    """Same steps as modules.js normTitle."""
    text = decode_entities(value)
    text = unicodedata.normalize("NFKC", text)
    text = trad_to_simp(text.lower())
    text = SEASON_ORDINAL_RE.sub(lambda m: "第" + m.group(1) + "季", text)
    text = SEASON_WORD_RE.sub(lambda m: "第" + m.group(1) + "季", text)

    def fold(match):
        num = cn_to_int(match.group(1))
        return ("s" + num) if num else match.group(0)

    text = SEASON_CN_RE.sub(fold, text)
    text = PUNCT_RE.sub("", text)
    return text


def parse_date(value):
    raw = str(value or "")[:10]
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def within_year(air, premiere):
    left, right = parse_date(air), parse_date(premiere)
    if not left or not right:
        return False
    return abs((left - right).days) <= 366


def subject_date(subj):
    return str(subj.get("date") or subj.get("air_date") or "")[:10]


def pick_search_hit(subjects, total, title_ja, title, premiere):
    """Return (bgm_id or None, reason).

    Confident when one result's name/name_cn normalises exactly to the
    Japanese or Chinese title, or when the search has a single subject
    whose air date is within about a year of 首播日期.
    """
    subjects = list(subjects or [])
    wanted = {norm_title(title_ja), norm_title(title)}
    wanted.discard("")
    exact = []
    for subj in subjects:
        names = [norm_title(subj.get("name") or ""), norm_title(subj.get("name_cn") or "")]
        if any(name and name in wanted for name in names):
            exact.append(subj)
    if len(exact) == 1 and exact[0].get("id") is not None:
        return int(exact[0]["id"]), "exact"
    if len(exact) > 1:
        close = [subj for subj in exact if within_year(subject_date(subj), premiere)]
        if len(close) == 1 and close[0].get("id") is not None:
            return int(close[0]["id"]), "exact"
        return None, "ambiguous"
    only = None
    if total == 1 and len(subjects) == 1:
        only = subjects[0]
    elif total is None and len(subjects) == 1:
        only = subjects[0]
    if only and only.get("id") is not None and within_year(subject_date(only), premiere):
        return int(only["id"]), "single"
    return None, "none"


def self_test():
    errors = []

    def check(cond, message):
        if not cond:
            errors.append(message)

    check(
        norm_title("アオのハコ Season2") == norm_title("アオのハコ Season 2"),
        "Season2 did not fold like Season 2",
    )
    check(norm_title("2nd Season") == "s2", f"2nd Season → {norm_title('2nd Season')!r}")
    check(
        norm_title("藥屋少女的呢喃 第三季") == norm_title("药屋少女的呢喃 第三季"),
        "trad/simp 藥屋 mismatch",
    )
    check(norm_title("名偵探柯南") == norm_title("名侦探柯南"), "偵探 mismatch")
    check("s3" in norm_title("薬屋のひとりごと 第3期"), "第3期 was not folded")

    subjects = [
        {"id": 460306, "name": "アオのハコ", "name_cn": "青之箱", "date": "2024-10-03"},
        {"id": 548156, "name": "アオのハコ Season 2", "name_cn": "青之箱 第二季", "date": "2026-10-04"},
        {"id": 92836, "name": "アオハライド", "name_cn": "青春之旅", "date": "2014-07-07"},
    ]
    hit, why = pick_search_hit(subjects, 9, "アオのハコ Season2", "青春之箱 第二季", "2026-10-04")
    check(hit == 548156 and why == "exact", f"season2 search → {hit} {why}")
    hit, why = pick_search_hit(subjects, 9, "青之箱 第二季", "青之箱 第二季", "2026-10-04")
    check(hit == 548156, f"name_cn exact → {hit} {why}")
    hit, why = pick_search_hit(subjects, 9, "全然違う", "完全不同", "2026-10-04")
    check(hit is None, f"fuzzy many should miss, got {hit}")
    one = [{"id": 1, "name": "別の名前", "name_cn": "另一個名", "date": "2026-09-01"}]
    hit, why = pick_search_hit(one, 1, "存在しない", "不存在", "2026-10-10")
    check(hit == 1 and why == "single", f"single within year → {hit} {why}")
    old = [{"id": 2, "name": "別の名前", "name_cn": "另一個名", "date": "2020-01-01"}]
    hit, why = pick_search_hit(old, 1, "存在しない", "不存在", "2026-10-10")
    check(hit is None, f"single outside year should miss, got {hit}")
    two = [
        {"id": 10, "name": "同じ", "name_cn": "相同", "date": "2010-01-01"},
        {"id": 11, "name": "同じ", "name_cn": "相同作品", "date": "2026-08-01"},
    ]
    hit, why = pick_search_hit(two, 2, "同じ", "其他", "2026-10-01")
    check(hit == 11, f"ambiguous exact tie-break → {hit} {why}")
    if errors:
        for message in errors:
            print("self-test fail:", message)
        sys.exit(1)
    print("self-test ok (normalisation + search confidence)")


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
    elif typ == "date":
        date = prop.get("date") or {}
        start = str(date.get("start") or "")
        return start[:10] if len(start) >= 10 else start.strip()
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


def prop_number(prop):
    if not isinstance(prop, dict):
        return None
    num = prop.get("number")
    if isinstance(num, bool) or num is None:
        return None
    if isinstance(num, int):
        return num
    if isinstance(num, float) and num.is_integer():
        return int(num)
    return None


def split_work_title(raw):
    text = (raw or "").strip()
    if "／" in text:
        ja, zh = text.split("／", 1)
        ja, zh = ja.strip(), zh.strip()
        if not ja:
            ja = zh or text
        if not zh:
            zh = ja or text
        return ja, zh
    return text, text


def region_note(region, note):
    region = (region or "").strip()
    note = (note or "").strip()
    if note and note != region and len(note) <= SHORT_NOTE:
        return f"{region} · {note}" if region else note
    return region


def safe_http(url):
    url = (url or "").strip()
    if url.lower().startswith(("http://", "https://")):
        return url
    return ""


def bgm_id_from_url(url):
    match = BGM_URL_RE.search(url or "")
    return int(match.group(1)) if match else None


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_season(path):
    data = load_json(path)
    ids = set()
    by_name = {}
    for day in data.get("days") or []:
        for item in day.get("items") or []:
            sid = item.get("id")
            if isinstance(sid, str) and sid.isdigit():
                sid = int(sid)
            if not isinstance(sid, int) or isinstance(sid, bool):
                continue
            ids.add(sid)
            for name in (item.get("name"), item.get("name_cn")):
                key = norm_title(name)
                if key and key not in by_name:
                    by_name[key] = sid
    return ids, by_name


def load_fixture(path):
    data = load_json(path)
    expect = {}
    if isinstance(data, list):
        return data, expect
    if isinstance(data, dict):
        expect = data.get("expect") if isinstance(data.get("expect"), dict) else {}
        if isinstance(data.get("results"), list):
            return data["results"], expect
        if isinstance(data.get("pages"), list):
            return data["pages"], expect
    sys.exit(f"fixture {path} must be a Notion query response with results[]")


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


def search_subjects(keyword):
    global _LAST_SEARCH
    wait = 0.4 - (time.time() - _LAST_SEARCH)
    if _LAST_SEARCH and wait > 0:
        time.sleep(wait)
    body = json.dumps(
        {"keyword": keyword[:200], "sort": "match", "filter": {"type": [2]}},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        BGM_SEARCH,
        data=body,
        headers={"User-Agent": UA, "Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"HTTP {exc.code} {detail}") from exc
    finally:
        _LAST_SEARCH = time.time()
    subjects = data.get("data") if isinstance(data, dict) else None
    if not isinstance(subjects, list):
        raise RuntimeError("Bangumi search response has no data list")
    total = data.get("total") if isinstance(data, dict) else None
    if not isinstance(total, int):
        total = None
    return subjects, total


class Cache:
    def __init__(self, path):
        self.path = Path(path) if path else None
        self.entries = {}
        self.dirty = False
        if self.path and self.path.exists():
            data = load_json(self.path)
            if data.get("schema") not in (None, CACHE_SCHEMA):
                sys.exit(f"unexpected cache schema: {data.get('schema')}")
            entries = data.get("entries") or {}
            if not isinstance(entries, dict):
                sys.exit("anime-bgm-cache.json entries must be an object")
            self.entries = entries

    def get(self, key):
        entry = self.entries.get(key)
        return entry if isinstance(entry, dict) else None

    def remember(self, key, keyword, bgm_id):
        if not key:
            return
        prev = self.get(key)
        if prev and prev.get("keyword") == keyword and prev.get("bgmId") == bgm_id and bgm_id:
            return
        entry = {"keyword": keyword, "bgmId": bgm_id, "checkedAt": hkt_today()}
        if prev != entry:
            self.entries[key] = entry
            self.dirty = True

    def save(self):
        if not self.path or not self.dirty:
            return None
        payload = {
            "schema": CACHE_SCHEMA,
            "updatedAt": hkt_today(),
            "entries": {key: self.entries[key] for key in sorted(self.entries)},
        }
        if self.path.exists():
            try:
                old = load_json(self.path)
            except json.JSONDecodeError:
                old = None
            if isinstance(old, dict):
                old.pop("updatedAt", None)
                new = dict(payload)
                new.pop("updatedAt", None)
                if old == new:
                    self.dirty = False
                    return None
        text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(text, encoding="utf-8")
        self.dirty = False
        return self.path


def fresh_miss(entry, today):
    if not entry or entry.get("bgmId"):
        return False
    checked = str(entry.get("checkedAt") or "")
    then = parse_date(checked)
    now = parse_date(today)
    if not then or not now:
        return False
    return (now - then).days < NONE_RETRY_DAYS


def cached_id(entry):
    bgm_id = entry.get("bgmId") if entry else None
    if isinstance(bgm_id, bool) or not isinstance(bgm_id, int):
        return None
    return bgm_id


def parse_page(page):
    if not isinstance(page, dict) or page.get("object") not in (None, "page"):
        return None
    if page.get("archived") or page.get("in_trash"):
        return None
    props = page.get("properties") or {}
    if not isinstance(props, dict):
        return None
    title_ja, title = split_work_title(prop_text(props.get("作品")))
    if not title and not title_ja:
        return None
    aliases = []
    for part in (title_ja, title):
        if part and part not in aliases:
            aliases.append(part)
    return {
        "notion_id": str(page.get("id") or ""),
        "title_ja": title_ja,
        "title": title,
        "aliases": aliases,
        "platforms": prop_multi(props.get("平台")),
        "subtitle": prop_text(props.get("字幕")),
        "region": prop_text(props.get("地區")),
        "note": prop_text(props.get("備註")),
        "schedule": prop_text(props.get("每週更新時間（HKT）")),
        "status": prop_text(props.get("狀態")),
        "premiere": prop_text(props.get("首播日期")),
        "official_url": safe_http(prop_text(props.get("官方來源連結"))),
        "notion_bgm": prop_number(props.get("bgmId")),
    }


def resolve_bgm(row, by_name, cache, offline, today):
    if row["notion_bgm"] is not None:
        return row["notion_bgm"], "notion"
    url_id = bgm_id_from_url(row["official_url"])
    if url_id is not None:
        return url_id, "url"
    names = [row["title"], row["title_ja"], *row["aliases"]]
    for name in names:
        key = norm_title(name)
        if key and key in by_name:
            return by_name[key], "season"
    cache_key = norm_title(row["title_ja"] or row["title"])
    entry = cache.get(cache_key) if cache_key else None
    found = cached_id(entry)
    if found is not None:
        return found, "search"
    if fresh_miss(entry, today):
        return None, "none"
    if offline or not cache_key:
        return None, "none"
    keyword = row["title_ja"] or row["title"]
    try:
        subjects, total = search_subjects(keyword)
    except Exception as exc:  # noqa: BLE001 — keep the row, retry next run
        print(f"warn: Bangumi search failed for {keyword}: {exc}")
        return None, "none"
    hit, why = pick_search_hit(subjects, total, row["title_ja"], row["title"], row["premiere"])
    cache.remember(cache_key, keyword, hit)
    label = row["title"] or keyword
    if hit is not None:
        print(f"search hit {hit} ({why}) {label}")
        return hit, "search"
    print(f"search miss ({why}) {label}")
    return None, "none"


def build_item(row, bgm_id, source):
    item = {
        "title": row["title"],
        "titleJa": row["title_ja"],
        "aliases": row["aliases"],
    }
    if bgm_id is not None:
        item["bgmId"] = bgm_id
    item["bgmIdSource"] = source
    item["platforms"] = row["platforms"] or ["待核對"]
    item["subtitle"] = row["subtitle"]
    item["regionNote"] = region_note(row["region"], row["note"])
    item["scheduleHkt"] = row["schedule"]
    if row["premiere"]:
        item["premiere"] = row["premiere"]
    if row["status"]:
        item["status"] = row["status"]
    if row["official_url"]:
        item["source"] = row["official_url"]
    if row["notion_id"]:
        item["notionId"] = row["notion_id"]
    item["sample"] = False
    return item


def unresolved_row(item):
    row = {
        "title": item.get("title") or "",
        "titleJa": item.get("titleJa") or "",
        "notionId": item.get("notionId") or "",
    }
    if item.get("status"):
        row["status"] = item["status"]
    return row


def sort_key(item):
    return (item.get("title") or "", item.get("titleJa") or "", item.get("notionId") or "")


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


def build_payload(pages, season_ids, by_name, cache, offline):
    today = hkt_today()
    items = []
    skipped = []
    for page in pages:
        row = parse_page(page)
        if not row:
            continue
        bgm_id, source = resolve_bgm(row, by_name, cache, offline, today)
        if row["status"] == FINISHED and (bgm_id is None or bgm_id not in season_ids):
            skipped.append(row["title"] or row["title_ja"])
            continue
        items.append(build_item(row, bgm_id, source))
    items.sort(key=sort_key)
    unresolved = [unresolved_row(item) for item in items if item.get("bgmIdSource") == "none"]
    unresolved.sort(key=sort_key)
    payload = {
        "schema": SCHEMA,
        "updatedAt": today,
        "note": NOTE,
        "unresolved": unresolved,
        "items": items,
    }
    return payload, skipped


def check_expect(payload, skipped, expect):
    errors = []
    got_items = payload.get("items") or []
    exp_items = expect.get("items") or []
    if len(got_items) != len(exp_items):
        errors.append(f"item count {len(got_items)} != {len(exp_items)}")
    by_title = {}
    for item in got_items:
        by_title.setdefault(item.get("title"), item)
    for exp in exp_items:
        got = by_title.get(exp.get("title"))
        if got is None:
            errors.append(f"missing title {exp.get('title')!r}")
            continue
        for key, val in exp.items():
            if val is None:
                if key in got and got.get(key) not in (None, ""):
                    errors.append(f"{exp.get('title')}.{key} expected empty, got {got.get(key)!r}")
            elif got.get(key) != val:
                errors.append(f"{exp.get('title')}.{key}: {got.get(key)!r} != {val!r}")
    got_skipped = list(skipped)
    exp_skipped = list(expect.get("skippedTitles") or [])
    if got_skipped != exp_skipped:
        errors.append(f"skipped {got_skipped!r} != {exp_skipped!r}")
    got_un = [row.get("title") for row in payload.get("unresolved") or []]
    exp_un = list(expect.get("unresolvedTitles") or [])
    if got_un != exp_un:
        errors.append(f"unresolved {got_un!r} != {exp_un!r}")
    titles = [item.get("title") for item in got_items]
    if titles != sorted(titles):
        errors.append(f"items are not stably sorted: {titles!r}")
    for item in got_items:
        if item.get("sample") is not False:
            errors.append(f"sample is not false: {item.get('title')}")
        source = item.get("source") or ""
        if "notion.so" in source or "notion.site" in source:
            errors.append(f"Notion page url used as source: {item.get('title')}")
        if item.get("bgmIdSource") not in ("notion", "url", "season", "search", "none"):
            errors.append(f"bad bgmIdSource on {item.get('title')}")
    updated = str(payload.get("updatedAt") or "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", updated):
        errors.append(f"updatedAt {updated!r}")
    if payload.get("schema") != SCHEMA:
        errors.append(f"schema {payload.get('schema')!r}")
    if errors:
        for message in errors:
            print("check fail:", message)
        return 1
    print(f"fixture check ok ({len(got_items)} items, {len(got_un)} unresolved, {len(got_skipped)} skipped)")
    return 0


def print_report(payload, skipped, written):
    items = payload.get("items") or []
    unresolved = payload.get("unresolved") or []
    print(
        f"anime-subs: {len(items)} items, unresolved {len(unresolved)}, "
        f"skipped 已完結 {len(skipped)}"
    )
    for item in items:
        bgm = item.get("bgmId")
        bgm_s = str(bgm) if bgm else "-"
        platforms = ", ".join(item.get("platforms") or [])
        print(
            f"  [{item.get('bgmIdSource')}] {bgm_s} {item.get('title')} / {item.get('titleJa')}"
            f" | {platforms} | {item.get('status') or ''}"
        )
    if unresolved:
        print("unresolved (fill bgmId in Notion):")
        for row in unresolved:
            print(f"  - {row.get('title')} / {row.get('titleJa')} ({row.get('notionId')})")
    if skipped:
        print("skipped 已完結 (not in this season.json):")
        for title in skipped:
            print(f"  - {title}")
    if written:
        for path in written:
            print(f"wrote {path}")
    else:
        print("left existing files unchanged")


def parse_args():
    parser = argparse.ArgumentParser(description="Sync anime-subs.json from Notion")
    parser.add_argument("--fixture", help="Notion query JSON instead of the API")
    parser.add_argument("--offline", action="store_true", help="Do not call Bangumi search")
    parser.add_argument("--season", help="season.json path (default: season.json)")
    parser.add_argument("--out", help="Write anime-subs.json here (default: data/anime-subs.json)")
    parser.add_argument("--cache", help="bgm id cache path (default: data/anime-bgm-cache.json)")
    parser.add_argument("--check", action="store_true", help="Assert fixture expect{} and exit non-zero on mismatch")
    return parser.parse_args()


def main():
    args = parse_args()
    token = os.environ.get("NOTION_TOKEN", "").strip()
    if not args.fixture and not token:
        print("NOTION_TOKEN is not set; leaving data/anime-subs.json unchanged.")
        print("Add GitHub Actions secret NOTION_TOKEN (Notion internal integration shared with 「中文字幕動畫播放表」).")
        print("Optional secret NOTION_ANIME_DB_ID overrides the default database id.")
        return 0

    self_test()
    season_path = Path(args.season) if args.season else DEFAULT_SEASON
    if not season_path.is_file():
        sys.exit(f"missing season file: {season_path}")
    season_ids, by_name = load_season(season_path)

    if args.fixture:
        pages, expect = load_fixture(args.fixture)
        print(f"fixture {args.fixture}: {len(pages)} pages; offline={bool(args.offline)}")
    else:
        db_id = os.environ.get("NOTION_ANIME_DB_ID", "").strip() or DEFAULT_DB_ID
        print(f"query Notion database {db_id}")
        pages = notion_query(token, db_id)
        expect = {}
        print(f"Notion returned {len(pages)} pages")

    if args.cache:
        cache = Cache(args.cache)
    elif args.fixture:
        cache = Cache(None)
    else:
        cache = Cache(DEFAULT_CACHE)

    payload, skipped = build_payload(pages, season_ids, by_name, cache, args.offline)
    if not payload["items"]:
        print("warning: sync produced 0 items")

    written = []
    out_path = Path(args.out) if args.out else (None if args.fixture else DEFAULT_OUT)
    if out_path:
        if content_changed(out_path, payload):
            write_payload(out_path, payload)
            written.append(out_path)
        elif not out_path.exists():
            write_payload(out_path, payload)
            written.append(out_path)
    saved = cache.save()
    if saved:
        written.append(saved)
    print_report(payload, skipped, written)
    if args.check:
        if not expect:
            print("check fail: fixture has no expect object")
            return 1
        return check_expect(payload, skipped, expect)
    return 0


if __name__ == "__main__":
    sys.exit(main())
