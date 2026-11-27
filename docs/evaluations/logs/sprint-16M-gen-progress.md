# Sprint 16-M generator 進捗（再起動後はここから再開）

基準 HEAD c3dfe5e。区切りごとにコミット（パス指定、push しない）。

## 区切りと状態
- [x] 0. 調査（基準の `/` 375: 12,418px（B2 上限 12,600 に 16-B で上げていた）、Q-20 ③ 2.1）
- [x] 1a. 判定の帯のカード（結論・手続き・規制ごとの判定の行）・総合の語・長さの詰め・M-6（B2 12,000／Q-20 2.0 に戻し、pr2 65/65 通過。11,643px・2.0）
- [ ] 2. M-5・規制カードの「必ず」
- [ ] 3. 新しい E2E（sprint16-m）と旧コードで落ちることの確認
- [ ] 4. 全検証・test-changes・報告

## メモ

- 検証用スクリプト（scratchpad）: pub.sh（CI と同じ条件で公開側 E2E）、bp.sh（build + 寸法の probe）。e2e/_probe-*.spec.ts は調査用でコミットしない（最後に削除）。
- 寸法の実測（375×812）: 基準 12,418 → 11,643。Q-20 ③ は固定の台本（フィクスチャのサーバー）で 2.1 → 2.0（scrollPx 1,637／上限 1,664）。
- ダイナミックな dev サーバーは 127.0.0.1 でハイドレートしない（allowedDevOrigins）。寸法は必ず `next build` + `next start` で測る。

## 状態（中間）
- 1b〜3 完了: sprint16-m（29 件、×3 で 87/87、旧コード c3dfe5e で 16 件落ちる）。公開側全体 353 件中 351 通過（落ちたのは sprint9 306 と sprint18-3-wording。後者は PDF の「必ず」の許可が画面依存だったため。検査を緩める変更なので適用せず、報告に上げる）。
- 残り: ops E2E 全体（空の DB m16_full1、ログ sprint-16M-gen-ops-e2e.log）、test-changes・コミット、報告。
- ops E2E 全体（空の DB m16_full1、HEAD 581aa18 のビルド）: 433 件中 432 通過、`sprint16-h1-fix1-db` R-4 が 1 回失敗（runbook の既知の不安定。新しい DB で単独 ×3 = 48/48 通過、ログ sprint-16M-gen-ops-r4.log）。typecheck・lint（警告 0）・unit 3104・build・contrast・testids・K-11 差分 0 は通過。完了。

## 修正 1（レビュー N-2・N-5・N-6、基準 744afa7）
- N-2：`VerdictSummary` の `plainCard`（表示だけ）→ ops スナップショットの画面。新しい `e2e/ops-db/sprint16-m-db.spec.ts`（新 3/3、旧コードで失敗）。N-5：PDF の条件に `tidyEngineText`。N-6：コメント修正。
- 検証（ログ `sprint-16M-fix1-*.log`）：typecheck・lint（警告 0）・unit 3104・build 通過。ops（空の DB）：sprint16-m-db・16-l・16-h2・12d で 37/37。公開：sprint16-m・sprint18-3-wording・sprint11d で 50/50。K-11 差分 0。
