# Team Preview fixtures

Formal recognition inputs are **raw 16:9 Team Preview screenshots**, not screenshots of this app.

| File | Enemy (top→bottom) |
|------|--------|
| `team-preview-live-latest.jpg` | Froslass, Garchomp, Basculegion-M, Kingambit, Sneasler, Golisopod |
| `team-preview-test-1.jpg` | Same bytes as live-latest |
| `team-preview-test-2.jpg` | Chesnaught, Mimikyu, Alolan Ninetales, Swampert, Hisuian Typhlosion, Greninja |
| `team-preview-test-3.jpg` | Galarian Slowbro, Scizor, Eelektross, Salamence, Rotom-Wash, Gallade |
| `team-preview-test-4.jpg` | Salamence, Rillaboom, Kingambit, Sylveon, Rotom-Wash, Sneasler |

「載入測試圖」按鈕會依序循環 test-1～4。`live-latest` remains the formal Pages fixture (same image as test-1).

Reproduce with the **browser** path (same `recognize.ts` as GitHub Pages), not only Python:

```bash
npx vite --port 5173
node scripts/match-recognize-browser.mjs
```

`getUserMedia` and 「載入測試圖」 both call `recognizeEnemyTeamFromCanvas`.
