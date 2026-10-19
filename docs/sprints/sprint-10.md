# Sprint 10: 利用者・機体・操縦者（認証の境界・組織と役割・版の履歴）

> 親文書：`docs/spec.md` §13.5・§13.6・§13.8.1 ／ `docs/00_NORTH_STAR.md` §0.1.1・§0.1.5・§0.1.6
> 期間：2026-12-07〜12-18（2 週間）
> 前提：Sprint 8（Neon の土台：`pg` 接続層、SQL マイグレーション 0001〜0003、`soraban_app` ロール、CI の `db` ジョブ）と Sprint 9 が `main` に入っていること。
> ※ Next.js は破壊的変更を含むため、実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。本リポジトリは Next.js 16.2.4 で、ミドルウェアは `proxy.ts` になっている。

## 目的と位置付け

運航管理の記録（Sprint 11 以降の日常点検・飛行記録・飛行計画・点検整備）の土台として、次の 4 つを作る。

1. 利用者の本人確認（Neon Auth）と、それを差し替えられる境界（CI・E2E は Neon Auth に接続しない）
2. 組織と役割（運航管理者・操縦者・閲覧者）を、そらばんの DB の表で管理する仕組み
3. 版の履歴（上書き・物理削除をせず、訂正を版として追記し、ハッシュ連鎖で改変を検出する）
4. 機体と操縦者の登録・訂正（飛行日誌の取扱要領が求める項目）

North Star §0.1.7 の 1（記録の手間と誤りを減らす）・3（記録に根拠を残す）・4（担当者が替わっても維持できる）に当たる。判定ロジック・証跡 ID・`evidence_log` は変えない。地点判定と申請支援の画面は、引き続きログインなしで使える。

**本番の準備（DB ロール・マイグレーション・Neon Auth・環境変数）が済むまで、本番では利用者機能を出さない。** 機能フラグ（下記 A）が既定で無効なので、Sprint 10 の開発・検証・マージは本番の準備を待たずに進められる。ユーザー（のりさん）は入院中でスマートフォンしか使えない期間があるため、本番の準備は退院後に回せる形にする。

## 決定済みの前提（spec §13.8.1、2026-10-19）

| 項目 | 内容 |
|---|---|
| 認証 | Neon Auth。本人確認（ログイン。Google アカウント可）だけを任せる |
| 組織・役割 | そらばんの DB の表で管理する。Neon Auth の組織機能には依存しない |
| 課金 | Neon は従量課金。scale-to-zero を維持し、CI の DB は PostGIS のサービスコンテナ（Neon のブランチを作らない） |
| DB ロール | アプリは `soraban_app`（Sprint 8。参照と追加の最小権限）、マイグレーションはオーナーロール |
| 利用者の範囲 | 本計画で定める → 自社（フューチャーテック株式会社）の社員に限る（未決 1） |

## 確認した外部条件（2026-10-19 に WebFetch で確認。確認できなかったものは「未確認」）

### Neon Auth

| 項目 | 確認結果 |
|---|---|
| 正体 | 「Managed Better Auth」。Better Auth を基にした管理型の認証サービス。サービス側は Better Auth 1.7.6 で動く。サービスは一般提供（generally available）で「active development」中（https://neon.com/docs/auth/overview 、https://neon.com/docs/auth/about 、https://neon.com/docs/auth/roadmap ） |
| SDK | `@neondatabase/auth`。about のページに `0.6.0-beta` の記載があり、**SDK はベータ版**。Next.js 16 との組み合わせの動作は**未確認**（導入時に版を固定して確かめる） |
| Next.js での組み込み | 環境変数 `NEON_AUTH_BASE_URL`（Auth URL）・`NEON_AUTH_COOKIE_SECRET`（32 文字以上、`openssl rand -base64 32`）。サーバー側は `createNeonAuth`（`@neondatabase/auth/next/server`）で `auth` を作り、`app/api/auth/[...path]/route.ts` で `auth.handler()` の `GET`・`POST` を公開する。保護は Next.js 16 では `proxy.ts` で `auth.middleware({ loginUrl })`。セッションはサーバー側で `await auth.getSession()`（`data.user`・`data.session`）。クライアントは `createAuthClient`（`@neondatabase/auth/next`）。`cookies.sessionDataTtl` の既定は 300 秒（https://neon.com/docs/auth/quick-start/nextjs ） |
| ユーザー表の置き場所 | 認証データ（ユーザー、セッション、OAuth 設定）は対象データベースの **`neon_auth` スキーマ**に置かれる。表の名前と列は確認したページに記載がなく**未確認**（API の文書に `users_sync` の名があるが、Managed Better Auth の表かは未確認）（https://neon.com/docs/auth/overview 、https://neon.com/docs/auth/guides/manage-auth-api ） |
| ブランチとの関係 | `neon_auth` はブランチ作成時に業務データと一緒に複製される。ブランチごとに別の Auth API URL を持ち、あるブランチで発行したトークンは他のブランチで無効。設定（OAuth の資格情報を含む）もブランチごと。読み書き可能なエンドポイントが必要（https://neon.com/docs/auth/branching-authentication 、https://neon.com/docs/auth/guides/setup-oauth ） |
| 料金 | 全プランに含まれ、月間アクティブ利用者（MAU）で上限が決まる：Free 6 万、Launch・Scale 100 万。MAU あたりの単価の記載はない（https://neon.com/docs/auth/about ）。認証の処理（ログイン・セッション確認）が Neon の計算資源を起動するか、起動する場合の頻度は**未確認** |
| 地域・制約 | AWS の地域だけで提供（Azure 不可）。対応地域の一覧はなく、aws-ap-southeast-1 で使えるかは**未確認**（有効化の際にコンソールで確かめる）。IP Allow・Private Networking を有効にしたプロジェクトでは使えない（https://neon.com/docs/auth/about ） |
| 組織機能 | Organization プラグインは「Partial」。Admin プラグインは対応、そのカスタマイズは「Coming soon」。MFA は「Coming soon」（https://neon.com/docs/auth/roadmap ）。決定どおり使わない |
| Google ログイン | 既定で Neon 所有の共有の資格情報で有効（開発・試験用）。本番は自社の Google OAuth クライアント（Client ID・Secret）を設定する。リダイレクト URI は `{NEON_AUTH_BASE_URL}/callback/google`。設定はコンソール（ブランチ → Settings → Auth）、CLI、API（`POST /projects/{project_id}/branches/{branch_id}/auth/oauth_providers`）のいずれか（https://neon.com/docs/auth/guides/setup-oauth ） |
| 有効化 | コンソールの Auth のページ、または API `POST /projects/{project_id}/branches/{branch_id}/auth`（`{"auth_provider": "better_auth"}`）。無効化は `DELETE …/auth`（`delete_data` 既定 false で `neon_auth` スキーマは残る）（https://neon.com/docs/auth/guides/manage-auth-api ） |
| 本番の確認項目 | 信頼するドメイン（本番ドメイン）の登録、自社のメール送信の設定（既定は共有の `auth@mail.myneon.app`）、アプリ名、自社の OAuth 資格情報、メール確認の有効化（既定は無効）、「Allow Localhost」の無効化（既定は有効）（https://neon.com/docs/auth/production-checklist ） |
| 新規登録の制限 | 新規登録（サインアップ）を止める設定、メールのドメインで制限する設定は、確認したページに記載がなく**未確認**。そのため本計画では、アプリ側で「招待された社員の、確認済みのメールアドレス」だけを利用者として扱う（下記 B） |

### 飛行日誌の取扱要領（機体・操縦者に関わる項目）

出典：「無人航空機の飛行日誌の取扱要領」（令和4年12月1日制定、国空無機第236963号）（https://www.mlit.go.jp/koku/content/001574394.pdf ）、「無人航空機の飛行日誌の取扱いに関するガイドライン」（令和5年3月31日制定）（https://www.mlit.go.jp/common/001599241.pdf ）。2026-10-19 時点でこれより新しい改正の有無は**未確認**。

| 項目 | 要領の扱い | 本スプリントの扱い |
|---|---|---|
| 作成の単位 | 機体ごとに備え、記載する | 機体を記録の親にする（Sprint 11 以降） |
| 登録記号 | 必須（国土交通大臣から通知されたもの） | 必須。`JU` で始まる英大文字・数字。桁数は**未確認**のため、桁数の検査は確認後に足す |
| 種類・型式 | 型式認証を受けた機体に限り記載 | 型式認証の有無と、ありの場合の種類・型式・型式認証書番号を持つ。一般の型式名（例：製品名）は別項目で必須 |
| 機体認証 | 機体認証を受けた機体に限り、区分と機体認証書番号 | 任意項目（区分：第一種・第二種） |
| 設計製造者・製造番号 | 記載する | 必須 |
| 総飛行時間 | 飛行記録に「製造後の総飛行時間」、点検整備記録に「最近の機体認証後の総飛行時間」 | 機体に「使用開始時点の既存の総飛行時間（分）」を持つ（spec §13.5.1）。累計は Sprint 11 |
| 操縦者の氏名 | 記載する | 必須 |
| 技能証明書番号 | 技能証明の交付を受けている場合に限り記載 | 技能証明「あり」なら区分（一等・二等）と番号を必須、「なし」なら番号を受け付けない（spec §13.5.1 の「任意」をこの条件付き必須に改める） |
| 電子での作成 | 様式 1〜3 の内容を網羅すれば電磁的記録・保管が可。様式のように表示・印刷できること | 出力は Sprint 15 |
| 保存 | 記載と保管は「無人航空機が登録されている間は継続」。年数の定めはない | 物理削除しない（下記 C） |
| 訂正 | 訂正方法の定めは見当たらない（紙はボールペンで記入、点検整備記録は前回との間に空行と「〆」） | 訂正は新しい版として追記し、訂正者・日時・理由を残す（spec §13.5.2） |

## 設計

### A. 機能フラグと認証の境界

**利用者機能の可否は 1 か所の関数（例：`getOpsAvailability(env)`）で決める。** 結果は `disabled`・`misconfigured`（理由コード付き）・`enabled` の 3 つ。

| 条件 | 結果 |
|---|---|
| `OPS_ENABLED` が `1` でない（既定） | `disabled` |
| `OPS_ENABLED=1` だが、`DATABASE_URL` 未設定／`AUTH_PROVIDER` 未設定・不正／`AUTH_PROVIDER=neon` で `NEON_AUTH_BASE_URL`・`NEON_AUTH_COOKIE_SECRET` のどちらかが無い／`AUTH_PROVIDER=test` で `AUTH_TEST_SECRET` が無い | `misconfigured` |
| `AUTH_PROVIDER=test` かつ `VERCEL_ENV=production` | `misconfigured`（本番でテスト用認証を使わせない） |
| 上記以外 | `enabled` |

- `disabled` のとき：`/ops` 以下の画面、`/api/ops/*`、`/api/auth/*`（Neon Auth の中継）、`/api/test-auth/*` はすべて 404。判定画面に運航管理へのリンクを出さない。Neon Auth の SDK を初期化しない（モジュールの読み込み時に環境変数を読まず、使うときに遅延生成する）。DB にも接続しない。
- `misconfigured` のとき：`/ops` は「運航管理は準備中です」と理由コードだけを示す 503 の画面、API は 503。環境変数の値は表示しない。
- `pnpm build` は `OPS_ENABLED`・`AUTH_PROVIDER`・`NEON_AUTH_*` がすべて無くても通る。秘密の値は `NEXT_PUBLIC_` を付けず、ブラウザに渡さない。
- 本番での切り戻しは `OPS_ENABLED` を外して再デプロイするだけで済む（DB の表は残る）。

**認証は差し替え可能な境界（例：`AuthProvider`）の内側に閉じ込める。** アプリの他の部分は `getCurrentIdentity(): Promise<Identity | null>` だけを使う。`Identity` は `{ provider, authUserId, email, emailVerified, name }` に限る。

| 実装 | 使う場所 | 内容 |
|---|---|---|
| `neon` | 本番 | `@neondatabase/auth` の `auth.getSession()` の `data.user` を `Identity` に写す。SDK の例外・セッションなしは `null`。サインイン画面は Google ログインのボタンだけを出す（メールとパスワードの画面は作らない。未決 3） |
| `test` | CI・E2E・ローカル | `POST /api/test-auth/sign-in`（本文に `authUserId`・`email`・`emailVerified`・`name`）で、`AUTH_TEST_SECRET` で HMAC 署名した Cookie（`HttpOnly`・`SameSite=Lax`）を発行し、`getCurrentIdentity` はその署名を検証して返す。`POST /api/test-auth/sign-out` で消す |

- 理由：Neon Auth はブランチごとに URL と利用者を持つ外部サービスで、CI から使うには Neon のブランチと秘密情報を GitHub に置く必要がある（§13.8.1 の方針に反し、課金も増える）。認可（誰が何をできるか）はそらばんの表で決めるので、本人確認だけを差し替えれば、認可・版の履歴・画面はすべて CI と E2E で本番と同じコードを通る。
- `neon` の実装は SDK を模擬した単体テストで確かめる。実際の Neon Auth との結合は本番の準備の最後の確認（ユーザー作業 6）で行う。残るリスク（SDK がベータ版、Next.js 16 との相性）は、機能フラグで本番の利用者機能を止められることで抑える。
- 画面の保護は、各ページ（サーバーコンポーネント）とルートハンドラの冒頭で、共通の関数（例：`requireMember(ctx)`）を呼んで行う。`proxy.ts` に認可を置かない（`test` 実装と同じ経路で確かめられるようにするため）。Neon Auth のセッション Cookie の更新に `proxy.ts` が要るかは実装時に SDK の文書で確かめ、要る場合は `/ops` と `/api/ops` に限った matcher で、`disabled` のときは何もしない形にする。
- 変更を伴う API（POST・PATCH）は、`Origin` が自サイトでない要求を 403 にする（Cookie 認証での CSRF 対策）。

### B. 組織・利用者・役割（そらばんの表）

- `organizations`：組織（第1段階は自社 1 件）。すべての運航管理の表に `org_id` を持たせる（spec §13.5.2）。
- `members`（利用者＝組織の構成員）：`id`、`org_id`、`email`（小文字に正規化）、`display_name`、`role`（`manager` 運航管理者／`pilot` 操縦者／`viewer` 閲覧者）、`status`（`invited` 招待中／`active` 有効／`disabled` 停止）、`auth_provider`・`auth_user_id`（初回ログインで結び付ける。結び付け前は NULL）。`(auth_provider, auth_user_id)` は一意。第1段階では 1 人 1 組織。
- `neon_auth` スキーマの表を外部キーで参照しない。マイグレーションは `neon_auth` に触れない（CI のコンテナには `neon_auth` が無く、表の名前も未確認のため）。
- **利用者として扱う条件**：`Identity` が得られ、(1) `(provider, authUserId)` が `active` の `members` に結び付いている、または (2) 未結び付きで、`emailVerified` が真で、メールアドレスが同じ組織の `invited` の行と一致する（このとき結び付けて `active` にし、版を 1 つ追加する）。それ以外は「権限がありません。運航管理者に招待を依頼してください」の画面（API は 403）。確認されていないメールアドレスで結び付けない理由：メールとパスワードの登録が有効な場合、他人の招待済みアドレスで登録して成り代われるため。
- 毎回の要求で `members` を読み、`disabled` は次の要求から 403 にする。
- **最初の運航管理者**は、本番の準備の際に Neon の SQL Editor（オーナーロール）で実行する関数（例：`ops_bootstrap(組織名, メール, 表示名)`。マイグレーションで定義し、`soraban_app` には実行権限を与えない。運航管理者が既にいる組織では何もしない）で作る。スマートフォンのブラウザからでも実行できる。

**役割ごとの操作（第1段階）**

| 操作 | 運航管理者 | 操縦者 | 閲覧者 |
|---|---|---|---|
| 機体・操縦者の一覧と詳細の閲覧 | 可 | 可 | 可 |
| 機体の登録・訂正・取消 | 可 | 不可 | 不可 |
| 操縦者の登録・取消、利用者との結び付け | 可 | 不可 | 不可 |
| 操縦者の訂正 | 可 | 自分に結び付いた操縦者だけ可 | 不可 |
| 技能証明書番号の全桁の表示 | 可 | 自分の分だけ可 | 不可（末尾 4 桁以外を伏せる） |
| 利用者の招待・役割の変更・停止 | 可 | 不可 | 不可 |

- 運航管理者が自分で飛ぶ場合は、運航管理者の役割のまま操縦者の行を自分に結び付ける（役割と操縦者の行を分ける）。
- 組織の最後の有効な運航管理者を、降格・停止できない（409）。
- spec §13.5.4 の「飛行前の運航管理者の確認」と「自分の記録の作成」は、飛行計画・飛行記録のスプリント（11・12）で、この表に行を足して扱う。

**行単位の権限はアプリ層で行い、RLS は使わない（第1段階）。** 理由：

- アプリは単一のロール `soraban_app` で、Neon のプール（PgBouncer のトランザクションモード）経由で接続する。利用者ごとの RLS には、各トランザクションで利用者 ID を `set_config(…, true)` で渡す仕組みが要り、すべての問い合わせをトランザクションで包む必要がある。第1段階の組織は自社 1 件で、組織をまたぐ漏えいの危険は小さい。
- 認可の判断は純粋関数（例：`can(role, action, { isSelf })`）1 か所にまとめ、単体テストで役割と操作の全組み合わせを確かめる。DB の読み書きは、`org_id` を必須の引数に取るリポジトリ関数だけから行い、`org_id` の条件を付け忘れない形にする。
- DB で守るのは「上書き・削除させない」こと（下記 C の権限）。これは RLS ではなく `GRANT` とトリガーで行う。
- 協業先と記録を共有する Phase 2 で、組織をまたぐ漏えいを DB でも防ぐ必要が出たら、RLS（`org_id` による）を加える（未決 2）。

### C. 版の履歴（共通の版テーブルとハッシュ連鎖）

**版の表を正とし、現在の値の表（ヘッド表）は版の追加から DB が作る。** アプリ（`soraban_app`）は版の表に追加できるだけで、ヘッド表を直接書けない。これにより「版を残さずに現在の値だけを変える」ことが DB の権限の上でできなくなる。

- `record_versions`（共通の版テーブル）：`id`、`org_id`、`entity_type`（`member`・`aircraft`・`pilot`。Sprint 11 以降で追加）、`entity_id`、`version_no`（1 から連番）、`op`（`create`・`update`・`void`）、`data`（その版の全項目。jsonb）、`reason`（`update`・`void` では必須）、`actor_member_id`（システムによる結び付けは NULL とし `actor_kind` で区別）、`created_at`、`prev_hash`、`content_hash`。`(entity_type, entity_id, version_no)` は一意。
- 追加前のトリガー（`SECURITY DEFINER`、`search_path` 固定）：同じ実体の版を `pg_advisory_xact_lock` で直列化し、`version_no`・`created_at`・`prev_hash`（直前の版の `content_hash`。初版は空）・`content_hash` を DB が決める（アプリが送った値は使わない）。`content_hash` は PostgreSQL 組み込みの `sha256()` で、`prev_hash`・`entity_type`・`entity_id`・`version_no`・`op`・`data`（jsonb の正規化された文字列）・`reason`・`actor`・`created_at`（UTC）を連結したものから計算する。正確な連結の規則は `packages/db/README.md` に書く（Sprint 15 の出力の照合で使う）。
- 追加後のトリガー：`data` からヘッド表（`members`・`aircraft`・`pilots`）の行を作る・更新する。`void` はヘッド表の `voided_at` を埋める（行は消さない）。ヘッド表の制約（必須、一意、検査制約）に反すれば版の追加ごと失敗する。
- 楽観的排他：訂正・取消の API は、画面が表示した版番号（`expectedVersion`）を受け取り、最新の版番号と違えば 409 を返す（同時に 2 人が訂正しても、後の訂正が前の訂正を黙って打ち消さない）。
- 検証：関数（例：`verify_record_chain(entity_type, entity_id)`）が、連番の欠け、`prev_hash` のつながり、`content_hash` の再計算の不一致がある版を返す。
- 権限（`soraban_app`）：`record_versions` は参照と追加だけ。ヘッド表と `organizations` は参照だけ。どの表にも更新・削除・`TRUNCATE` を与えない。オーナーロールでの改変は防げないが、ハッシュ連鎖の検証で検出できる。
- 物理削除の API は作らない。誤登録は `void`（取消）の版として残す。取消した機体・操縦者は既定の一覧に出さず、詳細と版の一覧には残る。
- `evidence_log`（Sprint 8）は版の対象にしない（もとから追加のみ）。

### D. 機体と操縦者

**機体（`aircraft`）**

| 項目 | 必須 | 備考 |
|---|---|---|
| 登録記号 | 必須 | 英大文字に正規化。`JU` で始まる英数字。組織内で取消していない機体と重複しない（409） |
| 型式名（一般） | 必須 | 例：製品名 |
| 設計製造者 | 必須 | |
| 製造番号 | 必須 | |
| 型式認証の有無 | 必須 | ありの場合：種類、型式、型式認証書番号 |
| 機体認証 | 任意 | 区分（第一種・第二種）と機体認証書番号 |
| 最大離陸重量（kg） | 任意 | 小数第 1 位まで |
| 使用開始時の既存の総飛行時間 | 必須 | 分単位の 0 以上の整数（既定 0）。画面は「時間：分」で入力できてよいが、保存は分 |
| 状態 | 必須 | 使用中・休止・抹消（spec §13.5.1）。休止・再開の手順は Sprint 13 |

**操縦者（`pilots`）**

| 項目 | 必須 | 備考 |
|---|---|---|
| 氏名 | 必須 | |
| 技能証明の有無 | 必須 | |
| 技能証明の区分 | 「あり」なら必須 | 一等・二等 |
| 技能証明書番号 | 「あり」なら必須、「なし」なら不可 | 形式は**未確認**のため、英数字と `-` の 30 文字以内とする |
| 技能証明の有効期限 | 任意 | 日付 |
| 限定事項 | 任意 | 種類、重量、昼間、目視内の各限定の有無 |
| 結び付ける利用者 | 任意 | `members.id`。1 人の利用者に結び付く操縦者は 1 件まで |

### E. 個人情報の扱い

- **保存するもの**：利用者のメールアドレス・表示名・役割（招待と本人確認に必要）、操縦者の氏名・技能証明の区分・番号・有効期限・限定事項（飛行日誌の記載事項）、Neon Auth の利用者 ID（結び付け用）。
- **保存しないもの**：生年月日、住所、電話番号、顔写真・プロフィール画像（Neon Auth が持っていても写さない）、技能証明書・身分証の画像、マイナンバー、身体検査の結果、DIPS 2.0 の ID・パスワード、IP アドレス、利用者端末の情報。これらの列をマイグレーションに作らない（単体テストで禁止語の列名がないことを確かめる）。
- 技能証明書番号は、一覧では末尾 4 桁以外を伏せる。全桁は詳細画面で、運航管理者と本人にだけ返す（API の応答そのものから除く。画面で隠すだけにしない）。
- サーバーログとエラー応答にメールアドレス・氏名・技能証明書番号を出さない（ログは種別・コード・内部 ID だけ）。
- 版の表は追加のみのため、退職者の氏名等も版に残る。飛行日誌は機体が登録されている間保管する義務があり（取扱要領 第4項(4)）、その記載事項として残す必要がある。利用者機能を本番で使う前に、社内で利用目的（飛行日誌の作成と保管）を社員に示すこと、退職者の記録の扱いを会社で決める（未決 4）。
- Neon Auth が保持する情報（`neon_auth` スキーマ。メールアドレス、氏名、セッション等）は Neon の管理で、そらばんのマイグレーションの対象外。

### F. 画面と API

- 画面（すべて `/ops` 以下。スマートフォン幅 375px で横スクロールなく使える）：
  - `/ops`：ログイン中の利用者の表示名と役割、機体・操縦者・利用者（運航管理者のみ）への入口、ログアウト
  - `/ops/sign-in`：`neon` は Google ログインのボタン。`test` ではこの画面を使わない
  - `/ops/no-access`：権限がない旨と案内
  - `/ops/aircraft`・`/ops/aircraft/new`・`/ops/aircraft/[id]`：一覧（取消済みを含める切り替え）、登録、詳細（訂正、取消、版の一覧）
  - `/ops/pilots`・`/ops/pilots/new`・`/ops/pilots/[id]`：同上
  - `/ops/members`：招待（メール・表示名・役割）、役割の変更、停止・再開（運航管理者のみ）
  - 詳細画面の版の一覧は、版番号、操作（登録・訂正・取消）、訂正者、日時（JST、分まで）、理由、変わった項目名を示す。版どうしの差分の詳しい表示と出力は Sprint 15。
- API（ルートハンドラ。画面と同じサービス層を通す）：`/api/ops/me`、`/api/ops/aircraft`（GET・POST）、`/api/ops/aircraft/[id]`（GET・PATCH：`expectedVersion`・`reason` 必須）、`/api/ops/aircraft/[id]/void`（POST：`expectedVersion`・`reason` 必須）、`/api/ops/aircraft/[id]/versions`（GET）、操縦者・利用者も同じ形。`DELETE` は 405。
- 状態コード：未ログイン 401、利用者でない・権限なし 403、他の組織の ID・存在しない ID 404、入力誤り 400（項目ごとの理由）、版の競合・重複・最後の運航管理者 409、`misconfigured` 503。

### G. マイグレーションと CI

- マイグレーションは `0004` 以降に追加する（例：`0004_ops_org_members.sql`、`0005_record_versions.sql`、`0006_aircraft_pilots.sql`。分け方は実装で決めてよい）。追加のみで、旧コードでも動く形にする。`soraban_app` への権限付与は 0003 と同じく「ロールが存在する場合だけ」行う。`src/migrations-manifest.ts`・`src/types.ts`・列名の突き合わせテストを更新する。
- テスト用の初期データ（2 組織、各役割の利用者、招待中の利用者）を作るスクリプトを置く。`localhost`・`127.0.0.1` 以外の接続先では実行を拒否する。
- CI：PostGIS のサービスコンテナを持つジョブ（既存の `db` ジョブへの追加か、新しいジョブ）で、`soraban_app` ロールを作ってからマイグレーションを適用し、`pnpm test:db` と、`AUTH_PROVIDER=test`・`OPS_ENABLED=1`・`DATABASE_URL`（`soraban_app` で接続）を与えた `next start` に対する運航管理の E2E（例：`e2e/sprint10.spec.ts`）を実行する。ワークフローに Neon Auth の URL・秘密を書かない。既存の `e2e` ジョブ（DB なし・フラグなし）は変えず、利用者機能が 404 になることもそこで確かめる。

## 範囲外

- 日常点検・飛行記録・飛行計画・判定スナップショット・点検整備（Sprint 11〜13）
- 版の差分の詳しい表示、PDF・CSV の出力、出力のハッシュ（Sprint 15）
- 協業先の利用者、組織をまたぐ共有、RLS（Phase 2）
- Neon Auth の組織機能・Admin プラグイン、MFA、メールとパスワードによるログイン画面
- 本番の Neon Auth の有効化、本番 DB へのマイグレーション適用、Vercel の環境変数の設定（ユーザー作業）
- 地点判定・申請支援の画面へのログインの導入

## スプリント契約（完了条件）

以下の全条件を満たした場合のみ、このスプリントは完了とする。「単体」は `pnpm test`、「DB」は CI の PostGIS サービスコンテナを使うジョブ（`pnpm test:db`。ローカルでは同じイメージのコンテナで再現できる）、「E2E」は Playwright（`pnpm test:e2e`）、「E2E-DB」は DB と `AUTH_PROVIDER=test`・`OPS_ENABLED=1` を与えた `next start` に対する Playwright で検証する。Neon Auth には接続しない。全 20 項目。

### A. 機能フラグと認証の境界

- [ ] 1. （単体）`getOpsAvailability` が「設計 A」の表のすべての行（`OPS_ENABLED` なし、各環境変数の欠落、`AUTH_PROVIDER=test` かつ `VERCEL_ENV=production`、すべて揃う）で所定の結果と理由コードを返す。
- [ ] 2. （E2E、既存の `e2e` ジョブ：DB なし・フラグなし）`/ops`・`/ops/aircraft` の画面、`GET /api/ops/me`、`GET /api/auth/get-session`（任意の下位パス）、`POST /api/test-auth/sign-in` がすべて 404。判定画面に運航管理へのリンクがない。既存の E2E（`reliability`・`sprint7`・`sprint8`・`sprint9`）がすべて通る。
- [ ] 3. `OPS_ENABLED`・`AUTH_PROVIDER`・`NEON_AUTH_BASE_URL`・`NEON_AUTH_COOKIE_SECRET`・`AUTH_TEST_SECRET` のどれも無い状態で `pnpm build` が通る（CI の `verify` ジョブ）。`NEXT_PUBLIC_` で始まる認証関係の環境変数がない。
- [ ] 4. （単体）`neon` の実装：SDK を模擬し、セッションありで `Identity` の各項目が写される、セッションなし・SDK の例外で `null`、例外時のログにメールアドレス・氏名が含まれない。
- [ ] 5. （単体）`test` の実装：`AUTH_PROVIDER=test` でないとき、および `VERCEL_ENV=production` のとき `/api/test-auth/sign-in` が 404。署名を 1 文字変えた Cookie は未ログイン扱い。変更を伴う `/api/ops/*` に他サイトの `Origin` を付けると 403。

### B. 組織・利用者・役割

- [ ] 6. （E2E-DB）招待済みのメールアドレスで `emailVerified: true` のテスト用ログインをすると、初回に結び付けられ、`/ops` に表示名と役割が出る。招待されていないアドレスでは `/ops/no-access` が表示され、`/api/ops/me` が 403。招待済みのアドレスでも `emailVerified: false` では結び付かない。
- [ ] 7. （単体）認可の関数について、3 役割 ×「設計 B」の表の全操作（自分・他人の区別を含む）の可否が表と一致する。
- [ ] 8. （E2E-DB）API で、運航管理者・操縦者・閲覧者・未ログインのそれぞれが、機体の登録・訂正・取消、操縦者の訂正（自分・他人）、利用者の招待・役割変更を行い、状態コードが 201/200・403・401 の所定どおりになる。停止された利用者は次の要求から 403。
- [ ] 9. （DB）組織の最後の有効な運航管理者の降格・停止が 409 になり、版が増えない。組織 A の利用者が組織 B の機体の ID を指定すると 404。

### C. 版の履歴

- [ ] 10. （DB）機体を登録して 2 回訂正すると、版が 1・2・3 の連番で、各版の `prev_hash` が直前の版の `content_hash` と一致し、ヘッド表の値が版 3 の内容と一致する。アプリが送った `version_no`・`prev_hash`・`content_hash` は無視される。
- [ ] 11. （DB）`soraban_app` で接続したとき、`record_versions` の更新・削除・`TRUNCATE`、ヘッド表（`members`・`aircraft`・`pilots`）と `organizations` の追加・更新・削除がすべて権限エラーになる。`record_versions` への追加と全表の参照はできる。
- [ ] 12. （DB）同じ `expectedVersion` で 2 つの訂正を同時に送ると、一方が成功し、他方が 409 になる。版の連番に欠けも重複もなく、同じ `prev_hash` を持つ版が 2 つできない。
- [ ] 13. （DB）オーナーロールで版 2 の `data` を書き換えると、`verify_record_chain` が版 2 を不一致として返す。改変のない実体では何も返さない。
- [ ] 14. （E2E-DB）理由なしの訂正・取消は 400。取消した機体は既定の一覧に出ず、詳細と版の一覧には残る。`DELETE /api/ops/aircraft/[id]` は 405 で、行が残る。

### D. 機体と操縦者

- [ ] 15. （単体）機体の入力検査：必須項目の欠落、`JU` で始まらない登録記号、負または小数の既存飛行時間、型式認証ありで型式認証書番号なし、がそれぞれ項目ごとの理由付きで拒否される。登録記号は英大文字に正規化される。（DB）同じ組織で取消していない機体と同じ登録記号は 409、取消済みの機体と同じなら登録できる。
- [ ] 16. （単体）操縦者の入力検査：技能証明ありで区分か番号がない、技能証明なしで番号がある、がそれぞれ拒否される。
- [ ] 17. （E2E-DB）運航管理者が画面で機体を登録し、型式名を理由付きで訂正すると、詳細画面の版の一覧に 2 行（登録・訂正）があり、訂正者・日時（JST、分まで）・理由・変わった項目名（型式名）が表示される。

### E. 個人情報と回帰

- [ ] 18. （E2E-DB）技能証明書番号が、一覧の API 応答では末尾 4 桁以外が伏せられ、詳細の API 応答では運航管理者と本人にだけ全桁が含まれ、閲覧者・他の操縦者には伏せた値だけが含まれる。
- [ ] 19. （単体）マイグレーションに、生年月日・住所・電話・画像・マイナンバーに当たる列（`birth`・`address`・`phone`・`tel`・`image`・`photo`・`avatar`・`my_number` を含む列名）がない。運航管理の API がエラーを記録する際のログに、要求本文のメールアドレス・氏名・技能証明書番号が含まれない。
- [ ] 20. CI の全ジョブが緑で、PostGIS のサービスコンテナのジョブが `soraban_app` を作ってからマイグレーションを適用し、`pnpm test:db` と E2E-DB（スマートフォン幅 375px で `/ops/aircraft` と `/ops/aircraft/new` に横スクロールがないことを含む）を実行している。ワークフローに Neon Auth の URL・秘密・Neon の接続文字列がない。`pnpm typecheck`・`pnpm lint`・`pnpm test`・`pnpm build` が通り、`/api/check`・`/api/diagnose` の結果が Sprint 9 時点と同じ。

## ユーザー作業（エージェントは行わない）

エージェント（generator・evaluator を含む）は本番 Neon・Neon Auth・Vercel の環境変数に触れない。

### Sprint 10 の開発・検証・マージの間：なし

利用者機能は既定で無効のため、本番の準備をしなくても Sprint 10 の PR をマージできる。マージ後も本番の画面は変わらない（判定・申請支援だけ）。

### 本番の準備（退院後、PC が使えるときに。目安：Sprint 11 の成果を本番で使い始める前、2027-01 の記録開始の前）

順番を守る。手順 1〜2 は PC（手元のシェル）が要る。手順 3〜7 は Neon・Google Cloud・Vercel のコンソールで、スマートフォンのブラウザでもできるが、PC を勧める。

1. **Sprint 8 の本番準備が済んでいるか確かめる**（`soraban_app` の作成 → 0001〜0003 の適用 → Vercel の `DATABASE_URL`）。未実施なら `packages/db/README.md`「ユーザー作業」の手順で先に行う。
2. **マイグレーション 0004 以降を本番に適用する**：README の手順 3 と同じ（`pnpm db:status` → `pnpm db:migrate --target <ホスト名>` → `pnpm db:status`）。適用だけでは本番の動作は変わらない（フラグが無効のため）。
3. **Neon Auth を有効にする**：Neon コンソール → `soraban` → 既定ブランチ（本番）→ Auth → 有効化。aws-ap-southeast-1 で有効にできることをここで確かめる（できない場合は作業を止め、planner に戻す）。Auth URL を控える。プレビュー用・開発用のブランチでは有効にしない。
4. **Google ログインを自社の資格情報にする**：Google Cloud コンソールで OAuth クライアント（ウェブアプリケーション）を作り、承認済みのリダイレクト URI に `{Auth URL}/callback/google`（末尾にスラッシュを付けない）を登録する。Neon の Auth の設定 → OAuth providers に Client ID・Secret を入れる。
5. **Neon Auth の本番設定**：信頼するドメインに本番のドメインを追加、アプリ名を「そらばん」に、「Allow Localhost」を無効に。メールとパスワードによる登録を止められる場合は止める（止められなくても、アプリは確認済みのメールアドレスの招待者しか通さない）。
6. **最初の運航管理者を作る**：Neon の SQL Editor（オーナーロール）で、README に載せる `select ops_bootstrap('フューチャーテック株式会社', '<自分の Google アカウントのメール>', '<表示名>');` を 1 回実行する。
7. **Vercel の Production の環境変数**（Production だけを選び、秘密は Sensitive に）：`AUTH_PROVIDER=neon`、`NEON_AUTH_BASE_URL=<Auth URL>`、`NEON_AUTH_COOKIE_SECRET=<openssl rand -base64 32 の出力>`、最後に `OPS_ENABLED=1`。再デプロイし、`/ops` から Google でログインして、役割が「運航管理者」と出ることを確かめる。他の社員は `/ops/members` から招待する。
   - 問題が出たら `OPS_ENABLED` を削除して再デプロイすれば、利用者機能だけが止まる。
   - `AUTH_TEST_SECRET` は本番に設定しない。

### 会社での決めごと（本番で使う前に）

- 社員への利用目的の明示（飛行日誌の作成・保管のために氏名・技能証明書番号を記録すること）と、退職者の記録の扱い（未決 4）。

## 未決事項（実装前にユーザーの確認が必要）

1. **利用者の範囲**（§13.8.1 で本計画に委ねられた点）。推奨：自社の社員に限る。協業先の担当者は Phase 2 で、組織を分けて扱う（`org_id` はそのための準備）。
2. **行単位の権限を RLS で二重に守るか**。推奨：第1段階はアプリ層（認可関数 1 か所＋`org_id` 必須のリポジトリ関数）と、DB の権限による追加のみの強制で行い、RLS は Phase 2 で協業先と共有する前に加える。理由は「設計 B」。
3. **ログイン方法を Google アカウントだけにするか**。推奨：Google だけ。メールとパスワードは、Neon Auth のメール確認が既定で無効、送信元が共有（`auth@mail.myneon.app`）で、自社のメール送信の設定が別途要るため。会社が Google Workspace でない社員を含む場合は、個人の Google アカウントでも、招待したメールアドレスと一致すれば使える。
4. **退職者・誤登録の個人情報**。版の表は追加のみで、氏名等を消せない。推奨：飛行日誌の記載事項として、機体が登録されている間は保持し（取扱要領 第4項(4)）、社内の規程で利用目的と保持の理由を示す。誤って登録した、記載事項でない個人情報（例：別人の氏名）を消す必要が生じた場合の手順（オーナーロールでの訂正と、ハッシュ連鎖の再計算の記録）は Sprint 15 で定める。
5. **本番の準備をスマートフォンだけで済ませたい場合**。手順 2（マイグレーション適用）は手元のシェルが要る。`packages/db/README.md`「将来の選択肢」の GitHub Actions（手動起動・承認者付き）を作れば、スマートフォンから適用できるが、本番の接続文字列を GitHub の Environment に置くことになり、§13.8.1 の方針の変更になる。推奨：作らずに、退院後に PC で行う（利用者機能は Sprint 11 の成果と合わせて使い始めればよく、急がない）。
