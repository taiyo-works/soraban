# `@soraban/db`

Neon（PostgreSQL 18 + PostGIS 3.6、aws-ap-southeast-1、プロジェクト `soraban`）への接続層と、SQL マイグレーション（Sprint 8）。

- ドライバ：`pg`（node-postgres）。ローカル・CI の PostgreSQL コンテナと本番 Neon で同じドライバを使う。
- マイグレーション：`packages/db/migrations/NNNN_名前.sql` と自前の最小ランナー（`src/migrate.ts`）。
- 認証（Neon Auth）・運航管理の表は本パッケージの対象外（Sprint 10 以降）。

## 環境変数

| 変数 | 用途 | 置き場所 |
|---|---|---|
| `DATABASE_URL` | アプリ用。Neon の **Pooled connection**（ホスト名に `-pooler`）。未設定なら DB に接続せず、地点判定・申請支援は DB なしで動く | Vercel の Production だけ。ローカルは `.env.local` |
| `DATABASE_URL_UNPOOLED` | マイグレーション用。Neon の **Direct connection** | 実行する人の手元のシェルだけ（ファイルや履歴に残さない） |
| `EVIDENCE_LOG` | `off` で証跡（`evidence_log`）の書き込みを止める | 必要なときだけ |
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
| `soraban_app` | アプリ（`DATABASE_URL`） | `regulations`・`regulation_zones`・`schema_migrations` の参照、`evidence_log` の参照と追加のみ（更新・削除は不可） |

- ロールの作成はマイグレーションの外で行う（下記「ユーザー作業」手順 2）。権限付与は 0003 に含めており、**`soraban_app` が存在する場合に限り**付与する。ロールを作る前に 0003 を適用した場合は、次の SQL をオーナーロールで 1 回実行する。

```sql
grant usage on schema public to soraban_app;
grant select on regulations, regulation_zones, schema_migrations to soraban_app;
grant select, insert on evidence_log to soraban_app;
```

- Neon のコンソール・API・CLI で作ったロールには `neon_superuser` が付くため、最小権限にならない。SQL の `create role` で作ったロールには付かない（出典：https://neon.com/docs/manage/database-access 、2026-10-19 確認）。そのため `soraban_app` は SQL Editor から作る。SQL で作ったロールを Connect 画面で選べるかは文書に記載がなく、実施時に確認する。

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

- CI の `db` ジョブ（`.github/workflows/ci.yml`）は、サービスコンテナに対して `pnpm db:migrate`（2 回）・`pnpm db:status`・`TEST_DATABASE_URL` なしで失敗することの確認・`pnpm build`・`pnpm test:db` を実行する。Neon の接続文字列・API キーは使わない。
- イメージのタグ `postgis/postgis:18-3.6` は Docker Hub で存在を確認した（2026-10-19、最終更新 2026-10-18）。本番（PostgreSQL 18、PostGIS 3.6.4）とメジャー版・マイナー版が一致する。
- 開発環境で Docker が使えない場合は、OS のパッケージの PostgreSQL＋PostGIS でも `pnpm test:db` は動く（Sprint 8 の実装時は PostgreSQL 16＋PostGIS 3 で確認し、最終の合否は CI の PostgreSQL 18 で確認した）。

## ユーザー作業（エージェントは行わない）

エージェント（generator・evaluator を含む）は本番 Neon の接続文字列を持たず、本番 DB にも Vercel の環境変数にも触れない。以下はのりさん（または会社で決めた運用担当者）が行う。

**実施の順番は 手順 2（ロール作成）→ 手順 3（マイグレーション適用）→ 手順 1（Vercel の環境変数）。** 番号は内容のまとまりで、実施順ではない。

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
  4. 必要に応じて、Neon コンソールで既定ブランチから復元用のブランチ（例：`before-0003-20261127`）を作る。Neon の時点復元の保持期間はプランによる（計画時点では未確認）。
  5. `pnpm db:migrate --target <手順 3 で表示されたホスト名>` を実行する。
  6. `pnpm db:status` で未適用がないことを確認する。
  7. Vercel の Production に `DATABASE_URL`（`soraban_app` の Pooled connection）を設定して再デプロイし、本番の `/api/health/db` が `reachable: true`、最新版 `0003`、`hasPendingMigrations: false` を返すことを確認する。
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
