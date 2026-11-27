# Sprint 16-L レビュー（3c03fa7..e1b1ea3、6 コミット）

reviewer の報告をオーケストレーターが保存した（2026-11-25）。読んだのは `git diff` / `git show` だけ。

## 結論: 合格（条件付き）

安全・権限・追記専用・端末データの面で、コードの差し戻しが要る問題はない。条件は R-1（公開側の E2E と CI の確認）と N-1（K-8 の例外の記録。オーケストレーターが §17 の 22 に記録）。

## 観点ごとの結果

1. **L-4**（`/ops/plans/[id]/judgement`）: 変わったのは `page.tsx` の `forwardIsPrimary = !stale` だけ。リンク先・`RejudgeButton`・`plan-stale-readonly-note` は不変。API・server・権限の差分 0。新しい判定では閲覧者も `judgement-primary` が主、古い判定で再判定できる人は `plan-rejudge` が主、閲覧だけの人は主 0（中止済みで古い場合も 0）。`sprint16-h2-db` N-e は主 0 を確かめる検査で、弱めていない。
2. **L-3 `tidyEngineText`**: 画面だけで整え、エンジンの文はそのまま（単体テストで確認）。`ENGINE_VERSION`・証跡・PDF・保存データに影響なし。外した後も「未確認」と確認を求める文が残り、「問題なし」とは読めない。公開 `/` の `verdict-summary` の変化も安全側。
3. **事故の詳細・作業台の主ボタン**: 見た目（`data-variant`・class）だけ。`disabled` の条件・`onSubmit`・`newRequestId`・送信先・文言・`data-testid` は不変。
4. **K-11**: `packages/`・server・api・マイグレーション・`ENGINE_VERSION`・証跡 ID・`evidence_log`・package.json・lockfile の差分 0。
5. **端末データ**: localStorage・IndexedDB・Cache・`drafts.ts` の差分 0。
6. **禁止語・通報の文言・期限**: 画面の文言の追加なし。通報の文言と期限の文・日数は不変。
7. **L-5**: 上限は 16-B より前の値（9,500 / 10,400 / 3,000 / 2,200、実データ並み 10,400 / 3,000 / 2,200）に戻り、voidedRecorded の例外は撤廃（748）。`version-row` の DOM の件数は同じ（`version-list` 直下は 5→3、古い版は `version-list-older`）。
8. **CSS**: `.opx-check-dense` 56px。主色・状態色・寸法の不変条件に触れない。E-5 の絶対配置の 200% は N-3。

## 指摘一覧

| ID | 重さ | ファイル:行 | 根拠 | 差し戻し先 |
|---|---|---|---|---|
| R-1 | 中 | `apps/web/src/components/verdict-summary.tsx:185,187,404` | 公開 `/` と共有する部品を変えたが、公開側の E2E（`next start`）を流していない。push 後の CI も未確認。 | generator |
| N-1 | 中（判断） | `judgement/page.tsx:55`、`sprint16-h2-db.spec.ts:577` | 閲覧者が古い判定を開くと主ボタン 0。K-8 の例外として記録が要る（事故の詳細の閲覧者も 0）。 | オーケストレーター（§17 の 22） |
| N-2 | 低 | `judgement/page.tsx:52` / `:127` | `rejudgeIsPrimary` が未使用で lint の警告が増えた。127 行のコメントが古い。test-changes の「警告 1 は既存」と食い違う。 | generator |
| N-3 | 低（疑い） | `ops-v2-screens.css:1007-1022` | 「今」を `top: -52px` で固定。200% で見出しが 2 行になると日付・時刻のラベルと重なるおそれ。E-5 の検査は 360 の等倍だけ。 | designer |
| N-4 | 低 | `lib/field-message.ts:15` | `/必ず/g` は「必ずしも」を壊す。`必ず(?!しも)` にして単体テストを足す。`verdict-summary.tsx:543-547` の「守る条件」も整えをそろえる。 | generator |
| N-5 | 低 | `sprint17-2-db.spec.ts:439` | 長い計画の作業台 375 の余裕が 15px。 | オーケストレーター（申し送り） |
| N-6 | 低 | `report-client.tsx:430,305-307` | 「対象外」の行で「－」が 2 回出る。 | designer |
| N-7 | 低 | `sprint16-l-db.spec.ts:88` | 新しい spec の側だけで `input` を切れの検査から除いた。既存は弱めていない。 | なし（記録のみ） |
| N-8 | 低 | `plan-ui.tsx:295,302` | 「判定を見る →」等から `whitespace-nowrap` を外し、狭い幅で矢印の前で折れることがある。 | designer |
| N-9 | 低 | `sprint-16L-gen-progress.md` | 区切りのチェックが実態と食い違う。 | generator |
