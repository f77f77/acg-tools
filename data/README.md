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

## `subscriptions.enc.json`（`subscriptions-enc.v1`）

訂閱／續費由 `scripts/sync_subscriptions.py` 每日從 Notion 資料庫「訂閱追蹤」同步。Repo 同 GitHub Pages 都係公開，hub 密碼閘只係介面，所以**唔會**把訂閱明文寫入 git、Pages、log 或 Actions 輸出。呢個檔係加密信封；頁面用 WebCrypto 解出嚟先顯示。

而家入庫嘅係**假資料**示例，用測試密碼 `demo-subs` 加密，方便試頁面。第一次正式 workflow 跑完會覆蓋佢。`scripts/fixtures/notion_subs_sample.json` 都係假 fixture，`build-pages.sh` 唔會拷去網站。

舊嘅明文 `data/subscriptions.json` 已刪除，唔好再加返。

### 解密後先有嘅欄位（`subscriptions.v2`）

| 欄位 | 說明 |
| --- | --- |
| `id` | Notion page id 嘅 SHA-256 前 16 個 hex，唔係原本 id |
| `name` | `服務` |
| `plan` | `方案` |
| `amount` | `金額` |
| `currency` | `幣別`，例如 `HKD`／`USD`／`JPY` |
| `hkd` | `約港元`。如果空、而幣別係 HKD，就用金額。否則如果有 `data/rates.json`，用匯率乘金額。計唔到就 `null`，總數會跳過 |
| `interval` | `月` → `month`；`年` → `year`；`月（30日）` → `month30`。`月（推算）` 都係 `month`，另外 `estimated: true` |
| `nextRenew` | `下次續費`（`YYYY-MM-DD`）。狀態係使用中而且日期已過，會按週期順延到今日或之後，並加 `rolled: true` |
| `lastCharged` | `上次扣款` |
| `status` | `使用中`／`不確定`／`已取消` |
| `notes` | `備註`，最多約 80 字。電郵、長數字或訂單號、卡號會剔走 |
| `category` | 名稱或方案有「倉」就標 `warehouse`，畫面顯示倉租倒數 |

年費計每月約計時 ÷ 12。`month30` 當一個月。每年約計係每月 × 12。只計使用中。

以下 Notion 欄位**唔會**讀入輸出：`帳戶`、`付款方式`、`來源信件`、`上次扣款原文`。`下次續費原文` 亦唔公開。

### 加密

`SUBS_PASSPHRASE` → PBKDF2-SHA256（600000 次，隨機 16-byte salt）→ AES-256-GCM（隨機 12-byte IV）。`mac` 係 HMAC-SHA256(衍生 key, 不含 `updatedAt` 嘅明文)，用嚟判斷內容有冇變，避免日日重新加密。`updatedAt` 係香港日期，只有內容變咗先更新。

信封欄位：`schema`、`kdf`（`name`／`hash`／`iterations`／`salt`）、`cipher`（`AES-GCM`、`iv`）、`ciphertext`、`mac`、`updatedAt`。瀏覽器同一套 WebCrypto 解得開。

### 密鑰

| Secret | 必填 | 值 |
| --- | --- | --- |
| `NOTION_TOKEN` | 要 | 同字幕表嗰個 internal integration secret |
| `SUBS_PASSPHRASE` | 要 | 訂閱解密密碼。改咗就要再跑呢個 workflow，舊密碼會開唔到新檔 |
| `NOTION_SUBS_DB_ID` | 唔使 | 資料庫 id，預設 `0a0f4be8-8d57-4970-b3ec-a78d43235188` |

資料庫「訂閱追蹤」。Data source（collection）id：`783d6077-794c-4e0c-8872-986a6734921c`（腳本用 2022-06-28 嘅 `POST /v1/databases/{id}/query`，唔使額外傳 data source id）。

整合要加到呢個資料庫：打開「訂閱追蹤」→ 右上角 **…** → **Connections** → 加入讀字幕表嗰個 integration（至少要讀內容）。

冇 `NOTION_TOKEN` 或 `SUBS_PASSPHRASE` 時腳本印一行說明並以 exit 0 結束，唔改檔。Log 只得行數同跳過數，唔會印訂閱內容。

Workflow：`.github/workflows/sync-subscriptions.yml`，每日 **06:43 香港時間**（UTC 22:43），亦可以手動 `workflow_dispatch`。有改動先 commit `data/subscriptions.enc.json`，訊息係 `chore: sync encrypted subscriptions`，再經 `pages.yml` 嘅 `workflow_run` 重新部署。

頁面「記住呢部機」預設關閉。剔咗先會把密碼放喺呢部瀏覽器嘅 localStorage。「鎖上」會清走。

`data/rates.json` 可選，格式 `{ "rates": { "USD": 7.8, "JPY": 0.052 } }`，數字係 1 單位外幣兌幾多港元。冇呢個檔、又冇 `約港元`、又唔係 HKD，該列就唔會計入港元總數。

本地用假 fixture 做加解密來回（要有 `cryptography` 同 Node）：

```bash
pip install cryptography
SUBS_PASSPHRASE=demo-subs python3 scripts/sync_subscriptions.py \
  --fixture scripts/fixtures/notion_subs_sample.json \
  --roundtrip \
  --out /tmp/subscriptions.enc.json
```
