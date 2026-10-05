import { emptySlot, type HeldItemSlot, type MoveSlot, type PokemonSet, type Stats } from '../types';
import { findSpecies, speciesToSet } from './species';
import { inferEvsArePts, speedFromInvestment } from './speedCalc';

export const ALLY_TEAM_STORAGE_KEY = 'pkmn-ally-team-v1';

interface StoredAllySlot {
  speciesKey?: string;
  species?: string;
  formKey?: string;
  item?: string;
  items?: HeldItemSlot[];
  ability?: string;
  evs?: Partial<Stats>;
  evsArePts?: boolean;
  nature?: string;
  speed?: number;
  moves?: MoveSlot[];
  identified?: boolean;
}

function applyStoredForm(set: PokemonSet, formKey?: string): PokemonSet {
  if (!formKey || !set.forms?.length) return set;
  const form = set.forms.find((f) => f.formKey === formKey);
  if (!form) return set;
  return {
    ...set,
    formKey: form.formKey,
    formLabel: form.label,
    types: [...form.types],
    baseStats: { ...form.baseStats },
    speed: speedFromInvestment(form.baseStats.spe, set, true),
  };
}

export function serializeAllyTeam(team: PokemonSet[]): StoredAllySlot[] {
  return team.slice(0, 6).map((p) => ({
    speciesKey: p.speciesKey,
    species: p.species,
    formKey: p.formKey,
    item: p.item,
    items: p.items,
    ability: p.ability,
    evs: p.evs,
    evsArePts: p.evsArePts,
    nature: p.nature,
    speed: p.speed,
    moves: p.moves,
    identified: p.identified,
  }));
}

export function hydrateAllyTeam(raw: unknown): PokemonSet[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const slots = raw.slice(0, 6) as StoredAllySlot[];
  const hasMember = slots.some((s) => s && (s.speciesKey || (s.identified && s.species)));
  if (!hasMember) return null;
  const out: PokemonSet[] = [];
  for (let i = 0; i < 6; i++) {
    const row = slots[i];
    if (!row?.speciesKey && !row?.species) {
      out.push(emptySlot(i, 'my'));
      continue;
    }
    const sp = (row.speciesKey && findSpecies(row.speciesKey)) || (row.species ? findSpecies(row.species) : undefined);
    if (!sp) {
      out.push({
        ...emptySlot(i, 'my'),
        species: row.species || `空位 ${i + 1}`,
        item: row.item,
        items: row.items,
        ability: row.ability,
        evs: row.evs,
        evsArePts: row.evsArePts,
        nature: row.nature,
        speed: row.speed ?? 0,
        moves: row.moves ?? emptySlot(i, 'my').moves,
        identified: Boolean(row.identified ?? row.speciesKey),
        formKey: row.formKey,
      });
      continue;
    }
    const evs = row.evs;
    const evsArePts = row.evsArePts ?? inferEvsArePts(evs);
    const base = speciesToSet(sp, `my-${i}`, {
      item: row.item,
      items: row.items,
      ability: row.ability,
      evs,
      evsArePts,
      nature: row.nature,
      speed: row.speed ?? speedFromInvestment(sp.baseStats.spe, { evs, evsArePts, nature: row.nature }),
      moves: row.moves,
    });
    out.push(applyStoredForm(base, row.formKey));
  }
  return out;
}

export function loadAllyTeam(): PokemonSet[] | null {
  try {
    const raw = localStorage.getItem(ALLY_TEAM_STORAGE_KEY);
    if (!raw) return null;
    return hydrateAllyTeam(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveAllyTeam(team: PokemonSet[]): void {
  try {
    localStorage.setItem(ALLY_TEAM_STORAGE_KEY, JSON.stringify(serializeAllyTeam(team)));
  } catch {
    /* ignore quota / private mode */
  }
}
