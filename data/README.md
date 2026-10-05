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
| `games` | 字串陣列 |
| `expires` | `YYYY-MM-DD` 或 `null`（未公開到期日） |
| `status` | `active` 或 `expired`。就算寫 active，只要 `expires` 早過今日，畫面都會當已過期 |
| `source` | 核對用連結 |

`scripts/refresh_codes_stub.py` 只檢查 schema，未接遠端抓取。畫面預設收起已過期。

## `events.json`（`events.v1`）

`events[]`：`id`, `title`, `date`, `endDate`, `place`, `ticketUrl`, `source`, `sample`

`deadlines[]`：`id`, `ip`, `item`, `shop`, `deadline`, `url`, `sample`

日期用 `YYYY-MM-DD`。`sample: true` 會標成示例。篩選用瀏覽器本地日期：即將舉行（未結束）、本週（星期一至日，而且未結束）、已結束。`.ics` 只匯出未結束嘅活動同截止。

## `anime-subs.json`（`anime-subs.v1`）

| 欄位 | 說明 |
| --- | --- |
| `title` / `titleJa` | 標題 |
| `platforms` | 有中文字幕嘅平台；未核對就寫 `待核對` |
| `subtitle` | 例如 `繁中` |
| `regionNote` | 香港可唔可以睇 |
| `scheduleHkt` | 香港時間檔期 |
| `source` | 來源連結 |
| `sample` | 樣本列 |

`scripts/refresh_anime_stub.py` 只檢查 schema。

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
