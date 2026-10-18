# `packages/regulations/scripts`

Soraban の規制データ（DID / 空港 / 都市公園）を国土数値情報や政府公開データから
取得・整形して、`packages/regulations/data/` 配下にコミット可能な JSON / GeoJSON
を生成するためのシェルスクリプト群。

すべて pure shell + jq で動かしているので、Node 依存なしで誰でも再生成できる。

## ファイル構成

| スクリプト | 用途 | 出力 |
|---|---|---|
| `build-did-r2.mjs` | **(Sprint 7 現行)** 国土数値情報 A16（令和2年）の GeoJSON から鳥取県・島根県の同梱データを作り、`src/data-bundle/did-bundle.ts` を再生成（単純化なし・小数 6 桁・10MB 上限） | `data/did/r2/pref-{code}.json` |
| `build-industrial-exclusive.mjs` | **(Sprint 7)** 市町村の用途地域 GeoJSON から工業専用地域を取り出し、`src/data-bundle/industrial-bundle.ts` を再生成 | `data/industrial-exclusive/by-muni/{muniCode}.json` |
| `fetch-did.sh` | （旧手順）国土数値情報 A16-15「人口集中地区」（平成27年）を都道府県別に分割。判定には使わない | `data/did/by-pref/pref-{code}.geojson` |
| `fetch-airports.sh` | 国土数値情報 C28-20「空港」のうち供用中のみ抽出 | `data/airports/airports.geojson` |
| `fetch-parks.sh` | （旧経路）国土数値情報 N06「都市公園」を市町村別に分割。**P13/N06 は 2011 年版で更新停止 + 非商用ライセンスのため Phase 1 では非推奨**。OSM 経路を優先 | `data/parks/by-muni/{muniCode}.json` |
| `fetch-parks-osm.mjs` | **(現行)** OpenStreetMap Overpass API から `leisure=park` を 12 市町村分取得 | `data/parks/by-muni-osm/{muniCode}.json` (gitignore) |
| `merge-parks-osm.mjs` | ハンドメイド seed と OSM データを名前重複排除でマージし `by-muni/` を上書き | `data/parks/by-muni/{muniCode}.json` |
| `validate-parks-osm.mjs` | 既存テスト fixture (lat, lng) が新公園 polygon に含まれるか確認 | stdout |
| `extract-*.jq` | 旧 fetch-*.sh が呼ぶ jq フィルタ（jq 必須、Windows では未導入のことが多い） | （標準出力経由） |

## データフロー

```
nlftp.mlit.go.jp/ksj/...   ← curl ダウンロード
        │
        ▼
data/{did,airports,parks}/raw/   ← gitignore（再生成可能）
        │
        ▼  jq で整形
        │
data/{did,airports,parks}/...    ← git 管理。zones.ts / regulation-check.ts から読む
```

## Phase 0/1 の運用

- **DID / 空港**: 既に `fetch-*.sh` で生成・配布済み。データは大容量なので git 管理外（`.gitignore` 参照）、再生成は `pnpm -F @soraban/regulations fetch:all`。
- **都市公園**: Phase 0/1 では手描き簡易ポリゴンを `data/parks/by-muni/{muniCode}.json` に直書き → Phase 1 後半で OSM (Overpass API) から取得した実 polygon をマージ済（`fetch-parks-osm.mjs` + `merge-parks-osm.mjs`）。N06 (P13) は 2011 年版以降更新がなく、非商用ライセンスのため採用断念。
- **史跡 / 公衆密集地**: 国土数値情報には該当データがないため、当面 `zones.ts` のハードコード（後で同様に JSON 外出し予定）。

## 都市公園を OSM から再生成・マージする手順（現行）

1. **fetch**: Overpass API から全 12 市町村の `leisure=park` を取得
   ```bash
   node packages/regulations/scripts/fetch-parks-osm.mjs
   ```
   出力: `data/parks/by-muni-osm/{muniCode}.json` (gitignore)。Overpass の rate-limit (429/504) は exponential backoff で 3 回リトライ。すでに取得済の muni は skip (`--force` で強制再取得)。
2. **validate**: 既存テスト fixture が OSM polygon に含まれているかを確認
   ```bash
   node packages/regulations/scripts/validate-parks-osm.mjs
   ```
3. **merge**: ハンドメイド seed と OSM データを名前重複排除でマージし `by-muni/` を上書き
   ```bash
   node packages/regulations/scripts/merge-parks-osm.mjs --dry-run  # 件数だけ確認
   node packages/regulations/scripts/merge-parks-osm.mjs            # 実行 (by-muni-handdrawn-backup/ にバックアップ自動作成)
   ```
   ハンドメイド版が先頭に来るので、test fixture (湊山公園 35.4267,133.322 等) の polygon が温存される。
4. **regression**: `pnpm test` で回帰スイートが green であることを確認 (101/101)
5. **UI 目視**: `pnpm dev` でデモプリセット 13 地点の判定が壊れていないか確認
6. **キャッシュ無効化**: 本番投入時は `revalidateTag("regulation-data:parks")` を呼ぶ Server Action 経由で叩く (要追加実装)

## 自治体を追加するときの手順

1. `data/parks/by-muni/{新muniCode}.json` を作成（手描きまたは `fetch-parks.sh` 経由）
2. `packages/regulations/src/zones.ts` で当該 JSON を import し、新しい `XXX_PARKS` を export
3. `index.ts` の `MUNICIPAL_PARKS` レジストリに 1 行追加
4. （都道府県が新規であれば）`PREFECTURAL_NUISANCE` レジストリにも 1 行追加し、`COVERAGE_SUMMARY.municipalSensitiveCounts` を更新
5. `packages/regulations/src/index.test.ts` の demo preset cases に追加
