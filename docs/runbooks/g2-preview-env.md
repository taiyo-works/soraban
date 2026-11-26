# G-2 の実機確認用の Preview 環境（ユーザー作業）

Sprint 16 のゲート G-2（`docs/evaluations/sprint-16-eval.md`）を iPhone の Safari で見るための、試験用の環境の作り方と片付け方。2026-11-26 にユーザーが案 A（Vercel の Preview に試験用の DB をつなぐ）を選んだ。

**エージェントは行わない**（本番の DB・Neon・Vercel に触れない決まり）。ここに書いた操作は、すべてユーザーが各サービスの画面と手元の PC で行う。

## 0. 先に知っておくこと

- **Preview では、テスト用のログインは使えない**。Vercel の環境では `AUTH_PROVIDER=test` が設定不足として扱われ、`/api/test-auth/*` は 404 になる（`packages/db/README.md`「運航管理の本番準備」手順 7）。このため、**Neon Auth（Google ログイン）を試験用のブランチに用意する**必要がある。
- これは、本番の運航管理の準備（`packages/db/README.md` の手順 3〜7）の予行演習にもなる。違うのは、Neon の**本番ブランチ（`main`）ではなく試験用のブランチ**を使うことと、Vercel の環境変数を **Production ではなく、このブランチの Preview だけ**に入れること。
- 既存の文書の次の 2 つの決まりを、**この確認の間だけ、試験用のブランチに限って外す**（ユーザーの決定、2026-11-26）。
  - `production-db-prep.md` §3.4: `DATABASE_URL` は Production だけ → この確認の間は、試験用ブランチの接続先を、Git ブランチを指定した Preview にも入れる。
  - `packages/db/README.md` 手順 3: プレビュー用のブランチで Neon Auth を有効にしない → 試験用ブランチで有効にする。
- **本番に影響させないための約束**:
  - Neon の `main` ブランチで何も操作しない（作成・SQL の実行・Auth の設定）。
  - Vercel の環境変数は、どれも **Production・Development のチェックを外し、Preview の Git ブランチ `claude/charming-goldberg-imupw0` だけ**に入れる。
  - `AUTH_TEST_SECRET` と `APPLICATION_SUPPORT_ENABLED` はどこにも入れない。
  - 終わったら §6 で必ず片付ける。

所要時間の目安は 1.5〜2 時間（Neon Auth と Google の設定が初めての場合）。

### 確証のない点（※要再確認。作業中に画面で確かめる）

| # | 内容 | 確かめられなかったときの対応 |
|---|---|---|
| U-1 | Neon Auth を、`main` 以外のブランチで有効にできるか。ブランチごとに Auth URL が分かれるか | §3.1 で止める。オーケストレーターに知らせる（代わりの案：手元の PC で動かす案 B に切り替える） |
| U-2 | Neon Auth に、自社の Google の資格情報なしで試せる開発用のログインがあるか | 無ければ §3.2 で Google Cloud の OAuth クライアントを作る |
| U-3 | Vercel のブランチ用の固定の URL（ブランチドメイン）の正確な形。ブランチ名が長いので、省略されることがある | Vercel の Deployments の画面に出る URL をそのまま使う |
| U-4 | iPhone の「文字サイズ」の設定が Safari の画面にどこまで効くか（FC-5） | G-2 の確認表の手順どおり、設定アプリと Safari の「ぁあ」の両方で見る |

## 1. 用意するもの

- PC（手元のシェルで `psql` と `pnpm` が使えること。このリポジトリを clone して `pnpm install` 済み）。
- Neon・Vercel・（必要なら）Google Cloud のコンソールに入れるアカウント。
- iPhone（Safari）。Vercel の Preview に保護（Vercel Authentication）が掛かっている場合は、iPhone の Safari で Vercel にログインしておく。

## 2. 試験用の DB を作る（Neon）

`docs/runbooks/production-db-prep.md` の **§1.1〜§1.5 をそのまま行う**。ただしブランチ名は `g2-preview-YYYYMMDD` にする（予行演習の `rehearsal-…` と区別するため）。

1. §1.1 ブランチを作る（親は `main`。**`main` そのものには何もしない**）。
2. §1.2 Direct connection（オーナー）を手元のシェルに入れる。
3. §1.3 `soraban_app` を作る（**マイグレーションより先**）。
4. §1.4 マイグレーションを適用する（`pnpm db:status` → `pnpm db:migrate --target <ホスト名>` → `pnpm db:status`）。最新のマイグレーションまで適用されたことを確かめる。
5. §1.5 権限を確かめる。

ここで、Pooled connection（`soraban_app`、ホスト名に `-pooler`）の接続文字列を控える。以下 `G2_APP_URL` と呼ぶ。**チャットや文書に貼らない。**

## 3. ログインを用意する（Neon Auth）

### 3.1 Neon Auth を試験用ブランチで有効にする

1. Neon コンソール → プロジェクト `soraban` → ブランチを **`g2-preview-YYYYMMDD` に切り替えたことを画面の上で確かめる** → Auth → 有効化。
2. Auth URL を控える。以下 `G2_AUTH_URL`。
3. **止める条件（U-1）**: 試験用ブランチを選べない、または有効にすると `main` にも効くように見える場合は、ここで止める。何もせずにオーケストレーターに知らせる。

### 3.2 Google ログインの資格情報（U-2）

- Neon Auth に開発用の Google ログインが最初から使える表示があれば、それを使う（この確認だけの用途）。
- 無い場合：Google Cloud コンソールで OAuth クライアント（ウェブアプリケーション）を作る。名前は「soraban G-2 試験用」など、本番用と区別できるものにする。承認済みのリダイレクト URI に `{G2_AUTH_URL}/callback/google`（末尾にスラッシュを付けない）を登録し、Neon の Auth の設定 → OAuth providers に Client ID・Secret を入れる。

### 3.3 Neon Auth の設定

1. 信頼するドメインに、§4.3 で確かめる **Preview のブランチドメイン**を追加する（§4 の後で戻ってきて入れてもよい）。
2. 「Allow Localhost」は無効のままでよい。

### 3.4 最初の運航管理者を作る

Neon の SQL Editor で、**ブランチが `g2-preview-YYYYMMDD` であることを確かめてから**、オーナーロールで 1 回実行する。

```sql
select ops_bootstrap('フューチャーテック株式会社', '<自分の Google アカウントのメール>', '<表示名>');
```

## 4. Vercel の Preview に環境変数を入れる

### 4.1 Cookie の秘密を作る

手元のシェルで、次の出力を控える（以下 `G2_COOKIE_SECRET`）。

```bash
openssl rand -base64 32
```

### 4.2 環境変数を足す

Vercel → チーム taiyo-works-projects → プロジェクト soraban → Settings → Environment Variables。次の 5 つを**1 つずつ**足す。どれも、

- 対象の環境は **Preview だけ**にチェックを入れ、Production と Development のチェックを外す。
- Preview の「Git ブランチを選ぶ」欄に **`claude/charming-goldberg-imupw0`** を入れる（全ブランチの Preview にしない）。
- 秘密（1・3）は **Sensitive** を有効にする。

| # | 名前 | 値 |
|---|---|---|
| 1 | `DATABASE_URL` | `G2_APP_URL`（§2 の Pooled connection） |
| 2 | `AUTH_PROVIDER` | `neon` |
| 3 | `NEON_AUTH_COOKIE_SECRET` | `G2_COOKIE_SECRET`（§4.1） |
| 4 | `NEON_AUTH_BASE_URL` | `G2_AUTH_URL`（§3.1） |
| 5 | `OPS_ENABLED` | `1`（**最後に**入れる） |

入れないもの：`AUTH_TEST_SECRET`、`APPLICATION_SUPPORT_ENABLED`、`DATABASE_URL_UNPOOLED`、`EVIDENCE_LOG`。

**確かめること**: 一覧で、5 つとも環境の欄が「Preview（claude/charming-goldberg-imupw0）」だけになっていること。Production に新しい変数が増えていないこと。

### 4.3 再デプロイとブランチドメイン

1. Vercel → Deployments → ブランチ `claude/charming-goldberg-imupw0` の最新のデプロイ → Redeploy（環境変数は、入れた後のデプロイにだけ効く）。
2. デプロイの詳細に出る**ブランチドメイン**（ブランチ名を含む、固定の URL。U-3）を控える。以下 `{origin}`。G-2 の確認表の `{origin}` はこれ。
3. §3.3 の信頼するドメインに `{origin}` のホスト名が入っているか確かめる（未登録なら入れる）。

## 5. 動くことを確かめる

1. PC のブラウザで `{origin}/api/health/db` を開く。期待：`"configured":true`、`"reachable":true`、`"hasPendingMigrations":false`。
2. `{origin}/ops` を開き、Google でログインする。役割が「運航管理者」と出ること。
3. 失敗したときの見分け方：
   - `/ops` が 404：`OPS_ENABLED` が効いていない（Preview の Git ブランチの指定、または再デプロイ忘れ）。
   - `/ops` が「運航管理は準備中です」と理由コードを示す 503：コードの名前の変数が足りない（例：`neon_auth_base_url_missing` は `NEON_AUTH_BASE_URL`）。
   - Google から戻った後にエラー：§3.3 の信頼するドメイン、§3.2 のリダイレクト URI。
   - `reachable:false`：`production-db-prep.md` §5.3 の切り分け。
4. 動いたら、G-2 の確認表の「1. 用意するデータ」を、iPhone か PC の画面から作る（テスト用の初期データの投入 `db:seed:ops-test` は localhost にしか入らないので、使えない）。**実在の人の氏名・技能証明書番号は使わない**（「試験 操縦者 一」などの仮の値にする）。
5. iPhone の Safari で `{origin}/ops` を開き、`docs/evaluations/sprint-16-eval.md` の確認表を進める。

## 6. 片付け（G-2 が終わったら必ず）

順番を守る（先にアプリを止めてから DB を消す）。

1. Vercel → Environment Variables で、§4.2 の 5 つを削除する。**環境の欄が「Preview（claude/charming-goldberg-imupw0）」のものだけ**を消すこと。Production の変数に触れない。
2. Vercel で同じブランチを再デプロイする（`/ops` が 404 に戻ることを確かめる）。
3. Neon コンソール → Branches → `g2-preview-YYYYMMDD` を削除する。**`main` でないことを、名前と親で確かめる。** Neon Auth の設定もブランチと一緒に消える（※要再確認。残っていれば Auth の画面で無効にする）。
4. §3.2 で Google の OAuth クライアントを作った場合は、Google Cloud コンソールで削除する。
5. 手元のシェルの秘密を消す：

```bash
unset DATABASE_URL_UNPOOLED G2_APP_URL
```

6. G-2 の結果の節（`sprint-16-eval.md` §3）に「片付け済み（日付）」と書く。

## 7. 記録

| 手順 | 日付 | 結果 | メモ（秘密は書かない） |
|---|---|---|---|
| §2 試験用の DB | | | |
| §3 Neon Auth（U-1・U-2 の結果） | | | |
| §4 Vercel の Preview（U-3 のブランチドメイン） | | | |
| §5 動作の確認 | | | |
| §6 片付け | | | |
