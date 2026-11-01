# ローカル検証の手順（エージェント共通）

generator・evaluator・reviewer が毎回同じ準備をやり直さないための手順。詳細は `.github/workflows/ci.yml`、`packages/db/README.md`、`playwright.ops.config.ts` を正とする。

## 環境

- **PostgreSQL 16 + PostGIS**: クラスタ `16/main`（ポート 5432）。止まっていれば `pg_ctlcluster 16 main start`。ロール `postgres` と `soraban_app` は、CI と同じテスト用の値（`postgres` / `soraban_app_ci_only`）に設定されている前提。起動時に設定されていなければ設定し直す（アプリのコードには影響しない）。
- **検証は空の DB から**: 実行のたびに新しい名前の DB を作り、マイグレーションとシード（`db:seed:ops-test`）を入れる。前の実行の計画が残った DB を使い回すと、時間帯の重なり（`overlap`）などで偽の失敗が出る。
- **Chromium**: `/opt/pw-browsers/chromium`。`playwright install` はしない（別のバージョンが入って壊れる）。必要なら `--no-sandbox`。
- **ネットワーク**: 外部ホストはプロキシで制限されている。地図タイル（`cyberjapandata.gsi.go.jp`）は 403 になることがあり、公開側の地図のテストが揺れる原因になる。許可されていないホストは、環境の設定（Network access）で追加する必要がある。
- **GitHub Actions**: CI が動く。push 後は、実行結果を GitHub のツールで確認する（課金の上限に達すると、ジョブが約 2 秒で失敗し、check-run の注記に理由が出る）。

## コマンド

`pnpm typecheck` / `pnpm lint` / `pnpm test` / `REQUIRE_DB_TESTS=1 pnpm test:db` / `pnpm build` / `pnpm test:e2e:ops`（空の DB から全体）/ 公開側 `pnpm test:e2e --retries=0`（CI と同じ `next start`）。新しい E2E は `--repeat-each=3` 以上で不安定さを確かめる。

## 既知の不安定なテスト（このリポジトリの履歴より）

- `sprint12h-pr3-db` P3a-4（点検の行のクリック後に遷移しない。全体実行でだけ起きる。単独なら通る）。
- 公開側 `sprint12h-pr2` B1（地図をクリックしたあとのスクロールの着地のずれ。地図タイルの 403 とは別に起きる）。
- 基準のコミットでも落ちるかを比べて、変更が原因かを切り分ける。

## 落とし穴

- **コンテナは長い実行の途中で再起動する**。区切りごとにコミットし、各実行のログを残す。未コミットの変更と、バックグラウンドの実行は失われる。
- `.claude/settings.json` が `rm -rf*` を拒否する。掃除は、新しい名前のディレクトリを使う、または `mv` で退避する。
- `next start` を動かすと `apps/web/tsconfig.json` が書き換わることがある（`git checkout` で戻す）。古い `apps/web/.next-e2e-fixture/dev` が lint を落とすことがある（退避する）。前の実行の `mock-gsi-server`（ポート 3198）が残っていると、E2E の起動を妨げる（止める）。
- 作業ツリーには、別のエージェントの途中の変更が入っていることがある。自分のコミットは**パスを指定して**行い、他の変更を巻き込まない。
