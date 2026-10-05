# Legal allowlist → Showdown mapping

Generated/updated for Champions legal list (`data/legal-allowlist.json`).

- Mapped: **262** / 262
- Unique showdownIds: **262**
- Unmapped: **0**
- Method: Champions `form` → PokéAPI `pokemon-form.form_order - 1`; Gmax skipped
- Showdown/CBD ids: explicit map for regional / gender / cosmetic forms; hyphen-strip fallback

## Notes

- CBD index coverage is a subset (~230); species without CBD rows still get PokéAPI stats/types; usage UI shows 未載入.
- `maushold` (family-of-four) uses CBD id `maushold` (not `mausholdfour`).
- `floette` maps to Eternal Flower (`floette-eternal`).
- `vivillonfancy` is Champions form 18 (Fancy pattern).
- Cosmetic defaults: `mimikyu` (disguised), `aegislash` (shield), `morpeko` (full belly), `palafin` (zero), `pyroar` (male).

## Refresh

```bash
node scripts/map-legal-allowlist.mjs
# then normalize/edge-case map is in script; rebuild:
node scripts/build-pokemon-data.mjs
```

See `data/allowlist.json` `entries[]` for full id → showdownId table.
