# 工業専用地域（DID 除外）データ

## 制度

- 航空法施行規則第236条の72 に基づき、令和8年3月31日 国土交通省告示第435号で「都市計画法第8条第1項第1号の工業専用地域内の区域」が定められ、当該区域では「人又は家屋の密集している地域」（DID）の飛行許可が不要になった。適用日は 2026-07-01。
  - 国土交通省「無人航空機の飛行禁止空域と飛行の方法」 https://www.mlit.go.jp/koku/koku_fr10_000041.html （告示番号と根拠条文を確認、2026-10-19）
  - 千葉市 報道資料（適用日 令和8年7月1日を記載） https://www.city.chiba.jp/sogoseisaku/shichokoshitsu/hisho/hodo/documents/20260701-1_2.pdf （2026-10-19 確認）
- 空港等周辺、150m 以上、緊急用務空域、飛行の方法（夜間・目視外 等）の許可・承認は別に必要。

## 判定での扱い（`evaluateDid`）

| 分岐 | 条件 | 判定 |
|---|---|---|
| 1 | DID データなし | 未確認（unknown） |
| 2 | DID 外 | 非該当（green） |
| 3 | DID 内・当該市町村が収録済み・工業専用地域の境界から 10m 以上内側 | 非該当（工業専用地域）（green） |
| 4 | DID 内・収録済み・工業専用地域外、または境界から 10m 未満 | 該当（red。境界付近はその旨を表示） |
| 5 | DID 内・当該市町村が未収録 | 該当（red）＋「工業専用地域の除外：未確認（データ未収録）」 |

内側余裕 10m は `coverage.json` の `insideMarginM`（ユーザー承認済み、2026-10-19）。

## 収録状況（2026-10-19）

**収録済みの市町村はない。** 作業環境から用途地域データの入手元（各市町の都市計画図の配布ページ、G空間情報センター、国土数値情報）に接続できず、ポリゴンを取得できなかった。DID データも未取得のため、DID と工業専用地域の重なりもどの市町村についても確認できていない（`coverage.json` の `didOverlap` はすべて `unverified`）。このため、DID 内の地点はすべて分岐 5（該当・除外未確認）で表示される。

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
