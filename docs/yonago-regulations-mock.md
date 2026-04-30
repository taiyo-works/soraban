# 米子市デモ用 mock 規制データ

4/30 デモで「米子市役所の緯度経度 → 関連条例3件＋信号機UI」を動作させるための mock データ。出典確認のメモも含む。

## 1. 航空法第132条 — 人口集中地区(DID)上空の飛行
- **区分**: 国 / 国土交通省
- **status**: `red`（米子市役所は国勢調査ベースの DID に含まれるため、無許可飛行は不可）
- **出典**: 国土交通省 航空局 https://www.mlit.go.jp/koku/koku_fr10_000041.html
- **本実装**: 該当地点が DID に含まれるかは PostGIS（DID ポリゴン）で判定する想定。デモでは固定で red。

## 2. 小型無人機等飛行禁止法 — 自衛隊美保基地周辺
- **区分**: 国 / 警察庁・防衛省
- **status**: `yellow`（米子市役所は基地から数 km 離れるが要確認）
- **出典**: 警察庁 https://www.npa.go.jp/bureau/security/kogata_muzin/index.html
- **本実装**: 重要施設の中心点と 300m バッファを保持し、PostGIS で `ST_DWithin` 判定。デモでは固定で yellow。

## 3. 米子市都市公園条例 — 都市公園内での無人航空機の使用
- **区分**: 市町村 / 米子市
- **status**: `green`（米子市役所地点は都市公園ではない）
- **出典**: 米子市 https://www.city.yonago.lg.jp/
- **本実装**: 都市公園のポリゴンを Supabase (PostGIS) に保持し、`ST_Contains` で判定。

## 信号機UI のロジック
- 3条例のうち 1 件でも `red` → 全体 `red`
- それ以外で 1 件でも `yellow` → 全体 `yellow`
- それ以外 → `green`

## 後続作業
- Supabase 接続後、mock データを `regulations` テーブルへ移し、`check_regulations(lat, lng)` を Postgres function 化。
- DID ポリゴン、重要施設バッファ、都市公園ポリゴンをそれぞれ PostGIS で保持。
