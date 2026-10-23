# 地図データ取得レポート（fetch-regulation-data）

- 実行: https://github.com/carta-lab/soraban/actions/runs/39168417203
- ブランチ: data-fetch/run-4（49ca4030d426435bfdd2aa6814b75448274c36b3）
- 実行日時（UTC）: 2026-10-18T21:35:14Z
- typecheck・test: success

## 取得・変換のログ（取得／スキップした URL、ZIP 内のファイル、先頭地物の属性、サイズ）

- 取得: https://nlftp.mlit.go.jp/ksj/gml/data/A16/A16-20/A16-20_31_GML.zip
  - ZIP 内のファイル（A16-20_31_GML.zip）:
    - A16-20_31.xml
    - A16-20_31_DID.cpg
    - A16-20_31_DID.dbf
    - A16-20_31_DID.geojson
    - A16-20_31_DID.prj
    - A16-20_31_DID.shp
    - A16-20_31_DID.shx
    - KS-META-A16-20_31.xml
DID 属性（先頭地物）: {"A16_001":"3120103","A16_002":"31201","A16_003":"鳥取市","A16_004":3,"A16_005":6530,"A16_006":1.45,"A16_007":-99999,"A16_008":-99999,"A16_009":3.5,"A16_010":0.2,"A16_011":2020,"A16_012":3270,"A16_013":3260,"A16_014":2906}
- 取得: https://nlftp.mlit.go.jp/ksj/gml/data/A16/A16-20/A16-20_32_GML.zip
  - ZIP 内のファイル（A16-20_32_GML.zip）:
    - A16-20_32.xml
    - A16-20_32_DID.cpg
    - A16-20_32_DID.dbf
    - A16-20_32_DID.geojson
    - A16-20_32_DID.prj
    - A16-20_32_DID.shp
    - A16-20_32_DID.shx
    - KS-META-A16-20_32.xml
DID 属性（先頭地物）: {"A16_001":"3220601","A16_002":"32206","A16_003":"安来市","A16_004":1,"A16_005":7056,"A16_006":2.69,"A16_007":7398,"A16_008":2.22,"A16_009":19,"A16_010":0.6,"A16_011":2020,"A16_012":3320,"A16_013":3736,"A16_014":2729}
pref 31: 11 polygons
pref 32: 8 polygons
done. total 0.28MB → packages/regulations/data/did/r2
次に data/sources.json の did-r2（acquiredAt・bundled・coverage）を更新してください。
sources.json: did-r2 を更新（31,32、取得日 2026-10-18）
- 取得: https://nlftp.mlit.go.jp/ksj/gml/data/A29/A29-19/A29-19_31_GML.zip
  - ZIP 内のファイル（A29-19_31_GML.zip）:
    - A29-19_31/
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31201.dbf
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31201.prj
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31201.shp
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31201.shx
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31202.dbf
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31202.prj
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31202.shp
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31202.shx
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31203.dbf
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31203.prj
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31203.shp
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31203.shx
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31204.dbf
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31204.prj
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31204.shp
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31204.shx
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31384.dbf
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31384.prj
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31384.shp
    - A29-19_31/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_31384.shx
    - A29-19_31/01-02_XMLМ`Оо/
    - A29-19_31/01-02_XMLМ`Оо/A29-19_31201.xml
    - A29-19_31/01-02_XMLМ`Оо/A29-19_31202.xml
    - A29-19_31/01-02_XMLМ`Оо/A29-19_31203.xml
    - A29-19_31/01-02_XMLМ`Оо/A29-19_31204.xml
    - A29-19_31/01-02_XMLМ`Оо/A29-19_31384.xml
    - A29-19_31/01-03_GeoJSONМ`Оо/
    - A29-19_31/01-03_GeoJSONМ`Оо/A29-19_31201.geojson
    - A29-19_31/01-03_GeoJSONМ`Оо/A29-19_31202.geojson
    - A29-19_31/01-03_GeoJSONМ`Оо/A29-19_31203.geojson
    - A29-19_31/01-03_GeoJSONМ`Оо/A29-19_31204.geojson
    - A29-19_31/01-03_GeoJSONМ`Оо/A29-19_31384.geojson
    - A29-19_31/01-04_ГБГ^ГfБ[Г^/
    - A29-19_31/01-04_ГБГ^ГfБ[Г^/KS-META-A29-19_31.xml
  - GeoJSON 5 件を結合
A29 pref 31 属性（先頭地物）: {"A29_001":"31201","A29_002":"鳥取県","A29_003":"鳥取市","A29_004":11,"A29_005":"工業地域","A29_006":60,"A29_007":200,"A29_008":null}
A29 pref 31 の A29_005 の値: 工業地域 / 第一種住居地域 / 第二種住居地域 / 第一種中高層住居専用地域 / 近隣商業地域 / 第一種低層住居専用地域 / 工業専用地域 / 準工業地域 / 第二種中高層住居専用地域 / 商業地域 / 準住居地域 / 第二種低層住居専用地域
A29 pref 31: 工業専用地域 14 地物 / 5 市町村
31201 鳥取市: 6 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
31202 米子市: 3 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
31203 倉吉市: 1 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
31204 境港市: 3 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
31384 日吉津村: 1 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
sources.json: industrial-exclusive を更新（収録 5 市町村）
- 取得: https://nlftp.mlit.go.jp/ksj/gml/data/A29/A29-19/A29-19_32_GML.zip
  - ZIP 内のファイル（A29-19_32_GML.zip）:
    - A29-19_32/
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32201.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32201.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32201.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32201.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32202.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32202.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32202.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32202.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32203.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32203.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32203.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32203.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32204.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32204.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32204.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32204.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32205.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32205.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32205.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32205.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32206.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32206.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32206.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32206.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32207.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32207.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32207.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32207.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32209.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32209.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32209.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32209.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32343.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32343.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32343.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32343.shx
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32441.dbf
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32441.prj
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32441.shp
    - A29-19_32/01-01_ГVГFБ[ГvГtГ@ГCГЛМ`Оо/A29-19_32441.shx
    - A29-19_32/01-02_XMLМ`Оо/
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32201.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32202.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32203.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32204.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32205.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32206.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32207.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32209.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32343.xml
    - A29-19_32/01-02_XMLМ`Оо/A29-19_32441.xml
    - A29-19_32/01-03_GeoJSONМ`Оо/
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32201.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32202.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32203.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32204.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32205.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32206.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32207.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32209.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32343.geojson
    - A29-19_32/01-03_GeoJSONМ`Оо/A29-19_32441.geojson
    - A29-19_32/01-04_ГБГ^ГfБ[Г^/
    - A29-19_32/01-04_ГБГ^ГfБ[Г^/KS-META-A29-19_32.xml
  - GeoJSON 10 件を結合
A29 pref 32 属性（先頭地物）: {"A29_001":"32201","A29_002":"島根県","A29_003":"松江市","A29_004":10,"A29_005":"準工業地域","A29_006":60,"A29_007":200,"A29_008":null}
A29 pref 32 の A29_005 の値: 準工業地域 / 第一種中高層住居専用地域 / 第一種住居地域 / 工業地域 / 第二種住居地域 / 近隣商業地域 / 商業地域 / 工業専用地域 / 第一種低層住居専用地域 / 第二種中高層住居専用地域 / 第二種低層住居専用地域 / 準住居地域
A29 pref 32: 工業専用地域 14 地物 / 6 市町村
32201 松江市: 2 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
32203 出雲市: 1 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
32204 益田市: 1 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
32205 大田市: 3 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
32206 安来市: 6 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
32209 雲南市: 1 zones
次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。
sources.json: industrial-exclusive を更新（収録 11 市町村）
296K	/home/runner/work/soraban/soraban/packages/regulations/data/did/r2
68K	/home/runner/work/soraban/soraban/packages/regulations/data/industrial-exclusive/by-muni
- 同梱データ合計: 346157 bytes（目安 10MB = 10485760 bytes）

## 生成ファイルのサイズ

```
packages/regulations/data/did/r2/:
total 292
-rw-r--r-- 1 runner runner 151331 Oct 18 21:34 pref-31.json
-rw-r--r-- 1 runner runner 146803 Oct 18 21:34 pref-32.json

packages/regulations/data/industrial-exclusive/by-muni/:
total 64
-rw-r--r-- 1 runner runner  6576 Oct 18 21:34 31201.json
-rw-r--r-- 1 runner runner  6627 Oct 18 21:34 31202.json
-rw-r--r-- 1 runner runner  3196 Oct 18 21:34 31203.json
-rw-r--r-- 1 runner runner  4774 Oct 18 21:34 31204.json
-rw-r--r-- 1 runner runner  1571 Oct 18 21:34 31384.json
-rw-r--r-- 1 runner runner  3964 Oct 18 21:34 32201.json
-rw-r--r-- 1 runner runner  2508 Oct 18 21:34 32203.json
-rw-r--r-- 1 runner runner  1333 Oct 18 21:34 32204.json
-rw-r--r-- 1 runner runner  3740 Oct 18 21:34 32205.json
-rw-r--r-- 1 runner runner 10273 Oct 18 21:34 32206.json
-rw-r--r-- 1 runner runner  3461 Oct 18 21:34 32209.json
```

## typecheck・test の結果（末尾 80 行）

```

> soraban@0.0.0 typecheck /home/runner/work/soraban/soraban
> pnpm -r typecheck

Scope: 5 of 6 workspace projects
apps/scraper typecheck$ tsc --noEmit
packages/db typecheck$ tsc --noEmit
apps/scraper typecheck: Done
packages/geo typecheck$ tsc --noEmit
packages/db typecheck: Done
packages/geo typecheck: Done
packages/regulations typecheck$ tsc --noEmit
packages/regulations typecheck: Done
apps/web typecheck$ tsc --noEmit
apps/web typecheck: Done

> soraban@0.0.0 test /home/runner/work/soraban/soraban
> vitest run


[1m[30m[46m RUN [49m[39m[22m [36mv4.1.5 [39m[90m/home/runner/work/soraban/soraban[39m

 [32m✓[39m [30m[42m geo [49m[39m packages/geo/src/index.test.ts [2m([22m[2m22 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32m✓[39m [30m[43m regulations [49m[39m packages/regulations/src/index.test.ts [2m([22m[2m86 tests[22m[2m)[22m[32m 29[2mms[22m[39m
 [32m✓[39m [30m[43m regulations [49m[39m packages/regulations/src/sprint7.test.ts [2m([22m[2m27 tests[22m[2m)[22m[32m 35[2mms[22m[39m
 [32m✓[39m [30m[43m regulations [49m[39m packages/regulations/src/diagnosis.test.ts [2m([22m[2m47 tests[22m[2m)[22m[32m 23[2mms[22m[39m
 [32m✓[39m [30m[43m regulations [49m[39m packages/regulations/src/prefill.test.ts [2m([22m[2m24 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m [30m[43m regulations [49m[39m packages/regulations/src/business-days.test.ts [2m([22m[2m30 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m [30m[46m web [49m[39m apps/web/src/lib/history.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m [30m[46m web [49m[39m apps/web/src/server/handlers.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 39[2mms[22m[39m

[2m Test Files [22m [1m[32m8 passed[39m[22m[90m (8)[39m
[2m      Tests [22m [1m[32m256 passed[39m[22m[90m (256)[39m
[2m   Start at [22m 21:35:10
[2m   Duration [22m 3.11s[2m (transform 1.22s, setup 0ms, import 1.78s, tests 181ms, environment 1ms)[22m

```
