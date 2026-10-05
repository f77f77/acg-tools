import type { StatKey, Stats } from '../types';

/** Showdown / 中文性格 → ±10% 能力（HP 不受性格影響） */
const NATURE_MODS: Record<string, { plus?: StatKey; minus?: StatKey }> = {
  hardy: {},
  docile: {},
  serious: {},
  bashful: {},
  quirky: {},
  lonely: { plus: 'atk', minus: 'def' },
  brave: { plus: 'atk', minus: 'spe' },
  adamant: { plus: 'atk', minus: 'spa' },
  naughty: { plus: 'atk', minus: 'spd' },
  bold: { plus: 'def', minus: 'atk' },
  relaxed: { plus: 'def', minus: 'spe' },
  impish: { plus: 'def', minus: 'spa' },
  lax: { plus: 'def', minus: 'spd' },
  modest: { plus: 'spa', minus: 'atk' },
  mild: { plus: 'spa', minus: 'def' },
  quiet: { plus: 'spa', minus: 'spe' },
  rash: { plus: 'spa', minus: 'spd' },
  calm: { plus: 'spd', minus: 'atk' },
  gentle: { plus: 'spd', minus: 'def' },
  sassy: { plus: 'spd', minus: 'spe' },
  careful: { plus: 'spd', minus: 'spa' },
  timid: { plus: 'spe', minus: 'atk' },
  hasty: { plus: 'spe', minus: 'def' },
  jolly: { plus: 'spe', minus: 'spa' },
  naive: { plus: 'spe', minus: 'spd' },
  勤奮: {},
  坦率: {},
  認真: {},
  害羞: {},
  浮躁: {},
  怕寂寞: { plus: 'atk', minus: 'def' },
  勇敢: { plus: 'atk', minus: 'spe' },
  固執: { plus: 'atk', minus: 'spa' },
  頑皮: { plus: 'atk', minus: 'spd' },
  大膽: { plus: 'def', minus: 'atk' },
  悠閒: { plus: 'def', minus: 'spe' },
  淘氣: { plus: 'def', minus: 'spa' },
  樂天: { plus: 'def', minus: 'spd' },
  內斂: { plus: 'spa', minus: 'atk' },
  慢吞吞: { plus: 'spa', minus: 'def' },
  冷靜: { plus: 'spa', minus: 'spe' },
  馬虎: { plus: 'spa', minus: 'spd' },
  溫和: { plus: 'spd', minus: 'atk' },
  溫順: { plus: 'spd', minus: 'def' },
  自大: { plus: 'spd', minus: 'spe' },
  慎重: { plus: 'spd', minus: 'spa' },
  膽小: { plus: 'spe', minus: 'atk' },
  急躁: { plus: 'spe', minus: 'def' },
  爽朗: { plus: 'spe', minus: 'spa' },
  天真: { plus: 'spe', minus: 'spd' },
};

export function normalizeNatureName(nature?: string | null): string {
  return String(nature || '')
    .trim()
    .replace(/\s*nature\s*$/i, '')
    .replace(/^性格[:：]\s*/, '')
    .toLowerCase();
}

export function natureMultipliers(nature?: string | null): Partial<Record<StatKey, number>> {
  const key = normalizeNatureName(nature);
  const mod = key ? NATURE_MODS[key] : undefined;
  if (!mod) return {};
  const out: Partial<Record<StatKey, number>> = {};
  if (mod.plus) out[mod.plus] = 1.1;
  if (mod.minus) out[mod.minus] = 0.9;
  return out;
}

/** Infer Champions pts (all values ≤ 32) vs raw Showdown EVs. */
export function inferEvsArePts(evs?: Partial<Stats>, explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (!evs) return true;
  return Object.values(evs).every((v) => v == null || v <= 32);
}

export function evAmount(evs: Partial<Stats> | undefined, key: StatKey, evsArePts?: boolean): number {
  const raw = evs?.[key] ?? 0;
  return inferEvsArePts(evs, evsArePts) ? championsPtsToEv(raw) : Math.min(252, Math.max(0, raw));
}

export function evsToCalc(evs?: Partial<Stats>, evsArePts?: boolean): Partial<Stats> {
  if (!evs) return {};
  return {
    hp: evAmount(evs, 'hp', evsArePts),
    atk: evAmount(evs, 'atk', evsArePts),
    def: evAmount(evs, 'def', evsArePts),
    spa: evAmount(evs, 'spa', evsArePts),
    spd: evAmount(evs, 'spd', evsArePts),
    spe: evAmount(evs, 'spe', evsArePts),
  };
}

export function speedFromInvestment(
  baseSpe: number,
  opts: { evs?: Partial<Stats>; evsArePts?: boolean; nature?: string; speed?: number } = {},
  preferEntered = false,
): number {
  if (preferEntered && opts.speed != null && opts.speed > 0) return opts.speed;
  const ev = evAmount(opts.evs, 'spe', opts.evsArePts);
  const mult = natureMultipliers(opts.nature).spe ?? 1;
  return calcStat(baseSpe, 31, ev, 50, mult);
}

/** Lv50、IV31 的標準能力值公式 */
export function calcStat(
  base: number,
  iv = 31,
  ev = 0,
  level = 50,
  natureMult = 1,
  isHp = false,
): number {
  if (isHp) {
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
  }
  const raw = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
  return Math.floor(raw * natureMult);
}

export function calcAllStats(
  base: Stats,
  evs: Partial<Stats> = {},
  nature: Partial<Record<keyof Stats, number>> | string = {},
  evsArePts?: boolean,
): Stats {
  const calcEvs = evsToCalc(evs, evsArePts);
  const n = typeof nature === 'string' ? natureMultipliers(nature) : nature;
  return {
    hp: calcStat(base.hp, 31, calcEvs.hp ?? 0, 50, 1, true),
    atk: calcStat(base.atk, 31, calcEvs.atk ?? 0, 50, n.atk ?? 1),
    def: calcStat(base.def, 31, calcEvs.def ?? 0, 50, n.def ?? 1),
    spa: calcStat(base.spa, 31, calcEvs.spa ?? 0, 50, n.spa ?? 1),
    spd: calcStat(base.spd, 31, calcEvs.spd ?? 0, 50, n.spd ?? 1),
    spe: calcStat(base.spe, 31, calcEvs.spe ?? 0, 50, n.spe ?? 1),
  };
}

/** 敵方速度軸四段：減速0 / 中性0 / 中性32 / 加速32（Champions Spe 投資 0 或 32 點） */

/** Champions investment pts -> EV: min(252, pts * 8) */
export function championsPtsToEv(pts: number): number {
  return Math.min(252, Math.max(0, Math.floor(pts) * 8));
}

export interface SpeedBand {
  id: string;
  label: string;
  /** 實際 Spe 數值 */
  value: number;
  kind: 'slow' | 'neutral0' | 'neutral32' | 'fast';
}

/**
 * 中性32／加速32：Champions pts 32 → EV=min(252, 32*8)=252。
 * 減速 = 性格 −Spe × EV0；加速 = 性格 +Spe × EV32（右端點，無 加速0）。
 */
export function enemySpeedBands(baseSpe: number): SpeedBand[] {
  const ev32 = championsPtsToEv(32);
  const slow = calcStat(baseSpe, 31, 0, 50, 0.9);
  const n0 = calcStat(baseSpe, 31, 0, 50, 1);
  const n32 = calcStat(baseSpe, 31, ev32, 50, 1);
  const fast = calcStat(baseSpe, 31, ev32, 50, 1.1);
  return [
    { id: 'slow0', label: '減速0', value: slow, kind: 'slow' },
    { id: 'n0', label: '中性0', value: n0, kind: 'neutral0' },
    { id: 'n32', label: '中性32', value: n32, kind: 'neutral32' },
    { id: 'fast32', label: '加速32', value: fast, kind: 'fast' },
  ];
}

export function mySpeedPoint(baseSpe: number, enteredSpeed?: number, ev = 0, natureMult = 1): number {
  if (enteredSpeed != null && enteredSpeed > 0) return enteredSpeed;
  return calcStat(baseSpe, 31, ev, 50, natureMult);
}

/** Tailwind (順風) doubles Speed while the field is up. */
export function applyTailwind(spe: number, tailwind: boolean): number {
  return tailwind ? spe * 2 : spe;
}

export const SPEED_AXIS_MIN = 20;
export const SPEED_AXIS_MAX = 220;
/** Axis ceiling when any side has Tailwind so doubled Spe still fits. */
export const SPEED_AXIS_MAX_TAILWIND = SPEED_AXIS_MAX * 2;
