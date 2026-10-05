export type PokemonType =
  | '一般' | '火' | '水' | '電' | '草' | '冰'
  | '格鬥' | '毒' | '地面' | '飛行' | '超能力' | '蟲'
  | '岩石' | '幽靈' | '龍' | '惡' | '鋼' | '妖精';

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface MoveSlot {
  name: string;
  type: PokemonType | string;
  pp?: string;
  /** 使用率（可選；數字或已含 % 的字串） */
  usage?: string | number;
  /** PokéAPI / baked move id (for tooltip lookup) */
  id?: string;
}

/** CBD Doubles held-item usage row (not a guessed held item). */
export interface HeldItemSlot {
  name: string;
  usage?: string | number;
  id?: string;
}

/** Alternate form / Mega selectable on a card */
export interface PokemonFormOption {
  showdownId: string;
  formKey: string;
  label: string;
  types: PokemonType[];
  baseStats: Stats;
  isDefault?: boolean;
}

export interface PokemonSet {
  id: string;
  species: string;
  speciesKey?: string;
  /** PokéAPI national dex number */
  nationalDex?: number | null;
  item?: string;
  /** Top held items by CBD Doubles usage % (display only; do not guess the live item). */
  items?: HeldItemSlot[];
  ability?: string;
  types: PokemonType[];
  baseStats: Stats;
  /** 實際顯示用速度（可由 IV/EV/性格計算） */
  speed: number;
  /** 努力值：Champions 0–32 點（`evsArePts`）或 Showdown 0–252 EV */
  evs?: Partial<Stats>;
  /** true = `evs` 為 Champions 投資點（export `32 HP / 2 Spe`） */
  evsArePts?: boolean;
  /** Showdown / 中文性格名（如 Jolly、爽朗） */
  nature?: string;
  moves: MoveSlot[];
  identified: boolean;
  confidence?: number;
  formLabel?: string;
  /** Current form key (PokéAPI pokemon name), e.g. lycanroc-dusk */
  formKey?: string;
  /** Available forms for dropdown */
  forms?: PokemonFormOption[];
  /** 辨認裁切預覽（data URL）；不猜道具 */
  thumbnailDataUrl?: string;
}

export interface RecognizeResult {
  slot: number;
  confidence: number;
  /** 種族 key；低信心／低 margin／type veto → null → UI「未識別」 */
  speciesId?: string | null;
  speciesNameZh?: string | null;
  /** @deprecated 相容舊欄位；等同 speciesId */
  species?: string | null;
  thumbnailDataUrl?: string;
  hash?: string;
  /** Debug: runner-up species after gates */
  altSpeciesId?: string | null;
  /** Debug: top1.conf - top2.conf among accepted candidates */
  margin?: number;
  /** Debug: soft-detected type icon ids from card top-right */
  detectedTypes?: string[];
  /** Debug: type-icon NCC scores from card top-right */
  typeScores?: { id: string; score: number }[];
  /** Debug: why speciesId is null (threshold / margin / type-veto / ahash) */
  rejectReason?: string | null;
  /** Debug: top match candidates before accept gates */
  topCandidates?: { speciesId: string; confidence: number; types: string[] }[];
  /** Debug: whether the eventual/expected species survived aHash prefilter */
  ahashHit?: boolean;
}

export const EMPTY_STATS: Stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

export function emptySlot(index: number, side: 'my' | 'enemy'): PokemonSet {
  return {
    id: `${side}-${index}`,
    species: side === 'enemy' ? '未識別' : `空位 ${index + 1}`,
    types: [],
    baseStats: { ...EMPTY_STATS },
    speed: 0,
    moves: [
      { name: '—', type: '一般' },
      { name: '—', type: '一般' },
      { name: '—', type: '一般' },
      { name: '—', type: '一般' },
    ],
    identified: false,
  };
}
