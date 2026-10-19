# Sprint 8: Neon の土台（接続層・SQL マイグレーション・Supabase 撤去・CI の DB ジョブ・判定証跡の記録）

> 親文書：`docs/spec.md` §13.4「Neon 移行」・§13.6・§13.8.1 ／ `docs/00_NORTH_STAR.md` §0.1.6
> 前提：Sprint 7 が条件付き合格で `feat/sprint-7-regulations` に入っていること。判定ロジックは変更しない。
> ※ Next.js は破壊的変更を含むため、実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。特に応答後処理（`after`）の扱い。

## 決定済みの前提（spec §13.8.1、2026-10-19）

| 項目 | 内容 |
|---|---|
| DB | Neon プロジェクト `soraban`（id `solitary-silence-51819136`、aws-ap-southeast-1、PostgreSQL 18、PostGIS 3.6.4 導入済み）。従量課金のため scale-to-zero を維持する |
| ドライバ | `pg`（node-postgres） |
| マイグレーション | SQL ファイル＋自前の最小ランナー。Vercel のビルドでは適用しない |
| CI の DB | GitHub Actions の PostGIS サービスコンテナ。Neon のブランチを CI ごとに作らない。GitHub に Neon の秘密情報を置かない |
| Vercel | taiyo-works-projects チーム（Pro）、関数リージョン sin1 |
| 認証 | Neon Auth。**本スプリントでは扱わない**（Sprint 10 以降。§13.6 の繰り下げ後の番号）。Neon Auth のプロビジョニングもしない |

## 現状（2026-10-19、`feat/sprint-7-regulations` 時点）

- `packages/db/src/index.ts` は `@supabase/supabase-js` の薄いラッパーと手書きの型だけで、どこからも DB に接続していない（`apps/web` は依存に持つが import していない）。
- `supabase/migrations/0001_initial_schema.sql`（`regulations`・`regulation_zones`・enum・`set_updated_at`）と `0002_evidence_log.sql`（`evidence_log`）は、どの DB にも適用されていない。Neon の `soraban` には PostGIS 拡張以外の表がない。
- `.env.example` は `SUPABASE_URL` 等を列挙している。
- CI（`.github/workflows/ci.yml`）は `verify`（typecheck／lint／test／build）と `e2e` の 2 ジョブで、DB を使わない。
- 地点判定の証跡 ID（`evidenceId`）は判定時刻を入力に含むため、同じ地点でも判定ごとに異なる（`0002` のコメント「同一座標は同じ id」は現状と合わない）。

## 実装する機能

- **A. 接続層（`@soraban/db` を `pg` で作り直す）**
  - `DATABASE_URL`（Neon のプール経由の接続文字列）から `pg.Pool` を遅延生成する。未設定なら接続を試みず「未設定」として扱う関数（例：`isDbConfigured()`）を持つ。
  - 接続タイムアウト（既定 5 秒）、文のタイムアウト（既定 5 秒）、プールの最大接続数（既定 3）と待機接続の破棄時間を設定する。Neon の scale-to-zero 後の起動待ちを見込む値とし、値は定数として 1 か所にまとめる。
  - Vercel の関数でプールを使い回す際の推奨（`@vercel/functions` の `attachDatabasePool` 等）を実装時に確認し、採用・不採用と理由を `packages/db/README.md` に書く。
  - 表の行の型（`RegulationRow`・`RegulationZoneRow`・`EvidenceLogRow` 等）は手書きで維持し、マイグレーションと突き合わせる単体テストを置く（後述 G）。
- **B. SQL マイグレーションと適用記録**
  - ファイルは `packages/db/migrations/NNNN_名前.sql`（4 桁の連番）。
  - 最小ランナー（例：`packages/db/src/migrate.ts`、ルートの `pnpm db:migrate`・`pnpm db:status`）：
    - 適用記録の表（例：`schema_migrations`：版、名前、SHA-256 チェックサム、適用日時、所要時間）を自分で作る。
    - 未適用のファイルを番号順に、1 ファイル 1 トランザクションで適用する。途中で失敗したらそのファイルは記録せず、以降も適用せずに非 0 で終了する。
    - 同時実行を `pg_advisory_lock` で防ぐ。
    - 適用済みファイルのチェックサム不一致、番号の重複・欠番、ファイルにない版が適用記録にある場合は、何も適用せず非 0 で終了する。
    - 接続先は `DATABASE_URL_UNPOOLED`（直結）を使う。ホスト名に `-pooler` を含む接続文字列は拒否する（プール経由ではセッション単位のロックが効かないため）。
    - `localhost`・`127.0.0.1` 以外へ適用するときは `--target <ホスト名>` の指定を必須とし、接続文字列のホスト名と一致しなければ中止する（本番への取り違え防止）。
    - 実行前に接続先のホスト名とデータベース名、適用予定の版を表示する。パスワードは表示しない。
    - `pnpm db:status` は適用済み・未適用・不一致の一覧を表示するだけで、DB を変更しない。
  - `next build`・Vercel のビルドではランナーを呼ばない。
- **C. 既存スキーマの移植**
  - `supabase/migrations/0001・0002` を `packages/db/migrations/0001_initial_schema.sql`・`0002_evidence_log.sql` として移す。表・列・制約・索引の意味は変えない（コメント中の Supabase 前提の記述と、美保基地 300m／1,500m の古い記述は直してよい）。
  - 変更は `0003_evidence_log_datasets.sql` 以降に分ける：`evidence_log` に、判定で使ったデータセット（ID・基準年・確認日）を持つ `datasets jsonb not null default '[]'` を追加し、`0002` の「同一座標は同じ id」の説明を実態（判定時刻を含むため判定ごとに異なる）に合わせる。
  - `create extension if not exists postgis` は残す（Neon では導入済みのため何もしない）。`neon_auth` スキーマには触れない。
- **D. Supabase の撤去**
  - `supabase/` ディレクトリ、`@supabase/supabase-js` 依存、`SUPABASE_*` の環境変数名を削除する。`pnpm-lock.yaml` を更新する。
  - `.env.example` に `DATABASE_URL`・`DATABASE_URL_UNPOOLED` の**名前だけ**を書き、各変数の用途（アプリ用＝プール経由／マイグレーション用＝直結、本番の値はリポジトリに置かない）を注記する。
  - `packages/db/README.md` を Neon・`pg`・本ランナー前提に書き直し、本番適用手順（後述「ユーザー作業」）を載せる。
- **E. DB 接続確認 API**
  - `GET /api/health/db` を追加する。返す値は `configured`（真偽）、`reachable`（真偽）、`latencyMs`、PostgreSQL のメジャー版、PostGIS の版、最新の適用済みマイグレーション版、未適用の有無に限る。接続文字列、ホスト名、ロール名、エラーの生メッセージは返さない。
  - 未設定なら DB に接続せず `configured: false` を返す。不達・タイムアウトでも 200 で `reachable: false` を返す（HTTP 状態で監視する用途は想定しない）。
  - 定期監視（外部の死活監視、Vercel Cron 等）からは呼ばない。scale-to-zero 中の計算資源を起こし、従量課金が増えるため。README にこの旨を書く。
- **F. 地点判定の証跡を `evidence_log` に書く**
  - `/api/check` の応答を返した後に（Next.js の `after` 等、応答を待たせない方法で）`evidence_log` に 1 行追加する。書き込みは差し替え可能な関数として `handleCheckPost` に渡し、テストで差し替えられるようにする。
  - 記録する値：`evidence_id`、`engine_version`、`checked_at`、`loc`、`muni_code`、`resolved_address`、`overall`、`overall_confidence`、`regulation_ids`、`per_regulation_status`、`datasets`。`client_user_agent` は記録しない（NULL）。IP アドレスは記録しない。
  - `evidence_id` の重複は `on conflict do nothing` で無視する。
  - DB 未設定・不達・書き込み失敗のいずれでも、`/api/check` の応答内容と状態コードは DB なしの場合と同じにする。失敗はサーバーログに 1 行（エラー種別とコードのみ。接続文字列を含めない）出す。
  - 環境変数 `EVIDENCE_LOG=off` で書き込みを止められるようにする（従量課金や障害時の切り離し用）。
  - `/api/diagnose` の証跡は本スプリントでは書かない（飛行計画と判定スナップショットは Sprint 12）。
- **G. テストと CI**
  - DB を使わない単体テスト（`pnpm test`）：ランナーのファイル名検証・順序・チェックサム計算・`-pooler` 拒否・`--target` 照合、`/api/health/db` の未設定時の応答、証跡書き込み関数が失敗しても `/api/check` の応答が変わらないこと。
  - DB を使うテスト（例：`pnpm test:db`、別の vitest 設定）：`TEST_DATABASE_URL` が未設定ならスキップする。ただし `REQUIRE_DB_TESTS=1` のときに未設定ならスキップせず失敗させる（CI で黙ってスキップされるのを防ぐ）。
  - CI に `db` ジョブを追加する：PostgreSQL 18＋PostGIS 3.6 のサービスコンテナ（例：`postgis/postgis:18-3.6`。タグの有無は実装時に確認し、無い場合は最も近い版を使って差を `packages/db/README.md` に記録する）を使い、空の DB への全マイグレーション適用、2 回目の適用が何もしないこと、`pnpm test:db` を実行する。既存の `verify`・`e2e` ジョブは DB なしのまま変えない。
  - ローカル開発用に、CI と同じイメージの起動方法（`compose.yaml` 等）を README に書く（任意）。

## 範囲外

- 認証・利用者・組織・役割（Sprint 10）、Neon Auth のプロビジョニング
- 運航管理の表（機体、操縦者、飛行計画、日常点検、飛行記録、点検整備、版の履歴）
- 判定データ（DID・工業専用地域・対象施設・条例区域）の DB 投入と、判定の入力源の DB への切り替え（Sprint 14）
- `/api/diagnose` の証跡の DB 記録
- 本番 DB へのマイグレーション適用と Vercel の環境変数設定（ユーザー作業。下記）

## スプリント契約（完了条件）

以下の全条件を満たした場合のみ、このスプリントは完了とする。「単体」は `pnpm test`、「DB」は CI の `db` ジョブ（`pnpm test:db` とランナーの実行。ローカルでは同じイメージのコンテナで再現できる）、「E2E」は Playwright（`pnpm test:e2e`）で検証する。

### A・B. 接続層とマイグレーション

- [ ] （DB）空の DB に `pnpm db:migrate` を実行すると `0001`〜`0003` がすべて適用され、終了コード 0。適用記録の表に 3 行（版・名前・チェックサム・適用日時）がある。
- [ ] （DB）続けてもう一度 `pnpm db:migrate` を実行すると、何も適用せず終了コード 0。適用記録の行数が変わらない。
- [ ] （DB）適用済みの `0002` の内容を 1 文字変えたコピーで実行すると、チェックサム不一致で何も適用せず非 0 で終了する。
- [ ] （DB）構文誤りのある `0004` を加えて実行すると、`0004` は記録されず、`0004` 内で作ろうとした表も残らない（トランザクションで戻る）。非 0 で終了する。
- [ ] （DB）2 つのランナーを同時に起動しても、各ファイルが 1 回だけ適用される。
- [ ] （単体）番号の重複・欠番、ホスト名に `-pooler` を含む接続文字列、`--target` とホスト名の不一致、localhost 以外で `--target` なし、のそれぞれでランナーが DB に接続する前に中止する。
- [ ] （DB）マイグレーション適用後、`select postgis_full_version()` と、`regulation_zones` に点と多角形を 1 件ずつ入れて `ST_DWithin`（geography）で検索する問い合わせが成功する。
- [ ] （単体）手書きの行型の列名が、マイグレーションの `create table`・`alter table` の列名と一致する（SQL ファイルを読んで突き合わせる）。

### D. Supabase の撤去

- [ ] リポジトリ（`docs/` の履歴的な記述と `pnpm-lock.yaml` の削除差分を除く）に `supabase` を含むファイル・ディレクトリ・依存がない（`git grep -il supabase -- ':!docs'` が空）。
- [ ] `.env.example` に `DATABASE_URL` と `DATABASE_URL_UNPOOLED` の名前があり、値（接続文字列）は入っていない。

### E. DB 接続確認 API

- [ ] （E2E）`DATABASE_URL` 未設定の `next start` で `GET /api/health/db` が 200、`configured: false` を返す。
- [ ] （単体）到達できない接続先（閉じたポート）を `DATABASE_URL` に設定すると、`GET /api/health/db` が 6 秒以内に 200、`configured: true`・`reachable: false` を返す。応答本文に接続文字列・ホスト名・ポート・ロール名が含まれない。
- [ ] （DB）マイグレーション適用済みの DB に接続した状態で、`reachable: true`、PostgreSQL のメジャー版、PostGIS の版、最新の適用済み版 `0003`、未適用なしを返す。

### F. 判定証跡の記録

- [ ] （DB）`DATABASE_URL` を CI のコンテナに向けた `next start` で、米子市役所プリセットの座標を `/api/check` に送ると、応答の `evidenceId` と同じ `evidence_id` の行が 5 秒以内に `evidence_log` にでき、`engine_version`・`regulation_ids`・`datasets`（1 件以上）が応答と一致する。`client_user_agent` は NULL。
- [ ] （単体）証跡の書き込み関数が例外を投げる・解決しない場合でも、`/api/check` の応答の本文と状態コードが書き込みなしの場合と同じで、応答が書き込みの完了を待たない。
- [ ] （E2E）`DATABASE_URL` 未設定の `next start` で、既存の地点判定・申請支援の E2E（`e2e/reliability.spec.ts`・`e2e/sprint7.spec.ts`）がすべて通る。
- [ ] （単体）`EVIDENCE_LOG=off` のとき、書き込み関数が呼ばれない。

### G. CI と回帰

- [ ] CI に `db` ジョブがあり、PostGIS のサービスコンテナで上記「DB」の項目を実行して緑。ジョブ定義に Neon の接続文字列や API キーを参照する箇所がない。
- [ ] `db` ジョブで `TEST_DATABASE_URL` を外すと、`REQUIRE_DB_TESTS=1` により失敗する（スキップで緑にならない）ことを、ジョブ定義かテストコードで確認できる。
- [ ] `pnpm typecheck`・`pnpm lint`・`pnpm test`・`pnpm build` が通り、CI の全ジョブが緑。
- [ ] 判定結果（`/api/check`・`/api/diagnose` の応答）が Sprint 7 時点と同じ（既存の単体テスト・E2E がすべて通る）。

## ユーザー作業（エージェントは行わない）

エージェント（generator・evaluator を含む）は本番 Neon の接続文字列を持たず、本番 DB にも Vercel の環境変数にも触れない。以下はのりさん（または会社で決めた運用担当者）が行う。

### 1. Vercel の環境変数（taiyo-works-projects チーム、プロジェクト soraban）

| 変数 | Production | Preview | Development | 値の取り方 |
|---|---|---|---|---|
| `DATABASE_URL` | 設定する | 設定しない（推奨。プレビューは DB なしで縮退動作） | 設定しない（ローカルは `.env.local` でコンテナか開発用ブランチを指す） | Neon コンソール → `soraban` → 既定ブランチ → Connect → **Pooled connection**（ホスト名に `-pooler` を含む）。`sslmode=require` 付き |
| `DATABASE_URL_UNPOOLED` | 設定しない | 設定しない | — | マイグレーションを実行する人の手元でだけ使う（Direct connection） |
| `EVIDENCE_LOG` | 通常は設定しない | — | — | 書き込みを止めるときだけ `off` |

- Neon の Vercel 連携（プレビューごとに Neon ブランチを自動作成する機能）は使わない。ブランチが増えると計算資源の課金が増えるため。
- 環境変数を変えたら、Production を再デプロイして反映する。

### 2. 本番 DB へのマイグレーション適用

- **誰が**：のりさん（本番の接続文字列を持つ人）。エージェントには依頼しない。
- **いつ**：Sprint 8 の PR が `main` にマージされた後、Vercel の Production に `DATABASE_URL` を設定する**前**。以後、マイグレーションを含む PR をマージするたびに同じ手順を行う（マイグレーションは追加のみとし、旧コードでも動く形にする）。
- **どう**：
  1. リポジトリの `main` を手元に取得し、`pnpm install`。
  2. Neon コンソールで既定ブランチの **Direct connection** の接続文字列を取得し、手元のシェルにだけ設定する：`export DATABASE_URL_UNPOOLED='postgresql://…'`（ファイルや履歴に残さない）。
  3. `pnpm db:status` で、未適用の版（初回は `0001`〜`0003`）と接続先のホスト名を確認する。
  4. 必要に応じて、Neon コンソールで既定ブランチから復元用のブランチ（例：`before-0003-20261127`）を作る。Neon の時点復元の保持期間はプランによる（本スプリントの計画時点では未確認）。
  5. `pnpm db:migrate --target <手順 3 で表示されたホスト名>` を実行する。
  6. `pnpm db:status` で未適用がないことを確認する。
  7. Vercel の Production に `DATABASE_URL` を設定して再デプロイし、本番の `/api/health/db` が `reachable: true`、最新版 `0003` を返すことを確認する。
  8. 復元用ブランチを作った場合は、確認後に削除する。
  9. `unset DATABASE_URL_UNPOOLED`。

## 未決事項（実装前にユーザーの確認が必要）

1. アプリ用とマイグレーション用の DB ロールを分けるか。推奨：分ける（アプリ用ロールは表の参照・追加のみ。`evidence_log` を更新・削除できなくする）。分ける場合、ロールの作成は Neon コンソールでのユーザー作業になり、権限付与はマイグレーションに含める。本スプリントでは既定のオーナーロールで進め、Sprint 10（認証）で分ける案もある。
2. Preview 環境に DB を持たせるか。推奨：持たせない（縮退動作）。持たせる場合は開発用 Neon ブランチを 1 本作り、Preview の `DATABASE_URL` をそこに向ける（ブランチの計算資源の課金が増える）。
3. 地点判定のたびに `evidence_log` に書くことで、判定のたびに Neon の計算資源が起動する。自社利用の頻度では小さいと見込むが、請求額を Sprint 8 終了後 1 か月で確認し、多ければ `EVIDENCE_LOG=off` にするか記録の条件を絞る。

### 未決事項の扱い（2026-10-19、実装時）

- 1：推奨どおりロールを分けた。アプリ用ロール `soraban_app` の作成はマイグレーションの外（SQL Editor での `create role`）で行い、権限付与は `0003` に含めた（ロールが存在する場合のみ付与）。手順は `packages/db/README.md`「DB ロール」「ユーザー作業」。
- 2：推奨どおり Preview 環境に DB を持たせない（縮退動作）。
- 3：変更なし（Sprint 8 終了後 1 か月で請求額を確認する）。
