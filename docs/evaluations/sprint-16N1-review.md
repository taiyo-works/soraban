# Sprint 16-N1 レビュー（範囲 29f3616..e951310、HEAD e951310）

reviewer の報告をオーケストレーターが保存したもの。合否: **要修正**（R-1・R-2 を直せば合格の見込み）。

## 要修正

- **R-1（中）項目 0 件のとき、判定の PDF とスナップショットで「手続きを済ませれば飛べます」が残る**
  - 場所: `apps/web/src/lib/verdict-display.ts:251-254`、`apps/web/src/components/pdf-verdict.tsx:307`、`apps/web/src/app/ops/plans/[id]/snapshots/[sid]/page.tsx:63`。
  - 原因: 項目 0 件の判定を `totalKey === "unknown"` だけで拾っており、PDF（totalKey 無し）とスナップショット（total 無し）には届かない。`items: []`・`unknownCount: 0` はエンジンで要手続きにまとまる（verdict.ts:738）。契約 N1-1 は項目 0 件も対象。
  - テスト: 単体テストがこの場合の PDF を除外している（`verdict-help-n1.test.ts:72`）。
  - 直し方: 条件に `items.length === 0` を足し、項目 0 件の PDF とスナップショットの単体テストを足す。差し戻し先: generator。
- **R-2（低）`docs/evaluations/sprint-16-test-changes.md` への記録が無い**
  - N1-3: `application-pdf.tsx:407` も `PdfVerdictConclusion` を使うため、申請支援の PDF に変更が及ぶことを記録する。
  - N1-6: Q-20 ③・B2・`/judgement` の長さの、前後の値を表で記録する。差し戻し先: generator。

## 申し送り

- **N-1**: 棚卸し §5.6（`docs/legal/screen-wording-inventory.md:133`）を「ファイルは変えていないが、共通部品経由で同じ扱いになる」と正確にする（generator、R-2 と一緒に）。
- **N-2**: 古い判定（stale）でも判定不能を含まなければ説明文は出る（契約どおり）。Q-L29 (c) の回答待ち（planner）。
- **N-3**: 新しい E2E の `--repeat-each=3` のログが無い（generator、記録の追加）。
- **N-4**: `e2e/sprint16-n1.spec.ts` の `settled` は古い描画でも通るが、後続の自動待ちがあり、偽の成功にはならない。対処不要。

## 問題なしと確かめた観点

`VERDICT_HELP` を描く所は 2 か所（`verdict-summary.tsx:330`、`pdf-verdict.tsx:307`）だけ。needs_procedure でも unknownCount>0 なら隠れる。判定不能を含まない 4 段は変わっていない。新しい検査は旧コードで落ちる。K-11 の差分は 0。禁止語・新しい文言・識別子の追加は無い。既存の検査は弱めていない。
