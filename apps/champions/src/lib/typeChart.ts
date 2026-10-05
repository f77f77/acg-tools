import type { PokemonType } from '../types';

export const ALL_TYPES: PokemonType[] = [
  '一般', '火', '水', '電', '草', '冰',
  '格鬥', '毒', '地面', '飛行', '超能力', '蟲',
  '岩石', '幽靈', '龍', '惡', '鋼', '妖精',
];

/** 攻擊方 → 防守方 → 倍率（離線完整表） */
const CHART: Record<PokemonType, Partial<Record<PokemonType, number>>> = {
  一般: { 岩石: 0.5, 幽靈: 0, 鋼: 0.5 },
  火: { 火: 0.5, 水: 0.5, 草: 2, 冰: 2, 蟲: 2, 岩石: 0.5, 龍: 0.5, 鋼: 2 },
  水: { 火: 2, 水: 0.5, 草: 0.5, 地面: 2, 岩石: 2, 龍: 0.5 },
  電: { 水: 2, 電: 0.5, 草: 0.5, 地面: 0, 飛行: 2, 龍: 0.5 },
  草: { 火: 0.5, 水: 2, 草: 0.5, 毒: 0.5, 地面: 2, 飛行: 0.5, 蟲: 0.5, 岩石: 2, 龍: 0.5, 鋼: 0.5 },
  冰: { 火: 0.5, 水: 0.5, 草: 2, 冰: 0.5, 地面: 2, 飛行: 2, 龍: 2, 鋼: 0.5 },
  格鬥: { 一般: 2, 冰: 2, 毒: 0.5, 飛行: 0.5, 超能力: 0.5, 蟲: 0.5, 岩石: 2, 幽靈: 0, 惡: 2, 鋼: 2, 妖精: 0.5 },
  毒: { 草: 2, 毒: 0.5, 地面: 0.5, 岩石: 0.5, 幽靈: 0.5, 鋼: 0, 妖精: 2 },
  地面: { 火: 2, 電: 2, 草: 0.5, 毒: 2, 飛行: 0, 蟲: 0.5, 岩石: 2, 鋼: 2 },
  飛行: { 電: 0.5, 草: 2, 格鬥: 2, 蟲: 2, 岩石: 0.5, 鋼: 0.5 },
  超能力: { 格鬥: 2, 毒: 2, 超能力: 0.5, 惡: 0, 鋼: 0.5 },
  蟲: { 火: 0.5, 草: 2, 格鬥: 0.5, 毒: 0.5, 飛行: 0.5, 超能力: 2, 幽靈: 0.5, 惡: 2, 鋼: 0.5, 妖精: 0.5 },
  岩石: { 火: 2, 冰: 2, 格鬥: 0.5, 地面: 0.5, 飛行: 2, 蟲: 2, 鋼: 0.5 },
  幽靈: { 一般: 0, 超能力: 2, 幽靈: 2, 惡: 0.5 },
  龍: { 龍: 2, 鋼: 0.5, 妖精: 0 },
  惡: { 格鬥: 0.5, 超能力: 2, 幽靈: 2, 惡: 0.5, 妖精: 0.5 },
  鋼: { 火: 0.5, 水: 0.5, 電: 0.5, 冰: 2, 岩石: 2, 鋼: 0.5, 妖精: 2 },
  妖精: { 火: 0.5, 格鬥: 2, 毒: 0.5, 龍: 2, 惡: 2, 鋼: 0.5 },
};

export function typeEffectiveness(attack: PokemonType, defense: PokemonType): number {
  return CHART[attack]?.[defense] ?? 1;
}

/** 防守方對 18 屬的承傷倍率 */
export function defensiveMatchups(defTypes: PokemonType[]): Record<PokemonType, number> {
  const result = {} as Record<PokemonType, number>;
  for (const atk of ALL_TYPES) {
    let mult = 1;
    for (const def of defTypes) {
      mult *= typeEffectiveness(atk, def);
    }
    result[atk] = mult;
  }
  return result;
}

export function matchupClass(mult: number): 'immune' | 'resist' | 'neutral' | 'weak' | 'x4' {
  if (mult === 0) return 'immune';
  if (mult < 1) return 'resist';
  if (mult === 1) return 'neutral';
  if (mult >= 4) return 'x4';
  return 'weak';
}

export const TYPE_COLORS: Record<PokemonType, string> = {
  一般: '#A8A878', 火: '#F08030', 水: '#6890F0', 電: '#F8D030', 草: '#78C850', 冰: '#98D8D8',
  格鬥: '#C03028', 毒: '#A040A0', 地面: '#E0C068', 飛行: '#A890F0', 超能力: '#F85888', 蟲: '#A8B820',
  岩石: '#B8A038', 幽靈: '#705898', 龍: '#7038F8', 惡: '#705848', 鋼: '#B8B8D0', 妖精: '#EE99AC',
};
