# Sprint 17-1: ルートと data-testid の対応表（実装後）

基準の一覧: `docs/evaluations/sprint-17-testids-baseline.txt`（着手時の `apps/web/src` の識別子 1,996 件。`node scripts/testids.mjs --write` で生成）。
差分検査: `node scripts/testids.mjs --check`（および単体テスト `testids-baseline.test.ts`）。消えた識別子は 0。
識別子は**移動のみ**（名前の変更・削除なし）。

| ルート | 実装 | 主な識別子 |
|---|---|---|
| `/ops/plans/[id]`（通報の主画面。暫定） | `app/ops/plans/[id]/page.tsx` | `plan-title-heading`、`plan-state`、`plan-stale`、`plan-tabs`・`plan-tab-*`、`plan-disclaimer`、`plan-digest`、`plan-judge-link`・`plan-judge-line`（新）、次にやること（`next-actions`・`next-action*`）、`plan-field-link`、`sec-report`、`plan-report-box`・`plan-report-label`・`plan-report-reasons`・`plan-report-status`・`plan-report-deadline`・`plan-report-changes`・`plan-report-link`、`plan-dips-notice` |
| `/ops/plans/[id]/report` | 既存（`PlanTabs` を追加） | `report-*`・`send-*`・`record-*`・`mock-notice`（変更なし）、`plan-tabs` |
| `/ops/plans/[id]/overview`（新） | `overview/page.tsx` | `plan-overview`・`plan-start`・`plan-pilot-name`・`plan-permit-numbers-text`・`plan-edit-link`、`procedure-*`・`plan-procedures`、`plan-confirmation-status`・`plan-self-confirmation`・`plan-confirm-facts`・`plan-unknown-count`・`plan-stale-sources`・`plan-confirmations`・`plan-confirmation-row`・`plan-confirmation-decision`・`plan-confirm-panel`・`plan-confirm-approve`・`plan-confirm-return`・`plan-request-confirmation`、`version-*`、中止（`VoidForm`）。アンカー `#sec-confirm`・`#request-confirmation`・`#confirm`・`#procedures` |
| `/ops/plans/[id]/judgement`（新） | `judgement/page.tsx` | `plan-disclaimer`、`verdict-*`（`VerdictSummary`）、`plan-judgement`・`plan-snapshot-seq`・`plan-judged-at`・`plan-check-evidence`・`plan-diagnosis-evidence`、`plan-stale-box`・`plan-stale-reasons`、`plan-basis-link`・`plan-snapshots-link`、`plan-rejudge`、`plan-permit-*`・`plan-permits-link`。アンカー `#sec-verdict`・`#rejudge`・`#permits` |
| `/ops/plans/[id]/journal`（新） | `journal/page.tsx` | `plan-flights`・`plan-flights-empty`・`plan-flight-row`・`plan-make-flight`、`incident-linked*` |
| `/ops/plans/[id]/field` | 既存（変更なし。タブは出さない） | `field-*` |
| `/ops/plans/[id]/snapshots`・`/[sid]` | 既存（戻り先を判定へ） | `snapshot-*`・`basis-*` |

旧アンカーの移送: `plan-anchor-compat.tsx`（`#sec-verdict`・`#permits`・`#rejudge` → `/judgement`、`#sec-confirm`・`#request-confirmation`・`#confirm`・`#procedures` → `/overview`、`#sec-report` は主画面のまま）。hash は引き継ぐ。
