import { emptySlot } from '../types';
import type { MoveSlot, PokemonSet, StatKey, Stats } from '../types';
import { resolveImportSpecies, speciesToSet } from './species';
import { getMoveDetails } from './movesCache';
import { TYPE_ID_TO_ZH, type TypeIconId } from './typeIcons';
import { inferEvsArePts, speedFromInvestment } from './speedCalc';

const EV_STAT_ALIASES: Record<string, StatKey> = {
  hp: 'hp',
  atk: 'atk',
  attack: 'atk',
  def: 'def',
  defense: 'def',
  spa: 'spa',
  spatk: 'spa',
  'sp.atk': 'spa',
  'sp. atk': 'spa',
  spd: 'spd',
  spdef: 'spd',
  'sp.def': 'spd',
  'sp. def': 'spd',
  spe: 'spe',
  speed: 'spe',
  攻擊: 'atk',
  防御: 'def',
  防禦: 'def',
  特攻: 'spa',
  特防: 'spd',
  速度: 'spe',
};

export function parseEvLine(line: string): Partial<Stats> {
  const evs: Partial<Stats> = {};
  const re = /(\d+)\s*([A-Za-z.\u4e00-\u9fff]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const n = Number(m[1]);
    const key = EV_STAT_ALIASES[m[2].toLowerCase().replace(/\s+/g, '')];
    if (!key || !Number.isFinite(n)) continue;
    evs[key] = n;
  }
  return evs;
}

export function parseNatureLine(line: string): string | undefined {
  const natureMatch = line.match(/^([A-Za-z\u4e00-\u9fff]+)\s+Nature$/i);
  if (natureMatch) return natureMatch[1];
  const labeled = line.match(/^(?:Nature|性格)\s*[:：]\s*(.+)$/i);
  if (labeled) return labeled[1].trim();
  return undefined;
}

/** `Nick (Species) (F) @ Item` / `Species @ Item` / `Species-Mega @ Stone` */
export function parseShowdownHeader(header: string): { species: string; item?: string } {
  const at = header.indexOf('@');
  const left = (at >= 0 ? header.slice(0, at) : header).trim();
  const item = at >= 0 ? header.slice(at + 1).trim() || undefined : undefined;
  let name = left.replace(/\s*\([MF]\)\s*$/i, '').trim();
  const nick = name.match(/^.+\(([^()]+)\)\s*$/);
  if (nick) name = nick[1].trim();
  return { species: name, item };
}

function moveSlotFromName(name: string, fallbackType: string): MoveSlot {
  const rec = getMoveDetails(name);
  const typeEn = rec?.type?.toLowerCase() as TypeIconId | undefined;
  const type = (typeEn && TYPE_ID_TO_ZH[typeEn]) || fallbackType || '一般';
  const zh = rec?.names?.['zh-Hant'] || name;
  return { name: zh, type, id: rec?.id || name };
}

function parseMoveList(names: string[], fallbackType: string): MoveSlot[] {
  return [0, 1, 2, 3].map((i) => {
    const n = names[i];
    return n ? moveSlotFromName(n, fallbackType) : { name: '—', type: '一般' };
  });
}

function evsFromUnknown(row: Record<string, unknown>): { evs?: Partial<Stats>; evsArePts?: boolean } {
  const raw = row.evs ?? row.EVs ?? row.evPts;
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const evs: Partial<Stats> = {};
  for (const [k, v] of Object.entries(src)) {
    const key = EV_STAT_ALIASES[k.toLowerCase()] || (k as StatKey);
    const n = typeof v === 'number' ? v : Number(v);
    if (['hp', 'atk', 'def', 'spa', 'spd', 'spe'].includes(key) && Number.isFinite(n)) {
      evs[key as StatKey] = n;
    }
  }
  if (!Object.keys(evs).length) return {};
  return { evs, evsArePts: inferEvsArePts(evs) };
}

function buildImportedSet(
  index: number,
  name: string,
  extras: {
    item?: string;
    ability?: string;
    evs?: Partial<Stats>;
    evsArePts?: boolean;
    nature?: string;
    moves?: string[];
    speed?: number;
  },
): PokemonSet {
  const hit = resolveImportSpecies(name, extras.item);
  const evs = extras.evs;
  const evsArePts = extras.evsArePts ?? inferEvsArePts(evs);
  const nature = extras.nature;
  if (!hit) {
    return {
      ...emptySlot(index, 'my'),
      species: name,
      item: extras.item,
      ability: extras.ability,
      evs,
      evsArePts,
      nature,
      identified: Boolean(name),
      moves: parseMoveList(extras.moves ?? [], '一般'),
    };
  }
  const { species: sp, formKey } = hit;
  const form = formKey ? sp.forms?.find((f) => f.formKey === formKey) : undefined;
  const types = form?.types ?? sp.types;
  const baseStats = form?.baseStats ?? sp.baseStats;
  const speed =
    extras.speed && extras.speed > 0
      ? extras.speed
      : speedFromInvestment(baseStats.spe, { evs, evsArePts, nature });
  return speciesToSet(sp, `my-${index}`, {
    item: extras.item,
    ability: extras.ability,
    evs,
    evsArePts,
    nature,
    speed,
    formKey: form?.formKey ?? formKey ?? sp.formKey,
    formLabel: form?.label ?? sp.formLabel,
    types: [...types],
    baseStats: { ...baseStats },
    moves: parseMoveList(extras.moves ?? [], types[0] ?? '一般'),
  });
}

/**
 * Showdown paste / JSON 匯入。
 * 支援種族行 `Salamence-Mega`、Mega 石切形態、EVs／性格寫入 Spe。
 */
export function parseTeamImport(raw: string): PokemonSet[] {
  const trimmed = raw.trim();
  if (!trimmed) return Array.from({ length: 6 }, (_, i) => emptySlot(i, 'my'));

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJsonTeam(trimmed);
  }
  return parseShowdownPaste(trimmed);
}

function parseJsonTeam(raw: string): PokemonSet[] {
  try {
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : data.team ?? data.pokemon ?? [];
    return padSix(
      arr.slice(0, 6).map((row: Record<string, unknown>, i: number) => {
        const name = String(row.species ?? row.name ?? row.speciesKey ?? '');
        const item = row.item != null ? String(row.item) : undefined;
        const ability = row.ability != null ? String(row.ability) : undefined;
        const nature = row.nature != null ? String(row.nature) : undefined;
        const { evs, evsArePts } = evsFromUnknown(row);
        const moves = Array.isArray(row.moves)
          ? row.moves.map((m) => (typeof m === 'string' ? m : String((m as { name?: string })?.name ?? '')))
          : [];
        const speed = typeof row.speed === 'number' ? row.speed : undefined;
        const formHint = row.formKey != null ? String(row.formKey) : row.form != null ? String(row.form) : undefined;
        const speciesName = formHint && !/-/i.test(name) ? `${name}-${formHint}` : name;
        return buildImportedSet(i, speciesName, { item, ability, evs, evsArePts, nature, moves, speed });
      }),
    );
  } catch {
    return Array.from({ length: 6 }, (_, i) => emptySlot(i, 'my'));
  }
}

function parseShowdownPaste(raw: string): PokemonSet[] {
  const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const sets: PokemonSet[] = [];
  for (let i = 0; i < Math.min(blocks.length, 6); i++) {
    const lines = blocks[i].split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const { species, item } = parseShowdownHeader(lines[0]);
    let ability: string | undefined;
    let nature: string | undefined;
    let evs: Partial<Stats> | undefined;
    const moves: string[] = [];
    for (const line of lines.slice(1)) {
      if (line.startsWith('Ability:') || line.startsWith('特性')) {
        ability = line.replace(/^(?:Ability|特性)\s*[:：]\s*/, '').trim();
      } else if (/^EVs?:/i.test(line) || line.startsWith('努力值')) {
        evs = parseEvLine(line);
      } else {
        const n = parseNatureLine(line);
        if (n) nature = n;
        else if (line.startsWith('- ')) moves.push(line.slice(2).trim());
      }
    }
    sets.push(
      buildImportedSet(i, species, {
        item,
        ability,
        evs,
        evsArePts: inferEvsArePts(evs),
        nature,
        moves,
      }),
    );
  }
  return padSix(sets);
}

function padSix(sets: PokemonSet[]): PokemonSet[] {
  const out = [...sets];
  while (out.length < 6) out.push(emptySlot(out.length, 'my'));
  return out.slice(0, 6);
}

export const DEMO_SHOWDOWN_PASTE = `Incineroar @ Safety Goggles
Ability: Intimidate
- Fake Out
- Flare Blitz
- Knock Off
- Parting Shot

Rillaboom @ Assault Vest
Ability: Grassy Surge
- Fake Out
- Grassy Glide
- Wood Hammer
- U-turn

Urshifu-Rapid-Strike @ Focus Sash
Ability: Unseen Fist
- Surging Strikes
- Close Combat
- Aqua Jet
- Protect

Flutter Mane @ Choice Specs
Ability: Protosynthesis
- Moonblast
- Shadow Ball
- Dazzling Gleam
- Thunderbolt

Landorus-Therian @ Life Orb
Ability: Intimidate
- Earthquake
- Rock Slide
- U-turn
- Protect

Amoonguss @ Rocky Helmet
Ability: Regenerator
- Spore
- Rage Powder
- Pollen Puff
- Protect
`;
