#!/usr/bin/env python3
"""
Offline seed match test: crop 6 Team Preview slots with locked ROI Doc v1.2
and match against in-memory sprite-sheet crops (NCC + SSD + aHash).

Expect ~6/6 when templates were cropped from the same fixture image.

Usage:
  python scripts/match-seed-templates.py
  python scripts/match-seed-templates.py public/fixtures/team-preview.png
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:
    raise SystemExit("Need Pillow: pip install pillow") from e

from lib_sprite_sheet import crop_template, load_atlas

ROOT = Path(__file__).resolve().parents[1]
SPRITES_DIR = ROOT / "public/sprites"

# Locked — mirror src/lib/roi.ts (DO NOT change)
ENEMY_PANEL = {"left": 0.811, "top": 0.137, "right": 0.965, "bottom": 0.836}
THUMB_CROP = {"left": 0.18, "right": 0.60, "topInset": 0.0, "bottomInset": 0.0}  # square inset inside card body
TEMPLATE_SIZE = 64
SLOT_COUNT = 6
CARD_GAP_FRAC = 0.08  # fraction of pitch that is inter-card gap (mirror src/lib/roi.ts)
PANEL_OUTER_MARGIN_FRAC = 0.02  # green visual outer pad (content-height frac; mirror roi.ts)
TARGET_ASPECT = 16 / 9
CONFIDENCE_THRESHOLD = 0.55

SEED_ORDER = [
    "noivern",
    "lycanroc",
    "politoed",
    "rotom",
    "kangaskhan",
    "hippowdon",
]


def content_rect(frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
    if frame_w <= 0 or frame_h <= 0:
        return 0, 0, max(1, frame_w), max(1, frame_h)
    aspect = frame_w / frame_h
    if aspect > TARGET_ASPECT:
        width = int(frame_h * TARGET_ASPECT)
        x = (frame_w - width) // 2
        return x, 0, width, frame_h
    if aspect < TARGET_ASPECT:
        height = int(frame_w / TARGET_ASPECT)
        y = (frame_h - height) // 2
        return 0, y, frame_w, height
    return 0, 0, frame_w, frame_h


def letterbox_to_template(im: Image.Image) -> Image.Image:
    """Contain/letterbox into TEMPLATE_SIZE×TEMPLATE_SIZE (black pad; never stretch)."""
    rgb = im.convert("RGB")
    canvas = Image.new("RGB", (TEMPLATE_SIZE, TEMPLATE_SIZE), (0, 0, 0))
    w, h = rgb.size
    scale = min(TEMPLATE_SIZE / max(1, w), TEMPLATE_SIZE / max(1, h))
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    resized = rgb.resize((nw, nh), Image.Resampling.LANCZOS)
    ox = (TEMPLATE_SIZE - nw) // 2
    oy = (TEMPLATE_SIZE - nh) // 2
    canvas.paste(resized, (ox, oy))
    return canvas


def to_gray(im: Image.Image) -> list[float]:
    """Grayscale feature vector after contain/letterbox (no stretch)."""
    rgb = letterbox_to_template(im)
    pix = rgb.load()
    out: list[float] = []
    for y in range(TEMPLATE_SIZE):
        for x in range(TEMPLATE_SIZE):
            r, g, b = pix[x, y]
            out.append(0.299 * r + 0.587 * g + 0.114 * b)
    return out



def average_hash(gray: list[float], size: int = 8) -> str:
    # downsample gray 64x64 → 8x8 by block average
    side = TEMPLATE_SIZE
    block = side // size
    vals = []
    for gy in range(size):
        for gx in range(size):
            s = 0.0
            for by in range(block):
                for bx in range(block):
                    s += gray[(gy * block + by) * side + (gx * block + bx)]
            vals.append(s / (block * block))
    avg = sum(vals) / len(vals)
    return "".join("1" if v >= avg else "0" for v in vals)


def ncc(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    mean_a = sum(a[:n]) / n
    mean_b = sum(b[:n]) / n
    num = den_a = den_b = 0.0
    for i in range(n):
        da = a[i] - mean_a
        db = b[i] - mean_b
        num += da * db
        den_a += da * da
        den_b += db * db
    den = math.sqrt(den_a * den_b)
    if den < 1e-6:
        return 0.0
    return num / den


def ssd_similarity(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    s = 0.0
    for i in range(n):
        d = (a[i] - b[i]) / 255.0
        s += d * d
    return max(0.0, 1.0 - math.sqrt(s / n) * 2.0)


def hamming(a: str, b: str) -> int:
    n = min(len(a), len(b))
    return sum(1 for i in range(n) if a[i] != b[i]) + abs(len(a) - len(b))


def confidence(gray: list[float], hash_s: str, tmpl_gray: list[float], tmpl_hash: str) -> float:
    ncc_score = (ncc(gray, tmpl_gray) + 1) / 2
    ssd_score = ssd_similarity(gray, tmpl_gray)
    hash_bits = max(len(hash_s), len(tmpl_hash)) or 64
    hash_score = max(0.0, 1.0 - hamming(hash_s, tmpl_hash) / (hash_bits * 0.35))
    return min(1.0, ncc_score * 0.55 + ssd_score * 0.25 + hash_score * 0.2)


def yellow_rect_from_card(sx, sy, sw, sh, thumb=None):
    """Yellow square inside red card body (mirrors thumbRectInSlot)."""
    thumb = thumb or THUMB_CROP
    top_in = max(0.0, min(0.2, float(thumb.get("topInset", 0.0)))) * sh
    bot_in = max(0.0, min(0.2, float(thumb.get("bottomInset", 0.0)))) * sh
    side = max(1, int(sh - top_in - bot_in))
    tx = int(sx + sw * float(thumb["left"]))
    max_x = sx + max(0, sw - side)
    tx = min(max(sx, tx), max_x)
    ty = int(sy + top_in)
    return tx, ty, side


def crop_slot(im: Image.Image, slot: int, *, card_body: bool = True) -> Image.Image:
    """Yellow square crop for matching (= overlay yellow / app recognition).

    Default card_body=True → side = pitch×(1-CARD_GAP_FRAC) (card body; yellow geometry).
    card_body=False → side = full pitch (legacy).
    """
    cx, cy, cw, ch = content_rect(*im.size)
    px = int(cx + ENEMY_PANEL["left"] * cw)
    py = int(cy + ENEMY_PANEL["top"] * ch)
    pw = max(1, int((ENEMY_PANEL["right"] - ENEMY_PANEL["left"]) * cw))
    ph = max(1, int((ENEMY_PANEL["bottom"] - ENEMY_PANEL["top"]) * ch))
    pitch = ph / SLOT_COUNT
    gap = CARD_GAP_FRAC if card_body else 0.0
    body_h = pitch * (1 - gap)
    top_inset = pitch * (gap / 2)
    sx, sw = px, pw
    sy = int(py + slot * pitch + top_inset)
    sh = max(1, int(body_h))
    tx, ty, side = yellow_rect_from_card(sx, sy, sw, sh)
    return im.crop((tx, ty, tx + side, ty + side))


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "public/fixtures/team-preview.png"
    tmpl_dir = ROOT / "public/templates"
    out_md = ROOT / "docs/match-seed-results.md"

    templates = {}
    atlas_path = SPRITES_DIR / "atlas.json"
    sheet_path = SPRITES_DIR / "sprite_poke.png"
    if atlas_path.exists() and sheet_path.exists():
        atlas = load_atlas(atlas_path)
        sheet = Image.open(sheet_path).convert("RGBA")
        by_sid = {e["speciesId"]: e for e in (atlas.get("entries") or []) if e.get("speciesId")}
        for sid in SEED_ORDER:
            entry = by_sid.get(sid)
            if not entry:
                continue
            g = to_gray(crop_template(sheet, entry))
            templates[sid] = {"gray": g, "hash": average_hash(g)}
    else:
        for sid in SEED_ORDER:
            fpath = tmpl_dir / f"{sid}.png"
            if fpath.exists():
                templates[sid] = {"gray": to_gray(Image.open(fpath)), "hash": average_hash(to_gray(Image.open(fpath)))}

    missing = [sid for sid in SEED_ORDER if sid not in templates]
    if missing:
        print("Missing seed templates in sprite atlas:", ", ".join(missing))
        if not templates:
            print("Build atlas: python scripts/build-sprite-atlas.py")
            return 1
        print("Continuing with", len(templates), "available seed templates")

    if not src.exists():
        print(f"Seed fixture missing: {src} (skip; primary acceptance is match-test-fixtures.py)")
        return 0

    im = Image.open(src).convert("RGB")
    rows = []
    correct = 0
    wrong = 0
    print(f"Fixture: {src.relative_to(ROOT)}")
    print(f"Templates: public/sprites (dex-keyed sheet crops; {len(templates)} seeds)")
    print(f"{'slot':<4} {'expected':<12} {'matched':<12} {'conf':>6}  ok")
    for slot, expected in enumerate(SEED_ORDER):
        if expected not in templates:
            print(f"{slot:<4} {expected:<12} {'-':<12} {'-':>6}  skip (no atlas cell)")
            rows.append(
                {
                    "slot": slot,
                    "expected": expected,
                    "matched": None,
                    "confidence": 0.0,
                    "ok": False,
                    "skipped": True,
                }
            )
            continue
        crop = crop_slot(im, slot)
        gray = to_gray(crop)
        h = average_hash(gray)
        best_id, best_c = None, -1.0
        for sid, t in templates.items():
            c = confidence(gray, h, t["gray"], t["hash"])
            if c > best_c:
                best_id, best_c = sid, c
        ok = best_id == expected and best_c >= CONFIDENCE_THRESHOLD
        if ok:
            correct += 1
        elif best_id and best_id != expected and best_c >= CONFIDENCE_THRESHOLD:
            wrong += 1
        mark = "Y" if ok else "N"
        print(f"{slot:<4} {expected:<12} {best_id or '-':<12} {best_c:6.3f}  {mark}")
        rows.append(
            {
                "slot": slot,
                "expected": expected,
                "matched": best_id,
                "confidence": round(best_c, 4),
                "ok": ok,
            }
        )

    accuracy = f"{correct}/{SLOT_COUNT}"
    print(f"Accuracy: {accuracy}")

    out_md.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Seed template match results",
        "",
        f"- Fixture: `public/fixtures/team-preview.png` (圖二)",
        f"- Templates: `public/sprites/sprite_poke.png` (nationalDex-keyed in-memory crops)",
        f"- Matcher: NCC×0.55 + SSD×0.25 + aHash×0.20 (same weights as `recognize.ts`)",
        f"- Threshold: {CONFIDENCE_THRESHOLD}",
        f"- **Accuracy: {accuracy}**",
        "",
        "| slot | expected | matched | confidence | ok |",
        "|------|----------|---------|------------|----|",
    ]
    for r in rows:
        lines.append(
            f"| {r['slot']} | {r['expected']} | {r['matched']} | {r['confidence']:.4f} | {'Y' if r['ok'] else 'N'} |"
        )
    lines += [
        "",
        "## Notes",
        "",
        "- Prefer **sprite-sheet** crops in `public/sprites/` (nationalDex keys) for Team Preview recognition.",
        "- CBD menu sprites under `assets/templates/preview-thumbs/` (`source: cbd`) are optional secondary;",
        "  menu-style art often does **not** match Team Preview thumbs well — do not use as primary matcher.",
        "- Never bulk-download the dex; use `scripts/fetch-cbd-templates.mjs --allowlist` / `--ids=...` only.",
        "",
    ]
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_md.relative_to(ROOT)}")

    # also dump json beside md for tooling
    (ROOT / "docs/match-seed-results.json").write_text(
        json.dumps({"accuracy": accuracy, "correct": correct, "total": SLOT_COUNT, "rows": rows}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    # Prefer unidentified over wrong species. Missing atlas cells are skips, not FPs.
    return 0 if wrong == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
