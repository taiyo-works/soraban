# Sprint 16-L generator 進捗（再起動後はここから再開）

基準 HEAD 3c03fa7。区切りごとにコミット（パス指定、push しない）。

## 区切りと状態
- [ ] 0. 調査（現状の主ボタン数・長さの実測・禁止語の棚卸し）
- [ ] 1. 登録系（/ops/about 横スクロール、機体・操縦者・許可・承認・地点・利用者）
- [ ] 2. 事故・ヒヤリハット
- [ ] 3. 計画の枠（plan-frame）・plan-report チップ
- [x] 4a. L-5 の上限を戻した（sprint17-2-db 27/27、作業台 375 は 9,373／長い計画 10,385、voidedRecorded 最初の画面 739）。実測は下のメモ。コミット済み
- [x] 4b. 主ボタンの数（事故の詳細 4→1、作業台の行操作は副）。載せ替えは既存部品で済んでいた（旧い class 0）
- [x] 5. L-3（tidyEngineText）、L-4（古い判定は judgement-primary を副に）
- [x] 6. E-5（今ボタンを見出し行へ。660 ≤ 667）
- [x] 7. sprint16-l-db 9 件、旧コード 3c03fa7 で 8/9 が落ちることを確認（K-15 は守りの検査）。コミット 035a685
- [ ] 8. 全検証・ログ・test-changes・報告

## メモ

- 作業台 375: 10,310→9,373（dips_only 行の 1 行化、飛行目的のチェック行 56px、グループ間 8px、節の間 16px）。計画の概要: 版の一覧を最新 3 件、PlanFrame の間隔・eyebrow を題の横へ、主画面カードの間隔。
- 検証用: scratchpad の newdb.sh（新しい DB）・e2e.sh（ops E2E）。e2e/ops-db/_probe-*.spec.ts は調査用でコミットしない（最後に削除）。
- DB: postgres/postgres、soraban_app/soraban_app_ci_only を設定済み。
- 全検証: typecheck・lint・unit(3103)・test:db(289)・testids・contrast は通過。build 済み。ops E2E 全体は l16_full1 で実行中（ログ sprint-16L-gen-ops-e2e.log）。残り: spec ×3、test-changes 追記、最終コミット、報告。
