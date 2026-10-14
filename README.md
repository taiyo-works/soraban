# そらばん（Soraban）

山陰の業務ドローン運用者向けコンプライアンス統合SaaS。

## ブランド
- 名称：そらばん（Soraban）
- 由来：空 ＋ 番 ＋ 算盤

## 開発状況
社内開発中（PoC 段階）。Phase 0 の米子市デモ版を起点に、山陰（鳥取・島根）の自治体条例カバレッジと
DIPS 飛行許可・承認の申請支援を段階的に拡張している。

| Sprint | 内容 | 文書 |
|---|---|---|
| 1〜3 | 申請支援診断（手続き導出・期限カレンダー・プリフィル・マニュアル骨子・束ね PDF） | `docs/sprints/sprint-1〜3.md` |
| 4 | 法令正確性ガード（要再確認事項の分離・検証日メタ） | `docs/sprints/sprint-4.md` |
| 5 | 判定履歴への申請支援条件・進捗の保存／復元、診断証跡ハッシュ | `docs/sprints/sprint-5.md` |
| 6 | 信頼性強化：空域フラグの状態分離（ループ・持ち越し解消）、DID 三値（該当／非該当／未確認）、25kg 境界と第三者賠償責任保険、履歴レース解消、CI・E2E | `docs/sprints/sprint-6.md` |

### 主な機能（現状）
- 地点（住所・座標・地図・プリセット）から 6 規制レイヤー（航空法 DID・空港／小型無人機等飛行禁止法／都市公園・文化財・県迷惑行為条例）を信号機で総合判定、A4 PDF 出力
- 申請支援：カテゴリー切り分け（I／要確認／IIA 相当／IIB 相当／III）、必要手続きチェックリスト、提出期限（開庁日逆算）、DIPS/DRS プリフィル、束ね PDF
- 判定履歴（localStorage・最大 50 件）：条件・進捗・診断サマリの保存／復元

### 既知の制約
- **DID ポリゴンデータはリポジトリ未追跡**（`packages/regulations/data/did/by-pref/` は .gitignore）。データが無い環境では DID は「未確認」となり、診断は「要確認」を返す（Sprint 6 以前は誤って「DID 外」と表示していた）。取得は `pnpm --filter @soraban/regulations fetch:did`。
- 本診断は補助情報。最終確認は DIPS／DRS／航空局および各管理者で行うこと。

## 起点エリア
- 鳥取県米子市・境港市
- 島根県出雲市
- → 山陰全域 → 中国地方へ段階展開

## 技術スタック
- Next.js 16 + Tailwind v4 + MapLibre GL（`apps/web`）
- Supabase (PostgreSQL 15 + PostGIS + pg_cron)
- Gemini 3 Flash-Lite
- TypeScript strict / pnpm workspace

## モノレポ構成
```
apps/
  web/       — Next.js 16 (App Router, Turbopack, Tailwind v4)
  scraper/   — 条例スクレイパ
packages/
  db/          — @soraban/db: Supabase クライアント
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

## CI
`.github/workflows/ci.yml`：PR と main への push で typecheck / lint / test / build、続けて Playwright E2E を実行。

## 作成者
奥田憲章
