# Asset credits

## Champions Battle Data (CBD) sprites

- Site / API: https://championsbattledata.com/
- API guide: https://championsbattledata.com/api_guide
- Downloaded via `scripts/fetch-cbd-templates.mjs` into `assets/templates/preview-thumbs/`
- Paths: `pokemon_champions_assets/pokemon/{SavedName}.png`
- These are **menu-style** sprites. Prefer `public/sprites/` sheet crops (nationalDex keys) for Team Preview recognition.
- PNG binaries under `assets/templates/preview-thumbs/` are **gitignored** (re-fetch with the script). Keep `manifest.jsonl` + this CREDITS file in git.
- Do **not** pull Pokémon HOME art or PokéAPI `official-artwork`.

## Sprite sheet Team Preview thumbs

- Master sheet + CSS: `public/sprites/sprite_poke.png`, `sprite_poke.css`
- Parsed map: `public/sprites/atlas.json` (primary key = `nationalDex` / form)
- Runtime: in-memory cell crops — no per-species PNG dump
- Rebuild: `python3 scripts/build-sprite-atlas.py`
- Pokémon images © The Pokémon Company / Nintendo / Game Freak; fan-project local matching only

## PokéAPI species / move data

- API: https://pokeapi.co/ (https://pokeapi.co/api/v2)
- Used by `scripts/build-pokemon-data.mjs` for:
  - Localized names: English (`en`), Traditional Chinese (`zh-hant` → `zh-Hant`), Japanese (`ja`)
  - National Pokédex number (`pokemon-species.id` → `nationalDex`)
  - Classic base stats, types, abilities per form (`/pokemon/{id}`)
  - Form / Mega varieties (`species.varieties` → `forms[]` on each allowlisted record)
  - Move type / category / power / accuracy / pp (`/move/{id}`)
- Generated outputs (committed for offline use): `data/pokemon.json`, `data/moves.json`, `data/meta.json` (mirrored under `public/data/` for the Vite app)
- Rate-limited politely; do not hammer the public API
- PokéAPI data © respective Pokémon trademark holders; PokéAPI itself is fan-made

## Champions Battle Data (roster allowlist + Doubles usage)

- Index API: https://championsbattledata.com/api/index
  - Refresh top-N Doubles allowlist: `node scripts/build-pokemon-data.mjs --update-allowlist --top=50`
  - Rank = `summary.battleSummary.Current.Doubles.position` (lower = higher usage)
- API: https://championsbattledata.com/api/pokemon/{showdownId}
  - Roster presence (`championsLegal`) + learnable move *names* for `data/allowlist.json`
- Battle API: https://championsbattledata.com/api/battle/Doubles/{showdownId}
  - **VGC Doubles (2v2 / 6-pick-4)** top moves + held items + usage % → `vgcDoublesMoves` / `vgcDoublesItems` on `data/pokemon.json`
  - Sorted **highest usage % first** (CSV `rank` is table column position, not usage order)
  - When Current CSV is missing rank-1 moves (right-column only, e.g. Basculegion-M), the build falls back to the newest complete `?days=7` daily snapshot
  - App resolves zh-Hant names / types via PokéAPI `data/moves.json`; item names via PokéAPI `/item`; never invents learnsets or fake %
  - Mega forms (PokéAPI `*-mega`) are attached as `forms[]` siblings so ally/enemy selectors list Base + Mega
- **Do not** use CBD `summary.primary` / screen-scaled stats as classic base stats — those stay PokéAPI
- No bulk image scrape in the data build path (sprites remain the separate optional `fetch-cbd-templates.mjs` allowlist tool)

## Team Preview test fixtures

- `public/fixtures/team-preview-live-latest.jpg` — sole formal Team Preview capture（最新實機畫面）
- App「載入測試圖」loads this image (ROI Doc remains locked; fixtures only)
