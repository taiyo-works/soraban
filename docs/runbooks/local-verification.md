# ローカル検証の手順（エージェント共通）

generator・evaluator・reviewer が毎回同じ準備をやり直さないための手順。詳細は `.github/workflows/ci.yml`、`packages/db/README.md`、`playwright.ops.config.ts` を正とする。

## 環境

- **PostgreSQL 16 + PostGIS**: クラスタ `16/main`（ポート 5432）。止まっていれば `pg_ctlcluster 16 main start`。ロール `postgres` と `soraban_app` は、CI と同じテスト用の値（`postgres` / `soraban_app_ci_only`）に設定されている前提。起動時に設定されていなければ設定し直す（アプリのコードには影響しない）。
- **検証は空の DB から**: 実行のたびに新しい名前の DB を作り、マイグレーションとシード（`db:seed:ops-test`）を入れる。前の実行の計画が残った DB を使い回すと、時間帯の重なり（`overlap`）などで偽の失敗が出る。
- **Chromium**: `/opt/pw-browsers/chromium`。`playwright install` はしない（別のバージョンが入って壊れる）。Playwright が要求する版の headless shell が無いと、全件が `Executable doesn't exist` で落ちるので、`E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_CHROMIUM_ARGS=--no-sandbox`（フルの Chromium）を指定する。公開側 E2E は 1 ワーカー（既定）で流す。headless shell と `--workers=2` では、`sprint7` 159・173、`sprint9` 306・352、`sprint12h-pr2` Q-20 が `waitForResponse` のタイムアウトで実装と無関係に落ちる（2026-11-22、16-A の再判定で観測）。なお `sprint9` 306（右クリック）は、フルの Chromium・1 ワーカーでも単独 ×6 で 3/6 落ちる（2026-11-23、16-B 差し戻し 1 の再判定。基準 `c58d92e` でも同じ）。落ちたら基準のコミットと比べて切り分ける。
- **ops の手動検証用の DB**: `db:migrate`・`db:seed:ops-test` には `DATABASE_URL` に加えて `DATABASE_URL_UNPOOLED` も要る。
- **コントラスト検査**: `node docs/design/tokens-v2/check-contrast-v2.mjs`（`scripts/` ではない）。
- **ネットワーク**: 外部ホストはプロキシで制限されている。地図タイル（`cyberjapandata.gsi.go.jp`）は 403 になることがあり、公開側の地図のテストが揺れる原因になる。許可されていないホストは、環境の設定（Network access）で追加する必要がある。
- **GitHub Actions**: CI が動く。push 後は、実行結果を GitHub のツールで確認する（課金の上限に達すると、ジョブが約 2 秒で失敗し、check-run の注記に理由が出る）。

## コマンド

`pnpm typecheck` / `pnpm lint` / `pnpm test` / `REQUIRE_DB_TESTS=1 pnpm test:db` / `pnpm build` / `pnpm test:e2e:ops`（空の DB から全体）/ 公開側 `pnpm test:e2e --retries=0`（CI と同じ `next start`）。新しい E2E は `--repeat-each=3` 以上で不安定さを確かめる。

## 既知の不安定なテスト（このリポジトリの履歴より）

- `sprint12h-pr3-db` P3a-4（点検の行のクリック後に遷移しない。全体実行でだけ起きる。単独なら通る）。
- 公開側 `sprint12h-pr2` B1（地図をクリックしたあとのスクロールの着地のずれ。地図タイルの 403 とは別に起きる）。
- `sprint12h-pr3b2b-db` P3b2b-6（`router.push("/ops/incidents")` の後に `incident-list-page` が出ない）。観測: Sprint 17-1 の評価で、ローカルの全体実行 1 回で失敗、単独 `--repeat-each=4` は 4/4 成功。CI の fd2c82e・1d82cd1 では成功。原因は未特定。16-D 差し戻し 1 の切り分け（2026-11-23、空の DB から ops 全体）: 16-D の評価で HEAD 0214b2d は 0/2（2 回とも全体の 122 番で失敗）だったが、generator の再実行では HEAD 2/2 通過・基準 37e8f9c 2/2 通過（HEAD 312 件・基準 280 件）。同じ build・同じ手順で再現せず、評価者と同じ手順の 3 回目も HEAD 312/312 通過。頻度は HEAD 合計 2/5 失敗・基準 0/3、16-D の変更が原因とは言えない。失敗時は `incident-list-page` が 30 秒出ない（クライアントルーターの `push` が完了しない）。ログ `docs/evaluations/logs/sprint-16D-fix1-gen-*.log`。
- `sprint12g-1b` A7（ホームの最初の画面の縦位置。911 > 752）。観測: CI の fd2c82e で失敗、1d82cd1 の CI では成功。前の実行のデータが残った DB の部分再実行でもローカルで失敗した（空の DB の全体では成功）。
- `sprint12h-pr3` P3a-5（`waitForURL` のタイムアウト）。観測: CI の fd2c82e で失敗、1d82cd1 の CI では成功。P3a-4 と同系統の可能性があるが、未確認。
- 計画の新しい画面（`/overview`・`/judgement`・`/journal`・主画面）は Suspense でストリーミングされ、描画の直後は本文が `display:none` の中にある。`goto` の直後に `boundingBox()` や `toHaveCount(0)` を使うと偽の失敗・偽の成功になる。`e2e/ops-db/plan-screen.ts` の `gotoPlan`（可視のタブが出るまで待つ）を使う。
- 色・コントラストを測る E2E は、`document.getAnimations()` が空になってから測る。背景色の遷移（180ms）の途中を拾うと、比が 1.1〜4 で揺れる（`sprint16-a` A-7/K-3 で観測。`--repeat-each=25` で 14/25）。
- `sprint12g-1b` A7 の追記: 後続の `sprint12g-1b-fix-db` M-4 が作る期限切れの許可（validTo 2026-12-20）が使い回した DB に残り、期限の先頭に出るのが原因（16-A の評価で特定）。
- `sprint16-f-db` R-3（320px の `/ops` で本文の末尾が下部ナビの上端から 4px 未満）。観測: 16-J の generator・designer の実行で -4.56px。`/ops` の本文が約 35px 長くなる DB の状態で起きる（何が増えたかは未特定）。16-J の評価では、空の DB で HEAD 3 回・基準 c85445f 1 回すべて余裕 31px で通過（`docs/evaluations/sprint-16J-eval.md` §2）。
- `sprint16-h1-fix1-db` R-4（計画の作成へのリンクを押しても画面が出ない）。観測: 16-K の再評価の ops 全体で 1 回失敗、新しい DB で単独 ×4 は 12/12、ファイル全体 16/16 通過。P3b2b-6 と同系統（クライアントルーターの遷移が完了しない）とみられる。
- **下部ナビ・「次へ」の最初のタップ／クリックが遷移しない**（16-F の F-4、16-F2 の評価、16-N3 N3-9 で切り分け）。ローカルの自動操作で、`/ops` から `/ops/more`（ほか `/ops/permits`・`/ops/members`）への遷移が 5〜20% 起きない（320・100% で前 28/30・後 24/30、390・100% で 25/30・25/30。基準 a12cef5 でも同じ）。**タップは届き、Link の `click` は `preventDefault` され、RSC の要求は 200 で全文を受け取る**が、`history.pushState` が呼ばれず URL が変わらない（10 秒待っても同じ。もう一度押すと通る）。マウスの `click`・`a.click()`・`window.next.router.push` でも起き、幅・文字の倍率・ハイドレーションの待ちに依らない。遷移先による（`/ops/journal`・`/ops/plans`・`/ops/about`・`/ops/aircraft`・`/ops/pilots` は 0 件）。RSC 応答に 150ms の遅れを足しても減らない。**E2E の台本の揺れではなく、クライアントのルーターの遷移の未完了で、利用者にも起こりうる**。原因はアプリのコードからは特定できず、直せていない。E2E は `plan-wizard.ts` の `tapUntilStep` のように、遷移・段の変化を待って押し直す。実機（G2-8）で確かめる。ログ `docs/evaluations/logs/sprint-16N3-gen-tap*.log`、スクリプト `sprint-16N3-gen-tap.mjs`。
- 基準のコミットでも落ちるかを比べて、変更が原因かを切り分ける。

## 落とし穴

- **コンテナは長い実行の途中で再起動する**。区切りごとにコミットし、各実行のログを残す。未コミットの変更と、バックグラウンドの実行は失われる。
- **公開側 E2E をローカルで流すときは `next start` を明示する**。`pnpm test:e2e` は既定で `next dev`（`E2E_SERVER_CMD` の既定）を使い、`.next/dev` を作って lint を落とす・本番ビルドと違う結果になる。CI と同じ条件は `CI=1 E2E_SERVER_CMD="pnpm --filter @soraban/web exec next start -p 3100" E2E_FIXTURE_SERVER_CMD="NEXT_DIST_DIR=.next pnpm --filter @soraban/web exec next start -p 3101" pnpm test:e2e --retries=0`。モックの `mock-gsi-server`（3198・3199）が前の実行から残っていると起動できない（`pkill -f mock-gsi`）。
- `next build` が `next/font/google queries have exactly one entry` で失敗することがある（Google Fonts の取得の揺れ。再実行で通る。2026-11-22、16-B で観測）。
- `.claude/settings.json` が `rm -rf*` を拒否する。掃除は、新しい名前のディレクトリを使う、または `mv` で退避する。
- `next start` を動かすと `apps/web/tsconfig.json` が書き換わることがある（`git checkout` で戻す）。古い `apps/web/.next-e2e-fixture/dev` が lint を落とすことがある（退避する）。前の実行の `mock-gsi-server`（ポート 3198）が残っていると、E2E の起動を妨げる（止める）。
- **E2E の前に、アプリのコードを変えたら `pnpm build` をやり直す**。ops の E2E は既存の `.next` を `next start` で配るので、ビルドが古いと修正前のコードで動き、直したはずの検査が落ちる（16-D 差し戻し 1 で発生）。ログには、どのビルドで流したかを残す。
- 作業ツリーには、別のエージェントの途中の変更が入っていることがある。自分のコミットは**パスを指定して**行い、他の変更を巻き込まない。

## 申請支援のフラグ（Sprint 18）

- `APPLICATION_SUPPORT_ENABLED=1` で公開の `/` の申請支援（診断パネル等）と `/api/diagnose` の `prefill`・`deadlines`・`categoryNote` が戻る。**既定は無効**。公開の `/` は静的に描かれ、**値は `next build` のときに固まる**（`next start` の環境変数を変えても効かない。再ビルドが要る）。
- `VERCEL` が設定されている環境（production・preview を含む Vercel のどこでも）では常に無効。**Vercel のどの環境にもこの変数を設定しない。**
- E2E（`playwright.config.ts`・`playwright.ops.config.ts`）は `APPLICATION_SUPPORT_ENABLED: ""` で動かす。フラグ有効の E2E は作らない。ビルドの前に `APPLICATION_SUPPORT_ENABLED` をシェルに残さないこと。
- Sprint 18-2：運航管理の `dips_permit`（許可・承認の「申請済み」の記録。無効のとき新規は 409 `procedure_kind_disabled`、既存の行は読み取り専用の「以前の記録」）と次にやること `apply_permit` も同じフラグで切り替わる。フラグ有効側の回帰は DB テスト・単体で `vi.stubEnv("APPLICATION_SUPPORT_ENABLED", "1")`（または `applicationSupport: true`）にして守る（E2E-DB は常に無効）。
- **19-1b の DB は作り直す**: 旧 0018（修正前のチェックサム）を適用済みのローカル DB は、マイグレーションのチェックサム不一致で止まる。新しい名前の DB を作り、マイグレーションとシードを入れ直す。
