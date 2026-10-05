import { useEffect, useState } from 'react';
import type { PokemonSet } from '../types';
import { sheetSpriteDataUrl } from '../lib/spriteSheet';

interface Props {
  team: PokemonSet[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

function AllyIcon({
  pokemon,
  selected,
  onSelect,
  slot,
}: {
  pokemon: PokemonSet;
  selected: boolean;
  onSelect: () => void;
  slot: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pokemon.identified || !pokemon.speciesKey) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void sheetSpriteDataUrl({
      speciesId: pokemon.speciesKey,
      formKey: pokemon.formKey,
      nationalDex: pokemon.nationalDex,
    }).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pokemon.identified, pokemon.speciesKey, pokemon.formKey, pokemon.nationalDex]);

  const label = pokemon.identified ? pokemon.species : `空位 ${slot + 1}`;
  return (
    <button
      type="button"
      className={`ally-icon-strip__btn${selected ? ' is-selected' : ''}${pokemon.identified ? '' : ' is-empty'}`}
      onClick={onSelect}
      title={selected ? `${label}（取消選取）` : `${label}（選取以對照速度軸）`}
      aria-pressed={selected}
      aria-label={label}
    >
      {url ? <img src={url} alt="" className="ally-icon-strip__img" /> : <span className="ally-icon-strip__ph">+</span>}
    </button>
  );
}

/** Slim left column of 6 ally sheet sprites. Does not replace 我方隊伍 overlay. */
export function AllyIconStrip({ team, selectedIndex, onSelect }: Props) {
  const slots = Array.from({ length: 6 }, (_, i) => team[i] || null);
  return (
    <nav className="ally-icon-strip" aria-label="我方精靈圖示">
      {slots.map((p, i) =>
        p ? (
          <AllyIcon
            key={p.id}
            pokemon={p}
            slot={i}
            selected={selectedIndex === i}
            onSelect={() => onSelect(i)}
          />
        ) : (
          <span key={`empty-${i}`} className="ally-icon-strip__btn is-empty" aria-hidden>
            <span className="ally-icon-strip__ph">+</span>
          </span>
        ),
      )}
    </nav>
  );
}
