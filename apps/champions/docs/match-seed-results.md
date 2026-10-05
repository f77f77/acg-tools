# Seed template match results

- Fixture: `public/fixtures/team-preview.png` (圖二)
- Templates: `public/templates/*.png` (ROI Doc v1.2 crops, `source: roi-crop`)
- Matcher: NCC×0.55 + SSD×0.25 + aHash×0.20 (same weights as `recognize.ts`)
- Threshold: 0.55
- **Accuracy: 6/6**

| slot | expected | matched | confidence | ok |
|------|----------|---------|------------|----|
| 0 | noivern | noivern | 1.0000 | Y |
| 1 | lycanroc | lycanroc | 1.0000 | Y |
| 2 | politoed | politoed | 1.0000 | Y |
| 3 | rotom | rotom | 1.0000 | Y |
| 4 | kangaskhan | kangaskhan | 1.0000 | Y |
| 5 | hippowdon | hippowdon | 1.0000 | Y |

## Notes

- Prefer **ROI-crop** seeds in `public/templates/` for Team Preview recognition.
- CBD menu sprites under `assets/templates/preview-thumbs/` (`source: cbd`) are optional secondary;
  menu-style art often does **not** match Team Preview thumbs well — do not use as primary matcher.
- Never bulk-download the dex; use `scripts/fetch-cbd-templates.mjs --allowlist` / `--ids=...` only.
