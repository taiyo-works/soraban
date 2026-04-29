# `packages/regulations/scripts`

Soraban の規制データ（DID / 空港 / 都市公園）を国土数値情報や政府公開データから
取得・整形して、`packages/regulations/data/` 配下にコミット可能な JSON / GeoJSON
を生成するためのシェルスクリプト群。

すべて pure shell + jq で動かしているので、Node 依存なしで誰でも再生成できる。

## ファイル構成

| スクリプト | 用途 | 出力 |
|---|---|---|
| `fetch-did.sh` | 国土数値情報 A16-15「人口集中地区」を都道府県別に分割 | `data/did/by-pref/pref-{code}.geojson` |
| `fetch-airports.sh` | 国土数値情報 C28-20「空港」のうち供用中のみ抽出 | `data/airports/airports.geojson` |
| `fetch-parks.sh` | 国土数値情報 N06「都市公園」を市町村別に分割 | `data/parks/by-muni/{muniCode}.json` |
| `extract-*.jq` | 各 fetch スクリプトが呼ぶ jq フィルタ | （標準出力経由） |

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
- **都市公園**: Phase 0/1 段階では手描き簡易ポリゴンを `data/parks/by-muni/{muniCode}.json` に直書きしている。`fetch-parks.sh` は **Phase 1 後半で N06 正規ポリゴンに置換するときに使う雛形**。実 N06 リリース URL を `SORABAN_N06_URL` 環境変数で渡す想定。
- **史跡 / 公衆密集地**: 国土数値情報には該当データがないため、当面 `zones.ts` のハードコード（後で同様に JSON 外出し予定）。

## 都市公園を N06 から再生成する手順（Phase 1 着手時）

1. 最新 N06 のダウンロード URL を確認（[KSJ N06](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N06.html)）
2. URL を環境変数で渡して fetch:
   ```bash
   SORABAN_N06_URL="https://nlftp.mlit.go.jp/ksj/gml/data/N06/.../N06-XX_GML.zip" \
     bash packages/regulations/scripts/fetch-parks.sh
   ```
3. `data/parks/by-muni/{31202,31204,32203}.json` が更新される
4. `pnpm test` で regulations の回帰スイートが green であることを確認
5. `pnpm dev` でデモプリセット 9 地点の判定が壊れていないことを目視確認
6. Cache Components のキャッシュ無効化: 公開時は `revalidateTag("regulation-data:parks")` を呼ぶ Server Action 経由で叩く（要追加実装）

## 自治体を追加するときの手順

1. `data/parks/by-muni/{新muniCode}.json` を作成（手描きまたは `fetch-parks.sh` 経由）
2. `packages/regulations/src/zones.ts` で当該 JSON を import し、新しい `XXX_PARKS` を export
3. `index.ts` の `MUNICIPAL_PARKS` レジストリに 1 行追加
4. （都道府県が新規であれば）`PREFECTURAL_NUISANCE` レジストリにも 1 行追加し、`COVERAGE_SUMMARY.municipalSensitiveCounts` を更新
5. `packages/regulations/src/index.test.ts` の demo preset cases に追加
