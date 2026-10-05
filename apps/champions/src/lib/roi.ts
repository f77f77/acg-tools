/**
 * Team Preview 敵方縮圖 ROI（對齊 VGC 助手規格）。
 *
 * 座標系一律相對「去黑邊後的 16:9 內容區」(contentRect)，不是整幀。
 * 預設敵方面板（內層 card pitch）：(left,top)=(0.811,0.137) → (right,bottom)=(0.965,0.836)
 * 再均分成 6 等距 pitch；紅卡本體 = pitch×(1-CARD_GAP_FRAC)（上下留 gap）；
 * 黃框為正方形：邊長 = 紅卡本體高度，水平置於左側精靈區（黃框之間可見 gap）。
 * 綠框為視覺外框：相對內層 pitch 上下再外擴 PANEL_OUTER_MARGIN_FRAC（不影響黃框／辨認）。
 * 辨認裁切後 contain/letterbox 進 TEMPLATE_SIZE（不拉伸）；模板來自 sprite_poke_3 切格。
 *
 * 微調：Settings 可對面板四邊做 ±2%（相對內容寬／高）偏移。
 */

export const TARGET_ASPECT = 16 / 9;

/** 敵方面板預設（相對 contentRect 的 0–1） */
export const ENEMY_PANEL_DEFAULT = {
  left: 0.811,
  /** Calibrated from fixture card centers (cy0 - pitch/2). */
  top: 0.137,
  right: 0.965,
  /** Calibrated from fixture card centers (cy5 + pitch/2). */
  bottom: 0.836,
} as const;

/**
 * 黃框：正方形，邊長 = 紅卡本體高度；left = 正方形左緣相對 card/pitch 寬的偏移（精靈在左）。
 * right / topInset / bottomInset 僅供文件與舊腳本對照 — 幾何由 thumbRectInSlot 以正方形計算。
 */
export const THUMB_CROP = {
  /** 正方形左緣（相對 card 寬）— 覆蓋左側精靈，避開右側類型圖示 */
  left: 0.18,
  /** @deprecated 正方形寬由 inset 後邊長推得；保留欄位供腳本同步顯示 */
  right: 0.18 + 0.42,
  /**
   * Yellow inset inside red card body (fraction of card body height).
   * 0 = flush with card body (body already inset from pitch by CARD_GAP_FRAC/2).
   * Non-zero keeps yellow square: side = bodyH × (1 - topInset - bottomInset).
   */
  topInset: 0.0,
  bottomInset: 0.0,
} as const;

export const SLOT_COUNT = 6;

/**
 * Fraction of each pitch that is inter-card gap (split half above + half below card body).
 * ~7–9% of pitch from VGC screenshots; 0.08 ≈ mid of measured range.
 */
/** Inter-card gap as fraction of pitch (fixture-tuned with panel centers). */
export const CARD_GAP_FRAC = 0.08;

/**
 * Green panel visual outer pad (fraction of content height), applied only to
 * panelCssPercent / panelVisualNorm — NOT to pitch, cardRect, yellow, or recognition.
 * 0.02 ≈ ≥24px @1080p content height (visual green only; does not shift yellow/pitch).
 */
export const PANEL_OUTER_MARGIN_FRAC = 0.02;

/** 模板比對前縮放邊長（Team Preview 小縮圖，非大圖／HOME） */
export const TEMPLATE_SIZE = 64;

/** Settings 微調上限（相對內容寬／高） */
export const ROI_FINE_TUNE_MAX = 0.02;

export const ROI_STORAGE_KEY = 'pkmn-champions-roi-tune';
export const ROI_DEBUG_STORAGE_KEY = 'pkmn-champions-roi-debug';

export interface ContentRect {
  /** 內容區左上角（像素，相對整幀） */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoiFineTune {
  /** 相對 content 寬／高的偏移，建議 |v| ≤ 0.02 */
  dLeft: number;
  dTop: number;
  dRight: number;
  dBottom: number;
}

export const DEFAULT_FINE_TUNE: RoiFineTune = {
  dLeft: 0,
  dTop: 0,
  dRight: 0,
  dBottom: 0,
};

export interface PanelRectNorm {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 從整幀推導 16:9 內容區（處理 letterbox／pillarbox 黑邊）。
 * 假設遊戲畫面為 16:9，置中於 capture 幀內。
 */
export function computeContentRect(
  frameW: number,
  frameH: number,
  targetAspect: number = TARGET_ASPECT,
): ContentRect {
  if (frameW <= 0 || frameH <= 0) {
    return { x: 0, y: 0, width: Math.max(1, frameW), height: Math.max(1, frameH) };
  }
  const frameAspect = frameW / frameH;
  if (frameAspect > targetAspect) {
    // 左右黑邊（pillarbox）
    const width = Math.floor(frameH * targetAspect);
    const x = Math.floor((frameW - width) / 2);
    return { x, y: 0, width, height: frameH };
  }
  if (frameAspect < targetAspect) {
    // 上下黑邊（letterbox）
    const height = Math.floor(frameW / targetAspect);
    const y = Math.floor((frameH - height) / 2);
    return { x: 0, y, width: frameW, height };
  }
  return { x: 0, y: 0, width: frameW, height: frameH };
}

/** 套用 ±2% 微調後的敵方面板（相對 content） */
export function resolveEnemyPanel(tune: RoiFineTune = DEFAULT_FINE_TUNE): PanelRectNorm {
  const left = clamp(ENEMY_PANEL_DEFAULT.left + tune.dLeft, 0, 0.98);
  const top = clamp(ENEMY_PANEL_DEFAULT.top + tune.dTop, 0, 0.98);
  const right = clamp(ENEMY_PANEL_DEFAULT.right + tune.dRight, left + 0.02, 1);
  const bottom = clamp(ENEMY_PANEL_DEFAULT.bottom + tune.dBottom, top + 0.02, 1);
  return { left, top, right, bottom };
}

/** 敵方面板 → 整幀像素矩形 */
export function panelToFrameRect(content: ContentRect, panel: PanelRectNorm): PixelRect {
  const x = content.x + panel.left * content.width;
  const y = content.y + panel.top * content.height;
  const width = (panel.right - panel.left) * content.width;
  const height = (panel.bottom - panel.top) * content.height;
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}

/** 第 slot 格（0–5）的整幀像素矩形（六等分 pitch；綠框可用） */
export function slotRect(panelPx: PixelRect, slot: number, slots: number = SLOT_COUNT): PixelRect {
  const slotH = panelPx.height / slots;
  return {
    x: panelPx.x,
    y: Math.floor(panelPx.y + slot * slotH),
    width: panelPx.width,
    height: Math.max(1, Math.floor(slotH)),
  };
}

/**
 * 紅卡本體矩形：在 pitch 內上下各留 CARD_GAP_FRAC/2，高度 = pitch×(1-CARD_GAP_FRAC)。
 * 黃框邊長與辨認裁切以此高度為準（非 flush panelH/6）。
 */
export function cardRect(
  panelPx: PixelRect,
  slot: number,
  slots: number = SLOT_COUNT,
  gapFrac: number = CARD_GAP_FRAC,
): PixelRect {
  const pitch = panelPx.height / slots;
  const gap = Math.max(0, Math.min(0.4, gapFrac));
  const bodyH = pitch * (1 - gap);
  const topInset = pitch * (gap / 2);
  return {
    x: panelPx.x,
    y: Math.floor(panelPx.y + slot * pitch + topInset),
    width: panelPx.width,
    height: Math.max(1, Math.floor(bodyH)),
  };
}

/**
 * 單格內黃框：正方形，邊長 = 紅卡本體高度，左緣 = card.x + left×card.width。
 * 傳入 cardRect（或等高矩形）；回傳整幀像素座標（不超出 card 右緣）。
 */
export function thumbRectInSlot(card: PixelRect): PixelRect {
  const topInset = Math.max(0, Math.min(0.2, THUMB_CROP.topInset)) * card.height;
  const bottomInset = Math.max(0, Math.min(0.2, THUMB_CROP.bottomInset)) * card.height;
  const side = Math.max(1, Math.floor(card.height - topInset - bottomInset));
  let x = card.x + card.width * THUMB_CROP.left;
  const maxX = card.x + Math.max(0, card.width - side);
  x = Math.min(Math.max(card.x, x), maxX);
  const y = card.y + topInset;
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width: Math.floor(side),
    height: Math.floor(side),
  };
}

/**
 * Visual green frame = inner pitch panel expanded by PANEL_OUTER_MARGIN_FRAC
 * on top/bottom (content-height fractions). Pitch/cards/yellow stay on `panel`.
 */
export function panelVisualNorm(
  panel: PanelRectNorm,
  marginFrac: number = PANEL_OUTER_MARGIN_FRAC,
): PanelRectNorm {
  const m = Math.max(0, marginFrac);
  return {
    left: panel.left,
    right: panel.right,
    top: clamp(panel.top - m, 0, 0.98),
    bottom: clamp(panel.bottom + m, panel.top - m + 0.02, 1),
  };
}

/** Overlay 用綠框：相對「預覽容器／內容區」的 CSS %（0–100）；含外緣 margin */
export function panelCssPercent(panel: PanelRectNorm): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const v = panelVisualNorm(panel);
  return {
    left: v.left * 100,
    top: v.top * 100,
    width: (v.right - v.left) * 100,
    height: (v.bottom - v.top) * 100,
  };
}

export function slotCssPercent(
  panel: PanelRectNorm,
  slot: number,
  slots: number = SLOT_COUNT,
): { left: number; top: number; width: number; height: number } {
  const panelH = panel.bottom - panel.top;
  const slotH = panelH / slots;
  return {
    left: panel.left * 100,
    top: (panel.top + slot * slotH) * 100,
    width: (panel.right - panel.left) * 100,
    height: slotH * 100,
  };
}

export function cardCssPercent(
  panel: PanelRectNorm,
  slot: number,
  slots: number = SLOT_COUNT,
  gapFrac: number = CARD_GAP_FRAC,
): { left: number; top: number; width: number; height: number } {
  const panelH = panel.bottom - panel.top;
  const pitch = panelH / slots;
  const gap = Math.max(0, Math.min(0.4, gapFrac));
  const bodyH = pitch * (1 - gap);
  const topInset = pitch * (gap / 2);
  return {
    left: panel.left * 100,
    top: (panel.top + slot * pitch + topInset) * 100,
    width: (panel.right - panel.left) * 100,
    height: bodyH * 100,
  };
}

export function thumbCssPercent(
  panel: PanelRectNorm,
  slot: number,
  slots: number = SLOT_COUNT,
  gapFrac: number = CARD_GAP_FRAC,
): { left: number; top: number; width: number; height: number } {
  const panelH = panel.bottom - panel.top;
  const panelW = panel.right - panel.left;
  const pitch = panelH / slots;
  const gap = Math.max(0, Math.min(0.4, gapFrac));
  const bodyH = pitch * (1 - gap);
  const topInset = pitch * (gap / 2);
  const cardTop = panel.top + slot * pitch + topInset;
  const yInset = Math.max(0, Math.min(0.2, THUMB_CROP.topInset));
  const yInsetBot = Math.max(0, Math.min(0.2, THUMB_CROP.bottomInset));
  // Visual square on 16:9 content: height% of contentH == width% of contentW in pixels
  const heightFrac = bodyH * (1 - yInset - yInsetBot);
  const widthFrac = heightFrac / TARGET_ASPECT;
  let left = panel.left + panelW * THUMB_CROP.left;
  const maxLeft = panel.left + panelW - widthFrac;
  left = Math.min(Math.max(panel.left, left), maxLeft);
  return {
    left: left * 100,
    top: (cardTop + bodyH * yInset) * 100,
    width: widthFrac * 100,
    height: heightFrac * 100,
  };
}

export function loadFineTune(): RoiFineTune {
  try {
    const raw = localStorage.getItem(ROI_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FINE_TUNE };
    const parsed = JSON.parse(raw) as Partial<RoiFineTune>;
    return {
      dLeft: clamp(Number(parsed.dLeft) || 0, -ROI_FINE_TUNE_MAX, ROI_FINE_TUNE_MAX),
      dTop: clamp(Number(parsed.dTop) || 0, -ROI_FINE_TUNE_MAX, ROI_FINE_TUNE_MAX),
      dRight: clamp(Number(parsed.dRight) || 0, -ROI_FINE_TUNE_MAX, ROI_FINE_TUNE_MAX),
      dBottom: clamp(Number(parsed.dBottom) || 0, -ROI_FINE_TUNE_MAX, ROI_FINE_TUNE_MAX),
    };
  } catch {
    return { ...DEFAULT_FINE_TUNE };
  }
}

export function saveFineTune(tune: RoiFineTune): void {
  localStorage.setItem(ROI_STORAGE_KEY, JSON.stringify(tune));
}

export function loadDebugOverlay(): boolean {
  try {
    return localStorage.getItem(ROI_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveDebugOverlay(on: boolean): void {
  localStorage.setItem(ROI_DEBUG_STORAGE_KEY, on ? '1' : '0');
}
