# そらばん（Soraban）

山陰の業務ドローン運用者向けコンプライアンス統合SaaS。

## ブランド
- 名称：そらばん（Soraban）
- 由来：空 ＋ 番 ＋ 算盤

## 開発状況

社内の試験運用中（公開ページは noindex）。2026-10-28 時点の `main` は Sprint 12h の途中（マージ済みの先端は PR #42、マージコミット `6b82554`）である。

公開の判定画面（`/`）はデザイン v2 に作り直してある。住所・座標・地図・現在地から地点を決め、航空法・小型無人機等飛行禁止法・条例を 4 段（飛行不可／要手続き／手続き済み・情報／手続き不要、判定不能を含む）で示し、出典と確認日を残す。申請支援（手続きのチェックリスト、期限、プリフィル、束ね PDF）は判定の下に続く。

運航管理（`/ops`）は、機能フラグ `OPS_ENABLED` が有効なときだけ開く。本番の既定は無効で、無効のときは画面も API も 404 になる。有効なときのメニューは、スマホ下タブがホーム／計画／点検／日誌／登録の 5 つ、PC の左メニューがホーム／判定／計画／点検／日誌／登録の 6 項目である。中身は飛行計画、判定スナップショット、通報の準備と手動記録、日常点検、飛行記録、許可・承認の登録、事故・ヒヤリハット、現場モードまで実装済みである。DIPS 2.0 への送信はまだ行わない。

スプリントの索引と状態は `docs/sprints/README.md`。次の契約は Sprint 13（`docs/sprints/sprint-13.md`、計画のみ）。

### 番号のルール

次のスプリントは 13 から続ける。12a〜12h は Sprint 12 の枝番であり、13 のあとで番号を戻さない。2026-10-20 の計画表にあった「Sprint 13＝点検整備」などは予約であり、実施したスプリントではない。点検整備・期限一覧（12f）・証跡の出力・判定データの DB 化は、Sprint 13 のあとで空き番号を付け直す。

| Sprint | 内容 | 状態 | 文書 |
|---|---|---|---|
| 1〜6 | 申請支援診断、期限、束ね PDF、法令の注記、判定履歴、信頼性（DID 三値・CI） | main に含まれる | `docs/sprints/sprint-1.md` 〜 `sprint-6.md` |
| 7 | 判定の現行法令対応（飛行禁止法 1,000m、DID から工業専用地域を除外、出典台帳） | マージ済み（#7） | `docs/sprints/sprint-7.md` |
| 8 | Neon（PostgreSQL + PostGIS）の土台と地点判定の証跡 | マージ済み（#10） | `docs/sprints/sprint-8.md` |
| 9 | 地図での地点指定（現在地・住所検索・長押し） | マージ済み（#11） | `docs/sprints/sprint-9.md` |
| 10 / 10a | 利用者・機体・操縦者と版の履歴／公開面の整備 | マージ済み（#13 / #15） | `sprint-10.md` / `sprint-10a.md` |
| 11〜11g | 日常点検と飛行記録、制度の最新化、判定の 4 段、100g 未満の表示 | マージ済み（#14、#19、#21〜#25） | `sprint-11.md` 〜 `sprint-11g.md` |
| 12a〜12e | 飛行計画、通報の準備、今日と現場、許可の登録、事故・ヒヤリハット | マージ済み（#26〜#31） | `sprint-12a.md` 〜 `sprint-12e.md` |
| 12f | 期限一覧 | 未着手（契約ファイルなし） | `sprint-12.md` の予約のみ |
| 12g / 12h | デザインの刷新。判定画面 v2 と運航管理のメニューまで main | 12h は進行中（③b1 が PR #43） | `sprint-12g.md` / `sprint-12h.md` |
| 13 | 飛行計画通報 API、判定履歴のサーバー保存、README、CI の確認、UX | 計画 | `docs/sprints/sprint-13.md` |

### 主な機能（現状）

- 地点判定と申請支援。結論は入力の直下。層の切り替え、A4 の PDF、診断の証跡 ID がある。
- 運航管理（フラグの裏）: 計画 → 点検 → 日誌のメニュー、登録（機体・操縦者・許可・承認・地点・利用者）、現場モード。
- 判定履歴（公開画面）: ブラウザの `localStorage`（キー `soraban:history:v1`）、最大 50 件。条件・進捗・診断の要約を保存し、同じ端末で復元する。端末をまたいだ同期はない。地点判定の証跡は、別途 `evidence_log` に追記できる（`DATABASE_URL` があるとき）。申請支援の全文は、飛行計画の判定スナップショットに保存するときだけサーバーに残る。

### 既知の制約

- **DID ポリゴンデータはリポジトリ未追跡**（`packages/regulations/data/did/by-pref/` は .gitignore）。データが無い環境では DID は「未確認」となり、診断は「要確認」を返す（Sprint 6 以前は誤って「DID 外」と表示していた）。取得は `pnpm --filter @soraban/regulations fetch:did`。
- 本診断は補助情報。最終確認は DIPS／DRS／航空局および各管理者で行うこと。申請・通報の代理はしない。利用者が自分の名義で公式の手続きを行う。

## 起点エリア
- 鳥取県米子市・境港市
- 島根県出雲市
- → 山陰全域 → 中国地方へ段階展開

## 技術スタック
- Next.js 16 + Tailwind v4 + MapLibre GL（`apps/web`）
- Neon（PostgreSQL 18 + PostGIS 3.6、aws-ap-southeast-1）。ドライバは `pg`、マイグレーションは `packages/db/migrations` の SQL ＋最小ランナー
- Gemini 3 Flash-Lite
- TypeScript strict / pnpm workspace

## モノレポ構成
```
apps/
  web/       — Next.js 16 (App Router, Turbopack, Tailwind v4)
  scraper/   — 条例スクレイパ
packages/
  db/          — @soraban/db: Neon（pg）接続層・SQL マイグレーション
  regulations/ — @soraban/regulations: 規制データ／型
  geo/         — @soraban/geo: 緯度経度・GSI ヘルパ
```

## 開発コマンド
- `pnpm install` — 依存関係取得
- `pnpm dev` — Web を起動（`apps/web`）
- `pnpm typecheck` — 全 workspace の型検査
- `pnpm lint` — 全 workspace の lint
- `pnpm test` — 単体テスト（vitest）
- `pnpm build` — 全 workspace のビルド
- `pnpm test:e2e` — E2E（Playwright。初回は `pnpm exec playwright install chromium`）
- `pnpm test:db` — DB を使うテスト（`TEST_DATABASE_URL` が必要。未設定ならスキップ、`REQUIRE_DB_TESTS=1` なら失敗）
- `pnpm db:status`・`pnpm db:migrate` — マイグレーションの確認・適用（`DATABASE_URL_UNPOOLED`。手順は `packages/db/README.md`）

## CI
`.github/workflows/ci.yml`：PR と `main` への push で typecheck / lint / test / build、続けて Playwright E2E（DB なし）と、PostGIS のサービスコンテナを使う `db` ジョブ（マイグレーション適用・`pnpm test:db`・運航管理の E2E）を実行する。`docs/**` と `*.md` だけの変更では動かない。2026-10-28 の `main`（`6b82554`）は成功。同じ日の PR #43 は失敗している。記録は `docs/sprints/sprint-13.md`。

## 作成者
奥田憲章
