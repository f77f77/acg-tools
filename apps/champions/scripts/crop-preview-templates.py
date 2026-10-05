#!/usr/bin/env python3
"""
Crop Team Preview enemy thumbs using the SAME constants as src/lib/roi.ts (ROI square-thumb + sprite_poke_3).

Usage:
  python scripts/crop-preview-templates.py [source.png] [out_dir]
  python scripts/crop-preview-templates.py public/fixtures/team-preview-live-latest.jpg \\
      --slots=froslass,garchomp,basculegion,kingambit,sneasler,golisopod --merge

Defaults: public/fixtures/team-preview-live-latest.jpg → public/templates/

Do NOT change panel/thumb numbers here without updating roi.ts (and Doc) in lockstep.
Forms/Mega/shiny, Rotom appliances, Lycanroc day/night, Hippowdon gender colors
need separate template files when expanded.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:
    raise SystemExit("Need Pillow: pip install pillow") from e

ROOT = Path(__file__).resolve().parents[1]

# Locked — mirror src/lib/roi.ts
ENEMY_PANEL = {"left": 0.811, "top": 0.137, "right": 0.965, "bottom": 0.836}
THUMB_CROP = {"left": 0.18, "right": 0.60, "topInset": 0.0, "bottomInset": 0.0}  # square inset inside card body
TEMPLATE_SIZE = 64
SLOT_COUNT = 6
CARD_GAP_FRAC = 0.08  # fraction of pitch that is inter-card gap (mirror src/lib/roi.ts)

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

PANEL_OUTER_MARGIN_FRAC = 0.02  # green visual outer pad (content-height frac; mirror roi.ts)
TARGET_ASPECT = 16 / 9

# VGC seed showdownIds (圖二 top→bottom). Label files with these ids.
SEED_SLOTS = [
    {"speciesId": "noivern", "speciesNameZh": "音爆音波", "formNote": None},
    {"speciesId": "lycanroc", "speciesNameZh": "鬃岩狼人", "formNote": "Midday / 白晝"},
    {"speciesId": "politoed", "speciesNameZh": "蚊香蛙皇", "formNote": None},
    {"speciesId": "rotom", "speciesNameZh": "洛托姆", "formNote": "base form (not appliances)"},
    {"speciesId": "kangaskhan", "speciesNameZh": "袋獸", "formNote": None},
    {"speciesId": "hippowdon", "speciesNameZh": "河馬獸", "formNote": None},
]

ZH_FALLBACK = {
    "charizard": "噴火龍",
    "aerodactyl": "化石翼龍",
    "meowscarada": "魔幻假面喵",
    "garchomp": "烈咬陸鯊",
    "rotomwash": "清洗洛托姆",
    "aegislash": "堅盾劍怪",
    "whimsicott": "風妖精",
    "basculegion": "幽尾玄魚",
    "kingambit": "仆刀將軍",
    "sneasler": "大狃拉",
    "ninetalesalola": "阿羅拉九尾",
    "empoleon": "帝王拿波",
    "staraptor": "姆克鷹",
}

def letterbox_to_template(im: Image.Image) -> Image.Image:
    """Contain/letterbox into TEMPLATE_SIZE (black pad; never stretch)."""
    rgb = im.convert("RGB")
    canvas = Image.new("RGB", (TEMPLATE_SIZE, TEMPLATE_SIZE), (0, 0, 0))
    w, h = rgb.size
    scale = min(TEMPLATE_SIZE / max(1, w), TEMPLATE_SIZE / max(1, h))
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    resized = rgb.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((TEMPLATE_SIZE - nw) // 2, (TEMPLATE_SIZE - nh) // 2))
    return canvas



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


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("source", nargs="?", default=str(ROOT / "public/fixtures/team-preview-live-latest.jpg"))
    p.add_argument("out_dir", nargs="?", default=str(ROOT / "public/templates"))
    p.add_argument(
        "--slots",
        default=None,
        help="Comma-separated showdownIds for the 6 enemy slots (top→bottom). "
        "Default: 圖二 seed order.",
    )
    p.add_argument(
        "--merge",
        action="store_true",
        help="Merge new crops into existing manifest.json (by speciesId) instead of replacing.",
    )
    p.add_argument("--fixture-label", default=None, help="Optional fixture label stored in manifest entries.")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    src = Path(args.source)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.slots:
        ids = [s.strip() for s in args.slots.split(",") if s.strip()]
        if len(ids) != SLOT_COUNT:
            raise SystemExit(f"--slots needs exactly {SLOT_COUNT} ids, got {len(ids)}: {ids}")
        slots_meta = [
            {
                "speciesId": sid,
                "speciesNameZh": ZH_FALLBACK.get(sid, sid),
                "formNote": None,
            }
            for sid in ids
        ]
    else:
        slots_meta = list(SEED_SLOTS)

    fixture_label = args.fixture_label or src.stem

    im = Image.open(src).convert("RGB")
    cx, cy, cw, ch = content_rect(*im.size)
    px = int(cx + ENEMY_PANEL["left"] * cw)
    py = int(cy + ENEMY_PANEL["top"] * ch)
    pw = max(1, int((ENEMY_PANEL["right"] - ENEMY_PANEL["left"]) * cw))
    ph = max(1, int((ENEMY_PANEL["bottom"] - ENEMY_PANEL["top"]) * ch))

    templates = []
    for slot, meta in enumerate(slots_meta):
        pitch = ph / SLOT_COUNT
        # Match app recognition crop === overlay yellow (card body via CARD_GAP_FRAC).
        gap = CARD_GAP_FRAC
        body_h = pitch * (1 - gap)
        top_inset = pitch * (gap / 2)
        sx, sw = px, pw
        sy = int(py + slot * pitch + top_inset)
        sh = max(1, int(body_h))
        tx, ty, side = yellow_rect_from_card(sx, sy, sw, sh)
        tw = th = side
        crop = letterbox_to_template(im.crop((tx, ty, tx + tw, ty + th)))
        sid = meta["speciesId"]
        dest = out_dir / f"{sid}.png"
        crop.save(dest, "PNG")
        entry = {
            **meta,
            "file": f"{sid}.png",
            "slotSource": slot,
            "cropPx": {"x": tx, "y": ty, "w": tw, "h": th},
            "source": "roi-crop",
            "fixture": fixture_label,
        }
        templates.append(entry)
        print(f"{slot + 1} {sid} -> {dest.relative_to(ROOT)}")

    manifest_path = out_dir / "manifest.json"
    if args.merge and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        by_id = {t["speciesId"]: t for t in manifest.get("templates", [])}
        for t in templates:
            by_id[t["speciesId"]] = t
        seed_order = [s["speciesId"] for s in SEED_SLOTS]
        merged = []
        for sid in seed_order:
            if sid in by_id:
                merged.append(by_id.pop(sid))
        for sid in sorted(by_id.keys()):
            merged.append(by_id[sid])
        templates = merged
        source_note = manifest.get("source", "roi-crop")
        if fixture_label not in str(source_note):
            source_note = f"{source_note} + {fixture_label}"
    else:
        source_note = str(src)
        manifest = {}

    manifest.update(
        {
            "source": source_note,
            "roiDoc": "v1.2",
            "panel": ENEMY_PANEL,
            "thumbCrop": THUMB_CROP,
            "templateSize": TEMPLATE_SIZE,
            "notes": (
                "PRIMARY recognition templates: ROI square-thumb + sprite_poke_3 Team Preview crops (NOT HOME art). "
                "Forms/Mega/shiny separate later. CBD menu sprites under "
                "assets/templates/preview-thumbs/ (source: cbd) are optional secondary."
            ),
            "templates": templates,
            "defaultSource": "roi-crop",
            "sourceKind": "roi-crop",
        }
    )
    # Guard: ROI must stay locked
    assert manifest["panel"] == ENEMY_PANEL
    assert manifest["thumbCrop"] == THUMB_CROP
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("wrote", manifest_path.relative_to(ROOT), f"({len(templates)} templates)")


if __name__ == "__main__":
    main()
