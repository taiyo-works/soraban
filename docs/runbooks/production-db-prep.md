# 本番 DB の準備（予行演習つき通し手順書）

対象：Neon プロジェクト `soraban`（id `solitary-silence-51819136`、aws-ap-southeast-1、PostgreSQL 18、PostGIS 導入済み、既定ブランチ `main` = `br-twilight-smoke-b37gx8ke`、データベース `neondb`）。
実施者：のりさん。自分の Mac のターミナルと Neon コンソールだけで進める。

> **DB を乗り換える場合（国内＝東京の Supabase／AWS など）は、この手順書を差し替える。** 本番 DB は当面 Neon で確定（2026-10-21 ユーザー決定。国内保管の要件が出たときに東京へ移す。合図と備えは `docs/spec.md` §13.8.1）。この手順書は Neon を前提に書いている。

- 正は `packages/db/README.md`（「DB ロール」「ユーザー作業」）。この手順書は、その手順（ロール作成 → マイグレーション → Vercel の環境変数）の前に**予行演習**を足した通し手順。食い違ったら README を正とし、この手順書を直す。
- Neon の画面の文言・メニュー名は変わることがある（画面の名称は変わることがある）。見つからないときは公式ドキュメント https://neon.com/docs で探す。

## 0. 前提と準備

### 目的

1. 本番と同じ手順を、使い捨てのブランチで先に通して、つまずく所を本番の前に見つける。
2. 予行演習が合格してから、本番の `main` ブランチに同じ手順を行う。

### 現状（2026-10-20 に Neon コネクタの読み取りで確認）

本番 `main` は空：そらばんのテーブルなし、`soraban_app` なし、Neon Auth 未有効。ロールは `neondb_owner` だけ。

### 所要時間の目安

予行演習 60〜90 分、本番 30〜45 分（初回。※目安であり、実測ではない）。

### 用意するもの

- Mac に Node.js（22 系。CI は 22）、pnpm、`psql`、`openssl`（macOS 標準）、`git`。
  確認：
  ```sh
  node -v && pnpm -v && psql --version && openssl version
  ```
  期待：4 つともバージョンが出る。`psql` が無ければ `brew install libpq` 等で入れる（※要確認：入れ方は環境による）。
- リポジトリのクローンが最新の `main`。Mac の手元のクローンは接続先が旧リポジトリのままなので、**最初に**直す：
  ```sh
  cd <クローンのフォルダ>
  git remote set-url origin https://github.com/taiyo-works/soraban.git
  git remote -v
  git checkout main && git pull
  pnpm install
  ls packages/db/migrations
  ```
  期待：`git remote -v` が `taiyo-works/soraban` を指す。`ls` に `0001_…sql` 〜 `0016_…sql` の 16 本が並ぶ。
- Neon コンソール（https://console.neon.tech）に入れること。Vercel（taiyo-works-projects チーム）に入れること（本番の章で使う）。

### 秘密の扱い（原則）

接続文字列・パスワードを、チャット・コミット・メモ・Slack に貼らない。この手順書にも書かない。

1. 接続文字列は `read -rs` で貼り付ける（画面に出ず、履歴にも残らない）。コマンドに直接書かない。
2. 環境変数はそのターミナルのウィンドウだけに置く。作業が終わったら `unset` する。ウィンドウを閉じても消える。
3. シェルの履歴に残したくないコマンドの前に半角スペースを付ける運用をするなら、bash は `HISTCONTROL=ignorespace`、zsh は `setopt HIST_IGNORE_SPACE` を先に設定する（Mac の既定は zsh）。`read -rs` を使えばパスワードは履歴に残らないので、この設定は保険。
4. 生成したパスワードは、使う場所（Neon の SQL、Vercel の環境変数）に入れたら、ターミナルの変数からも `unset` する。

接続文字列は次の形（`<…>` は実際の値に置き換える。ここには実値を書かない）：

```
postgresql://<ロール名>:<パスワード>@<ホスト名>/neondb?sslmode=verify-full
```

Neon の Connect 画面は `sslmode=require` で出す。**`sslmode=verify-full` に書き換えて使う**（理由は README「`sslmode` は `verify-full` を推奨」）。`channel_binding=require` など他のパラメータが付いていたら、そのまま残す。

### 2 種類の接続文字列

| 呼び方 | ホスト名 | ロール | 使う場面 |
|---|---|---|---|
| Direct connection | `ep-…`（`-pooler` なし） | `neondb_owner`（オーナー） | マイグレーション（`DATABASE_URL_UNPOOLED`）、権限の確認 |
| Pooled connection | `ep-…-pooler…`（`-pooler` あり） | `soraban_app` | アプリ（`DATABASE_URL`） |

---

## 1. 予行演習（Neon の試験用ブランチ）

本番の `main` には一切触れない。試験用ブランチは `main` の複製（空なので中身はほぼ空）。

### 1.1 ブランチを作る

1. Neon コンソール → プロジェクト `soraban` → Branches → Create branch（画面の名称は変わることがある）。
2. 名前：`rehearsal-YYYYMMDD`（例：`rehearsal-20261021`）。親：`main`。データは「現在のデータ」（既定）。作成。
3. 作成されたブランチの Connect 画面を開けるようにしておく。

確かめること：Branches の一覧に `rehearsal-YYYYMMDD` が出て、親が `main`、状態が Active（または Idle）。

戻し方：作り直したいときは、そのブランチを削除して手順 1 から（§5.1）。`main` には影響しない。

参考（※要確認：URL は未確認）：https://neon.com/docs/introduction/branching

### 1.2 Direct connection（オーナー）を手元のシェルに入れる

1. 試験用ブランチの Connect 画面で、ロール `neondb_owner`、データベース `neondb`、**Connection pooling を切る**（Direct connection）にして、接続文字列を表示する。
2. ホスト名に `-pooler` が**無い**ことを確かめる。
3. ターミナルで（以後、同じウィンドウで続ける）：
   ```sh
   read -rs DATABASE_URL_UNPOOLED && export DATABASE_URL_UNPOOLED
   # 何も表示されない。接続文字列を貼り付けて Enter
   ```
   貼り付ける前に、`sslmode=require` を `sslmode=verify-full` に書き換えておく。
4. ホスト名だけを（パスワードを出さずに）取り出して控える：
   ```sh
   node -e 'console.log(new URL(process.env.DATABASE_URL_UNPOOLED).hostname)'
   ```
   期待：`ep-…ap-southeast-1.aws.neon.tech` のような名前が 1 つ出る。以後これを `<ホスト名>` と書く（`--target` に使う）。

確かめること：接続できるか。
```sh
psql "$DATABASE_URL_UNPOOLED" -c "select current_user, current_database(), current_setting('server_version_num')"
```
期待：`neondb_owner`、`neondb`、`18xxxx`。

戻し方：`psql` が「password authentication failed」なら、Connect 画面から取り直す。`-pooler` が付いていたら Direct に切り替えて取り直す。それ以外は §5.3。

### 1.3 `soraban_app` を作る

`soraban_app` は **SQL の `create role` で作る**（Neon のコンソール・API・CLI で作ると `neon_superuser` が付き、最小権限にならない。README「DB ロール」、出典 https://neon.com/docs/manage/database-access ）。

1. パスワードを生成する（英数字だけ。記号が入ると接続文字列の URL エンコードが要る）：
   ```sh
   openssl rand -hex 24
   ```
   48 文字が出る。**画面から選んでコピーする**（どこにも貼り付けて保存しない）。README と同じ方式。
2. Neon コンソール → 試験用ブランチを選ぶ → SQL Editor（オーナーロール）で、**ブランチが試験用であることを画面で確かめてから**実行する：
   ```sql
   create role soraban_app with login password '<生成したパスワード>';
   ```
3. 同じパスワードで、アプリ用の Pooled connection の文字列を手元に作る。試験用ブランチの Connect 画面で Connection pooling を入れ、`neondb_owner` の Pooled 接続文字列を表示し、ユーザー名とパスワードを `soraban_app` と生成したパスワードに置き換え、`sslmode=verify-full` にする。ターミナルへ：
   ```sh
   read -rs REHEARSAL_APP_URL && export REHEARSAL_APP_URL
   ```
   Connect 画面でロールに `soraban_app` を選べる場合はそれを使ってよい（SQL で作ったロールが選べるかは文書に記載がなく、※要確認）。

確かめること（オーナーで）：
```sh
psql "$DATABASE_URL_UNPOOLED" -c "select rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin, pg_has_role(rolname, 'neon_superuser', 'member') as in_neon_superuser from pg_roles where rolname = 'soraban_app'"
```
期待：1 行。`rolcanlogin` が `t`、それ以外（`rolsuper`・`rolcreatedb`・`rolcreaterole`・`rolbypassrls`・`in_neon_superuser`）がすべて `f`。

戻し方：
- パスワードを書き間違えた／忘れた：`alter role soraban_app password '<新しいパスワード>';`（SQL Editor）。
- ロールごとやり直したい：試験用ブランチなら、ブランチごと削除して作り直すのが確実（§5.1）。

### 1.4 マイグレーションを適用する

1. 適用前の状態（DB は変更されない）：
   ```sh
   pnpm db:status
   ```
   期待：`接続先 host=<ホスト名> … database=neondb`、`0001`〜`0016` がすべて「未適用」、`適用済み 0 件、未適用 16 件`。
   **ここで表示された host が §1.2 の `<ホスト名>`（試験用ブランチ）であることを必ず確かめる。**
2. 適用：
   ```sh
   pnpm db:migrate --target <ホスト名>
   ```
   期待：`適用予定: 0001, …, 0016` のあと、`適用 0001_…sql（… ms）` から `適用 0016_…sql` まで 16 行。終了コード 0。
3. **2 回目**を実行する：
   ```sh
   pnpm db:migrate --target <ホスト名>
   ```
   期待：`未適用のマイグレーションはありません。` だけ。何も適用しない。
4. 確認：
   ```sh
   pnpm db:status
   ```
   期待：`適用済み 16 件、未適用 0 件`。「不一致」の行が出ない。

ランナーの動作（`packages/db/src/migrate.ts` を読んで確認）：
- ホスト名に `-pooler` を含む接続文字列、`--target` 無し、`--target` と接続先の不一致は、**DB に接続する前に**中止する。
- 1 ファイル 1 トランザクション。失敗したファイルは取り消され（記録されない）、**以降のファイルも適用せず**、終了コード 1。それまでに成功したファイルは確定済みで、戻らない。
- チェックサム不一致・欠番・ファイルにない版の記録があれば、何も適用せず中止。

戻し方：
- 途中で止まった：エラー文の `NNNN_…sql` と理由を控える（パスワードは出ない）。試験用ブランチでは、ブランチを削除して作り直し（§5.1）、原因を直してからやり直してよい。**原因が分からないまま本番に進まない**。コードの問題なら、エージェントに原因の調査を依頼する（エラー文を伝える。接続文字列は伝えない）。
- 「`-pooler` を含む」で中止：Direct connection を取り直す。
- 「`--target` が一致しません」：`<ホスト名>` を §1.2 の手順で取り直す。

### 1.5 権限を確かめる

#### A. オーナーで、権限の一覧を確かめる（CI の db ジョブと同じ観点）

```sh
psql "$DATABASE_URL_UNPOOLED" -tA <<'SQL'
select 'evidence_log INSERT', has_table_privilege('soraban_app','evidence_log','INSERT');
select 'evidence_log SELECT', has_table_privilege('soraban_app','evidence_log','SELECT');
select 'evidence_log UPDATE', has_table_privilege('soraban_app','evidence_log','UPDATE');
select 'evidence_log DELETE', has_table_privilege('soraban_app','evidence_log','DELETE');
select 'record_versions INSERT', has_table_privilege('soraban_app','record_versions','INSERT');
select 'record_versions UPDATE', has_table_privilege('soraban_app','record_versions','UPDATE');
select 'aircraft INSERT', has_table_privilege('soraban_app','aircraft','INSERT');
select 'members SELECT', has_table_privilege('soraban_app','members','SELECT');
select 'flight_records INSERT', has_table_privilege('soraban_app','flight_records','INSERT');
select 'judgement_snapshots INSERT', has_table_privilege('soraban_app','judgement_snapshots','INSERT');
select 'judgement_snapshots UPDATE', has_table_privilege('soraban_app','judgement_snapshots','UPDATE');
select 'judgement_snapshots DELETE', has_table_privilege('soraban_app','judgement_snapshots','DELETE');
select 'judgement_snapshots TRUNCATE', has_table_privilege('soraban_app','judgement_snapshots','TRUNCATE');
select 'plan_confirmations INSERT', has_table_privilege('soraban_app','plan_confirmations','INSERT');
select 'plan_confirmations UPDATE', has_table_privilege('soraban_app','plan_confirmations','UPDATE');
select 'plan_confirmations DELETE', has_table_privilege('soraban_app','plan_confirmations','DELETE');
select 'plan_confirmations TRUNCATE', has_table_privilege('soraban_app','plan_confirmations','TRUNCATE');
select 'flight_plans INSERT', has_table_privilege('soraban_app','flight_plans','INSERT');
select 'flight_plans UPDATE', has_table_privilege('soraban_app','flight_plans','UPDATE');
select 'saved_places INSERT', has_table_privilege('soraban_app','saved_places','INSERT');
select 'saved_places UPDATE', has_table_privilege('soraban_app','saved_places','UPDATE');
select 'schema_migrations SELECT', has_table_privilege('soraban_app','schema_migrations','SELECT');
select 'ops_bootstrap EXECUTE', has_function_privilege('soraban_app','ops_bootstrap(text,text,text)','EXECUTE');
select 'verify_record_chain EXECUTE', has_function_privilege('soraban_app','verify_record_chain(text,uuid)','EXECUTE');
select 'verify_judgement_snapshots EXECUTE', has_function_privilege('soraban_app','verify_judgement_snapshots(uuid)','EXECUTE');
select 'neon_superuser member', pg_has_role('soraban_app','neon_superuser','member');
SQL
```

期待（`項目|値`）：

| 項目 | 期待 |
|---|---|
| evidence_log INSERT | `t` |
| evidence_log SELECT | `t` |
| evidence_log UPDATE | `f` |
| evidence_log DELETE | `f` |
| record_versions INSERT | `t` |
| record_versions UPDATE | `f` |
| aircraft INSERT（ヘッド表を直接書けない） | `f` |
| members SELECT | `t` |
| flight_records INSERT | `f` |
| judgement_snapshots INSERT（追記専用） | `t` |
| judgement_snapshots UPDATE・DELETE・TRUNCATE | `f`（3 行とも） |
| plan_confirmations INSERT（追記専用） | `t` |
| plan_confirmations UPDATE・DELETE・TRUNCATE | `f`（3 行とも） |
| flight_plans INSERT・UPDATE（ヘッド表を直接書けない） | `f`（2 行とも） |
| saved_places INSERT・UPDATE（ヘッド表を直接書けない） | `f`（2 行とも） |
| schema_migrations SELECT | `t` |
| ops_bootstrap EXECUTE | `f` |
| verify_record_chain EXECUTE | `f` |
| verify_judgement_snapshots EXECUTE | `f` |
| neon_superuser member | `f` |

#### B. `soraban_app` 自身で、実際に拒否されることを確かめる

どれも権限エラーで失敗するのが正しい（データは変わらない）。

```sh
psql "$REHEARSAL_APP_URL" -c "select count(*) from evidence_log"
psql "$REHEARSAL_APP_URL" -c "update evidence_log set overall = overall"
psql "$REHEARSAL_APP_URL" -c "delete from evidence_log"
psql "$REHEARSAL_APP_URL" -c "insert into aircraft default values"
psql "$REHEARSAL_APP_URL" -c "select ops_bootstrap('x','x@example.com','x')"
psql "$REHEARSAL_APP_URL" -c "select * from verify_record_chain('member','00000000-0000-0000-0000-000000000000')"
```

期待：1 つ目は `0`（件数）。2〜6 つ目はすべて `ERROR: permission denied …`。

（`evidence_log` に実際に 1 行入ることは §1.6 のアプリ経由で確かめる。手で `insert` を書くと列が多く間違えやすいため。）

戻し方：期待と違う（特に `t` であるべきものが `f`）：ロールを作る**前**にマイグレーションを適用した可能性がある。README「DB ロール」の `grant …` の SQL（復旧用）をオーナーで 1 回実行する。再適用はしない。それでも直らなければ、試験用ブランチを作り直して手順 1.3 から（ロール作成が先）。
`f` であるべきものが `t`：本番に進まない。エージェントに調査を依頼する。

### 1.6 Pooled connection（`soraban_app`）でアプリを動かして確かめる

1. 接続だけ確かめる：
   ```sh
   psql "$REHEARSAL_APP_URL" -c "select current_user, count(*) from schema_migrations group by 1"
   ```
   期待：`soraban_app | 9`。ホスト名に `-pooler` があること（`echo` せず、`node -e 'console.log(new URL(process.env.REHEARSAL_APP_URL).hostname)'` で確認）。
2. ローカルでアプリを起動して `/api/health/db` を見る：
   ```sh
   pnpm build
   DATABASE_URL="$REHEARSAL_APP_URL" pnpm --filter @soraban/web exec next start -p 3100
   ```
   （`$REHEARSAL_APP_URL` はシェルが展開するだけで、値は履歴に残らない。）別のターミナルのウィンドウで：
   ```sh
   curl -s http://localhost:3100/api/health/db
   ```
   期待：`"configured":true`、`"reachable":true`、`"postgresMajorVersion":18`、`postgisVersion` が出る、`"latestAppliedMigration":"0016"`、`"hasPendingMigrations":false`。接続文字列やホスト名は返らない。
3. 判定を 1 回行う：ブラウザで `http://localhost:3100` を開き、地点判定を 1 回実行する（判定の結果が出ること）。数秒後、オーナーで：
   ```sh
   psql "$DATABASE_URL_UNPOOLED" -c "select count(*), max(engine_version) from evidence_log"
   ```
   期待：`1` 行（判定 1 回につき 1 行）。`EVIDENCE_LOG` は設定しない。
4. 起動したサーバーを Ctrl+C で止める。

戻し方：
- `reachable:false`：§5.3 の切り分け。まず `REHEARSAL_APP_URL` のホスト名が `-pooler` を含むか、ユーザーが `soraban_app` か、`sslmode` を確認。
- `reachable:true` なのに `hasPendingMigrations:true`：マイグレーションが適用されていない／別のブランチを見ている。
- 判定で行が増えない：`/api/check` の応答は DB が失敗しても変わらない。サーバーのターミナルに `[evidence_log] write failed: …` が出ていないか見る（出ていればその `code=` を控える）。

### 1.7 エージェントに読み取り確認を頼む（第 2 章）

§1.3、§1.4、§1.5、§1.6 のあとに、第 2 章の依頼文でエージェントに確認を頼む。エージェントの確認が「全項目 OK」になるまで、本番に進まない。

### 1.8 後始末

1. 予行演習が**合格し、エージェントの確認結果も揃ってから**、ブランチを削除するか決める。削除すると、不具合が出たときの再現ができなくなる。迷うなら本番作業が終わるまで残す（残すと計算資源の課金が少しかかる可能性がある。※要確認）。
2. 削除する場合：Neon コンソール → Branches → `rehearsal-YYYYMMDD` → 削除。**`main` でないこと**を名前と親で確かめる。
3. 手元のシェルの秘密を消す：
   ```sh
   unset DATABASE_URL_UNPOOLED REHEARSAL_APP_URL
   ```
4. 予行演習のパスワードは、本番では使わない（本番は §3.2 で新しく生成する）。

---

## 2. エージェントによる読み取り確認の依頼

エージェントは本番・試験用ブランチの接続文字列を持たず、**書き込まない**。Neon コネクタ（MCP）を使い、**読み取り（SELECT と一覧・詳細の取得）だけ**で確認する。マイグレーションの実行・ロールの作成・ブランチの削除はエージェントには頼まない。

### 依頼の仕方

予行演習の各段階（§1.3、§1.4、§1.5、§1.6）のあと、チャットでこう伝える：

> 予行演習の段階 <1.3 など> まで終わりました。確認をお願いします。ブランチは `rehearsal-YYYYMMDD` です。読み取りだけでお願いします。

本番（`main`）の確認を頼むときは「本番の `main` ブランチを、読み取りだけで確認してください」と明記する。

### 確認項目のチェックリスト

| # | 項目 | 期待 |
|---|---|---|
| 1 | ブランチ | 対象ブランチが存在し、予行演習では親が `main`。`main` が既定ブランチのまま |
| 2 | ロール | `neondb_owner` と `soraban_app`。`soraban_app` が `neon_superuser` に属さず、`rolsuper` などが偽 |
| 3 | 拡張 | `postgis` が入っている（PostGIS 3.6 系） |
| 4 | テーブル | そらばんの表（`regulations`、`regulation_zones`、`evidence_log`、`organizations`、`members`、`aircraft`、`pilots`、`daily_inspections`、`flight_records`、`saved_places`、`flight_plans`、`judgement_snapshots`、`plan_confirmations`、`record_versions`、`schema_migrations`）が `public` にある |
| 5 | `schema_migrations` | 16 件（`0001`〜`0016`）。チェックサムはリポジトリのファイルと一致（エージェントが `sha256` を計算して突き合わせる） |
| 6 | 権限 | §1.5 A の表のとおり |
| 7 | トリガー | `record_versions` に追加前・追加後のトリガーがある。ヘッド表にもトリガーがある |
| 8 | 判定証跡 | 判定 1 回のあと `evidence_log` が 1 行（本番確認の後）。個人情報（IP・User-Agent）が入っていない（`client_user_agent` が null） |
| 9 | `neon_auth` | 本番の準備の段階では、スキーマが無い（Neon Auth 未有効） |

### エージェントが使う SELECT の例（読み取りだけ）

```sql
-- 2. ロールと属性
select rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin,
       pg_has_role(rolname, 'neon_superuser', 'member') as in_neon_superuser
from pg_roles where rolname in ('neondb_owner', 'soraban_app') order by rolname;

-- 3. 拡張
select extname, extversion from pg_extension order by extname;

-- 4. テーブルとビュー
select table_name, table_type from information_schema.tables
where table_schema = 'public' order by table_type, table_name;

-- 5. 適用記録（件数 16 とチェックサム）
select count(*) as n from schema_migrations;
select version, name, checksum, applied_at, duration_ms from schema_migrations order by version;

-- 6. 権限（テーブル）
select grantee, table_name, privilege_type from information_schema.role_table_grants
where grantee = 'soraban_app' and table_schema = 'public' order by table_name, privilege_type;

-- 6. 権限（関数）
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('soraban_app', p.oid, 'EXECUTE') as app_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('ops_bootstrap', 'verify_record_chain', 'record_version_hash')
order by p.proname;

-- 7. トリガー
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- 8. 判定証跡（件数と列の例。内容の全文は読まない）
select count(*) as n, min(checked_at) as first_at, max(checked_at) as last_at,
       count(client_user_agent) as with_user_agent
from evidence_log;

-- 9. Neon Auth のスキーマ
select schema_name from information_schema.schemata where schema_name = 'neon_auth';
```

エージェントは上の SELECT のほかに、ブランチ・ロール・データベースの一覧／詳細の取得（読み取りのツール）を使ってよい。`insert`／`update`／`delete`／`create`／`grant`／`alter`／`drop` は実行しない。結果にはパスワード・接続文字列を含めない。

---

## 3. 本番（`main` ブランチ）への適用

**前提：第 1 章の予行演習がすべて合格し、エージェントの確認が全項目 OK。**

### 3.1 事前：戻せる状態にしておく

1. Neon コンソールで、プロジェクトの履歴保持期間を確かめる（`history_retention_seconds` = 86400 秒＝1 日のはず。Settings の Storage／Restore window 等。画面の名称は変わることがある）。
2. 空の DB なので、戻す先は「空」しかない。それでも、念のため適用の直前に**スナップショット**を取れるなら取る（Neon のスナップショット機能。メニュー名・保持の条件は ※要確認：https://neon.com/docs の Backup & restore／Snapshots 周辺）。取れない場合は、1 日の履歴保持（時点復元）が使えることを確認して先へ進む。
3. 戻すのは**最後の手段**。原則は、次のとおり。

#### 失敗したときの原則（本番）

- 空の DB なので「DB を空に戻す」ことは通常しない。
- 適用済みの `0001`〜`000N` は**書き換えない**（書き換えるとチェックサム不一致で以後の適用が止まる）。
- ランナーは 1 ファイル 1 トランザクションで、失敗したファイルは取り消され記録されない。以降のファイルは適用されない。だから**止まった所で DB は一貫した状態**にある（`000N` まで適用済み）。
- 原因を直す：コード側の問題なら、新しい番号のマイグレーションまたは未適用ファイルの修正を、通常の流れ（planner → generator → evaluator → マージ）で行い、`main` を取得し直して `pnpm db:migrate --target <ホスト名>` をもう一度実行する。ランナーは適用済みを飛ばして続きから適用する。
  - まだ適用されていない（失敗した）ファイルは、記録がないので修正できる。適用済みのファイルは修正できない。
- 環境の問題（接続・権限・ネットワーク）なら、直してそのまま同じコマンドを再実行する。
- どうしても DB を空からやり直す必要が出たら、まず**止まってエージェントに相談する**（本番にはまだ利用者のデータがないはずだが、やり直しの前にデータが空であることを §2 の依頼で確認する）。Neon の時点復元は別の手段（※要確認）。

### 3.2 `soraban_app` を作る（本番 `main`）

予行演習の §1.3 と同じ。ただし対象が本番。

1. 新しいパスワードを生成：`openssl rand -hex 24`（予行演習のものは使わない）。
2. Neon コンソール → `soraban` → **既定ブランチ `main`**（ブランチ名を画面で確かめる）→ SQL Editor（オーナー）：
   ```sql
   create role soraban_app with login password '<生成したパスワード>';
   ```
3. このパスワードを、Vercel の環境変数に入れる日（§3.4）まで、手元の 1 か所（パスワードマネージャーなど）に控えるか、すぐ §3.4 に進む。チャット・リポジトリには貼らない。

確かめること：§1.3 の確認 SQL を、本番の Direct connection で実行して同じ結果（`rolcanlogin` だけ `t`）。

戻し方：パスワードの書き間違い → `alter role soraban_app password '<新しいパスワード>';`。ロールを消したい場合は、まだ表への権限が付く前（マイグレーション前）なら `drop role soraban_app;`。

### 3.3 `main` にマイグレーションを適用する

1. Neon コンソール → `soraban` → `main` → Connect → Direct connection（`neondb_owner`、Connection pooling なし）→ `sslmode=verify-full` に書き換え：
   ```sh
   read -rs DATABASE_URL_UNPOOLED && export DATABASE_URL_UNPOOLED
   node -e 'console.log(new URL(process.env.DATABASE_URL_UNPOOLED).hostname)'
   ```
   予行演習のホスト名と**違う**ことを確かめる。これが本番の `<ホスト名>`。
2. 適用前：
   ```sh
   pnpm db:status
   ```
   期待：`適用済み 0 件、未適用 16 件`、host が本番。
3. 適用：
   ```sh
   pnpm db:migrate --target <本番のホスト名>
   ```
   期待：9 ファイルが順に「適用」。終了コード 0。
4. 2 回目と確認：
   ```sh
   pnpm db:migrate --target <本番のホスト名>
   pnpm db:status
   ```
   期待：`未適用のマイグレーションはありません。`、`適用済み 16 件、未適用 0 件`。
5. エージェントに依頼（第 2 章）：「本番の `main` ブランチを、読み取りだけで確認してください」。§2 のチェックリストの 1〜7 が OK（8 は判定の後）。
6. `unset DATABASE_URL_UNPOOLED`。

止まったとき：§3.1 の原則に従う。エラー文を控えてエージェントに相談（接続文字列は伝えない）。

### 3.4 Vercel の環境変数 `DATABASE_URL`（Production のみ・Sensitive）

README「ユーザー作業」手順 1 のとおり。

1. Neon コンソールで `main` の Connect → **Pooled connection**（ホスト名に `-pooler`）の文字列を表示し、ユーザー名とパスワードを `soraban_app` と §3.2 のパスワードに置き換え、`sslmode=verify-full` にする。
2. Vercel → チーム taiyo-works-projects → プロジェクト soraban → Settings → Environment Variables → 追加：名前 `DATABASE_URL`。
3. 対象の環境は初期状態で Production・Preview・Development のすべてが選ばれている。**Production だけ**を残して他を外す。**Sensitive** を有効にする。保存。
4. `DATABASE_URL_UNPOOLED` と `EVIDENCE_LOG` は設定しない。Neon の Vercel 連携（ブランチ自動作成）は使わない。

確かめること：一覧に `DATABASE_URL` があり、環境が Production のみ、Sensitive 表示。

戻し方：間違えたら値を入れ直す（Sensitive は保存後に値を表示できない）。環境を間違えたら削除して作り直す。

### 3.5 Production を再デプロイして確認する

1. Vercel → Deployments → 最新の Production のデプロイ → Redeploy（環境変数は再デプロイで反映される）。
2. 完了後：
   ```sh
   curl -s https://soraban.futuretec.jp/api/health/db
   ```
   期待：`"configured":true`、`"reachable":true`、`"latestAppliedMigration":"0016"`、`"hasPendingMigrations":false`。
   定期監視には使わない（呼ぶたびに計算資源が起動して従量課金が増える）。確認のために数回だけ。
3. 本番で地点判定を 1 回実行する。エージェントに依頼：「本番の `main` の `evidence_log` が 1 行になったか、読み取りだけで確認してください」。期待：1 行（`engine_version` が `soraban-0.4.0-verdict-2026-10`、`client_user_agent` が null）。`EVIDENCE_LOG` は通常設定しない。

戻し方：
- `reachable:false`：§5.3。
- `configured:false`：環境変数が Production に入っていない／再デプロイしていない。
- すぐ DB を外したい：`DATABASE_URL` を削除して再デプロイすれば、判定・申請支援は DB なしで動く（README「環境変数」）。

---

## 4. その先（運航管理を本番で使うとき）

**DB 準備（第 3 章）が先。済んでいなければ始めない。** 詳細は `packages/db/README.md`「運航管理（Sprint 10）の本番準備」と `docs/sprints/sprint-10.md`「ユーザー作業」。ここには順序の要点だけを書く。

1. 第 3 章が完了していること（`soraban_app` 作成、0001〜0016 の適用、`DATABASE_URL`）。0004〜0016 は第 3 章で同時に適用済み。
2. Neon Auth の有効化（`main`。aws-ap-southeast-1 で有効にできるか確かめる。できなければ止めて planner に戻す）。Auth URL を控える。
3. Google OAuth クライアント（Google Cloud）。リダイレクト URI は `{Auth URL}/callback/google`。
4. Neon Auth の本番設定（信頼するドメイン、アプリ名、Allow Localhost を無効）。
5. `select ops_bootstrap(…)`（Neon の SQL Editor、オーナー）。
6. Vercel の Production に `AUTH_PROVIDER=neon`、`NEON_AUTH_BASE_URL`、`NEON_AUTH_COOKIE_SECRET`。**最後に** `OPS_ENABLED=1`。再デプロイ。
7. `AUTH_TEST_SECRET` は本番に設定しない。

試験用ブランチでは Neon Auth を有効にしない（本番の準備と同じ手順を通したいなら別途相談。※Neon Auth を試験用ブランチで試せるかは未確認）。

---

## 5. 失敗したとき・やり直すとき

### 5.1 試験用ブランチを消して作り直す

1. Neon コンソール → Branches → `rehearsal-…` を削除（**親の `main` を消さない**）。
2. §1.1 から（名前は日付を変えて作るとよい）。
3. 手元の変数を消す：`unset DATABASE_URL_UNPOOLED REHEARSAL_APP_URL`。

### 5.2 パスワードを再発行する

1. 新しいパスワードを `openssl rand -hex 24` で生成。
2. SQL Editor（オーナー、対象ブランチ）で `alter role soraban_app password '<新しいパスワード>';`。
3. 使っている場所を入れ直す：Vercel の `DATABASE_URL`（本番）→ Production を再デプロイ。手元の `REHEARSAL_APP_URL` も。
4. `/api/health/db` で `reachable:true` を確かめる。

### 5.3 接続できないときの切り分け

| 症状 | 見ること |
|---|---|
| `db:migrate` が「`-pooler` を含む接続文字列は使えません」 | Direct connection を使っているか。Connect 画面の Connection pooling を切る |
| 「`--target` と接続先のホスト名が一致しません」 | `--target` に、`DATABASE_URL_UNPOOLED` のホスト名（§1.2 の手順で取り出したもの）を渡したか。予行演習と本番を取り違えていないか |
| 「`DATABASE_URL_UNPOOLED` が設定されていません」 | 別のターミナルのウィンドウで実行していないか。`read -rs` を同じウィンドウで実行したか |
| 接続できません（タイムアウト） | 数十秒待って再実行（停止中の計算資源の起動待ち）。ネットワーク・VPN。Neon のプロジェクトの状態 |
| password authentication failed | パスワード、ロール名の取り違え（`neondb_owner` と `soraban_app`）。貼り付けのときの余分な空白・改行 |
| SSL の警告／エラー | `sslmode=verify-full` にしているか。接続文字列の他のパラメータを削っていないか |
| アプリで `reachable:false` | `DATABASE_URL` のホスト名に `-pooler` があるか／ユーザーが `soraban_app` か／マイグレーションが `soraban_app` を作った**後**か（順序を逆にした場合は README の復旧用 `grant …` を実行） |
| `permission denied for table …` | `soraban_app` の権限（§1.5 A）。順序を逆にした場合の復旧は README |
| 接続文字列のパスワードに記号があって失敗 | 記号は URL エンコードが要る。`openssl rand -hex` の英数字を使う |

それでも分からなければ、エラー文（パスワード・接続文字列を除く）をチャットに貼って、エージェントに調査を依頼する。

---

## 6. 記録

### 実施記録

| 段階 | 実施日 | 実施者 | 結果（OK／要対応） | エージェントの確認日 | メモ |
|---|---|---|---|---|---|
| 0. 準備（remote 修正、ツール確認） | | | | — | |
| 1.1 試験用ブランチ作成 | | | | | |
| 1.3 `soraban_app` 作成 | | | | | |
| 1.4 マイグレーション（2 回実行） | | | | | |
| 1.5 権限の確認 | | | | | |
| 1.6 アプリ経由の確認（`/api/health/db`、証跡 1 行） | | | | | |
| 1.8 後始末（ブランチ削除の可否） | | | | — | |
| 3.1 事前（スナップショット／履歴保持の確認） | | | | — | |
| 3.2 本番 `soraban_app` 作成 | | | | | |
| 3.3 本番マイグレーション | | | | | |
| 3.4 Vercel `DATABASE_URL` | | | | — | |
| 3.5 再デプロイ後の確認 | | | | | |

### `docs/HANDOFF.md` §5 の更新案（実施後に反映する）

現在の行：「本番の DB 準備：soraban_app ロール作成 → マイグレーション → Vercel の `DATABASE_URL`（Production のみ・Sensitive）」の「手順の置き場所」を、次のように変える案：

- 手順の置き場所：`docs/runbooks/production-db-prep.md`（予行演習つき。正は `packages/db/README.md`）
- 実施後：行を取り消し線にして「（YYYY-MM-DD にのりさんが実施。済み）」とする。

### この手順書の更新

DB を乗り換える、マイグレーションが増える（`0016` → `00NN`）、Neon の画面が変わったときは、この手順書の期待値（件数 16、最新版 `0016`）と画面の名称を直す。
