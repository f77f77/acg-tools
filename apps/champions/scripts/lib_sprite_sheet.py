#!/usr/bin/env python3
"""Shared sprite-sheet helpers: CSS percent→pixel, dex keys, in-memory crops.

Primary key is nationalDex (+ form), not English/Chinese filenames.
Do not write per-species PNG files from this module.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CELL = 128
TEMPLATE_SIZE = 64
DEFAULT_COLS = 17

# Champions web CSS: .sprite-poke-ui_PokeIcon_02_{dex}_{form}_{variant}
CSS_CLASS_RE = re.compile(
    r"\.(?:sprite-poke-ui_PokeIcon_02_|poke-icon_|dex-)(\d+)(?:[_-](\d+))?(?:[_-](\d+))?",
    re.I,
)
BG_SIZE_RE = re.compile(
    r"background-size:\s*([0-9.]+)(px|%)?\s+([0-9.]+)(px|%)?",
    re.I,
)
BG_POS_RE = re.compile(
    r"background-position:\s*([-+0-9.]+)(px|%)?\s+([-+0-9.]+)(px|%)?",
    re.I,
)
RULE_RE = re.compile(r"([^{]+)\{([^}]+)\}", re.S)


def dex_key(national_dex: int, form: int = 0, suffix: str | None = None) -> str:
    """Primary atlas key: '6' or '6-1'. Named suffix is an alias, not the primary."""
    if form and form > 0:
        return f"{int(national_dex)}-{int(form)}"
    return str(int(national_dex))


def form_suffix_from_key(form_key: str | None) -> str | None:
    """ninetales-alola → alola; charizard-mega-x → mega-x; rotom-wash → wash."""
    if not form_key or "-" not in form_key:
        return None
    _, rest = form_key.split("-", 1)
    rest = rest.strip().lower()
    return rest or None


def css_percent_to_px(percent: float, sheet_px: int, cell_px: int = CELL) -> int:
    """CSS background-position % → pixel offset for a cell-sized viewport."""
    if sheet_px <= cell_px:
        return 0
    return int(round((sheet_px - cell_px) * (percent / 100.0)))


def parse_sprite_css(
    css_text: str,
    *,
    sheet_w: int,
    sheet_h: int,
    cell: int = CELL,
) -> dict[tuple[int, int], dict[str, int]]:
    """Parse Champions-style CSS into (dex, form) → {x,y,w,h} pixel rects."""
    out: dict[tuple[int, int], dict[str, int]] = {}
    for m in RULE_RE.finditer(css_text):
        selector, body = m.group(1), m.group(2)
        cm = CSS_CLASS_RE.search(selector)
        if not cm:
            continue
        dex = int(cm.group(1))
        form = int(cm.group(2) or 0)
        size_m = BG_SIZE_RE.search(body)
        pos_m = BG_POS_RE.search(body)
        if not pos_m:
            continue
        bg_w, bg_h = sheet_w, sheet_h
        if size_m and (size_m.group(2) or "px") != "%":
            bg_w = int(round(float(size_m.group(1))))
            bg_h = int(round(float(size_m.group(3))))
        x_raw, x_unit = float(pos_m.group(1)), (pos_m.group(2) or "px")
        y_raw, y_unit = float(pos_m.group(3)), (pos_m.group(4) or "px")
        if x_unit == "%":
            x = css_percent_to_px(x_raw, bg_w, cell)
        else:
            x = int(round(-x_raw if x_raw < 0 else x_raw))
        if y_unit == "%":
            y = css_percent_to_px(y_raw, bg_h, cell)
        else:
            y = int(round(-y_raw if y_raw < 0 else y_raw))
        x = max(0, min(x, max(0, sheet_w - 1)))
        y = max(0, min(y, max(0, sheet_h - 1)))
        w = min(cell, sheet_w - x)
        h = min(cell, sheet_h - y)
        if w < 8 or h < 8:
            continue
        out[(dex, form)] = {"x": x, "y": y, "w": w, "h": h}
    return out


def emit_css_rule(dex: int, form: int, col: int, row: int, cols: int, rows: int, sheet_w: int, sheet_h: int) -> str:
    x_pct = 0.0 if cols <= 1 else (col / (cols - 1)) * 100.0
    y_pct = 0.0 if rows <= 1 else (row / (rows - 1)) * 100.0
    cls = f"sprite-poke-ui_PokeIcon_02_{dex:04d}_{form:02d}_00"
    return (
        f".{cls} {{\n"
        f"  background-size: {sheet_w}px {sheet_h}px;\n"
        f"  background-position: {x_pct:.5f}% {y_pct:.5f}%;\n"
        f"}}\n"
    )


def is_visible_pixel(r: int, g: int, b: int, a: int, *, alpha_thr: int = 12, rgb_sum_thr: int = 8) -> bool:
    """Treat near-black sheet BG as empty; keep dark-but-colored bodies (Greninja)."""
    return a > alpha_thr and (r + g + b) > rgb_sum_thr


def trim_content(im: Image.Image, pad: int = 1, thr: int = 12) -> Image.Image:
    """Tight crop around opaque / non-black sprite pixels (handles black-bg sheets)."""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = list(rgba.getdata())
    xs: list[int] = []
    ys: list[int] = []
    for i, (r, g, b, a) in enumerate(px):
        if not is_visible_pixel(r, g, b, a, alpha_thr=thr):
            continue
        xs.append(i % w)
        ys.append(i // w)
    if len(xs) < 8:
        return rgba
    x0 = max(0, min(xs) - pad)
    x1 = min(w, max(xs) + 1 + pad)
    y0 = max(0, min(ys) - pad)
    y1 = min(h, max(ys) + 1 + pad)
    return rgba.crop((x0, y0, x1, y1))


def letterbox_rgba(im: Image.Image, size: int = TEMPLATE_SIZE) -> Image.Image:
    """Contain/letterbox into size×size with transparent pad (never stretch)."""
    cell = trim_content(im.convert("RGBA"))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    w, h = cell.size
    scale = min(size / max(1, w), size / max(1, h))
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    resized = cell.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return canvas


def crop_cell(sheet: Image.Image, rect: dict[str, int]) -> Image.Image:
    x, y, w, h = int(rect["x"]), int(rect["y"]), int(rect["w"]), int(rect["h"])
    return sheet.crop((x, y, x + w, y + h))


def crop_template(sheet: Image.Image, rect: dict[str, int], size: int = TEMPLATE_SIZE) -> Image.Image:
    """In-memory cell crop → 64×64 contain (no per-file write).

    If a TEMPLATE_SIZE image was packed centered in a larger cell (legacy pack),
    extract it losslessly so we do not re-trim and change match scale.
    Otherwise content-trim the official 128 cell and contain.
    """
    cell = crop_cell(sheet, rect).convert("RGBA")
    w, h = cell.size
    if w == size and h == size:
        return cell
    if w >= size and h >= size:
        ox, oy = (w - size) // 2, (h - size) // 2
        centered = cell.crop((ox, oy, ox + size, oy + size))

        def _vis(im: Image.Image) -> int:
            n = 0
            for r, g, b, a in im.getdata():
                if is_visible_pixel(r, g, b, a):
                    n += 1
            return n

        full_v = _vis(cell)
        cen_v = _vis(centered)
        # Legacy pack: a 64×64 icon centered in a larger cell. Official 128 cells
        # with dark bodies (Greninja) used to trip this and yield a head-only crop.
        if full_v > 0 and cen_v >= 0.9 * full_v:
            return centered
    return letterbox_rgba(cell, size)


def load_allowlist(path: Path | None = None) -> list[dict[str, Any]]:
    p = path or (ROOT / "data/allowlist.json")
    data = json.loads(p.read_text(encoding="utf-8"))
    return list(data.get("entries") or [])


def load_pokemon_types() -> dict[str, list[str]]:
    path = ROOT / "data/pokemon.json"
    if not path.exists():
        path = ROOT / "public/data/pokemon.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, list[str]] = {}
    for rec in rows:
        sid = rec.get("showdownId")
        if not sid:
            continue
        types = [str(t).lower() for t in (rec.get("types") or [])]
        out[sid] = types
    return out


def load_atlas(atlas_path: Path) -> dict[str, Any]:
    return json.loads(atlas_path.read_text(encoding="utf-8"))


def templates_from_sheet(
    sheet: Image.Image,
    atlas: dict[str, Any],
    type_map: dict[str, set[str]] | dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    """Build in-memory match templates from one sheet + atlas (no tiny PNG I/O)."""
    type_map = type_map or {}
    templates: list[dict[str, Any]] = []
    for entry in atlas.get("entries") or []:
        rect = {
            "x": int(entry["x"]),
            "y": int(entry["y"]),
            "w": int(entry.get("w") or atlas.get("cell") or CELL),
            "h": int(entry.get("h") or atlas.get("cell") or CELL),
        }
        im = crop_template(sheet, rect)
        arr = im
        templates.append(
            {
                "dexKey": entry["dexKey"],
                "nationalDex": int(entry["nationalDex"]),
                "form": int(entry.get("form") or 0),
                "speciesId": entry["speciesId"],
                "speciesNameZh": entry.get("speciesNameZh") or entry["speciesId"],
                "image": arr,
                "types": set(type_map.get(entry["speciesId"], entry.get("types") or [])),
                "meta": entry,
            }
        )
    return templates
