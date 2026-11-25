# Sprint 16-L generator 進捗（再起動後はここから再開）

基準 HEAD 3c03fa7。区切りごとにコミット（パス指定、push しない）。

## 区切りと状態
- [ ] 0. 調査（現状の主ボタン数・長さの実測・禁止語の棚卸し）
- [ ] 1. 登録系（/ops/about 横スクロール、機体・操縦者・許可・承認・地点・利用者）
- [ ] 2. 事故・ヒヤリハット
- [ ] 3. 計画の枠（plan-frame）・plan-report チップ
- [x] 4a. L-5 の上限を戻した（sprint17-2-db 27/27、作業台 375 は 9,373／長い計画 10,385、voidedRecorded 最初の画面 739）。実測は下のメモ。コミット済み
- [ ] 4b. 通報の主画面・作業台の主ボタン 1 つ・載せ替え
- [ ] 5. L-3 の「必ず」の表示側整形、L-4 閲覧者の主ボタン
- [ ] 6. E-5 点検の入力上部
- [ ] 7. E2E sprint16-l-db、旧コードで落ちる確認
- [ ] 8. 全検証・ログ・test-changes・報告

## メモ

- 作業台 375: 10,310→9,373（dips_only 行の 1 行化、飛行目的のチェック行 56px、グループ間 8px、節の間 16px）。計画の概要: 版の一覧を最新 3 件、PlanFrame の間隔・eyebrow を題の横へ、主画面カードの間隔。
- 検証用: scratchpad の newdb.sh（新しい DB）・e2e.sh（ops E2E）。e2e/ops-db/_probe-*.spec.ts は調査用でコミットしない（最後に削除）。
- DB: postgres/postgres、soraban_app/soraban_app_ci_only を設定済み。
