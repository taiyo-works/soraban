# 工業専用地域（DID 除外）データ

## 制度

- 航空法施行規則第236条の72 に基づき、令和8年3月31日 国土交通省告示第435号で「都市計画法第8条第1項第1号の工業専用地域内の区域」が定められ、当該区域では「人又は家屋の密集している地域」（DID）の飛行許可が不要になった。適用日は 2026-07-01。
  - 国土交通省「無人航空機の飛行禁止空域と飛行の方法」 https://www.mlit.go.jp/koku/koku_fr10_000041.html （告示番号と根拠条文を確認、2026-10-19）
  - 千葉市 報道資料（適用日 令和8年7月1日を記載） https://www.city.chiba.jp/sogoseisaku/shichokoshitsu/hisho/hodo/documents/20260701-1_2.pdf （2026-10-19 確認）
- 空港等周辺、150m 以上、飛行の方法（夜間・目視外 等）の許可・承認は別に必要。緊急用務空域は原則飛行禁止で、指定中は許可があっても飛行できない。

## 判定での扱い（`evaluateDid`）

| 分岐 | 条件 | 判定 |
|---|---|---|
| 1 | DID データなし | 未確認（unknown） |
| 2 | DID 外 | 非該当（green） |
| 3 | DID 内・当該市町村が収録済み・工業専用地域の境界から 10m 以上内側 | 非該当（工業専用地域）（green） |
| 4 | DID 内・収録済み・工業専用地域外、または境界から 10m 未満 | 該当（red。境界付近はその旨を表示） |
| 5 | DID 内・当該市町村が未収録 | 該当（red）＋「工業専用地域の除外：未確認（データ未収録）」 |

内側余裕 10m は `coverage.json` の `insideMarginM`（ユーザー承認済み、2026-10-19）。

## 収録状況（2026-10-18）

- 国土数値情報 用途地域（A29）令和元年度版から、工業専用地域を持つ 11 市町村を収録（鳥取市・米子市・倉吉市・境港市・日吉津村・松江市・出雲市・益田市・大田市・安来市・雲南市）。取得ログは `../FETCH_REPORT.md`。
- **注意：** 基準は令和元年度で古い。市の最新の用途地域図との照合は未実施。令和元年度版の商用可否はダウンロードページに明記がなく未確認。
- A29 に用途地域はあるが工業専用地域がない市町村（例：浜田市・江津市）は、台帳上「未収録」のまま（DID 内は「除外：未確認」と表示される。安全側）。
- DID と工業専用地域の重なり（`didOverlap`）は `scripts/compute-did-overlap.mjs` で計算して確定（2026-10-19）。重なりあり＝鳥取市・米子市・境港市・日吉津村（工専の一部が米子市の DID に重なる）・益田市・安来市、重なりなし＝倉吉市・松江市・出雲市・大田市・雲南市、浜田市・江津市（A29 に工専なし）。`node packages/regulations/scripts/compute-did-overlap.mjs --check` で台帳との一致を確かめられる。
- 地点の判定では、DID の市町村に限らず収録済みの全市町村の工専から地点を含むものを探す（市町村境をまたぐ重なり、例：日吉津村の工専と米子市の DID）。

## GitHub Actions での取得（推奨）

外部ネットワークに出られる GitHub Actions のランナーで取得・変換できる：Actions →「Fetch regulation data」→ Run workflow（`workflow_dispatch`）。
入力 `output` は `artifact`（既定。成果物 `regulation-data` として保存）か `commit`（実行したブランチにコミットして push）。
処理本体は `scripts/fetch-regulation-data.sh`。ダウンロード URL はダウンロードページの HTML から抜き出し（推測しない）、取得できない入手元はスキップしてジョブの Summary に残す。出典・取得日は `sources.json`・`coverage.json` に自動で記録される。合計 10MB 超でも失敗にせず、サイズを Summary に出す。

## 収録手順（市町村ごと）

1. 入手元を優先順に確認する（`coverage.json` の `sourceCandidates`）。ライセンス、決定・変更の基準日、座標系を記録する。
2. 工業専用地域のポリゴンを WGS84（JGD2011 の緯度経度でも可）の GeoJSON にし、次で同梱形式に変換する（単純化しない。座標は小数 6 桁に丸める）。

   ```sh
   node packages/regulations/scripts/build-industrial-exclusive.mjs \
     --muni 31202 --name 米子市 --in path/to/youto.geojson \
     --filter-prop A29_005 --filter-value 工業専用地域 \
     --source "米子市 都市計画図（用途地域）" --source-url https://... --base-date 2026-04-01
   ```

   `data/industrial-exclusive/by-muni/{muniCode}.json` が作られ、`src/data-bundle/industrial-bundle.ts` が再生成される。
3. `coverage.json` の当該市町村を `status: "recorded"`、`source`・`baseDate`・`checkedAt`・`didOverlap` に更新する。
4. 台帳 `../sources.json` の `industrial-exclusive.verifiedAt` を更新する（証跡 ID が変わる）。
5. `pnpm test` を実行する。
