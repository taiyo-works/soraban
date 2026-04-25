# そらばん（Soraban）

山陰の業務ドローン運用者向けコンプライアンス統合SaaS。

## ブランド
- 名称：そらばん（Soraban）
- 由来：空 ＋ 番 ＋ 算盤

## 開発状況
**Phase 0**：6日間スプリント（4/25〜4/30）で米子市デモ版を作成中。社内開発中（PoC段階）。

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
  api/       — バックエンドAPI
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

## 作成者
奥田憲章
