# Sprint 17-1: 既存テストの変更と理由（T-2）

意図の変更は「URL（どの画面で見るか）」と「画面を移る操作の追加」だけ。**期待値（文言・件数・寸法・比・data-* の値）は弱めていない。** 「存在しないこと」の検査（`toHaveCount(0)`）は、移動先の画面（その識別子が実際に出る画面）に移して残した（主画面で数えると常に 0 になって弱まるため）。

## 単体テスト

| ファイル | 変更 | 理由 |
|---|---|---|
| `apps/web/src/server/ops/report-logic.test.ts` | `apply_permit` の `href` の期待値を `/ops/plans/{id}#procedures` → `/ops/plans/{id}/overview#procedures` | `planHref` の行き先を新しい画面へ（契約 §5.1・T-3）。他の `planHref` の期待は関数の出力と照合する形で変更なし |
| `apps/web/src/app/ops/ops-v2-conventions.test.ts` | 新しい画面・部品（`S17_FILES`）を v2 トークン検査の対象に**追加** | D-1。既存の検査は変えていない |
| `apps/web/src/components/ops/ops-nav-model.ts`（`BACK_TABLE`） | `/overview`・`/journal`・`/judgement` の行を追加。`/snapshots` の戻り先を判定へ | 戻り先の表（`ops-nav.test.ts` が全行を検査する） |

追加: `plan-anchor-compat.test.ts`（旧アンカー 8 つの移送先）、`testids-baseline.test.ts`（T-1: 基準の一覧から消えた識別子が 0）。

## E2E-DB（`pnpm test:e2e:ops`）

| ファイル | テスト | 変更 | 理由 |
|---|---|---|---|
| `sprint12a-db.spec.ts` | 11・16・17・20 | 確認の依頼・確認・再確認の操作と `plan-confirmation-*` の検査は `/overview`、`plan-snapshot-seq` は `/judgement` を `goto`。`plan-basis-link` のタップ寸法は `/judgement` で検査。訂正後は主画面（保存直後の行き先）で通知を確かめたあと `/overview` へ。20 の画面一覧に新しい 4 画面を追加 | 識別子の移動（§6） |
| 同 | 9 | `plan-stale`・`plan-rejudge`・`plan-snapshot-seq` を `/judgement` で | 同上 |
| 同 | 13・14 | `plan-flights-empty`・`plan-make-flight`・`plan-flight-row` を `/journal` で | 同上 |
| 同 | 認可 | `plan-edit-link`・`plan-confirm-panel` の不在/存在を `/overview`、`plan-make-flight` の不在を `/journal` で。他人の計画の `plan-edit-link` 不在も `/overview` で | 「無いこと」の検査を実際に出る画面へ |
| 同 | 計画を判定から作る | `plan-snapshot-seq`・`plan-check-evidence` を保存後に `/judgement` で | 同上 |
| `sprint12b-db.spec.ts` | 17 | 次にやること（`next-action`）は主画面、`procedure-*` は `/overview` を `goto`。「次にやることを押すと手続きの記録へ移る」の URL 検査を `/overview#procedures$` に（旧 `#procedures$`）。次にやることの「消える/戻る」の検査は主画面で | 手続きの記録を計画タブへ（§3.2-8）。URL の検査は**より厳密**にした |
| 同 | 18 | `plan-judged-at` を `/judgement` で。タップ寸法の走査対象に新しい画面を追加 | 識別子の移動・対象の追加 |
| `sprint12c-db.spec.ts` | 12 | `plan-flight-row` を `/journal` で | 同上 |
| `sprint12d-db.spec.ts` | 13-1〜13-5・14 | `plan-permit-*`・`verdict-*`・`plan-stale-box`・`plan-rejudge`・`plan-basis-link` は `/judgement`。`next-actions`・`next-action` は主画面。`procedure-history-*`・`plan-overview` は `/overview` | 同上 |
| `sprint12e-db.spec.ts` | 13 | `incident-linked*` を `/journal` で | 同上 |

追加: `sprint17-db.spec.ts`（S-1・S-2・S-3・S-5・S-6・J-1（暫定）・J-2（17-1 の範囲）・J-3・J-4）。

変更していない E2E（`sprint12h-*`・`sprint14`・`sprint15`・通常の E2E ほか）は、空の DB からの全体実行（153 件）で通った。
