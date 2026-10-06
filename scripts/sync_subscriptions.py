#!/usr/bin/env python3
"""Sync Notion「訂閱追蹤」into encrypted data/subscriptions.enc.json.

The repo and GitHub Pages are public. This script never writes subscription
plaintext, and it logs counts only. Without NOTION_TOKEN or the passphrase
it exits 0 and leaves the ciphertext file untouched.

  python3 scripts/sync_subscriptions.py
  SUBS_PASSPHRASE=demo-subs python3 scripts/sync_subscriptions.py \\
    --fixture scripts/fixtures/notion_subs_sample.json --roundtrip \\
    --out /tmp/subscriptions.enc.json

Envelope (subscriptions-enc.v1) is PBKDF2-SHA256 (≥600k, 16-byte salt) then
AES-256-GCM (12-byte IV), which WebCrypto can decrypt. ``mac`` is
HMAC-SHA256(derived key, canonical plaintext without updatedAt) so a rerun
can skip rewriting when nothing changed.
"""
import argparse
import base64
import calendar
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "subscriptions.enc.json"
DEFAULT_RATES = ROOT / "data" / "rates.json"
DEFAULT_DB_ID = "0a0f4be8-8d57-4970-b3ec-a78d43235188"
# Data source 783d6077-794c-4e0c-8872-986a6734921c is documented, not sent.
NOTION_VERSION = "2022-06-28"
UA = "f77f77/acg-tools (+https://github.com/f77f77/acg-tools)"
HKT = timezone(timedelta(hours=8))
ENC_SCHEMA = "subscriptions-enc.v1"
PLAIN_SCHEMA = "subscriptions.v2"
KDF_ITERS = 600_000
ACTIVE = "使用中"
UNKNOWN = "不確定"
CANCELLED = "已取消"
DROPPED = ("帳戶", "付款方式", "來源信件", "上次扣款原文")
# Read for mapping, never copied through. 下次續費原文 is not a published field.
PUBLISHED = ("服務", "方案", "金額", "幣別", "約港元", "週期", "下次續費", "上次扣款", "狀態", "備註")

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
CARD_RE = re.compile(r"(?<!\d)(?:\d[ \-]?){13,19}(?!\d)")
LONG_DIGIT_RE = re.compile(r"(?<!\d)\d{8,}(?!\d)")
LONG_ALNUM_RE = re.compile(
    r"(?<![A-Za-z0-9])(?=[A-Za-z0-9_\-]*[A-Za-z])(?=[A-Za-z0-9_\-]*\d)"
    r"[A-Za-z0-9][A-Za-z0-9_\-]{9,}(?![A-Za-z0-9])"
)
CURRENCY_ALIASES = {
    "HK$": "HKD",
    "HKD$": "HKD",
    "港元": "HKD",
    "港幣": "HKD",
    "US$": "USD",
    "USD$": "USD",
    "日元": "JPY",
    "日圓": "JPY",
    "円": "JPY",
    "JP¥": "JPY",
    "¥": "JPY",
}

NODE_CHECK = r"""
const fs = require('fs');
const crypto = globalThis.crypto;

function b64(s) {
  return Uint8Array.from(Buffer.from(String(s || ''), 'base64'));
}

(async () => {
  const env = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const expectHex = process.argv[3];
  const expectCount = Number(process.argv[4]);
  const passphrase = process.env.SUBS_ROUNDTRIP_PASSPHRASE || '';
  if (!crypto || !crypto.subtle) {
    console.error('node webcrypto missing');
    process.exit(1);
  }
  try {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: b64(env.kdf.salt),
        iterations: env.kdf.iterations,
        hash: 'SHA-256',
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64(env.cipher.iv) },
      key,
      b64(env.ciphertext)
    );
    const plain = new TextDecoder().decode(buf);
    const digest = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain))
    ).toString('hex');
    if (digest !== expectHex) {
      console.error('node plaintext hash mismatch');
      process.exit(1);
    }
    const data = JSON.parse(plain);
    if (!data || data.schema !== 'subscriptions.v2' || !Array.isArray(data.items)) {
      console.error('node schema mismatch');
      process.exit(1);
    }
    if (data.items.length !== expectCount) {
      console.error('node item count mismatch');
      process.exit(1);
    }
    console.log('node webcrypto ok items=' + data.items.length);
  } catch (err) {
    console.error('node decrypt failed');
    process.exit(1);
  }
})().catch(() => {
  console.error('node check error');
  process.exit(1);
});
"""


def fail(label):
    sys.exit("subscriptions: check failed: " + label)


def check(cond, label):
    if not cond:
        fail(label)


def hkt_today():
    return datetime.now(HKT).date()


def parse_iso(value):
    raw = str(value or "")[:10]
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def b64e(raw):
    return base64.b64encode(raw).decode("ascii")


def json_number(value):
    if isinstance(value, Decimal):
        dec = value
    else:
        dec = Decimal(str(value))
    dec = dec.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if dec == dec.to_integral_value():
        return int(dec)
    return float(dec)


def add_months(day, months):
    month_index = day.month - 1 + months
    year = day.year + month_index // 12
    month = month_index % 12 + 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day.day, last))


def step_interval(day, interval):
    if interval == "year":
        return add_months(day, 12)
    if interval == "month30":
        return day + timedelta(days=30)
    return add_months(day, 1)


def roll_forward(day, interval, today):
    rolled = False
    guard = 0
    while day < today and guard < 240:
        day = step_interval(day, interval)
        rolled = True
        guard += 1
    return day, rolled


def scrub_notes(text):
    text = EMAIL_RE.sub("", text or "")
    text = CARD_RE.sub("", text)
    text = LONG_ALNUM_RE.sub("", text)
    text = LONG_DIGIT_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 80:
        text = text[:80].rstrip()
    return text


def normalize_currency(raw):
    text = (raw or "").strip()
    if text in CURRENCY_ALIASES:
        return CURRENCY_ALIASES[text]
    upper = text.upper().replace(" ", "")
    return CURRENCY_ALIASES.get(upper, upper)


def map_interval(raw):
    text = (raw or "").strip().replace("(", "（").replace(")", "）")
    if text in ("年", "每年", "YEAR"):
        return "year", False
    if text in ("月（30日）", "月（30天）"):
        return "month30", False
    if text == "月（推算）":
        return "month", True
    return "month", False


def compute_hkd(amount, currency, notion_hkd, rates):
    if notion_hkd is not None:
        return json_number(notion_hkd)
    if amount is None:
        return None
    if currency == "HKD":
        return json_number(amount)
    rate = rates.get(currency) if rates else None
    if rate is None:
        return None
    return json_number(Decimal(str(amount)) * Decimal(str(rate)))


def infer_category(name, plan):
    if "倉" in f"{name} {plan}":
        return "warehouse"
    return None


def page_hash(page_id):
    return hashlib.sha256(str(page_id).encode("utf-8")).hexdigest()[:16]


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
    elif typ == "number":
        num = prop.get("number")
        return "" if num is None else str(num)
    elif typ == "date":
        date_prop = prop.get("date") or {}
        start = str(date_prop.get("start") or "")
        return start[:10] if len(start) >= 10 else start.strip()
    else:
        for key in ("title", "rich_text"):
            if isinstance(prop.get(key), list):
                chunks = prop[key]
                break
    if not isinstance(chunks, list):
        return ""
    return "".join(str(c.get("plain_text") or "") for c in chunks if isinstance(c, dict)).strip()


def prop_number(prop):
    if not isinstance(prop, dict):
        return None
    num = prop.get("number")
    if isinstance(num, bool) or num is None:
        return None
    if isinstance(num, (int, float)):
        return json_number(num)
    return None


def self_check():
    check(scrub_notes("請聯絡 user@example.com 謝謝") == "請聯絡 謝謝", "email")
    check(scrub_notes("卡 4242424242424242 完") == "卡 完", "card digits")
    check(scrub_notes("卡 4242-4242-4242-4242 完") == "卡 完", "card dashes")
    check(scrub_notes("卡 4242 4242 4242 4242 完") == "卡 完", "card spaces")
    check(scrub_notes("訂單 ABC1234567890 完") == "訂單 完", "alnum order")
    check(scrub_notes("編號 123456789012 完") == "編號 完", "digit order")
    check(scrub_notes("正常 2026 年 10 月") == "正常 2026 年 10 月", "short digits kept")
    check(scrub_notes("日期 2026-10-12 仍然留低") == "日期 2026-10-12 仍然留低", "date kept")
    check(scrub_notes("txn_1A2b3C4d5E6f 完") == "完", "txn token")
    check(len(scrub_notes("備" * 90)) == 80, "truncate")
    check("@" not in scrub_notes("a nobody@example.com b"), "email gone")
    check(map_interval("月") == ("month", False), "interval month")
    check(map_interval("年") == ("year", False), "interval year")
    check(map_interval("月（推算）") == ("month", True), "interval estimated")
    check(map_interval("月(推算)") == ("month", True), "interval estimated ascii")
    check(map_interval("月（30日）") == ("month30", False), "interval month30")
    check(add_months(date(2026, 1, 31), 1) == date(2026, 2, 28), "month end")
    check(add_months(date(2024, 1, 31), 1) == date(2024, 2, 29), "leap month end")
    rolled_day, rolled = roll_forward(date(2026, 8, 15), "month", date(2026, 10, 6))
    check(rolled and rolled_day == date(2026, 10, 15), "roll month")
    day30, rolled30 = roll_forward(date(2026, 9, 16), "month30", date(2026, 10, 6))
    check(rolled30 and day30 == date(2026, 10, 16), "roll month30")
    same, rolled_same = roll_forward(date(2026, 10, 6), "month", date(2026, 10, 6))
    check(same == date(2026, 10, 6) and not rolled_same, "do not roll today")
    check(compute_hkd(48, "HKD", None, {}) == 48, "hkd from hkd amount")
    check(compute_hkd(10, "USD", 78, {"USD": 7.8}) == 78, "notion hkd wins")
    check(compute_hkd(10, "USD", None, {"USD": 7.8}) == 78, "rate hkd")
    check(compute_hkd(10, "EUR", None, {}) is None, "missing rate")
    check(compute_hkd(Decimal("9.99"), "USD", None, {"USD": 7.8}) == 77.92, "rate cents")
    check(page_hash("11111111-1111-4111-8111-111111111111") != "11111111-1111-4111-8111-111111111111", "id not raw")
    check("-" not in page_hash("abc"), "id has no dashes")
    print("mapping self-check ok")


def load_rates(path):
    if path is None or not Path(path).is_file():
        return {}
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        sys.exit("subscriptions: rates file is not valid JSON")
    raw = data.get("rates") if isinstance(data, dict) and isinstance(data.get("rates"), dict) else data
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, value in raw.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if value <= 0:
            continue
        out[normalize_currency(str(key))] = float(value)
    return out


def load_fixture(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        sys.exit("subscriptions: fixture is not valid JSON")
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("results"), list):
        return data["results"]
    sys.exit("subscriptions: fixture must contain results[]")


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
            sys.exit(f"subscriptions: Notion query failed: HTTP {exc.code}")
        except urllib.error.URLError:
            sys.exit("subscriptions: Notion query failed: network error")
        batch = data.get("results") or []
        if not isinstance(batch, list):
            sys.exit("subscriptions: Notion query response has no results list")
        results.extend(batch)
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        if not cursor:
            break
    else:
        sys.exit("subscriptions: Notion query pagination exceeded 50 pages")
    return results


ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_plain_date(text):
    # A bare YYYY-MM-DD (e.g. 上次扣款原文 copied from the date column) is not private.
    return bool(ISO_DATE_RE.match(str(text or "").strip()))


def redact_dropped(notes, props):
    for key in DROPPED:
        value = prop_text(props.get(key)).strip()
        if len(value) >= 4 and not is_plain_date(value) and value in notes:
            notes = notes.replace(value, "（已隱藏）")
    return notes


def collect_secret(secrets, value):
    text = str(value or "").strip()
    if is_plain_date(text):
        return
    if len(text) >= 8 and text not in secrets:
        secrets.append(text)


def map_pages(pages, today, rates):
    items = []
    secrets = []
    skipped = 0
    allowed = {
        "id", "name", "plan", "amount", "currency", "hkd", "interval", "estimated",
        "nextRenew", "rolled", "lastCharged", "status", "notes", "category",
    }
    for page in pages:
        if not isinstance(page, dict):
            skipped += 1
            continue
        props = page.get("properties") if isinstance(page.get("properties"), dict) else {}
        pid = str(page.get("id") or "")
        collect_secret(secrets, pid)
        collect_secret(secrets, pid.replace("-", ""))
        collect_secret(secrets, page.get("url"))
        for key in DROPPED:
            value = prop_text(props.get(key))
            # A digit-free 付款方式 (e.g. a store name like Google Play) is generic
            # and may legitimately appear in another row's plan; card numbers are not.
            if key == "付款方式" and not re.search(r"\d", value):
                continue
            collect_secret(secrets, value)
        archived = bool(page.get("archived") or page.get("in_trash"))
        name = prop_text(props.get("服務"))
        if archived or not name:
            skipped += 1
            collect_secret(secrets, name)
            continue
        plan = prop_text(props.get("方案"))
        amount = prop_number(props.get("金額"))
        currency = normalize_currency(prop_text(props.get("幣別")))
        notion_hkd = prop_number(props.get("約港元"))
        interval, estimated = map_interval(prop_text(props.get("週期")))
        status = prop_text(props.get("狀態")) or UNKNOWN
        if status not in (ACTIVE, UNKNOWN, CANCELLED):
            status = UNKNOWN
        original = parse_iso(prop_text(props.get("下次續費")))
        next_day = original
        rolled = False
        if status == ACTIVE and original and original < today:
            next_day, rolled = roll_forward(original, interval, today)
        last = parse_iso(prop_text(props.get("上次扣款")))
        notes = scrub_notes(redact_dropped(prop_text(props.get("備註")), props))
        category = infer_category(name, plan)
        item = {
            "id": page_hash(pid),
            "name": name,
            "plan": plan,
            "amount": amount,
            "currency": currency,
            "hkd": compute_hkd(amount, currency, notion_hkd, rates),
            "interval": interval,
            "nextRenew": next_day.isoformat() if next_day else None,
            "lastCharged": last.isoformat() if last else None,
            "status": status,
            "notes": notes,
        }
        if estimated:
            item["estimated"] = True
        if rolled:
            item["rolled"] = True
        if category:
            item["category"] = category
        check(set(item).issubset(allowed), "extra field")
        check(item["id"] != pid and "-" not in item["id"], "raw id published")
        check(item["interval"] == interval, "interval")
        check(bool(item.get("estimated")) == estimated, "estimated")
        check(item.get("rolled", False) == rolled, "rolled")
        check(item["hkd"] == compute_hkd(amount, currency, notion_hkd, rates), "hkd")
        check(item["notes"] == notes and len(item["notes"]) <= 80, "notes length")
        check("@" not in item["notes"], "email in notes")
        check(not LONG_DIGIT_RE.search(item["notes"]), "long digits in notes")
        blob = json.dumps(item, ensure_ascii=False)
        check(
            not any(
                prop_text(props.get(key)) in blob
                for key in DROPPED
                if len(prop_text(props.get(key))) >= 8
                and not is_plain_date(prop_text(props.get(key)))
            ),
            "dropped field",
        )
        raw_renew = prop_text(props.get("下次續費原文"))
        published_overlap = {name, plan, notes, item["nextRenew"] or "", item["lastCharged"] or ""}
        if len(raw_renew) >= 12 and raw_renew not in published_overlap:
            check(raw_renew not in blob, "renew raw published")
        items.append(item)
    items.sort(key=lambda row: row["id"])
    # Cross-row safety: never let one row's private value surface in another row's text.
    for item in items:
        for field in ("name", "plan", "notes"):
            text = item.get(field)
            if not isinstance(text, str):
                continue
            for secret in secrets:
                if secret and secret in text:
                    text = text.replace(secret, "（已隱藏）")
            item[field] = text
    return items, secrets, skipped


def plaintext_safe(blob, secrets):
    try:
        text = blob.decode("utf-8")
    except UnicodeError:
        return False
    if EMAIL_RE.search(text):
        return False
    if re.search(r"(?<!\d)\d{13,}(?!\d)", text):
        return False
    for secret in secrets:
        if secret and secret in text:
            return False
    return True


def envelope_text_safe(text):
    if any(ord(ch) > 126 for ch in text):
        return False
    if "@" in text or "subscriptions.v2" in text:
        return False
    return True


def load_crypto():
    try:
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    except ImportError:
        sys.exit("subscriptions: cryptography is not installed (pip install cryptography)")
    return InvalidTag, hashes, AESGCM, PBKDF2HMAC


def derive_key(passphrase, salt, iterations, hashes, pbkdf2):
    kdf = pbkdf2(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=int(iterations))
    return kdf.derive(passphrase.encode("utf-8"))


def mac_matches(path, passphrase, mac_src, hashes, pbkdf2):
    if not path.is_file():
        return False
    try:
        env = json.loads(path.read_text(encoding="utf-8"))
        if env.get("schema") != ENC_SCHEMA:
            return False
        salt = base64.b64decode(env["kdf"]["salt"])
        iterations = int(env["kdf"]["iterations"])
        if iterations < 1 or iterations > 5_000_000:
            return False
        key = derive_key(passphrase, salt, iterations, hashes, pbkdf2)
        expect = b64e(hmac.new(key, mac_src, hashlib.sha256).digest())
        stored = str(env.get("mac") or "")
        return hmac.compare_digest(expect, stored)
    except Exception:
        return False


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def publish(path, body, secrets, passphrase, today):
    invalid_tag, hashes, aesgcm_cls, pbkdf2 = load_crypto()
    mac_src = dumps(body)
    if mac_matches(path, passphrase, mac_src, hashes, pbkdf2):
        return None, False
    full_obj = dict(body)
    full_obj["updatedAt"] = today.isoformat()
    full = dumps(full_obj)
    if not plaintext_safe(full, secrets):
        sys.exit("subscriptions: refusing to encrypt a payload that still contains dropped fields")
    last_text = ""
    for _ in range(5):
        salt = os.urandom(16)
        iv = os.urandom(12)
        key = derive_key(passphrase, salt, KDF_ITERS, hashes, pbkdf2)
        ciphertext = aesgcm_cls(key).encrypt(iv, full, None)
        mac = b64e(hmac.new(key, mac_src, hashlib.sha256).digest())
        envelope = {
            "schema": ENC_SCHEMA,
            "kdf": {
                "name": "PBKDF2",
                "hash": "SHA-256",
                "iterations": KDF_ITERS,
                "salt": b64e(salt),
            },
            "cipher": {"name": "AES-GCM", "iv": b64e(iv)},
            "ciphertext": b64e(ciphertext),
            "mac": mac,
            "updatedAt": today.isoformat(),
        }
        last_text = json.dumps(envelope, ensure_ascii=False, indent=2) + "\n"
        if envelope_text_safe(last_text):
            atomic_write(path, last_text)
            return full, True
    sys.exit("subscriptions: could not produce an ASCII ciphertext envelope")


def decrypt_full(path, passphrase):
    invalid_tag, hashes, aesgcm_cls, pbkdf2 = load_crypto()
    env = json.loads(path.read_text(encoding="utf-8"))
    key = derive_key(
        passphrase,
        base64.b64decode(env["kdf"]["salt"]),
        int(env["kdf"]["iterations"]),
        hashes,
        pbkdf2,
    )
    try:
        return aesgcm_cls(key).decrypt(base64.b64decode(env["cipher"]["iv"]), base64.b64decode(env["ciphertext"]), None)
    except invalid_tag:
        return None


def node_roundtrip(path, passphrase, full, count, expect_ok):
    script = tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False, encoding="utf-8")
    script.write(NODE_CHECK)
    script.close()
    env = os.environ.copy()
    env["SUBS_ROUNDTRIP_PASSPHRASE"] = passphrase
    try:
        proc = subprocess.run(
            ["node", script.name, str(path), hashlib.sha256(full).hexdigest(), str(count)],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )
    finally:
        try:
            os.unlink(script.name)
        except OSError:
            pass
    stdout = (proc.stdout or "").strip()
    if expect_ok:
        if proc.returncode != 0 or not stdout.startswith("node webcrypto ok items="):
            sys.exit("subscriptions: node webcrypto round-trip failed")
        print(stdout)
        return
    if proc.returncode == 0:
        sys.exit("subscriptions: node accepted a wrong passphrase")


def run_roundtrip(path, passphrase, full, count):
    opened = decrypt_full(path, passphrase)
    check(opened == full, "python decrypt")
    check(decrypt_full(path, passphrase + "-wrong") is None, "python rejects wrong passphrase")
    node_roundtrip(path, passphrase, full, count, True)
    node_roundtrip(path, passphrase + "-wrong", full, count, False)
    print(
        "round-trip ok: python AES-GCM matches, node webcrypto matches, "
        f"wrong passphrase rejected, items={count}"
    )


def build_body(items, demo):
    body = {"schema": PLAIN_SCHEMA, "items": items}
    if demo:
        body["demo"] = True
    return body


def main():
    parser = argparse.ArgumentParser(description="Encrypt Notion 訂閱追蹤 into data/subscriptions.enc.json")
    parser.add_argument("--fixture", help="Notion query JSON instead of the API")
    parser.add_argument("--passphrase-env", default="SUBS_PASSPHRASE", help="Env var holding the passphrase")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--rates", type=Path, default=None, help="Optional FX JSON (default: data/rates.json if present)")
    parser.add_argument("--roundtrip", action="store_true", help="Decrypt with Python and Node WebCrypto and compare")
    parser.add_argument("--today", default="", help="Override HKT today (YYYY-MM-DD) for tests")
    args = parser.parse_args()
    if args.out.name == "subscriptions.json":
        sys.exit("subscriptions: refusing to write plaintext subscriptions.json")
    self_check()
    today = parse_iso(args.today) if args.today else hkt_today()
    if args.today and not today:
        sys.exit("subscriptions: --today must be YYYY-MM-DD")
    passphrase = os.environ.get(args.passphrase_env, "").strip()
    token = os.environ.get("NOTION_TOKEN", "").strip()
    if not passphrase or (not args.fixture and not token):
        if not token and not args.fixture:
            print("NOTION_TOKEN is not set; leaving subscriptions ciphertext unchanged.")
        if not passphrase:
            print(f"{args.passphrase_env} is not set; leaving subscriptions ciphertext unchanged.")
        return 1 if args.roundtrip else 0
    if args.fixture:
        pages = load_fixture(args.fixture)
        demo = True
    else:
        db_id = os.environ.get("NOTION_SUBS_DB_ID", "").strip() or DEFAULT_DB_ID
        pages = notion_query(token, db_id)
        demo = False
    rates_path = args.rates if args.rates else (DEFAULT_RATES if DEFAULT_RATES.is_file() else None)
    if args.rates and not Path(args.rates).is_file():
        sys.exit("subscriptions: --rates file not found")
    rates = load_rates(rates_path)
    items, secrets, skipped = map_pages(pages, today, rates)
    body = build_body(items, demo)
    full, wrote = publish(args.out, body, secrets, passphrase, today)
    if wrote:
        print(f"subscriptions: {len(items)} rows, skipped {skipped}; encrypted file updated")
    else:
        print(f"subscriptions: {len(items)} rows, skipped {skipped}; encrypted file unchanged")
        if args.roundtrip:
            opened = decrypt_full(args.out, passphrase)
            check(opened is not None, "existing decrypt")
            full = opened
    if args.roundtrip:
        if full is None:
            sys.exit("subscriptions: round-trip missing plaintext")
        run_roundtrip(args.out, passphrase, full, len(items))
        snapshot = args.out.read_bytes()
        again, wrote_again = publish(args.out, body, secrets, passphrase, today)
        check(not wrote_again and again is None, "second run should not rewrite")
        check(args.out.read_bytes() == snapshot, "ciphertext bytes changed")
        print("round-trip ok: second run left the ciphertext unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
