# Pokemon Champions battle assistant (v1.3 / recognize v1.5)

> **Monorepo:** this app lives at `apps/champions/` inside [acg-tools](https://github.com/f77f77/acg-tools). Run commands from this directory (`npm install`, `npm run dev`). GitHub Pages base is `/acg-tools/champions/` so the site URL is `https://f77f77.github.io/acg-tools/champions/`. The standalone `pokemon-champions-assistant` repository stays up for now and is planned to be archived later — this move does not delete that remote. Recognition ROI geometry and the wrong=0 recognize rules below are unchanged. The hub password gate does not cover this app.

Electron + Vite + React (TypeScript). Defaults: AverMedia GC551, local Team Preview thumbs, Spe hand-fill, championsbattledata VGC Doubles (2v2 / 6-pick-4) usage.

UI strings remain Traditional Chinese.

v1.3: Indeedee male and female are separate legal forms. The species menu and form selector show **愛管侍 · 雄性的樣子** and **愛管侍 · 雌性的樣子** (same pattern as 幽尾玄魚). Showdown `Indeedee-F` / atlas `876-1` resolve to `indeedeef`, so the card no longer falls through to an unmatched key and the first roster row **#3 妙蛙花**. 「隱藏鏡頭／音訊」 hides the capture-source dropdown (OBS Virtual Camera), 開啟鏡頭, 擷取音訊, 載入靜態選隊圖, and 載入測試圖 together. 辨認敵方隊伍 and the status pill stay. Settings checkbox **辨認時儲存遊戲畫面** (default off, `localStorage` `pkmn-champions-save-recognize-frames`) downloads the full capture frame used by manual 辨認敵方隊伍 and by auto-recognize. The file is `recognize-frame-YYYYMMDD-HHMMSS-mmm.png` via the browser download (Electron uses the same download; it lands in the system Downloads folder). ROI geometry is unchanged.

v1.2: **敵方隊伍** dense cards use leftover panel height — `grid-template-rows: repeat(3, minmax(0, 1fr))` so the 2×3 grid fills the column instead of leaving a void under tiny type. Species/form/meta/stats/move labels are ~+1–2px vs v1.1; sprite, type icons, and 3×2 move buttons are slightly larger. All 6 cards still fit **without enemy-panel scroll** at ~900–1080px content height. Left column (16:9 capture, expanded 速度軸), ally cards, and Traditional Chinese copy are unchanged.

v1.1: **速度軸** grows to its full lane height — ally + enemy Spe rows are all visible with **no inner vertical scrollbar** in `.panel--speed`. A short viewport may scroll the **left column / page** as a whole. Capture preview stays width-driven **16:9**; enemy **2×3** grid is unchanged (that column may still scroll on its own). Tailwind checkboxes, 加速32 ticks, and the selected-ally cross-axis guide are unchanged.

v1.0: **敵方隊伍** is a **2×3 compact card grid** so all 6 slots fit in the enemy panel at a typical laptop height (~900–1080px content; 1080p-class). Each enemy card is a short horizontal layout — sprite + type icons | species/form dropdowns + 進化石／道具 lines + weakness rows | narrow stats; top-usage moves in a **3×2** grid (type icon + name + %). Empty / 未識別 slots keep the same grid placeholders. Capture preview stays width-driven **16:9**; speed axis is unchanged. The enemy column only scrolls on extremely short viewports.

v0.9: Capture preview height is **width × 9/16** of the left column — not the enemy-team column. After「辨認敵方隊伍」, taller enemy cards must not stretch the 擷取預覽 stage or the video/img (circles stay circles). Left column stacks the 16:9 preview + 速度軸; leftover height is empty (or the right column scrolls). Fullscreen still 16:9-contains inside the stage. ROI overlay stays on the displayed 16:9 frame; recognition geometry (source pixels) is unchanged.

v0.8: Capture preview (live camera, static Team Preview image, and fullscreen) displays a **contained 16:9** frame — letterbox/pillarbox the stage, never stretch the video/canvas. ROI debug overlay is positioned on that 16:9 frame (same contentRect space as recognition).

v0.7: GC551 capture locks 1080p60 (`ideal` 1920×1080 @ 60, MJPEG when the browser exposes it); live frames are treated as a good signal even if the hardware OSD says Signal Out of Range; optional capture-card audio listen (default off) with persisted audio device id. Speed axis enemy dual-band ends at **加速32** (max Spe EV 32 + +Spe nature, Tailwind ×2 when on). Hideable 開啟鏡頭／擷取音訊 row (settings + toolbar, `localStorage`). Hotkeys `1`–`6` select ally slots, `Space` runs 辨認敵方隊伍. Auto-recognize is a Team Preview **anchor state machine** (IDLE → TRIGGERED once → LOCK), not per-frame OCR. Daily CBD usage commits dispatch **Deploy GitHub Pages** so `usageUpdatedAt` reaches the live site. Floette Eternal Flower (and other own-stone cases such as Pyroar) attach Mega in `forms[]`. Usage bind is the latest CBD regulation folder from `/api/index` (`?season=M6` = Regulation M-C; never hardcoded M5).

v0.6: Showdown import applies EVs/natures and `Species-Mega` / mega-stone forms; ally team persists in `localStorage`; move tooltips stay in viewport; speed axis drops the 0-EV +10% tick, adds a max-scale tick, and draws a vertical guide on the selected ally Spe.

## Quick start

```bash
npm install
npm run dev
npm run electron:dev
npm run typecheck
```

## Capture device / static Team Preview

Without GC551:

- Use static select-screen load button (or drag-drop onto the 16:9 preview)
- Use test-fixture button to cycle `public/fixtures/team-preview-test-1.jpg`～`test-4.jpg`

Same contentRect → ROI → thumb → recognize pipeline + green/yellow debug overlay. Still image overrides the preview until you re-open the camera.

## Capture device

1. Plug in AverMedia GC551 (normal videoinput). PC-side capture is typically **1920×1080 60fps YUY2**; the app requests `width/height/frameRate` ideal 1920×1080@60 and prefers MJPEG when Chromium exposes a format constraint (fallback = whatever 1080p60 the card grants).

2. Open camera; picker prefers GC551/AVerMedia (★), then OBS Virtual Camera. Re-open re-applies those video constraints.

3. Persist video `deviceId` in `pkmn-champions-video-device`. Audio input (if any `audioinput` exists) is listed as 擷取音訊 and persisted in `pkmn-champions-audio-device`.

4. Status line shows actual `videoWidth` × `videoHeight` @ fps · format (e.g. `1920×1080 @ 60 · YUY2`). Non-zero frames = **已連接 · 實機訊號正常**. Hardware passthrough / AVerMedia OSD **Signal Out of Range** is not treated as no-signal and does not block 辨認敵方隊伍.

5. Optional **監聽擷取音訊** (default off) plays the selected capture-card audio through a hidden `<audio>` element. Video connect does not fail if mic permission / audio device is missing. OS mix / Discord must select GC551 as the system input; in-app listen is local preview only.

6. No live track and no still image → Traditional Chinese 無訊號. Permission / in-use / overconstrained failures are distinguished (無權限 / 裝置占用 / 無支援解析度).

7. Recognize button grabs ONE frame via canvas then ROI crop (not per-frame)

Busy label uses Traditional Chinese recognizing-state text.

## ROI (VGC spec — Doc v1.3-square-thumb, LOCKED)

Coordinates relative to letterboxed 16:9 contentRect (`computeContentRect`).
**Do not change** `ENEMY_PANEL` / yellow square / `CARD_GAP_FRAC` / panel geometry.

| Constant | Value | Notes |
|----------|-------|-------|
| ENEMY_PANEL_DEFAULT | (0.811,0.137)-(0.965,0.836) | Enemy panel (fixture-calibrated) |
| CARD_GAP_FRAC | 0.08 | Inter-card gap; red card body = pitch×(1−gap) |
| THUMB_CROP.left | 0.18 | Yellow **square** left edge (side = card body height) |
| PANEL_OUTER_MARGIN_FRAC | 0.02 | Green visual pad only (does not shift yellow/recognition) |
| TEMPLATE_SIZE | 64 | Contain/letterbox before match (never stretch) |
| ROI_FINE_TUNE_MAX | ±2% | Settings sliders |

Files: `src/lib/roi.ts`, `src/lib/recognize.ts`.

Settings: ROI fine-tune + green/yellow debug overlay.

## Recognize / template matching (v1.5 guards)

Per slot: `{ slot, confidence, speciesId?, speciesNameZh?, thumbnailDataUrl?, altSpeciesId?, margin?, detectedTypes? }`.

Pipeline (local only, no cloud) — **prefer `null`/未識別 over wrong species**:

1. Crop yellow square thumb with locked ROI (`cardRect` → `thumbRectInSlot`) — geometry unchanged
2. Match-crop cleanup: zero right `MATCH_CROP_RIGHT_EXCLUDE_FRAC` (0.05) to drop type/gender bleed (type icons still read from full card top-right)
3. Suppress maroon card BG → content-aware recenter → 64×64
4. aHash Hamming prefilter → top **40** (or all ham≤18) — fixture-tuned; prefer `null` over wrong species
5. Multi-scale / micro-shift grayscale match vs in-memory crops from `public/sprites/sprite_poke.png` (atlas keyed by **nationalDex**, e.g. `6` / `38-1`)
6. Score = NCC×0.55 + SSD×0.25 + aHash×0.20; coarse hue hist soft ×0.85 if far from template
7. **Second gate (type hard veto):** crop card top-right type icons → match `public/types/{id}.png`. Hard veto uses the **primary** (highest-score) type ≥ `TYPE_MATCH_THR` (0.58). A 2nd icon must reach `TYPE_MATCH_SECOND_THR` (0.66) — canvas NCC confuses **Ghost vs Poison** (both purple) and used to require `water+poison` ⊂ species types, which vetoed Water/Ghost Basculegion-M. Ghost/Poison are interchangeable for the extra slot. Low type conf → skip hard veto.
8. aHash is **8×8 block-mean** on query and templates (same as `scripts/match-test-fixtures.py`). If a type icon was read, same-type templates with ham ≤ 18+8 are rescued into the candidate set (NCC/margin still decide).
9. Accept only if `top1.conf ≥ CONFIDENCE_THRESHOLD (0.54)` **and** `(top1−top2) ≥ requiredMargin(conf)` (dynamic: ≥0.75→0.025, ≥0.68→0.03, ≥0.60→0.05, ≥0.54→0.055, else 0.08); else `speciesId=null`. Soft type (score ≥ 0.45) may break a near-tie toward the unique matching species (Fairy/Psychic and Ghost/Poison icons are interchangeable). Soft pink/purple false colors (Fairy icon read as Poison) may still hint a ≥0.60 top1. A hard type veto that would drop a dominant raw top1 (delta ≥ 0.12) is skipped. Dark sheet bodies stay visible so Greninja is not head-cropped.

Browser path (same code as GitHub Pages): `npx vite` then `node scripts/match-recognize-browser.mjs`. Python: `npm run match:fixtures`. Both must keep **wrong=0**; Basculegion-M is slot 2 on `team-preview-live-latest.jpg` (the scene from the Pages 未識別 report).

Debug fixtures: `python3 scripts/match-test-fixtures.py --debug` → `docs/match-debug.md`

Do not guess held items. Templates must be Team Preview / sprite_poke_3 small thumbs, NOT large art / HOME art.

### Sprite sheet library (nationalDex keys)

Matching loads `public/sprites/sprite_poke.png` **once** and crops cells in memory from `atlas.json` (parsed from `sprite_poke.css` percent positions). Current commit uses the **official Champions sheet** (2208×2078 → **262** allowlisted dex-keyed cells).

| Key | Meaning |
|-----|---------|
| `6` | Charizard (form 0) |
| `38-1` / `38-alola` | Alolan Ninetales |
| `479-2` / `479-wash` | Rotom-Wash |
| `6-mega-x` | alias on `dexAliases` when present |

Do **not** commit hundreds of per-species `{englishName}.png` files. `public/templates/` is deprecated.

Forms / Mega / shiny need their own CSS cell (dex + form), not a second filename. Do not scrape/download from the web without an authorized VGC source.

### How to ingest / refresh the sheet

Re-ingest / refresh from official sheet + CSS:

```bash
python3 scripts/build-sprite-atlas.py \
  --sheet sprite-sheet-handoff/sprite_sheet.png \
  --css sprite-sheet-handoff/sprite_poke.css \
  --delete-legacy-pngs
```

`recognize.ts` loads every atlas entry via `loadPreviewThumbTemplates()` (one sheet decode).

Acceptance:
- fixtures `live-latest` (= test-1) plus test-2～4 → `python3 scripts/match-test-fixtures.py` / `node scripts/match-recognize-browser.mjs`
  - **wrong species count = 0** (null/未識別 OK; never return a wrong id)
  - Results: `docs/match-test-fixtures-results.md`

## Type / Tera icons

18 type icons live in `public/types/` as SVG with stable English filenames (`fire.svg`, `water.svg`, …; legacy PNGs retained). Mapping (繁中 ↔ id ↔ URL) is in `src/lib/typeIcons.ts` via `import.meta.env.BASE_URL + 'types/{id}.svg'`. PokemonCard species badges, move buttons, and weakness rows use these icons. Green debug frame uses `PANEL_OUTER_MARGIN_FRAC` outside the locked pitch panel so yellow/recognition stay unshifted.

## Layout

1. Left my team / 2. Capture preview / 3. Speed axis / 4. Enemy panel (2×3 compact grid)

## Out of scope

Cloud vision / memory read / full dex / live championsbattledata scrape / release pipeline.

Pokemon trademarks belong to their owners; unaffiliated project.

## CBD templates (optional secondary)

Champions Battle Data menu sprites can be fetched **only** for a small allowlist (never whole-dex).
Default `--allowlist` = top-50 CBD Doubles ∪ seed ∪ test-fixture species (max 64 / run):

```bash
node scripts/fetch-cbd-templates.mjs --allowlist
node scripts/fetch-cbd-templates.mjs --ids=noivern,lycanroc
```

- Output: `assets/templates/preview-thumbs/{showdownId}.png` + `manifest.jsonl` (`source: cbd`)
- PNGs are gitignored; see `assets/CREDITS.md`
- **Recognition default** remains `public/sprites/` sheet crops (`nationalDex` keys); CBD only fills gaps
- CBD menu-style art often mismatches Team Preview thumbs — keep as optional secondary
- Never HOME / official-artwork; atlas is the 262 Champions legal allowlist

Offline match:

```bash
python scripts/match-seed-templates.py                        # 圖二 ~6/6
/workspace/.venv-pkmn/bin/python scripts/match-test-fixtures.py  # live-latest only → docs/match-test-fixtures-results.md
```

Results: `docs/match-seed-results.md`

## Pokémon data JSON (PokéAPI + CBD allowlist)

Offline species / move tables live under `data/` (mirrored to `public/data/` for the web app):

| File | Contents |
|------|--------|
| `data/allowlist.json` | Champions `showdownId` allowlist (start small; expand here) |
| `data/pokemon.json` | One record per allowlisted id: `nationalDex`, names `en` / `zh-Hant` / `ja`, classic base stats, types, abilities, `forms[]` (Mega / regional); optional `vgcDoublesMoves` (CBD VGC Doubles usage %) |
| `data/moves.json` | Moves referenced by allowlisted Pokémon (localized names + combat fields + flavor `en` / `zh-Hant` / `ja`) |
| `data/meta.json` | `schemaVersion`, `generatedAt`, `sources`, `pokemonCount`, `movesCount` |

Locale keys are exactly `en` / `zh-Hant` / `ja` (PokéAPI `zh-hant` ‒ `zh-Hant`). Base stats are **classic PokéAPI** values, not CBD screen-scaled numbers. See `assets/CREDITS.md`.

### Expand the allowlist

1. Prefer refreshing from CBD Doubles rankings (top 50+):

```bash
node scripts/build-pokemon-data.mjs --update-allowlist --top=50
```

   Or edit `data/allowlist.json` manually ‒ add Showdown / CBD ids (e.g. `"landorus-therian"`).
2. Regenerate locally or via Actions (below).
3. Prefer small batches; the build script rate-limits PokéAPI / CBD.

Form mapping notes (best-effort): `lycanroc` ‒ lycanroc-midday; `rotom` ‒ base form. Override map lives in `scripts/build-pokemon-data.mjs` (`SHIWDOWN_OVERRIDES`).

### Run locally

```bash
npm run build:pokemon-data
# daily usage/items/Mega refresh without a full PokéAPI species crawl:
npm run build:pokemon-data:usage
npm run build:pokemon-data:flavor
# or
node scripts/build-pokemon-data.mjs
node scripts/build-pokemon-data.mjs --usage-only
node scripts/build-pokemon-data.mjs --allowlist=data/allowlist.json
node scripts/build-pokemon-data.mjs --dry-run
```

Writes both `data/*` and `public/data/*`. The app loads `public/data/pokemon.json` + `moves.json` on boot (`loadGeneratedSpeciesData` / `loadMovesData`) for 繁中 names/stats and CBD Doubles move usage (missing → 未載入).

### GitHub Actions

Workflow lives in the acg-tools monorepo root: `.github/workflows/build-pokemon-data.yml` (this folder no longer has its own `.github/workflows`; GitHub only runs workflows from the repository root). It checks out the monorepo, runs the data script with working directory `apps/champions`, refreshes hub `data/names.json`, then dispatches root `.github/workflows/pages.yml`.

- Triggers: `workflow_dispatch` + **daily** cron (`0 16 * * *` UTC = 00:00 HKT)
- Runs `node scripts/build-pokemon-data.mjs --usage-only`
- Uploads a `pokemon-data` artifact
- Commits updated JSON to `main` as `github-actions[bot]` when `contents: write` is allowed
- On a successful data commit, **explicitly dispatches** `.github/workflows/pages.yml` via `actions/github-script` → `actions.createWorkflowDispatch` (`workflow_id: pages.yml`, `ref: main`).
- Why: `pages.yml` already has `on: push` to `main`, but commits from `github-actions[bot]` using the default `GITHUB_TOKEN` **do not start subsequent `push` workflows**. That is why `usageUpdatedAt` could be **2026-09-16** on `main` while Pages last deployed **2026-09-12**. GitHub still allows that token to create `workflow_dispatch` / `repository_dispatch` runs, so no fine-grained PAT is required.

The UI reads the deployed `public/data/meta.json` via `loadMovesData()` (`usageUpdatedAt` / `usageSourceLabel`) — it does not hardcode the date.

If the commit step fails (branch protection / missing permission), download the artifact and copy into `data/` + `public/data/` manually. Merging this PR to `main` deploys Pages via `on: push` with the current meta; the next successful daily cron will commit CBD usage and dispatch Pages again.
