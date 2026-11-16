# そらばん（Soraban）

ドローンの**飛行計画の通報**、**飛行前・飛行後の点検**、**飛行日誌**（離陸・着陸の時刻と飛行時間）を一つにまとめる運航管理アプリ。

提供元：フューチャーテック株式会社（`docs/provider-info.md`）

## サービスの考え方

- **主役は 3 つ**: 飛行計画の通報（DIPS の「飛行計画の登録」の流れの入力・確認・記録）、飛行前・飛行後の点検、日誌と飛行記録。事務所の PC で計画し、現場のスマホ（PWA）で点検と記録をつけ、電波の届かない場所でも使える。
- **判定は補助**: 地点の空域・法令・条例の確認は、通報や日誌を止めない参考情報として位置づける。判定していない地域は「確認していません」と示し、「問題なし」とは示さない。判定は当面、山陰を先に扱う。
- **境界**: 許可・承認などの**申請の代行・支援はしない**。通報は、利用者本人の DIPS 認証と最終確認のもとで行う。DIPS API は未申請で、当面は DIPS に手動で出し、受付番号をアプリに記録する運用。
- **対象**: 資格を持つ操縦者と、すでに飛行許可・承認を取得している企業・操縦者。完成時の対象は全国を目標にする。

## 開発状況

社内の試験運用中（公開ページは noindex）。運航管理（`/ops`）は、機能フラグ `OPS_ENABLED` が有効なときだけ開く。本番の既定は無効で、無効のときは画面も API も 404 になる。

- 公開の画面（`/`）: 住所・座標・地図・現在地から地点を決め、法令・条例の判定を示す（出典と確認日つき）。今後は補助の位置づけに下げる。
- 運航管理（`/ops`）: 飛行計画、通報の準備と手動記録、日常点検、飛行記録、現場モード（圏外でも記録できる PWA）、許可・承認の登録（取得済みの控え）、事故・ヒヤリハット。DIPS 2.0 への送信はまだ行わない。
- 計画と進め方: 総合計画 `docs/sprints/ops-completion-plan.md`、スプリントの索引と状態 `docs/sprints/README.md`、UI 設計 `docs/design/ops-core-ui/README.md`。

### 既知の制約

- **DID ポリゴンデータはリポジトリ未追跡**（`packages/regulations/data/did/by-pref/` は .gitignore）。データが無い環境では DID は「未確認」となり、診断は「要確認」を返す。取得は `pnpm --filter @soraban/regulations fetch:did`。
- 判定は参考情報で、法令・条例・データの更新や欠落がありうる。最終確認は、DIPS・航空局および各管理者で行う。
- 法務まわり（免責、規約、専門家の確認）は整備中。専門家の確認が済むまで、外部への提供はしない（`docs/sprints/legal-info-plan.md`）。

## 技術スタック

- Next.js 16 + Tailwind v4 + MapLibre GL（`apps/web`）。スマホは PWA としてホーム画面に追加して使う。
- Neon（PostgreSQL 18 + PostGIS 3.6、aws-ap-southeast-1）。ドライバは `pg`、マイグレーションは `packages/db/migrations` の SQL ＋最小ランナー。認証は Neon Auth。
- TypeScript strict / pnpm workspace。

## モノレポ構成

```
apps/
  web/       — Next.js 16 (App Router, Turbopack, Tailwind v4)
  scraper/   — 条例スクレイパ
packages/
  db/          — @soraban/db: Neon（pg）接続層・SQL マイグレーション
  dips/        — @soraban/dips: DIPS 連携の型と手動・模擬のゲートウェイ
  regulations/ — @soraban/regulations: 規制データ／型
  geo/         — @soraban/geo: 緯度経度・GSI ヘルパ
```

## 開発コマンド

- `pnpm install` — 依存関係取得
- `pnpm dev` — Web を起動（`apps/web`）
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
- `pnpm test:e2e` — 公開側の E2E（Playwright。初回は `pnpm exec playwright install chromium`）
- `pnpm test:db` — DB を使うテスト（`TEST_DATABASE_URL` が必要。未設定ならスキップ、`REQUIRE_DB_TESTS=1` なら失敗）
- `pnpm test:e2e:ops` — 運航管理の E2E（PostgreSQL + PostGIS と `soraban_app` ロールが必要）
- `pnpm db:status`・`pnpm db:migrate` — マイグレーションの確認・適用（`DATABASE_URL_UNPOOLED`。手順は `packages/db/README.md`）

ローカルでの検証の手順と既知の不安定なテストは `docs/runbooks/local-verification.md`。

## CI

`.github/workflows/ci.yml`：PR と `main` への push で typecheck / lint / test / build、続けて Playwright E2E（DB なし）と、PostGIS のサービスコンテナを使う `db` ジョブ（マイグレーション適用・`pnpm test:db`・運航管理の E2E）を実行する。`docs/**` と `*.md` だけの変更では動かない。

## 開発の進め方

計画 → 実装 → 独立レビュー → デザイン → 評価の順に、役割を分けたエージェントで進める（`CLAUDE.md`、`.claude/agents/`）。スプリントの契約と評価レポートは `docs/sprints/`、`docs/evaluations/`。
