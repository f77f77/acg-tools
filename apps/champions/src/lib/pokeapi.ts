import { findSpecies, type SpeciesData } from './species';

/**
 * 可選 PokeAPI 抓取；失敗則回落本地 SPECIES_DB。
 */
export async function fetchSpeciesOptional(query: string): Promise<SpeciesData | undefined> {
  const local = findSpecies(query);
  if (local) return local;
  try {
    const key = query.trim().toLowerCase().replace(/\s+/g, '-');
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      name: string;
      types: { type: { name: string } }[];
      stats: { base_stat: number; stat: { name: string } }[];
    };
    const typeMap: Record<string, SpeciesData['types'][number]> = {
      normal: '一般', fire: '火', water: '水', electric: '電', grass: '草', ice: '冰',
      fighting: '格鬥', poison: '毒', ground: '地面', flying: '飛行', psychic: '超能力', bug: '蟲',
      rock: '岩石', ghost: '幽靈', dragon: '龍', dark: '惡', steel: '鋼', fairy: '妖精',
    };
    const get = (n: string) => data.stats.find((s) => s.stat.name === n)?.base_stat ?? 0;
    return {
      key: data.name,
      nameZh: data.name,
      nameEn: data.name,
      types: data.types.map((t) => typeMap[t.type.name] ?? '一般'),
      baseStats: {
        hp: get('hp'),
        atk: get('attack'),
        def: get('defense'),
        spa: get('special-attack'),
        spd: get('special-defense'),
        spe: get('speed'),
      },
    };
  } catch {
    return findSpecies(query);
  }
}
