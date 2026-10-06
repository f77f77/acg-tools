# Hub JSON

頁面由 `modules.js` 讀呢個目錄。Champions 辨認資料喺 `apps/champions/data/`，唔好同呢度混。

## `names.json`（`names.v1`）

中日英對照。由 Champions allowlist 生成：

```bash
node scripts/build_names_index.mjs           # 沿用上一份已抓到嘅特性／道具譯名
node scripts/build_names_index.mjs --fetch   # 再向 PokéAPI 補特性、道具嘅 en／zh-Hant／ja
```

每日 `Build Pokémon data` workflow 會跑唔帶 `--fetch` 嘅版本，好讓招式同寶可夢名稱跟住 allowlist 走。

| 欄位 | 說明 |
| --- | --- |
| `kind` | `pokemon` / `move` / `ability` / `item` |
| `id` | Showdown id、招式 id、特性 slug 或道具 slug |
| `zh` / `ja` / `en` | 顯示名。空字串代表未有譯名 |
| `dex` | 只有寶可夢先有全國圖鑑編號 |

## `codes.json`（`codes.v1`）

| 欄位 | 說明 |
| --- | --- |
| `code` | 配送碼 |
| `contentZh` | 繁中內容 |
| `games` | 字串陣列，每項要喺 `gamesCatalog` 出現 |
| `expires` | `YYYY-MM-DD` 或 `null`（未公開到期日） |
| `status` | `active` 或 `expired`。就算寫 active，只要 `expires` 早過今日，畫面都會當已過期 |
| `source` | 核對用連結 |
| `gamesCatalog` | 遊戲篩選清單。某個遊戲可以暫時冇任何代碼；畫面會顯示「暫未有公開配送碼」 |

`scripts/refresh_codes_stub.py` 只檢查 schema，未接遠端抓取。畫面預設收起已過期，並以遊戲徽章篩選。

## `events.json`（`events.v1`）

`events[]`：`id`, `title`, `date`, `endDate`, `place`, `ticketUrl`, `source`, `sample`，可選 `address`, `mapUrl`

`deadlines[]`：`id`, `ip`, `item`, `shop`, `deadline`, `url`, `sample`，可選 `place`, `address`, `mapUrl`

日期用 `YYYY-MM-DD`。`sample: true` 會標成示例。篩選用瀏覽器本地日期：即將舉行（未結束）、本週（星期一至日，而且未結束）、已結束。`.ics` 只匯出未結束嘅活動同截止。

地點會開新分頁去 Google 地圖搜尋。活動列用 `place`（有 `address` 就一併放進搜尋字）。周邊截止要有 `place`、`address` 或 `mapUrl` 先會把商店名連出去；得返商店名就當未有實體地址。`mapUrl` 如果係 `http`／`https`，會蓋過自動組出嚟嘅搜尋連結。

## `anime-subs.json`（`anime-subs.v1`）

呢份係新番表嘅中文字幕疊加，唔再係側欄獨立頁。`#anime` 會轉去 `#season/zh`（只顯示有中文字幕）。

每日由 `scripts/sync_anime_subs.py` 從 Notion 資料庫「中文字幕動畫播放表」寫入。未跑到同步之前，檔案可以仍然係 `sample: true` 嘅種子；同步成功之後會換成 `sample: false` 嘅真資料。`scripts/refresh_anime_stub.py` 只檢查 schema，唔會打 Notion。

| 欄位 | 說明 |
| --- | --- |
| `title` / `titleJa` | 標題。`作品` 用全形斜線 `／` 拆開：左邊日文、右邊中文；冇斜線就兩邊都用全名 |
| `aliases` | 上面兩截。畫面對題目時會一併用 |
| `bgmId` | Bangumi subject id。對到先有 |
| `bgmIdSource` | `notion` / `url` / `season` / `search` / `none` |
| `platforms` | `平台`。空白就寫 `待核對` |
| `subtitle` | `字幕`，例如 `繁中` |
| `regionNote` | `地區`。`備註` 若果唔長過 40 字，會用 ` · ` 駁埋 |
| `scheduleHkt` | `每週更新時間（HKT）` |
| `premiere` | `首播日期`（`YYYY-MM-DD`） |
| `status` | `狀態`：播放中 / 即將播出 / 追蹤中 / 已完結 |
| `source` | `官方來源連結`。Notion 頁面網址唔公開，冇官方連結就唔寫 |
| `notionId` | Notion page id |
| `sample` | 同步列係 `false`。`true` 先會標「樣本」 |
| `unresolved` | 檔案頂層。對唔到 `bgmId` 嘅作品，等你返 Notion 手填 |

畫面先用 `bgmId` 對 `season.json` 嘅 `id`，再用正規化標題。對唔上嘅列會附加在「未收錄於本季 Bangumi 表」。新番表會顯示「字幕資料更新：YYYY-MM-DD」；`unresolved` 唔空就摺起列出要補 `bgmId` 嘅作品。平台、狀態、檔期、地區、來源連結都會畫喺卡片上。來源連結色係 `--link`（`#8ab4f8`）。

### 點對 `bgmId`

1. Notion 欄位 `bgmId`（你手填，永遠優先）
2. `官方來源連結` 入面嘅 `bgm.tv/subject/數字`
3. 標題／別名同 `season.json` 嘅 `name`、`name_cn` 正規化之後全等：NFKC、小寫、繁轉簡（同 `modules.js` 嗰份字表）、`第N期`／`第N季`／`Season N` 收成同一個季號、再去掉空白同標點
4. Bangumi `POST https://api.bgm.tv/v0/search/subjects`（`type=2` 動畫，User-Agent `f77f77/acg-tools`）。只收有信心嘅結果：正規化之後 `name` 或 `name_cn` 全等，或者成個搜尋得一個結果而且開播日同 `首播日期` 相差大約一年以內
5. 都唔得就 `bgmIdSource: none`，並寫入 `unresolved`

搜尋結果會記喺 `data/anime-bgm-cache.json`，同一條標題唔會日日再搜。對到嘅 id 會一直用；對唔到嘅七日之後先再試。改標題、刪咗快取入面嗰條，或者直接喺 Notion 填 `bgmId`，都會再對過。`已完結` 唔會入表，除非對到嘅 id 仍然喺今季 `season.json`。

### 密鑰同 Notion 整合

Workflow：`.github/workflows/sync-anime-subs.yml`，每日 **06:17 香港時間**（UTC 22:17），喺 `season.json` 00:15 更新之後。亦可以手動 `workflow_dispatch`。有改動先 commit `data/anime-subs.json` 同快取，再觸發 Pages。

| Secret | 必填 | 值 |
| --- | --- | --- |
| `NOTION_TOKEN` | 要 | Internal integration secret |
| `NOTION_ANIME_DB_ID` | 唔使 | 資料庫 id，預設 `80d65f30-2ea5-42f0-a11f-24f1f6d5f883` |

資料庫「中文字幕動畫播放表」。Data source（collection）id：`f97f3175-feef-4ebe-a82d-d5c94bcb0e2c`（腳本用 2022-06-28 嘅 `POST /v1/databases/{id}/query`，唔使額外傳 data source id）。

建立整合並授權呢個資料庫：

1. Notion → **Settings → Connections**（或者 [developers integrations](https://www.notion.so/my-integrations)）→ **New integration**，類型選 internal。
2. 權限至少要讀內容。複製 secret（`secret_…` 或 `ntn_…`）。
3. 打開「中文字幕動畫播放表」→ 右上角 **…** → **Connections** → 加入呢個 integration。
4. GitHub repo → **Settings → Secrets and variables → Actions** → **New repository secret**。名 `NOTION_TOKEN`，值貼 secret。資料庫 id 唔係預設嗰個先再加 `NOTION_ANIME_DB_ID`。

冇 `NOTION_TOKEN` 時腳本會印說明並以 exit 0 結束，唔會改檔，所以 fork 同 PR CI 唔會因此失敗。

本地用 fixture 跑完整對應（唔打 Notion、唔打 Bangumi）：

```bash
python3 scripts/sync_anime_subs.py \
  --fixture scripts/fixtures/notion_query_sample.json \
  --season scripts/fixtures/season_sample.json \
  --offline --check \
  --out /tmp/anime-subs-fixture.json \
  --cache /tmp/anime-bgm-cache-fixture.json
```

## `subscriptions.json`（`subscriptions.v1`）

| 欄位 | 說明 |
| --- | --- |
| `name` | 名稱 |
| `amount` | 數字 |
| `currency` | 例如 `HKD` |
| `interval` | `month`（預設）、`year`（計入每月約計時 ÷ 12）、`week` |
| `nextRenew` | `YYYY-MM-DD` |
| `notes` | 備註 |
| `category` | `warehouse` 會顯示倉租倒數 |
| `example` | `true` 就標成示例。唔好寫真實私人金額當事實 |

現有列全部係示例。
