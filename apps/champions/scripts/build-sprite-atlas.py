#!/usr/bin/env python3
"""Build public/sprites/{sprite_poke.png, sprite_poke.css, atlas.json}.

Prefer an official master sheet + CSS (percent→pixel). Otherwise pack the
legacy per-species sprite_poke_3 cells into one sheet keyed by nationalDex.

Never writes hundreds of tiny per-species PNGs.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

from lib_sprite_sheet import (
    CELL,
    DEFAULT_COLS,
    ROOT,
    TEMPLATE_SIZE,
    crop_template,
    dex_key,
    emit_css_rule,
    form_suffix_from_key,
    load_allowlist,
    load_pokemon_types,
    parse_sprite_css,
)

OUT_DIR = ROOT / "public/sprites"
HANDOFF_DIRS = [
    ROOT / "sprite-sheet-handoff",
    Path("/workspace/sprite-sheet-handoff"),
    ROOT,
]


def _find_official() -> tuple[Path, Path] | None:
    """Locate user-provided master sheet + CSS if present."""
    sheet_names = (
        "sprite_sheet.png",
        "sprite_poke.png",
        "official-sprite-poke-3-channel.png",
    )
    css_names = (
        "sprite_poke.css",
        "champ-sprite_poke_3.css",
        "sprite_poke_3.css",
    )
    for d in HANDOFF_DIRS:
        sheets = [d / n for n in sheet_names if (d / n).exists()]
        csss = [d / n for n in css_names if (d / n).exists()]
        if sheets and csss:
            return sheets[0], csss[0]
    # Do not treat the already-packed public/sprites output as an "official"
    # handoff — CSS percent rounding / re-parse would rewrite atlas coords.
    return None


def _allow_index() -> dict[tuple[int, int], dict]:
    out: dict[tuple[int, int], dict] = {}
    for e in load_allowlist():
        dex = int(e["nationalDex"])
        form = int(e.get("form") or 0)
        out[(dex, form)] = e
    return out


def _entry_from_allow(
    allow: dict,
    rect: dict[str, int],
    type_map: dict[str, list[str]],
) -> dict:
    dex = int(allow["nationalDex"])
    form = int(allow.get("form") or 0)
    sid = allow["showdownId"]
    suffix = form_suffix_from_key(allow.get("formKey"))
    aliases = []
    if suffix:
        named = f"{dex}-{suffix}"
        if named != dex_key(dex, form):
            aliases.append(named)
    return {
        "dexKey": dex_key(dex, form),
        "dexAliases": aliases,
        "nationalDex": dex,
        "form": form,
        "formSuffix": suffix,
        "speciesId": sid,
        "speciesNameZh": allow.get("zhHant") or sid,
        "speciesNameEn": allow.get("formKey") or sid,
        "formKey": allow.get("formKey"),
        "x": rect["x"],
        "y": rect["y"],
        "w": rect["w"],
        "h": rect["h"],
        "types": type_map.get(sid, []),
        "source": "sprite_sheet",
    }


def build_from_official(sheet_path: Path, css_path: Path, type_map: dict[str, list[str]]) -> dict:
    sheet = Image.open(sheet_path).convert("RGBA")
    sw, sh = sheet.size
    css_text = css_path.read_text(encoding="utf-8", errors="replace")
    pos = parse_sprite_css(css_text, sheet_w=sw, sheet_h=sh, cell=CELL)
    allow = _allow_index()
    entries = []
    unmatched = []
    # Only exact (dex, form) cells — never alias a different form onto form-0 art.
    for key, rect in sorted(pos.items()):
        rec = allow.get(key)
        if rec:
            entries.append(_entry_from_allow(rec, rect, type_map))
        else:
            unmatched.append(f"{key[0]}-{key[1]}")
    if unmatched:
        print(f"CSS cells without allowlist map: {len(unmatched)} (ok if extras)")
    print(f"CSS map: {len(pos)} cells → {len(entries)} allowlisted exact dex+form matches")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest_png = OUT_DIR / "sprite_poke.png"
    dest_css = OUT_DIR / "sprite_poke.css"
    if sheet_path.resolve() != dest_png.resolve():
        shutil.copy2(sheet_path, dest_png)
    if css_path.resolve() != dest_css.resolve():
        dest_css.write_text(css_text, encoding="utf-8")
    atlas = {
        "version": 2,
        "primaryKey": "nationalDex",
        "sheet": "sprite_poke.png",
        "css": "sprite_poke.css",
        "cell": CELL,
        "sheetSize": [sw, sh],
        "source": "official sprite sheet + CSS (in-memory crops; no per-species PNG dump)",
        "notes": (
            "Templates are cropped in memory from this sheet using CSS/atlas rects. "
            "Key = nationalDex or nationalDex-form (e.g. 6, 38-1, 6-mega-x alias)."
        ),
        "entries": entries,
        "entryCount": len(entries),
    }
    (OUT_DIR / "atlas.json").write_text(
        json.dumps(atlas, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Official sheet {sw}×{sh} → {len(entries)} dex-keyed atlas entries")
    return atlas


def build_from_legacy_cells(type_map: dict[str, list[str]]) -> dict:
    """Pack leftover public/templates/{showdownId}.png into one dex-keyed sheet."""
    manifest_path = ROOT / "public/templates/manifest.json"
    tmpl_dir = ROOT / "public/templates"
    if not manifest_path.exists():
        raise SystemExit("No official sheet/CSS and no public/templates/manifest.json to pack")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    allow = _allow_index()
    by_sid = {e["showdownId"]: e for e in allow.values()}

    wanted: list[dict] = []
    seen: set[str] = set()
    for t in manifest.get("templates") or []:
        sid = t.get("speciesId")
        if not sid or sid in seen:
            continue
        fpath = tmpl_dir / t.get("file", f"{sid}.png")
        if not fpath.exists():
            print("skip missing", fpath.name)
            continue
        rec = by_sid.get(sid)
        if rec is None:
            # fixture extras not in allowlist: use manifest sheetCell
            cell = t.get("sheetCell") or {}
            rec = {
                "nationalDex": int(cell.get("dex") or 0),
                "form": int(cell.get("form") or 0),
                "showdownId": sid,
                "zhHant": t.get("speciesNameZh") or sid,
                "formKey": sid,
            }
            if not rec["nationalDex"]:
                print("skip no dex", sid)
                continue
        wanted.append({"allow": rec, "path": fpath})
        seen.add(sid)

    if not wanted:
        raise SystemExit("No legacy template PNGs found to pack")

    wanted.sort(key=lambda r: (int(r["allow"]["nationalDex"]), int(r["allow"].get("form") or 0)))
    n = len(wanted)
    cols = DEFAULT_COLS
    rows = max(1, (n + cols - 1) // cols)
    sheet_w, sheet_h = cols * CELL, rows * CELL
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    css_parts = [
        "/* Dex-keyed Champions-style sprite CSS. Runtime crops in memory; do not cut per-species PNGs. */\n",
        f"/* sheet {sheet_w}x{sheet_h} cell {CELL} cols {cols} rows {rows} */\n",
    ]
    entries = []
    for i, item in enumerate(wanted):
        rec = item["allow"]
        col, row = i % cols, i // cols
        x, y = col * CELL, row * CELL
        src = Image.open(item["path"]).convert("RGBA")
        # Center in the 128 cell WITHOUT upscaling (2× LANCZOS + downscale caused FPs).
        tw, th = src.size
        if tw > CELL or th > CELL:
            scale = min(CELL / tw, CELL / th)
            tw, th = max(1, int(round(tw * scale))), max(1, int(round(th * scale)))
            src = src.resize((tw, th), Image.Resampling.LANCZOS)
        ox, oy = (CELL - tw) // 2, (CELL - th) // 2
        # Raw RGBA copy — paste(..., mask=src) alpha-blends onto the canvas
        # and changes edge pixels (was the Meowscarada/Talonflame FP source).
        sheet.paste(src, (x + ox, y + oy))
        dex = int(rec["nationalDex"])
        form = int(rec.get("form") or 0)
        css_parts.append(emit_css_rule(dex, form, col, row, cols, rows, sheet_w, sheet_h))
        entries.append(
            _entry_from_allow(rec, {"x": x, "y": y, "w": CELL, "h": CELL}, type_map)
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_DIR / "sprite_poke.png", "PNG")
    (OUT_DIR / "sprite_poke.css").write_text("".join(css_parts), encoding="utf-8")
    atlas = {
        "version": 2,
        "primaryKey": "nationalDex",
        "sheet": "sprite_poke.png",
        "css": "sprite_poke.css",
        "cell": CELL,
        "sheetSize": [sheet_w, sheet_h],
        "source": (
            "packed sprite_poke_3 cells (legacy per-file templates) into one sheet; "
            "replace with official sheet+CSS via this script when available"
        ),
        "notes": (
            "Recognition crops these cells in memory. Primary key = nationalDex "
            "(form suffix if needed). Do not explode back into per-species PNGs."
        ),
        "entries": entries,
        "entryCount": len(entries),
    }
    (OUT_DIR / "atlas.json").write_text(
        json.dumps(atlas, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # Confirm in-memory center-64 extract matches the source 64×64 files.
    packed = Image.open(OUT_DIR / "sprite_poke.png").convert("RGBA")
    lossless = 0
    for item, entry in zip(wanted, entries):
        src = Image.open(item["path"]).convert("RGBA")
        if src.size != (TEMPLATE_SIZE, TEMPLATE_SIZE):
            continue
        crop = crop_template(packed, entry)
        if crop.tobytes() == src.tobytes():
            lossless += 1
        else:
            print(f"WARN crop != source for {entry['speciesId']}")
    print(f"Packed {n} legacy cells → {sheet_w}×{sheet_h} ({cols}×{rows}); lossless 64×64 extracts {lossless}")
    return atlas


def deprecate_legacy_pngs(*, delete: bool) -> int:
    tmpl = ROOT / "public/templates"
    n = 0
    for p in tmpl.glob("*.png"):
        n += 1
        if delete:
            p.unlink()
    if delete and n:
        print(f"Removed {n} legacy name-keyed PNGs from public/templates/")
    elif n:
        print(f"Legacy PNGs still present: {n} (pass --delete-legacy-pngs to remove)")
    return n


def verify_crops(atlas: dict) -> None:
    sheet = Image.open(OUT_DIR / "sprite_poke.png").convert("RGBA")
    ok = 0
    for e in atlas["entries"][:5]:
        im = crop_template(sheet, e)
        if im.size == (64, 64):
            ok += 1
    print(f"Verify: sample in-memory crops {ok}/5 → 64×64")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build dex-keyed sprite atlas (no per-species PNG dump)")
    ap.add_argument("--sheet", type=Path, help="Official master sheet PNG")
    ap.add_argument("--css", type=Path, help="Official sprite_poke.css")
    ap.add_argument(
        "--pack-legacy",
        action="store_true",
        help="Force pack from public/templates/*.png even if a handoff sheet exists",
    )
    ap.add_argument("--delete-legacy-pngs", action="store_true", help="Remove public/templates/*.png")
    args = ap.parse_args()

    type_map = load_pokemon_types()
    official = None
    if not args.pack_legacy:
        if args.sheet and args.css:
            official = (args.sheet, args.css)
        else:
            official = _find_official()

    if official:
        sheet_path, css_path = official
        print(f"Using official/handoff sheet: {sheet_path} + {css_path}")
        atlas = build_from_official(sheet_path, css_path, type_map)
    else:
        print("No official sheet+CSS found; packing leftover public/templates cells")
        atlas = build_from_legacy_cells(type_map)

    verify_crops(atlas)
    deprecate_legacy_pngs(delete=args.delete_legacy_pngs)
    print(f"Wrote {OUT_DIR.relative_to(ROOT)}/sprite_poke.png + sprite_poke.css + atlas.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
