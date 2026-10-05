import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TeamPanel } from './components/TeamPanel';
import { EnemyPanel } from './components/EnemyPanel';
import { CapturePanel, type CapturePanelHandle } from './components/CapturePanel';
import { SpeedAxis } from './components/SpeedAxis';
import { emptySlot, type PokemonSet } from './types';
import { SAMPLE_MY_TEAM_KEYS, SPECIES_DB, findSpecies, speciesToSet } from './lib/species';
import { calcStat, speedFromInvestment } from './lib/speedCalc';
import { loadAllyTeam, saveAllyTeam } from './lib/allyTeamStorage';
import {
  recognizeEnemyTeamFromCanvas,
  CONFIDENCE_THRESHOLD,
  loadFineTune,
  saveFineTune,
  loadDebugOverlay,
  saveDebugOverlay,
  ROI_FINE_TUNE_MAX,
  ENEMY_PANEL_DEFAULT,
  type RoiFineTune,
} from './lib/recognize';
import { fetchTopMoves, fetchTopItems, top4ForCard, top6ForCard, MOVES_SOURCE_LABEL } from './lib/movesCache';
import { APP_NAME, SHOWDOWN_TEAMBUILDER_URL, formatAppVersion } from './version';
import {
  AUTO_RECOGNIZE_KEY,
  SAVE_RECOGNIZE_FRAMES_KEY,
  SHOW_AV_CONTROLS_KEY,
  loadBoolPref,
  saveBoolPref,
} from './lib/prefs';

const TEAM_PANEL_STORAGE_KEY = 'pkmn-ally-panel-open';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function loadTeamPanelOpen(): boolean {
  try {
    const v = localStorage.getItem(TEAM_PANEL_STORAGE_KEY);
    if (v == null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

function saveTeamPanelOpen(open: boolean): void {
  try {
    localStorage.setItem(TEAM_PANEL_STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.81 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.93 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.26.12.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
      />
    </svg>
  );
}

function TeamPanelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 5a1 1 0 0 1 1-1h6v16H5a1 1 0 0 1-1-1V5zm10-1h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5V4zM6.5 7h3v1.5h-3V7zm0 3h3V11.5h-3V10z"
      />
    </svg>
  );
}

async function buildDemoMyTeam(): Promise<PokemonSet[]> {
  const out: PokemonSet[] = [];
  for (let i = 0; i < SAMPLE_MY_TEAM_KEYS.length; i++) {
    const key = SAMPLE_MY_TEAM_KEYS[i];
    const sp = findSpecies(key)!;
    const moves = top4ForCard(await fetchTopMoves(sp.key));
    const items = await fetchTopItems(sp.key, 8);
    out.push(
      speciesToSet(sp, `my-${i}`, {
        speed: calcStat(sp.baseStats.spe, 31, 0, 50, 1),
        item: items[0]?.name || ['勿花果', '突擊背心', '氣勢披帶', '講究眼鏡', '生命寶珠', '岩石盔甲'][i],
        items,
        ability: ['不服輸', '猛火', '威嚇', '毒手', '青草製造者', '威嚇'][i],
        moves,
      }),
    );
  }
  return out;
}

function buildEmptyEnemy(): PokemonSet[] {
  return Array.from({ length: 6 }, (_, i) => emptySlot(i, 'enemy'));
}

function clampTune(v: number): number {
  return Math.min(ROI_FINE_TUNE_MAX, Math.max(-ROI_FINE_TUNE_MAX, v));
}

/** Sync form switch so controlled <select> commits on the first change event. */
function applyFormSync(prev: PokemonSet, formKey: string): PokemonSet | null {
  const form = prev.forms?.find((f) => f.formKey === formKey);
  if (!form) return null;
  const nextSpeed = speedFromInvestment(form.baseStats.spe, prev);
  const patched: PokemonSet = {
    ...prev,
    formKey: form.formKey,
    formLabel: form.label,
    types: [...form.types],
    baseStats: { ...form.baseStats },
    speed: nextSpeed,
  };
  const sp = findSpecies(form.showdownId) || findSpecies(formKey);
  // Different allowlist record (gender / regional sibling) → swap species identity.
  // Same showdownId (Base → Mega on Garchomp) → keep this record and only patch form fields.
  if (sp && sp.key !== prev.speciesKey) {
    return speciesToSet(sp, prev.id, {
      thumbnailDataUrl: prev.thumbnailDataUrl,
      confidence: prev.confidence ?? 1,
      identified: true,
      item: prev.item,
      items: prev.items,
      ability: undefined,
      moves: prev.moves,
      evs: prev.evs,
      evsArePts: prev.evsArePts,
      nature: prev.nature,
      speed: nextSpeed,
      formKey: form.formKey,
      formLabel: form.label,
      types: [...form.types],
      baseStats: { ...form.baseStats },
    });
  }
  return patched;
}

/** Resolve CBD showdown id for a formKey without reading React state. */
function resolveFormMoveIds(formKey: string): { primaryId: string; fallbackId?: string; label: string } | null {
  for (const s of SPECIES_DB) {
    const form = s.forms?.find((f) => f.formKey === formKey);
    if (form) {
      return {
        primaryId: form.showdownId || s.key,
        fallbackId: s.key,
        label: form.label,
      };
    }
  }
  const sp = findSpecies(formKey);
  if (sp) return { primaryId: sp.key, fallbackId: sp.key, label: sp.formLabel || sp.nameZh };
  return null;
}

async function fetchMovesForForm(formKey: string, moveCount: 4 | 6) {
  const ids = resolveFormMoveIds(formKey);
  if (!ids) {
    return {
      moves: moveCount === 4 ? top4ForCard([]) : top6ForCard([]),
      items: [] as Awaited<ReturnType<typeof fetchTopItems>>,
    };
  }
  let movesRaw = await fetchTopMoves(ids.primaryId);
  let items = await fetchTopItems(ids.primaryId, 8);
  if (!movesRaw.length && ids.fallbackId && ids.fallbackId !== ids.primaryId) {
    movesRaw = await fetchTopMoves(ids.fallbackId);
  }
  if (!items.length && ids.fallbackId && ids.fallbackId !== ids.primaryId) {
    items = await fetchTopItems(ids.fallbackId, 8);
  }
  return {
    moves: moveCount === 4 ? top4ForCard(movesRaw) : top6ForCard(movesRaw),
    items,
  };
}

function buildSyncDemoTeam(): PokemonSet[] {
  return SAMPLE_MY_TEAM_KEYS.map((key, i) => {
    const sp = findSpecies(key)!;
    return speciesToSet(sp, `my-${i}`, {
      speed: calcStat(sp.baseStats.spe, 31, 0, 50, 1),
      item: ['勿花果', '突擊背心', '氣勢披帶', '講究眼鏡', '生命寶珠', '岩石盔甲'][i],
      ability: ['不服輸', '猛火', '威嚇', '毒手', '青草製造者', '威嚇'][i],
    });
  });
}

export default function App() {
  const [restoredAlly] = useState(() => loadAllyTeam());
  const [myTeam, setMyTeam] = useState<PokemonSet[]>(() => restoredAlly ?? buildSyncDemoTeam());
  const [enemyTeam, setEnemyTeam] = useState<PokemonSet[]>(() => buildEmptyEnemy());
  const [status, setStatus] = useState('就緒 — 請連接 GC551／OBS、載入靜態選隊圖，或匯入我方隊伍');
  const [busy, setBusy] = useState(false);
  const [fineTune, setFineTune] = useState<RoiFineTune>(() => loadFineTune());
  const [debugOverlay, setDebugOverlay] = useState(() => loadDebugOverlay());
  /** 速度軸對照用：目前選中的我方隊員 index */
  const [selectedAllyIndex, setSelectedAllyIndex] = useState<number | null>(null);
  const [teamOpen, setTeamOpen] = useState(() => loadTeamPanelOpen());
  const [showAvControls, setShowAvControls] = useState(() => loadBoolPref(SHOW_AV_CONTROLS_KEY, true));
  const [autoRecognize, setAutoRecognize] = useState(() => loadBoolPref(AUTO_RECOGNIZE_KEY, true));
  const [saveRecognizeFrames, setSaveRecognizeFrames] = useState(() =>
    loadBoolPref(SAVE_RECOGNIZE_FRAMES_KEY, false),
  );
  const captureRef = useRef<CapturePanelHandle>(null);
  const appVersion = formatAppVersion();

  useEffect(() => {
    document.title = `${APP_NAME} ${appVersion} · Doubles`;
  }, [appVersion]);

  // Prefer CBD Doubles top-4 for ally demo when baked usage exists; else 未載入 (no fake stubs).
  // Skip when localStorage already has an imported / edited team (F5 must restore it).
  useEffect(() => {
    if (restoredAlly) return;
    let cancelled = false;
    void (async () => {
      const next = await buildDemoMyTeam();
      if (!cancelled) setMyTeam(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [restoredAlly]);

  useEffect(() => {
    saveAllyTeam(myTeam);
  }, [myTeam]);

  const panelPreview = useMemo(() => {
    const l = ENEMY_PANEL_DEFAULT.left + fineTune.dLeft;
    const t = ENEMY_PANEL_DEFAULT.top + fineTune.dTop;
    const r = ENEMY_PANEL_DEFAULT.right + fineTune.dRight;
    const b = ENEMY_PANEL_DEFAULT.bottom + fineTune.dBottom;
    return `(${l.toFixed(3)},${t.toFixed(3)})–(${r.toFixed(3)},${b.toFixed(3)})`;
  }, [fineTune]);

  const onSpeedChange = useCallback((index: number, speed: number) => {
    setMyTeam((prev) => prev.map((p, i) => (i === index ? { ...p, speed } : p)));
  }, []);

  const onSelectAlly = useCallback((index: number) => {
    setSelectedAllyIndex((prev) => (prev === index ? null : index));
  }, []);

  const onMyTeamChange = useCallback((team: PokemonSet[]) => {
    setMyTeam(team);
    setSelectedAllyIndex((prev) =>
      prev != null && prev >= 0 && prev < team.length ? prev : null,
    );
  }, []);

  const onAllyFormChange = useCallback((index: number, formKey: string) => {
    setMyTeam((prev) => {
      const cur = prev[index];
      if (!cur) return prev;
      const next = applyFormSync(cur, formKey);
      if (!next) return prev;
      return prev.map((p, i) => (i === index ? next : p));
    });
    const meta = resolveFormMoveIds(formKey);
    const label = meta?.label || formKey;
    setStatus(`已切換形態：${label}（種族值／屬性已更新）`);
    void (async () => {
      const { moves, items } = await fetchMovesForForm(formKey, 4);
      setMyTeam((prev) =>
        prev.map((p, i) => (i === index && p.formKey === formKey ? { ...p, moves, items, item: items[0]?.name ?? p.item } : p)),
      );
      setStatus(`已切換形態：${label}（種族值／屬性／招式已更新）`);
    })();
  }, []);

  const onEnemyFormChange = useCallback((index: number, formKey: string) => {
    setEnemyTeam((prev) => {
      const cur = prev[index];
      if (!cur) return prev;
      const next = applyFormSync(cur, formKey);
      if (!next) return prev;
      return prev.map((p, i) => (i === index ? next : p));
    });
    const meta = resolveFormMoveIds(formKey);
    setStatus(`敵方形態：${meta?.label || formKey}`);
    void (async () => {
      const { moves, items } = await fetchMovesForForm(formKey, 6);
      setEnemyTeam((prev) =>
        prev.map((p, i) => (i === index && p.formKey === formKey ? { ...p, moves, items } : p)),
      );
    })();
  }, []);

  const onAllySpeciesChange = useCallback((index: number, speciesKey: string) => {
    if (!speciesKey) return;
    const sp = findSpecies(speciesKey);
    if (!sp) return;
    setMyTeam((prev) =>
      prev.map((p, i) =>
        i === index
          ? speciesToSet(sp, p.id, {
              speed: calcStat(sp.baseStats.spe, 31, 0, 50, 1),
              moves: top4ForCard([]),
              item: p.item,
              ability: p.ability,
              thumbnailDataUrl: p.thumbnailDataUrl,
            })
          : p,
      ),
    );
    setStatus(`已選擇種族：${sp.nameZh}`);
    void (async () => {
      const moves = top4ForCard(await fetchTopMoves(sp.key));
      const items = await fetchTopItems(sp.key, 8);
      setMyTeam((prev) =>
        prev.map((p, i) => (i === index && p.speciesKey === sp.key ? { ...p, moves, items, item: items[0]?.name ?? p.item } : p)),
      );
    })();
  }, []);

  const onSpeciesOverride = useCallback((index: number, speciesKey: string) => {
    if (!speciesKey) {
      setEnemyTeam((prev) =>
        prev.map((p, i) => (i === index ? { ...emptySlot(index, 'enemy'), thumbnailDataUrl: p.thumbnailDataUrl } : p)),
      );
      setStatus(`欄位 ${index + 1} 已重設為未識別`);
      return;
    }
    const sp = findSpecies(speciesKey);
    if (!sp) return;
    // Apply species + stats + types immediately so override works even when
    // template match failed / moves fetch is slow (controlled select must update on first change).
    setEnemyTeam((prev) =>
      prev.map((p, i) =>
        i === index
          ? speciesToSet(sp, `enemy-${index}`, {
              speed: calcStat(sp.baseStats.spe, 31, 0, 50, 1),
              moves: top6ForCard([]),
              confidence: 1,
              item: undefined,
              items: [],
              ability: undefined,
              thumbnailDataUrl: p.thumbnailDataUrl,
            })
          : p,
      ),
    );
    setStatus(`已手動覆寫：${sp.nameZh}（弱點／速度軸已更新）`);
    void (async () => {
      const moves = top6ForCard(await fetchTopMoves(sp.key));
      const items = await fetchTopItems(sp.key, 8);
      setEnemyTeam((prev) =>
        prev.map((p, i) => (i === index && p.speciesKey === sp.key ? { ...p, moves, items } : p)),
      );
    })();
  }, []);

  const updateTune = useCallback((patch: Partial<RoiFineTune>) => {
    setFineTune((prev) => {
      const next: RoiFineTune = {
        dLeft: clampTune(patch.dLeft ?? prev.dLeft),
        dTop: clampTune(patch.dTop ?? prev.dTop),
        dRight: clampTune(patch.dRight ?? prev.dRight),
        dBottom: clampTune(patch.dBottom ?? prev.dBottom),
      };
      saveFineTune(next);
      return next;
    });
  }, []);

  const resetTune = useCallback(() => {
    const next = { dLeft: 0, dTop: 0, dRight: 0, dBottom: 0 };
    saveFineTune(next);
    setFineTune(next);
  }, []);

  const toggleDebug = useCallback(() => {
    setDebugOverlay((prev) => {
      const next = !prev;
      saveDebugOverlay(next);
      return next;
    });
  }, []);

  const toggleTeamPanel = useCallback(() => {
    setTeamOpen((prev) => {
      const next = !prev;
      saveTeamPanelOpen(next);
      return next;
    });
  }, []);

  const toggleAvControls = useCallback((show: boolean) => {
    setShowAvControls(show);
    saveBoolPref(SHOW_AV_CONTROLS_KEY, show);
  }, []);

  const toggleAutoRecognize = useCallback(() => {
    setAutoRecognize((prev) => {
      const next = !prev;
      saveBoolPref(AUTO_RECOGNIZE_KEY, next);
      return next;
    });
  }, []);

  const toggleSaveRecognizeFrames = useCallback(() => {
    setSaveRecognizeFrames((prev) => {
      const next = !prev;
      saveBoolPref(SAVE_RECOGNIZE_FRAMES_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        onSelectAlly(Number(e.key) - 1);
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        if (e.target instanceof HTMLElement && e.target.closest('button, [role="button"], summary, a')) {
          return;
        }
        e.preventDefault();
        captureRef.current?.recognizeNow();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSelectAlly]);

  const onRecognize = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setBusy(true);
      setStatus('辨認中… 擷取單幀並裁切右側 6 縮圖');
      try {
        const results = await recognizeEnemyTeamFromCanvas(canvas, fineTune);
        const next: PokemonSet[] = [];
        for (let i = 0; i < 6; i++) {
          const r = results[i];
          const speciesKey = r?.speciesId ?? r?.species ?? null;
          const conf = r?.confidence ?? 0;
          if (!r || conf < CONFIDENCE_THRESHOLD || !speciesKey) {
            next.push({
              ...emptySlot(i, 'enemy'),
              confidence: conf,
              thumbnailDataUrl: r?.thumbnailDataUrl,
            });
            continue;
          }
          const sp = findSpecies(speciesKey);
          if (!sp) {
            next.push({
              ...emptySlot(i, 'enemy'),
              confidence: conf,
              thumbnailDataUrl: r.thumbnailDataUrl,
            });
            continue;
          }
          const [movesRaw, items] = await Promise.all([fetchTopMoves(sp.key), fetchTopItems(sp.key, 8)]);
          next.push(
            speciesToSet(sp, `enemy-${i}`, {
              speed: calcStat(sp.baseStats.spe, 31, 0, 50, 1),
              confidence: conf,
              moves: top6ForCard(movesRaw),
              item: undefined,
              items,
              ability: undefined,
              thumbnailDataUrl: r.thumbnailDataUrl,
            }),
          );
        }
        setEnemyTeam(next);
        const hit = results.filter(
          (r) => (r.speciesId || r.species) && r.confidence >= CONFIDENCE_THRESHOLD,
        ).length;
        setStatus(
          hit > 0
            ? `辨認完成：${hit}/6 命中模板（弱點／速度軸／top6 招式已刷新）`
            : '辨認完成（低信心 → 未識別）。可手動覆寫種族；縮圖已裁切。',
        );
      } catch {
        setStatus('辨認失敗（已安全忽略）');
      } finally {
        setBusy(false);
      }
    },
    [fineTune],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__left">
          <button
            type="button"
            className={`icon-btn team-dock-toggle ${teamOpen ? 'is-active' : ''}`}
            aria-pressed={teamOpen}
            aria-label={teamOpen ? '隱藏我方隊伍' : '顯示我方隊伍'}
            title={teamOpen ? '隱藏我方隊伍' : '顯示我方隊伍'}
            onClick={toggleTeamPanel}
          >
            <TeamPanelIcon />
          </button>
          <div className="app-header__brand">
            <strong>{APP_NAME}</strong>
            <span className="muted">
              {appVersion} · Doubles
            </span>
          </div>
        </div>
        <nav className="app-header__nav">
          <a
            className="app-header__link"
            href={SHOWDOWN_TEAMBUILDER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Showdown 組隊
          </a>
          <details className="settings">
            <summary className="settings__summary icon-btn" aria-label="設置" title="設置">
              <GearIcon />
            </summary>
            <div className="settings__body">
              <p className="settings__title">ROI 微調（±2%）</p>
              <p className="muted settings__hint">預設 {panelPreview} · 相對 16:9 內容區</p>
              {(
                [
                  ['dLeft', '左'],
                  ['dTop', '上'],
                  ['dRight', '右'],
                  ['dBottom', '下'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="settings__row">
                  <span>{label}</span>
                  <input
                    type="range"
                    min={-ROI_FINE_TUNE_MAX}
                    max={ROI_FINE_TUNE_MAX}
                    step={0.001}
                    value={fineTune[key]}
                    onChange={(e) => updateTune({ [key]: Number(e.target.value) })}
                  />
                  <span className="settings__val">{(fineTune[key] * 100).toFixed(1)}%</span>
                </label>
              ))}
              <div className="settings__actions">
                <button type="button" className="btn btn--ghost" onClick={resetTune}>
                  重設 ROI
                </button>
                <label className="settings__check">
                  <input type="checkbox" checked={debugOverlay} onChange={toggleDebug} />
                  ROI 除錯疊加（綠面板／黃縮圖）
                </label>
                <label className="settings__check">
                  <input
                    type="checkbox"
                    checked={showAvControls}
                    onChange={(e) => toggleAvControls(e.target.checked)}
                  />
                  顯示鏡頭／音訊控制
                </label>
                <label className="settings__check">
                  <input type="checkbox" checked={autoRecognize} onChange={toggleAutoRecognize} />
                  自動辨認（選隊畫面錨點，非逐幀 OCR）
                </label>
                <label className="settings__check">
                  <input
                    type="checkbox"
                    checked={saveRecognizeFrames}
                    onChange={toggleSaveRecognizeFrames}
                  />
                  辨認時儲存遊戲畫面（除錯，預設關）
                </label>
              </div>
              <hr />
              <p className="settings__title">擷取卡（GC551）</p>
              <p className="muted settings__hint">
                鏡頭約束：1920×1080 @ 60（理想），有支援時優先 MJPEG。實機有畫面即視為已連接；盒上
                Signal Out of Range 多為 passthrough／EDID，唔影響擷取同辨認。
              </p>
              <p className="muted settings__hint">
                PC 已係 1080p60 仍見 Out of Range → 查 passthrough
                螢幕支援、GC551 EDID／遊戲機輸出、改用擷取預覽唔睇盒上 OSD。
              </p>
              <p className="muted settings__hint">
                系統混音／Discord 要喺 OS 選 GC551 做輸入；app 監聽只係本機預覽。
              </p>
              <p>快捷鍵：1–6 選我方欄位 · Space 辨認敵方隊伍</p>
              <p>鏡頭：優先 GC551／AVerMedia，其次 OBS</p>
              <p>Spe 於我方卡片手填</p>
              <p>招式來源：{MOVES_SOURCE_LABEL}（無資料→未載入）</p>
              <p>模板：僅 Team Preview 小縮圖</p>
            </div>
          </details>
        </nav>
      </header>

      {teamOpen ? (
        <TeamPanel
          team={myTeam}
          onTeamChange={onMyTeamChange}
          onSpeedChange={onSpeedChange}
          onFormChange={onAllyFormChange}
          onSpeciesChange={onAllySpeciesChange}
          selectedIndex={selectedAllyIndex}
          onSelectAlly={onSelectAlly}
          onClose={toggleTeamPanel}
        />
      ) : null}

      <main className={`layout ${teamOpen ? 'layout--team-open' : ''}`}>
        <div className="layout__center">
          <CapturePanel
            ref={captureRef}
            busy={busy}
            onRecognize={onRecognize}
            statusText={status}
            fineTune={fineTune}
            debugOverlay={debugOverlay}
            allyTeam={myTeam}
            selectedAllyIndex={selectedAllyIndex}
            onSelectAlly={onSelectAlly}
            showAvControls={showAvControls}
            onShowAvControlsChange={toggleAvControls}
            autoRecognize={autoRecognize}
            saveRecognizeFrames={saveRecognizeFrames}
          />
          <SpeedAxis myTeam={myTeam} enemyTeam={enemyTeam} selectedAllyIndex={selectedAllyIndex} />
          <p className="usage-source-global" title={MOVES_SOURCE_LABEL}>
            使用率來源：{MOVES_SOURCE_LABEL}
          </p>
        </div>
        <EnemyPanel
          team={enemyTeam}
          onSpeciesOverride={onSpeciesOverride}
          onFormChange={onEnemyFormChange}
        />
      </main>

      <footer className="app-footer">{busy ? '辨認中…' : status}</footer>
    </div>
  );
}
