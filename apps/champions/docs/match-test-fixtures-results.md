# Test fixture match results

- Fixtures: live-latest + test-1~4 (`test-1` == live-latest bytes)
- Templates: `public/sprites/sprite_poke.png` + `atlas.json` (nationalDex-keyed in-memory crops; 262 cells / 262 ids)
- Matcher: crop cleanup (right 0.05) + BG suppress + content-aware recenter + aHash prefilter + multi-scale/shift; NCC×0.55 + SSD×0.25 + aHash×0.20
- Guards (v1.4): `CONFIDENCE_THRESHOLD=0.54`, `dyn ≥0.75→0.025 / ≥0.68→0.03 / ≥0.60→0.05 / ≥0.54→0.055 / else 0.08`, coarse hue ×0.85 if hist-dist>0.75, type **hard** gate (thr=0.58; skip if low-conf), aHash top40|ham≤18
- Mask: template alpha ∩ query non-black
- Scales: `[0.9, 1.0, 1.1, 1.2, 1.35, 1.55]`; shifts: `[-8, -4, 0, 4, 8]`
- ROI Doc: v1.3-square-thumb (panel/thumb/CARD_GAP **locked** — prefer null over wrong species)
- **Overall: correct 29/30, wrong species 0, null 1**

## team-preview-live-latest

**Accuracy: 6/6** (wrong=0, null=0)

| slot | expected | matched | confidence | margin | need | types | reason | ok |
|------|----------|---------|------------|--------|------|-------|--------|----|
| 0 | froslass | froslass | 0.7486 | 0.1917 | 0.0300 | ice | ok | Y |
| 1 | garchomp | garchomp | 0.8029 | 0.2099 | 0.0250 | - | ok | Y |
| 2 | basculegion | basculegion | 0.8080 | 0.1974 | 0.0250 | water | ok | Y |
| 3 | kingambit | kingambit | 0.7563 | 0.1735 | 0.0250 | - | ok | Y |
| 4 | sneasler | sneasler | 0.8400 | 0.1812 | 0.0250 | - | ok | Y |
| 5 | golisopod | golisopod | 0.9143 | 0.3291 | 0.0250 | water | ok | Y |

## team-preview-test-1

**Accuracy: 6/6** (wrong=0, null=0)

| slot | expected | matched | confidence | margin | need | types | reason | ok |
|------|----------|---------|------------|--------|------|-------|--------|----|
| 0 | froslass | froslass | 0.7486 | 0.1917 | 0.0300 | ice | ok | Y |
| 1 | garchomp | garchomp | 0.8029 | 0.2099 | 0.0250 | - | ok | Y |
| 2 | basculegion | basculegion | 0.8080 | 0.1974 | 0.0250 | water | ok | Y |
| 3 | kingambit | kingambit | 0.7563 | 0.1735 | 0.0250 | - | ok | Y |
| 4 | sneasler | sneasler | 0.8400 | 0.1812 | 0.0250 | - | ok | Y |
| 5 | golisopod | golisopod | 0.9143 | 0.3291 | 0.0250 | water | ok | Y |

## team-preview-test-2

**Accuracy: 5/6** (wrong=0, null=1)

| slot | expected | matched | confidence | margin | need | types | reason | ok |
|------|----------|---------|------------|--------|------|-------|--------|----|
| 0 | chesnaught | chesnaught | 0.7826 | 0.2354 | 0.0250 | - | ok | Y |
| 1 | mimikyu | mimikyu | 0.5877 | 0.5877 | 0.0550 | - | ok | Y |
| 2 | ninetalesalola | ninetalesalola | 0.8898 | 0.2852 | 0.0250 | - | ok | Y |
| 3 | swampert | swampert | 0.8793 | 0.2355 | 0.0250 | water | ok | Y |
| 4 | typhlosionhisui | typhlosionhisui | 0.8474 | 0.2209 | 0.0250 | fire | ok | Y |
| 5 | greninja | None | 0.5802 | 0.0351 | 0.0550 | water | MARGIN_TOO_SMALL | N |

## team-preview-test-3

**Accuracy: 6/6** (wrong=0, null=0)

| slot | expected | matched | confidence | margin | need | types | reason | ok |
|------|----------|---------|------------|--------|------|-------|--------|----|
| 0 | slowbrogalar | slowbrogalar | 0.7644 | 0.1060 | 0.0250 | - | ok | Y |
| 1 | scizor | scizor | 0.7307 | 0.2379 | 0.0300 | - | ok | Y |
| 2 | eelektross | eelektross | 0.8250 | 0.2576 | 0.0250 | electric | ok | Y |
| 3 | salamence | salamence | 0.8499 | 0.2245 | 0.0250 | - | ok | Y |
| 4 | rotomwash | rotomwash | 0.8445 | 0.2521 | 0.0250 | electric,water | ok | Y |
| 5 | gallade | gallade | 0.8530 | 0.2498 | 0.0250 | - | ok | Y |

## team-preview-test-4

**Accuracy: 6/6** (wrong=0, null=0)

| slot | expected | matched | confidence | margin | need | types | reason | ok |
|------|----------|---------|------------|--------|------|-------|--------|----|
| 0 | salamence | salamence | 0.7532 | 0.2002 | 0.0250 | flying | ok | Y |
| 1 | rillaboom | rillaboom | 0.7755 | 0.1919 | 0.0250 | - | ok | Y |
| 2 | kingambit | kingambit | 0.7568 | 0.1293 | 0.0250 | - | ok | Y |
| 3 | sylveon | sylveon | 0.6358 | 0.0038 | 0.0500 | - | ok | Y |
| 4 | rotomwash | rotomwash | 0.8442 | 0.2436 | 0.0250 | electric,water | ok | Y |
| 5 | sneasler | sneasler | 0.8412 | 0.1744 | 0.0250 | - | ok | Y |

## Misses / unidentified

- `team-preview-test-2` slot 5: expected **greninja**, matched **None** (0.580, margin=0.035, need=0.055, types=['water'], MARGIN_TOO_SMALL) [null]

## Notes

- ENEMY_PANEL / THUMB_CROP / CARD_GAP_FRAC / yellow square geometry **unchanged**.
- Prefer `speciesId=null` (未識別) over wrong-species false positives.
- Type hard second gate: uncertain/low-conf type OCR → no veto; when types known (score≥0.58), candidate types from `pokemon.json` must be a **superset** of detected set (e.g. Flying → reject Incineroar).
- aHash TopK=40 (fixture-tuned; prefer null over wrong species).
- Dynamic margin: dyn ≥0.75→0.025 / ≥0.68→0.03 / ≥0.60→0.05 / ≥0.54→0.055 / else 0.08.
- Match-crop cleanup: zero right 0.05 of yellow (type bleed); type icons still read from card top-right.
- Coarse hue filter is conservative (×0.85) so shinies without shiny templates are not hard-killed.
- `recognize.ts` mirrors this pipeline (`cardRect` → type crop + `thumbRectInSlot` match).
- Result: **correct 29/30, wrong=0, null=1**.
- Atlas: official full-roster `sprite_sheet.png` + `sprite_poke.css` → 262 dex-keyed in-memory crops (no per-species PNG dump).
- Formal fixtures: `team-preview-live-latest.jpg` (= test-1) plus test-2~4. live-latest enemy: Froslass, Garchomp, Basculegion-M, Kingambit, Sneasler, Golisopod. test-2: Chesnaught, Mimikyu, Alolan Ninetales, Swampert, Hisuian Typhlosion, Greninja. test-4: Salamence, Rillaboom, Kingambit, Sylveon, Rotom-Wash, Sneasler.
- Legal roster counts: atlas cells=262, allowlist=262, pokemon.json=262.
- Enemy/ally form selector uses sibling legal forms grouped by nationalDex (regional / gender / Rotom; Mega when present in the 262).
