# @soraban/scraper

国・都道府県・市町村の公式サイトから「無人航空機・ドローン」関連ページを取得し、対象キーワードを含む見出しとリンクを JSON で書き出す最小スクリプト。

## 実行
```bash
pnpm --filter @soraban/scraper run scrape
```

出力: `apps/scraper/data/scraped/latest.json`

## 対象ソース
`src/sources.ts` で定義。Phase 0 では:
- 国土交通省（無人航空機の飛行ルール）
- 警察庁（小型無人機等飛行禁止法）
- 鳥取県（公式サイト内検索 "ドローン"）
- 米子市（公式サイト・探索起点）

## 後続
- 取得した相対リンクを再帰追跡（深さ 1〜2）し、ドローン関連条例 PDF を抽出
- Gemini 3 Flash-Lite で要約・規制種別の分類（`apps/api`）
- Neon（PostgreSQL）の `regulations` テーブルへ書き込み（更新の仕組みは Sprint 14 で決める）
