# Sprint 16-L generator 進捗（再起動後はここから再開）

基準 HEAD 3c03fa7。区切りごとにコミット（パス指定、push しない）。

## 区切りと状態
- [x] 0. 調査（現状の主ボタン数・長さの実測・禁止語の棚卸し）
- [x] 1. 登録系（/ops/about 横スクロール、機体・操縦者・許可・承認・地点・利用者）
- [x] 2. 事故・ヒヤリハット
- [x] 3. 計画の枠（plan-frame）・plan-report チップ
- [x] 4a. L-5 の上限を戻した（sprint17-2-db 27/27、作業台 375 は 9,373／長い計画 10,385、voidedRecorded 最初の画面 739）。実測は下のメモ。コミット済み
- [x] 4b. 主ボタンの数（事故の詳細 4→1、作業台の行操作は副）。載せ替えは既存部品で済んでいた（旧い class 0）
- [x] 5. L-3（tidyEngineText）、L-4（古い判定は judgement-primary を副に）
- [x] 6. E-5（今ボタンを見出し行へ。660 ≤ 667）
- [x] 7. sprint16-l-db 10 件、旧コード 3c03fa7 で K-15 を除く 9 件が落ちることを確認。コミット 035a685
- [x] 8. 全検証・ログ・test-changes・報告

## メモ

- 作業台 375: 10,310→9,373（dips_only 行の 1 行化、飛行目的のチェック行 56px、グループ間 8px、節の間 16px）。計画の概要: 版の一覧を最新 3 件、PlanFrame の間隔・eyebrow を題の横へ、主画面カードの間隔。
- 検証用: scratchpad の newdb.sh（新しい DB）・e2e.sh（ops E2E）。e2e/ops-db/_probe-*.spec.ts は調査用でコミットしない（最後に削除）。
- DB: postgres/postgres、soraban_app/soraban_app_ci_only を設定済み。
- 全検証: typecheck・lint・unit(3103)・test:db(289)・testids・contrast は通過。build 済み。ops E2E 全体は l16_full1 で実行中（ログ sprint-16L-gen-ops-e2e.log）。残り: spec ×3、test-changes 追記、最終コミット、報告。
- 全検証完了: ops E2E 431/431（30.2 分、空の DB l16_full1）、sprint16-l-db ×3 = 30/30。残り: 最終コミットと報告。

## 修正 1（レビュー R-1・N-2・N-4・N-9。基準 HEAD 8b09b57）
- [x] N-2・N-4 のコード（コミット 6ef2acf）：rejudgeIsPrimary 削除とコメント、`必ず(?!しも)`、守る条件に整え、単体 1 件追加。typecheck・lint（警告 0）・unit 3104 通過
- [x] R-1 公開側 E2E（build 済み HEAD 12a7e46、CI=1・next start・1 ワーカー・--retries=0・フル Chromium）：319 通過・1 失敗（`sprint9` 306 右クリック。runbook の既知の不安定）。単独 --repeat-each=6 は 2 通過・4 失敗（runbook に基準 c58d92e で 3/6 とある）。ログ sprint-16L-fix1-public-e2e.log・-public-s9-306.log
- [x] DB spec：sprint16-l-db（10）・sprint16-h2-db・sprint12d-db（verdict-done-condition を使う）計 34 通過（空の DB l16_fix1。ログ sprint-16L-fix1-ops-e2e.log）、build（-build.log）
- [x] test-changes・progress の更新
