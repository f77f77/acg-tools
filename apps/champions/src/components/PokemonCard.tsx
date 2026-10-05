import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { HeldItemSlot, PokemonFormOption, PokemonSet, PokemonType, StatKey } from '../types';
import { ALL_TYPES, TYPE_COLORS, defensiveMatchups } from '../lib/typeChart';
import { typeIconUrl } from '../lib/typeIcons';
import { calcAllStats } from '../lib/speedCalc';
import { formatSpeciesLabel } from '../lib/species';
import { getMoveDetails, MOVES_SOURCE_LABEL, sortByUsageDesc, splitHeldItemUsage } from '../lib/movesCache';
import { sheetSpriteDataUrl } from '../lib/spriteSheet';

const STAT_LABELS: { key: StatKey; label: string }[] = [
  { key: 'hp', label: 'HP' },
  { key: 'atk', label: 'A' },
  { key: 'def', label: 'D' },
  { key: 'spa', label: 'SA' },
  { key: 'spd', label: 'SD' },
  { key: 'spe', label: 'S' },
];

interface Props {
  pokemon: PokemonSet;
  variant: 'my' | 'enemy';
  onSpeciesOverride?: (name: string) => void;
  onSpeedChange?: (speed: number) => void;
  onFormChange?: (formKey: string) => void;
  speciesOptions?: { key: string; label: string }[];
  /** 我方卡片：是否為速度軸選中對象 */
  selected?: boolean;
  onSelect?: () => void;
}

/** 屬性圖示 only（不顯示文字標籤） */
function TypeBadge({ type, size = 'md' }: { type: PokemonType | string; size?: 'sm' | 'md' }) {
  const url = typeIconUrl(type);
  const color = TYPE_COLORS[type as PokemonType];
  if (url) {
    return (
      <span className={`type-badge type-badge--icon type-badge--${size}`} title={String(type)}>
        <img src={url} alt={String(type)} className="type-badge__img" />
      </span>
    );
  }
  return (
    <span className="type-badge" style={{ background: color || '#666' }} title={String(type)}>
      {type}
    </span>
  );
}

function formatUsage(usage: string | number | undefined): string | null {
  if (usage == null || usage === '') return null;
  if (typeof usage === 'number') return `${usage}%`;
  const s = String(usage).trim();
  if (!s) return null;
  return /%$/.test(s) ? s : `${s}%`;
}

function formatItemUsageLine(items: HeldItemSlot[] | undefined, fallback: string): string {
  const top = items ?? [];
  if (!top.length) return fallback;
  return top
    .map((it) => {
      const u = formatUsage(it.usage);
      return u ? `${it.name} ${u}` : it.name;
    })
    .join(' · ');
}

function useSheetSprite(pokemon: PokemonSet): string | null {
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
  return url;
}

function placeFixedTooltip(
  anchor: DOMRect,
  tipW: number,
  tipH: number,
): { top: number; left: number } {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = anchor.top - tipH - 6;
  if (top < pad) top = anchor.bottom + 6;
  if (top + tipH > vh - pad) top = Math.max(pad, vh - pad - tipH);
  let left = anchor.left;
  if (left + tipW > vw - pad) left = vw - pad - tipW;
  if (left < pad) left = pad;
  return { top, left };
}

function MoveTooltip({
  name,
  typeLabel,
  moveId,
  usageLabel,
  anchorRef,
  open,
}: {
  name: string;
  typeLabel: string;
  moveId?: string;
  usageLabel?: string | null;
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
}) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; ready: boolean }>({
    top: 0,
    left: 0,
    ready: false,
  });
  const rec = getMoveDetails(moveId || name);
  const zh = rec?.names?.['zh-Hant'] || name;
  const power = rec?.power;
  const acc = rec?.accuracy;
  const flavor = rec?.flavor?.['zh-Hant'] || null;
  const empty = name === '—' || name === '未載入';

  useLayoutEffect(() => {
    if (!open || empty) {
      setPos((p) => (p.ready ? { ...p, ready: false } : p));
      return;
    }
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!anchor || !tip) return;
      const next = placeFixedTooltip(anchor, tip.width, tip.height);
      setPos({ ...next, ready: true });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, empty, name, flavor, anchorRef]);

  if (empty || !open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={tipRef}
      className="move-tooltip move-tooltip--fixed"
      role="tooltip"
      style={{
        top: pos.top,
        left: pos.left,
        visibility: pos.ready ? 'visible' : 'hidden',
      }}
    >
      <strong>{zh}</strong>
      <span>屬性：{typeLabel}</span>
      <span>威力：{power == null ? '—' : power}</span>
      <span>命中：{acc == null ? '—' : acc}</span>
      {usageLabel ? <span>使用率：{usageLabel}</span> : null}
      {flavor ? <span className="move-tooltip__flavor">{flavor}</span> : null}
    </div>,
    document.body,
  );
}

function MoveButton({
  mv,
  usageLabel,
  tip,
}: {
  mv: { name: string; type: string; id?: string; pp?: string };
  usageLabel: string | null;
  tip: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const showTip = mv.name !== '—' && mv.name !== '未載入';
  return (
    <button
      ref={btnRef}
      type="button"
      className="move-btn"
      style={{ borderColor: TYPE_COLORS[mv.type as keyof typeof TYPE_COLORS] || '#666' }}
      title={showTip ? undefined : tip}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span className="move-btn__main">
        {typeIconUrl(mv.type) && (
          <img src={typeIconUrl(mv.type)!} alt={String(mv.type)} className="move-btn__type-icon" title={String(mv.type)} />
        )}
        <span className="move-btn__name">{mv.name}</span>
      </span>
      {usageLabel ? <small className="move-btn__usage">{usageLabel}</small> : mv.pp ? <small>{mv.pp}</small> : null}
      <MoveTooltip
        name={mv.name}
        typeLabel={String(mv.type)}
        moveId={mv.id}
        usageLabel={usageLabel}
        anchorRef={btnRef}
        open={open && showTip}
      />
    </button>
  );
}

function formOptionsOf(pokemon: PokemonSet): PokemonFormOption[] {
  return Array.isArray(pokemon.forms) ? pokemon.forms : [];
}

function formatMultLabel(m: number): string {
  if (m === 0) return '0';
  if (m === 0.25) return '1/4';
  if (m === 0.5) return '1/2';
  if (m === 2) return '2';
  if (m === 4) return '4';
  return String(m);
}

function multCssKey(m: number): string {
  if (m === 0) return 'immune';
  if (m === 0.25) return 'quarter';
  if (m === 0.5) return 'half';
  if (m >= 4) return 'x4';
  if (m > 1) return 'weak';
  return 'half';
}

/** Group non-neutral matchups into compact rows; ×4 and ×0 share one row. */
function MatchupRows({ matchups }: { matchups: Record<PokemonType, number> }) {
  const byMult = new Map<number, PokemonType[]>();
  for (const t of ALL_TYPES) {
    const m = matchups[t];
    if (m === 1) continue; // hide neutral
    const list = byMult.get(m) ?? [];
    list.push(t);
    byMult.set(m, list);
  }

  const rowSpecs: Array<Array<{ mult: number; types: PokemonType[] }>> = [];
  // ×4 (and any ≥4) + ×0 share one compact row with dual badges
  const fours = [...byMult.entries()].filter(([m]) => m >= 4).sort((a, b) => b[0] - a[0]);
  const zeros = byMult.has(0) ? [{ mult: 0, types: byMult.get(0)! }] : [];
  const fourGroups = fours.map(([mult, types]) => ({ mult, types }));
  if (fourGroups.length || zeros.length) {
    rowSpecs.push([...fourGroups, ...zeros]);
  }
  for (const m of [2, 0.5, 0.25]) {
    if (byMult.has(m)) rowSpecs.push([{ mult: m, types: byMult.get(m)! }]);
  }
  // leftovers (e.g. ×⅛)
  const used = new Set<number>();
  for (const row of rowSpecs) for (const g of row) used.add(g.mult);
  for (const [m, types] of [...byMult.entries()].sort((a, b) => b[0] - a[0])) {
    if (used.has(m)) continue;
    rowSpecs.push([{ mult: m, types }]);
  }

  if (!rowSpecs.length) return null;

  return (
    <div className="type-grid" title="屬性抗性／弱點（雙屬性乘算；隱藏 ×1）">
      {rowSpecs.map((groups, ri) => (
        <div key={ri} className="type-grid__row">
          {groups.map(({ mult, types }) => (
            <span key={mult} className="type-grid__group">
              <span className={`type-grid__mult type-grid__mult--${multCssKey(mult)}`} title={`×${mult}`}>
                {formatMultLabel(mult)}
              </span>
              {types.map((t) => {
                const icon = typeIconUrl(t);
                return icon ? (
                  <img key={t} src={icon} alt={t} title={`${t}: ×${mult}`} className="type-grid__icon" />
                ) : (
                  <span key={t} className="type-grid__icon" title={`${t}: ×${mult}`}>
                    {t.slice(0, 1)}
                  </span>
                );
              })}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}


export function PokemonCard({
  pokemon,
  variant,
  onSpeciesOverride,
  onSpeedChange,
  onFormChange,
  speciesOptions,
  selected,
  onSelect,
}: Props) {
  const stats = calcAllStats(pokemon.baseStats, pokemon.evs, pokemon.nature, pokemon.evsArePts);
  const maxStat = Math.max(150, ...Object.values(pokemon.baseStats));
  const matchups = pokemon.types.length ? defensiveMatchups(pokemon.types) : null;
  const moveLimit = variant === 'enemy' ? 6 : 4;
  const displayMoves = (() => {
    const raw = pokemon.moves.slice();
    const ranked = sortByUsageDesc(
      raw.filter((m) => m?.name && m.name !== '—' && m.name !== '未載入' && m.usage != null && m.usage !== ''),
    );
    const rest = raw.filter(
      (m) => !ranked.includes(m),
    );
    const ordered = [...ranked, ...rest];
    while (ordered.length < moveLimit) ordered.push({ name: '—', type: '一般' });
    return ordered.slice(0, moveLimit);
  })();
  const forms = formOptionsOf(pokemon);
  const showFormSelect = forms.length > 1 && !!onFormChange;
  const formSelectValue = forms.some((f) => f.formKey === pokemon.formKey)
    ? (pokemon.formKey as string)
    : forms.find((f) => f.isDefault)?.formKey || forms[0]?.formKey || '';
  const speciesTitle = formatSpeciesLabel(pokemon);
  const sheetUrl = useSheetSprite(pokemon);
  const avatarUrl = sheetUrl || (pokemon.identified ? null : pokemon.thumbnailDataUrl);
  const { megaStones, held } = splitHeldItemUsage(pokemon.items, 2);

  const selectable = variant === 'my' && !!onSelect;
  const cardClass = [
    'pkmn-card',
    `pkmn-card--${variant}`,
    variant === 'enemy' ? 'pkmn-card--dense' : '',
    pokemon.identified ? '' : 'is-unidentified',
    selected ? 'is-selected' : '',
    selectable ? 'is-selectable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const spriteEl = (
    <div className="pkmn-card__sprite" aria-hidden>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="pkmn-card__thumb" />
      ) : pokemon.speciesKey ? (
        pokemon.speciesKey.slice(0, 2).toUpperCase()
      ) : (
        '??'
      )}
    </div>
  );

  const speciesValue = pokemon.speciesKey || '';
  const speciesKnown =
    !speciesValue || (speciesOptions ?? []).some((opt) => opt.key === speciesValue);
  const speciesEl = onSpeciesOverride ? (
    <select
      className="pkmn-card__species-select"
      value={speciesValue}
      onChange={(e) => onSpeciesOverride(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      aria-label={variant === 'enemy' ? '手動覆寫種族' : '選擇種族'}
    >
      {variant === 'enemy' ? <option value="">未識別</option> : null}
      {!speciesKnown ? <option value={speciesValue}>{speciesTitle}</option> : null}
      {(speciesOptions ?? []).map((opt) => (
        <option key={opt.key} value={opt.key}>
          {opt.label}
        </option>
      ))}
    </select>
  ) : (
    <h3 title={speciesTitle}>{speciesTitle}</h3>
  );

  const formEl = showFormSelect ? (
    <label className="pkmn-card__form-select-wrap" onClick={(e) => e.stopPropagation()}>
      <span className="muted">形態</span>
      <select
        className="pkmn-card__form-select"
        value={formSelectValue}
        onChange={(e) => onFormChange?.(e.target.value)}
        aria-label="切換形態／Mega"
      >
        {forms.map((f) => (
          <option key={f.formKey} value={f.formKey}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  ) : (
    pokemon.formLabel && <span className="pkmn-card__form">{pokemon.formLabel}</span>
  );

  const metaEl = (
    <div className="pkmn-card__meta">
      {megaStones.length ? (
        <span className="pkmn-card__items" title={`${formatItemUsageLine(megaStones, '')} · ${MOVES_SOURCE_LABEL}`}>
          進化石使用率：{formatItemUsageLine(megaStones, '—')}
        </span>
      ) : null}
      <span
        className="pkmn-card__items"
        title={
          held.length
            ? `${formatItemUsageLine(held, '')} · ${MOVES_SOURCE_LABEL}`
            : variant === 'enemy'
              ? 'CBD Doubles 道具使用率（非猜測持有）'
              : undefined
        }
      >
        {variant === 'enemy'
          ? `道具：${formatItemUsageLine(held, '—')}`
          : held.length
            ? `道具：${formatItemUsageLine(held, pokemon.item || '無道具')}`
            : pokemon.item || '無道具'}
      </span>
      <span>{pokemon.ability || '—'}</span>
    </div>
  );

  const statsEl = (
    <div className="pkmn-card__stats">
      {STAT_LABELS.map(({ key, label }) => (
        <div key={key} className="stat-row">
          <span className="stat-row__label">{label}</span>
          <div className="stat-row__bar">
            <div
              className="stat-row__fill"
              style={{ width: `${Math.min(100, (pokemon.baseStats[key] / maxStat) * 100)}%` }}
            />
          </div>
          <span className="stat-row__num">
            {pokemon.baseStats[key]}
            <small>({stats[key]})</small>
          </span>
        </div>
      ))}
    </div>
  );

  const typesEl = (
    <div className="pkmn-card__types" aria-label="屬性">
      {pokemon.types.map((t) => (
        <TypeBadge key={t} type={t} size={variant === 'enemy' ? 'sm' : 'md'} />
      ))}
    </div>
  );

  const movesEl = (
    <div className={`move-grid ${variant === 'enemy' ? 'move-grid--six' : ''}`}>
      {displayMoves.map((mv, i) => {
        const usageLabel = formatUsage(mv.usage);
        const tip = usageLabel
          ? `${mv.name} · ${usageLabel} · ${MOVES_SOURCE_LABEL}`
          : mv.name;
        return <MoveButton key={i} mv={mv} usageLabel={usageLabel} tip={tip} />;
      })}
    </div>
  );

  const identityCol = (
    <div className="pkmn-card__col pkmn-card__col--identity">
      <header className="pkmn-card__header">
        {spriteEl}
        <div className="pkmn-card__title">
          {speciesEl}
          {formEl}
          {metaEl}
        </div>
      </header>
      {statsEl}
      {variant === 'my' && onSpeedChange && (
        <label className="pkmn-card__speed-input" onClick={(e) => e.stopPropagation()}>
          Spe 實值
          <input
            type="number"
            min={0}
            max={300}
            value={pokemon.speed || ''}
            placeholder="手填"
            onChange={(e) => onSpeedChange(Number(e.target.value) || 0)}
            onClick={(e) => e.stopPropagation()}
          />
        </label>
      )}
    </div>
  );

  const matchupCol = (
    <div className="pkmn-card__col pkmn-card__col--matchup">
      {typesEl}
      {matchups && <MatchupRows matchups={matchups} />}
      {movesEl}
    </div>
  );

  return (
    <article
      className={cardClass}
      onClick={selectable ? onSelect : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-pressed={selectable ? !!selected : undefined}
      title={selectable ? (selected ? '取消選取（速度軸）' : '選取以對照速度軸') : undefined}
    >
      {variant === 'enemy' ? (
        <div className="pkmn-card__dense">
          <div className="pkmn-card__dense-main">
            <div className="pkmn-card__dense-id">
              {spriteEl}
              {typesEl}
            </div>
            <div className="pkmn-card__dense-info">
              {speciesEl}
              {formEl}
              {metaEl}
              {matchups && <MatchupRows matchups={matchups} />}
            </div>
            {statsEl}
          </div>
          {movesEl}
        </div>
      ) : (
        <div className="pkmn-card__body">
          {identityCol}
          {matchupCol}
        </div>
      )}
    </article>
  );
}
