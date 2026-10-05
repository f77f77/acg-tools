import { useState } from 'react';
import type { PokemonSet } from '../types';
import { PokemonCard } from './PokemonCard';
import { DEMO_SHOWDOWN_PASTE, parseTeamImport } from '../lib/showdownPaste';
import { legalSpeciesOptions } from '../lib/species';

interface Props {
  team: PokemonSet[];
  onTeamChange: (team: PokemonSet[]) => void;
  onSpeedChange: (index: number, speed: number) => void;
  onFormChange?: (index: number, formKey: string) => void;
  onSpeciesChange?: (index: number, speciesKey: string) => void;
  selectedIndex: number | null;
  onSelectAlly: (index: number) => void;
  onClose?: () => void;
}

export function TeamPanel({
  team,
  onTeamChange,
  onSpeedChange,
  onFormChange,
  onSpeciesChange,
  selectedIndex,
  onSelectAlly,
  onClose,
}: Props) {
  const [paste, setPaste] = useState(DEMO_SHOWDOWN_PASTE);
  const [open, setOpen] = useState(false);
  const options = legalSpeciesOptions();

  function applyImport() {
    onTeamChange(parseTeamImport(paste));
    setOpen(false);
  }

  return (
    <section className="panel panel--team panel--overlay" aria-label="我方隊伍">
      <header className="panel__header">
        <h2>我方隊伍</h2>
        <div className="panel__header-actions">
          <button type="button" className="btn btn--ghost" onClick={() => setOpen((v) => !v)}>
            {open ? '關閉匯入' : 'Showdown / JSON'}
          </button>
          {onClose ? (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="隱藏我方隊伍" title="隱藏">
              ×
            </button>
          ) : null}
        </div>
      </header>
      {open && (
        <div className="import-box">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={8}
            placeholder="貼上 Showdown paste 或 JSON…"
            aria-label="隊伍匯入"
          />
          <div className="import-box__actions">
            <button type="button" className="btn btn--primary" onClick={applyImport}>
              匯入隊伍
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setPaste(DEMO_SHOWDOWN_PASTE)}>
              載入示範
            </button>
          </div>
        </div>
      )}
      <p className="panel__hint panel__hint--inline">點選卡片以對照速度軸</p>
      <div className="panel__cards">
        {team.map((p, i) => (
          <PokemonCard
            key={p.id}
            pokemon={p}
            variant="my"
            selected={selectedIndex === i}
            onSelect={() => onSelectAlly(i)}
            onSpeedChange={(spe) => onSpeedChange(i, spe)}
            speciesOptions={onSpeciesChange ? options : undefined}
            onSpeciesOverride={onSpeciesChange ? (key) => onSpeciesChange(i, key) : undefined}
            onFormChange={onFormChange ? (fk) => onFormChange(i, fk) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
