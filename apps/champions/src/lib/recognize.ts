/**
 * Team Preview 敵方小縮圖辨認（本地 aHash + 灰階 NCC，無雲端）。
 *
 * 流程：抓一幀 → contentRect（去黑邊）→ 敵方面板 ROI → 6 pitch → 紅卡本體（留 gap）→
 * 每格黃框正方形（邊長=紅卡本體高，左側精靈）→ 抑制紅卡底 → content-aware 重對齊 →
 * crop cleanup（黃框右側 type/gender 滲入排除；黃框幾何不變）→
 * aHash prefilter（query+template 皆 8×8 block-mean，對齊 Python）→ 64×64 多尺度／微位移灰階比對（mask = 模板 alpha ∩ query 非黑）→
 * 粗 hue 軟懲罰 → 卡右側 type icon 硬否決（僅主屬性；Ghost/Poison 紫、Fairy/Psychic 粉互認）→
 * 軟屬性近平手加持 → dynamic margin + threshold。
 *
 * 模板庫：public/sprites/sprite_poke.png + atlas.json（nationalDex 主鍵）。
 * 整張 sheet 載入一次，依 CSS/atlas 座標記憶體裁切 — 不落地數百張小 PNG。
 * 寧可 speciesId=null（未識別）也不要錯種。不拉伸。不猜道具。不做逐幀即時辨認。
 * ROI 黃框 / ENEMY_PANEL / CARD_GAP_FRAC 鎖定（見 roi.ts）。
 */

import type { RecognizeResult } from '../types';
import { grabFrame } from './videoSource';
import { findSpecies } from './species';
import { typeToId, type TypeIconId } from './typeIcons';
import {
  SLOT_COUNT,
  TEMPLATE_SIZE,
  type RoiFineTune,
  DEFAULT_FINE_TUNE,
  computeContentRect,
  resolveEnemyPanel,
  panelToFrameRect,
  cardRect,
  thumbRectInSlot,
} from './roi';
import {
  cropSheetCell,
  loadSpriteAtlas,
  loadSpriteSheetBitmap,
  type SpriteAtlasEntry,
} from './spriteSheet';

export {
  ENEMY_PANEL_DEFAULT,
  THUMB_CROP,
  CARD_GAP_FRAC,
  PANEL_OUTER_MARGIN_FRAC,
  SLOT_COUNT,
  TEMPLATE_SIZE,
  ROI_FINE_TUNE_MAX,
  computeContentRect,
  resolveEnemyPanel,
  panelToFrameRect,
  slotRect,
  cardRect,
  thumbRectInSlot,
  panelVisualNorm,
  panelCssPercent,
  slotCssPercent,
  cardCssPercent,
  thumbCssPercent,
  loadFineTune,
  saveFineTune,
  loadDebugOverlay,
  saveDebugOverlay,
  DEFAULT_FINE_TUNE,
  type RoiFineTune,
  type ContentRect,
  type PanelRectNorm,
} from './roi';

/** 信心門檻：低於此 → 未識別 */
export const CONFIDENCE_THRESHOLD = 0.54;
/** Fallback / floor for requiredMargin(); dynamic rule used at accept time */
export const MIN_MARGIN = 0.08;
/** aHash Hamming prefilter：至少 top-K，並納入 ham≤此值者（fixture-tuned smallest K≥12/18） */
export const AHASH_TOP_K = 40;
export const AHASH_MAX_HAM = 18;
/** 粗 hue hist：過遠則分數 ×HUE_PENALTY（軟，避免誤殺 shiny） */
export const HUE_BINS = 8;
export const HUE_DIST_THR = 0.75;
export const HUE_PENALTY = 0.85;
/** 右側 type icon 硬否決門檻（低於此 → type unknown，跳過硬否決） */
export const TYPE_MATCH_THR = 0.58;
/**
 * 第二屬性硬否決門檻。Ghost / Poison 圖示都是紫色，canvas NCC 常把
 * 幽尾玄魚 Water/Ghost 誤成 water+poison；第二屬性需更高分才進入硬集合。
 */
export const TYPE_MATCH_SECOND_THR = 0.66;
/** aHash rescue: 已偵測到主屬性時，允許 ham 比 TOP_K 再寬一點把同屬性模板拉回 */
export const AHASH_TYPE_RESCUE_EXTRA_HAM = 8;
export const TYPE_ICON_FRACS = [0.36, 0.42, 0.48] as const;
/** Zero right edge of yellow match crop (type bleed). Yellow ROI geometry unchanged. */
export const MATCH_CROP_RIGHT_EXCLUDE_FRAC = 0.05;

/** Soft type (below hard veto) may break a near-tie toward the matching species. */
export const TYPE_SOFT_THR = 0.45;
/** Max raw-top1 − typed gap for soft-type unique promote (Mimikyu vs Liepard). */
export const TYPE_TIE_MAX_GAP = 0.03;
/** Wider gap when 2+ soft types uniquely identify one species (Ghost+Fairy Mimikyu). */
export const TYPE_TIE_MAX_GAP_DUAL = 0.05;
/**
 * Skip hard type veto when it would drop a dominant raw top1
 * (false Water/Poison on white/pink sprites). Prefer null over a weak leftover.
 */
export const TYPE_VETO_OVERRIDE_DELTA = 0.12;

/** Dynamic top1−top2 margin: high conf → smaller required gap (fixture-tuned). */
export function requiredMargin(confidence: number): number {
  if (confidence >= 0.75) return 0.025;
  if (confidence >= 0.68) return 0.03;
  if (confidence >= 0.6) return 0.05;
  if (confidence >= 0.54) return 0.055;
  return MIN_MARGIN;
}

/** Query multi-scale / translation sweep (mirror scripts/match-test-fixtures.py) */
export const MATCH_SCALES = [0.9, 1.0, 1.1, 1.2, 1.35, 1.55] as const;
export const MATCH_SHIFTS = [-8, -4, 0, 4, 8] as const;

/** @deprecated 舊 ROI 形狀；請改用 ENEMY_PANEL_DEFAULT + resolveEnemyPanel */
export const ROI = {
  x: 0.811,
  y: 0.143,
  width: 0.965 - 0.811,
  height: 0.832 - 0.143,
  slots: SLOT_COUNT,
} as const;

export type RoiConfig = typeof ROI;

/** Team Preview 小縮圖模板條目（主鍵 = nationalDex / dexKey） */
export interface ThumbTemplate {
  /** Showdown id（UI / pokemon.json）；辨認結果仍回傳此欄 */
  speciesId: string;
  speciesNameZh: string;
  /** Primary template key: "6" or "38-1" */
  dexKey: string;
  nationalDex: number;
  form?: number;
  formKey?: string;
  /** 64×64 aHash 位元字串（僅不透明像素） */
  aHash: string;
  /** 灰階 float（長度 TEMPLATE_SIZE²），用於 NCC */
  gray: Float32Array;
  /** Alpha mask 0/1（sheet 透明／裁切後忽略黑底）；缺省視為全 1 */
  mask?: Float32Array;
  /** 粗 hue hist（HUE_BINS）；透明→黑後計算 */
  hue: Float32Array;
  /** English type ids from pokemon.json / SPECIES_DB（type veto） */
  types: string[];
  /** 可選：原圖 data URL（除錯） */
  dataUrl?: string;
}

interface TypeIconTemplate {
  id: TypeIconId;
  /** Native PNG (not the 32px warmup) — resize from this like Python LANCZOS. */
  source: HTMLCanvasElement | null;
  /** Pre-rasterized at multiple sizes lazily */
  cache: Map<number, { gray: Float32Array; rgb: Float32Array; mask: Float32Array; size: number }>;
}

/**
 * Fallback seed showdownIds when manifest is missing (new team-select fixtures).
 * Prefer public/sprites/atlas.json (nationalDex keys) at runtime.
 */
export const SEED_TEMPLATE_IDS = [
  'charizard',
  'aerodactyl',
  'meowscarada',
  'garchomp',
  'rotomwash',
  'aegislash',
] as const;

const SEED_META: Record<string, string> = {
  charizard: '噴火龍',
  aerodactyl: '化石翼龍',
  meowscarada: '魔幻假面喵',
  garchomp: '烈咬陸鯊',
  rotomwash: '清洗洛托姆',
  aegislash: '堅盾劍怪',
  whimsicott: '風妖精',
  basculegion: '幽尾玄魚',
  kingambit: '仆刀將軍',
  sneasler: '大狃拉',
  ninetalesalola: '阿羅拉九尾',
  empoleon: '帝王拿波',
  staraptor: '姆克鷹',
};

/** 執行期模板庫（載入後填入；空 → 低信心／未識別） */
export let PREVIEW_THUMB_TEMPLATES: ThumbTemplate[] = [];

let loadPromise: Promise<ThumbTemplate[]> | null = null;
let typeIconsPromise: Promise<TypeIconTemplate[]> | null = null;
let TYPE_ICON_TEMPLATES: TypeIconTemplate[] = [];

const TYPE_ICON_IDS: TypeIconId[] = [
  'normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
];

function typesBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? `${base}types/` : `${base}/types/`;
}

function speciesTypeIds(speciesId: string): string[] {
  const sp = findSpecies(speciesId);
  if (!sp?.types?.length) return [];
  const out: string[] = [];
  for (const t of sp.types) {
    const id = typeToId(t);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Map atlas / form / dex keys onto the allowlist showdownId used by pickers. */
function canonicalSpeciesId(...candidates: Array<string | null | undefined>): string | null {
  for (const raw of candidates) {
    if (!raw) continue;
    const sp = findSpecies(raw);
    if (sp?.key) return sp.key;
  }
  return candidates.find((c) => !!c) || null;
}

function templatesBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? `${base}templates/` : `${base}/templates/`;
}

function averageHash(data: ImageData, size = 8): string {
  const { width, height, data: px } = data;
  const gray: number[] = [];
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const sx = Math.floor((gx + 0.5) * (width / size));
      const sy = Math.floor((gy + 0.5) * (height / size));
      const i = (sy * width + sx) * 4;
      gray.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    }
  }
  const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
  return gray.map((v) => (v >= avg ? '1' : '0')).join('');
}

function toGray(data: ImageData): Float32Array {
  const { width, height, data: px } = data;
  const out = new Float32Array(width * height);
  let opaque = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const a = px[i + 3];
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (a > 12) opaque++;
    // Transparent pad → 0 (mirror scripts/match-test-fixtures.py to_gray_and_mask).
    out[j] = a > 12 ? g : 0;
  }
  // Fully opaque sheet cells: also zero near-black so aHash matches Python.
  if (opaque / Math.max(1, width * height) >= 0.98) {
    for (let j = 0; j < out.length; j++) {
      if (out[j] <= 12) out[j] = 0;
    }
  }
  return out;
}

function hamming(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}

/** RGB ImageData → HUE_BINS hist on non-black / non-card-bg pixels */
function hueHistFromImageData(data: ImageData, bins = HUE_BINS): Float32Array {
  const { width, height, data: px } = data;
  const hues: number[] = [];
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const df = mx - mn;
    let h = 0;
    if (df > 1e-6) {
      if (mx === r) h = (60 * ((g - b) / df) + 360) % 360;
      else if (mx === g) h = (60 * ((b - r) / df) + 120) % 360;
      else h = (60 * ((r - g) / df) + 240) % 360;
    }
    const s = mx > 1e-6 ? df / mx : 0;
    const v = mx;
    const maroon =
      v < 0.55 && s > 0.25 && s < 0.75 && (h < 25 || h > 335);
    if (v <= 0.12 || maroon) continue;
    if (!(s > 0.15 || v > 0.35)) continue;
    hues.push(h);
  }
  if (hues.length < 30) {
    hues.length = 0;
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
      if (v <= 0.15) continue;
      const r = px[i] / 255;
      const g = px[i + 1] / 255;
      const b = px[i + 2] / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const df = mx - mn;
      let h = 0;
      if (df > 1e-6) {
        if (mx === r) h = (60 * ((g - b) / df) + 360) % 360;
        else if (mx === g) h = (60 * ((b - r) / df) + 120) % 360;
        else h = (60 * ((r - g) / df) + 240) % 360;
      }
      hues.push(h);
    }
  }
  const hist = new Float32Array(bins);
  if (hues.length === 0) return hist;
  const binW = 360 / bins;
  for (const h of hues) {
    let bi = Math.floor(h / binW);
    if (bi >= bins) bi = bins - 1;
    hist[bi] += 1;
  }
  // density
  for (let i = 0; i < bins; i++) hist[i] /= hues.length * binW;
  return hist;
}

function hueHistFromRgbFloat(rgb: Float32Array, bins = HUE_BINS): Float32Array {
  // rgb interleaved length TEMPLATE_SIZE² * 3
  const n = Math.floor(rgb.length / 3);
  const hues: number[] = [];
  for (let j = 0; j < n; j++) {
    const r = rgb[j * 3] / 255;
    const g = rgb[j * 3 + 1] / 255;
    const b = rgb[j * 3 + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const df = mx - mn;
    let h = 0;
    if (df > 1e-6) {
      if (mx === r) h = (60 * ((g - b) / df) + 360) % 360;
      else if (mx === g) h = (60 * ((b - r) / df) + 120) % 360;
      else h = (60 * ((r - g) / df) + 240) % 360;
    }
    const s = mx > 1e-6 ? df / mx : 0;
    const v = mx;
    const maroon = v < 0.55 && s > 0.25 && s < 0.75 && (h < 25 || h > 335);
    if (v <= 0.12 || maroon) continue;
    if (!(s > 0.15 || v > 0.35)) continue;
    hues.push(h);
  }
  const hist = new Float32Array(bins);
  if (hues.length === 0) return hist;
  const binW = 360 / bins;
  for (const h of hues) {
    let bi = Math.floor(h / binW);
    if (bi >= bins) bi = bins - 1;
    hist[bi] += 1;
  }
  for (let i = 0; i < bins; i++) hist[i] /= hues.length * binW;
  return hist;
}

function histDist(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  if (den < 1e-9) return 0;
  return 1 - dot / den;
}

function toRgbFloat(data: ImageData): Float32Array {
  const { data: px } = data;
  const out = new Float32Array((px.length / 4) * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    out[j] = px[i];
    out[j + 1] = px[i + 1];
    out[j + 2] = px[i + 2];
  }
  return out;
}

/** 正規化互相關 ∈ [-1,1]；可選 mask（>0 的像素才計入） */
function ncc(a: Float32Array, b: Float32Array, mask?: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let count = 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    if (mask && mask[i] <= 0) continue;
    meanA += a[i];
    meanB += b[i];
    count++;
  }
  if (count < 8) return 0;
  meanA /= count;
  meanB /= count;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    if (mask && mask[i] <= 0) continue;
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den < 1e-6) return 0;
  return num / den;
}

/** 正規化 SSD 相似度 ∈ [0,1]（1 = 相同）；可選 mask */
function ssdSimilarity(a: Float32Array, b: Float32Array, mask?: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (mask && mask[i] <= 0) continue;
    const d = (a[i] - b[i]) / 255;
    sum += d * d;
    count++;
  }
  if (count < 8) return 0;
  return Math.max(0, 1 - Math.sqrt(sum / count) * 2);
}

function alphaMaskFromImageData(data: ImageData, threshold = 12): Float32Array {
  const { data: px, width, height } = data;
  const n = width * height;
  const alphaVis = new Float32Array(n);
  let opaque = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const vis = px[i + 3] > threshold ? 1 : 0;
    alphaVis[j] = vis;
    opaque += vis;
  }
  // Transparent pad (packed RGBA cells) vs flat black-bg official sheet.
  if (opaque / n < 0.98) return alphaVis;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    out[j] = gray > threshold ? 1 : 0;
  }
  return out;
}

/**
 * Draw source into TEMPLATE_SIZE×TEMPLATE_SIZE with contain/letterbox
 * (preserve aspect; pad black). Never stretch — stretch breaks NCC matching.
 */
function drawContained(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts?: { padBlack?: boolean },
): void {
  ctx.clearRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);
  if (opts?.padBlack !== false) {
    // Capture path: black letterbox pad (matches gray pipeline).
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);
  }
  // Template load: leave cleared (transparent) so alpha mask works.
  const sw = Math.max(1, srcW);
  const sh = Math.max(1, srcH);
  const scale = Math.min(TEMPLATE_SIZE / sw, TEMPLATE_SIZE / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const dx = Math.floor((TEMPLATE_SIZE - dw) / 2);
  const dy = Math.floor((TEMPLATE_SIZE - dh) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, sw, sh, dx, dy, dw, dh);
}

function imageDataFromBitmap(bmp: ImageBitmap): ImageData {
  const c = document.createElement('canvas');
  c.width = TEMPLATE_SIZE;
  c.height = TEMPLATE_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  // Same contain path as capture crops so NCC compares like-for-like.
  drawContained(ctx, bmp, bmp.width, bmp.height, { padBlack: false });
  return ctx.getImageData(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);
}

function thumbFromImageData(
  imageData: ImageData,
  entry: {
    speciesId: string;
    speciesNameZh?: string;
    dexKey: string;
    nationalDex: number;
    form?: number;
    formKey?: string;
  },
): ThumbTemplate {
  const resolvedId = canonicalSpeciesId(entry.speciesId, entry.formKey, entry.dexKey) || entry.speciesId;
  const zh =
    findSpecies(resolvedId)?.nameZh ??
    entry.speciesNameZh ??
    SEED_META[entry.speciesId] ??
    entry.speciesId;
  const gray = toGray(imageData);
  return {
    speciesId: resolvedId,
    speciesNameZh: zh,
    dexKey: entry.dexKey,
    nationalDex: entry.nationalDex,
    form: entry.form ?? 0,
    formKey: entry.formKey,
    gray,
    aHash: averageHashGray(gray),
    mask: alphaMaskFromImageData(imageData),
    hue: hueHistFromImageData(imageData),
    types: (() => {
      const t = speciesTypeIds(resolvedId);
      return t.length ? t : speciesTypeIds(entry.speciesId);
    })(),
  };
}

function visibleCount(data: ImageData): number {
  const px = data.data;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    // Keep dark-but-colored bodies (Greninja); only drop near-black sheet BG.
    if (px[i + 3] > 12 && px[i] + px[i + 1] + px[i + 2] > 8) n++;
  }
  return n;
}

/**
 * Crop one atlas cell from the decoded sheet → 64×64.
 * Centered TEMPLATE_SIZE pack (legacy) is extracted losslessly; official
 * 128 cells content-trim then contain (never stretch).
 */
function imageDataFromSheetCell(
  sheet: ImageBitmap,
  entry: SpriteAtlasEntry,
): ImageData {
  const cell = cropSheetCell(sheet, sheet.width, sheet.height, {
    x: entry.x,
    y: entry.y,
    w: entry.w,
    h: entry.h,
  });
  const ctx = cell.getContext('2d', { willReadFrequently: true })!;
  const w = cell.width;
  const h = cell.height;
  if (w === TEMPLATE_SIZE && h === TEMPLATE_SIZE) {
    return ctx.getImageData(0, 0, w, h);
  }
  if (w >= TEMPLATE_SIZE && h >= TEMPLATE_SIZE) {
    const ox = Math.floor((w - TEMPLATE_SIZE) / 2);
    const oy = Math.floor((h - TEMPLATE_SIZE) / 2);
    const centered = ctx.getImageData(ox, oy, TEMPLATE_SIZE, TEMPLATE_SIZE);
    const full = ctx.getImageData(0, 0, w, h);
    const fv = visibleCount(full);
    if (fv > 0 && visibleCount(centered) >= 0.9 * fv) {
      return centered;
    }
  }
  const raw = ctx.getImageData(0, 0, w, h);
  const recentered = contentAwareSquare(raw, 2);
  const tmp = document.createElement('canvas');
  tmp.width = TEMPLATE_SIZE;
  tmp.height = TEMPLATE_SIZE;
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  const src = document.createElement('canvas');
  src.width = recentered.width;
  src.height = recentered.height;
  src.getContext('2d')!.putImageData(recentered, 0, 0);
  drawContained(tctx, src, recentered.width, recentered.height, { padBlack: false });
  return tctx.getImageData(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);
}

/** @deprecated name-keyed files under public/templates/ — sheet crops are primary. */
async function fetchLegacyTemplateFile(file: string): Promise<ImageData | null> {
  try {
    const url = `${templatesBaseUrl()}${file}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const data = imageDataFromBitmap(bmp);
    bmp.close();
    return data;
  } catch {
    return null;
  }
}

async function loadTemplatesFromSheet(): Promise<ThumbTemplate[]> {
  const [atlas, sheet] = await Promise.all([loadSpriteAtlas(), loadSpriteSheetBitmap()]);
  if (!atlas || !sheet) return [];
  const loaded: ThumbTemplate[] = [];
  const seenDex = new Set<string>();
  for (const entry of atlas.entries) {
    if (!entry?.speciesId || !entry.dexKey) continue;
    if (seenDex.has(entry.dexKey)) continue;
    seenDex.add(entry.dexKey);
    const imageData = imageDataFromSheetCell(sheet, entry);
    loaded.push(
      thumbFromImageData(imageData, {
        speciesId: entry.speciesId,
        speciesNameZh: entry.speciesNameZh,
        dexKey: entry.dexKey,
        nationalDex: entry.nationalDex,
        form: entry.form,
        formKey: entry.formKey,
      }),
    );
  }
  // Keep the sheet bitmap cached for card / ally-strip avatars (do not close).
  return loaded;
}

async function loadLegacyNameTemplates(): Promise<ThumbTemplate[]> {
  const loaded: ThumbTemplate[] = [];
  for (const id of SEED_TEMPLATE_IDS) {
    const imageData = await fetchLegacyTemplateFile(`${id}.png`);
    if (!imageData) continue;
    const dex = findSpecies(id)?.nationalDex ?? 0;
    loaded.push(
      thumbFromImageData(imageData, {
        speciesId: id,
        speciesNameZh: SEED_META[id],
        dexKey: dex ? String(dex) : id,
        nationalDex: dex || 0,
      }),
    );
  }
  return loaded;
}

export async function loadPreviewThumbTemplates(
  force = false,
): Promise<ThumbTemplate[]> {
  if (!force && PREVIEW_THUMB_TEMPLATES.length > 0) return PREVIEW_THUMB_TEMPLATES;
  if (!force && loadPromise) return loadPromise;

  loadPromise = (async () => {
    let loaded = await loadTemplatesFromSheet();
    if (loaded.length === 0) {
      loaded = await loadLegacyNameTemplates();
    }
    PREVIEW_THUMB_TEMPLATES = loaded;
    return loaded;
  })();

  try {
    return await loadPromise;
  } finally {
    /* keep loadPromise for reuse */
  }
}

async function loadTypeIconTemplates(force = false): Promise<TypeIconTemplate[]> {
  if (!force && TYPE_ICON_TEMPLATES.length > 0) return TYPE_ICON_TEMPLATES;
  if (!force && typeIconsPromise) return typeIconsPromise;
  typeIconsPromise = (async () => {
    const loaded: TypeIconTemplate[] = [];
    for (const id of TYPE_ICON_IDS) {
      loaded.push({ id, source: null, cache: new Map() });
    }
    // Keep native PNG pixels; downsample per scan size (mirrors Python LANCZOS).
    await Promise.all(
      loaded.map(async (t) => {
        try {
          const res = await fetch(`${typesBaseUrl()}${t.id}.png`);
          if (!res.ok) return;
          const blob = await res.blob();
          const bmp = await createImageBitmap(blob);
          const src = document.createElement('canvas');
          src.width = bmp.width;
          src.height = bmp.height;
          const sctx = src.getContext('2d', { willReadFrequently: true })!;
          sctx.clearRect(0, 0, src.width, src.height);
          sctx.drawImage(bmp, 0, 0);
          bmp.close();
          t.source = src;
          const c = document.createElement('canvas');
          c.width = 32;
          c.height = 32;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.clearRect(0, 0, 32, 32);
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, 32, 32);
          const imageData = ctx.getImageData(0, 0, 32, 32);
          t.cache.set(32, {
            size: 32,
            gray: toGray(imageData),
            rgb: toRgbFloat(imageData),
            mask: alphaMaskFromImageData(imageData, 128),
          });
        } catch {
          /* ignore missing icon */
        }
      }),
    );
    TYPE_ICON_TEMPLATES = loaded;
    return loaded;
  })();
  return typeIconsPromise;
}

function typeIconAtSize(t: TypeIconTemplate, size: number): {
  gray: Float32Array;
  rgb: Float32Array;
  mask: Float32Array;
  size: number;
} | null {
  const hit = t.cache.get(size);
  if (hit) return hit;
  const src = t.source;
  if (!src) return t.cache.get(32) ?? null;
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.clearRect(0, 0, size, size);
  octx.drawImage(src, 0, 0, src.width, src.height, 0, 0, size, size);
  const imageData = octx.getImageData(0, 0, size, size);
  const entry = {
    size,
    gray: toGray(imageData),
    rgb: toRgbFloat(imageData),
    mask: alphaMaskFromImageData(imageData, 128),
  };
  t.cache.set(size, entry);
  return entry;
}

function nccMaskedRgb(
  aRgb: Float32Array,
  bRgb: Float32Array,
  mask: Float32Array,
  nPix: number,
): number {
  let count = 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < nPix; i++) {
    if (mask[i] <= 0) continue;
    meanA += aRgb[i * 3] + aRgb[i * 3 + 1] + aRgb[i * 3 + 2];
    meanB += bRgb[i * 3] + bRgb[i * 3 + 1] + bRgb[i * 3 + 2];
    count += 3;
  }
  if (count < 24) return 0;
  meanA /= count;
  meanB /= count;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < nPix; i++) {
    if (mask[i] <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const da = aRgb[i * 3 + c] - meanA;
      const db = bRgb[i * 3 + c] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
  }
  const den = Math.sqrt(denA * denB);
  if (den < 1e-6) return 0;
  return num / den;
}

function nccMaskedGray(a: Float32Array, b: Float32Array, mask: Float32Array): number {
  return ncc(a, b, mask);
}

export interface DetectedCardTypes {
  hard: string[];
  soft: string[];
  scores: { id: string; score: number }[];
}

/**
 * Type-icon scan on card top-right (1–2 icons). Hard veto only when score ≥ TYPE_MATCH_THR;
 * low-conf detections are omitted → skip hard veto. Soft ids (score ≥ TYPE_SOFT_THR)
 * may break a near-tie toward the matching species.
 */
function detectCardTypes(
  src: CanvasRenderingContext2D,
  card: { x: number; y: number; width: number; height: number },
): DetectedCardTypes {
  if (TYPE_ICON_TEMPLATES.length === 0) return { hard: [], soft: [], scores: [] };
  const x0 = Math.floor(card.x + card.width * 0.55);
  const x1 = Math.floor(card.x + card.width * 0.98);
  const y0 = Math.floor(card.y + card.height * 0.04);
  const y1 = Math.floor(card.y + card.height * 0.58);
  const rw = Math.max(1, x1 - x0);
  const rh = Math.max(1, y1 - y0);
  let region: ImageData;
  try {
    region = src.getImageData(x0, y0, rw, rh);
  } catch {
    return { hard: [], soft: [], scores: [] };
  }
  type Hit = { sc: number; id: string; x: number; y: number; sz: number };
  const hits: Hit[] = [];
  for (const frac of TYPE_ICON_FRACS) {
    let isize = Math.max(16, Math.floor(card.height * frac));
    isize = Math.min(isize, rh - 2, Math.max(16, Math.floor(rw / 2)));
    const step = Math.max(2, Math.floor(isize / 6));
    for (const t of TYPE_ICON_TEMPLATES) {
      const tmpl = typeIconAtSize(t, isize);
      if (!tmpl) continue;
      for (let y = 0; y <= rh - isize; y += step) {
        for (let x = 0; x <= rw - isize; x += step) {
          // extract patch
          const gray = new Float32Array(isize * isize);
          const rgb = new Float32Array(isize * isize * 3);
          let sum = 0;
          let rgbSum = 0;
          let rgbSumSq = 0;
          const nRgb = isize * isize * 3;
          for (let py = 0; py < isize; py++) {
            for (let px = 0; px < isize; px++) {
              const si = ((y + py) * rw + (x + px)) * 4;
              const r = region.data[si];
              const g = region.data[si + 1];
              const b = region.data[si + 2];
              const gi = py * isize + px;
              const gv = 0.299 * r + 0.587 * g + 0.114 * b;
              gray[gi] = gv;
              rgb[gi * 3] = r;
              rgb[gi * 3 + 1] = g;
              rgb[gi * 3 + 2] = b;
              sum += gv;
              rgbSum += r + g + b;
              rgbSumSq += r * r + g * g + b * b;
            }
          }
          const mean = sum / (isize * isize);
          if (mean < 50) continue;
          // Mirror Python patch.std() on RGB (not gray-only variance).
          const rgbMean = rgbSum / nRgb;
          const rgbStd = Math.sqrt(Math.max(0, rgbSumSq / nRgb - rgbMean * rgbMean));
          if (rgbStd < 18) continue;
          const gN = nccMaskedGray(gray, tmpl.gray, tmpl.mask);
          const cN = nccMaskedRgb(rgb, tmpl.rgb, tmpl.mask, isize * isize);
          const sc = 0.35 * gN + 0.65 * cN;
          if (sc >= 0.45) {
            hits.push({ sc, id: t.id, x, y, sz: isize });
          }
        }
      }
    }
  }
  hits.sort((a, b) => b.sc - a.sc);
  const typeColorFamily = (id: string): string => {
    if (id === 'fairy' || id === 'psychic') return 'pink';
    if (id === 'ghost' || id === 'poison') return 'purple';
    return id;
  };
  const hitsOverlap = (a: Hit, b: Hit): boolean => {
    const ix0 = Math.max(a.x, b.x);
    const iy0 = Math.max(a.y, b.y);
    const ix1 = Math.min(a.x + a.sz, b.x + b.sz);
    const iy1 = Math.min(a.y + a.sz, b.y + b.sz);
    return ix1 > ix0 && iy1 > iy0 && (ix1 - ix0) * (iy1 - iy0) > 0.3 * a.sz * a.sz;
  };
  const picked: Hit[] = [];
  for (const h of hits) {
    if (picked.some((p) => p.id === h.id)) continue;
    if (picked.some((p) => hitsOverlap(h, p))) continue;
    picked.push(h);
    if (picked.length >= 2) break;
  }
  // Pink vs purple icons often NCC-collide. Keep the overlapping other family as 2nd soft.
  if (picked.length === 1) {
    const first = picked[0];
    for (const h of hits) {
      if (h.id === first.id) continue;
      if (typeColorFamily(h.id) === typeColorFamily(first.id)) continue;
      if (!hitsOverlap(h, first)) continue;
      picked.push(h);
      break;
    }
  }
  // Hard second gate: only confident type hits. 2nd icon needs a higher
  // score — Ghost vs Poison purple sprites otherwise both pass TYPE_MATCH_THR.
  const confident = picked.filter((p) => p.sc >= TYPE_MATCH_THR);
  const hard: string[] = [];
  if (confident.length > 0) {
    hard.push(confident[0].id);
    if (confident[1] && confident[1].sc >= TYPE_MATCH_SECOND_THR) {
      hard.push(confident[1].id);
    }
  }
  const soft: string[] = [];
  for (const p of picked) {
    if (p.sc >= TYPE_SOFT_THR && !soft.includes(p.id)) soft.push(p.id);
  }
  return {
    hard,
    soft,
    scores: picked.map((p) => ({ id: p.id, score: Number(p.sc.toFixed(4)) })),
  };
}

/**
 * Zero right strip of yellow crop where type icons can bleed in.
 * Yellow / ENEMY_PANEL / CARD_GAP geometry unchanged — content cleanup only.
 */
function excludeTypeGenderBleed(data: ImageData): ImageData {
  const { width, height, data: px } = data;
  const out = new ImageData(width, height);
  out.data.set(px);
  const cut = Math.max(1, Math.round(width * MATCH_CROP_RIGHT_EXCLUDE_FRAC));
  for (let y = 0; y < height; y++) {
    for (let x = width - cut; x < width; x++) {
      const i = (y * width + x) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = 0;
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Suppress near-maroon Team Select card background (and thin bottom bar).
 */
function suppressCardBackground(data: ImageData): ImageData {
  const { width, height, data: px } = data;
  const out = new ImageData(width, height);
  const op = out.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const mx = Math.max(r, g, b);
    // Dark flat card paint only — spare bright orange/red sprite pixels.
    const maroon =
      r > 50 &&
      mx < 175 &&
      g < 90 &&
      b < 110 &&
      r > g * 1.35 &&
      r > b * 1.15 &&
      r - g > 18 &&
      r + g + b < 360;
    if (maroon) {
      op[i] = op[i + 1] = op[i + 2] = 0;
      op[i + 3] = 255;
    } else {
      op[i] = r;
      op[i + 1] = g;
      op[i + 2] = b;
      op[i + 3] = 255;
    }
  }
  // Zero mostly-dark bottom rows (UI bar)
  for (let y = height - 1; y >= Math.max(0, height - 12); y--) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (op[i] + op[i + 1] + op[i + 2] < 45) dark++;
    }
    if (dark / width > 0.55) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        op[i] = op[i + 1] = op[i + 2] = 0;
      }
    } else {
      break;
    }
  }
  return out;
}

/**
 * Tight square around non-black sprite blob (content-aware recenter).
 */
function contentAwareSquare(data: ImageData, pad = 6): ImageData {
  const { width, height, data: px } = data;
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (px[i] + px[i + 1] + px[i + 2] > 20) {
        count++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x + 1 > x1) x1 = x + 1;
        if (y + 1 > y1) y1 = y + 1;
      }
    }
  }
  if (count < 16) return data;
  let side = Math.max(x1 - x0, y1 - y0) + pad;
  side = Math.min(side, width, height);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let sx = Math.round(cx - side / 2);
  let sy = Math.round(cy - side / 2);
  sx = Math.max(0, Math.min(sx, width - side));
  sy = Math.max(0, Math.min(sy, height - side));
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d')!;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  srcCanvas.getContext('2d')!.putImageData(data, 0, 0);
  ctx.drawImage(srcCanvas, sx, sy, side, side, 0, 0, side, side);
  return ctx.getImageData(0, 0, side, side);
}

function grayFromImageData(data: ImageData): Float32Array {
  return toGray(data);
}

function averageHashGray(gray: Float32Array, size = 8): string {
  const block = TEMPLATE_SIZE / size;
  const vals: number[] = [];
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      let s = 0;
      const y0 = Math.floor(gy * block);
      const x0 = Math.floor(gx * block);
      const y1 = Math.floor((gy + 1) * block);
      const x1 = Math.floor((gx + 1) * block);
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          s += gray[y * TEMPLATE_SIZE + x];
          n++;
        }
      }
      vals.push(s / Math.max(1, n));
    }
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.map((v) => (v >= avg ? '1' : '0')).join('');
}

function queryNonblackMask(gray: Float32Array, thr = 12): Float32Array {
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] > thr ? 1 : 0;
  return out;
}

function intersectMask(a?: Float32Array, b?: Float32Array): Float32Array | undefined {
  if (!a) return b;
  if (!b) return a;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] > 0 && b[i] > 0 ? 1 : 0;
  return out;
}

/** Scale+shift gray plane onto TEMPLATE_SIZE canvas (black pad / center-crop). */
function placeScaledGray(gray: Float32Array, scale: number, dx: number, dy: number): Float32Array | null {
  const nw = Math.max(1, Math.round(TEMPLATE_SIZE * scale));
  // Draw via canvas for bilinear resize
  const src = document.createElement('canvas');
  src.width = TEMPLATE_SIZE;
  src.height = TEMPLATE_SIZE;
  const sctx = src.getContext('2d')!;
  const img = sctx.createImageData(TEMPLATE_SIZE, TEMPLATE_SIZE);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const v = Math.max(0, Math.min(255, gray[i]));
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const scaled = document.createElement('canvas');
  scaled.width = nw;
  scaled.height = nw;
  const xctx = scaled.getContext('2d')!;
  xctx.imageSmoothingEnabled = true;
  xctx.drawImage(src, 0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE, 0, 0, nw, nw);
  const out = new Float32Array(TEMPLATE_SIZE * TEMPLATE_SIZE);
  if (nw >= TEMPLATE_SIZE) {
    let x = Math.floor((nw - TEMPLATE_SIZE) / 2) + dx;
    let y = Math.floor((nw - TEMPLATE_SIZE) / 2) + dy;
    x = Math.max(0, Math.min(x, nw - TEMPLATE_SIZE));
    y = Math.max(0, Math.min(y, nw - TEMPLATE_SIZE));
    const patch = xctx.getImageData(x, y, TEMPLATE_SIZE, TEMPLATE_SIZE);
    for (let i = 0, j = 0; j < patch.data.length; i++, j += 4) {
      out[i] = 0.299 * patch.data[j] + 0.587 * patch.data[j + 1] + 0.114 * patch.data[j + 2];
    }
  } else {
    const ox = Math.floor((TEMPLATE_SIZE - nw) / 2) + dx;
    const oy = Math.floor((TEMPLATE_SIZE - nw) / 2) + dy;
    if (ox < 0 || oy < 0 || ox + nw > TEMPLATE_SIZE || oy + nw > TEMPLATE_SIZE) return null;
    const patch = xctx.getImageData(0, 0, nw, nw);
    out.fill(0);
    for (let row = 0; row < nw; row++) {
      for (let col = 0; col < nw; col++) {
        const j = (row * nw + col) * 4;
        const v = 0.299 * patch.data[j] + 0.587 * patch.data[j + 1] + 0.114 * patch.data[j + 2];
        out[(oy + row) * TEMPLATE_SIZE + (ox + col)] = v;
      }
    }
  }
  return out;
}

function* iterQueryVariants(gray0: Float32Array): Generator<Float32Array> {
  yield gray0;
  for (const sc of MATCH_SCALES) {
    for (const dy of MATCH_SHIFTS) {
      for (const dx of MATCH_SHIFTS) {
        if (Math.abs(sc - 1) < 1e-6 && dx === 0 && dy === 0) continue;
        const g = placeScaledGray(gray0, sc, dx, dy);
        if (g) yield g;
      }
    }
  }
}

/**
 * Crop yellow square → suppress maroon BG → content-aware recenter → 64×64.
 * Square crop resizes without stretch (aspect already 1:1).
 */
function cropResizeToTemplate(
  src: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
): { imageData: ImageData; dataUrl: string; gray: Float32Array; rgb: Float32Array; hue: Float32Array } {
  const tmp = document.createElement('canvas');
  tmp.width = TEMPLATE_SIZE;
  tmp.height = TEMPLATE_SIZE;
  const tctx = tmp.getContext('2d');
  if (!tctx) {
    const empty = src.createImageData(TEMPLATE_SIZE, TEMPLATE_SIZE);
    const rgb = toRgbFloat(empty);
    return {
      imageData: empty,
      dataUrl: '',
      gray: toGray(empty),
      rgb,
      hue: hueHistFromRgbFloat(rgb),
    };
  }
  const raw = src.getImageData(
    Math.max(0, rect.x),
    Math.max(0, rect.y),
    Math.max(1, rect.width),
    Math.max(1, rect.height),
  );
  const cleaned = excludeTypeGenderBleed(raw);
  const suppressed = suppressCardBackground(cleaned);
  const recentered = contentAwareSquare(suppressed);
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = recentered.width;
  rawCanvas.height = recentered.height;
  rawCanvas.getContext('2d')!.putImageData(recentered, 0, 0);
  // Square → drawContained is identity scale letterbox (fills 64)
  drawContained(tctx, rawCanvas, recentered.width, recentered.height);
  const imageData = tctx.getImageData(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);
  const rgb = toRgbFloat(imageData);
  return {
    imageData,
    dataUrl: tmp.toDataURL('image/png'),
    gray: grayFromImageData(imageData),
    rgb,
    hue: hueHistFromRgbFloat(rgb),
  };
}

function ahashPrefilter(
  queryHash: string,
  templates: ThumbTemplate[],
  detectedTypes: string[] = [],
): ThumbTemplate[] {
  const scored = templates
    .map((t) => ({ ham: hamming(queryHash, t.aHash), t }))
    .sort((a, b) => a.ham - b.ham);
  const out: ThumbTemplate[] = [];
  const seen = new Set<ThumbTemplate>();
  const push = (t: ThumbTemplate) => {
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const { ham, t } of scored) {
    if (ham <= AHASH_MAX_HAM || out.length < AHASH_TOP_K) {
      push(t);
    } else if (out.length >= AHASH_TOP_K) {
      break;
    }
  }
  if (out.length < AHASH_TOP_K) {
    for (const s of scored.slice(0, AHASH_TOP_K)) push(s.t);
  }
  // Type rescue: canvas aHash can drop long/striped sprites (Basculegion-M).
  // If a type icon was confidently read, pull same-type templates back in
  // with a slightly wider Hamming allowance — NCC/margin still decide.
  const primary = detectedTypes[0];
  if (primary) {
    const extraCap = 16;
    let extra = 0;
    const limit = AHASH_MAX_HAM + AHASH_TYPE_RESCUE_EXTRA_HAM;
    for (const { ham, t } of scored) {
      if (extra >= extraCap) break;
      if (seen.has(t)) continue;
      if (ham <= limit && t.types.includes(primary)) {
        push(t);
        extra += 1;
      }
    }
  }
  return out;
}

export interface MatchTemplateResult {
  speciesId: string | null;
  speciesNameZh: string | null;
  confidence: number;
  altSpeciesId?: string | null;
  margin?: number;
  detectedTypes?: string[];
  rejectReason?: string | null;
  topCandidates?: { speciesId: string; confidence: number; types: string[] }[];
  ahashHit?: boolean;
  ahashCandCount?: number;
}

/**
 * 本地比對：aHash prefilter → 多尺度 NCC/SSD/aHash → hue 軟懲罰 → type 硬否決（低信心跳過）→ dynamic margin。
 * mask = 模板 alpha ∩ query 非黑。寧可 null 不要錯種。
 */
function matchTemplate(
  hash: string,
  gray: Float32Array,
  queryHue: Float32Array,
  detectedTypes: string[] = [],
  softTypes: string[] = [],
): MatchTemplateResult {
  if (PREVIEW_THUMB_TEMPLATES.length === 0) {
    const confidence = 0.12 + (hash.split('1').length % 7) * 0.01;
    return {
      speciesId: null,
      speciesNameZh: null,
      confidence,
      detectedTypes,
      rejectReason: 'no-templates',
    };
  }

  const cands = ahashPrefilter(hash, PREVIEW_THUMB_TEMPLATES, detectedTypes);
  const ahashIds = new Set(cands.map((t) => t.speciesId));
  const bestBySpecies = new Map<
    string,
    { speciesId: string; speciesNameZh: string; confidence: number; types: string[] }
  >();

  for (const g of iterQueryVariants(gray)) {
    const qMask = queryNonblackMask(g);
    const h = averageHashGray(g);
    for (const t of cands) {
      const mask = intersectMask(t.mask, qMask);
      const nccScore = (ncc(g, t.gray, mask) + 1) / 2;
      const ssdScore = ssdSimilarity(g, t.gray, mask);
      const hashBits = Math.max(h.length, t.aHash.length) || 64;
      const hashScore = Math.max(0, 1 - hamming(h, t.aHash) / (hashBits * 0.35));
      let confidence = Math.min(1, nccScore * 0.55 + ssdScore * 0.25 + hashScore * 0.2);
      if (histDist(queryHue, t.hue) > HUE_DIST_THR) {
        confidence *= HUE_PENALTY;
      }
      const prev = bestBySpecies.get(t.speciesId);
      if (!prev || confidence > prev.confidence) {
        bestBySpecies.set(t.speciesId, {
          speciesId: t.speciesId,
          speciesNameZh: t.speciesNameZh,
          confidence,
          types: t.types,
        });
      }
    }
  }

  const ranked = [...bestBySpecies.values()].sort((a, b) => b.confidence - a.confidence);
  let det = detectedTypes.slice();
  let soft = softTypes.slice();
  const topCandidates = ranked.slice(0, 8).map((c) => ({
    speciesId: c.speciesId,
    confidence: Number(c.confidence.toFixed(4)),
    types: c.types,
  }));
  let primary: string | undefined = det[0];
  /** Near-identical Champions icons: Ghost/Poison (purple), Fairy/Psychic (pink). */
  const typeAliases = (id: string): string[] => {
    if (id === 'ghost' || id === 'poison') return ['ghost', 'poison'];
    if (id === 'fairy' || id === 'psychic') return ['fairy', 'psychic'];
    return [id];
  };
  const hasType = (c: { types: string[] }, id: string) =>
    typeAliases(id).some((x) => c.types.includes(x));

  // Hard veto: the *primary* (highest-score) type icon must be on the species.
  // Extra icons are a preference only — requiring every detected id caused
  // Water/Ghost Basculegion to be dropped when canvas NCC read Ghost as Poison.
  let accepted = ranked
    .filter((c) => {
      if (!primary) return true;
      if (!c.types.length) return true;
      return hasType(c, primary);
    })
    .sort((a, b) => {
      const extra = (c: { types: string[] }) =>
        det.slice(1).reduce((n, id) => n + (hasType(c, id) ? 1 : 0), 0);
      const de = extra(b) - extra(a);
      if (de) return de;
      return b.confidence - a.confidence;
    });

  // False type OCR (white fox → Water, pink fox → Poison) can veto a dominant
  // raw top1 and leave only weak leftovers. Skip veto; drop the contradicted id.
  const rawTop = ranked[0];
  const filteredTop = accepted[0];
  if (
    primary &&
    rawTop &&
    !hasType(rawTop, primary) &&
    rawTop.confidence - (filteredTop?.confidence ?? 0) >= TYPE_VETO_OVERRIDE_DELTA
  ) {
    const dropped = primary;
    accepted = ranked;
    primary = undefined;
    det = det.filter((id) => id !== dropped);
    soft = soft.filter((id) => id !== dropped);
  }

  const debug = {
    topCandidates,
    ahashHit: ahashIds.has('basculegion') || ahashIds.has('basculegionf'),
    ahashCandCount: cands.length,
  };

  if (accepted.length === 0) {
    const top = ranked[0];
    return {
      speciesId: null,
      speciesNameZh: null,
      confidence: top?.confidence ?? 0,
      altSpeciesId: top?.speciesId ?? null,
      margin: 0,
      detectedTypes: det,
      rejectReason: 'type-veto',
      ...debug,
    };
  }

  const top1 = accepted[0];
  const top2 = accepted[1];
  const margin = top1.confidence - (top2?.confidence ?? 0);
  let need = requiredMargin(top1.confidence);
  const softPrimary = !primary ? soft[0] : undefined;
  const pinkPurple = (id: string) =>
    id === 'fairy' || id === 'psychic' || id === 'ghost' || id === 'poison';
  const hintMatchesTop1 = (id: string) =>
    hasType(top1, id) || (pinkPurple(id) && top1.types.some((t) => pinkPurple(t)));
  // Prefer a hint that actually matches top1 (soft Poison must not block Fairy Sylveon).
  const typeHint =
    (primary && hintMatchesTop1(primary) ? primary : undefined) ||
    (!primary ? soft.find((id) => hintMatchesTop1(id)) : undefined);
  if (typeHint && hintMatchesTop1(typeHint) && top1.confidence >= 0.6) {
    need = Math.min(need, 0);
  }
  if (top1.confidence >= CONFIDENCE_THRESHOLD && margin >= need) {
    return {
      speciesId: top1.speciesId,
      speciesNameZh: top1.speciesNameZh,
      confidence: top1.confidence,
      altSpeciesId: top2?.speciesId ?? null,
      margin,
      detectedTypes: det,
      rejectReason: null,
      ...debug,
    };
  }

  const trySoftPromote = (
    typed: typeof accepted,
    maxGap: number,
  ): MatchTemplateResult | null => {
    if (typed.length !== 1) return null;
    const pick = typed[0];
    const gap = top1.confidence - pick.confidence;
    if (pick.confidence >= CONFIDENCE_THRESHOLD && gap >= 0 && gap <= maxGap) {
      return {
        speciesId: pick.speciesId,
        speciesNameZh: pick.speciesNameZh,
        confidence: pick.confidence,
        altSpeciesId: top1.speciesId !== pick.speciesId ? top1.speciesId : (top2?.speciesId ?? null),
        margin: pick.confidence,
        detectedTypes: det,
        rejectReason: null,
        ...debug,
      };
    }
    return null;
  };

  // Dual soft types (Ghost+Fairy) uniquely pick Mimikyu among a noisy mid-0.58 pack.
  if (!primary && soft.length >= 2) {
    const dual = accepted
      .slice(0, 8)
      .filter((c) => soft.every((id) => hasType(c, id)));
    const promoted = trySoftPromote(dual, TYPE_TIE_MAX_GAP_DUAL);
    if (promoted) return promoted;
  }

  // Soft type tie-break when hard veto did not fire and raw margin is too small.
  if (softPrimary) {
    const typed = accepted.slice(0, 8).filter((c) => hasType(c, softPrimary));
    const promoted = trySoftPromote(typed, TYPE_TIE_MAX_GAP);
    if (promoted) return promoted;
  }

  return {
    speciesId: null,
    speciesNameZh: null,
    confidence: top1.confidence,
    altSpeciesId: top2?.speciesId ?? top1.speciesId,
    margin,
    detectedTypes: det,
    rejectReason: top1.confidence < CONFIDENCE_THRESHOLD ? 'below-threshold' : 'below-margin',
    ...debug,
  };
}

function emptyResults(reasonConfidence = 0): RecognizeResult[] {
  return Array.from({ length: SLOT_COUNT }, (_, slot) => ({
    slot,
    confidence: reasonConfidence,
    speciesId: null,
    speciesNameZh: null,
    species: null,
  }));
}

/**
 * 從已繪製的整幀 canvas 辨認 6 槽（驗收：可餵 team-preview-live-latest.jpg）。
 */
export async function recognizeEnemyTeamFromCanvas(
  canvas: HTMLCanvasElement,
  tune: RoiFineTune = DEFAULT_FINE_TUNE,
): Promise<RecognizeResult[]> {
  try {
    await Promise.all([loadPreviewThumbTemplates(), loadTypeIconTemplates()]);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return emptyResults();

    const content = computeContentRect(canvas.width, canvas.height);
    const panel = resolveEnemyPanel(tune);
    const panelPx = panelToFrameRect(content, panel);

    const results: RecognizeResult[] = [];
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      try {
        // Recognition crop === overlay yellow: card body height (CARD_GAP_FRAC),
        // then square thumb via thumbRectInSlot (same geometry as thumbCssPercent).
        // Type veto uses full red card body (top-right icons) — panel geometry unchanged.
        const card = cardRect(panelPx, slot);
        const detected = detectCardTypes(ctx, card);
        const detectedTypes = detected.hard;
        const tRect = thumbRectInSlot(card);
        const { imageData, dataUrl, gray, hue } = cropResizeToTemplate(ctx, tRect);
        const hash = averageHashGray(gray);
        const matched = matchTemplate(hash, gray, hue, detectedTypes, detected.soft);
        let speciesId = canonicalSpeciesId(matched.speciesId);
        let speciesNameZh = matched.speciesNameZh;
        if (speciesId) {
          const sp = findSpecies(speciesId);
          if (sp) {
            speciesId = sp.key;
            speciesNameZh = sp.nameZh;
          }
          // Keep matched showdownId even if species DB lacks an entry (template zh retained).
        }
        results.push({
          slot,
          confidence: matched.confidence,
          speciesId,
          speciesNameZh,
          species: speciesId,
          thumbnailDataUrl: dataUrl || undefined,
          hash,
          altSpeciesId: matched.altSpeciesId,
          margin: matched.margin,
          detectedTypes: matched.detectedTypes,
          typeScores: detected.scores,
          rejectReason: matched.rejectReason,
          topCandidates: matched.topCandidates,
          ahashHit: matched.ahashHit,
        });
      } catch {
        results.push({
          slot,
          confidence: 0,
          speciesId: null,
          speciesNameZh: null,
          species: null,
        });
      }
    }
    return results;
  } catch {
    return emptyResults();
  }
}

/**
 * 從 live video 抓「一幀」後辨認（按鈕觸發，非連續）。
 */
export async function recognizeEnemyTeam(
  video: HTMLVideoElement,
  tune: RoiFineTune = DEFAULT_FINE_TUNE,
): Promise<RecognizeResult[]> {
  try {
    if (!video.videoWidth) return emptyResults();
    const canvas = grabFrame(video);
    return recognizeEnemyTeamFromCanvas(canvas, tune);
  } catch {
    return emptyResults();
  }
}

/** Built-in Team Preview fixtures under public/fixtures/ (「載入測試圖」 cycles test-1～4). */
export const TEAM_PREVIEW_FIXTURES = [
  'fixtures/team-preview-test-1.jpg',
  'fixtures/team-preview-test-2.jpg',
  'fixtures/team-preview-test-3.jpg',
  'fixtures/team-preview-test-4.jpg',
] as const;

let fixtureCursor = 0;

function withBase(rel: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const path = rel.replace(/^\//, '');
  return base.endsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

/** 測試圖路徑（相對 Vite BASE_URL）；每次呼叫前進下一張 */
export function fixtureTeamPreviewUrl(advance = true): string {
  const rel = TEAM_PREVIEW_FIXTURES[fixtureCursor % TEAM_PREVIEW_FIXTURES.length];
  if (advance) fixtureCursor = (fixtureCursor + 1) % TEAM_PREVIEW_FIXTURES.length;
  return withBase(rel);
}

/** Peek current fixture label without advancing */
export function currentFixtureLabel(): string {
  const rel = TEAM_PREVIEW_FIXTURES[fixtureCursor % TEAM_PREVIEW_FIXTURES.length];
  return rel.split('/').pop() || rel;
}
