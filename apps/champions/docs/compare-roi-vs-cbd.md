# ROI-only vs CBD-only accuracy (Team Preview fixtures)

Formal fixture is now `public/fixtures/team-preview-live-latest.jpg` only; the old
`team-preview-test-1/2.png` files were removed. The table below is a historical
ROI-vs-CBD comparison from those retired screenshots.

## Summary

| Library | Accuracy | Templates | Distinct speciesIds |
|---------|----------|-----------|---------------------|
| ROI-only (`public/templates/`, source roi-crop) | **12/12** | 18 | 17 |
| CBD-only (`assets/templates/preview-thumbs/`, source cbd) | **1/12** | 56 | 56 |

**Verdict: CBD clearly worse**

CBD-only scored 1/12 vs ROI-only 12/12 (11 fewer correct). CBD gap-fill is NOT worth using as primary; keep ROI crops as recognition default.

### Per-fixture

| Fixture | ROI | CBD |
|---------|-----|-----|
| team-preview-test-1 | 6/6 | 0/6 |
| team-preview-test-2 | 6/6 | 1/6 |

## Matcher (locked)

- ROI Doc v1.2: ENEMY_PANEL left 0.811 top 0.143 right 0.965 bottom 0.832
- THUMB_CROP left 0.20 right 0.55 topInset 0.25 bottomInset 0.05; TEMPLATE_SIZE 64
- Score: NCC×0.55 + SSD×0.25 + aHash×0.20; threshold 0.55
- Same crop path for both libraries (fixture slot → gray/hash → best template)
- ROI constants **not** changed

## Per-slot comparison

| fixture | slot | expected | ROI match | ROI conf | CBD match | CBD conf | ROI ok | CBD ok |
|---------|------|----------|-----------|----------|-----------|----------|--------|--------|
| team-preview-test-1 | 0 | gengar | gengar | 1.0000 | kangaskhan | 0.6155 | Y | N |
| team-preview-test-1 | 1 | sableye | sableye | 1.0000 | gengar | 0.5602 | Y | N |
| team-preview-test-1 | 2 | zoroark | zoroark | 1.0000 | kangaskhan | 0.5057 | Y | N |
| team-preview-test-1 | 3 | basculegion | basculegion | 1.0000 | kangaskhan | 0.6194 | Y | N |
| team-preview-test-1 | 4 | annihilape | annihilape | 1.0000 | kangaskhan | 0.5673 | Y | N |
| team-preview-test-1 | 5 | sinistcha | sinistcha | 1.0000 | annihilape | 0.5296 | Y | N |
| team-preview-test-2 | 0 | charizard | charizard | 1.0000 | gengar | 0.5608 | Y | N |
| team-preview-test-2 | 1 | bellibolt | bellibolt | 1.0000 | kangaskhan | 0.5238 | Y | N |
| team-preview-test-2 | 2 | scovillain | scovillain | 1.0000 | garchomp | 0.4019 | Y | N |
| team-preview-test-2 | 3 | archaludon | archaludon | 1.0000 | archaludon | 0.5821 | Y | Y |
| team-preview-test-2 | 4 | blastoise | blastoise | 1.0000 | blastoise | 0.5207 | Y | N |
| team-preview-test-2 | 5 | sableye | sableye | 1.0000 | garchomp | 0.4889 | Y | N |

## ROI library coverage vs top-50 allowlist

- Distinct ROI species in `public/templates/`: **17**
- Top-50 allowlist (`data/allowlist.json` showdownIds): **50**
- Allowlist ids **missing** from ROI library: **39**

### Top-50 showdownIds missing from ROI (gap list)

Do **not** invent crops. Prefer future ROI crops from real Team Preview captures.

1. `kingambit`
2. `garchomp`
3. `sneasler`
4. `whimsicott`
5. `incineroar`
6. `farigiraf`
7. `staraptor`
8. `sylveon`
9. `raichu`
10. `tyranitar`
11. `pelipper`
12. `milotic`
13. `aerodactyl`
14. `venusaur`
15. `froslass`
16. `swampert`
17. `delphox`
18. `dragonite`
19. `gholdengo`
20. `grimmsnarl`
21. `torkoal`
22. `floette`
23. `mausholdfour`
24. `ninetalesalola`
25. `excadrill`
26. `glimmora`
27. `metagross`
28. `arcaninehisui`
29. `talonflame`
30. `mawile`
31. `scizor`
32. `rotomwash`
33. `tsareena`
34. `primarina`
35. `kommoo`
36. `corviknight`
37. `gardevoir`
38. `meowscarada`
39. `blaziken`

## Notes

- Do **not** put CBD into `public/templates/` as primary recognition library.
- CBD menu sprites remain optional secondary / gap-fill only if ROI coverage is incomplete.
- Script: `scripts/compare-roi-vs-cbd.py` (`--library=roi|cbd|both`).
