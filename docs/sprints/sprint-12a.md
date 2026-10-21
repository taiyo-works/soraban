# Sprint 12a: 飛行計画 ＋ 判定スナップショット ＋ 運航管理者の確認（契約確定版）

> 親文書：`docs/sprints/sprint-12.md`（全体の設計。本書は §4 の下書きを確定させたもの）／ `docs/spec.md` §13.6・§13.10 ／ `docs/00_NORTH_STAR.md` §0.1.9・§0.1.10
> 期間：2027-01-12〜01-22（2 週間の目安。ユーザー承認は 2026-10-21 で、前倒しで着手してよい）。
> 状態：**契約確定（2026-10-21、ユーザーが「進めて」で Sprint 12 の設計と 12a〜12f の分け方を承認）。**
> 前提：Sprint 11f がマージ済み（main = c4f13ee）。本書は main から切ったブランチで実装し、新しい PR で出す。`ENGINE_VERSION`（`soraban-0.4.0-verdict-2026-10`）、判定ロジック、証跡 ID の計算は変えない。
> 機能フラグ：`OPS_ENABLED` の裏（本番は停止のまま）。本番の DB・Neon Auth・Vercel の環境変数はエージェントが触らない。マイグレーションはリポジトリと CI のコンテナでだけ試す。
> ※ Next.js は破壊的変更を含むため、画面・ルートハンドラを書く前に `node_modules/next/dist/docs/` を参照する（`apps/web/AGENTS.md`）。

## 目的と位置付け

判定の結果から「飛行計画」を作り、その時点の判定を**不変のスナップショット**として残す。運航管理者が計画とスナップショットを確認・差し戻し、日誌（飛行記録）が計画とスナップショットに結びつく。日誌から「どの法令・条例を、どの版と確認日で判定したか」へ辿れる（North Star §0.1.1 の価値の芯）。通報が要るかを根拠つきで見せる（通報そのものは DIPS 2.0 で行い、記録は 12b）。社内拠点を「よく使う地点」に登録できる。

## 現状（2026-10-21、c4f13ee 時点。コードを読んで確かめた事実）

| 箇所 | 現在 |
|---|---|
| マイグレーション | 0001〜0009。最新の 0009 は `evidence_log` に判定の列を足したもの。`MIGRATION_VERSIONS`（`packages/db/src/migrations-manifest.ts`）に版の一覧がある |
| 版の履歴 | `record_versions`（0006）。`entity_type` の CHECK は `member`・`aircraft`・`pilot`・`daily_inspection`・`flight_record`（0008）。追加前のトリガーが `version_no`・`created_at`・`prev_hash`・`content_hash` を決め、追加後のトリガーがヘッド表を作る。関数は 0008 が 0006 を丸ごと置き換えている（0010 以降も同じ流儀で置き換える） |
| 権限 | `soraban_app` は `record_versions` に SELECT・INSERT、ヘッド表と `organizations` に SELECT だけ。UPDATE・DELETE・TRUNCATE は与えない。CI の db ジョブが `has_table_privilege` で確かめている |
| `flight_records` | `flight_plan_id`・`snapshot_id` は予約列（uuid、外部キーなし）。作成は常に NULL、訂正は前の版の値を引き継ぐ（`records.ts`）。`FlightDto` は両方を返す |
| 判定の実行 | `handlers.ts` の `handleDiagnosePost` が、リクエストの解析 → 地点判定（`runRegulationCheck`）→ 診断・判定（`deriveDiagnosis`・`deriveFlightVerdict`）→ 証跡 ID の採番までを 1 つの関数で行い、その場で JSON を返す。サーバー内から呼べる形（関数）には分かれていない |
| 証跡 ID | `computeCheckEvidenceId`・`computeDiagnosisEvidenceId` は**判定時刻（`checkedAt`）を入力に含む**ため、同じ入力でも判定ごとに異なる。`evidence_log` に書かれるのは地点判定（`/api/check`）の証跡 ID だけで、申請支援（`/api/diagnose`）の証跡 ID は書かれない |
| 判定の応答 | `/api/diagnose` の応答は `category`・`verdict`（`level`・`unknownCount`・`items`・`procedures`…）・`flags`（空域の導出を合流した最終のフラグ）・`droneWeightG`（入力したときだけ）・`evidenceId`・`checkEvidenceId`・`engineVersion`・`checkedAt`・`datasets`・`amendments` など。手続きデータの版は `PROCEDURES_REVISION`・`PROCEDURES_VERIFIED_AT`（`@soraban/regulations` が export）。データセットの確認日は `getDataset(id).verifiedAt` |
| 機体の重量 | `aircraft.max_takeoff_weight_kg` は `numeric(7,1)`・NULL 可・正の値。入力は小数第 1 位まで（`validate.ts`）。**0.1kg（100g）未満は登録できない** |
| 認可 | `authz.ts` の `can(role, action, {isSelf})`。`flight.read` は全役割で可、作成・訂正は運航管理者か自分が操縦者の操縦者役割、取消は運航管理者だけ。操縦者役割の「自分」は `pilots.member_id` で利用者に結び付く |
| 画面・API | `/ops`（トップ）、`/ops/aircraft`、`/ops/pilots`、`/ops/flights`、`/ops/inspections`、`/ops/members`。API は `opsHandler` 経由（可否 → Origin → 本人確認 → 利用者 → 処理）。`proxy.ts` が `/ops/*`・`/api/ops/*` を `OPS_ENABLED` で 404・503 にする |
| `/` | `cacheComponents: true`（Next.js 16）で、静的なシェルとして描かれる。運航管理への入口はない |
| E2E | `playwright.ops.config.ts`（`pnpm test:e2e:ops`、`e2e/ops-db/`）。`AUTH_PROVIDER=test`、サーバー時計は `OPS_TEST_NOW`（JST 2027-01-05 12:00）。**逆ジオコーダの模擬サーバーは立てていない**（`EVIDENCE_LOG=off`）。通常の E2E は `e2e/mock-gsi-server.mjs` を使う |
| テスト用の初期データ | `packages/db/src/ops-seed.ts`。組織 A・B、各役割の利用者、操縦者・機体 |
| 社内拠点の座標 | 下の「社内拠点の座標」 |

### 社内拠点の座標（事実の確認）

| 項目 | 内容 |
|---|---|
| 名称・住所 | フューチャーテック株式会社 本社：鳥取県西伯郡日吉津村日吉津45番地3（ユーザー指定） |
| 座標 | **緯度 35.434238、経度 133.380508** |
| リポジトリでの根拠 | コミット 35d6951（2026-04-30）が「拠点」の座標として地点の例に登録。コミット 5fffc21（2026-10-19、`chore/map-initial-hq`）が「本社（日吉津村日吉津45番地3）」の地図の初期表示にした。Sprint 11a（2026-10-19）で初期表示は米子市役所に変わったが、同じ値が `handlers.test.ts`（`farGreen`）、`pick-method-evidence.test.ts`、`sprint10a.test.ts`（「本社（日吉津村・収録範囲外）」）、`e2e/mock-gsi-server.mjs`（参照点）に残っている |
| 状態 | リポジトリ内の値は一貫している（確認済みの事実）。日吉津村の工業専用地域のデータ（`industrial-exclusive/by-muni/31384.json`）の東隣にあたり、日吉津村の中として矛盾しない。**※要確認：住所 → 座標の照合（国土地理院の住所検索）は、作業環境が国土地理院に接続できず（403）できていない。本番に登録する前に、ユーザーが地図で 45番地3 の位置と一致するかを目視で確かめる（ユーザー作業 U8）。→ 2026-10-21 にユーザーが「おっけー」と確認済み** |
| 注意 | 既存テストは、この地点を「収録範囲外」にするため市町村コードに 31390 や 31386 を使っている。日吉津村の実際のコードは 31384（データのファイル名より）で、テストの値は実在の判定ではない。計画のテストでこれらのコードに依存しない |

## 下書き（sprint-12.md §4）からの変更点

下書きを現在のコードに照らして直した点。generator は下書きではなく本書に従う。

1. **A2「同じ入力から作った証跡 ID が、地点判定の画面の証跡 ID と一致する」は成立しない。** 証跡 ID は判定時刻を含み、判定のたびに変わる。代わりに「保存した入力と結果から証跡 ID を再計算すると一致する」（再現性）を契約にする（契約 3）。
2. **`/api/diagnose` の中身を関数に切り出す。** サーバー内から同じ判定を呼べないため（契約 1）。応答は 1 バイトも変えない。
3. **申請支援の証跡 ID は `evidence_log` に無い。** スナップショットは、地点判定の証跡 ID（`evidence_log` への外部キー）と申請支援の証跡 ID の両方を持ち、スナップショットを作る同じトランザクションで `evidence_log` に地点判定の行を書く（`EVIDENCE_LOG` の設定に関係なく）。
4. **保存時の判定は「自動で再実行」にする。** 下書きは「訂正すると『判定が古い』と出て再判定を促す」だったが、ユーザーの決定は「保存時にサーバーが判定を実行して保存する」。判定に関わる項目を変えた保存は、同じトランザクションで新しいスナップショットを作る。「判定が古い」は、機体の重量の変更・エンジンの版・データの確認日・手続きデータの版が変わったときに出す（鮮度の判定。契約 9）。
5. **機体の重量は登録機体から取る（画面で書き換えない）。** 重量を計画の画面で下げられると、見落としが起きる。機体の最大離陸重量を機体重量として使う（実際の機体重量以上の値になるため、100g・25kg の境界では厳しい側に倒れる）。重量が未登録なら、通報の要否は「要確認」になる。
6. **100g 未満の計画は 12a では作れない。** 機体の登録は 0.1kg 刻みで 100g 未満を登録できないため。通報の要否の純粋関数は 100g 未満の分岐を持ち、単体テストで網羅するが、画面からは到達しない（範囲外）。
7. **スナップショットの外部キー。** 計画 ↔ スナップショットは循環するため、遅延可能な複合外部キー（同じ組織・同じ計画に限る）で DB が守る。`flight_records` の `flight_plan_id`・`snapshot_id` にも外部キーを足し、別の計画のスナップショットを結べないようにする。
8. **スナップショットの改変の検出。** 追記専用（権限）に加え、DB が内容のハッシュと直前のハッシュを決める（`record_versions` と同じ流儀）。検証関数を足す（DB 移行の前後の検証にも使う。`docs/spec.md` §13.8.1）。
9. **「計画の複製」と「差し戻しの理由の分類」は範囲外にした。** 削る順の先頭に置いていたもので、最初から入れない。
10. **「通報不要への例外」の文言。** 下書きの「通報不要の例外に当たる可能性」は「通報不要」の言葉を含むため使わない（下の設計 I）。
11. **`/` のリンクは静的シェルを壊さない作りにする。** 設計 K。
12. **契約は 22 項目。** 下書きの 17 項目から、DB の権限・原子性・ハッシュ・認可・CI を検証できる形に分けた結果。§13.6 の目安（10〜20）を 2 件超えるため、削る順を末尾に置く。

## 設計

### A. 判定をサーバーで実行して保存する

- **A1. 判定の切り出し**：`handleDiagnosePost` の「入力の解析」と「判定の組み立て」を分け、組み立てを関数（例：`apps/web/src/server/diagnose-core.ts` の `runDiagnosis(input, runCheck, now)`）にする。`handleDiagnosePost` は解析して呼ぶだけにする。応答の JSON は変えない。`now` を渡せるようにし、テストで時計を固定する。
- **A2. 入力の組み立て**：計画から「判定の入力」を 1 か所の純粋関数 `buildJudgementInput(plan, aircraft)` で作る。形（正規化済み）：
  `{ lat, lng, droneWeightG | null, flags[], plannedDate, pilotPermits[], purpose?, accessControl?, thirdPartyOverflight?, bvlosWithObserver? }`
  - `lat`・`lng` は小数 6 桁。`droneWeightG` は機体の最大離陸重量（kg）× 1000 の整数。未登録は null（その場合は `runDiagnosis` に重量を渡さない）。
  - `flags` は、利用者が選んだ飛行の方法・空域のフラグ（`SpecificFlightFlag`）に、最大高度が 150m 以上なら `airspace_150m` を足し、重複を除き、固定の順に並べたもの。DID・空港のフラグは入力に含めず、判定が導出する（応答の `flags` が合流後の最終）。
  - `plannedDate` は予定開始の JST の日付。`pilotPermits` は並べ替え済み。`purpose` は判定の目的の例外（`emergency`・`public_duty`・`city_event`）で、通常は無い。
  - 「DID 非該当を確認済み」の自己申告（`didConfirmedNotApplicable`）は計画では扱わない（判定不能は要手続きのまま）。
- **A3. 保存時の実行**：計画の作成と、判定に関わる項目を変える訂正で、サーバーが `runDiagnosis` を実行する。リクエストに判定の結果らしき値（`verdict`・`result`・`snapshot`・`evidenceId` など）があっても読まない。実行の上限は 20 秒。時間切れ・失敗は 503（`judgement_failed`）で、何も保存しない。
- **A4. 判定に関わる項目**：場所（緯度・経度）、機体（重量）、予定日、飛行の方法・空域のフラグ、最大高度、許可の種類、目的の例外、立入管理措置・第三者上空・補助者の有無。これ以外（計画名、予定の時刻、所要時間、目的の自由記述、場所の名称、許可番号の文字、メモ、操縦者）の訂正は、スナップショットを増やさない。
  - 操縦者は判定に入らない（技能証明の照合は判定の範囲外。12d 以降）。
- **A5. 1 つのトランザクション**：`evidence_log`（地点判定の行。`on conflict do nothing`）→ スナップショット → `record_versions`（計画の版）を 1 つのトランザクションで書く。どれかが失敗したら全部取り消す。

### B. データモデル（マイグレーション 0010 以降。追記のみ）

2 本を想定する（番号と分け方は generator が決めてよいが、適用済みのファイルは変えない）。

**B1. `judgement_snapshots`（追記専用）**

| 列 | 内容 |
|---|---|
| `id` uuid（主キー）、`org_id`、`plan_id` | 組織 ID は `organizations` への外部キー。`(plan_id, org_id)` は `flight_plans(id, org_id)` への複合外部キー（遅延可能・初期は遅延） |
| `seq` integer | 計画の中での通し番号（1, 2, …）。DB が決める。`(plan_id, seq)` は一意 |
| `reason` text | `initial`（作成）／`input_changed`（判定に関わる項目の訂正）／`data_updated`（根拠のデータ・エンジンの版が変わった再判定）／`manual`（手動の再判定）の CHECK |
| `input` jsonb | 設計 A2 の判定の入力（正規化済み） |
| `result` jsonb | `runDiagnosis` の応答そのもの（`/api/diagnose` の応答と同じ形。既存の判定の部品でそのまま描ける） |
| `verdict_level` text、`verdict_unknown_count` integer、`category` text | 一覧用に取り出した値。`verdict_level` は 4 段の CHECK |
| `engine_version` text、`checked_at` timestamptz | 結果の `engineVersion`・`checkedAt` |
| `check_evidence_id` text | 地点判定の証跡 ID。`evidence_log(evidence_id)` への外部キー |
| `diagnosis_evidence_id` text | 申請支援の証跡 ID |
| `datasets` jsonb | 使ったデータセット（id・名称・基準年・確認日） |
| `procedures_revision` integer、`procedures_verified_at` text | 手続きデータの版と確認日 |
| `created_by_member_id`、`created_at` | 作成者（利用者への外部キー）。`created_at` は DB が決める |
| `prev_hash`、`content_hash` | DB が決める。同じ計画の直前のスナップショットのハッシュとの連鎖。規則は `packages/db/README.md` に書く（`soraban-snapshot-v1`） |
| 一意 | `(id, plan_id, org_id)`（`flight_plans`・`flight_records` からの複合外部キー用） |

- 追加前のトリガー（`security definer`、計画ごとの `pg_advisory_xact_lock`）：`seq`・`prev_hash`・`created_at`・`content_hash` を決める。アプリが送った値は使わない。
- **更新・削除・TRUNCATE を拒むトリガー**（行ごと・文ごと）を置く。権限を持つオーナーロールでも拒む（SQLSTATE `SB409`、detail `immutable`）。
- 検証関数 `verify_judgement_snapshots(p_plan_id)`：連番の欠け、`prev_hash` の不一致、`content_hash` の再計算の不一致を返す（改変がなければ 0 行）。`record_versions` の `verify_record_chain` と同じ読み方。

**B2. `flight_plans`（ヘッド表。`record_versions` の `entity_type = flight_plan` から DB が作る）**

| 列 | 内容 |
|---|---|
| `id`、`org_id` | `(id, org_id)` は一意（複合外部キー用） |
| `title` | 計画名（1〜100 文字） |
| `aircraft_id`、`pilot_id` | 同じ組織の機体・操縦者への外部キー。機体は訂正で変えられない（飛行記録と同じ）。1 計画に機体 1 つ・操縦者 1 人 |
| `planned_start_at` | 予定開始（JST の分単位。`flight_records` と同じ時刻の扱い） |
| `duration_minutes` | 所要時間（1〜1440 分。24 時間を超える飛行は別の計画に分ける） |
| `planned_date` | 予定日（JST の日付。DB が `planned_start_at` から決める） |
| `purpose` | 飛行の目的（1〜100 文字。自由記述。日誌の目的に引き継ぐ） |
| `place_name`、`latitude`、`longitude`、`radius_m` | 場所の名称（1〜100 文字）、座標（`numeric(9,6)`）、範囲の半径（任意。1〜10000m）。多角形は持たない |
| `saved_place_id` | 「よく使う地点」から選んだときの参照（任意）。座標は写しとして計画に持つ |
| `max_altitude_m` | 最大高度（任意。0〜2000m）。150m 以上は `airspace_150m` として判定に入れる |
| `flags` jsonb | 利用者が選んだフラグ（`SpecificFlightFlag` の配列） |
| `pilot_permits` jsonb、`judgement_purpose`、`access_control`、`third_party_overflight`、`bvlos_with_observer` | 判定画面と同じ入力（許可の種類、目的の例外、立入管理措置など） |
| `drone_weight_g` | 判定した時点の機体重量の写し（NULL 可） |
| `permit_numbers` | 許可・承認の番号（手入力の文字。0〜200 文字。12d で登録と結ぶ） |
| `notes` | メモ（0〜500 文字） |
| `status` | `draft`／`active` の CHECK。中止は取消の版（`voided_at`） |
| `current_snapshot_id` | 現在のスナップショット。`(current_snapshot_id, id, org_id)` は `judgement_snapshots(id, plan_id, org_id)` への複合外部キー（遅延可能・初期は遅延）。別の計画・別の組織のスナップショットを指せない |
| `client_request_id` | 二重送信の防止（飛行記録と同じ。`(org_id, client_request_id)` が一意） |
| `current_version`、`created_at`、`updated_at`、`voided_at` | 既存のヘッド表と同じ |

- 追加後のトリガーが `data` からヘッド表を作る・更新する。機体・操縦者は同じ組織に限る（SB404）。
- `verify_record_chain` に `flight_plan`・`saved_place` を足す（表の対応、`data` との一致）。

**B3. `plan_confirmations`（追記専用）**

| 列 | 内容 |
|---|---|
| `id`、`org_id`、`plan_id` | 計画への外部キー |
| `plan_version` integer、`snapshot_id` | 確認した計画の版と、その版のスナップショット |
| `decision` | `approved`／`returned` の CHECK。`returned` は理由が必須（CHECK） |
| `reason` | 0〜500 文字 |
| `confirmer_member_id`、`confirmer_name` | 確認者と、その時点の表示名の写し |
| `self_confirmation` boolean | **DB が決める**：確認者が、その版を保存した利用者である、または計画の操縦者に結び付いた利用者である |
| `created_at`、`content_hash` | DB が決める |

- 追加前のトリガーが検証する：計画が同じ組織で、取消されておらず、`status = active`（SB409 `not_requested`）、`plan_version` が計画の**最新の版**（そうでなければ SB409 `version_conflict`）、その版の `data` の `current_snapshot_id` が `snapshot_id` と一致する。
- 更新・削除・TRUNCATE を拒むトリガーを置く（B1 と同じ）。

**B4. `saved_places`（ヘッド表。`entity_type = saved_place`）**

`id`、`org_id`、`name`（1〜100）、`address_text`（任意、0〜200）、`latitude`、`longitude`、`note`（任意、0〜200）、`current_version`、`created_at`、`updated_at`、`voided_at`。名称は取消していないものの中で組織内一意。

**B5. 既存の表の変更**

- `record_versions.entity_type` の CHECK に `flight_plan`・`saved_place` を足す。追加前・追加後のトリガーと `verify_record_chain` は 0008 と同じ流儀で丸ごと置き換える（既存の 5 つの種類の動きは変えない）。`flight_plan` の作成は組織単位で直列化しない（重なりの検査はない）。
- `flight_records.flight_plan_id` → `flight_plans(id)`、`(snapshot_id, flight_plan_id, org_id)` → `judgement_snapshots(id, plan_id, org_id)` の外部キー（snapshot_id が NULL のときは検査しない）。
- `evidence_log` は変えない。

**B6. 権限**（`do $$ if exists (… soraban_app) …` の流儀）

| 表 | `soraban_app` |
|---|---|
| `judgement_snapshots`、`plan_confirmations` | SELECT・INSERT のみ。UPDATE・DELETE・TRUNCATE なし |
| `flight_plans`、`saved_places` | SELECT のみ（書くのは `record_versions` への追加→トリガー） |

**B7. アプリ側の型**：`packages/db/src/types.ts` に行の型と列の一覧を足し、`OPS_TABLES`・`TABLE_COLUMNS` に新しい表を入れる（`schema-columns.test.ts` が SQL と突き合わせる）。`MIGRATION_VERSIONS` を更新する。

### C. 計画の状態・版・鮮度・確認（導出）

- **保存する状態**は `draft`／`active` と、取消（中止）だけ。「確認待ち」「確認済み」などは、確認の記録と計画の版から**読み出しのたびに求める**。純粋関数 `confirmationState(plan, confirmations)` を 1 か所に置く：

  | 導出の状態 | 条件 |
  |---|---|
  | 下書き | `status = draft` |
  | 確認待ち | `active` で、確認の記録がない |
  | 確認済み | 最新の確認が `approved` で、`plan_version` が計画の最新の版 |
  | 前の版への確認（再確認が必要） | 最新の確認が `approved` だが、計画がその後に訂正されている |
  | 差し戻し | 最新の確認が `returned` で、`plan_version` が計画の最新の版 |
  | 修正済み（再確認待ち） | 最新の確認が `returned` だが、計画がその後に訂正されている |
  | 中止 | 取消の版 |

  自己確認のときは「確認済み（自己確認）」と併記する。
- **「確認を依頼する」**（`draft` → `active`）は計画の訂正の版として残す（理由「確認を依頼」）。
- **鮮度**：純粋関数 `snapshotFreshness({snapshot, plan, aircraft, now: {engineVersion, datasetVerifiedAt(id), proceduresRevision}})`。次のいずれかで「判定が古い」と理由を返す：`input_changed`（`buildJudgementInput(plan, aircraft)` がスナップショットの `input` と異なる。機体の重量の変更を含む）、`engine_changed`（`engine_version` が現在の `ENGINE_VERSION` と異なる）、`data_changed`（スナップショットの `datasets` のどれかの確認日が現在の台帳と異なる）、`procedures_changed`（手続きデータの版が異なる）。一覧では `result` を読まずに計算する。
- **再判定**：「判定が古い」のとき、または手動で「判定をやり直す」。新しいスナップショット（`data_updated`／`manual`）と、`current_snapshot_id` を替えた計画の訂正の版を作る。計画の版が上がるため、確認は「前の版への確認」になる。

### D. 認可（`authz.ts` に行を足す。単体テストで全組合せ）

| 操作 | 運航管理者 | 操縦者 | 閲覧者 |
|---|---|---|---|
| `plan.read`・`snapshot.read`・`place.read` | 可 | 可 | 可 |
| `plan.create`・`plan.update`（再判定・確認依頼を含む）・`plan.cancel` | 全員分 | 自分が操縦者の計画だけ | 不可 |
| `plan.confirm`（確認・差し戻し） | 可 | 不可 | 不可 |
| `place.create`・`place.update`・`place.void` | 可 | 不可 | 不可 |

- 閲覧は、既存の飛行記録に合わせて全役割が全件を読める（sprint-12.md §2.7 の「操縦者は自分の飛行と機体」とは異なる。現状の動きに合わせて確定。技能証明書番号の扱いは変えない）。
- 運航管理者が自分の計画を確認することは許す（自己確認と記録・表示する）。
- すべて `org_id` を条件にし、他の組織の計画・スナップショット・地点は 404。

### E. API（すべて `opsHandler`。`OPS_ENABLED` 無効なら 404）

| メソッド・経路 | 内容 |
|---|---|
| `GET`・`POST /api/ops/plans` | 一覧（`from`・`to`・`status`・`includeVoided`）、作成（201。同じ `clientRequestId` は既存を 200） |
| `GET`・`PATCH /api/ops/plans/[id]` | 取得（導出の状態・鮮度・通報の要否を含む）、訂正（`expectedVersion`・`reason` 必須） |
| `POST /api/ops/plans/[id]/void` | 中止（理由必須） |
| `POST /api/ops/plans/[id]/request-confirmation` | 確認を依頼 |
| `POST /api/ops/plans/[id]/rejudge` | 判定をやり直す |
| `GET`・`POST /api/ops/plans/[id]/confirmations` | 確認の履歴、確認・差し戻し（`decision`・`reason`・`expectedVersion`） |
| `GET /api/ops/plans/[id]/snapshots`、`GET …/snapshots/[sid]` | スナップショットの一覧（`result` を除く）、1 件（`result` を含む） |
| `GET /api/ops/plans/[id]/versions` | 版の履歴 |
| `GET`・`POST /api/ops/places`、`GET`・`PATCH /api/ops/places/[id]`、`POST …/void`、`GET …/versions` | よく使う地点 |
| `POST /api/ops/flights`（既存） | `flightPlanId` を受ける（設計 G） |

- 誤りの形は既存と同じ（400 `invalid_input` と項目ごとの理由コード、403、404、409 `voided`・`version_conflict`・`aircraft_unavailable`・`not_requested`・`duplicate_request`、503 `judgement_failed`）。
- 経路は Next.js のルートハンドラ。`route.ts` は薄く、処理は `server/ops/plans.ts`・`places.ts` に置く（既存の `records.ts` と同じ作り）。

### F. 画面（スマートフォン 375px で横スクロールなし。designer が見た目を整える）

| 経路 | 内容 |
|---|---|
| `/ops/plans` | 計画の一覧（これから／過去／中止）。各行に予定日時・計画名・機体・操縦者・導出の状態・通報の要否・「判定が古い」の印。運航管理者には「確認待ち」の絞り込み |
| `/ops/plans/new`、`/ops/plans/[id]/edit` | 計画のフォーム（下の項目）。判定画面から来たときは入力を引き継ぐ |
| `/ops/plans/[id]` | 詳細：①概要 ②**判定の要約**（現在のスナップショットの 4 段の結論・判定不能の件数・段取りの上位・証跡 ID・「判定が古い」と理由・再判定）③**通報の要否**（設計 I）④**確認の状況**（導出の状態、確認・差し戻しの履歴、運航管理者の操作）⑤この計画に結びついた飛行記録と「飛行記録を作る」⑥版の履歴 |
| `/ops/plans/[id]/snapshots` | スナップショットの一覧（通し番号・作成日時・理由・結論・証跡 ID・エンジンの版）。現在のものに印。履歴で並べて見られる |
| `/ops/plans/[id]/snapshots/[sid]` | **判定の根拠**：保存した `result` を、判定画面と同じ部品で読み取り専用に描く。証跡 ID（地点判定・申請支援）、エンジンの版、使ったデータセット（名称・基準年・確認日）、手続きデータの版と確認日、作成者・日時、ハッシュ。再計算はしない（保存したものを見せる） |
| `/ops/places`、`/ops/places/new`、`/ops/places/[id]` | よく使う地点の一覧・登録・訂正・取消（運航管理者）。全役割は一覧を見られる |
| `/ops`（既存） | メニューに「飛行計画」「よく使う地点」を足し、入力できる人には「飛行計画を作る」を足す |

- **計画のフォーム**：計画名、機体、操縦者（操縦者役割は自分に固定）、予定開始（JST）、所要時間、目的、場所（「よく使う地点」から選ぶ／座標を入れる／判定画面から引き継ぐ。地図と住所検索は既存の部品を使える範囲で。使えなければ座標入力と住所検索で足りる）、範囲の半径、最大高度、飛行の方法と空域（判定画面と同じ選択肢・文言）、許可の種類（判定画面と同じ）、目的の例外、立入管理措置など、許可・承認の番号、メモ。選択肢の文言は `@soraban/regulations` の定数（`SPECIFIC_FLIGHT_FLAG_LABEL`、`DIPS_PERMIT_LABEL`、`PERMIT_VALUE_LABEL` など）を使い、別に書かない。
- 現在地の座標は、利用者が「この地点を使う」で確定するまで送らない（Sprint 9 の方針）。
- 保存中は「判定中」と出す。失敗したら入力を残して理由を示す（Sprint 11 の下書きの保持を使える範囲で）。
- 固定の文言（詳細・フォームの目立つ位置）：「判定は入力された情報の範囲での目安です。申請・通報は DIPS 2.0 などの公式の手続きで行ってください。」

### G. 日誌（飛行記録）との紐付け

- `POST /api/ops/flights` は `flightPlanId`（任意）を受ける。あれば、同じ組織で取消されていない計画を確かめ（他の組織は 404、中止は 409 `plan_cancelled`）、**`snapshot_id` は計画の現在のスナップショットをサーバーが入れる**（リクエストの `snapshotId` は読まない）。
- 計画と違う機体・操縦者・時間帯の記録は止めず、応答の `warnings` に `differs_from_plan` を足す（現場の差し替えがありうるため）。
- 訂正では、`flight_plan_id` が NULL のときだけ後から設定できる（後入力の紐付け）。設定した後の付け替え・解除はできない（誤りは取消して作り直す）。
- 計画の画面の「飛行記録を作る」は `/ops/flights/new?planId=…` を開き、機体・操縦者・目的・離着陸場所の名称と座標・特定飛行の形態を引き継ぐ。形態はスナップショットの結果の `flags`（DID・空港の導出を含む）から、既存の `SPECIFIC_FLIGHT_TYPES` に写す（`airspace_airport`→`airport_vicinity`、`airspace_150m`→`above_150m`、`airspace_did`→`did`、`airspace_emergency`→`emergency_airspace`、`method_night`→`night`、`method_bvlos`→`bvlos`、`method_30m`→`within_30m`、`method_event`→`event`、`method_dangerous`→`dangerous_goods`、`method_drop`→`dropping`）。**離着陸の時刻は引き継がない**（事実は実際の時刻を入れる。自動入力は 12c）。
- `FlightDto` に `judgementLink` を足す：`linked`（計画あり）／`not_required`（特定飛行の形態なし・計画なし）／`missing`（特定飛行の形態があるのに計画なし）。`missing` は一覧と詳細に「判定の根拠が紐づいていません」と出す。計画なしの記録は従来どおり作れる。
- 飛行記録の詳細に「飛行計画」と「判定の根拠」（スナップショットの画面）へのリンクを置く。**飛行記録の一覧から数えて 3 タップ以内に、証跡 ID・エンジンの版・データセットの版と確認日に着く**（一覧 → 詳細（1）→ 判定の根拠（2））。

### H. 通報の要否の表示（記録は 12b）

- 純粋関数 `reportRequirement(snapshot)` を `packages/regulations/src/report-requirement.ts` に置く（`index.ts` から export を足すだけで、既存のファイルは変えない）。入力はスナップショットの `input` と `result`（`droneWeightG`・`category`・`flags`・`verdict`）。出力は 4 種：

  | 条件（上から順に判定） | 表示 | 根拠 |
  |---|---|---|
  | 重量が不明（`droneWeightG` なし）、または結果が成立していない | **通報：要確認（要として扱います）** | 「機体の重量が分からないため」 |
  | 100g 未満 | **通報：DIPS の飛行計画の通報は対象外（模型航空機）** | 航空法の無人航空機の規制は対象外。第134条の3 の許可・通報は別の手続きとして判定の段取りに並ぶ（既存） |
  | 100g 以上で、`category` が `I` 以外（`needs_verification`・`II_A`・`II_B_eligible`・`III_level4`・`emergency_no_fly`） | **通報：要** | 当たった特定飛行を `flags` からすべて並べる（例：「夜間飛行に当たるため」）。`needs_verification` は「DID の該当を確認できない（判定不能）ため、要として扱う」。`emergency_no_fly` は要として、「緊急用務空域のため飛行できない判定」を併記 |
  | 100g 以上で、`category` が `I` | **通報：義務ではないが推奨** | 特定飛行に当たる項目がないため |

- **「通報不要」の言葉は、どの入力でも、どの文言にも出さない。** 通報の要を打ち消す上書きを設けない。目的の例外（`emergency`・`public_duty`）のときだけ、「国・地方公共団体などの捜索・救助等の飛行は、通報の対象から外れる例外に当たる可能性があります（※要確認）。この表示は変えず、要として扱います。」を添える。
- 通報要領の期限は「あらかじめ」で、数値の期限は確認できていない（※要確認。sprint-12.md §2.3）。12a では期限・漏れの警告は出さない（12b）。
- 添える固定の文言：「そらばんは DIPS に送信しません。通報は DIPS 2.0 で行ってください。申請・通報は DIPS 2.0 などの公式の手続きで行ってください。通報の記録の機能は次の版で追加します。」
- 表示用の文言は同じファイルの定数に集め、画面は定数だけを使う。

### I. よく使う地点（社内拠点）

- 運航管理者が登録・訂正・取消（版の履歴）。計画のフォームの「場所」で選ぶと、名称と座標が計画に写る（`saved_place_id` も残る）。
- 本番での登録は、運航管理者が `/ops/places` から行う（ユーザー作業 U8。座標は「社内拠点の座標」の値を、地図で確かめてから）。コードに本社の座標を直書きしない（組織ごとのデータ）。
- テスト用の初期データ（`ops-seed.ts`、組織 A）に「フューチャーテック株式会社 本社」（住所・座標は上の表）を足す。

### J. 入口と機能フラグ

- `OPS_ENABLED` が無効の間は、`/ops/*`・`/api/ops/*` は 404 のまま（`proxy.ts` が既に守る）。新しい経路は同じ matcher の内側に置く。
- **`/` の「運航管理」リンク**と、判定結果の「**この判定で飛行計画を作る**」ボタンは、運航管理が有効でログイン済みの利用者にだけ出す。`/` は静的シェルのまま保つ：リンクとボタンは、Suspense の内側の動的な部分（Next.js 16 の `cacheComponents` の作り方。`node_modules/next/dist/docs/` を参照）か、同等の方法で出す。運航管理が無効のとき、`/` に追加の要求（404 のコンソールエラー）を出さない。
- ボタンは判定の**入力**（座標、機体重量、フラグ、許可、予定日）だけを `/ops/plans/new` に引き継ぐ。判定の結果は引き継がない（計画の保存時にサーバーが再実行する）。機体は引き継がない（利用者が選ぶ）。判定の画面・PDF・履歴・証跡 ID は変えない。

### K. 証跡 ID・`ENGINE_VERSION`・個人情報

- 変えないもの：`packages/regulations/src` の既存ファイル（`index.ts` への export の追加を除く）、`packages/regulations/data`、`ENGINE_VERSION`、`/api/check`・`/api/diagnose` の応答、`evidence_log` の列。固定の入力で、地点判定・申請支援の証跡 ID が c4f13ee と一致する（契約 21）。
- 計画・スナップショットに入れない：技能証明書番号、操縦者の氏名（ID だけ。画面で名前を引く）、メールアドレス。確認者の表示名の写しは持つ。
- スナップショットの座標は、利用者が計画に入れた地点（本人の組織のデータ）。他の組織から読めない。

### L. テストと CI

- 単体（vitest）：`runDiagnosis` の同一性、`buildJudgementInput`、`snapshotFreshness`、`confirmationState`、`reportRequirement`（全組合せ）、`authz`、入力の検査（`validate-plan.ts`）、`types`・列の一覧。
- DB（`pnpm test:db`、`plans.db.test.ts` を新設）：権限・トリガー・ハッシュ・外部キー・原子性・版の履歴・組織の分離。
- **E2E-DB（`pnpm test:e2e:ops`、`e2e/ops-db/sprint12a-db.spec.ts` を新設）**：通し（計画 → 確認 → 日誌 → 根拠、通報の要否の 4 種）、権限、入口。**`playwright.ops.config.ts` に `e2e/mock-gsi-server.mjs` と `GSI_REVERSE_GEOCODER_ENDPOINT` を足す**（判定の結果を外部サービスに左右させない）。
- 通常の E2E（DB なし・`OPS_ENABLED` なし）：`/` にリンクとボタンがないこと、`/ops/plans`・`/api/ops/plans` が 404 であること。
- CI（`.github/workflows/ci.yml` の db ジョブ）：「soraban_app の権限」の確認に新しい表（`judgement_snapshots`・`plan_confirmations` は INSERT=t・UPDATE=f・DELETE=f・TRUNCATE=f、`flight_plans`・`saved_places` は INSERT=f・UPDATE=f）を足す。全マイグレーションの適用と、2 回目に何もしないことは既存のまま通る。

## 担当と進め方

標準フロー（直列）：generator → designer → evaluator。generator は 2 つに分けて依頼し、1 つ目のあとで中間の確認をする。

| 順 | 担当 | 内容 | 終わりの確認 |
|---|---|---|---|
| 1 | generator（G1：土台） | マイグレーション、`types.ts`、`runDiagnosis` の切り出し、`buildJudgementInput`・`snapshotFreshness`・`confirmationState`・`reportRequirement`、サービス層・API（計画・確認・地点・飛行記録の紐付け）、認可、単体・DB のテスト、`ops-seed.ts`、CI の権限の確認。見た目は不要 | `pnpm typecheck`・`lint`・`test`・`test:db` が通る。契約 1〜12・15・19・21・22 の DB・単体の部分（オーケストレーターが API を直接叩いて確かめてもよい） |
| 2 | generator（G2：画面） | 計画・スナップショット・地点の画面、日誌の紐付けの画面、入口（`/` のリンクとボタン）、E2E-DB の追加、通常の E2E の追加。見た目は最低限 | E2E・E2E-DB が通る。契約 13・14・16・17・18 |
| 3 | designer | 計画の一覧・詳細・フォーム・判定の根拠の画面、確認の状況の見せ方、通報の要否の札を既存の見た目（紙面調）に合わせて磨く。ロジック・経路・`data-testid`・文言の定数は変えない。375px、色だけで区別しない（状態を文字と記号でも示す） | 契約 20 |
| 4 | evaluator | Playwright MCP で、契約とデザイン 4 基準を採点。DB を使う確認は E2E-DB のログと DB テストの結果で確かめる | 合否レポート（差し戻し先を明記） |

- 差し戻しは同一スプリントで最大 3 回を目安にする（CLAUDE.md）。
- 現場試用（Sprint 11、2027-01）で出た軽微な修正は、**契約の外の予備枠**として最大 2 日まで受ける（起票されたものだけ。契約の合否に含めない）。

## 範囲外

- 通報の記録・コピー・期限・漏れの警告・ゲートウェイ（12b）、「今日」・下メニュー・現場モード・日誌の自動入力（12c）、許可・承認の登録と範囲の照合（12d）、事故・ヒヤリハット（12e）、期限一覧（12f）
- 100g 未満の機体の計画（機体を登録できないため。運航管理で扱うかは後続の検討）
- 計画の複製、差し戻しの理由の分類、1 計画に複数の機体・操縦者、多角形の範囲、24 時間を超える飛行、周期的な計画
- 計画の PDF 出力・証跡の出力（Sprint 15）
- 確認の通知（メール・プッシュ）。確認待ちは一覧の絞り込みで見つける
- 判定ロジック・証跡 ID・`ENGINE_VERSION`・`procedures.json`・規制データの変更
- 本番の DB・Neon Auth・Vercel の環境変数の操作

## スプリント契約（完了条件）

「単体」は vitest、「DB」は `pnpm test:db`（`plans.db.test.ts`）、「E2E-DB」は `pnpm test:e2e:ops`、「E2E」は通常の Playwright、「目視」は evaluator が Playwright MCP で確かめる項目。全 22 項目。

### A. 判定スナップショット（サーバー実行・不変）

- [ ] 1. （単体）`runDiagnosis` を切り出した後も、固定の時計・固定のデータの読み込み口で、`/api/diagnose` の応答が c4f13ee の応答と JSON として完全に一致する（既存の基準 `sprint11d-verdict-baseline.json` の入力と、夜間・DID 内・空港周辺・緊急用務空域・許可入力・目的の例外を含む追加の入力 8 件以上）。
- [ ] 2. （DB・E2E-DB）計画を保存すると、サーバーが判定を実行して `judgement_snapshots` が 1 件（`seq = 1`、`reason = initial`）できる。リクエストに偽の判定（例：夜間の計画に `verdict.level: "no_procedure"` の `result`）を入れても、保存されるのはサーバーが実行した結果（`needs_procedure`）。
- [ ] 3. （DB）スナップショットに、入力、結果一式、`engine_version`、`datasets`（確認日つき）、`procedures_revision`・`procedures_verified_at`、`check_evidence_id`、`diagnosis_evidence_id`、`content_hash` が入る。同じトランザクションで `evidence_log` に `check_evidence_id` の行ができる（`EVIDENCE_LOG=off` でも）。保存した入力と結果から `computeDiagnosisEvidenceId` で再計算した値が `diagnosis_evidence_id` と一致する。
- [ ] 4. （DB・CI）`soraban_app` で `judgement_snapshots`・`plan_confirmations` の UPDATE・DELETE・TRUNCATE が権限エラー（42501）になり、INSERT と SELECT はできる。`flight_plans`・`saved_places` への直接の INSERT・UPDATE・DELETE も権限エラー。オーナーロールで UPDATE・DELETE・TRUNCATE しても、トリガーが拒む（SB409 `immutable`）。CI の `has_table_privilege` の確認に同じ内容が入っている。
- [ ] 5. （DB）`seq`・`prev_hash`・`content_hash`・`created_at` は DB が決め、INSERT で偽の値を渡しても上書きされる。`verify_judgement_snapshots` は改変のない計画で 0 行を返し、オーナーでトリガーを無効にして `result` や `content_hash` を書き換えた場合に問題を返す。
- [ ] 6. （DB・API）原子性：判定の失敗・時間切れ（注入）では 503 `judgement_failed` を返し、`record_versions`・`judgement_snapshots`・`evidence_log` のどれにも行が残らない。スナップショットの挿入後に計画の版の追加が失敗した場合も、スナップショットが残らない。

### B. 計画の版・再判定

- [ ] 7. （API・DB）計画の作成・訂正・中止が `record_versions`（`flight_plan`）に版として残り、`verify_record_chain` が 0 行を返す。物理削除はない。中止した計画の訂正・確認・確認の依頼・再判定・飛行記録の紐付けは 409。同じ `clientRequestId` の作成は新しい計画を作らず既存を返す。他の組織の計画は 404。
- [ ] 8. （API・DB）判定に関わる項目（場所、予定日、飛行の方法・空域、最大高度、許可、目的の例外、立入管理措置など）を訂正すると、新しい版と新しいスナップショット（`seq + 1`、`reason = input_changed`）が同じトランザクションでできる。古いスナップショットの `content_hash` は変わらず、一覧に並ぶ。判定に関わらない項目（計画名、メモ、許可番号の文字、目的の自由記述）の訂正ではスナップショットが増えない。機体は訂正で変えられない。
- [ ] 9. （単体・E2E-DB）`snapshotFreshness` が、入力の一致で「新しい」、機体の最大離陸重量の変更で `input_changed`、エンジンの版・データセットの確認日・手続きデータの版の違いで `engine_changed`・`data_changed`・`procedures_changed` を返す（注入した現在値で網羅）。画面の「判定が古い」と理由が出て、「判定をやり直す」で新しいスナップショット（`manual`／`data_updated`）と新しい計画の版ができ、古いスナップショットは残る。

### C. 運航管理者の確認

- [ ] 10. （DB・API）運航管理者が確認すると、`plan_confirmations` に確認者・日時・計画の版・スナップショット ID が残る。差し戻しは理由が必須（空は 400、DB の CHECK でも拒否）。`draft` の計画、取消した計画、最新でない版への確認は 409。`self_confirmation` は DB が決め、自分が保存した版・自分が操縦者の計画で true。操縦者・閲覧者の確認は 403。
- [ ] 11. （単体・E2E-DB）`confirmationState` が、下書き・確認待ち・確認済み・前の版への確認・差し戻し・修正済み（再確認待ち）・中止を網羅して導出する。画面で、確認の後に計画を訂正すると「前の版への確認（再確認が必要）」と出て「確認済み」とは出ない。自己確認は「自己確認」と併記される。確認の画面に、判定不能の件数と、出典・確認日が古い項目（90 日超）が出る。

### D. 日誌との紐付け

- [ ] 12. （API・DB）`POST /api/ops/flights` に `flightPlanId` を付けると、`flight_plan_id` と、計画の現在の `snapshot_id`（サーバーが決める。リクエストの `snapshotId` は無視）が保存される。他の組織の計画は 404、中止した計画は 409。DB の外部キーが、別の計画のスナップショットを結ぶことを拒む。訂正で `flight_plan_id` を付け替え・解除できず、NULL のときだけ設定できる。計画と違う機体・操縦者・時間帯のときは保存して `differs_from_plan` を返す。
- [ ] 13. （E2E-DB）計画の画面の「飛行記録を作る」で、機体・操縦者・目的・場所・特定飛行の形態（DID・空港の導出を含む）が入る。離着陸の時刻は空のまま。保存すると計画の画面にその記録が並ぶ。
- [ ] 14. （E2E-DB・目視）飛行記録の一覧から、詳細（1 タップ）→ 判定の根拠（2 タップ）で、証跡 ID（地点判定・申請支援）、エンジンの版、データセットの版と確認日、手続きデータの版が見える。計画なしの飛行記録は従来どおり作れ、特定飛行の形態があって計画に結びつかない記録には一覧と詳細で「判定の根拠が紐づいていません」と出る。

### E. 通報の要否

- [ ] 15. （単体）`reportRequirement` が、重量（なし・50g・100g・900g・25kg 以上）× `category`（6 種）× 目的の例外の全組合せで、期待の 4 種（要確認・対象外（模型航空機）・要・推奨）を返す。重量なし・結果なしは要確認。`category` が `I` 以外は要で、根拠に当たったフラグがすべて並ぶ。どの出力の文言にも「通報不要」「通報は不要」「通報の必要はありません」「通報しなくて」が含まれない（表示用の定数と、組み立てた全文を検査）。
- [ ] 16. （E2E-DB）計画の画面：夜間飛行の計画で「通報：要」と「夜間飛行に当たるため」。DID の該当を確認できない地点（模擬の逆ジオコーダが市町村を返さない地点）で「通報：要」と判定不能の根拠。特定飛行に当たらない計画で「通報：義務ではないが推奨」。重量が未登録の機体で「通報：要確認（要として扱います）」。すべての画面に「そらばんは DIPS に送信しません」と「申請・通報は DIPS 2.0 などの公式の手続きで行ってください」が出て、画面全文に契約 15 の禁止語がない。

### F. よく使う地点

- [ ] 17. （API・DB・E2E-DB）運航管理者が地点を登録・訂正・取消でき（版の履歴）、全役割が一覧を見られ、操縦者・閲覧者の登録は 403、他の組織の地点は 404。「フューチャーテック株式会社 本社」を座標 35.434238, 133.380508 で登録でき、計画のフォームで選ぶと名称と座標が入る。現在地の座標は確定の操作まで通信に出ない（要求の本文を検査）。

### G. 入口・認可・表示・回帰

- [ ] 18. （E2E・E2E-DB）`OPS_ENABLED` が無効：`/` に運航管理のリンクも「この判定で飛行計画を作る」もなく、`/ops/plans`・`/api/ops/plans` が 404、コンソールに追加のエラーが出ず、`pnpm build` の出力で `/` が静的シェル（部分的な事前描画）のまま。有効でログイン済み：リンクとボタンが出て、ボタンで入力（座標・重量・フラグ・許可・予定日）を引き継いだ計画のフォームが開く。判定の結果は引き継がれず、保存でサーバーが判定を再実行する。
- [ ] 19. （単体）`can()` が新しい操作（`plan.*`・`snapshot.read`・`place.*`）で全役割 × `isSelf` の組合せを網羅し、§D の表のとおりになる。`OPS_ACTIONS` に新しい操作がすべて入っている。
- [ ] 20. （目視・E2E-DB）画面と文言に特許・出願の表示がない。375px で横スクロールがない。状態（確認の導出、鮮度、通報の要否、判定の結論）を色だけで区別せず、文字か記号を添える。タップの的は 44px 以上。固定の文言（判定は目安・DIPS で行う）が計画の詳細とフォームに出る。
- [ ] 21. （単体・grep）回帰：`ENGINE_VERSION` が `soraban-0.4.0-verdict-2026-10` のまま。固定の入力で、地点判定・申請支援の証跡 ID が c4f13ee と一致する（既存の `sprint10a.test.ts`・`sprint11e.test.ts` などが無変更で通る）。`git diff` で、`packages/regulations/src` の既存ファイルと `packages/regulations/data` に変更がない（`index.ts` の export の追加と新規ファイルを除く）。Sprint 10・11・11a〜11f の既存テスト（単体・DB・E2E・E2E-DB）がすべて通る。
- [ ] 22. （CI・DB）マイグレーションは 0010 以降の追記だけで、0001〜0009 を変えない。`MIGRATION_VERSIONS` が更新され、`migrations-manifest.test.ts` と `schema-columns.test.ts` が通る。CI の db ジョブで空の DB に全マイグレーションが通り、2 回目は何もしない。`pnpm typecheck`・`lint`・`test`・`test:db`・`build` が通る。

## 分量の判断と削る順

機能は 5 件（計画、スナップショット、確認、日誌との紐付け、通報の要否）に、よく使う地点と入口が付く。契約 22 項目は §13.6 の目安（10〜20）を 2 件超えるが、増えた分は DB の権限・原子性・ハッシュ・認可・CI の検証であり、機能の数は増えていない。遅れたときに削る順：

1. よく使う地点（契約 17）を 12b の初めに回す（計画のフォームの座標入力は残る）。
2. 計画の一覧の「判定が古い」の印と絞り込み（詳細の表示は残す）。
3. スナップショットの一覧の「並べて見る」の見せ方（一覧と 1 件の表示は残す）。

**削らないもの**：スナップショットの不変保存（契約 2〜6）、保存時のサーバー実行、運航管理者の確認、日誌から根拠への辿り、「通報不要」を出さない通報の要否。

## リスク

| リスク | 備え |
|---|---|
| `runDiagnosis` の切り出しで `/api/diagnose` の応答が変わる | 契約 1（応答の完全一致）。切り出しは別のコミットにし、先にテストを通す |
| 判定の実行が遅い・失敗する（国土地理院の逆ジオコーダ。5 秒で打ち切り、失敗時は市町村なしで縮退） | 20 秒の上限。失敗時は何も保存せず 503。市町村が分からない場合の判定は既存の縮退（判定不能＝要手続き）のまま保存される |
| 0010 でトリガー関数を丸ごと置き換え、既存の 5 種類の動きを壊す | 既存の DB テスト（`records.db.test.ts`・`ops.db.test.ts`）を無変更で通す。置き換えは 0008 と同じ流儀で、既存の分岐は文字どおりに写す |
| 循環する外部キーで、保存の順序によって失敗する | 遅延可能な外部キーで、コミット時に検査。契約 6 で失敗時の巻き戻しも確かめる |
| 利用者が機体の重量を修正して、古い計画の判定が実態とずれる | 鮮度（`input_changed`）で「判定が古い」と出す |
| 自己確認が形式になる | 自己確認を記録と画面に出す。確認の画面に判定不能の件数と古い出典を出す |
| 通報の要否を誤って「不要」に見せる | 4 種の表示のみ。禁止語の検査（契約 15・16）。迷えば要・要確認に倒す |
| 通報要領の改正（2026-03-31）の内容が未確認 | 12a は要否の表示だけで、通報事項・期限は扱わない。12b の着手前に確認（U3） |
| 本社の座標が実際の位置とずれる | 本番に登録する前にユーザーが地図で目視（U8）。コードに直書きしない |

## ユーザー作業（エージェントは行わない）

| 番号 | 作業 | 時期 |
|---|---|---|
| U8 | 本社（鳥取県西伯郡日吉津村日吉津45番地3）の位置を、地図で目視して 35.434238, 133.380508 と一致するか確かめる。ずれていれば正しい座標を知らせる | 本番で `/ops/places` に登録する前 |
| U1・U2 | 本番の DB 準備と Neon Auth の有効化、最後に `OPS_ENABLED=1`（`docs/runbooks/production-db-prep.md`、`packages/db/README.md`）。12a のマイグレーションは U1 のあとにまとめて適用される。2027-01 中旬までを推奨 | 12a を本番で使う前 |
| 本番での登録 | 運航管理者として、`/ops/places` から本社を登録する。計画を 1 件作って、判定の根拠の画面まで辿れることを確かめる | 12a を本番で使い始めるとき |

開発・検証・マージの間にユーザー作業はない。

## 未決事項

**推奨どおりで確定したもの**（ユーザー承認 2026-10-21。sprint-12.md §7.2 の 13 件のうち 12a に関わるもの：2 自動の転送はしない、3 自己確認を許す、6 範囲は点と半径）に加え、本書の設計で決めたこと（保存時の自動実行、機体の重量は登録機体から取る、閲覧は全役割が全件、中止は操縦者も自分の計画で可、100g 未満は範囲外）。

**ユーザーに伺うこと**：なし。U8（本社の位置の目視確認）は 2026-10-21 に確認済み。本番の DB 準備と Neon Auth の有効化（U1・U2）は「2027-01 中旬までなら大丈夫」との回答（2026-10-21）。
