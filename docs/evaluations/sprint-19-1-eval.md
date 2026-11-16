# Sprint 19-1（19-1a / 19-1b / 19-1c）評価レポート

対象: コミット `1de292b`。基準: `bb4b6ea`。契約: `docs/sprints/sprint-19.md` §6（A1-1〜7、B1-1〜9、C1-1〜7）。
評価者: evaluator（別の worktree、実行ごとに新しい空の DB、別ポート）。このファイルは evaluator の最終報告をオーケストレーターが転記したもの（evaluator の実行環境では報告のファイルを書けなかったため）。

## 総合判定: 条件付き合格

契約の機能（A1・B1・C1）は満たしている。落ちた検証は 0 件。要修正は D1 の 1 点。

## 要修正

| # | 内容 | 差し戻し先 |
|---|---|---|
| D1 | `report-record-blocked` の案内文が実測 13px（内側の Note 部品。外側の枠は 15px）。不変条件 6（本文 16px 以上）に満たない。375・1280 とも同じ。コントラストは約 7:1 で十分。下書き・中止の既存の案内と同じ Note 部品の寸法で、今回の変更で悪化したわけではない。 | 案内の文を 16px 以上にする |

## 実行した検証（空の DB から）

| 検証 | 結果 |
|---|---|
| `pnpm typecheck` / `pnpm lint` | 成功 |
| `pnpm test` | 3044 件通過・15 skip |
| `REQUIRE_DB_TESTS=1 pnpm test:db` | 1 回目は 1 件失敗（`evidence.db.test.ts`「apps/web のビルドがありません」。環境: build の前に実行した順序）。ビルド後の再実行は 286 件通過 |
| `pnpm build` | 成功 |
| `pnpm test:e2e:ops` 全体（`--retries=0`） | 203 件通過（20.5 分）。失敗 0 |
| 公開側 `pnpm test:e2e --retries=0` | 343 件通過（17.1 分）。失敗 0 |

GitHub Actions の CI はこの評価では見ていない（ローカルのみ）。

## 契約項目ごと

- 19-1a（A1-1〜7）: ✅。API の穴探しでも、頂点 2 つ→`vertices_too_few`、緯度経度の取り違え→`lat_out_of_range`、小数 8 桁→`coordinate_too_precise`、日付変更線→`antimeridian_crossing`、閉じた環→`ring_closed`、半径 0・10001→`radius_out_of_range`、101 頂点→`vertices_too_many`（100 頂点は 201）が別々の理由で返る。`base.ts` は bb4b6ea の `index.ts` と完全に同一。
- 19-1b（B1-1〜9）: ✅。0001〜0017 に差分 0。クライアントの嘘の緯度・経度・半径は無視され、サーバー計算値が保存される。422 のあと何も増えない。訂正は新しい版になり旧版は不変。owner で表を直接書き換えると `verify_flight_areas` と `verify_record_chain` が偽になる。円 1 つ・点の指紋は bb4b6ea と一致。権限（閲覧者 403、別の操縦者 403、別組織 404）、`soraban_app` は表の更新と `verify_flight_areas` の実行が拒否される。`ENGINE_VERSION`・`evidence_log`・証跡 ID・`permit-logic.ts` に差分 0。
- 19-1c（C1-1〜7）: ✅。多角形 1 つで `report-route-geojson` に開いた環の Polygon（小数 6 桁以内）。円・点の `prepareReport` の出力は bb4b6ea と 12 通りで差分 0。範囲 2 つ以上は、読み出しが警告つきで 200、新規・変更が 409 `route_multiple_areas`、取消が 201 で通る。375×812 / 1280×800 とも横スクロールなし、記録フォームは出ない。

端末データ: localStorage は利用者 ID のみ、IndexedDB に座標なし。差分に既存テストを弱めた箇所なし。禁止語の追加なし。

## 軽微な指摘（要修正ではない）

1. API は `areas` の余分な鍵を 422 にせず黙って捨てる（保存の形は DB の check が守る）。
2. 自己交差の多角形（8 の字）は API が 201 で保存する（警告は 19-2d）。
3. `areas: null` を緯度・経度なしで送ると、多角形が外接円に置き換わる。画面（19-2 以降）で `areas: null` を送るときは注意。
4. 画面の「取消の記録はできます」が、有効な通報が無い計画でも出る（過剰な約束）。

## 検証できなかったこと

CI の結果、再送（retry）の 409 の手動確認（DB テストで代替）、閲覧者・操縦者での案内の見た目（manager のみ実測）。

## ユーザー判断が要る点

D1 の寸法、軽微 1・4 の扱い（オーケストレーターは、D1 は 16px 以上に直す、1 は 422 にする、4 は文言を直す、と決めて generator に依頼する）。
