# ACG Tools

個人工具 monorepo。GitHub Pages 專案站：<https://f77f77.github.io/acg-tools/>

| 路徑 | 內容 |
| --- | --- |
| `/` | Hub（靜態頁，有密碼閘） |
| `/champions/` | Pokémon Champions 對戰助手（Vite 建置；網址係 `…/acg-tools/champions/`） |

密碼閘只包住 hub。`/champions/` 同而家嘅對戰助手一樣，唔經呢道閘。

獨立 repo [pokemon-champions-assistant](https://github.com/f77f77/pokemon-champions-assistant) 暫時保留，之後先會封存。呢次搬遷唔會刪除嗰個 remote。

## 目錄

```
.
├── index.html, app.js, app-extra.js, modules.js, *.css, season.json
├── data/                          hub 模組 JSON（名稱、配送碼、活動、字幕、訂閱）
├── scripts/
│   ├── update_season.py           Bangumi → season.json（原有）
│   ├── build-pages.sh             hub + champions → dist/
│   ├── build_names_index.mjs      Champions 資料 → data/names.json
│   ├── refresh_codes_stub.py      只驗證 codes schema（含 gamesCatalog）
│   └── refresh_anime_stub.py      只驗證 anime-subs schema（新番表疊加）
└── apps/champions/                原 pokemon-champions-assistant（src、public、electron、scripts）
```

辨認用 ROI 同 wrong=0 規則留喺 `apps/champions/`，呢次冇改。

## 本地

Hub（repo 根目錄）：

```bash
python3 -m http.server 8080
# http://localhost:8080/
```

對戰助手：

```bash
cd apps/champions
npm install
npm run dev          # http://localhost:5173/  （base 係 /，方便 Electron）
npm run electron:dev
```

Pages 成品（`dist/` 唔會提交）：

```bash
bash scripts/build-pages.sh
# dist/index.html                 hub
# dist/champions/index.html       Vite base /acg-tools/champions/
```

`apps/champions` 入面 `npm run build` 預設都係 Pages base。`npm run electron:build` 會改用 `VITE_BASE=./`，打包後先可以用 `file://` 開。

側欄「對戰助手」連去相對路徑 `champions/`。本地只開 hub 靜態伺服器時，要先跑過 `build-pages.sh` 再由 `dist/` 開，或者直接用上面嘅 Vite。

## Pages

合併之後，到 repo **Settings → Pages → Build and deployment**，將 Source 由「Deploy from a branch」改做 **GitHub Actions**（workflow：`Deploy GitHub Pages`）。未改之前，main 仍然用分支部署，hub 更新會上線，但 `/champions/` 未係 Vite 成品。

| 網址 | 檔案 |
| --- | --- |
| `https://f77f77.github.io/acg-tools/` | `dist/` 根（hub） |
| `https://f77f77.github.io/acg-tools/champions/` | `dist/champions/` |

Vite `base` 係 `/acg-tools/champions/`，因為專案站本身已經帶 `/acg-tools/`。

## 自動同種子

| 資料 | 點更新 |
| --- | --- |
| `season.json` | 原有 `.github/workflows/update-season.yml`，每日 Bangumi |
| Champions 用法 JSON、`data/names.json` 嘅招式／寶可夢名 | `.github/workflows/build-pokemon-data.yml`（路徑已改到 `apps/champions`）。名稱索引唔會打 PokéAPI；特性同道具日文要本地 `node scripts/build_names_index.mjs --fetch` |
| 配送碼、字幕疊加 | 種子 JSON。`.github/workflows/hub-seeds.yml` 每週只做 schema 檢查，未有抓取。字幕表併入新番表 |
| 香港活動、訂閱 | 種子／示例 JSON，手改 `data/`。訂閱金額全部標成示例 |

Schema 見 [data/README.md](data/README.md)。

## Hub 側欄

分三組，組名可以摺起（狀態記喺呢部瀏覽器）：

| 組 | 項目 |
| --- | --- |
| 動畫／ACG | 新番表（Bangumi，中文字幕疊加喺同一頁）、香港活動看板（活動＋周邊截止） |
| Pokémon | 中日英名稱、Mystery Gift／配送碼、對戰助手（`./champions/`，新分頁） |
| 生活工具 | 生詞本、匯率、訂閱／續費 |

深連結用 hash：`#vocab` `#season` `#fx` `#names` `#codes` `#events` `#events/deadlines` `#subs`。舊嘅 `#anime` 會轉去 `#season/zh`（新番表並且只顯示有中文字幕）。

## Hub 版本

- **1.2**（2026-10-06）：深色主題連結改為可讀淺藍色，懸停才加底線；側欄圖示固定寬度對齊，對戰助手改用 ⚔️。
- **1.1**（2026-10-06）：側欄分組；新番表合併中文字幕；配送碼加入寶可夢 Champions；活動同周邊地點連到 Google 地圖。
- **1.0**：Monorepo hub，五個資料模組同密碼閘。
