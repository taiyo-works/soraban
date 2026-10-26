# Sprint 12h PR ② 評価レポート（evaluator）

> 対象：`origin/feat/12h-pr2-judge`（8e6d302、`origin/main`＝e2ef45c から作成）。契約：`origin/docs/sprint-12h-pr2-contract` の `docs/sprints/sprint-12h-pr2.md`。
> 評価は実装者の報告を信用せず、自分で操作して確かめた。コードは変更していない。**このファイルは節ごとに書き足している（途中で中断しても成果が残るように）。**
> 環境：Linux・4 コア。main は `/tmp/.../scratchpad/main-base`（e2ef45c）、PR は評価用 worktree（8e6d302）で、それぞれ `next build` → `next start`（main=3300、PR=3301、逆ジオコーダは模擬 3199）。

## 進捗

- [x] §A 差分の範囲（Q-1・Q-2）、判定ロジックの不変（Q-3）、速さの実測（Q-17）
- [ ] §B 画面の確認（Playwright）
- [ ] §C 縦の長さ
- [ ] §D テスト変更の妥当性
- [ ] §E 全体の再実行
- [ ] §F 法務・文言
- [ ] §G 総合判定・Q 照合表・ブロッカー

## A. 差分の範囲・判定ロジックの不変・速さ

### A-1 差分（Q-1・Q-2）

`git diff --stat origin/main...HEAD -- packages apps/web/src/server apps/web/package.json package.json pnpm-lock.yaml apps/web/src/app/api` は **出力 0 行**（差分なし）。`apps/web/src` と `docs/design`、`e2e`、`scripts` 以外に変わったファイルは `scripts/compare-api-responses.mjs`・`scripts/measure-judge-page.mjs`（追加）だけ。マイグレーション・`ENGINE_VERSION`・`/api/**` に差分なし。→ **Q-1・Q-2 達成**。

### A-2 判定・API 応答の一致（Q-3）

main と PR をそれぞれ `next build`＋`next start` で起動し、実装者の `scripts/compare-api-responses.mjs` を自分で実行した。

```
比べた応答: 504 組（/api/check と /api/diagnose）。不一致: 0。出た判定の段: needs_procedure, no_fly, no_procedure, procedure_done
```

- 入力：21 地点（既存 E2E の地点、空港・DID・工業専用・公園・文化財・島根県・海上・範囲外ほか）× 6 条件（許可なし、100g 未満、900g、DIPS DID、公園管理者等の同意、緊急）× 診断 3 通り＋地点判定。`checkedAt`・`evidenceId`・`checkEvidenceId` 以外を JSON 全体で比較（`engineVersion` を含む）。
- スクリプトが「何でも一致と言う」作りでないことの確認：同じ 2 入力を手元で `curl` して両サーバーの応答を正規化して md5 比較し、一致を確認（check・diagnose とも）。応答本文は空でない（`overall`・`verdict.level`・`items[]`・`reason` を含む）。
- 契約の「5 段（4 段＋判定不能）の各 1 地点以上」：出た段は 4 つ（要手続き・飛行禁止・手続き不要・手続き済み）。**判定不能（unknown）の地点は 504 組の中に出ていない**（「範囲外（山口県）」「海上」は別の段になっている）。→ 判定不能の応答の一致は未確認（根拠欄の出し方は画面側で別途確認する）。**Q-3 は「達成（判定不能の入力だけ未確認）」**。

### A-3 速さの実測（Q-17）

`scripts/measure-judge-page.mjs`（5 回の中央値。375×812 と 1280×800。外部通信は遮断、地図タイルは空の画像）。main・PR とも `next start`。

| 指標 | main | PR ② | 差 | 契約の上限 | 判定 |
|---|---|---|---|---|---|
| JS（gzip 合計） | 698,293 B | 694,551 B | **−3,742 B** | +6KB 以内 | 達成 |
| 初期 HTML（gzip） | 33,781 B | 16,139 B | −17,642 B | +8KB 以内 | 達成 |
| CSS（gzip 合計） | 167,855 B | 134,953 B | −32,902 B | +6KB 以内 | 達成 |
| フォント転送（woff2、復号後）375px | 4,353,096 B（368 本） | 1,172,136 B（50 本） | −3.18MB | main 以下 | 達成 |
| LCP 375px（中央値） | 688 ms | 272 ms | −60% | +10% 以内 | 達成 |
| LCP 1280px | 736 ms | 260 ms | −65% | +10% 以内 | 達成 |
| CLS（初回の判定まで）最大 | 0 | 0 | 0 | 0.01 以下 | 達成 |
| 見出し内 CLS 最大 | 0 | 0 | 0 | 0 | 達成 |
| LCP の要素 | `P[site-lead]` | `P[site-lead]` | — | 挿絵・結論カードでない | 達成 |

注：JS 695KB（gzip）は地図ライブラリ等を含む既存の重さで、この PR の変化ではない（−3.7KB）。LCP は模擬環境・ローカル配信の値で、実機の絶対値ではない。main のフォント 368 本はこの環境の取得状況による（旧書体 IBM Plex Sans JP の分割）。

→ Q-17a・Q-17b・Q-17c は **達成**（実装者の報告と一致）。
