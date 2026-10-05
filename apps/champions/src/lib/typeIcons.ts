import type { PokemonType } from '../types';
import { ALL_TYPES } from './typeChart';

/** English id used in `public/types/{id}.svg` URLs */
export type TypeIconId =
  | 'normal'
  | 'fire'
  | 'water'
  | 'grass'
  | 'electric'
  | 'ice'
  | 'fighting'
  | 'poison'
  | 'ground'
  | 'flying'
  | 'psychic'
  | 'bug'
  | 'rock'
  | 'ghost'
  | 'dragon'
  | 'dark'
  | 'steel'
  | 'fairy';

export const TYPE_ZH_TO_ID: Record<PokemonType, TypeIconId> = {
  一般: 'normal',
  火: 'fire',
  水: 'water',
  草: 'grass',
  電: 'electric',
  冰: 'ice',
  格鬥: 'fighting',
  毒: 'poison',
  地面: 'ground',
  飛行: 'flying',
  超能力: 'psychic',
  蟲: 'bug',
  岩石: 'rock',
  幽靈: 'ghost',
  龍: 'dragon',
  惡: 'dark',
  鋼: 'steel',
  妖精: 'fairy',
};

export const TYPE_ID_TO_ZH: Record<TypeIconId, PokemonType> = {
  normal: '一般',
  fire: '火',
  water: '水',
  grass: '草',
  electric: '電',
  ice: '冰',
  fighting: '格鬥',
  poison: '毒',
  ground: '地面',
  flying: '飛行',
  psychic: '超能力',
  bug: '蟲',
  rock: '岩石',
  ghost: '幽靈',
  dragon: '龍',
  dark: '惡',
  steel: '鋼',
  fairy: '妖精',
};

export function typeToId(type: PokemonType | string): TypeIconId | null {
  if (type in TYPE_ZH_TO_ID) return TYPE_ZH_TO_ID[type as PokemonType];
  const lower = String(type).toLowerCase();
  if (lower in TYPE_ID_TO_ZH) return lower as TypeIconId;
  return null;
}

export function idToZh(id: TypeIconId): PokemonType {
  return TYPE_ID_TO_ZH[id];
}

/** Asset URL under Vite `base` (GitHub Pages-safe). */
export function typeIconUrl(typeOrId: PokemonType | TypeIconId | string): string | null {
  const id = typeToId(typeOrId);
  if (!id) return null;
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}types/${id}.svg`;
}

/** Species type badge URLs (1–2 types). */
export function speciesTypeIconUrls(types: Array<PokemonType | string>): Array<{ zh: string; id: TypeIconId; url: string }> {
  const out: Array<{ zh: string; id: TypeIconId; url: string }> = [];
  for (const t of types) {
    const id = typeToId(t);
    const url = typeIconUrl(t);
    if (!id || !url) continue;
    out.push({ zh: idToZh(id), id, url });
  }
  return out;
}

/** Move type badge URL (single). */
export function moveTypeIconUrl(moveType: PokemonType | string): string | null {
  return typeIconUrl(moveType);
}

export { ALL_TYPES };
