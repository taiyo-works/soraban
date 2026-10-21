# `@soraban/db`

Neon（PostgreSQL 18 + PostGIS 3.6、aws-ap-southeast-1、プロジェクト `soraban`）への接続層と、SQL マイグレーション（Sprint 8）。

- ドライバ：`pg`（node-postgres）。ローカル・CI の PostgreSQL コンテナと本番 Neon で同じドライバを使う。
- マイグレーション：`packages/db/migrations/NNNN_名前.sql` と自前の最小ランナー（`src/migrate.ts`）。
- 運航管理（Sprint 10）：組織・利用者・機体・操縦者の表と、版の履歴（`record_versions`、ハッシュ連鎖）。本人確認（Neon Auth）はアプリ（`apps/web/src/server/ops`）が扱い、本パッケージのマイグレーションは `neon_auth` スキーマに触れない。

## 環境変数

| 変数 | 用途 | 置き場所 |
|---|---|---|
| `DATABASE_URL` | アプリ用。Neon の **Pooled connection**（ホスト名に `-pooler`）。未設定なら DB に接続せず、地点判定・申請支援は DB なしで動く | Vercel の Production だけ。ローカルは `.env.local` |
| `DATABASE_URL_UNPOOLED` | マイグレーション用。Neon の **Direct connection** | 実行する人の手元のシェルだけ（ファイルや履歴に残さない） |
| `EVIDENCE_LOG` | `off` で証跡（`evidence_log`）の書き込みを止める | 必要なときだけ |
| `OPS_ENABLED` / `AUTH_PROVIDER` / `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` | 運航管理（Sprint 10）。既定は無効。下記「運航管理（Sprint 10）の本番準備」 | Vercel の Production だけ（準備が済んでから） |
| `AUTH_TEST_SECRET` | `AUTH_PROVIDER=test`（CI・E2E・ローカル専用）の Cookie の署名 | CI・ローカルだけ。本番に設定しない |
| `TEST_DATABASE_URL` / `REQUIRE_DB_TESTS` | `pnpm test:db` の接続先（管理用。テストが使い捨てのデータベースを作る）／`1` で未設定時に失敗させる | CI の `db` ジョブ、ローカル |

値（接続文字列）はリポジトリに置かない。`.env.example` には名前だけを書いている。

### `sslmode` は `verify-full` を推奨

- Neon の Connect 画面が出す接続文字列は `sslmode=require` だが、`sslmode=verify-full` に書き換えて使う（`DATABASE_URL`・`DATABASE_URL_UNPOOLED` とも）。
- 理由：pg 8.23 は `sslmode=require` を受け取ると SECURITY WARNING を出す。現在は `require` も証明書とホスト名を検証する扱いだが、pg の次のメジャー版で libpq と同じ意味（暗号化のみで、証明書を検証しない）に変わると予告されている。`verify-full` なら今後も検証が保たれる。
- Neon は `verify-full` に対応し、推奨もしている（出典：https://neon.com/docs/connect/connect-securely 、2026-10-19 確認）。Neon の証明書は Let's Encrypt（ISRG Root X1）で、Node.js が内蔵するルート証明書に含まれるため、証明書ファイル（`sslrootcert`）の指定は要らない。
- ローカル・CI のコンテナ（TLS なし）では `sslmode` を付けない。

## 接続層（`src/pool.ts`・`src/config.ts`）

- `getPool()` は `DATABASE_URL` から `pg.Pool` を遅延生成して使い回す。未設定なら `null`（接続を試みない）。`isDbConfigured()` で判定できる。
- 設定値は `DB_POOL_DEFAULTS`（`src/config.ts`）の 1 か所にまとめている。

| 設定 | 値 | 理由 |
|---|---|---|
| 接続タイムアウト | 5 秒 | scale-to-zero で停止中の計算資源の起動待ち（数百 ms〜数秒）を見込む |
| 文のタイムアウト | 5 秒（クライアント側 `query_timeout`） | Neon のプール（PgBouncer）は未対応の起動パラメータを拒否するため、サーバー側 `statement_timeout` を起動パラメータで送らない |
| 最大接続数 | 3 | 関数 1 インスタンスあたり。Neon 側のプールが多重化する |
| 待機接続の破棄 | 5 秒 | 関数の延長稼働と計算資源の起動維持を短くする |

### `attachDatabasePool`（`@vercel/functions`）：採用

- Vercel の推奨（Fluid compute でプールを使い回す場合）。プール作成直後に `attachDatabasePool(pool)` を呼ぶと、関数が停止する前に待機接続が破棄されるまで関数を生かす（接続の取り残しを防ぐ）。
- Vercel 以外（`VERCEL_URL`・`VERCEL_REGION` が無い環境：ローカル・CI・`next build`）では何もしない（`@vercel/functions@3.10.1` の実装で確認、2026-10-19）。
- 延長されるのは待機接続の破棄時間（5 秒）＋α に限られるため、従量課金への影響は小さい。

## マイグレーション

### 規則

- ファイルは `migrations/NNNN_名前.sql`（4 桁の連番、名前は英小文字・数字・`_`）。0001 から欠番なく並べる。
- 適用済みのファイルは変更しない（チェックサム不一致で中止する）。変更は新しい番号のファイルで行う。
- マイグレーションは追加のみとし、旧コードでも動く形にする（本番は「適用 → デプロイ」の順のため）。
- 新しい版を足したら `src/migrations-manifest.ts` にも版を足す（`/api/health/db` が「未適用の有無」に使う。不一致は単体テストで検出）。
- 表を足したら、手書きの行型（`src/types.ts`）と列名の一覧も足す（`src/schema-columns.test.ts` が SQL と突き合わせる）。アプリ用ロールへの権限付与も同じマイグレーションに書く（後述「DB ロール」）。

| 版 | 内容 |
|---|---|
| 0001 | `regulations`・`regulation_zones`・enum・`set_updated_at`（旧スキーマの移植。意味は変えていない） |
| 0002 | `evidence_log`（旧スキーマの移植） |
| 0003 | `evidence_log.datasets`（判定で使ったデータセット）、`evidence_id` の説明の更新、アプリ用ロールへの権限付与 |
| 0004 | 運航管理：`organizations`（組織）、`members`（利用者のヘッド表） |
| 0005 | 運航管理：`aircraft`（機体）、`pilots`（操縦者）のヘッド表 |
| 0006 | 版の履歴 `record_versions`、追加前・追加後のトリガー、`record_version_hash`・`verify_record_chain`・`ops_bootstrap`、アプリ用ロールへの権限付与 |
| 0007 | 運航管理（Sprint 11）：`daily_inspections`（日常点検記録）・`flight_records`（飛行記録）のヘッド表、時刻の関数（`ops_jst_minute_to_timestamptz` 等）、総飛行時間のビュー（`flight_record_totals`・`aircraft_flight_totals`・`pilot_flight_totals`）、アプリ用ロールへの権限付与 |
| 0008 | 運航管理（Sprint 11）：`record_versions.entity_type` に `daily_inspection`・`flight_record` を追加、追加前・追加後のトリガーと `verify_record_chain` の置き換え（DB が飛行時間を求める、飛行記録の重なりの拒否） |
| 0009 | 判定の 4 段（Sprint 11d）：`evidence_log` に `verdict`（check 制約つき）・`verdict_unknown_count`・`per_regulation_verdict`・`applied_permits` を追加（いずれも null 可。既存の行は null のまま）。`overall`・`per_regulation_status` の列のコメントに、意味を `engine_version` で読み分けること（0.3.0 までは許可を当てた後、0.4.0 からは許可を当てる前の元の判定）を記録。アプリ用ロールの権限は変えない（表単位の insert で新しい列にも追加できる） |
| 0010 | 運航管理（Sprint 12a）：`saved_places`（よく使う地点）・`flight_plans`（飛行計画）のヘッド表、`judgement_snapshots`（判定スナップショット。追記専用）、更新・削除・TRUNCATE を拒むトリガー（`reject_append_only_change`）、`judgement_snapshot_hash`・`verify_judgement_snapshots`、計画 ↔ スナップショットの遅延可能な複合外部キー、`flight_records.flight_plan_id`・`snapshot_id` の外部キー、アプリ用ロールへの権限付与 |
| 0011 | 運航管理（Sprint 12a）：`record_versions.entity_type` に `flight_plan`・`saved_place` を追加、追加前・追加後のトリガーと `verify_record_chain` の置き換え、`plan_confirmations`（運航管理者の確認・差し戻し。追記専用）・`plan_confirmation_hash`、アプリ用ロールへの権限付与 |
| 0012 | 運航管理（Sprint 12b）：`record_versions.entity_type` に `flight_report` を追加、ヘッド表 `flight_reports`（通報の記録）、有効な通報の関数 `flight_report_effective_id`、追加前・追加後のトリガーと `verify_record_chain` の置き換え（0011 の分岐は文字どおり写し、`flight_report` の分岐だけを足す）、アプリ用ロールへの権限付与（参照だけ） |
| 0013 | 運航管理（Sprint 12b）：`flight_report_attempts`（通報の試行・監査。追記専用）、`plan_procedure_records`（手続きの「済み」の記録。追記専用）・`plan_procedure_record_hash`、更新・削除・TRUNCATE を拒むトリガー、アプリ用ロールへの権限付与（参照と追加だけ） |

### ランナー

```sh
pnpm db:status                         # 適用済み・未適用・不一致の一覧（DB を変更しない）
pnpm db:migrate --target <ホスト名>    # 未適用を番号順に適用（localhost・127.0.0.1 は --target 不要）
```

- 接続先は `DATABASE_URL_UNPOOLED`。ホスト名に `-pooler` を含む接続文字列は拒否する（プール経由ではセッション単位のロックが効かない）。
- `localhost`・`127.0.0.1` 以外へ適用するときは `--target` が必須。接続文字列のホスト名と一致しなければ中止する（本番への取り違え防止）。
- 実行前に接続先のホスト名・データベース名と適用予定の版を表示する。パスワードは表示しない。
- 適用記録は `schema_migrations`（版、名前、SHA-256 チェックサム、適用日時、所要時間）。ランナーが自分で作る。
- 同時実行は `pg_advisory_lock` で防ぐ。1 ファイル 1 トランザクションで適用し、失敗したファイルは記録せず、以降も適用せずに非 0 で終了する。
- チェックサム不一致、番号の重複・欠番、ファイルにない版が適用記録にある場合は、何も適用せず非 0 で終了する。
- `next build`・Vercel のビルドではランナーを呼ばない。

## DB 接続確認 API（`GET /api/health/db`）

- 返す値：`configured`、`reachable`、`latencyMs`、`postgresMajorVersion`、`postgisVersion`、`latestAppliedMigration`、`hasPendingMigrations`。接続文字列・ホスト名・ロール名・エラーの生メッセージは返さない。
- 未設定なら接続せず `configured: false`。不達・タイムアウトでも 200 で `reachable: false`（HTTP 状態での監視は想定しない）。
- **定期監視（外部の死活監視、Vercel Cron 等）からは呼ばない。** 呼ぶたびに scale-to-zero 中の計算資源が起動し、従量課金が増えるため。デプロイ後の手動確認に使う。

## 判定証跡（`evidence_log`）

- `/api/check` の応答を返した後（Next.js の `after`）に 1 行追加する。`client_user_agent` は NULL、IP アドレスは記録しない。`evidence_id` の重複は無視する。
- DB 未設定・不達・書き込み失敗でも、`/api/check` の応答は DB なしの場合と同じ。失敗はサーバーログに 1 行（`[evidence_log] write failed: <種別> code=<コード>`）。
- 判定のたびに Neon の計算資源が起動する。請求額が多ければ `EVIDENCE_LOG=off` にする。

## DB ロール

アプリ用とマイグレーション用でロールを分ける（Sprint 8 で決定）。

| ロール | 用途 | 権限 |
|---|---|---|
| 既定のオーナーロール（Neon の `neondb_owner` 等） | マイグレーション（`DATABASE_URL_UNPOOLED`） | 表の作成・変更 |
| `soraban_app` | アプリ（`DATABASE_URL`） | `regulations`・`regulation_zones`・`schema_migrations` の参照、`evidence_log` の参照と追加のみ（更新・削除は不可）。運航管理（0006）：`record_versions` の参照と追加のみ、`organizations`・`members`・`aircraft`・`pilots` は参照のみ。運航管理（0007）：`daily_inspections`・`flight_records` と総飛行時間のビューは参照のみ。運航管理（0010・0011）：`judgement_snapshots`・`plan_confirmations` は参照と追加のみ（更新・削除・TRUNCATE は不可）、`flight_plans`・`saved_places` は参照のみ。運航管理（0012・0013）：`flight_report_attempts`・`plan_procedure_records` は参照と追加のみ、`flight_reports` は参照のみ。`ops_bootstrap`・`verify_record_chain`・`verify_judgement_snapshots`・`flight_report_effective_id` は実行できない |

- ロールの作成はマイグレーションの外で行う（下記「ユーザー作業」手順 2）。権限付与は 0003・0006・0007・0010・0011・0012・0013 に含めており、**`soraban_app` が存在する場合に限り**付与する。ロールを作る前に 0003・0006・0007・0010〜0013 を適用した場合は、次の SQL をオーナーロールで 1 回実行する。

```sql
grant usage on schema public to soraban_app;
grant select on regulations, regulation_zones, schema_migrations to soraban_app;
grant select, insert on evidence_log to soraban_app;
-- 0006 を適用済みの場合
grant select, insert on record_versions to soraban_app;
grant select on organizations, members, aircraft, pilots to soraban_app;
-- 0007 を適用済みの場合
grant select on daily_inspections, flight_records, flight_record_totals, aircraft_flight_totals, pilot_flight_totals to soraban_app;
grant execute on function ops_jst_minute_to_timestamptz(text), ops_timestamptz_to_jst_minute(timestamptz),
  ops_jst_date(timestamptz), ops_flight_minutes(timestamptz, timestamptz) to soraban_app;
-- 0010・0011 を適用済みの場合
grant select, insert on judgement_snapshots, plan_confirmations to soraban_app;
grant select on flight_plans, saved_places to soraban_app;
-- 0012・0013 を適用済みの場合
grant select, insert on flight_report_attempts, plan_procedure_records to soraban_app;
grant select on flight_reports to soraban_app;
```

- Neon のコンソール・API・CLI で作ったロールには `neon_superuser` が付くため、最小権限にならない。SQL の `create role` で作ったロールには付かない（出典：https://neon.com/docs/manage/database-access 、2026-10-19 確認）。そのため `soraban_app` は SQL Editor から作る。SQL で作ったロールを Connect 画面で選べるかは文書に記載がなく、実施時に確認する。

## 版の履歴（Sprint 10、0006。Sprint 11 で 0008 により拡張）

運航管理の記録は上書き・物理削除をせず、訂正を版として追記する。版の表 `record_versions` を正とし、ヘッド表（`members`・`aircraft`・`pilots`・`daily_inspections`・`flight_records`）は版の追加から DB のトリガーが作る。アプリ（`soraban_app`）はヘッド表を直接書けない。

- **追加前のトリガー**：同じ実体（`entity_type`・`entity_id`）の版を `pg_advisory_xact_lock` で直列化し、`version_no`（1 からの連番）・`created_at`（`clock_timestamp()`）・`prev_hash`（直前の版の `content_hash`。初版は空文字）・`content_hash` を DB が決める。アプリが送った値は使わない。
- **楽観的排他**：アプリは同じトランザクションで `select set_config('soraban.expected_version', '<画面が表示した版番号>', true)` を実行してから版を追加する。最新の版番号と違えば SQLSTATE `SB409`（detail `version_conflict`）で失敗し、API は 409 を返す。
- **追加後のトリガー**：`data` からヘッド表の行を作る・更新する。`void`（取消）はヘッド表の `voided_at` を埋める（行は消さない）。ヘッド表の制約に反すれば版の追加ごと失敗する。組織の最後の有効な運航管理者を降格・停止する版は `SB409`（`last_manager`）で失敗する。
- **飛行記録・日常点検（Sprint 11、0008）**：
  - 版の `data` の時刻（`takeoff_at`・`landing_at`・`inspected_at`）は日本時間の `YYYY-MM-DDTHH:MM`（1 分単位）。ヘッド表では `timestamptz` にする（`ops_jst_minute_to_timestamptz`。`+09:00` を明示して解釈するため、DB・アプリの TimeZone に依らない）。秒付き・タイムゾーン付きの形は SQLSTATE `22007`。
  - 追加前のトリガーが、飛行記録の版の `data` に `flight_minutes`（着陸−離陸の分。同じ分なら 1。`ops_flight_minutes`）と `flight_date`（離陸の日本時間の日付）、日常点検の版の `data` に `inspected_date` と `has_abnormal` を入れる（アプリが送った値は上書き）。`content_hash` はこれらを含めて計算する。規則はアプリの `apps/web/src/lib/ops-time.ts` と同じ（`records.db.test.ts` で一致を確かめる）。
  - 追加後のトリガーが、同じ機体、または同じ操縦者で、取消していない飛行記録どうしの〔離陸, 離陸＋飛行時間）が重なる版を `SB409`（detail `overlap`）で拒否する（接するだけは可）。飛行記録の版の追加は組織単位の `pg_advisory_xact_lock` で直列化する。`btree_gist` の排除制約は使わない（拡張に依らないため）。
  - 機体・操縦者は同じ組織のものに限る（違えば `SB404`）。訂正で機体を変える版、別の機体の日常点検を紐付ける版は SQLSTATE `23514`（detail `aircraft_immutable`・`inspection_mismatch`）。
  - 総飛行時間は保存しない。ビュー `flight_record_totals`（飛行記録ごと：機体の `initial_flight_minutes` ＋ 同じ機体の取消していない記録のうち離陸がその記録以前のものの飛行時間の合計）・`aircraft_flight_totals`（機体の現在の総飛行時間）・`pilot_flight_totals`（操縦者ごとの、そらばんで記録した飛行の累計。初期値なし）で読み出しのたびに求める。訂正・取消・後入力・既存の総飛行時間の訂正は、次の読み出しから自動的に反映される。
  - `verify_record_chain` は時刻の列を日本時間の `YYYY-MM-DDTHH:MM` にして版の `data` と比べる。
- **独自の SQLSTATE**：`SB404`（実体がない・他の組織の実体）、`SB409`（detail：`version_conflict`・`voided`・`already_exists`・`last_manager`・`overlap`）。
- **`content_hash` の計算規則**（Sprint 15 の出力の照合で使う）：次の 11 要素をこの順に並べた jsonb の配列を `::text` で文字列にし、UTF-8 のバイト列の SHA-256 を 16 進小文字で表したもの（関数 `record_version_hash`）。

  | 順 | 要素 | 型・書式 |
  |---|---|---|
  | 1 | `"soraban-record-v1"` | 文字列（規則の版） |
  | 2 | `prev_hash` | 文字列（初版は `""`） |
  | 3 | `entity_type` | 文字列（`member`・`aircraft`・`pilot`・`daily_inspection`・`flight_record`。後の 2 つは 0008 で追加。規則 `soraban-record-v1` は変えていない） |
  | 4 | `entity_id` | 文字列（UUID の小文字表記） |
  | 5 | `version_no` | 数値 |
  | 6 | `op` | 文字列（`create`・`update`・`void`） |
  | 7 | `data` | jsonb のオブジェクト |
  | 8 | `reason` | 文字列または `null` |
  | 9 | `actor_kind` | 文字列（`member`・`system`） |
  | 10 | `actor_member_id` | 文字列（UUID）または `null` |
  | 11 | `created_at` | 文字列（UTC、`YYYY-MM-DDTHH:MI:SS.ffffffZ`、マイクロ秒 6 桁） |

  - jsonb の文字列表現は PostgreSQL の正規形（オブジェクトのキーは長さの短い順、同じ長さはバイト順。区切りは `", "` と `": "`）。外部で再計算する場合はこの正規形に合わせる。
- **検証**：`select * from verify_record_chain('<entity_type>', '<entity_id>');`（オーナーロール）。改変がなければ 0 行。次の問題を返す（ヘッド表の問題は最新の版番号、版が無ければ 0）。
  - 版の連鎖：連番の欠け（`missing_version`）、`prev_hash` のつながりの不一致（`prev_hash_mismatch`）、`content_hash` の再計算の不一致（`content_hash_mismatch`）
  - ヘッド表との突き合わせ：ヘッド表の `current_version` が最新の版番号と違う（`head_version_mismatch`。最新版の削除など）、ヘッド表の値が最新の版の `data` と違う（`head_data_mismatch`。ヘッド表だけの書き換え）、最新の版が取消かどうかとヘッド表の `voided_at` が食い違う（`head_void_mismatch`）、ヘッド表の行が無い（`head_missing`）、版が無いのにヘッド表の行がある（`head_without_versions`）
  - **検出できない改変（限界）**：オーナーロールが、ある版から後ろをすべて正しいハッシュで作り直し、ヘッド表もそれに合わせた改変は、DB の中だけでは検出できない（ハッシュ連鎖は DB の中で閉じているため）。最新の `content_hash` を DB の外に控える方法（出力への記載・外部への定期的な控え等）は Sprint 15 で検討する。
- **最初の運航管理者**：`select ops_bootstrap('<組織名>', '<メールアドレス>', '<表示名>');`（オーナーロールだけが実行できる）。組織が無ければ作り、招待中の運航管理者を 1 人登録する。有効または招待中の運航管理者が既にいる組織では何もしない。本人が確認済みのメールアドレスで初めてログインしたときに結び付く。

## 判定スナップショット・飛行計画・運航管理者の確認（Sprint 12a、0010・0011）

飛行計画の保存時にサーバーが判定を実行し、その時点の判定を不変のスナップショットとして残す。日誌（飛行記録）から「どの法令・条例を、どの版と確認日で判定したか」へ辿れる。

- **表**：`saved_places`（よく使う地点）・`flight_plans`（飛行計画）は `record_versions`（`entity_type` が `saved_place`・`flight_plan`）から DB が作るヘッド表。`judgement_snapshots`・`plan_confirmations` は追記専用の表（`soraban_app` は参照と追加だけ）。計画の保存する状態は `draft`・`active` と取消（`voided_at`）だけで、確認待ち・確認済みなどは確認の記録と計画の版から読み出しのたびに求める（アプリの `confirmationState`）。
- **1 つのトランザクション**：`evidence_log`（地点判定の行。`EVIDENCE_LOG` の設定に関係なく。同じ ID は無視）→ `judgement_snapshots` → `record_versions`（計画の版）を 1 つのトランザクションで書く。どれかが失敗したら全部取り消す。計画 ↔ スナップショットの外部キー（`judgement_snapshots_plan_fk`・`flight_plans_current_snapshot_fk`）は遅延可能（初期は遅延）で、コミット時に検査する（同じ組織・同じ計画に限る）。
- **追記専用**：`judgement_snapshots`・`plan_confirmations` の更新・削除・TRUNCATE は、権限を持つオーナーロールでも拒む（トリガー `reject_append_only_change`。SQLSTATE `SB409`、detail `immutable`）。他の表から参照されている表の TRUNCATE（`judgement_snapshots`）は、`CASCADE` なしでは外部キーが先に拒む（SQLSTATE `0A000`）。`CASCADE` を付けるとトリガーが拒む。
- **追加前のトリガー**（`judgement_snapshots`）：計画ごとの `pg_advisory_xact_lock` で直列化し、`seq`（計画の中の通し番号。1 から）・`prev_hash`（同じ計画の直前のスナップショットの `content_hash`。最初は空文字）・`created_at`・`content_hash` を DB が決める。アプリが送った値は使わない。作成者は同じ組織の利用者に限る（`SB404`）。
- **`plan_confirmations` の追加前のトリガー**：`self_confirmation`（確認者が、その版を保存した利用者である、または計画の操縦者に結び付いた利用者である）・`confirmer_name`（その時点の表示名の写し）・`created_at`・`content_hash` を DB が決める。次を `SB409` で拒む：`voided`（取消した計画）・`not_requested`（`draft` で確認が依頼されていない）・`version_conflict`（`plan_version` が計画の最新の版でない）・`snapshot_mismatch`（その版の `data` の `current_snapshot_id` と違う）・`not_manager`（運航管理者でない確認者）。計画・確認者が同じ組織にない場合は `SB404`。差し戻し（`returned`）は理由が必須（check 制約）。
- **飛行記録との紐付け**：`flight_records.flight_plan_id` → `flight_plans(id, org_id)`、`(snapshot_id, flight_plan_id, org_id)` → `judgement_snapshots(id, plan_id, org_id)` の外部キー（NULL のときは検査しない）。`snapshot_id` だけで `flight_plan_id` が NULL の行は check 制約で拒む。
- **`content_hash` の計算規則（`soraban-snapshot-v1`）**：次の 21 要素をこの順に並べた jsonb の配列を `::text` で文字列にし、UTF-8 のバイト列の SHA-256 を 16 進小文字で表したもの（関数 `judgement_snapshot_hash`）。時刻は UTC の `YYYY-MM-DDTHH:MI:SS.ffffffZ`（マイクロ秒 6 桁）。jsonb の文字列表現は `record_version_hash` と同じ正規形。

  | 順 | 要素 |
  |---|---|
  | 1 | `"soraban-snapshot-v1"`（規則の版） |
  | 2 | `prev_hash` |
  | 3〜5 | `id`・`org_id`・`plan_id`（UUID の小文字表記の文字列） |
  | 6 | `seq`（数値） |
  | 7 | `reason` |
  | 8・9 | `input`・`result`（jsonb） |
  | 10〜12 | `verdict_level`・`verdict_unknown_count`（数値）・`category` |
  | 13 | `engine_version` |
  | 14 | `checked_at`（UTC の文字列） |
  | 15・16 | `check_evidence_id`・`diagnosis_evidence_id` |
  | 17 | `datasets`（jsonb） |
  | 18・19 | `procedures_revision`（数値）・`procedures_verified_at` |
  | 20 | `created_by_member_id`（文字列） |
  | 21 | `created_at`（UTC の文字列） |

  `plan_confirmations` は `plan_confirmation_hash`（`soraban-confirmation-v1`）。要素は `id`・`org_id`・`plan_id`・`plan_version`・`snapshot_id`・`decision`・`reason`・`confirmer_member_id`・`confirmer_name`・`self_confirmation`・`created_at`（前に規則の版の文字列）。連鎖（`prev_hash`）は持たない。
- **検証**：`select * from verify_judgement_snapshots('<plan_id>');`（オーナーロール）。改変がなければ 0 行。次の問題を返す（計画に関する問題は最後の `seq`、無ければ 0）：連番の欠け（`missing_seq`）、`prev_hash` のつながりの不一致（`prev_hash_mismatch`）、`content_hash` の再計算の不一致（`content_hash_mismatch`）、計画の `current_snapshot_id` のスナップショットが無い（`head_snapshot_missing`）、計画の `current_snapshot_id` が最新のスナップショットでない（`head_snapshot_not_latest`）。計画の版の連鎖は `verify_record_chain('flight_plan', '<plan_id>')`（`flight_plan`・`saved_place` を 0011 で追加）。DB 移行（`docs/spec.md` §13.8.1）の前後に、すべての計画で実行して 0 行を確かめる。限界は `record_versions` と同じ（オーナーロールが後ろを全部作り直した改変は DB の中だけでは検出できない）。
- **個人情報**：計画・スナップショットに技能証明書番号・操縦者の氏名・メールアドレスを入れない（操縦者は ID だけ。画面で名前を引く）。確認者の表示名の写しは持つ。

## 通報の記録・試行の監査・手続きの「済み」の記録（Sprint 12b、0012・0013）

そらばんは DIPS に送信しない。利用者が DIPS 2.0 で通報した結果（通報日時・番号）を手で記録し（利用者の申告）、開発用に同じプロセスの中の模擬の送信も同じ表・同じ状態で残す。記録するまで「通報済み」にならない。

- **`flight_reports`（通報の記録。ヘッド表）**：`record_versions`（`entity_type = flight_report`）から DB が作る。状態の変更・訂正は版として追記し、物理削除も取消（`void`）もしない（`void` の版は `SB409` `not_voidable`）。取消は種別 `cancel` の別の行、記録の誤りは状態 `retracted` の版で表す。`(plan_id, org_id)`・`(base_report_id, plan_id, org_id)`（同じ表）・`(snapshot_id, plan_id, org_id)` は複合外部キー（別の計画のスナップショット・通報を指せない）。`(org_id, idempotency_key)` は一意（`uq_flight_reports_idem_request`）。CHECK：`kind = new` のとき元の通報なし、手動の送信元の状態は `reported_manual`・`retracted` だけ、完了した状態は `reported_at` が必須、`reported_manual` は二つの確認が揃い、番号か「番号なし」の宣言のどちらか一方があり、宣言のときはメモが必須。
- **追加前のトリガー**（`flight_report` の作成）：計画ごとに `pg_advisory_xact_lock` で直列化。計画が同じ組織にない（`SB404`）、同じ冪等性キーがある（`23505` `uq_flight_reports_idem_request`）。新規・変更は計画が取消されておらず（`voided`）、確認を依頼済み（`not_requested`）で、最新の版（`version_conflict`）であること。取消は取消された計画でも作れる。有効な通報がある計画への新規は `already_reported`、有効な通報がない計画への変更・取消は `no_active_report`、元の通報が現在の有効な通報でなければ `base_changed`、有効な手動の通報がある計画への模擬・API の新規・変更は `manual_report_exists`（いずれも `SB409`）。**状態の遷移の許可は DB でなくアプリの遷移表（`packages/dips/src/transitions.ts`）が決める。** 追加後のトリガーは、作成時に決まる列（計画・種別・元の通報・スナップショット・指紋・送信元・冪等性キー・内容）の更新を `23514`（`report_immutable`）で拒む。
- **有効な通報**：関数 `flight_report_effective_id(plan_id)`。種別が `new`／`change`、状態が `reported_manual`／`submitted_api` で、それより後に完了した `cancel`（同じ状態）が無い最新の 1 件（作成の新しい順、同時刻は ID）。アプリの `effectiveReport`（`packages/dips/src/status.ts`）と同じ規則で、`reports.db.test.ts` が乱数の操作の列で一致を確かめる。保存しない。
- **`flight_report_attempts`（試行・監査。追記専用）**：ゲートウェイの操作 1 回ごとに 1 行（`copy`・`submit`・`status`・`cancel`・`manual_record`・`correct`・`retract`・`resolve`）。利用者の ID と、その時点の表示名・役割の写し（`member_name`・`member_role`。追加前のトリガーが利用者の行から写す）、`created_at`（DB の時刻）、アダプター、冪等性キー、内容の SHA-256 と短い要約、対応表の版、スナップショットの証跡 ID、結果、HTTP の状態、失敗の種類、DIPS の番号を残す。**秘密・トークン・技能証明書番号・氏名・内容の全文は入れない。** 模擬の送信は、外部の呼び出しの前（結果 `unknown`）と後（結果）の 2 行を残す。
- **`plan_procedure_records`（手続きの「済み」の記録。追記専用）**：許可・承認の申請（`dips_permit`）と、小型無人機等飛行禁止法の同意・通報（`small_drone_law`）。`done` はすべての確認が真のときだけ（CHECK）。取り下げ（`retract`）も理由つきの行として残る。有効な記録は、計画ごと・種別ごとの最新の行が `done` のもの。追加前のトリガーが、取消された計画への `done`（`voided`）、計画の現在のスナップショット・最新の版と違う `done`（`snapshot_mismatch`・`version_conflict`）、有効な記録がない `retract`（`nothing_to_retract`）を `SB409` で拒む。
- **追記専用**：`flight_report_attempts`・`plan_procedure_records` の更新・削除・TRUNCATE は、権限を持つオーナーロールでも拒む（`reject_append_only_change`。`SB409`、detail `immutable`）。`soraban_app` は両方とも参照と追加だけ、`flight_reports` は参照だけ（書くのは `record_versions` への追加→トリガー）。
- **`content_hash` の計算規則（`soraban-procedure-record-v1`）**：次の 15 要素をこの順に並べた jsonb の配列を `::text` で文字列にし、UTF-8 のバイト列の SHA-256 を 16 進小文字で表したもの（関数 `plan_procedure_record_hash`）。時刻は UTC の `YYYY-MM-DDTHH:MI:SS.ffffffZ`（`done_at` が無ければ `null`）。

  | 順 | 要素 |
  |---|---|
  | 1 | `"soraban-procedure-record-v1"`（規則の版） |
  | 2〜4 | `id`・`org_id`・`plan_id`（UUID の小文字表記の文字列） |
  | 5・6 | `kind`・`action` |
  | 7 | `done_at`（UTC の文字列または `null`） |
  | 8・9 | `reference`・`checks`（jsonb） |
  | 10 | `snapshot_id`（文字列） |
  | 11 | `plan_version`（数値） |
  | 12・13 | `recorded_by_member_id`（文字列）・`recorded_by_name` |
  | 14 | `reason` |
  | 15 | `created_at`（UTC の文字列） |

- **検証**：通報の記録の版の連鎖は `select * from verify_record_chain('flight_report', '<report_id>');`（オーナーロール。改変がなければ 0 行。通報日時は日本時間の `YYYY-MM-DDTHH:MM` にして版の `data` と比べる）。DB 移行（`docs/spec.md` §13.8.1）の前後に、すべての通報の記録で実行して 0 行を確かめる。限界は `record_versions` と同じ。
- **個人情報**：通報の記録の写し（`content`）・試行の監査に、技能証明書番号・操縦者の氏名・メールアドレスを入れない（通報内容の画面には、運航管理者と本人にだけ技能証明書番号の全桁を表示する）。

## ローカル開発・テスト

CI と同じイメージ（`postgis/postgis:18-3.6`）をローカルで起動する例：

```sh
docker run --rm -d --name soraban-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres postgis/postgis:18-3.6
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
pnpm build          # next start を使うテストがあるため
pnpm test:db
# アプリから使う場合
psql "$TEST_DATABASE_URL" -c "create database soraban_dev"
DATABASE_URL_UNPOOLED=postgresql://postgres:postgres@localhost:5432/soraban_dev pnpm db:migrate
# .env.local: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/soraban_dev
docker stop soraban-pg
```

- CI の `db` ジョブ（`.github/workflows/ci.yml`）は、サービスコンテナに対して `soraban_app` の作成（マイグレーションより先）・`pnpm db:migrate`（2 回）・`pnpm db:status`・`soraban_app` の権限の確認・`TEST_DATABASE_URL` なしで失敗することの確認・`pnpm build`・`pnpm test:db`・テスト用の初期データの投入（`pnpm db:seed:ops-test`）・運航管理の E2E-DB（`pnpm test:e2e:ops`）を実行する。Neon の接続文字列・API キー・Neon Auth の URL・秘密は使わない。
- `pnpm test:db` は、`soraban_app` が既にあれば作らず・消さない。無ければテストの中で作り、終わったら消す。

### 運航管理の E2E-DB をローカルで動かす（Sprint 10・11）

```sh
psql "$TEST_DATABASE_URL" -c "create role soraban_app with login password 'local_only'"   # 初回だけ
psql "$TEST_DATABASE_URL" -c "create database soraban_e2e"
export DATABASE_URL_UNPOOLED=postgresql://postgres:postgres@localhost:5432/soraban_e2e
pnpm db:migrate && pnpm db:seed:ops-test       # 初期データは localhost・127.0.0.1 にだけ投入できる
pnpm build
E2E_OPS_DATABASE_URL=postgresql://soraban_app:local_only@localhost:5432/soraban_e2e pnpm test:e2e:ops
```

- `playwright.ops.config.ts` が `OPS_ENABLED=1`・`AUTH_PROVIDER=test`・E2E 専用の `AUTH_TEST_SECRET` を与えて `next start`（ポート 3300）を起動する。
- Sprint 11：このサーバーは `TZ=UTC` で起動し、`OPS_TEST_NOW=2027-01-05T12:00:00+09:00` でサーバーの現在時刻（離陸が未来でないかの判定に使う）を固定する。`OPS_TEST_NOW` は `AUTH_PROVIDER=test`（Vercel 以外）で有効なときだけ効き、neon 方式・本番では無視される（`apps/web/src/server/ops/availability.ts` の `opsNow`）。画面のテストはブラウザを `timezoneId: 'America/Los_Angeles'`・幅 375px にし、時計を `page.clock` で固定する。
- テスト用のログインは `POST /api/test-auth/sign-in`（本文：`authUserId`・`email`・`emailVerified`・`name`）。初期データの利用者は `packages/db/src/ops-seed.ts` を参照。
- イメージのタグ `postgis/postgis:18-3.6` は Docker Hub で存在を確認した（2026-10-19、最終更新 2026-10-18）。本番（PostgreSQL 18、PostGIS 3.6.4）とメジャー版・マイナー版が一致する。
- 開発環境で Docker が使えない場合は、OS のパッケージの PostgreSQL＋PostGIS でも `pnpm test:db` は動く（Sprint 8 の実装時は PostgreSQL 16＋PostGIS 3 で確認し、最終の合否は CI の PostgreSQL 18 で確認した）。

## ユーザー作業（エージェントは行わない）

エージェント（generator・evaluator を含む）は本番 Neon の接続文字列を持たず、本番 DB にも Vercel の環境変数にも触れない。以下はのりさん（または会社で決めた運用担当者）が行う。

**実施の順番は 手順 2（ロール作成）→ 手順 3（マイグレーション適用）→ 手順 1（Vercel の環境変数）。** 番号は内容のまとまりで、実施順ではない。

通しの手順書（試験用ブランチでの予行演習つき）：`docs/runbooks/production-db-prep.md`。この節が正で、手順書はこの節に予行演習を足したもの。

### 1. Vercel の環境変数（taiyo-works-projects チーム、プロジェクト soraban）

| 変数 | Production | Preview | Development | 値の取り方 |
|---|---|---|---|---|
| `DATABASE_URL` | 設定する | 設定しない（プレビューは DB なしで縮退動作） | 設定しない（ローカルは `.env.local` でコンテナか開発用ブランチを指す） | Neon コンソール → `soraban` → 既定ブランチ → Connect → **Pooled connection**（ホスト名に `-pooler`）。ロールは `soraban_app`（手順 2）。`sslmode=require` を `sslmode=verify-full` に書き換える |
| `DATABASE_URL_UNPOOLED` | 設定しない | 設定しない | — | マイグレーションを実行する人の手元でだけ使う（Direct connection、オーナーロール） |
| `EVIDENCE_LOG` | 通常は設定しない | — | — | 書き込みを止めるときだけ `off` |

- 追加画面（Settings → Environment Variables）では、対象の環境が初期状態で Production・Preview・Development の**すべて**選ばれている。**Production だけ**を残して他の選択を外す。
- **Sensitive** を有効にする（保存後は値を画面で表示できなくなる。変更するときは値を入れ直す）。
- Neon の Vercel 連携（プレビューごとに Neon ブランチを自動作成する機能）は使わない。ブランチが増えると計算資源の課金が増えるため。
- 環境変数を変えたら、Production を再デプロイして反映する。

### 2. アプリ用ロール `soraban_app` の作成（初回のみ）

> **順番を守る：① ロール作成（この手順）→ ② マイグレーション適用（手順 3）→ ③ Vercel の設定（手順 1）。**
> 0003 は、適用した時点で `soraban_app` が存在する場合にだけ権限を付ける。①より先に②を行うと、`soraban_app` は表を読めず、`/api/health/db` が `reachable: false` になり、証跡も書けない（判定自体は動く）。

1. 手元でパスワードを英数字だけで生成する：`openssl rand -hex 24`（48 文字、約 192 ビット）。
   - Neon は SQL で作るロールのパスワードに 60 ビット以上のエントロピーを求める（出典：https://neon.com/docs/manage/roles 、2026-10-19 確認）。
   - 記号を含めると、接続文字列に入れるときに URL エンコードが要るため使わない。
   - パスワードはリポジトリ・チャット・メモに貼らない（Vercel の環境変数にだけ入れる）。
2. Neon コンソール → `soraban` → 既定ブランチ → SQL Editor（オーナーロール）で実行する：
   ```sql
   create role soraban_app with login password '<生成したパスワード>';
   ```
3. アプリ用の接続文字列は、Pooled connection の接続文字列のユーザー名とパスワードを `soraban_app` のものに置き換え、`sslmode=verify-full` にして作る（Connect 画面でロールを選べる場合はそれを使う）。
4. パスワードを再発行するときは、新しいパスワードを同じ方法で生成し、SQL Editor で `alter role soraban_app password '<新しいパスワード>';` を実行してから、Vercel の `DATABASE_URL` を入れ直して Production を再デプロイする。

**順番を逆にした場合（②を先に行った場合）の復旧**：①でロールを作った後、SQL Editor（オーナーロール）で次を 1 回実行する。マイグレーションの再適用は要らない（してはいけない）。

```sql
grant usage on schema public to soraban_app;
grant select on regulations, regulation_zones, schema_migrations to soraban_app;
grant select, insert on evidence_log to soraban_app;
-- 0006 を適用済みの場合
grant select, insert on record_versions to soraban_app;
grant select on organizations, members, aircraft, pilots to soraban_app;
-- 0007 を適用済みの場合
grant select on daily_inspections, flight_records, flight_record_totals, aircraft_flight_totals, pilot_flight_totals to soraban_app;
grant execute on function ops_jst_minute_to_timestamptz(text), ops_timestamptz_to_jst_minute(timestamptz),
  ops_jst_date(timestamptz), ops_flight_minutes(timestamptz, timestamptz) to soraban_app;
```

### 3. 本番 DB へのマイグレーション適用

- **誰が**：のりさん（本番の接続文字列を持つ人）。エージェントには依頼しない。
- **いつ**：Sprint 8 の PR が `main` にマージされた後。**手順 2（ロール作成）の後**、Vercel の Production に `DATABASE_URL` を設定する**前**。以後、マイグレーションを含む PR をマージするたびに同じ手順を行う（マイグレーションは追加のみとし、旧コードでも動く形にする）。
- **どう**：
  1. リポジトリの `main` を手元に取得し、`pnpm install`。
  2. Neon コンソールで既定ブランチの **Direct connection**（オーナーロール）の接続文字列を取得し（`sslmode=verify-full` に書き換える）、手元のシェルにだけ設定する。コマンドに直接書くと zsh 等の履歴にパスワードが残るため、入力を表示しない `read` で貼り付ける：
     ```sh
     read -rs DATABASE_URL_UNPOOLED && export DATABASE_URL_UNPOOLED
     # 何も表示されないので、接続文字列を貼り付けて Enter
     ```
  3. `pnpm db:status` で、未適用の版（初回は `0001`〜`0003`）と接続先のホスト名を確認する。
  4. 必要に応じて、Neon コンソールで既定ブランチから復元用のブランチ（例：`before-0003-20261127`）を作る。Neon の履歴保持は、プロジェクト `soraban` で 86400 秒（1 日。2026-10-20 に確認）で、復元できるのは 1 日以内の時点まで。
  5. `pnpm db:migrate --target <手順 3 で表示されたホスト名>` を実行する。
  6. `pnpm db:status` で未適用がないことを確認する。
  7. Vercel の Production に `DATABASE_URL`（`soraban_app` の Pooled connection）を設定して再デプロイし、本番の `/api/health/db` が `reachable: true`、最新版 `0013`、`hasPendingMigrations: false` を返すことを確認する。
  8. 地点判定を 1 回行い、Neon の SQL Editor で `select evidence_id, checked_at from evidence_log order by created_at desc limit 1;` に行があることを確認する（任意）。
  9. 復元用ブランチを作った場合は、確認後に削除する。
  10. `unset DATABASE_URL_UNPOOLED`。

### 将来の選択肢：GitHub Actions で本番マイグレーションを実行する（案。ワークフローは未作成）

手元の PC が無いときでも適用できるようにする案。採用する場合は別途計画し、ワークフローを作る。

- `workflow_dispatch`（手動起動）だけのワークフローを作り、入力に `target`（確認用のホスト名）を取る。中身は `pnpm install --frozen-lockfile` → `pnpm db:status` → `pnpm db:migrate --target <入力>` → `pnpm db:status`。
- GitHub の Environment `production` を作り、`DATABASE_URL_UNPOOLED`（Direct connection、オーナーロール、`sslmode=verify-full`）を Environment の秘密（secret）として置く。リポジトリ全体の秘密にはしない。
- Environment に「Required reviewers（承認者）」を設定し、承認されるまでジョブが始まらないようにする。対象ブランチは `main` に限る（Deployment branches）。
- CI（`ci.yml`）からはこの Environment を参照しない（CI の DB は引き続きサービスコンテナだけを使う）。
- 注意：本番の接続文字列を GitHub に置くことになるため、spec §13.8.1 の「GitHub に Neon の秘密情報を置かない」方針の変更として、ユーザーの判断が要る。

## 運航管理（Sprint 10）の本番準備（ユーザー作業。エージェントは行わない）

利用者機能（`/ops`）は機能フラグ `OPS_ENABLED` が既定で無効のため、マイグレーション 0004〜0008 を含む PR をマージしても本番の画面・動作は変わらない（判定・申請支援だけ）。以下は退院後、PC が使えるときに行う（目安：Sprint 11 の成果を本番で使い始める前、2027-01 の記録開始の前）。**順番を守る。** 手順 1〜2 は PC（手元のシェル）が要る。手順 3〜7 は Neon・Google Cloud・Vercel のコンソールで、スマートフォンのブラウザでもできるが、PC を勧める。出典：`docs/sprints/sprint-10.md`「ユーザー作業」。

1. **Sprint 8 の本番準備が済んでいるか確かめる**（`soraban_app` の作成 → 0001〜0013 の適用 → Vercel の `DATABASE_URL`）。未実施なら上記「ユーザー作業」の手順 2 → 3 → 1 で先に行う。
2. **マイグレーション 0004〜0013 を本番に適用する**（Sprint 11 の 0007・0008、Sprint 11d の 0009、Sprint 12a の 0010・0011、Sprint 12b の 0012・0013 も同時に適用される）：上記「3. 本番 DB へのマイグレーション適用」と同じ（`pnpm db:status` → `pnpm db:migrate --target <ホスト名>` → `pnpm db:status`）。適用だけでは本番の動作は変わらない（フラグが無効のため）。`soraban_app` を作る前に適用した場合は「DB ロール」の復旧の SQL を実行する。
3. **Neon Auth を有効にする**：Neon コンソール → `soraban` → 既定ブランチ（本番）→ Auth → 有効化。aws-ap-southeast-1 で有効にできることをここで確かめる（できない場合は作業を止め、planner に戻す）。Auth URL を控える。プレビュー用・開発用のブランチでは有効にしない。
4. **Google ログインを自社の資格情報にする**：Google Cloud コンソールで OAuth クライアント（ウェブアプリケーション）を作り、承認済みのリダイレクト URI に `{Auth URL}/callback/google`（末尾にスラッシュを付けない）を登録する。Neon の Auth の設定 → OAuth providers に Client ID・Secret を入れる。
5. **Neon Auth の本番設定**：信頼するドメインに本番のドメインを追加、アプリ名を「そらばん」に、「Allow Localhost」を無効に。メールとパスワードによる登録を止められる場合は止める（止められなくても、アプリは確認済みのメールアドレスの招待者しか通さない）。
6. **最初の運航管理者を作る**：Neon の SQL Editor（オーナーロール）で 1 回実行する。
   ```sql
   select ops_bootstrap('フューチャーテック株式会社', '<自分の Google アカウントのメール>', '<表示名>');
   ```
7. **Vercel の Production の環境変数**（Production だけを選び、秘密は Sensitive に）：`AUTH_PROVIDER=neon`、`NEON_AUTH_BASE_URL=<Auth URL>`、`NEON_AUTH_COOKIE_SECRET=<openssl rand -base64 32 の出力>`、最後に `OPS_ENABLED=1`。再デプロイし、`/ops` から Google でログインして、役割が「運航管理者」と出ることを確かめる。他の社員は `/ops/members` から招待する。
   - 問題が出たら `OPS_ENABLED` を削除して再デプロイすれば、利用者機能だけが止まる（DB の表は残る）。
   - `AUTH_TEST_SECRET` は本番に設定しない（`AUTH_PROVIDER=test` は `VERCEL_ENV` が設定された環境＝Vercel の Production・Preview・Development では設定不足として扱い、`/api/test-auth/*` は 404 になる。Vercel の「System Environment Variables を自動で公開する」設定は既定の有効のままにする）。
   - 設定が足りないと `/ops` は「運航管理は準備中です」と理由コード（例：`neon_auth_base_url_missing`）だけを示す 503 になる。

**会社での決めごと（本番で使う前に）**：社員への利用目的の明示（飛行日誌の作成・保管のために氏名・技能証明書番号を記録すること）と、退職者の記録の扱い（版の表は追加のみで消せない。機体が登録されている間は保持する方針。誤登録の消去手順は Sprint 15）。

**実装上の確認事項（本番の準備の最後に確かめる）**

- `@neondatabase/auth` は `0.6.0-beta`（ベータ版）を版固定で使う。CI・E2E は Neon Auth に接続しないため、実際の Neon Auth との結合（Google ログイン → `/ops` に役割が出る）は手順 7 で初めて確かめる。
- Neon Auth の SDK のミドルウェア処理（`processAuthMiddleware`）は `proxy.ts`（`apps/web/src/server/ops/neon-proxy.ts`）で、`AUTH_PROVIDER=neon` かつ有効なときの `/ops` 以下だけに通す。Google から戻ったとき（`?neon_auth_session_verifier=…` と challenge Cookie）の verifier のセッションへの交換、セッションの Cookie（`session_data` 等）の更新、未ログインのサインイン画面への転送を、ページの描画より前に行う（サーバーコンポーネントの中では Cookie を書けないため）。更新した Cookie は同じ要求の Cookie ヘッダーにも反映し、ページの `getSession()` は Cookie の写しだけで済む。`/ops/sign-in`・`/ops/no-access` は保護しないが、交換と更新は行う。`/api` 以下は対象外（ルートハンドラの `getSession()` は Cookie を書ける）。E2E-DB では Neon Auth の上流の模擬サーバー（`e2e/mock-neon-auth-server.mjs`）で、Google から戻ったときと Cookie の更新を確かめている（実際の Google・Neon Auth との結合は手順 7 で確かめる）。

