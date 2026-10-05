import type { HeldItemSlot, MoveSlot, PokemonType } from '../types';
import { TYPE_ID_TO_ZH, type TypeIconId } from './typeIcons';

/**
 * VGC Doubles (2v2 / 6-pick-4) top moves cache.
 *
 * - Move **names / types**: `public/data/moves.json` (PokéAPI, zh-Hant)
 * - **Usage %**: only from championsbattledata.com Doubles battle meta baked into
 *   `public/data/pokemon.json` (`vgcDoublesMoves`). Never invent learnsets or fake %.
 *
 * Daily browser cache (optional overlay after static load):
 * - `localStorage` key `pkmn-moves-cache:v2:{date}:{speciesKey}`
 * - Electron prod suggestion: `{userData}/.moves-cache/YYYY-MM-DD/{speciesKey}.json`
 */

const MOVES_SOURCE_BASE = 'VGC Doubles (2v2 / 6-pick-4) · championsbattledata.com';

/** Mutable; bootstrapped from public/data/meta.json `usageUpdatedAt` when available. */
export let MOVES_SOURCE_LABEL = MOVES_SOURCE_BASE;

let usageUpdatedAt: string | null = null;

export function getUsageUpdatedAt(): string | null {
  return usageUpdatedAt;
}

export function formatMovesSourceLabel(dateYmd?: string | null): string {
  const d = dateYmd || usageUpdatedAt;
  return d ? `${MOVES_SOURCE_BASE} · 更新 ${d}` : MOVES_SOURCE_BASE;
}

function applyMetaUsageDate(meta: { usageUpdatedAt?: string; updatedAt?: string; usageSourceLabel?: string } | null) {
  if (!meta) return;
  const d = meta.usageUpdatedAt || meta.updatedAt || null;
  if (d) {
    usageUpdatedAt = String(d).slice(0, 10);
    MOVES_SOURCE_LABEL = meta.usageSourceLabel || formatMovesSourceLabel(usageUpdatedAt);
  } else if (meta.usageSourceLabel) {
    MOVES_SOURCE_LABEL = meta.usageSourceLabel;
  }
}

export interface GeneratedMoveRecord {
  id: string;
  pokeapiId: number | null;
  names: { en: string | null; 'zh-Hant': string | null; ja: string | null };
  type: string | null;
  category?: string | null;
  power?: number | null;
  accuracy?: number | null;
  pp?: number | null;
  /** PokéAPI flavor; UI shows zh-Hant only. EN/JA stored for later. */
  flavor?: { en: string | null; 'zh-Hant': string | null; ja: string | null } | null;
}

export interface VgcDoublesMoveRow {
  id: string;
  nameEn: string;
  usage: string | null;
  rank?: number | null;
}

export interface VgcDoublesItemRow {
  id: string;
  nameEn: string;
  nameZh?: string | null;
  usage: string | null;
  rank?: number | null;
}

export interface VgcDoublesMeta {
  source?: string;
  format?: string;
  season?: string | null;
  battleSource?: string | null;
  label?: string;
}

interface PokemonMovesRecord {
  showdownId: string;
  vgcDoublesMoves?: VgcDoublesMoveRow[];
  vgcDoublesItems?: VgcDoublesItemRow[];
  vgcDoublesMeta?: VgcDoublesMeta | null;
  forms?: {
    showdownId?: string;
    vgcDoublesMoves?: VgcDoublesMoveRow[];
    vgcDoublesItems?: VgcDoublesItemRow[];
    vgcDoublesMeta?: VgcDoublesMeta | null;
  }[];
}

const MEMORY = new Map<string, { fetchedAt: string; moves: MoveSlot[]; sourceLabel: string | null }>();
const ITEM_MEMORY = new Map<string, { fetchedAt: string; items: HeldItemSlot[] }>();
const MOVES_BY_ID = new Map<string, GeneratedMoveRecord>();
const DOUBLES_BY_SPECIES = new Map<string, VgcDoublesMoveRow[]>();
const ITEMS_BY_SPECIES = new Map<string, VgcDoublesItemRow[]>();
const META_BY_SPECIES = new Map<string, VgcDoublesMeta | null>();

let loadPromise: Promise<void> | null = null;
let loaded = false;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function storageKey(speciesKey: string): string {
  return `pkmn-moves-cache:v3:${todayKey()}:${speciesKey}`;
}

export function parseUsagePercent(usage: string | number | null | undefined): number {
  if (usage == null || usage === '') return Number.NEGATIVE_INFINITY;
  const n = typeof usage === 'number' ? usage : parseFloat(String(usage).replace(/%/g, '').trim());
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

export function sortByUsageDesc<T extends { usage?: string | number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => parseUsagePercent(b.usage) - parseUsagePercent(a.usage));
}

function enTypeToZh(t: string | null | undefined): PokemonType {
  if (!t) return '一般';
  const id = t.toLowerCase() as TypeIconId;
  return TYPE_ID_TO_ZH[id] ?? '一般';
}

function resolveMoveSlot(row: VgcDoublesMoveRow): MoveSlot {
  const rec = MOVES_BY_ID.get(row.id) ?? MOVES_BY_ID.get(row.id.replace(/-/g, ''));
  const name =
    rec?.names?.['zh-Hant'] ||
    rec?.names?.en ||
    row.nameEn ||
    row.id;
  const type = enTypeToZh(rec?.type);
  const usage =
    row.usage != null && String(row.usage).trim() !== ''
      ? String(row.usage).trim()
      : undefined;
  const id = rec?.id || row.id;
  return usage ? { name, type, usage, id } : { name, type, id };
}

/** Lookup baked move catalog by id or ZH/EN display name. */
export function getMoveDetails(nameOrId: string | undefined | null): GeneratedMoveRecord | null {
  if (!nameOrId) return null;
  const q = String(nameOrId).trim();
  if (!q) return null;
  const compact = q.replace(/[-_ ]+/g, '').toLowerCase();
  const direct = MOVES_BY_ID.get(q) ?? MOVES_BY_ID.get(compact);
  if (direct) return direct;
  for (const rec of MOVES_BY_ID.values()) {
    if (rec.names?.['zh-Hant'] === q || rec.names?.en === q || rec.names?.ja === q) return rec;
    if ((rec.id || '').toLowerCase() === compact) return rec;
  }
  return null;
}

function unloadedSlots(count: number): MoveSlot[] {
  return Array.from({ length: count }, () => ({
    name: '未載入',
    type: '一般' as PokemonType,
  }));
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Load PokéAPI move catalog + CBD Doubles usage rows from static JSON.
 * Safe to call multiple times; failures leave maps empty → UI shows 未載入.
 */
export async function loadMovesData(
  baseUrl = `${import.meta.env.BASE_URL}data`,
): Promise<{ moves: number; speciesWithUsage: number }> {
  if (loaded) {
    return { moves: MOVES_BY_ID.size, speciesWithUsage: DOUBLES_BY_SPECIES.size };
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      const [moves, pokemon, meta] = await Promise.all([
        fetchJson<GeneratedMoveRecord[]>(`${baseUrl}/moves.json`),
        fetchJson<PokemonMovesRecord[]>(`${baseUrl}/pokemon.json`),
        fetchJson<{ usageUpdatedAt?: string; updatedAt?: string; usageSourceLabel?: string }>(`${baseUrl}/meta.json`),
      ]);
      applyMetaUsageDate(meta);
      MOVES_BY_ID.clear();
      DOUBLES_BY_SPECIES.clear();
      ITEMS_BY_SPECIES.clear();
      META_BY_SPECIES.clear();
      if (Array.isArray(moves)) {
        for (const m of moves) {
          if (!m?.id) continue;
          MOVES_BY_ID.set(m.id, m);
        }
      }
      if (Array.isArray(pokemon)) {
        for (const p of pokemon) {
          if (!p?.showdownId) continue;
          const rows = Array.isArray(p.vgcDoublesMoves) ? p.vgcDoublesMoves : [];
          if (rows.length) DOUBLES_BY_SPECIES.set(p.showdownId, sortByUsageDesc(rows));
          const itemRows = Array.isArray(p.vgcDoublesItems) ? p.vgcDoublesItems : [];
          if (itemRows.length) ITEMS_BY_SPECIES.set(p.showdownId, sortByUsageDesc(itemRows));
          META_BY_SPECIES.set(p.showdownId, p.vgcDoublesMeta ?? null);
          // Nested forms may carry their own CBD Doubles rows (e.g. rotomwash vs rotomheat)
          if (Array.isArray(p.forms)) {
            for (const f of p.forms) {
              if (!f?.showdownId) continue;
              const fRows = Array.isArray(f.vgcDoublesMoves) ? f.vgcDoublesMoves : [];
              if (fRows.length && !DOUBLES_BY_SPECIES.has(f.showdownId)) {
                DOUBLES_BY_SPECIES.set(f.showdownId, sortByUsageDesc(fRows));
              }
              const fItems = Array.isArray(f.vgcDoublesItems) ? f.vgcDoublesItems : [];
              if (fItems.length && !ITEMS_BY_SPECIES.has(f.showdownId)) {
                ITEMS_BY_SPECIES.set(f.showdownId, sortByUsageDesc(fItems));
              }
              if (f.vgcDoublesMeta && !META_BY_SPECIES.has(f.showdownId)) {
                META_BY_SPECIES.set(f.showdownId, f.vgcDoublesMeta);
              }
            }
          }
        }
      }
      loaded = true;
    })().catch(() => {
      loadPromise = null;
      loaded = false;
    });
  }
  await loadPromise;
  return { moves: MOVES_BY_ID.size, speciesWithUsage: DOUBLES_BY_SPECIES.size };
}

function ensureLoaded(): Promise<void> {
  return loadMovesData().then(() => undefined);
}

export function getCachedMoves(speciesKey: string): MoveSlot[] | null {
  const mem = MEMORY.get(speciesKey);
  if (mem && mem.fetchedAt === todayKey()) return mem.moves;
  try {
    const raw = localStorage.getItem(storageKey(speciesKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: string; moves: MoveSlot[] };
    if (parsed.fetchedAt !== todayKey()) return null;
    MEMORY.set(speciesKey, { ...parsed, sourceLabel: getMovesSourceLabel(speciesKey) });
    return parsed.moves;
  } catch {
    return null;
  }
}

export function setCachedMoves(speciesKey: string, moves: MoveSlot[]): void {
  const payload = { fetchedAt: todayKey(), moves, sourceLabel: getMovesSourceLabel(speciesKey) };
  MEMORY.set(speciesKey, payload);
  try {
    localStorage.setItem(storageKey(speciesKey), JSON.stringify({ fetchedAt: payload.fetchedAt, moves }));
  } catch {
    /* ignore quota */
  }
}

export function getMovesSourceLabel(speciesKey?: string): string | null {
  if (!speciesKey) return MOVES_SOURCE_LABEL;
  const meta = META_BY_SPECIES.get(speciesKey);
  if (meta?.label) {
    // Ensure date suffix even if baked label is stale
    if (usageUpdatedAt && !/更新\s*\d{4}-\d{2}-\d{2}/.test(meta.label)) {
      return `${meta.label.replace(/\s*·\s*更新\s*\d{4}-\d{2}-\d{2}\s*$/, '')} · 更新 ${usageUpdatedAt}`;
    }
    return meta.label;
  }
  if (DOUBLES_BY_SPECIES.has(speciesKey)) return MOVES_SOURCE_LABEL;
  return null;
}

/**
 * Top Doubles moves for a species from baked CBD meta + PokéAPI names/types.
 * Missing CBD usage → empty array (UI pads with 未載入 / —). Never returns fake stubs.
 */
export async function fetchTopMoves(speciesKey: string): Promise<MoveSlot[]> {
  await ensureLoaded();
  const cached = getCachedMoves(speciesKey);
  if (cached) return cached;

  const rows = DOUBLES_BY_SPECIES.get(speciesKey);
  if (!rows?.length) {
    // Do not cache empty forever across data rebuilds in the same day via localStorage —
    // memory-only empty so a later loadMovesData refresh can recover.
    MEMORY.set(speciesKey, { fetchedAt: todayKey(), moves: [], sourceLabel: null });
    return [];
  }

  const moves = sortByUsageDesc(rows).slice(0, 6).map(resolveMoveSlot);
  setCachedMoves(speciesKey, moves);
  return moves;
}

function resolveItemSlot(row: VgcDoublesItemRow): HeldItemSlot {
  const name = (row.nameZh && String(row.nameZh).trim()) || row.nameEn || row.id;
  const usage =
    row.usage != null && String(row.usage).trim() !== ''
      ? String(row.usage).trim()
      : undefined;
  return usage ? { name, usage, id: row.id } : { name, id: row.id };
}

/** Mega / 進化石 (not Eviolite / 進化的奇石). */
export function isMegaStoneItem(item: { name?: string; id?: string; nameEn?: string; nameZh?: string }): boolean {
  const id = String(item.id || '').toLowerCase().replace(/[-_ ]+/g, '');
  const blob = `${item.name || ''} ${item.nameEn || ''} ${item.nameZh || ''} ${id}`;
  if (/eviolite/i.test(blob) || /進化的奇石/.test(blob)) return false;
  if (/進化石/.test(blob)) return true;
  if (/ite[xy]?$/i.test(id)) return true;
  const name = String(item.name || item.nameEn || item.nameZh || '');
  if (/(ite|nite)(\s*[xy])?$/i.test(name.replace(/[-_ ]+/g, ''))) return true;
  if (/-ite\b/i.test(name) || /\bite\b/i.test(name)) return true;
  return false;
}

export function splitHeldItemUsage(
  items: HeldItemSlot[] | undefined,
  heldLimit = 2,
): { megaStones: HeldItemSlot[]; held: HeldItemSlot[] } {
  const rows = items ?? [];
  const megaStones = rows.filter((it) => isMegaStoneItem(it));
  const held = rows.filter((it) => !isMegaStoneItem(it)).slice(0, heldLimit);
  return { megaStones, held };
}

/**
 * Top-2 Doubles held items by usage % from baked CBD meta.
 * Missing item rows → empty (UI shows —). Never invents a held item.
 */
export async function fetchTopItems(speciesKey: string, limit = 8): Promise<HeldItemSlot[]> {
  await ensureLoaded();
  const mem = ITEM_MEMORY.get(speciesKey);
  if (mem && mem.fetchedAt === todayKey()) return mem.items.slice(0, limit);
  const rows = ITEMS_BY_SPECIES.get(speciesKey);
  if (!rows?.length) {
    ITEM_MEMORY.set(speciesKey, { fetchedAt: todayKey(), items: [] });
    return [];
  }
  const items = sortByUsageDesc(rows).slice(0, Math.max(8, limit)).map(resolveItemSlot);
  ITEM_MEMORY.set(speciesKey, { fetchedAt: todayKey(), items });
  return items.slice(0, limit);
}

/** Ally card: ≤4; empty CBD → 未載入 ×4 */
export function top4ForCard(moves: MoveSlot[]): MoveSlot[] {
  if (!moves.length) return unloadedSlots(4);
  const pad: MoveSlot[] = [...moves];
  while (pad.length < 4) pad.push({ name: '—', type: '一般' as PokemonType });
  return pad.slice(0, 4);
}

/** Enemy card: top-6 slots; empty CBD → 未載入 ×6 */
export function top6ForCard(moves: MoveSlot[]): MoveSlot[] {
  if (!moves.length) return unloadedSlots(6);
  const pad: MoveSlot[] = [...moves];
  while (pad.length < 6) pad.push({ name: '—', type: '一般' as PokemonType });
  return pad.slice(0, 6);
}

/** 文件用：建議的磁碟快取相對路徑 */
export const MOVES_CACHE_PATH_DOC = '{userData}/.moves-cache/YYYY-MM-DD/{speciesKey}.json';
