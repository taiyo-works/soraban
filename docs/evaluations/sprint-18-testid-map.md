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
