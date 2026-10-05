#!/usr/bin/env python3
"""
Match Team Preview test fixtures against in-memory crops from
public/sprites/sprite_poke.png (dex-keyed atlas / CSS).

Pipeline (pose/scale alignment + false-positive guards):
  1. Yellow square ROI (side = red card height; locked panel + THUMB left)
  2. Crop cleanup: zero right MATCH_CROP_RIGHT_EXCLUDE_FRAC (type/gender bleed);
     type verification stays on full card top-right (unchanged yellow geometry)
  3. Suppress near-maroon card background → black
  4. Content-aware square recenter on non-black sprite blob
  5. Resize to TEMPLATE_SIZE (square crop → no letterbox pad)
  6. aHash Hamming prefilter → top AHASH_TOP_K (or all ham≤AHASH_MAX_HAM)
  7. Multi-scale + small translation sweep of query
  8. Grayscale NCC/SSD/aHash with mask = template_alpha ∩ query_nonblack
  9. Coarse hue hist soft penalty (×0.85 if far from template)
 10. Type hard second gate when detection conf ≥ TYPE_MATCH_THR; skip veto if low-conf
 11. Dynamic margin(conf) + CONFIDENCE_THRESHOLD → else speciesId=null (prefer unidentified)

ROI constants locked — mirror src/lib/roi.ts / src/lib/recognize.ts.
Debug: pass --debug for per-slot reject reasons / top candidates / aHash ranks.
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

try:
    import numpy as np
except ImportError as e:
    raise SystemExit("Need numpy") from e

from lib_sprite_sheet import crop_template, load_atlas

ROOT = Path(__file__).resolve().parents[1]
SPRITES_DIR = ROOT / "public/sprites"

# Locked — mirror src/lib/roi.ts (DO NOT change panel / yellow / CARD_GAP)
ENEMY_PANEL = {"left": 0.811, "top": 0.137, "right": 0.965, "bottom": 0.836}
THUMB_CROP = {"left": 0.18, "right": 0.60, "topInset": 0.0, "bottomInset": 0.0}
TEMPLATE_SIZE = 64
SLOT_COUNT = 6
CARD_GAP_FRAC = 0.08
PANEL_OUTER_MARGIN_FRAC = 0.02
TARGET_ASPECT = 16 / 9

CONFIDENCE_THRESHOLD = 0.54
MIN_MARGIN = 0.08  # fallback / floor for required_margin()
AHASH_TOP_K = 40  # fixture-tuned; prefer null over wrong on full 262 atlas
AHASH_MAX_HAM = 18
HUE_BINS = 8
HUE_DIST_THR = 0.75
HUE_PENALTY = 0.85
TYPE_MATCH_THR = 0.58  # hard veto only when type-icon score ≥ this (else skip)
# 2nd icon needs a higher score (Ghost vs Poison purple FP on Basculegion-M).
TYPE_MATCH_SECOND_THR = 0.66
AHASH_TYPE_RESCUE_EXTRA_HAM = 8
TYPE_ICON_FRACS = (0.36, 0.42, 0.48)
# Zero right edge of yellow match crop (type panel bleed). Does NOT change yellow ROI.
MATCH_CROP_RIGHT_EXCLUDE_FRAC = 0.05

MATCH_SCALES = (0.9, 1.0, 1.1, 1.2, 1.35, 1.55)
MATCH_SHIFTS = (-8, -4, 0, 4, 8)


def required_margin(confidence: float) -> float:
    """Dynamic top1−top2 margin: high conf → smaller required gap (fixture-tuned).

    ≥0.75→0.025, ≥0.68→0.03, ≥0.60→0.05, ≥0.54→0.055, else MIN_MARGIN(0.08).
    Never loosens enough to reintroduce wrong-species FPs on the test fixtures.
    """
    if confidence >= 0.75:
        return 0.025
    if confidence >= 0.68:
        return 0.03
    if confidence >= 0.60:
        return 0.05
    if confidence >= 0.54:
        return 0.055
    return MIN_MARGIN


# Soft type (below hard veto) may break a near-tie toward the matching species.
TYPE_SOFT_THR = 0.45
TYPE_TIE_MAX_GAP = 0.03
TYPE_TIE_MAX_GAP_DUAL = 0.05
TYPE_VETO_OVERRIDE_DELTA = 0.12

LIVE_LATEST_EXPECTED = [
    "froslass",
    "garchomp",
    "basculegion",  # Basculegion-M
    "kingambit",
    "sneasler",
    "golisopod",  # Bug/Water; not Araquanid
]

FIXTURES = [
    {
        "path": ROOT / "public/fixtures/team-preview-live-latest.jpg",
        "label": "team-preview-live-latest",
        "expected": list(LIVE_LATEST_EXPECTED),
    },
    {
        "path": ROOT / "public/fixtures/team-preview-test-1.jpg",
        "label": "team-preview-test-1",
        "expected": list(LIVE_LATEST_EXPECTED),  # same bytes as live-latest
    },
    {
        "path": ROOT / "public/fixtures/team-preview-test-2.jpg",
        "label": "team-preview-test-2",
        "expected": [
            "chesnaught",
            "mimikyu",
            "ninetalesalola",
            "swampert",
            "typhlosionhisui",
            "greninja",
        ],
    },
    {
        "path": ROOT / "public/fixtures/team-preview-test-3.jpg",
        "label": "team-preview-test-3",
        "expected": [
            "slowbrogalar",
            "scizor",
            "eelektross",
            "salamence",
            "rotomwash",
            "gallade",
        ],
    },
    {
        "path": ROOT / "public/fixtures/team-preview-test-4.jpg",
        "label": "team-preview-test-4",
        "expected": [
            "salamence",
            "rillaboom",
            "kingambit",
            "sylveon",
            "rotomwash",
            "sneasler",
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


def letterbox_to_template(im: Image.Image, *, keep_alpha: bool = False) -> Image.Image:
    """Contain/letterbox into TEMPLATE_SIZE×TEMPLATE_SIZE (never stretch)."""
    if keep_alpha:
        rgba = im.convert("RGBA")
        canvas = Image.new("RGBA", (TEMPLATE_SIZE, TEMPLATE_SIZE), (0, 0, 0, 0))
        w, h = rgba.size
        scale = min(TEMPLATE_SIZE / max(1, w), TEMPLATE_SIZE / max(1, h))
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        resized = rgba.resize((nw, nh), Image.Resampling.LANCZOS)
        canvas.paste(resized, ((TEMPLATE_SIZE - nw) // 2, (TEMPLATE_SIZE - nh) // 2), resized)
        return canvas
    rgb = im.convert("RGB")
    canvas = Image.new("RGB", (TEMPLATE_SIZE, TEMPLATE_SIZE), (0, 0, 0))
    w, h = rgb.size
    scale = min(TEMPLATE_SIZE / max(1, w), TEMPLATE_SIZE / max(1, h))
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    resized = rgb.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((TEMPLATE_SIZE - nw) // 2, (TEMPLATE_SIZE - nh) // 2))
    return canvas


def to_gray_and_mask(im: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    rgba = letterbox_to_template(im, keep_alpha=True).convert("RGBA")
    arr = np.asarray(rgba)
    gray = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    gray = gray.astype(np.float32)
    a = arr[:, :, 3]
    # Transparent pad (legacy RGBA cells) or flat black-bg official sheet.
    if float((a > 12).mean()) < 0.98:
        vis = a > 12
    else:
        vis = gray > 12
    gray = np.where(vis, gray, 0.0).astype(np.float32)
    mask = vis.astype(np.float32)
    return gray, mask


def to_rgb_letterbox(im: Image.Image) -> np.ndarray:
    """Opaque RGB letterbox (transparent → black) for hue hist."""
    rgba = letterbox_to_template(im, keep_alpha=True).convert("RGBA")
    arr = np.asarray(rgba)
    rgb = arr[:, :, :3].astype(np.float32)
    a = arr[:, :, 3]
    rgb = np.where(a[..., None] > 12, rgb, 0.0).astype(np.float32)
    return rgb


def average_hash(gray: np.ndarray, size: int = 8) -> str:
    side = TEMPLATE_SIZE
    block = side // size
    vals = []
    for gy in range(size):
        for gx in range(size):
            vals.append(float(gray[gy * block : (gy + 1) * block, gx * block : (gx + 1) * block].mean()))
    avg = sum(vals) / len(vals)
    return "".join("1" if v >= avg else "0" for v in vals)


def ncc(a: np.ndarray, b: np.ndarray, mask: np.ndarray | None = None) -> float:
    if mask is not None:
        m = mask > 0
        if int(m.sum()) < 8:
            return 0.0
        aa = a[m]
        bb = b[m]
    else:
        aa = a.ravel()
        bb = b.ravel()
    aa = aa - aa.mean()
    bb = bb - bb.mean()
    den = math.sqrt(float((aa * aa).sum()) * float((bb * bb).sum()))
    if den < 1e-6:
        return 0.0
    return float((aa * bb).sum() / den)


def ssd_similarity(a: np.ndarray, b: np.ndarray, mask: np.ndarray | None = None) -> float:
    if mask is not None:
        m = mask > 0
        if int(m.sum()) < 8:
            return 0.0
        aa = a[m]
        bb = b[m]
    else:
        aa = a.ravel()
        bb = b.ravel()
    d = ((aa - bb) / 255.0) ** 2
    return max(0.0, 1.0 - math.sqrt(float(d.mean())) * 2.0)


def hamming(a: str, b: str) -> int:
    n = min(len(a), len(b))
    return sum(1 for i in range(n) if a[i] != b[i]) + abs(len(a) - len(b))


def confidence(
    gray: np.ndarray,
    hash_s: str,
    tmpl_gray: np.ndarray,
    tmpl_hash: str,
    mask: np.ndarray | None = None,
) -> float:
    ncc_score = (ncc(gray, tmpl_gray, mask) + 1) / 2
    ssd_score = ssd_similarity(gray, tmpl_gray, mask)
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


def card_body_rect(im: Image.Image, slot: int) -> tuple[int, int, int, int]:
    cx, cy, cw, ch = content_rect(*im.size)
    px = int(cx + ENEMY_PANEL["left"] * cw)
    py = int(cy + ENEMY_PANEL["top"] * ch)
    pw = max(1, int((ENEMY_PANEL["right"] - ENEMY_PANEL["left"]) * cw))
    ph = max(1, int((ENEMY_PANEL["bottom"] - ENEMY_PANEL["top"]) * ch))
    pitch = ph / SLOT_COUNT
    body_h = pitch * (1 - CARD_GAP_FRAC)
    top_inset = pitch * (CARD_GAP_FRAC / 2)
    sx, sw = px, pw
    sy = int(py + slot * pitch + top_inset)
    sh = max(1, int(body_h))
    return sx, sy, sw, sh


def crop_slot(im: Image.Image, slot: int, *, card_body: bool = True) -> Image.Image:
    """Yellow square crop for matching (= overlay yellow / app recognition)."""
    sx, sy, sw, sh = card_body_rect(im, slot)
    tx, ty, side = yellow_rect_from_card(sx, sy, sw, sh)
    return im.crop((tx, ty, tx + side, ty + side))


def crop_card(im: Image.Image, slot: int) -> Image.Image:
    sx, sy, sw, sh = card_body_rect(im, slot)
    return im.crop((sx, sy, sx + sw, sy + sh))


def is_maroon(arr: np.ndarray) -> np.ndarray:
    """Dark flat red-card paint only — spare bright orange/red sprite pixels."""
    r = arr[:, :, 0].astype(np.float32)
    g = arr[:, :, 1].astype(np.float32)
    b = arr[:, :, 2].astype(np.float32)
    mx = np.maximum(np.maximum(r, g), b)
    return (
        (r > 50)
        & (mx < 175)
        & (g < 90)
        & (b < 110)
        & (r > g * 1.35)
        & (r > b * 1.15)
        & ((r - g) > 18)
        & ((r + g + b) < 360)
    )


def suppress_card_background(crop: Image.Image) -> Image.Image:
    """Zero near-maroon red-card pixels (and thin bottom UI bar)."""
    arr = np.asarray(crop.convert("RGB")).copy()
    arr[is_maroon(arr)] = 0
    dark = arr.sum(axis=2) < 45
    for y in range(arr.shape[0] - 1, max(0, arr.shape[0] - 12), -1):
        if dark[y].mean() > 0.55:
            arr[y, :] = 0
    return Image.fromarray(arr)


def content_aware_square(crop: Image.Image, pad: int = 6) -> Image.Image:
    """Tight square around non-black sprite blob, then return that crop."""
    g = np.asarray(crop.convert("RGB")).sum(axis=2)
    sm = g > 20
    ys, xs = np.where(sm)
    if len(xs) < 16:
        return crop
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    side = max(x1 - x0, y1 - y0) + pad
    w, h = crop.size
    side = min(side, w, h)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sx = max(0, min(int(round(cx - side / 2)), w - side))
    sy = max(0, min(int(round(cy - side / 2)), h - side))
    return crop.crop((sx, sy, sx + side, sy + side))


def exclude_type_gender_bleed(crop: Image.Image) -> Image.Image:
    """Zero right strip of yellow crop where type icons can bleed in.

    Yellow / ENEMY_PANEL / CARD_GAP geometry unchanged — content cleanup only.
    Gender/type icons on the card remain available via crop_card + detect_card_types.
    """
    arr = np.asarray(crop.convert("RGB")).copy()
    h, w, _ = arr.shape
    cut = max(1, int(round(w * MATCH_CROP_RIGHT_EXCLUDE_FRAC)))
    arr[:, w - cut :, :] = 0
    return Image.fromarray(arr)


def prep_query(crop: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Crop cleanup → BG suppress → content recenter → 64×64 gray + RGB."""
    q = exclude_type_gender_bleed(crop)
    q = suppress_card_background(q)
    q = content_aware_square(q)
    rgb = q.convert("RGB").resize((TEMPLATE_SIZE, TEMPLATE_SIZE), Image.Resampling.LANCZOS)
    arr = np.asarray(rgb, dtype=np.float32)
    gray = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    return gray, arr


def iter_query_variants(gray0: np.ndarray):
    """Yield gray HxW variants at MATCH_SCALES × MATCH_SHIFTS."""
    yield gray0
    gimg = Image.fromarray(np.clip(gray0, 0, 255).astype(np.uint8), mode="L")
    for sc in MATCH_SCALES:
        nw = max(1, int(round(TEMPLATE_SIZE * sc)))
        r = gimg.resize((nw, nw), Image.Resampling.BILINEAR)
        for dy in MATCH_SHIFTS:
            for dx in MATCH_SHIFTS:
                if abs(sc - 1.0) < 1e-6 and dx == 0 and dy == 0:
                    continue
                if nw >= TEMPLATE_SIZE:
                    x = max(0, min((nw - TEMPLATE_SIZE) // 2 + dx, nw - TEMPLATE_SIZE))
                    y = max(0, min((nw - TEMPLATE_SIZE) // 2 + dy, nw - TEMPLATE_SIZE))
                    yield np.asarray(r.crop((x, y, x + TEMPLATE_SIZE, y + TEMPLATE_SIZE)), dtype=np.float32)
                else:
                    ox = (TEMPLATE_SIZE - nw) // 2 + dx
                    oy = (TEMPLATE_SIZE - nw) // 2 + dy
                    if ox < 0 or oy < 0 or ox + nw > TEMPLATE_SIZE or oy + nw > TEMPLATE_SIZE:
                        continue
                    canvas = np.zeros((TEMPLATE_SIZE, TEMPLATE_SIZE), dtype=np.float32)
                    canvas[oy : oy + nw, ox : ox + nw] = np.asarray(r, dtype=np.float32)
                    yield canvas


def hue_hist(rgb: np.ndarray, bins: int = HUE_BINS) -> np.ndarray:
    """6–8 bin hue hist on non-black non-card-bg pixels."""
    r = rgb[:, :, 0] / 255.0
    g = rgb[:, :, 1] / 255.0
    b = rgb[:, :, 2] / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    df = mx - mn
    h = np.zeros_like(mx)
    mask = df > 1e-6
    rm = mask & (mx == r)
    gm = mask & (mx == g)
    bm = mask & (mx == b)
    h[rm] = (60 * ((g - b)[rm] / df[rm]) + 360) % 360
    h[gm] = (60 * ((b - r)[gm] / df[gm]) + 120) % 360
    h[bm] = (60 * ((r - g)[bm] / df[bm]) + 240) % 360
    s = np.where(mx > 1e-6, df / np.maximum(mx, 1e-6), 0.0)
    v = mx
    # Drop black + dark maroon card paint (soft — keep shiny dark sprites via sat/v gates)
    keep = (v > 0.12) & ~((v < 0.55) & (s > 0.25) & (s < 0.75) & ((h < 25) | (h > 335)))
    keep = keep & ((s > 0.15) | (v > 0.35))
    if int(keep.sum()) < 30:
        keep = v > 0.15
    hist, _ = np.histogram(h[keep], bins=bins, range=(0, 360), density=True)
    return hist.astype(np.float32)


def hist_dist(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    return 1.0 - float(np.dot(a, b) / (na * nb))


def load_pokemon_types() -> dict[str, set[str]]:
    path = ROOT / "data/pokemon.json"
    if not path.exists():
        path = ROOT / "public/data/pokemon.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, set[str]] = {}
    for rec in rows:
        sid = rec.get("showdownId")
        if not sid:
            continue
        types = {str(t).lower() for t in (rec.get("types") or [])}
        out[sid] = types
    return out


def load_templates(tmpl_dir: Path, type_map: dict[str, set[str]]) -> list[dict]:
    """Load templates from the master sheet + atlas (in-memory crops).

    Falls back to deprecated public/templates/*.png only if the sheet is missing.
    """
    atlas_path = SPRITES_DIR / "atlas.json"
    sheet_path = SPRITES_DIR / "sprite_poke.png"
    templates: list[dict] = []
    if atlas_path.exists() and sheet_path.exists():
        atlas = load_atlas(atlas_path)
        sheet = Image.open(sheet_path).convert("RGBA")
        seen: set[str] = set()
        for entry in atlas.get("entries") or []:
            sid = entry.get("speciesId")
            dex_key = entry.get("dexKey")
            if not sid or not dex_key or dex_key in seen:
                continue
            seen.add(dex_key)
            im = crop_template(sheet, entry)
            g, mask = to_gray_and_mask(im)
            rgb = to_rgb_letterbox(im)
            templates.append(
                {
                    "speciesId": sid,
                    "dexKey": dex_key,
                    "nationalDex": entry.get("nationalDex"),
                    "gray": g,
                    "mask": mask,
                    "rgb": rgb,
                    "hue": hue_hist(rgb),
                    "hash": average_hash(g),
                    "types": type_map.get(sid, set(entry.get("types") or [])),
                    "meta": entry,
                    "file": f"sheet:{dex_key}",
                }
            )
        return templates

    # Deprecated name-keyed files
    manifest_path = tmpl_dir / "manifest.json"
    if not manifest_path.exists():
        return templates
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest.get("templates", []):
        sid = entry["speciesId"]
        fpath = tmpl_dir / entry.get("file", f"{sid}.png")
        if not fpath.exists():
            print(f"WARN missing template file: {fpath}")
            continue
        im = Image.open(fpath)
        g, mask = to_gray_and_mask(im)
        rgb = to_rgb_letterbox(im)
        templates.append(
            {
                "speciesId": sid,
                "gray": g,
                "mask": mask,
                "rgb": rgb,
                "hue": hue_hist(rgb),
                "hash": average_hash(g),
                "types": type_map.get(sid, set()),
                "meta": entry,
                "file": fpath.name,
            }
        )
    return templates


_type_tmpl_cache: dict[tuple[str, int], tuple[np.ndarray, np.ndarray, np.ndarray]] = {}


def load_type_icon(tid: str, size: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    key = (tid, size)
    if key in _type_tmpl_cache:
        return _type_tmpl_cache[key]
    path = ROOT / "public/types" / f"{tid}.png"
    rgba = np.asarray(Image.open(path).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS))
    rgb = rgba[:, :, :3].astype(np.float32)
    mask = rgba[:, :, 3] > 128
    gray = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]).astype(np.float32)
    _type_tmpl_cache[key] = (gray, mask, rgb)
    return _type_tmpl_cache[key]


def ncc_masked(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    aa = a[mask].ravel()
    bb = b[mask].ravel()
    if len(aa) < 16:
        return -1.0
    aa = aa - aa.mean()
    bb = bb - bb.mean()
    den = math.sqrt(float((aa * aa).sum()) * float((bb * bb).sum()))
    if den < 1e-6:
        return -1.0
    return float((aa * bb).sum() / den)


def detect_card_types(card: Image.Image, type_ids: list[str]) -> list[tuple[str, float]]:
    """
    Type-icon scan on card top-right (0–2 icons) with NCC scores.
    Hard veto uses only scores ≥ TYPE_MATCH_THR; below → treat as low-conf (skip veto).
    Champions Team Select places dual types side-by-side; sliding NCC covers both.
    """
    w, h = card.size
    arr = np.asarray(card.convert("RGB"), dtype=np.float32)
    x0, x1 = int(w * 0.55), int(w * 0.98)
    y0, y1 = int(h * 0.04), int(h * 0.58)
    region = arr[y0:y1, x0:x1]
    rh, rw = region.shape[:2]
    hits: list[tuple[float, str, int, int, int]] = []
    for frac in TYPE_ICON_FRACS:
        isize = max(16, int(h * frac))
        isize = min(isize, rh - 2, max(16, rw // 2))
        step = max(2, isize // 6)
        for tid in type_ids:
            tg, tm, trgb = load_type_icon(tid, isize)
            for y in range(0, rh - isize + 1, step):
                for x in range(0, rw - isize + 1, step):
                    patch = region[y : y + isize, x : x + isize]
                    pg = 0.299 * patch[:, :, 0] + 0.587 * patch[:, :, 1] + 0.114 * patch[:, :, 2]
                    if float(pg.mean()) < 50 or float(patch.std()) < 18:
                        continue
                    sc = 0.35 * ncc_masked(pg, tg, tm) + 0.65 * ncc_masked(patch, trgb, tm)
                    if sc >= 0.45:
                        hits.append((sc, tid, x, y, isize))
    hits.sort(key=lambda t: -t[0])
    picked: list[tuple[float, str, int, int, int]] = []
    for sc, tid, x, y, sz in hits:
        if any(tid == pt for _, pt, _, _, _ in picked):
            continue
        overlap = False
        for _, _, px, py, psz in picked:
            ix0, iy0 = max(x, px), max(y, py)
            ix1, iy1 = min(x + sz, px + psz), min(y + sz, py + psz)
            if ix1 > ix0 and iy1 > iy0 and (ix1 - ix0) * (iy1 - iy0) > 0.3 * sz * sz:
                overlap = True
                break
        if overlap:
            continue
        picked.append((sc, tid, x, y, sz))
        if len(picked) >= 2:
            break
    return [(tid, float(sc)) for sc, tid, _, _, _ in picked]


def type_aliases(tid: str) -> set[str]:
    """Near-identical Champions icons: Ghost/Poison (purple), Fairy/Psychic (pink)."""
    if tid in ("ghost", "poison"):
        return {"ghost", "poison"}
    if tid in ("fairy", "psychic"):
        return {"fairy", "psychic"}
    return {tid}


def hard_detected_types(scored: list[tuple[str, float]]) -> list[str]:
    """Hard second gate: primary type ≥ TYPE_MATCH_THR; 2nd type ≥ SECOND_THR."""
    conf = [(tid, sc) for tid, sc in scored if sc >= TYPE_MATCH_THR]
    if not conf:
        return []
    out = [conf[0][0]]
    if len(conf) > 1 and conf[1][1] >= TYPE_MATCH_SECOND_THR:
        out.append(conf[1][0])
    return out


def ahash_prefilter(
    gray0: np.ndarray,
    templates: list[dict],
    detected_types: list[str] | None = None,
) -> list[dict]:
    """Hamming top-K, or all with ham ≤ AHASH_MAX_HAM (union, unique files)."""
    qh = average_hash(gray0)
    scored = sorted(((hamming(qh, t["hash"]), t) for t in templates), key=lambda x: x[0])
    out: list[dict] = []
    seen: set[int] = set()
    for ham, t in scored:
        if ham <= AHASH_MAX_HAM or len(out) < AHASH_TOP_K:
            tid = id(t)
            if tid not in seen:
                out.append(t)
                seen.add(tid)
        elif len(out) >= AHASH_TOP_K:
            break
    if len(out) < AHASH_TOP_K:
        out = [t for _, t in scored[:AHASH_TOP_K]]
        seen = {id(t) for t in out}
    primary = (detected_types or [None])[0]
    if primary:
        extra = 0
        limit = AHASH_MAX_HAM + AHASH_TYPE_RESCUE_EXTRA_HAM
        for ham, t in scored:
            if extra >= 16:
                break
            if id(t) in seen:
                continue
            if ham <= limit and primary in t["types"]:
                out.append(t)
                seen.add(id(t))
                extra += 1
    return out


def match_slot(
    gray0: np.ndarray,
    rgb0: np.ndarray,
    detected_types: list[str],
    templates: list[dict],
    *,
    expected: str | None = None,
    debug: bool = False,
    soft_types: list[str] | None = None,
) -> dict:
    qh = average_hash(gray0)
    scored_ah = sorted(((hamming(qh, t["hash"]), t) for t in templates), key=lambda x: x[0])
    cands = ahash_prefilter(gray0, templates, detected_types)
    cand_ids = [t["speciesId"] for t in cands]
    ahash_rank = None
    ahash_ham = None
    if expected is not None:
        for i, (ham, t) in enumerate(scored_ah):
            if t["speciesId"] == expected:
                ahash_rank = i + 1
                ahash_ham = ham
                break

    q_hue = hue_hist(rgb0)
    best: dict[str, dict] = {}
    for g in iter_query_variants(gray0):
        qmask = (g > 12).astype(np.float32)
        h = average_hash(g)
        for t in cands:
            mask = t["mask"] * qmask
            c = confidence(g, h, t["gray"], t["hash"], mask)
            if hist_dist(q_hue, t["hue"]) > HUE_DIST_THR:
                c *= HUE_PENALTY
            sid = t["speciesId"]
            if c > best.get(sid, {}).get("conf", -1.0):
                best[sid] = {"conf": c, "types": t["types"]}

    ranked = sorted(best.items(), key=lambda x: -x[1]["conf"])
    det_list = list(detected_types)
    primary = det_list[0] if det_list else None

    def has_type(info_types: set[str] | list[str], tid: str) -> bool:
        return bool(type_aliases(tid) & set(info_types))

    accepted: list[tuple[str, float]] = []
    vetoed: list[str] = []
    for sid, info in ranked:
        ctypes = info["types"]
        # Primary type icon must match; extra icons do not hard-veto (Ghost/Poison FP).
        if primary and ctypes and not has_type(ctypes, primary):
            vetoed.append(sid)
            continue
        accepted.append((sid, float(info["conf"])))
    accepted.sort(
        key=lambda pair: (
            sum(1 for tid in det_list[1:] if has_type(best[pair[0]]["types"], tid)),
            pair[1],
        ),
        reverse=True,
    )

    # Skip hard veto when it drops a dominant raw top1 (false Water/Poison OCR).
    if primary and ranked:
        raw_sid, raw_info = ranked[0]
        raw_conf = float(raw_info["conf"])
        filt_conf = float(accepted[0][1]) if accepted else 0.0
        if not has_type(raw_info["types"], primary) and raw_conf - filt_conf >= TYPE_VETO_OVERRIDE_DELTA:
            dropped = primary
            accepted = [(sid, float(info["conf"])) for sid, info in ranked]
            primary = None
            det_list = [tid for tid in det_list if tid != dropped]
            soft_types = [tid for tid in (soft_types or []) if tid != dropped]
            vetoed = []

    top_cands = [
        {"speciesId": sid, "confidence": round(float(info["conf"]), 4), "types": sorted(info["types"])}
        for sid, info in ranked[:8]
    ]
    dbg = {
        "ahashRankExpected": ahash_rank,
        "ahashHamExpected": ahash_ham,
        "ahashCandCount": len(cands),
        "expectedInAhashCands": (expected in cand_ids) if expected else None,
        "topCandidates": top_cands,
        "typeVetoed": vetoed[:12],
        "requiredMargin": None,
    }

    if not accepted:
        top1_sid = ranked[0][0] if ranked else None
        top1_conf = float(ranked[0][1]["conf"]) if ranked else 0.0
        out = {
            "speciesId": None,
            "confidence": top1_conf,
            "altSpeciesId": top1_sid,
            "margin": 0.0,
            "detectedTypes": list(det_list),
            "reason": "TYPE_VALIDATION",
        }
        if debug:
            out["debug"] = dbg
        return out

    top1_sid, top1_conf = accepted[0]
    top2_sid = accepted[1][0] if len(accepted) > 1 else None
    top2_conf = accepted[1][1] if len(accepted) > 1 else 0.0
    margin = top1_conf - top2_conf
    need = required_margin(top1_conf)
    soft_primary = None
    if not primary:
        for tid in soft_types or []:
            if tid:
                soft_primary = tid
                break
    def pink_purple(tid: str) -> bool:
        return tid in ("fairy", "psychic", "ghost", "poison")

    def hint_matches_top1(tid: str) -> bool:
        return has_type(best[top1_sid]["types"], tid) or (
            pink_purple(tid) and any(pink_purple(t) for t in best[top1_sid]["types"])
        )

    matching_soft = next((tid for tid in (soft_types or []) if hint_matches_top1(tid)), None)
    type_hint = (
        primary
        if primary and hint_matches_top1(primary)
        else (matching_soft if not primary else None)
    )
    # Type-supported accept only at high conf (Sylveon Fairy 0.46, margin 0.004).
    # Do not loosen the 0.54–0.60 band — that accepted Basculegion on Greninja.
    # Soft Poison on a pink Fairy icon still counts as a matching hint (false color).
    if type_hint and hint_matches_top1(type_hint) and top1_conf >= 0.60:
        need = min(need, 0.0)
    dbg["requiredMargin"] = need
    if top1_conf >= CONFIDENCE_THRESHOLD and margin >= need:
        out = {
            "speciesId": top1_sid,
            "confidence": top1_conf,
            "altSpeciesId": top2_sid,
            "margin": margin,
            "detectedTypes": list(det_list),
            "reason": "ok",
        }
        if debug:
            out["debug"] = dbg
        return out

    def try_soft_promote(typed: list[tuple[str, float]], max_gap: float, tag: str):
        if len(typed) != 1:
            return None
        t_sid, t_conf = typed[0]
        gap = top1_conf - t_conf
        if t_conf >= CONFIDENCE_THRESHOLD and 0 <= gap <= max_gap:
            out = {
                "speciesId": t_sid,
                "confidence": t_conf,
                "altSpeciesId": top1_sid if top1_sid != t_sid else top2_sid,
                "margin": t_conf,
                "detectedTypes": list(det_list),
                "reason": "ok",
            }
            if debug:
                dbg["softTypePromote"] = {"type": tag, "speciesId": t_sid, "gap": gap}
                out["debug"] = dbg
            return out
        return None

    # Dual soft types uniquely pick e.g. Mimikyu (Ghost+Fairy) in a noisy pack.
    if not primary and len(soft_types or []) >= 2:
        dual = [
            (sid, conf)
            for sid, conf in accepted[:8]
            if all(has_type(best[sid]["types"], tid) for tid in soft_types)
        ]
        promoted = try_soft_promote(dual, TYPE_TIE_MAX_GAP_DUAL, "+".join(soft_types))
        if promoted:
            return promoted

    # Soft type tie-break: unique match among top-8 within TYPE_TIE_MAX_GAP of raw top1.
    if soft_primary:
        typed = [
            (sid, conf)
            for sid, conf in accepted[:8]
            if has_type(best[sid]["types"], soft_primary)
        ]
        promoted = try_soft_promote(typed, TYPE_TIE_MAX_GAP, soft_primary)
        if promoted:
            return promoted

    reason = "LOW_CONF" if top1_conf < CONFIDENCE_THRESHOLD else "MARGIN_TOO_SMALL"
    if expected and expected not in cand_ids:
        reason = "AHASH_PREFILTER"
    out = {
        "speciesId": None,
        "confidence": top1_conf,
        "altSpeciesId": top2_sid or top1_sid,
        "margin": margin,
        "detectedTypes": list(det_list),
        "reason": reason,
    }
    if debug:
        out["debug"] = dbg
    return out


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Match Team Preview test fixtures")
    ap.add_argument("--debug", action="store_true", help="Write per-slot reject debug to docs/")
    args = ap.parse_args()
    debug = bool(args.debug)

    tmpl_dir = ROOT / "public/templates"
    type_map = load_pokemon_types()
    templates = load_templates(tmpl_dir, type_map)
    if not templates:
        print("No templates loaded")
        return 1

    type_ids = sorted(p.stem for p in (ROOT / "public/types").glob("*.png"))
    all_rows = []
    debug_rows = []
    correct = 0
    wrong = 0
    null_n = 0
    total = 0
    n_ids = len({t["speciesId"] for t in templates})
    allow_n = 0
    allow_path = ROOT / "data/allowlist.json"
    if allow_path.exists():
        allow_n = len((json.loads(allow_path.read_text(encoding="utf-8")).get("entries") or []))
    poke_n = 0
    poke_path = ROOT / "data/pokemon.json"
    if poke_path.exists():
        poke_n = len(json.loads(poke_path.read_text(encoding="utf-8")))

    src_label = (
        f"{SPRITES_DIR.relative_to(ROOT)} (sheet+atlas, dex-keyed in-memory crops)"
        if (SPRITES_DIR / "atlas.json").exists()
        else f"{tmpl_dir.relative_to(ROOT)} (deprecated name-keyed PNGs)"
    )
    print(f"Templates: {len(templates)} crops / {n_ids} speciesIds from {src_label}")
    print(f"Legal roster: atlas={n_ids} allowlist={allow_n} pokemon.json={poke_n}")
    print(
        f"ROI locked: panel={ENEMY_PANEL} thumb={THUMB_CROP} "
        f"CARD_GAP_FRAC={CARD_GAP_FRAC} PANEL_OUTER_MARGIN_FRAC={PANEL_OUTER_MARGIN_FRAC}"
    )
    print(
        f"Guards: thr={CONFIDENCE_THRESHOLD} dynMargin "
        f"(≥0.75→0.025,≥0.68→0.03,≥0.60→0.05,≥0.54→0.055,else {MIN_MARGIN}) "
        f"aHash top{AHASH_TOP_K}|≤{AHASH_MAX_HAM} hue×{HUE_PENALTY}@{HUE_DIST_THR} "
        f"type hard≥{TYPE_MATCH_THR} cropRightExclude={MATCH_CROP_RIGHT_EXCLUDE_FRAC}"
    )
    print(f"Match: crop-cleanup + bg-suppress + content-recenter + scales={MATCH_SCALES} shifts={MATCH_SHIFTS}")

    for fx in FIXTURES:
        src = fx["path"]
        if not src.exists():
            print(f"SKIP missing {src}")
            continue
        im = Image.open(src).convert("RGB")
        print(f"\n=== {fx['label']} ({src.relative_to(ROOT)}) ===")
        print(f"{'slot':<4} {'expected':<14} {'matched':<14} {'conf':>6} {'margin':>6} types            ok")
        for slot, expected in enumerate(fx["expected"]):
            crop = crop_slot(im, slot)
            gray0, rgb0 = prep_query(crop)
            card = crop_card(im, slot)
            scored_types = detect_card_types(card, type_ids)
            det = hard_detected_types(scored_types)
            soft = [tid for tid, sc in scored_types if sc >= TYPE_SOFT_THR]
            result = match_slot(
                gray0, rgb0, det, templates, expected=expected, debug=debug, soft_types=soft
            )
            best_id = result["speciesId"]
            best_c = float(result["confidence"])
            margin = float(result["margin"])
            ok = best_id == expected and best_c >= CONFIDENCE_THRESHOLD
            if best_id is None:
                null_n += 1
            elif best_id == expected:
                correct += 1
            else:
                wrong += 1
            total += 1
            mark = "Y" if ok else ("null" if best_id is None else "WRONG")
            types_s = ",".join(result["detectedTypes"]) or "-"
            print(
                f"{slot:<4} {expected:<14} {best_id or '-':<14} {best_c:6.3f} {margin:6.3f} {types_s:<16} {mark}"
            )
            row = {
                "fixture": fx["label"],
                "slot": slot,
                "expected": expected,
                "matched": best_id,
                "confidence": round(best_c, 4),
                "margin": round(margin, 4),
                "requiredMargin": required_margin(best_c),
                "altSpeciesId": result.get("altSpeciesId"),
                "detectedTypes": result.get("detectedTypes"),
                "typeScores": [{"id": t, "score": round(s, 4)} for t, s in scored_types],
                "reason": result.get("reason"),
                "ok": ok,
                "wrongSpecies": best_id is not None and best_id != expected,
            }
            all_rows.append(row)
            if debug:
                drow = dict(row)
                drow["debug"] = result.get("debug")
                debug_rows.append(drow)

    accuracy = f"{correct}/{total}"
    print(f"\nOverall: correct={accuracy} wrong={wrong} null={null_n}")

    out_md = ROOT / "docs/match-test-fixtures-results.md"
    out_json = ROOT / "docs/match-test-fixtures-results.json"
    out_md.parent.mkdir(parents=True, exist_ok=True)

    margin_rule = (
        "dyn ≥0.75→0.025 / ≥0.68→0.03 / ≥0.60→0.05 / ≥0.54→0.055 / else 0.08"
    )
    lines = [
        "# Test fixture match results",
        "",
        f"- Fixtures: live-latest + test-1~4 (`test-1` == live-latest bytes)",
        f"- Templates: `public/sprites/sprite_poke.png` + `atlas.json` (nationalDex-keyed in-memory crops; {len(templates)} cells / {n_ids} ids)",
        f"- Matcher: crop cleanup (right {MATCH_CROP_RIGHT_EXCLUDE_FRAC}) + BG suppress + content-aware recenter + aHash prefilter + multi-scale/shift; NCC×0.55 + SSD×0.25 + aHash×0.20",
        f"- Guards (v1.4): `CONFIDENCE_THRESHOLD={CONFIDENCE_THRESHOLD}`, `{margin_rule}`, "
        f"coarse hue ×{HUE_PENALTY} if hist-dist>{HUE_DIST_THR}, type **hard** gate (thr={TYPE_MATCH_THR}; skip if low-conf), "
        f"aHash top{AHASH_TOP_K}|ham≤{AHASH_MAX_HAM}",
        f"- Mask: template alpha ∩ query non-black",
        f"- Scales: `{list(MATCH_SCALES)}`; shifts: `{list(MATCH_SHIFTS)}`",
        f"- ROI Doc: v1.3-square-thumb (panel/thumb/CARD_GAP **locked** — prefer null over wrong species)",
        f"- **Overall: correct {accuracy}, wrong species {wrong}, null {null_n}**",
        "",
    ]

    for fx in FIXTURES:
        rows = [r for r in all_rows if r["fixture"] == fx["label"]]
        fx_ok = sum(1 for r in rows if r["ok"])
        fx_wrong = sum(1 for r in rows if r.get("wrongSpecies"))
        fx_null = sum(1 for r in rows if r["matched"] is None)
        lines += [
            f"## {fx['label']}",
            "",
            f"**Accuracy: {fx_ok}/{len(rows)}** (wrong={fx_wrong}, null={fx_null})",
            "",
            "| slot | expected | matched | confidence | margin | need | types | reason | ok |",
            "|------|----------|---------|------------|--------|------|-------|--------|----|",
        ]
        for r in rows:
            types_s = ",".join(r.get("detectedTypes") or []) or "-"
            lines.append(
                f"| {r['slot']} | {r['expected']} | {r['matched']} | {r['confidence']:.4f} | "
                f"{r.get('margin', 0):.4f} | {r.get('requiredMargin', 0):.4f} | {types_s} | "
                f"{r.get('reason')} | {'Y' if r['ok'] else 'N'} |"
            )
        lines.append("")

    misses = [r for r in all_rows if not r["ok"]]
    lines += ["## Misses / unidentified", ""]
    if not misses:
        lines.append("- None")
    else:
        for r in misses:
            kind = "WRONG" if r.get("wrongSpecies") else "null"
            lines.append(
                f"- `{r['fixture']}` slot {r['slot']}: expected **{r['expected']}**, "
                f"matched **{r['matched']}** ({r['confidence']:.3f}, margin={r.get('margin', 0):.3f}, "
                f"need={r.get('requiredMargin', 0):.3f}, types={r.get('detectedTypes')}, {r.get('reason')}) [{kind}]"
            )
    lines += [
        "",
        "## Notes",
        "",
        "- ENEMY_PANEL / THUMB_CROP / CARD_GAP_FRAC / yellow square geometry **unchanged**.",
        "- Prefer `speciesId=null` (未識別) over wrong-species false positives.",
        "- Type hard second gate: uncertain/low-conf type OCR → no veto; when types known "
        f"(score≥{TYPE_MATCH_THR}), candidate types from `pokemon.json` must be a **superset** "
        "of detected set (e.g. Flying → reject Incineroar).",
        f"- aHash TopK={AHASH_TOP_K} (fixture-tuned; prefer null over wrong species).",
        f"- Dynamic margin: {margin_rule}.",
        f"- Match-crop cleanup: zero right {MATCH_CROP_RIGHT_EXCLUDE_FRAC} of yellow (type bleed); type icons still read from card top-right.",
        "- Coarse hue filter is conservative (×0.85) so shinies without shiny templates are not hard-killed.",
        "- `recognize.ts` mirrors this pipeline (`cardRect` → type crop + `thumbRectInSlot` match).",
        f"- Result: **correct {accuracy}, wrong={wrong}, null={null_n}**.",
        "- Atlas: official full-roster `sprite_sheet.png` + `sprite_poke.css` → "
        f"{len(templates)} dex-keyed in-memory crops (no per-species PNG dump).",
        "- Formal fixtures: `team-preview-live-latest.jpg` (= test-1) plus test-2~4. "
        "live-latest enemy: Froslass, Garchomp, Basculegion-M, Kingambit, Sneasler, "
        "Golisopod. test-2: Chesnaught, Mimikyu, Alolan Ninetales, Swampert, "
        "Hisuian Typhlosion, Greninja. test-4: Salamence, Rillaboom, Kingambit, "
        "Sylveon, Rotom-Wash, Sneasler.",
        f"- Legal roster counts: atlas cells={n_ids}, allowlist={allow_n}, pokemon.json={poke_n}.",
        "- Enemy/ally form selector uses sibling legal forms grouped by nationalDex "
        "(regional / gender / Rotom; Mega when present in the 262).",
        "",
    ]
    out_md.write_text("\n".join(lines), encoding="utf-8")
    out_json.write_text(
        json.dumps(
            {
                "accuracy": accuracy,
                "correct": correct,
                "wrong": wrong,
                "null": null_n,
                "total": total,
                "templateCount": len(templates),
                "speciesIdCount": n_ids,
                "threshold": CONFIDENCE_THRESHOLD,
                "minMargin": MIN_MARGIN,
                "ahashTopK": AHASH_TOP_K,
                "ahashMaxHam": AHASH_MAX_HAM,
                "matchCropRightExcludeFrac": MATCH_CROP_RIGHT_EXCLUDE_FRAC,
                "dynamicMargin": {
                    "0.75": 0.025,
                    "0.68": 0.03,
                    "0.60": 0.05,
                    "0.54": 0.055,
                    "else": MIN_MARGIN,
                },
                "scales": list(MATCH_SCALES),
                "shifts": list(MATCH_SHIFTS),
                "rows": all_rows,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {out_md.relative_to(ROOT)}")
    print(f"Wrote {out_json.relative_to(ROOT)}")

    if debug:
        out_dbg = ROOT / "docs/match-debug.json"
        out_dbg.write_text(json.dumps({"rows": debug_rows}, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {out_dbg.relative_to(ROOT)}")
        # compact markdown
        md = ["# Match debug (per-slot reject reasons)", ""]
        for r in debug_rows:
            d = r.get("debug") or {}
            md.append(
                f"## {r['fixture']} slot {r['slot']} — expected `{r['expected']}` → `{r['matched']}` ({r['reason']})"
            )
            md.append("")
            md.append(
                f"- conf={r['confidence']:.4f} margin={r['margin']:.4f} need={r.get('requiredMargin')} "
                f"types={r.get('detectedTypes')} typeScores={r.get('typeScores')}"
            )
            md.append(
                f"- aHash rank expected={d.get('ahashRankExpected')} ham={d.get('ahashHamExpected')} "
                f"inCands={d.get('expectedInAhashCands')} candCount={d.get('ahashCandCount')}"
            )
            md.append(f"- topCandidates={d.get('topCandidates')}")
            md.append(f"- typeVetoed={d.get('typeVetoed')}")
            md.append("")
        out_dbg_md = ROOT / "docs/match-debug.md"
        out_dbg_md.write_text("\n".join(md), encoding="utf-8")
        print(f"Wrote {out_dbg_md.relative_to(ROOT)}")

    return 0 if wrong == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
