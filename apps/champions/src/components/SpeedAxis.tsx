import { useEffect, useRef, useState } from 'react';
import type { PokemonSet } from '../types';
import { formatSpeciesLabel } from '../lib/species';
import {
  SPEED_AXIS_MAX,
  SPEED_AXIS_MAX_TAILWIND,
  SPEED_AXIS_MIN,
  applyTailwind,
  enemySpeedBands,
} from '../lib/speedCalc';
import { placeSpeedMarkers, speedTickValues } from '../lib/speedAxisLayout';
import { sheetSpriteDataUrl } from '../lib/spriteSheet';

import { AllyIconStrip } from './AllyIconStrip';
import type { EnemyFocus } from '../lib/enemyFocus';

interface Props {
  enemyFocus: EnemyFocus;
  myTeam: PokemonSet[];
  enemyTeam: PokemonSet[];
  selectedAllyIndex: number | null;
  onSelectAlly: (index: number) => void;
}

function SpeedSprite({ pokemon }: { pokemon: PokemonSet }) {
  const { speciesKey, formKey, nationalDex, species } = pokemon;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    void sheetSpriteDataUrl({ speciesId: speciesKey, formKey, nationalDex })
      .then((next) => { if (active) setUrl(next); })
      .catch(() => { if (active) setUrl(null); });

    return () => { active = false; };
  }, [speciesKey, formKey, nationalDex]);

  return url
    ? <img className="speed-chart__sprite" src={url} alt="" />
    : <span aria-hidden="true">{species.slice(0, 1)}</span>;
}

export function SpeedAxis({ enemyFocus, myTeam, enemyTeam, selectedAllyIndex, onSelectAlly }: Props) {
  const [allyTailwind, setAllyTailwind] = useState(false);
  const [enemyTailwind, setEnemyTailwind] = useState(false);
  const plot = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);

  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => setPlotWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const allies = myTeam.slice(0, 6).flatMap((pokemon, index) => {
    const speed = pokemon.speed ?? 0;
    if (!pokemon.identified || !Number.isFinite(speed) || speed <= 0) return [];
    return [{ pokemon, index, speed: applyTailwind(speed, allyTailwind) }];
  });
  const enemies = enemyTeam.slice(0, 6).map((pokemon, slot) => ({
    pokemon,
    slot,
    bands: pokemon.identified && pokemon.baseStats.spe > 0
      ? enemySpeedBands(pokemon.baseStats.spe).map((band) => ({
          ...band,
          value: applyTailwind(band.value, enemyTailwind),
        }))
      : [],
  }));
  const speeds = [...allies.map(({ speed }) => speed), ...enemies.flatMap(({ bands }) => bands.map(({ value }) => value))];
  const min = Math.min(SPEED_AXIS_MIN, ...speeds);
  const defaultMax = allyTailwind || enemyTailwind ? SPEED_AXIS_MAX_TAILWIND : SPEED_AXIS_MAX;
  const max = Math.max(defaultMax, ...speeds);
  const position = (speed: number) => ((speed - min) / (max - min)) * 100;
  const markers = placeSpeedMarkers(allies.map(({ speed }) => speed), min, max, plotWidth);
  const laneCount = Math.max(1, ...markers.map(({ lane }) => lane + 1));
  const selected = allies.find(({ index }) => index === selectedAllyIndex);

  function enemyRows(rows: typeof enemies) {
    return rows.map(({ pokemon, bands, slot }) => {
      const label = formatSpeciesLabel(pokemon);
      if (!bands.length) {
        return null;
      }

      const [slow, neutralMin, neutralMax, fast] = bands;
      let comparison = '';
      if (selected) {
        if (selected.speed < slow.value) comparison = '敵方全段較快';
        else if (selected.speed > fast.value) comparison = '敵方全段較慢';
        else if (selected.speed === slow.value || selected.speed === fast.value) comparison = '端點可同速';
        else comparison = '範圍重疊';
      }
      const left = position(slow.value);
      const right = position(fast.value);
      const details = bands.map(({ label: bandLabel, value }) => `${bandLabel} ${value}`).join('、');
      return (
        <div
          className={`speed-chart__enemy${enemyFocus.active === slot ? ' is-linked' : ''}`}
          key={pokemon.id}
          onPointerEnter={e => { if (e.pointerType === 'mouse') enemyFocus.hover(slot); }}
          onPointerLeave={() => enemyFocus.hover(null)}
        >
          {comparison && <span className="speed-chart__comparison">{comparison}</span>}
          <button
            type="button"
            className="speed-chart__range"
            aria-pressed={enemyFocus.pinned === slot}
            onClick={() => enemyFocus.pin(slot)}
            aria-label={`${label}，${details} ${comparison}`}
            title={`${label} · ${details}`}
            style={{ left: `${left}%`, width: `${right - left}%` }}
          >
            <span className="speed-chart__endpoint is-min" aria-hidden="true">{slow.value}</span>
            <span className="speed-chart__endpoint is-max" aria-hidden="true">{fast.value}</span>
            {[neutralMin, neutralMax].map(({ id, value }) => (
              <span
                className="speed-chart__nature"
                key={id}
                aria-hidden="true"
                style={{ left: `${100 * (value - slow.value) / (fast.value - slow.value)}%` }}
              />
            ))}
            <span className="speed-chart__enemy-sprite" aria-hidden="true">
              <SpeedSprite pokemon={pokemon} />
            </span>
          </button>
        </div>
      );
    });
  }

  return (
    <section className="panel panel--speed">
      <header className="panel__header panel__header--row panel__header--speed">
        <h2 title="我方實速 · 敵方減速 0 至加速 32">速度軸</h2>
        <div className="speed-team">
          <span>我方</span>
          <AllyIconStrip team={myTeam} selectedIndex={selectedAllyIndex} onSelect={onSelectAlly} />
        </div>
        {selected && <span className="speed-context">{selected.pokemon.species} · {selected.speed}</span>}
        <div className="speed-axis__toggles">
          <label className="speed-axis__tw">
            <input type="checkbox" checked={allyTailwind} onChange={(e) => setAllyTailwind(e.target.checked)} />
            我方順風{allyTailwind && ' ×2'}
          </label>
          <label className="speed-axis__tw">
            <input type="checkbox" checked={enemyTailwind} onChange={(e) => setEnemyTailwind(e.target.checked)} />
            敵方順風{enemyTailwind && ' ×2'}
          </label>
        </div>
      </header>
      <div className={`speed-chart${selected ? ' speed-chart--compare' : ''}`}>
        <div className="speed-chart__plot" ref={plot}>
          {selected && (
            <div className="speed-chart__guide" style={{ left: `${position(selected.speed)}%` }} aria-hidden="true" />
          )}
          {enemyRows(enemies.slice(0, 3))}
          <div className="speed-chart__scale">
            <div className="speed-chart__allies" style={{ height: laneCount * 28 }}>
              {markers.map(({ index: markerIndex, lane }) => {
                const { pokemon, index, speed } = allies[markerIndex];
                const label = `${formatSpeciesLabel(pokemon)} · Spe ${speed}`;
                return (
                  <button
                    className="speed-chart__ally"
                    key={pokemon.id}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={selectedAllyIndex === index}
                    onClick={() => onSelectAlly(index)}
                    style={{ left: `${position(speed)}%`, bottom: lane * 28 }}
                  >
                    <SpeedSprite pokemon={pokemon} />
                    <span>{speed}</span>
                  </button>
                );
              })}
            </div>
            <div className="speed-chart__ticks" aria-hidden="true">
              {speedTickValues(min, max, plotWidth).map((tick) => (
                <span key={tick} style={{ left: `${position(tick)}%` }}>{tick}</span>
              ))}
            </div>
          </div>
          {enemyRows(enemies.slice(3))}
        </div>
      </div>
    </section>
  );
}
