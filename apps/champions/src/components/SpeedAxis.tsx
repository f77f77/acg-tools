import { useMemo, useState } from 'react';
import type { PokemonSet } from '../types';
import { formatSpeciesLabel } from '../lib/species';
import {
  SPEED_AXIS_MAX,
  SPEED_AXIS_MAX_TAILWIND,
  SPEED_AXIS_MIN,
  applyTailwind,
  enemySpeedBands,
  mySpeedPoint,
  speedFromInvestment,
} from '../lib/speedCalc';

interface Props {
  myTeam: PokemonSet[];
  enemyTeam: PokemonSet[];
  /** 我方選中欄位 index；null = 未選 */
  selectedAllyIndex: number | null;
}

/** Fixed reference Spe values. Do not add 0-EV +10% nature (加速0) marks here. */
const BASE_TICKS = [50, 80, 100, 106, 113, 130, 169, 172, 200];
const TAILWIND_TICKS = [...BASE_TICKS, 250, 300, 344, 400];

function pct(value: number, axisMax: number): number {
  const clamped = Math.min(axisMax, Math.max(SPEED_AXIS_MIN, value));
  return ((clamped - SPEED_AXIS_MIN) / (axisMax - SPEED_AXIS_MIN)) * 100;
}

function scaleTicks(axisMax: number): number[] {
  const base = axisMax > SPEED_AXIS_MAX ? TAILWIND_TICKS : BASE_TICKS;
  const ticks = base.filter((t) => t > SPEED_AXIS_MIN && t < axisMax);
  ticks.push(axisMax);
  return [...new Set(ticks)].sort((a, b) => a - b);
}

function allyEffectiveSpe(pokemon: PokemonSet, tailwind: boolean): number {
  const raw = mySpeedPoint(
    pokemon.baseStats.spe,
    pokemon.speed || undefined,
    0,
    1,
  );
  const fallback = speedFromInvestment(pokemon.baseStats.spe, pokemon, true);
  return applyTailwind(raw || fallback, tailwind);
}

function GuideMark({ spe, axisMax }: { spe: number | null; axisMax: number }) {
  if (spe == null || spe <= 0) return null;
  return (
    <span
      className="speed-axis__guide"
      style={{ left: `${pct(spe, axisMax)}%` }}
      aria-hidden
    />
  );
}

function EnemySpeedRow({
  pokemon,
  tailwind,
  axisMax,
  guideSpe,
}: {
  pokemon: PokemonSet;
  tailwind: boolean;
  axisMax: number;
  guideSpe: number | null;
}) {
  const label = formatSpeciesLabel(pokemon);
  if (!pokemon.identified || !pokemon.baseStats.spe) {
    return (
      <div className="speed-row speed-row--empty">
        <span className="speed-row__label">{label}</span>
        <div className="speed-row__track">
          <GuideMark spe={guideSpe} axisMax={axisMax} />
        </div>
      </div>
    );
  }
  const bands = enemySpeedBands(pokemon.baseStats.spe).map((b) => ({
    ...b,
    value: applyTailwind(b.value, tailwind),
  }));
  const slow = bands[0].value;
  const fast = bands[3].value;
  const n0 = bands[1].value;
  const n32 = bands[2].value;
  return (
    <div className="speed-row">
      <span className="speed-row__label" title={label}>
        {label}
      </span>
      <div className="speed-row__track">
        <div
          className="speed-band speed-band--slow"
          style={{ left: `${pct(slow, axisMax)}%`, width: `${Math.max(1, pct(n0, axisMax) - pct(slow, axisMax))}%` }}
          title={`減速0–中性0：${slow}–${n0}${tailwind ? '（順風 ×2）' : ''}`}
        />
        <div
          className="speed-band speed-band--mid"
          style={{ left: `${pct(n0, axisMax)}%`, width: `${Math.max(1, pct(n32, axisMax) - pct(n0, axisMax))}%` }}
          title={`中性0–中性32：${n0}–${n32}${tailwind ? '（順風 ×2）' : ''}`}
        />
        <div
          className="speed-band speed-band--fast"
          style={{ left: `${pct(n32, axisMax)}%`, width: `${Math.max(1, pct(fast, axisMax) - pct(n32, axisMax))}%` }}
          title={`中性32–加速32：${n32}–${fast}${tailwind ? '（順風 ×2）' : ''}`}
        />
        {bands.map((b) => (
          <span
            key={b.id}
            className={`speed-mark speed-mark--${b.kind}`}
            style={{ left: `${pct(b.value, axisMax)}%` }}
            title={`${b.label}: ${b.value}${tailwind ? '（順風 ×2）' : ''}`}
          />
        ))}
        <GuideMark spe={guideSpe} axisMax={axisMax} />
      </div>
    </div>
  );
}

function AllySpeedRow({
  pokemon,
  tailwind,
  axisMax,
  guideSpe,
}: {
  pokemon: PokemonSet;
  tailwind: boolean;
  axisMax: number;
  guideSpe: number | null;
}) {
  const spe = allyEffectiveSpe(pokemon, tailwind);
  const entered = pokemon.speed != null && pokemon.speed > 0;
  const label = formatSpeciesLabel(pokemon);
  return (
    <div className="speed-row speed-row--mine speed-row--selected-ally">
      <span className="speed-row__label" title={label}>
        {label}
      </span>
      <div className="speed-row__track">
        <GuideMark spe={guideSpe} axisMax={axisMax} />
        {entered && spe > 0 && (
          <span
            className="speed-point"
            style={{ left: `${pct(spe, axisMax)}%` }}
            title={`${pokemon.species} Spe ${spe}${tailwind ? '（順風 ×2）' : ''}`}
          >
            ◆
          </span>
        )}
        <span className="speed-row__value speed-row__value--overlay" aria-label="Spe">
          {entered ? spe : '—'}
        </span>
      </div>
    </div>
  );
}

export function SpeedAxis({ myTeam, enemyTeam, selectedAllyIndex }: Props) {
  const [allyTailwind, setAllyTailwind] = useState(false);
  const [enemyTailwind, setEnemyTailwind] = useState(false);
  const axisMax = allyTailwind || enemyTailwind ? SPEED_AXIS_MAX_TAILWIND : SPEED_AXIS_MAX;
  const ticks = useMemo(() => scaleTicks(axisMax), [axisMax]);
  const enemies = enemyTeam.slice(0, 6);
  const enemyTop = enemies.slice(0, 3);
  const enemyBottom = enemies.slice(3, 6);
  const selectedAlly =
    selectedAllyIndex != null && selectedAllyIndex >= 0 && selectedAllyIndex < myTeam.length
      ? myTeam[selectedAllyIndex]
      : null;
  const guideSpe =
    selectedAlly && selectedAlly.identified
      ? allyEffectiveSpe(selectedAlly, allyTailwind)
      : null;

  return (
    <section className="panel panel--speed">
      <header className="panel__header panel__header--row panel__header--speed">
        <h2>速度軸</h2>
        <span className="panel__hint">
          敵方雙色帶：減速0／中性0／中性32／加速32 · 我方單點（點選隊員 · 手填 Spe）
          {allyTailwind || enemyTailwind ? ' · 順風 Spe ×2' : ''}
        </span>
        <div className="speed-axis__toggles">
          <label className={`speed-axis__tw ${allyTailwind ? 'is-on' : ''}`}>
            <input
              type="checkbox"
              checked={allyTailwind}
              onChange={(e) => setAllyTailwind(e.target.checked)}
            />
            我方順風
          </label>
          <label className={`speed-axis__tw ${enemyTailwind ? 'is-on' : ''}`}>
            <input
              type="checkbox"
              checked={enemyTailwind}
              onChange={(e) => setEnemyTailwind(e.target.checked)}
            />
            敵方順風
          </label>
        </div>
      </header>
      <div className="speed-axis">
        <div className="speed-axis__scale speed-row" aria-hidden="true">
          <span className="speed-row__label" />
          <div className="speed-row__track speed-axis__scale-track">
            {ticks.map((t) => (
              <span
                key={t}
                className={t === axisMax ? 'is-max' : undefined}
                style={{ left: `${pct(t, axisMax)}%` }}
              >
                <i className="speed-axis__tick" />
                {t}
              </span>
            ))}
            <GuideMark spe={guideSpe} axisMax={axisMax} />
          </div>
        </div>

        {selectedAlly ? (
          <>
            {enemyTop.map((p) => (
              <EnemySpeedRow
                key={p.id}
                pokemon={p}
                tailwind={enemyTailwind}
                axisMax={axisMax}
                guideSpe={guideSpe}
              />
            ))}
            <AllySpeedRow
              pokemon={selectedAlly}
              tailwind={allyTailwind}
              axisMax={axisMax}
              guideSpe={guideSpe}
            />
            {enemyBottom.map((p) => (
              <EnemySpeedRow
                key={p.id}
                pokemon={p}
                tailwind={enemyTailwind}
                axisMax={axisMax}
                guideSpe={guideSpe}
              />
            ))}
          </>
        ) : (
          <>
            {enemies.map((p) => (
              <EnemySpeedRow
                key={p.id}
                pokemon={p}
                tailwind={enemyTailwind}
                axisMax={axisMax}
                guideSpe={null}
              />
            ))}
            <div className="speed-ally-prompt" role="status">
              點選我方隊員
            </div>
          </>
        )}
      </div>
    </section>
  );
}
