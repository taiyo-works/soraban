# 住所検索の同梱索引（アドレス・ベース・レジストリ、鳥取県・島根県）

> 状態：**未取得**（2026-10-19）。索引は空で、住所検索は国土地理院の住所検索だけで動く。
> 取得できた後は、このファイルを `packages/regulations/scripts/build-address-index.mjs` が計測結果で上書きする（Sprint 9 A-1）。

## 取得できなかった理由

- 配布元 `https://data.address-br.digital.go.jp/`（CloudFront）が、日本国外からの接続を拒否する。
  GitHub ホストのランナー（米国）からの取得は、すべて HTTP 403「The Amazon CloudFront distribution is configured to block access from your country.」になった
  （`fetch-address-data` ワークフロー、ブランチ `data-fetch/address-run-1`〜`run-4`、各ブランチの `packages/regulations/data/ADDRESS_FETCH_REPORT.md`）。
- 作業環境（Claude のコンテナ）からは、プロキシの制限で配布元・データセットサイトのどちらにも接続できない。
- DCAT フィードの各データセットにある ArcGIS のアイテム（例：`cea6556c6f894848ba303d46964538ac`）は「Document Link」で、実体は同じ配布元 URL を指すだけだった（代替の取得経路にならない）。
- 第三者による再配布（ミラー）は、出典・加工の連鎖が確認できないため使っていない。データを推測で作ることもしていない。

## 確認できたこと（2026-10-19、GitHub Actions で DCAT フィードを取得）

- DCAT フィード：https://dataset.address-br.digital.go.jp/api/feed/dcat-us/1.1.json （約 13MB、データセット 9,345 件、`.csv.zip` の配布ファイル 9,344 件）
- 鳥取県（31）・島根県（32）について選定した配布ファイル：計 91 件
  - 都道府県単位（各 2 件）：市区町村 `mt_city`・同位置 `mt_city_pos`、町字 `mt_town_fullset`・同位置 `mt_town_pos`、住居表示の街区 `mt_rsdtdsp_blk`・同位置、住居 `mt_rsdtdsp_rsdt`・同位置
  - 市区町村単位：地番 `mt_parcel` 38 件（両県の全 38 市町村）、地番の位置 `mt_parcel_pos` 37 件（1 市町村は位置ファイルがフィードにない）
- 配布ファイルの記述の例（鳥取県 市区町村マスター）：最終更新日 2025-05-22T09:21:32Z、ライセンス表記 CC BY 4.0（フィード上）、利用規約 https://www.digital.go.jp/policies/base_registry_address_tos
- 件数・座標付き件数・容量・市区町村ごとの地番の位置付き件数・版は、ファイルを取得できていないため**未計測**。

## 出典とライセンス（取得後に索引へ記録する内容）

- 出典：アドレス・ベース・レジストリ（デジタル庁）を加工して作成（加工者：そらばん（フューチャーテック株式会社））
- 利用条件：公共データ利用規約（第1.0版）（PDL1.0）— https://www.digital.go.jp/policies/base_registry_address_tos 、https://www.digital.go.jp/resources/open_data/public_data_license_v1.0
- 地番マスターは、上記に加え「登記所備付地図データ利用規約」に同意したものとみなされる（同規約の本文は未確認）
- 同梱の上限：住所データの合計 10MB。地番は町字・住居表示と合わせて上限内に収まる場合だけ同梱する

## 取得の手順（日本国内のネットワークで実行する）

必要な環境：Node.js 22 以上、pnpm 10（リポジトリの `packageManager`）、`unzip` コマンド（macOS・Linux に標準で入っている）。
bash の版や GNU coreutils には依存しない（macOS 標準の bash 3.2 でも動く）。

```bash
pnpm install
pnpm --filter @soraban/regulations fetch:address
#   （同じ処理：node packages/regulations/scripts/fetch-address-data.mjs --prefs "31 32"
#    または sh packages/regulations/scripts/fetch-address-data.sh）
# → packages/regulations/data/address/（index-31.json・index-32.json・stats.json・README.md、上限内なら parcels-*.json）
#   と packages/regulations/src/data-bundle/address-bundle.ts が生成される。
#   取得の記録は packages/regulations/data/.fetch-work-address/summary.md（作業ディレクトリ。コミットしない）
pnpm typecheck && pnpm test   # 同梱索引の照合精度のテスト（bundled.test.ts）が有効になる
```

町字の座標付き件数が 0 件など、列名の想定と違う入力では索引を作らずに異常終了する（summary.md に見出し行を残す）。

国内の self-hosted ランナーがあれば、`.github/workflows/fetch-address-data.yml` を手動実行（`gh workflow run fetch-address-data.yml --ref <ブランチ>`）できる（`runs-on` の変更が必要。Actions の消費を抑えるため、ブランチへの push では動かさない）。
