# Sprite sheet templates (nationalDex keys)

Recognition loads **one** master sheet and crops cells in memory.

| File | Role |
|------|------|
| `sprite_poke.png` | Master sheet (128×128 cells; official Champions sheet 2208×2078, black-bg, 262 allowlisted cells) |
| `sprite_poke.css` | `background-size` / `background-position` per dex+form |
| `atlas.json` | Parsed dex → `{x,y,w,h}` + showdownId / types |

Primary key = `nationalDex` (`6`) or `nationalDex-form` (`38-1`). Named aliases such as `6-mega-x` / `38-alola` live on `dexAliases`.

Do **not** explode this sheet into per-species PNG files.

Rebuild / ingest an official sheet:

```bash
python3 scripts/build-sprite-atlas.py --sheet path/to/sprite_sheet.png --css path/to/sprite_poke.css --delete-legacy-pngs
```

Drop-in search paths (sheet + CSS together): `sprite-sheet-handoff/`, repo root (`official-sprite-poke-3-channel.png` + `champ-sprite_poke_3.css`).
