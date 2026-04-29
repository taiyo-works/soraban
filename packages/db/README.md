# `@soraban/db`

Supabase / PostGIS バックエンドへの接続層。**Phase 0/1 前半は実 DB に接続せず**
（評価エンジンは in-memory + ローカル GeoJSON で完結）、Phase 1 中盤の接続化に
備えて型と client factory のみ提供している。

## 役割

- `Database` 型（`supabase/migrations/0001_initial_schema.sql` と同期）
- `createSorabanClient(config)`: `@supabase/supabase-js` の薄いラッパー
- `sorabanConfigFromEnv()`: `SUPABASE_URL` / `SUPABASE_ANON_KEY` から構成読み込み

## なぜ Phase 0/1 前半は接続しないか

1. 特許①の「例規集自動構造化＋地理空間DBへの変換システム」が出願完了するまで、地理空間DBの実体を外部に出さない（情報統制）
2. 評価エンジンの ClauseGraph 設計が Phase 1 中で揺れる可能性があり、スキーマ確定を待ってから接続したい
3. ローカル GeoJSON + JSON ファイルでも 12 自治体規模までは十分動く

## Phase 1 接続化の手順（参考）

1. Supabase プロジェクト作成（dashboard.supabase.com / 山陰拠点なら ap-northeast-1）
2. `supabase/.env` に Supabase CLI ログイン用設定（プロジェクトリンク）
3. `supabase db push` で `supabase/migrations/000{1,2}_*.sql` を本番に適用
4. 自動生成型: `supabase gen types typescript --linked > packages/db/src/database.types.ts`
5. 本ファイルの `Database` を `import type { Database } from "./database.types"` に置換
6. `apps/web/src/server/regulation-check.ts` から `createSorabanClient(config)` を呼び、`evaluate*()` 評価器の入力源を順次 DB に切り替え
7. ClauseGraph + ポリゴンを seed する script を `packages/regulations/scripts/seed-db.ts` に追加（`zones.ts` の値を流し込む）

## スキーマ概要

`supabase/migrations/0001_initial_schema.sql` 参照。要点:

| テーブル | 役割 | 行数の目安 |
|---|---|---|
| `regulations` | 1 行 = 1 (規則 × 管轄)。米子市公園条例、鳥取県迷惑行為等防止条例、など | Phase 1 完了時 ~30 |
| `regulation_zones` | 1 行 = 1 ポリゴン or バッファ中心点。米子市公園条例 → 8 ゾーン、など | Phase 1 完了時 ~300 |
| `evidence_log` | 監査トレイル: 判定リクエスト 1 件 = 1 行 | デモ運用中も追記 |

`clause_graph` は JSONB で `packages/regulations/src/clause-graph.ts` の
`ClauseGraph` 型と同形を保持し、GIN index で例外節検索が効くようにしている。
