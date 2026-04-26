# DID（人口集中地区）データ

## 出典
- **データ名**: 国土数値情報 A16「人口集中地区」（平成27年国勢調査ベース）
- **提供元**: 国土交通省（国土数値情報ダウンロードサービス）
- **URL**: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A16.html
- **ライセンス**: 国土数値情報利用約款（出典明記で利用可）
- **最新版**: 2015年（平成27年国勢調査ベース）

## 取得方法
リポジトリには大容量データを含めていません。次のスクリプトで取得・整形できます。

```sh
pnpm --filter @soraban/regulations fetch:did
```

スクリプトは ZIP をダウンロード、解凍、都道府県別に GeoJSON 分割します。

## 構造
- `raw/` : ダウンロード生データ（GML / Shapefile / GeoJSON）
- `by-pref/pref-XX.geojson` : 都道府県コード XX の DID FeatureCollection

各 Feature の properties:
- `DIDid`
- `muniCode` （5桁市区町村コード）
- `muniName`
- `population`
- `area`
- `year`

## 注意
- 平成27年（2015年）ベースのため、現状とは異なる場合があります。最終確認は国土交通省 DIPS や管轄機関で行ってください。
- 令和2年国勢調査ベースの A16 は本書執筆時点では未提供。提供開始後に差し替え予定。
