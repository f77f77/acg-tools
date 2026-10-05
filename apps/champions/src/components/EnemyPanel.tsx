import type { PokemonSet } from '../types';
import { PokemonCard } from './PokemonCard';
import { legalSpeciesOptions } from '../lib/species';

interface Props {
  team: PokemonSet[];
  onSpeciesOverride: (index: number, speciesKey: string) => void;
  onFormChange: (index: number, formKey: string) => void;
}

export function EnemyPanel({ team, onSpeciesOverride, onFormChange }: Props) {
  const options = legalSpeciesOptions();

  return (
    <section className="panel panel--enemy">
      <header className="panel__header">
        <h2>敵方隊伍</h2>
        <span className="panel__hint">低信心 → 未識別；可手動覆寫</span>
      </header>
      <div className="panel__cards panel__cards--enemy-grid">
        {team.map((p, i) => (
          <PokemonCard
            key={p.id}
            pokemon={p}
            variant="enemy"
            speciesOptions={options}
            onSpeciesOverride={(key) => onSpeciesOverride(i, key)}
            onFormChange={(fk) => onFormChange(i, fk)}
          />
        ))}
      </div>
    </section>
  );
}
