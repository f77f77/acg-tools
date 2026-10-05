#!/usr/bin/env python3
"""
A/B accuracy: ROI-only vs CBD-only templates on Team Preview fixtures.

Same matcher / ROI Doc v1.2 as match-test-fixtures.py / recognize.ts.
Does NOT change ROI constants.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:
    raise SystemExit("Need Pillow: pip install pillow / apt install python3-pil") from e

ROOT = Path(__file__).resolve().parents[1]

# Locked — mirror src/lib/roi.ts (DO NOT change)
ENEMY_PANEL = {"left": 0.811, "top": 0.137, "right": 0.965, "bottom": 0.836}
THUMB_CROP = {"left": 0.18, "right": 0.60, "topInset": 0.0, "bottomInset": 0.0}  # square inset inside card body
TEMPLATE_SIZE = 64
SLOT_COUNT = 6
CARD_GAP_FRAC = 0.08  # fraction of pitch that is inter-card gap (mirror src/lib/roi.ts)
PANEL_OUTER_MARGIN_FRAC = 0.02  # green visual outer pad (content-height frac; mirror roi.ts)
TARGET_ASPECT = 16 / 9
CONFIDENCE_THRESHOLD = 0.55

FIXTURES = [
    {
        "path": ROOT / "public/fixtures/team-preview-live-latest.jpg",
        "label": "team-preview-live-latest",
        "expected": [
            "froslass",
            "garchomp",
            "basculegion",
            "kingambit",
            "sneasler",
            "golisopod",
        ],
    },
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


def load_roi_templates(tmpl_dir: Path) -> list[dict]:
    manifest = json.loads((tmpl_dir / "manifest.json").read_text(encoding="utf-8"))
    templates: list[dict] = []
    for entry in manifest.get("templates", []):
        sid = entry["speciesId"]
        fpath = tmpl_dir / entry.get("file", f"{sid}.png")
        if not fpath.exists():
            print(f"WARN missing ROI template: {fpath}", file=sys.stderr)
            continue
        g = to_gray(Image.open(fpath))
        templates.append(
            {"speciesId": sid, "gray": g, "hash": average_hash(g), "file": fpath.name, "source": "roi-crop"}
        )
    return templates


def load_cbd_templates(tmpl_dir: Path) -> list[dict]:
    """Load CBD thumbs from manifest.jsonl (+ any leftover PNGs keyed by stem)."""
    templates: list[dict] = []
    seen_files: set[str] = set()
    jsonl = tmpl_dir / "manifest.jsonl"
    if jsonl.exists():
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            sid = entry.get("showdownId") or entry.get("speciesId")
            fname = entry.get("file", f"{sid}.png")
            fpath = tmpl_dir / fname
            if not fpath.exists():
                print(f"WARN missing CBD template: {fpath}", file=sys.stderr)
                continue
            g = to_gray(Image.open(fpath))
            templates.append(
                {"speciesId": sid, "gray": g, "hash": average_hash(g), "file": fname, "source": "cbd"}
            )
            seen_files.add(fname)
    # Also pick up PNGs not in jsonl (defensive)
    for fpath in sorted(tmpl_dir.glob("*.png")):
        if fpath.name in seen_files:
            continue
        sid = fpath.stem
        g = to_gray(Image.open(fpath))
        templates.append(
            {"speciesId": sid, "gray": g, "hash": average_hash(g), "file": fpath.name, "source": "cbd"}
        )
    return templates


def match_best(gray: list[float], h: str, templates: list[dict]) -> tuple[str | None, float]:
    best_id, best_c = None, -1.0
    for t in templates:
        c = confidence(gray, h, t["gray"], t["hash"])
        if c > best_c:
            best_id, best_c = t["speciesId"], c
    return best_id, best_c


def score_library(templates: list[dict], label: str) -> dict:
    rows = []
    correct = 0
    total = 0
    by_fixture: dict[str, dict] = {}

    print(f"\n=== Library: {label} ({len(templates)} files / {len({t['speciesId'] for t in templates})} ids) ===")
    for fx in FIXTURES:
        im = Image.open(fx["path"]).convert("RGB")
        fx_ok = 0
        print(f"\n-- {fx['label']} --")
        print(f"{'slot':<4} {'expected':<14} {'matched':<14} {'conf':>6}  ok")
        for slot, expected in enumerate(fx["expected"]):
            crop = crop_slot(im, slot)
            gray = to_gray(crop)
            h = average_hash(gray)
            best_id, best_c = match_best(gray, h, templates)
            ok = best_id == expected and best_c >= CONFIDENCE_THRESHOLD
            if ok:
                correct += 1
                fx_ok += 1
            total += 1
            mark = "Y" if ok else "N"
            print(f"{slot:<4} {expected:<14} {best_id or '-':<14} {best_c:6.3f}  {mark}")
            rows.append(
                {
                    "fixture": fx["label"],
                    "slot": slot,
                    "expected": expected,
                    "matched": best_id,
                    "confidence": round(best_c, 4),
                    "ok": ok,
                }
            )
        by_fixture[fx["label"]] = {"correct": fx_ok, "total": len(fx["expected"])}

    return {
        "label": label,
        "correct": correct,
        "total": total,
        "accuracy": f"{correct}/{total}",
        "templateCount": len(templates),
        "speciesIdCount": len({t["speciesId"] for t in templates}),
        "byFixture": by_fixture,
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare ROI vs CBD template accuracy")
    parser.add_argument(
        "--library",
        choices=["roi", "cbd", "both"],
        default="both",
        help="Which library to score (default: both)",
    )
    args = parser.parse_args()

    roi_dir = ROOT / "public/templates"
    cbd_dir = ROOT / "assets/templates/preview-thumbs"

    results = {}
    if args.library in ("roi", "both"):
        roi_tmpls = load_roi_templates(roi_dir)
        if not roi_tmpls:
            print("No ROI templates loaded", file=sys.stderr)
            return 1
        results["roi"] = score_library(roi_tmpls, "ROI-only")
    if args.library in ("cbd", "both"):
        cbd_tmpls = load_cbd_templates(cbd_dir)
        if not cbd_tmpls:
            print("No CBD templates loaded", file=sys.stderr)
            return 1
        # Check expected species coverage
        expected_ids = {e for fx in FIXTURES for e in fx["expected"]}
        cbd_ids = {t["speciesId"] for t in cbd_tmpls}
        missing = sorted(expected_ids - cbd_ids)
        if missing:
            print(f"ERROR: CBD library missing expected ids: {missing}", file=sys.stderr)
            print("Fetch with: node scripts/fetch-cbd-templates.mjs --ids=" + ",".join(missing), file=sys.stderr)
            return 1
        results["cbd"] = score_library(cbd_tmpls, "CBD-only")

    if args.library != "both":
        # Single-library mode: just print, no compare docs
        key = args.library
        print(f"\nAccuracy ({key}): {results[key]['accuracy']}")
        return 0

    # Allowlist gap analysis
    allow = json.loads((ROOT / "data/allowlist.json").read_text(encoding="utf-8"))
    allow_ids = allow.get("showdownIds", [])
    roi_species = sorted({t["speciesId"] for t in load_roi_templates(roi_dir)})
    roi_gaps = [i for i in allow_ids if i not in set(roi_species)]

    roi = results["roi"]
    cbd = results["cbd"]

    # Merge per-slot table
    slot_table = []
    for i, r_row in enumerate(roi["rows"]):
        c_row = cbd["rows"][i]
        assert r_row["fixture"] == c_row["fixture"] and r_row["slot"] == c_row["slot"]
        slot_table.append(
            {
                "fixture": r_row["fixture"],
                "slot": r_row["slot"],
                "expected": r_row["expected"],
                "roiMatch": r_row["matched"],
                "roiConf": r_row["confidence"],
                "cbdMatch": c_row["matched"],
                "cbdConf": c_row["confidence"],
                "roiOk": r_row["ok"],
                "cbdOk": c_row["ok"],
            }
        )

    roi_acc = roi["correct"]
    cbd_acc = cbd["correct"]
    if cbd_acc < roi_acc - 1:
        verdict = "CBD clearly worse"
        verdict_detail = (
            f"CBD-only scored {cbd['accuracy']} vs ROI-only {roi['accuracy']} "
            f"({roi_acc - cbd_acc} fewer correct). CBD gap-fill is NOT worth using as primary; "
            "keep ROI crops as recognition default."
        )
    elif cbd_acc > roi_acc + 1:
        verdict = "CBD clearly better"
        verdict_detail = (
            f"CBD-only scored {cbd['accuracy']} vs ROI-only {roi['accuracy']}. "
            "Unexpected on these fixtures — investigate before changing defaults."
        )
    else:
        verdict = "similar"
        verdict_detail = (
            f"CBD-only {cbd['accuracy']} vs ROI-only {roi['accuracy']} — within 1 slot. "
            "ROI remains preferred for Team Preview (exact crop match); CBD stays optional secondary."
        )

    print(f"\n========== VERDICT: {verdict} ==========")
    print(f"ROI-only: {roi['accuracy']}")
    print(f"CBD-only: {cbd['accuracy']}")
    print(verdict_detail)
    print(f"ROI distinct species in public/templates: {len(roi_species)}")
    print(f"Top-50 allowlist gaps (missing from ROI): {len(roi_gaps)}")

    out_md = ROOT / "docs/compare-roi-vs-cbd.md"
    out_json = ROOT / "docs/compare-roi-vs-cbd.json"
    out_md.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        "# ROI-only vs CBD-only accuracy (Team Preview fixtures)",
        "",
        "## Summary",
        "",
        f"| Library | Accuracy | Templates | Distinct speciesIds |",
        f"|---------|----------|-----------|---------------------|",
        f"| ROI-only (`public/templates/`, source roi-crop) | **{roi['accuracy']}** | {roi['templateCount']} | {roi['speciesIdCount']} |",
        f"| CBD-only (`assets/templates/preview-thumbs/`, source cbd) | **{cbd['accuracy']}** | {cbd['templateCount']} | {cbd['speciesIdCount']} |",
        "",
        f"**Verdict: {verdict}**",
        "",
        verdict_detail,
        "",
        "### Per-fixture",
        "",
        "| Fixture | ROI | CBD |",
        "|---------|-----|-----|",
    ]
    for fx in FIXTURES:
        lab = fx["label"]
        rf = roi["byFixture"][lab]
        cf = cbd["byFixture"][lab]
        lines.append(f"| {lab} | {rf['correct']}/{rf['total']} | {cf['correct']}/{cf['total']} |")

    lines += [
        "",
        "## Matcher (locked)",
        "",
        "- ROI Doc v1.2: ENEMY_PANEL left 0.811 top 0.143 right 0.965 bottom 0.832",
        "- THUMB_CROP left 0.20 right 0.55 topInset 0.25 bottomInset 0.05; TEMPLATE_SIZE 64",
        "- Score: NCC×0.55 + SSD×0.25 + aHash×0.20; threshold 0.55",
        "- Same crop path for both libraries (fixture slot → gray/hash → best template)",
        "- ROI constants **not** changed",
        "",
        "## Per-slot comparison",
        "",
        "| fixture | slot | expected | ROI match | ROI conf | CBD match | CBD conf | ROI ok | CBD ok |",
        "|---------|------|----------|-----------|----------|-----------|----------|--------|--------|",
    ]
    for r in slot_table:
        lines.append(
            f"| {r['fixture']} | {r['slot']} | {r['expected']} | {r['roiMatch']} | {r['roiConf']:.4f} | "
            f"{r['cbdMatch']} | {r['cbdConf']:.4f} | {'Y' if r['roiOk'] else 'N'} | {'Y' if r['cbdOk'] else 'N'} |"
        )

    lines += [
        "",
        "## ROI library coverage vs top-50 allowlist",
        "",
        f"- Distinct ROI species in `public/templates/`: **{len(roi_species)}**",
        f"- Top-50 allowlist (`data/allowlist.json` showdownIds): **{len(allow_ids)}**",
        f"- Allowlist ids **missing** from ROI library: **{len(roi_gaps)}**",
        "",
    ]
    if roi_gaps:
        lines += [
            "### Top-50 showdownIds missing from ROI (gap list)",
            "",
            "Do **not** invent crops. Prefer future ROI crops from real Team Preview captures.",
            "",
        ]
        for i, sid in enumerate(roi_gaps, 1):
            lines.append(f"{i}. `{sid}`")
        lines.append("")

    lines += [
        "## Notes",
        "",
        "- Do **not** put CBD into `public/templates/` as primary recognition library.",
        "- CBD menu sprites remain optional secondary / gap-fill only if ROI coverage is incomplete.",
        "- Script: `scripts/compare-roi-vs-cbd.py` (`--library=roi|cbd|both`).",
        "",
    ]
    out_md.write_text("\n".join(lines), encoding="utf-8")

    payload = {
        "verdict": verdict,
        "verdictDetail": verdict_detail,
        "threshold": CONFIDENCE_THRESHOLD,
        "roi": {
            "accuracy": roi["accuracy"],
            "correct": roi["correct"],
            "total": roi["total"],
            "templateCount": roi["templateCount"],
            "speciesIdCount": roi["speciesIdCount"],
            "byFixture": roi["byFixture"],
            "distinctSpecies": roi_species,
        },
        "cbd": {
            "accuracy": cbd["accuracy"],
            "correct": cbd["correct"],
            "total": cbd["total"],
            "templateCount": cbd["templateCount"],
            "speciesIdCount": cbd["speciesIdCount"],
            "byFixture": cbd["byFixture"],
        },
        "slotTable": slot_table,
        "allowlist": {
            "topN": allow.get("topN", len(allow_ids)),
            "count": len(allow_ids),
            "roiDistinctCount": len(roi_species),
            "missingFromRoiCount": len(roi_gaps),
            "missingFromRoi": roi_gaps,
        },
        "roiLocked": {"ENEMY_PANEL": ENEMY_PANEL, "THUMB_CROP": THUMB_CROP, "CARD_GAP_FRAC": CARD_GAP_FRAC, "TEMPLATE_SIZE": TEMPLATE_SIZE},
    }
    out_json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {out_md.relative_to(ROOT)}")
    print(f"Wrote {out_json.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
