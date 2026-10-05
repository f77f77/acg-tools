/**
 * In-memory crops from one master sprite sheet, keyed by nationalDex.
 *
 * Atlas (parsed CSS percent→pixel) lives at public/sprites/atlas.json.
 * The sheet PNG is loaded once; cells are never written out as per-species files.
 */

export const SPRITE_CELL = 128;

export interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteAtlasEntry extends SpriteRect {
  dexKey: string;
  dexAliases?: string[];
  nationalDex: number;
  form: number;
  formSuffix?: string | null;
  speciesId: string;
  speciesNameZh?: string;
  speciesNameEn?: string;
  formKey?: string;
  types?: string[];
}

export interface SpriteAtlas {
  version: number;
  primaryKey: string;
  sheet: string;
  css?: string;
  cell: number;
  sheetSize: [number, number];
  source?: string;
  notes?: string;
  entries: SpriteAtlasEntry[];
}

export function spritesBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? `${base}sprites/` : `${base}/sprites/`;
}

/** CSS background-position % → pixel offset for a cell-sized viewport. */
export function cssPercentToPx(percent: number, sheetPx: number, cellPx = SPRITE_CELL): number {
  if (sheetPx <= cellPx) return 0;
  return Math.round((sheetPx - cellPx) * (percent / 100));
}

const CSS_CLASS_RE = /\.(?:sprite-poke-ui_PokeIcon_02_|poke-icon_|dex-)(\d+)(?:[_-](\d+))?(?:[_-](\d+))?/i;
const BG_SIZE_RE = /background-size:\s*([0-9.]+)(px|%)?\s+([0-9.]+)(px|%)?/i;
const BG_POS_RE = /background-position:\s*([-+0-9.]+)(px|%)?\s+([-+0-9.]+)(px|%)?/i;
const RULE_RE = /([^{]+)\{([^}]+)\}/g;

export function parseSpriteCss(
  cssText: string,
  sheetW: number,
  sheetH: number,
  cell = SPRITE_CELL,
): Map<string, SpriteRect> {
  const out = new Map<string, SpriteRect>();
  let m: RegExpExecArray | null;
  const re = new RegExp(RULE_RE.source, 'g');
  while ((m = re.exec(cssText))) {
    const selector = m[1];
    const body = m[2];
    const cm = CSS_CLASS_RE.exec(selector);
    if (!cm) continue;
    const dex = Number(cm[1]);
    const form = Number(cm[2] || 0);
    const pos = BG_POS_RE.exec(body);
    if (!pos) continue;
    const size = BG_SIZE_RE.exec(body);
    let bgW = sheetW;
    let bgH = sheetH;
    if (size && (size[2] || 'px') !== '%') {
      bgW = Math.round(Number(size[1]));
      bgH = Math.round(Number(size[3]));
    }
    const xRaw = Number(pos[1]);
    const yRaw = Number(pos[3]);
    const xUnit = pos[2] || 'px';
    const yUnit = pos[4] || 'px';
    const x = xUnit === '%' ? cssPercentToPx(xRaw, bgW, cell) : Math.round(xRaw < 0 ? -xRaw : xRaw);
    const y = yUnit === '%' ? cssPercentToPx(yRaw, bgH, cell) : Math.round(yRaw < 0 ? -yRaw : yRaw);
    const cx = Math.max(0, Math.min(x, Math.max(0, sheetW - 1)));
    const cy = Math.max(0, Math.min(y, Math.max(0, sheetH - 1)));
    const w = Math.min(cell, sheetW - cx);
    const h = Math.min(cell, sheetH - cy);
    if (w < 8 || h < 8) continue;
    const key = form > 0 ? `${dex}-${form}` : String(dex);
    out.set(key, { x: cx, y: cy, w, h });
  }
  return out;
}

let atlasPromise: Promise<SpriteAtlas | null> | null = null;
let sheetPromise: Promise<ImageBitmap | null> | null = null;
const SPRITE_URL_CACHE = new Map<string, string>();

export async function loadSpriteAtlas(): Promise<SpriteAtlas | null> {
  if (atlasPromise) return atlasPromise;
  atlasPromise = (async () => {
    try {
      const res = await fetch(`${spritesBaseUrl()}atlas.json`);
      if (!res.ok) return null;
      const atlas = (await res.json()) as SpriteAtlas;
      if (!atlas?.entries?.length) return null;
      return atlas;
    } catch {
      return null;
    }
  })();
  return atlasPromise;
}

export async function loadSpriteSheetBitmap(): Promise<ImageBitmap | null> {
  if (sheetPromise) return sheetPromise;
  sheetPromise = (async () => {
    try {
      const res = await fetch(`${spritesBaseUrl()}sprite_poke.png`);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  })();
  return sheetPromise;
}

export function findAtlasEntry(
  atlas: SpriteAtlas,
  opts: { speciesId?: string | null; formKey?: string | null; nationalDex?: number | null },
): SpriteAtlasEntry | null {
  const sid = (opts.speciesId || '').toLowerCase();
  const fk = (opts.formKey || '').toLowerCase();
  const dex = opts.nationalDex ?? null;
  const entries = atlas.entries || [];
  if (fk) {
    const byForm = entries.find((e) => (e.formKey || '').toLowerCase() === fk);
    if (byForm) return byForm;
    const compact = fk.replace(/-/g, '');
    const byCompact = entries.find((e) => (e.formKey || '').replace(/-/g, '').toLowerCase() === compact);
    if (byCompact) return byCompact;
  }
  if (sid) {
    const exact = entries.find((e) => (e.speciesId || '').toLowerCase() === sid && (e.form || 0) === 0);
    if (exact) return exact;
    const any = entries.find((e) => (e.speciesId || '').toLowerCase() === sid);
    if (any) return any;
  }
  if (dex != null && dex > 0) {
    const byDex = entries.find((e) => e.nationalDex === dex && (e.form || 0) === 0);
    if (byDex) return byDex;
    return entries.find((e) => e.nationalDex === dex) || null;
  }
  return null;
}

/**
 * Full sheet cell (128) as a PNG data URL — card avatars / ally strip.
 * Not the 64×64 match template (which may center-extract).
 */
export async function sheetSpriteDataUrl(opts: {
  speciesId?: string | null;
  formKey?: string | null;
  nationalDex?: number | null;
}): Promise<string | null> {
  const cacheKey = `${opts.speciesId || ''}::${opts.formKey || ''}::${opts.nationalDex ?? ''}`;
  const hit = SPRITE_URL_CACHE.get(cacheKey);
  if (hit) return hit;
  const [atlas, sheet] = await Promise.all([loadSpriteAtlas(), loadSpriteSheetBitmap()]);
  if (!atlas || !sheet) return null;
  const entry = findAtlasEntry(atlas, opts);
  if (!entry) return null;
  const cell = cropSheetCell(sheet, sheet.width, sheet.height, {
    x: entry.x,
    y: entry.y,
    w: entry.w,
    h: entry.h,
  });
  const url = cell.toDataURL('image/png');
  SPRITE_URL_CACHE.set(cacheKey, url);
  return url;
}

/**
 * Crop one cell from the already-decoded sheet (no disk write).
 * Caller is responsible for contain/letterbox + feature extraction.
 */
export function cropSheetCell(
  sheet: CanvasImageSource,
  sheetW: number,
  sheetH: number,
  rect: SpriteRect,
): HTMLCanvasElement {
  const w = Math.max(1, Math.min(rect.w, sheetW - rect.x));
  const h = Math.max(1, Math.min(rect.h, sheetH - rect.y));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(sheet, rect.x, rect.y, w, h, 0, 0, w, h);
  return c;
}
