import type { PokemonSet } from '../types';
import { PokemonCard } from './PokemonCard';
import { legalSpeciesOptions } from '../lib/species';

import type { EnemyFocus } from '../lib/enemyFocus';

interface Props {
  enemyFocus: EnemyFocus;
  team: PokemonSet[];
  onSpeciesOverride: (index: number, speciesKey: string) => void;
  onFormChange: (index: number, formKey: string) => void;
}

export function EnemyPanel({ enemyFocus, team, onSpeciesOverride, onFormChange }: Props) {
  const options = legalSpeciesOptions();

  return (
    <section className={`panel panel--enemy${team.some(p => p.identified) ? '' : ' is-waiting'}`}>
      <header className="panel__header">
        <h2>敵方隊伍</h2>

      </header>
      <div className="panel__cards panel__cards--enemy-grid">
        {team.map((p, i) => (
          <PokemonCard
            key={p.id}
            pokemon={p}
            variant="enemy"
            linked={enemyFocus.active === i}
            onHover={inside => enemyFocus.hover(inside ? i : null)}
            speciesOptions={options}
            onSpeciesOverride={(key) => onSpeciesOverride(i, key)}
            onFormChange={(fk) => onFormChange(i, fk)}
          />
        ))}
      </div>
    </section>
  );
}
