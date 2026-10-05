import type { PokemonFormOption, PokemonSet, PokemonType, Stats } from '../types';
import { TYPE_ID_TO_ZH, type TypeIconId } from './typeIcons';

export interface SpeciesFormData {
  showdownId: string;
  formKey: string;
  label: string;
  types: PokemonType[];
  baseStats: Stats;
  isDefault?: boolean;
}

export interface SpeciesData {
  key: string;
  nameZh: string;
  nameEn: string;
  types: PokemonType[];
  baseStats: Stats;
  nationalDex?: number | null;
  formKey?: string;
  formLabel?: string;
  forms?: SpeciesFormData[];
  /** PokéAPI species slug (shared by gender/mega siblings). */
  speciesKey?: string;
  /** True when this showdownId is in the Champions legal allowlist (262). Independent of CBD usage rows. */
  championsLegal?: boolean;
}

/**
 * Atlas / PokéAPI / dex-key aliases → canonical allowlist showdownId.
 * Male Basculegion is `basculegion` (dex 902 form 0); female is `basculegionf`.
 * Male Indeedee is `indeedee` (dex 876 form 0); female is `indeedeef`.
 * Showdown writes the female as `Indeedee-F`, which must not stay on the offline stub key.
 */
export const SPECIES_ID_ALIASES: Record<string, string> = {
  'basculegion-male': 'basculegion',
  basculegionmale: 'basculegion',
  basculegionm: 'basculegion',
  '902': 'basculegion',
  '902-0': 'basculegion',
  '902-male': 'basculegion',
  'basculegion-female': 'basculegionf',
  '902-1': 'basculegionf',
  '902-female': 'basculegionf',
  'indeedee-male': 'indeedee',
  indeedeemale: 'indeedee',
  indeedeem: 'indeedee',
  '876': 'indeedee',
  '876-0': 'indeedee',
  '876-male': 'indeedee',
  'indeedee-f': 'indeedeef',
  'indeedee-female': 'indeedeef',
  indeedeefemale: 'indeedeef',
  '876-1': 'indeedeef',
  '876-female': 'indeedeef',
  'mimikyu-disguised': 'mimikyu',
  mimikyudisguised: 'mimikyu',
  '778': 'mimikyu',
  '778-0': 'mimikyu',
  'ninetales-alola': 'ninetalesalola',
  '38-1': 'ninetalesalola',
  'typhlosion-hisui': 'typhlosionhisui',
  '157-1': 'typhlosionhisui',
  'rotom-wash': 'rotomwash',
  '479-1': 'rotomwash',
  'slowbro-galar': 'slowbrogalar',
  '80-1': 'slowbrogalar',
  sylveon: 'sylveon',
  '700': 'sylveon',
  '700-0': 'sylveon',
  greninja: 'greninja',
  '658': 'greninja',
  '658-0': 'greninja',
  absol: 'absol',
  '359': 'absol',
  '359-0': 'absol',
};

/** 離線示範用種族資料（足夠 demo；boot 時由 pokemon.json overlay） */
export const SPECIES_DB: SpeciesData[] = [
  { key: 'incineroar', nameZh: '熾焰咆哮虎', nameEn: 'Incineroar', nationalDex: 727, types: ['火', '惡'], baseStats: { hp: 95, atk: 115, def: 90, spa: 80, spd: 90, spe: 60 } },
  { key: 'rillaboom', nameZh: '轟擂金剛猩', nameEn: 'Rillaboom', nationalDex: 812, types: ['草'], baseStats: { hp: 100, atk: 125, def: 90, spa: 60, spd: 70, spe: 85 } },
  { key: 'urshifu-rapid-strike', nameZh: '武道熊師-連擊', nameEn: 'Urshifu-Rapid-Strike', nationalDex: 892, types: ['格鬥', '水'], baseStats: { hp: 100, atk: 130, def: 100, spa: 63, spd: 60, spe: 97 } },
  { key: 'flutter-mane', nameZh: '飄飄肥麵', nameEn: 'Flutter Mane', nationalDex: 1005, types: ['幽靈', '妖精'], baseStats: { hp: 55, atk: 55, def: 55, spa: 135, spd: 135, spe: 135 } },
  { key: 'roaring-moon', nameZh: '轟鳴月', nameEn: 'Roaring Moon', nationalDex: 1005, types: ['龍', '惡'], baseStats: { hp: 105, atk: 139, def: 71, spa: 55, spd: 101, spe: 119 } },
  { key: 'landorus-therian', nameZh: '土地雲-靈獸', nameEn: 'Landorus-Therian', nationalDex: 645, types: ['地面', '飛行'], baseStats: { hp: 89, atk: 145, def: 90, spa: 105, spd: 80, spe: 91 } },
  { key: 'miraidon', nameZh: '密勒頓', nameEn: 'Miraidon', nationalDex: 1008, types: ['電', '龍'], baseStats: { hp: 100, atk: 85, def: 100, spa: 135, spd: 115, spe: 135 } },
  { key: 'koraidon', nameZh: '故勒頓', nameEn: 'Koraidon', nationalDex: 1007, types: ['格鬥', '龍'], baseStats: { hp: 100, atk: 135, def: 115, spa: 85, spd: 100, spe: 135 } },
  { key: 'garchomp', nameZh: '烈咬陸鯊', nameEn: 'Garchomp', nationalDex: 445, types: ['龍', '地面'], baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 } },
  { key: 'amoonguss', nameZh: '敗露球菇', nameEn: 'Amoonguss', nationalDex: 591, types: ['草', '毒'], baseStats: { hp: 114, atk: 85, def: 70, spa: 85, spd: 80, spe: 30 } },
  { key: 'indeedee', nameZh: '愛管侍', nameEn: 'Indeedee', nationalDex: 876, formKey: 'indeedee-male', formLabel: '雄性的樣子', types: ['超能力', '一般'], baseStats: { hp: 60, atk: 65, def: 55, spa: 105, spd: 95, spe: 95 } },
  { key: 'indeedeef', nameZh: '愛管侍', nameEn: 'Indeedee-F', nationalDex: 876, formKey: 'indeedee-female', formLabel: '雌性的樣子', types: ['超能力', '一般'], baseStats: { hp: 70, atk: 55, def: 65, spa: 95, spd: 105, spe: 85 } },
  { key: 'tornadus', nameZh: '龍捲雲', nameEn: 'Tornadus', nationalDex: 641, types: ['飛行'], baseStats: { hp: 79, atk: 115, def: 70, spa: 125, spd: 80, spe: 111 } },
  { key: 'chien-pao', nameZh: '古劍豹', nameEn: 'Chien-Pao', nationalDex: 1002, types: ['惡', '冰'], baseStats: { hp: 80, atk: 120, def: 80, spa: 90, spd: 65, spe: 135 } },
  { key: 'ting-lu', nameZh: '古鼎鹿', nameEn: 'Ting-Lu', nationalDex: 1003, types: ['惡', '地面'], baseStats: { hp: 155, atk: 110, def: 125, spa: 55, spd: 80, spe: 45 } },
  { key: 'ogerpon-wellspring', nameZh: '厄詭椪-水井', nameEn: 'Ogerpon-Wellspring', nationalDex: 1017, types: ['草', '水'], baseStats: { hp: 80, atk: 120, def: 84, spa: 60, spd: 96, spe: 110 } },
  { key: 'pelipper', nameZh: '大嘴鷗', nameEn: 'Pelipper', nationalDex: 279, types: ['水', '飛行'], baseStats: { hp: 60, atk: 50, def: 100, spa: 95, spd: 70, spe: 65 } },
  { key: 'noivern', nameZh: '音波龍', nameEn: 'Noivern', nationalDex: 715, types: ['飛行', '龍'], baseStats: { hp: 85, atk: 70, def: 80, spa: 97, spd: 80, spe: 123 } },
  { key: 'lycanroc', nameZh: '鬃岩狼人', nameEn: 'Lycanroc', nationalDex: 745, formKey: 'lycanroc-midday', formLabel: '白晝的樣子', types: ['岩石'], baseStats: { hp: 75, atk: 115, def: 65, spa: 55, spd: 65, spe: 112 } },
  { key: 'politoed', nameZh: '蚊香蛙皇', nameEn: 'Politoed', nationalDex: 186, types: ['水'], baseStats: { hp: 90, atk: 75, def: 75, spa: 90, spd: 100, spe: 70 } },
  { key: 'rotom', nameZh: '洛托姆', nameEn: 'Rotom', nationalDex: 479, types: ['電', '幽靈'], baseStats: { hp: 50, atk: 50, def: 77, spa: 95, spd: 77, spe: 91 } },
  { key: 'kangaskhan', nameZh: '袋獸', nameEn: 'Kangaskhan', nationalDex: 115, types: ['一般'], baseStats: { hp: 105, atk: 95, def: 80, spa: 40, spd: 80, spe: 90 } },
  { key: 'hippowdon', nameZh: '河馬獸', nameEn: 'Hippowdon', nationalDex: 450, types: ['地面'], baseStats: { hp: 108, atk: 112, def: 118, spa: 68, spd: 72, spe: 47 } },
  // Fixture recognition extras (not always in top-50 allowlist)
  { key: 'gengar', nameZh: '耿鬼', nameEn: 'Gengar', nationalDex: 94, types: ['幽靈', '毒'], baseStats: { hp: 60, atk: 65, def: 60, spa: 130, spd: 75, spe: 110 } },
  { key: 'sableye', nameZh: '勾魂眼', nameEn: 'Sableye', nationalDex: 302, types: ['惡', '幽靈'], baseStats: { hp: 50, atk: 75, def: 75, spa: 65, spd: 65, spe: 50 } },
  { key: 'zoroark', nameZh: '索羅亞克', nameEn: 'Zoroark', nationalDex: 571, types: ['惡'], baseStats: { hp: 60, atk: 105, def: 60, spa: 120, spd: 60, spe: 105 } },
  { key: 'basculegion', nameZh: '幽尾玄魚', nameEn: 'Basculegion', nationalDex: 902, formKey: 'basculegion-male', formLabel: '雄性的樣子', types: ['水', '幽靈'], baseStats: { hp: 120, atk: 112, def: 65, spa: 80, spd: 75, spe: 78 } },
  { key: 'annihilape', nameZh: '棄世猴', nameEn: 'Annihilape', nationalDex: 979, types: ['格鬥', '幽靈'], baseStats: { hp: 110, atk: 115, def: 80, spa: 50, spd: 90, spe: 90 } },
  { key: 'sinistcha', nameZh: '來悲粗茶', nameEn: 'Sinistcha', nationalDex: 1013, types: ['草', '幽靈'], baseStats: { hp: 71, atk: 60, def: 106, spa: 121, spd: 80, spe: 70 } },
  { key: 'charizard', nameZh: '噴火龍', nameEn: 'Charizard', nationalDex: 6, types: ['火', '飛行'], baseStats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 } },
  { key: 'bellibolt', nameZh: '電肚蛙', nameEn: 'Bellibolt', nationalDex: 939, types: ['電'], baseStats: { hp: 109, atk: 64, def: 91, spa: 103, spd: 83, spe: 45 } },
  { key: 'scovillain', nameZh: '辣椒傑作', nameEn: 'Scovillain', nationalDex: 952, types: ['草', '火'], baseStats: { hp: 65, atk: 108, def: 65, spa: 108, spd: 65, spe: 75 } },
  { key: 'archaludon', nameZh: '鋁鋼橋龍', nameEn: 'Archaludon', nationalDex: 1018, types: ['鋼', '龍'], baseStats: { hp: 90, atk: 105, def: 130, spa: 125, spd: 65, spe: 85 } },
  { key: 'blastoise', nameZh: '水箭龜', nameEn: 'Blastoise', nationalDex: 9, types: ['水'], baseStats: { hp: 79, atk: 83, def: 100, spa: 85, spd: 105, spe: 78 } },
];

const byKey = new Map<string, SpeciesData>();
const byName = new Map<string, SpeciesData>();

function addAlias(alias: string | null | undefined, s: SpeciesData) {
  const k = String(alias || '')
    .trim()
    .toLowerCase();
  if (!k || byKey.has(k)) return;
  byKey.set(k, s);
}

function reindexSpeciesMaps() {
  byKey.clear();
  byName.clear();
  for (const s of SPECIES_DB) {
    byKey.set(s.key.toLowerCase(), s);
    byName.set(s.nameZh.toLowerCase(), s);
    byName.set(s.nameEn.toLowerCase(), s);
    addAlias(s.key, s);
    addAlias(s.formKey, s);
    addAlias(s.speciesKey, s);
    addAlias(s.key.replace(/-/g, ''), s);
    addAlias((s.formKey || '').replace(/-/g, ''), s);
    if (s.formLabel) addAlias(`${s.nameEn}-${s.formLabel}`.replace(/\s+/g, '-'), s);
    for (const f of s.forms || []) {
      // Sibling grouping copies every dex-mate's form onto this record.
      // Only the showdownId owner may claim those aliases (Indeedee-F must
      // not register as Indeedee male, and vice versa).
      const owner = (f.showdownId || '').trim().toLowerCase();
      if (owner && owner !== s.key.toLowerCase() && SPECIES_DB.some((o) => o.key.toLowerCase() === owner)) {
        continue;
      }
      addAlias(f.formKey, s);
      addAlias(f.showdownId, s);
      addAlias((f.formKey || '').replace(/-/g, ''), s);
      addAlias((f.showdownId || '').replace(/-/g, ''), s);
      addAlias(`${s.nameEn}-${f.label}`.replace(/\s+/g, '-'), s);
      addAlias(`${s.key}-${f.label}`.replace(/\s+/g, '-'), s);
    }
    if (s.nationalDex != null && s.nationalDex > 0) {
      const dex = String(s.nationalDex);
      // Prefer form-0 / male / non-`f` suffix when several share a dex.
      if (!byKey.has(dex)) byKey.set(dex, s);
    }
  }
  for (const [alias, canonical] of Object.entries(SPECIES_ID_ALIASES)) {
    const hit = byKey.get(canonical);
    if (hit) byKey.set(alias, hit);
  }
}
reindexSpeciesMaps();

export function findSpecies(query: string): SpeciesData | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const aliased = SPECIES_ID_ALIASES[q];
  if (aliased) {
    const hit = byKey.get(aliased) ?? byKey.get(q);
    if (hit) return hit;
  }
  const direct = byKey.get(q) ?? byName.get(q);
  if (direct) return direct;
  const compact = q.replace(/[-_ ]+/g, '');
  if (compact !== q) {
    const viaAlias = SPECIES_ID_ALIASES[compact];
    const hit = (viaAlias ? byKey.get(viaAlias) : undefined) ?? byKey.get(compact);
    if (hit) return hit;
  }
  return SPECIES_DB.find(
    (s) => s.nameZh.includes(query) || s.nameEn.toLowerCase().includes(q),
  );
}

function normIdent(s: string): string {
  return s.trim().toLowerCase().replace(/[_ ]+/g, '-');
}

function compactIdent(s: string): string {
  return normIdent(s).replace(/-/g, '');
}

/** Match a legal form on a species (Mega / Rotom / size / regional). */
export function matchSpeciesForm(sp: SpeciesData, query: string): string | undefined {
  const q = normIdent(query);
  const compact = compactIdent(query);
  const forms = sp.forms || [];
  for (const f of forms) {
    const keys = [
      f.formKey,
      f.showdownId,
      f.label,
      `${sp.nameEn}-${f.label}`,
      `${sp.key}-${f.label}`,
      `${sp.nameEn}-${f.formKey.replace(/^.*-/, '')}`,
    ];
    for (const k of keys) {
      const n = normIdent(k);
      if (n === q || compactIdent(k) === compact) return f.formKey;
    }
  }
  const suffix = q.split('-').slice(1).join('-');
  if (suffix) {
    const hit = forms.find(
      (f) =>
        f.formKey === q ||
        f.formKey.endsWith(`-${suffix}`) ||
        compactIdent(f.formKey) === compact,
    );
    if (hit) return hit.formKey;
  }
  return undefined;
}

function stripMegaSuffix(name: string): { base: string; mega: 'x' | 'y' | true } | null {
  const q = normIdent(name);
  const mx = q.match(/^(.*)-mega-x$/);
  if (mx?.[1]) return { base: mx[1], mega: 'x' };
  const my = q.match(/^(.*)-mega-y$/);
  if (my?.[1]) return { base: my[1], mega: 'y' };
  const m = q.match(/^(.*)-mega$/);
  if (m?.[1]) return { base: m[1], mega: true };
  return null;
}

function matchMegaForm(sp: SpeciesData, mega: 'x' | 'y' | true): string | undefined {
  const forms = sp.forms || [];
  if (mega === 'x') return forms.find((f) => /mega-x$/i.test(f.formKey))?.formKey;
  if (mega === 'y') return forms.find((f) => /mega-y$/i.test(f.formKey))?.formKey;
  return forms.find((f) => /(?:^|-)mega$/i.test(f.formKey))?.formKey;
}

/** Mega stone → Mega / Mega X / Mega Y formKey when that sibling exists. */
export function matchMegaFormFromItem(sp: SpeciesData, item?: string): string | undefined {
  if (!item) return undefined;
  const raw = item.trim();
  const id = raw.toLowerCase().replace(/[-_ ]+/g, '');
  if (/eviolite/i.test(id) || /進化的奇石/.test(raw)) return undefined;
  const looksStone =
    /ite[xy]?$/i.test(id) ||
    /進化石/.test(raw) ||
    /(ite|nite)(\s*[xy])?$/i.test(raw.replace(/[-_ ]+/g, '')) ||
    /ite\s*[xy]$/i.test(raw);
  if (!looksStone) return undefined;
  if (/ite\s*x$/i.test(raw) || /itex$/i.test(id)) return matchMegaForm(sp, 'x');
  if (/ite\s*y$/i.test(raw) || /itey$/i.test(id)) return matchMegaForm(sp, 'y');
  return matchMegaForm(sp, true);
}

export interface ImportSpeciesHit {
  species: SpeciesData;
  formKey?: string;
}

/**
 * Showdown paste names → allowlist species + legal form.
 * Accepts `Salamence-Mega`, `Charizard-Mega-X`, `Gourgeist-Super`, `Rotom-Wash`.
 */
export function resolveImportSpecies(name: string, item?: string): ImportSpeciesHit | undefined {
  const cleaned = name
    .trim()
    .replace(/[\u2640\u2642]/g, '')
    .replace(/\s+/g, ' ');
  if (!cleaned) return undefined;

  const tryHit = (query: string): ImportSpeciesHit | undefined => {
    const species = findSpecies(query);
    if (!species) return undefined;
    const formKey = matchSpeciesForm(species, query) || matchSpeciesForm(species, cleaned);
    return { species, formKey };
  };

  let hit =
    tryHit(cleaned) ||
    tryHit(normIdent(cleaned)) ||
    tryHit(compactIdent(cleaned));

  const mega = stripMegaSuffix(cleaned);
  if (!hit && mega) {
    const species = findSpecies(mega.base) || findSpecies(compactIdent(mega.base));
    if (species) hit = { species, formKey: matchMegaForm(species, mega.mega) };
  }

  if (!hit && cleaned.includes('-')) {
    const base = cleaned.replace(/-[^-]+$/, '').trim();
    const species = findSpecies(base) || findSpecies(normIdent(base));
    if (species) hit = { species, formKey: matchSpeciesForm(species, cleaned) };
  }

  if (!hit) return undefined;
  const fromItem = matchMegaFormFromItem(hit.species, item);
  const matched = hit.formKey ? hit.species.forms?.find((f) => f.formKey === hit.formKey) : undefined;
  const matchedIsDefault =
    !hit.formKey ||
    matched?.isDefault === true ||
    hit.formKey === hit.species.formKey ||
    hit.formKey === hit.species.key;
  // Bare `Delphox @ Delphoxite` matches the default form; mega stone must still win.
  const formKey = (!matchedIsDefault ? hit.formKey : undefined) || fromItem || hit.formKey;
  return { species: hit.species, formKey };
}

export function formatSpeciesLabel(
  s:
    | Pick<SpeciesData, 'nameZh' | 'nationalDex' | 'formLabel'>
    | Pick<PokemonSet, 'species' | 'nationalDex' | 'formLabel'>,
): string {
  const name = 'nameZh' in s ? s.nameZh : s.species;
  const dex = s.nationalDex;
  const form = 'formLabel' in s ? s.formLabel : undefined;
  const formBit =
    form && form.trim() && form !== name && form.toLowerCase() !== 'base' && !name.includes(form)
      ? ` · ${form}`
      : '';
  if (dex != null && Number.isFinite(dex) && dex > 0) return `#${dex} ${name}${formBit}`;
  return `${name}${formBit}`;
}

/** Champions legal roster for species pickers (allowlist / pokemon.json, not CBD usage). */
export function legalSpeciesList(): SpeciesData[] {
  return SPECIES_DB.filter((s) => s.championsLegal === true);
}

export function legalSpeciesOptions(): { key: string; label: string }[] {
  return [...legalSpeciesList()]
    .sort((a, b) => {
      const da = a.nationalDex ?? Number.POSITIVE_INFINITY;
      const db = b.nationalDex ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      const fa = a.formKey || a.key;
      const fb = b.formKey || b.key;
      const byForm = fa.localeCompare(fb);
      if (byForm !== 0) return byForm;
      return a.key.localeCompare(b.key);
    })
    .map((s) => ({ key: s.key, label: formatSpeciesLabel(s) }));
}

export function speciesToSet(s: SpeciesData, id: string, extras?: Partial<PokemonSet>): PokemonSet {
  const forms: PokemonFormOption[] | undefined = s.forms?.map((f) => ({
    showdownId: f.showdownId,
    formKey: f.formKey,
    label: f.label,
    types: [...f.types],
    baseStats: { ...f.baseStats },
    isDefault: f.isDefault,
  }));
  const resolvedFormKey =
    s.formKey ||
    forms?.find((f) => f.isDefault)?.formKey ||
    forms?.[0]?.formKey;
  const resolvedForm = forms?.find((f) => f.formKey === resolvedFormKey);
  return {
    id,
    species: s.nameZh,
    speciesKey: s.key,
    nationalDex: s.nationalDex ?? null,
    types: [...(resolvedForm?.types ?? s.types)],
    baseStats: { ...(resolvedForm?.baseStats ?? s.baseStats) },
    speed: 0,
    formKey: resolvedFormKey,
    formLabel: resolvedForm?.label ?? s.formLabel,
    forms,
    moves: [
      { name: '—', type: (resolvedForm?.types ?? s.types)[0] ?? '一般' },
      { name: '—', type: (resolvedForm?.types ?? s.types)[1] ?? '一般' },
      { name: '—', type: '一般' },
      { name: '—', type: '一般' },
    ],
    identified: true,
    confidence: 1,
    ...extras,
  };
}

/** Generated record shape from `public/data/pokemon.json` (VGC schema v2). */
export interface GeneratedFormRecord {
  showdownId: string;
  pokeapiId?: number;
  formKey: string;
  formNames?: { en: string | null; 'zh-Hant': string | null; ja: string | null };
  types: string[];
  baseStats: Stats;
  abilities?: string[];
  isDefault?: boolean;
  vgcDoublesMoves?: {
    id: string;
    nameEn: string;
    usage: string | null;
    rank?: number | null;
  }[];
  vgcDoublesItems?: {
    id: string;
    nameEn: string;
    nameZh?: string | null;
    usage: string | null;
    rank?: number | null;
  }[];
  vgcDoublesMeta?: {
    source?: string;
    format?: string;
    season?: string | null;
    battleSource?: string | null;
    label?: string;
  } | null;
}

export interface GeneratedPokemonRecord {
  showdownId: string;
  nationalDex?: number | null;
  pokeapiId: number;
  speciesKey: string;
  formKey: string;
  names: { en: string | null; 'zh-Hant': string | null; ja: string | null };
  formNames?: { en: string | null; 'zh-Hant': string | null; ja: string | null };
  types: string[];
  baseStats: Stats;
  abilities: string[];
  championsLegal?: boolean;
  forms?: GeneratedFormRecord[];
  /** CBD VGC Doubles top moves (usage %); absent → UI 未載入 */
  vgcDoublesMoves?: {
    id: string;
    nameEn: string;
    usage: string | null;
    rank?: number | null;
  }[];
  vgcDoublesItems?: {
    id: string;
    nameEn: string;
    nameZh?: string | null;
    usage: string | null;
    rank?: number | null;
  }[];
  vgcDoublesMeta?: {
    source?: string;
    format?: string;
    season?: string | null;
    battleSource?: string | null;
    label?: string;
  } | null;
}

function enTypeToZh(t: string): PokemonType {
  const id = t.toLowerCase() as TypeIconId;
  return TYPE_ID_TO_ZH[id] ?? '一般';
}

function displayNameZh(rec: GeneratedPokemonRecord): string {
  return rec.names['zh-Hant'] || rec.names.en || rec.showdownId;
}

function megaShortLabel(formKey: string): string | null {
  const k = formKey.toLowerCase();
  if (k.endsWith('-mega-x')) return 'Mega X';
  if (k.endsWith('-mega-y')) return 'Mega Y';
  if (k.endsWith('-mega') || /(^|-)mega(-|$)/.test(k)) return 'Mega';
  return null;
}

function formLabelOf(form: GeneratedFormRecord, fallbackSpecies: string): string {
  const mega = megaShortLabel(form.formKey);
  if (mega) return mega;
  return (
    form.formNames?.['zh-Hant'] ||
    form.formNames?.en ||
    form.formKey ||
    fallbackSpecies
  );
}

function recordToSpecies(rec: GeneratedPokemonRecord): SpeciesData {
  const forms: SpeciesFormData[] | undefined = Array.isArray(rec.forms)
    ? rec.forms.map((f) => ({
        showdownId: f.showdownId || rec.showdownId,
        formKey: f.formKey,
        label: formLabelOf(f, displayNameZh(rec)),
        types: (f.types || []).map(enTypeToZh),
        baseStats: { ...f.baseStats },
        isDefault: f.isDefault,
      }))
    : undefined;
  const formLabel =
    rec.formNames?.['zh-Hant'] || rec.formNames?.en || undefined;
  return {
    key: rec.showdownId,
    nameZh: displayNameZh(rec),
    nameEn: rec.names.en || rec.showdownId,
    nationalDex: rec.nationalDex ?? rec.pokeapiId ?? null,
    formKey: rec.formKey,
    formLabel: megaShortLabel(rec.formKey) || formLabel || undefined,
    speciesKey: rec.speciesKey,
    types: rec.types.map(enTypeToZh),
    baseStats: { ...rec.baseStats },
    forms,
    // pokemon.json is the allowlist dump (262). CBD usage may be missing; still legal.
    championsLegal: true,
  };
}

function formOptionFromSpecies(s: SpeciesData): SpeciesFormData {
  const own =
    s.forms?.find((f) => f.formKey === (s.formKey || s.key)) ?? s.forms?.[0];
  return {
    showdownId: s.key,
    formKey: s.formKey || own?.formKey || s.key,
    label: s.formLabel || own?.label || s.nameZh,
    types: [...(own?.types ?? s.types)],
    baseStats: { ...(own?.baseStats ?? s.baseStats) },
    isDefault: own?.isDefault ?? false,
  };
}

/**
 * pokemon.json stores one record per legal showdownId, each often with forms.length ≤ 1.
 * Group siblings by nationalDex so cards can switch regional / gender / Rotom / Mega
 * forms the same way on ally and enemy. Preserve Mega entries nested on a single record
 * even when that dex has only one allowlist row (e.g. Garchomp).
 */
function attachSiblingLegalForms() {
  const groups = new Map<number, SpeciesData[]>();
  for (const s of SPECIES_DB) {
    if (s.championsLegal !== true || s.nationalDex == null || s.nationalDex <= 0) continue;
    const arr = groups.get(s.nationalDex) ?? [];
    arr.push(s);
    groups.set(s.nationalDex, arr);
  }
  for (const group of groups.values()) {
    const forms: SpeciesFormData[] = [];
    const seen = new Set<string>();
    const push = (f: SpeciesFormData) => {
      const k = (f.formKey || f.showdownId || '').toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      forms.push(f);
    };
    if (group.length >= 2) {
      for (const s of group) push(formOptionFromSpecies(s));
    }
    for (const s of group) {
      for (const f of s.forms || []) push(f);
    }
    if (forms.length < 2) continue;
    if (!forms.some((f) => f.isDefault)) forms[0].isDefault = true;
    for (const s of group) s.forms = forms;
  }
}

/**
 * Load `public/data/pokemon.json` and overlay SPECIES_DB (繁中 display names + classic base stats).
 * Failures leave offline stubs intact.
 */
export async function loadGeneratedSpeciesData(
  url = `${import.meta.env.BASE_URL}data/pokemon.json`,
): Promise<number> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 0;
    const rows = (await res.json()) as GeneratedPokemonRecord[];
    if (!Array.isArray(rows)) return 0;
    let n = 0;
    for (const rec of rows) {
      if (!rec?.showdownId) continue;
      const next = recordToSpecies(rec);
      const idx = SPECIES_DB.findIndex((s) => s.key === next.key);
      if (idx >= 0) SPECIES_DB[idx] = { ...SPECIES_DB[idx], ...next };
      else SPECIES_DB.push(next);
      n += 1;
    }
    attachSiblingLegalForms();
    reindexSpeciesMaps();
    return n;
  } catch {
    return 0;
  }
}

/** Demo ally strip — Champions-legal ids that exist on sprite_poke.png (fixture left list). */
export const SAMPLE_MY_TEAM_KEYS = [
  'kingambit',
  'delphox',
  'salamence',
  'sneasler',
  'rillaboom',
  'incineroar',
] as const;
