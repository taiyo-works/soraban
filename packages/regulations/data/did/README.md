# DID（人口集中地区）データ

## 現在の状態（2026-10-18 取得）

- 判定に使うのは **国土数値情報 人口集中地区データ（A16）令和2年（2020）版** の鳥取県（31）・島根県（32）分（台帳 `../sources.json` の `did-r2`）。
- `r2/pref-31.json`（11 ポリゴン：鳥取市・米子市・倉吉市・境港市）・`r2/pref-32.json`（8 ポリゴン：松江市・浜田市・出雲市・益田市・安来市）を同梱済み。合計約 0.3MB。
- GitHub Actions「Fetch regulation data」（run 39168417203）で `https://nlftp.mlit.go.jp/ksj/gml/data/A16/A16-20/A16-20_{31,32}_GML.zip` から取得。属性は A16_001=DIDid、A16_002=行政コード、A16_003=市区町村名称、A16_011=国勢調査年度。取得ログは `../FETCH_REPORT.md`。
- 平成27年版（A16-15）は使わない（`scripts/fetch-did.sh` は旧手順として残す）。

## 出典（2026-10-19 確認）

| 項目 | 内容 |
|---|---|
| データ名 | 国土数値情報 人口集中地区データ（A16）2020年（令和2年）版 |
| 提供元 | 国土交通省（原典：総務省統計局 令和2年国勢調査 人口集中地区境界データ） |
| URL | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A16-2020.html |
| 公開 | 2024年6月（「2020年（令和2年）版に更新しました」） |
| ライセンス | 国土数値情報の使用許諾条件。1995年（平成7年）以降のデータは商用可。出典の明記が必要 |
| ファイル | 全国 `A16-20_GML.zip`（世界測地系、17.42MB）。都道府県別ファイルもある |

代替の入手元：e-Stat 統計GIS「境界データ」→ 令和2年国勢調査 → 人口集中地区（G空間情報センターにも「令和2年国勢調査人口集中地区境界データ」として掲載）。

## GitHub Actions での取得（推奨）

外部ネットワークに出られる GitHub Actions のランナーで取得・変換できる：Actions →「Fetch regulation data」→ Run workflow（`workflow_dispatch`）。
入力 `output` は `artifact`（既定。成果物 `regulation-data` として保存）か `commit`（実行したブランチにコミットして push）。
処理本体は `scripts/fetch-regulation-data.sh`。ダウンロード URL はダウンロードページの HTML から抜き出し（推測しない）、取得できない入手元はスキップしてジョブの Summary に残す。出典・取得日は `sources.json`・`coverage.json` に自動で記録される。合計 10MB 超でも失敗にせず、サイズを Summary に出す。

## 取得と同梱の手順

1. 上記 URL から `A16-20_GML.zip`（または鳥取県・島根県の都道府県別ファイル）をダウンロードして展開する。GeoJSON が同梱されていればそれを使う。Shapefile しかない場合は GDAL 等で WGS84 の GeoJSON に変換する（`ogr2ogr -f GeoJSON -t_srs EPSG:4326 out.geojson in.shp`）。
2. 同梱形式に変換する（形状の単純化はしない。座標は小数 6 桁に丸める。合計 10MB 超なら書き出さずに終了する）。

   ```sh
   node packages/regulations/scripts/build-did-r2.mjs --in path/to/A16-20_00_DID.geojson --prefs 31,32
   ```

   市区町村コード・名称の属性名は `行政コード`・`市町村名称`（A16-15 と同じ）を既定とし、見つからなければ候補から探す。見つからない場合は `--code-prop`・`--name-prop` で指定する。

   出力：`data/did/r2/pref-31.json`・`pref-32.json` と、再生成された `src/data-bundle/did-bundle.ts`（静的 import。本番のファイル I/O 不要）。
3. 台帳 `../sources.json` の `did-r2` を更新する：`acquiredAt`（取得日）、`bundled: true`、`coverage`、`verifiedAt`（証跡 ID が変わる）。
4. `data/industrial-exclusive/coverage.json` の `didOverlap` を、DID と工業専用地域の重なりを確認した結果に更新する。
5. `pnpm test`・`pnpm build`・`pnpm test:e2e` を実行する。`e2e/sprint7.spec.ts` の「B. DID データ」は同梱を検知すると自動で有効になる（米子市役所＝該当、タイヨー通信本社＝非該当）。

## 同梱形式（`r2/pref-XX.json`）

```json
{
  "datasetId": "did-r2",
  "baseYear": 2020,
  "prefCode": "31",
  "source": "国土数値情報 人口集中地区データ（A16）2020年版（国土交通省）…",
  "generatedAt": "YYYY-MM-DD",
  "features": [{ "muniCode": "31202", "muniName": "米子市", "rings": [[[133.3, 35.4], ...]] }]
}
```

- `rings[0]` が外周（[経度, 緯度]）。判定では穴（DID 内の非 DID 区域）を無視する（DID 扱い＝過大判定側）。
- 判定時は `muniCode` で工業専用地域の収録範囲台帳を引く（逆ジオコーディングに依存しない）。

## 差し替え（検証用）

環境変数 `DID_DATA_DIR` にディレクトリを指定すると、同梱データより優先して `pref-XX.json`（同梱形式）または `pref-XX.geojson`（FeatureCollection。properties に `muniCode`・`muniName`）を読む。E2E のフィクスチャ用サーバー（`e2e/fixtures/did`）で使う。本番では設定しない。
