# Sprint 18-1: 画面に出なくなった data-testid の対応表

フラグ `APPLICATION_SUPPORT_ENABLED`（既定・本番は無効）が無効のとき、公開の `/` の診断パネル（`DiagnosisPanel`）を描かない。
**コードは削除していない**ので、基準の一覧（`docs/evaluations/sprint-17-testids-baseline.txt`）から消える識別子は 0
（`node scripts/testids.mjs --check` が「消えた識別子は 0」。`--write --reason` は使っていない。`testids-baseline.test.ts` の件数とハッシュは変えていない）。

| 識別子 | 前の画面 | フラグ無効での扱い | 同等の検査先 |
|---|---|---|---|
| `diagnosis-details`（「申請の準備」の畳み。`Disclosure`） | 公開の `/`、詳細な指定の下 | 描かない（0 個） | 「無いこと」: `e2e/sprint18-1.spec.ts` 1-1（4 地点 × 2 幅）、`sprint12h-pr2` B2。畳みの開閉（キーボード・矢印・44px）の検査は同じ部品（`Disclosure`）の `coverage-details` に移した |
| `diagnosis-category-headline`（カテゴリー切り分けの見出し） | 同上、診断パネルの先頭 | 描かない（0 個） | 「無いこと」: 1-1、11e #13、11g #15、12h-pr2 B2。カテゴリーの中身は `packages/regulations` の `diagnosis.test.ts`・`model-aircraft` の単体 |
| `diagnosis-did-status`（診断パネルの DID の三値） | 同上 | 描かない（0 個） | 同じ値は `did-status`（DID 自動判定。公開の `/` に残る）で検査: 11a #4、11f #3・4、7（2 件） |
| `procedure-card`（手続きカード。`data-procedure-id`・`data-verdict`） | 診断パネルの必要手続きチェックリスト | 描かない（0 個） | 同じ手続きは判定の `verdict-procedure`（`data-procedure-id` が同じ）／`verdict-done-item` で検査: 11c #6、7 #98、11d #6 |
| `procedure-verdict-done`（手続きカードの「手続き済み（条件付き）」の印） | 同上 | 描かない（0 個） | `verdict-done-item`（11d #6） |
| （識別子なし）ボタン「束ね PDF を出力」、プリフィル表、飛行マニュアル骨子、期限カレンダー、2 系統の手続き窓口（DRS／DIPS のリンク） | 同上 | 描かない | 本文 `textContent` に語が 0 件（`APPLICATION_SUPPORT_WORDS`）、ボタンが 0 個。中身は `packages/regulations` の単体（`prefill.test.ts`・`diagnosis.test.ts`・`manual-templates` ほか）が守る |

画面に残る（変えていない）識別子: `verdict-*`、`did-status`、`evidence-id`、`regulation-card-*`、`history-item`、`history-verdict`、`coverage-details` ほか。
`verdict-responsibility` は残し、文だけ境界の文（`BOUNDARY_SHORT`）に変えた。

## 画面に出ない状態の検査について

フラグを有効にした E2E は作らない（公開の `/` はビルドのときに値が固まり、別のビルドが要るため。契約 §4.1）。
診断パネル側の回帰は、`packages/regulations` の既存の単体テスト（診断・プリフィル・マニュアル骨子・期限）と、
`apps/web/src/server/diagnose-response.test.ts`（有効のとき `prefill` が残る）が守る。

---

# Sprint 18-2: 画面に出なくなった data-testid の対応表（運航管理）

フラグ `APPLICATION_SUPPORT_ENABLED` が無効（既定・本番）のとき、運航管理の許可・承認の「申請済み」の記録（`dips_permit`）の入口を描かない。
コードは残しているので、基準の一覧から消える識別子は 0（`node scripts/testids.mjs --check` が「消えた識別子は 0」。`--write --reason` は使っていない）。

| 識別子 | 前の画面 | フラグ無効での扱い | 同等の検査先 |
|---|---|---|---|
| `procedure-form-dips_permit`・`procedure-done-at-dips_permit-*`・`procedure-reference-dips_permit`・`procedure-check-dips_permit-applicationCompleted`・`procedure-submit-dips_permit` | `/ops/plans/[id]/overview` の手続きの記録（許可・承認） | 描かない（0 個）。API も 409 | 「無いこと」: `sprint12b-db` #17、`sprint18-2-db` 2-1。フラグ有効の流れ: `reports.db.test.ts` 契約 17 |
| `procedure-dips_permit`（状態の札・履歴の箱）、`procedure-status-dips_permit`、`procedure-deadline-dips_permit` | 同上 | **既存の行が無い計画では描かない**。既存の行があれば `data-legacy="true"` の「以前の記録」として読み取り専用で描く（`procedure-status-*`・`procedure-history-*` あり。`procedure-deadline-*` は出さない） | DB テスト 2-3（要約の `legacy`）。E2E では行を作れない（フラグ有効の操作が要る）ため、DB テストで守る |
| `procedure-retract-open-dips_permit`・`procedure-retract-form-dips_permit`・`procedure-retract-reason-dips_permit`・`procedure-retract-dips_permit` | 同上 | 以前の記録でも描かない（取り下げも 409） | DB テスト 2-3 |
| `next-action`（`data-action-id="apply_permit"`）と `next-action-label`・`next-action-link` | 計画の主画面・ホームの次にやること | 出さない | `sprint12b-db` #17、`sprint12d-db` #15、`sprint17-db` S-5、`sprint18-2-db` 2-1（`apply_permit` が 0）。単体 `report-logic.test.ts` |
| `next-action`（`data-action-id="register_permit"`）の名前 | 同上 | 名前が「取得した許可・承認を登録する」（識別子は同じ）。記録に依存せず出る | `sprint12b-db` #17、`sprint12d-db` #15、`sprint17-db` S-5 |

残す識別子（変えていない）: `procedure-small_drone_law`・`procedure-form-small_drone_law`・`procedure-check-small_drone_law-*`・`procedure-submit-small_drone_law`・`procedure-history-small_drone_law` ほか、`plan-procedures`・`plan-procedures-details`・`procedure-none`（文だけ変更）、`plan-permit-applied-note`（文だけ変更）、`plan-diagnosis-evidence`・`basis-diagnosis-evidence`・`report-row-diagnosis-evidence`（見出しだけ変更）、`license-renewal-status`・`flight-license`。
