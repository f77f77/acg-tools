/**
 * Team Preview auto-recognize — ROI color anchors, not per-frame OCR.
 *
 * Every ~500ms in IDLE, sample 1–2 tiny fixed boxes (relative to 16:9 contentRect):
 *   1. Top-center 「級別對戰／雙打對戰」 HUD (dark bar + bright magenta/cyan glyphs)
 *   2. Enemy panel slot-0 card body (maroon / magenta Champions cards)
 *
 * State machine: IDLE → (anchors hold) TRIGGERED (full recognize once) → LOCK
 * until the preview HUD disappears → IDLE. Never re-fire while locked on the
 * same preview screen.
 *
 * Calibrated on public/fixtures/team-preview-test-1.jpg～test-4.jpg @ 1920×1080.
 */

import { computeContentRect, type ContentRect } from './roi';

export type AutoRecognizePhase = 'idle' | 'triggered' | 'lock';

export interface AutoRecognizeState {
  phase: AutoRecognizePhase;
  hitStreak: number;
  missStreak: number;
}

export const AUTO_RECOGNIZE_TICK_MS = 500;
/** Consecutive IDLE hits before firing (≈1s). */
export const AUTO_RECOGNIZE_HIT_NEEDED = 2;
/** Consecutive LOCK misses before returning to IDLE (≈1.5s). */
export const AUTO_RECOGNIZE_MISS_NEEDED = 3;

/** Top-center mode labels: 「級別對戰」「雙打對戰」 */
export const TITLE_HUD_BOX = { left: 0.445, top: 0.018, right: 0.555, bottom: 0.06 } as const;
/** Enemy panel first-card body (maroon / magenta). */
export const ENEMY_CARD0_BOX = { left: 0.86, top: 0.16, right: 0.94, bottom: 0.22 } as const;

export function initialAutoRecognizeState(): AutoRecognizeState {
  return { phase: 'idle', hitStreak: 0, missStreak: 0 };
}

/**
 * Pure state step. `fire` is true only on the IDLE → TRIGGERED edge.
 * Caller runs full recognize once, then keeps ticking; TRIGGERED → LOCK when `busy` clears.
 */
export function stepAutoRecognize(
  state: AutoRecognizeState,
  previewVisible: boolean,
  busy: boolean,
): { next: AutoRecognizeState; fire: boolean } {
  if (state.phase === 'triggered') {
    if (busy) return { next: state, fire: false };
    return { next: { phase: 'lock', hitStreak: 0, missStreak: 0 }, fire: false };
  }
  if (state.phase === 'lock') {
    if (previewVisible) {
      return { next: { ...state, missStreak: 0 }, fire: false };
    }
    const miss = state.missStreak + 1;
    if (miss >= AUTO_RECOGNIZE_MISS_NEEDED) {
      return { next: initialAutoRecognizeState(), fire: false };
    }
    return { next: { ...state, missStreak: miss }, fire: false };
  }
  // idle
  if (!previewVisible) return { next: initialAutoRecognizeState(), fire: false };
  if (busy) return { next: state, fire: false };
  const hit = state.hitStreak + 1;
  if (hit >= AUTO_RECOGNIZE_HIT_NEEDED) {
    return { next: { phase: 'triggered', hitStreak: 0, missStreak: 0 }, fire: true };
  }
  return { next: { phase: 'idle', hitStreak: hit, missStreak: 0 }, fire: false };
}

export function autoRecognizePhaseLabel(phase: AutoRecognizePhase): string {
  if (phase === 'triggered') return '辨認中';
  if (phase === 'lock') return '已鎖定';
  return '待命';
}

interface BoxStats {
  dark: number;
  bright: number;
  cyan: number;
  mag: number;
  reddish: number;
}

let sampleCanvas: HTMLCanvasElement | null = null;

function getSampleCanvas(): HTMLCanvasElement {
  if (!sampleCanvas) sampleCanvas = document.createElement('canvas');
  return sampleCanvas;
}

function sampleBox(
  source: CanvasImageSource,
  content: ContentRect,
  box: { left: number; top: number; right: number; bottom: number },
  outW: number,
  outH: number,
): BoxStats | null {
  const sx = content.x + box.left * content.width;
  const sy = content.y + box.top * content.height;
  const sw = Math.max(1, (box.right - box.left) * content.width);
  const sh = Math.max(1, (box.bottom - box.top) * content.height);
  const canvas = getSampleCanvas();
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, outW, outH);
  try {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  } catch {
    return null;
  }
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, outW, outH);
  } catch {
    return null;
  }
  const px = data.data;
  const n = outW * outH;
  if (n <= 0) return null;
  let dark = 0;
  let bright = 0;
  let cyan = 0;
  let mag = 0;
  let reddish = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (mx < 40) dark += 1;
    if (mx > 210) bright += 1;
    if (b > 140 && g > 140 && r < g * 0.85 && r < b * 0.85) cyan += 1;
    if (r > 120 && b > 100 && g < r * 0.7 && b > g) mag += 1;
    if (r > 80 && r > g + 15) reddish += 1;
  }
  return {
    dark: dark / n,
    bright: bright / n,
    cyan: cyan / n,
    mag: mag / n,
    reddish: reddish / n,
  };
}

function isTitleHud(s: BoxStats): boolean {
  // Fixtures: dark ≈ 0.54, bright ≈ 0.26, cyan ≈ 0.086, mag ≈ 0.023
  return s.dark >= 0.3 && s.bright >= 0.12 && (s.cyan >= 0.04 || s.mag >= 0.015);
}

function isEnemyPreviewCards(s: BoxStats): boolean {
  // Fixtures slot-0 reddish ≈ 0.53–0.74
  return s.reddish >= 0.35;
}

/** True when Team Preview HUD anchors are both present. Never runs OCR / template match. */
export function detectTeamPreviewAnchors(
  source: CanvasImageSource,
  frameW: number,
  frameH: number,
): boolean {
  if (frameW < 16 || frameH < 16) return false;
  const content = computeContentRect(frameW, frameH);
  const title = sampleBox(source, content, TITLE_HUD_BOX, 32, 16);
  const enemy = sampleBox(source, content, ENEMY_CARD0_BOX, 24, 16);
  if (!title || !enemy) return false;
  return isTitleHud(title) && isEnemyPreviewCards(enemy);
}
