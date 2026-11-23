import type { ReactNode } from "react";
import type { PlanDetailDto } from "@/server/ops/plans";
import { cardHeading, primaryActionOf, voidedCancelNotice } from "@/lib/plan-main";
import { DeadlineBox, ReportBox, ReportStatusBox } from "./plan-ui";
import { buttonPrimaryClass } from "./ui";

// 通報の主画面（Sprint 17-2）の部品：通報の状況カード（状況・期限・主操作 1 つ・固定の文言の短い版）と、通報の手順（3 つ）。
// 判定は補助の 1 行（PlanDigest）に置き、ここには出さない。

export function ReportStatusCard({ plan }: { readonly plan: PlanDetailDto }) {
  const status = plan.report.status;
  const voidedNoRecord = plan.voided && status.code === "no_record";
  const canAct: Record<string, boolean> = {};
  for (const a of plan.nextActions as readonly import("@/server/ops/report-logic").NextAction[]) canAct[a.id] = a.canAct;
  const hasEffective = status.effectiveId !== null;
  const reportDue = plan.nextActions.some((a) => a.id === "report");
  const action = primaryActionOf({ planId: plan.id, voided: plan.voided, state: plan.state, statusCode: status.code, hasEffective, canAct, reportDue });
  const cancelNotice = voidedCancelNotice({ voided: plan.voided, statusCode: status.code, hasEffective });
  return (
    <section
      id="sec-report"
      aria-label="通報の状況"
      className="flex scroll-mt-4 flex-col gap-3 rounded-sb-l bg-sb-base px-4 py-4 opx-shadow"
      data-testid="plan-report-card"
      data-code={status.code}
    >
      <ReportBox report={plan.report} compact part="head" voidedNoRecord={voidedNoRecord} heading={cardHeading({ voided: plan.voided, statusCode: status.code, hasEffective, requirementLabel: plan.report.label, reportedLabel: status.label.split("：")[0] ?? "", reportDue })} />
      <a href={action.href} data-variant="primary" className={`${buttonPrimaryClass} w-full`} data-testid="plan-primary-action" data-action-id={action.id}>
        {action.label}
      </a>
      {cancelNotice ? (
        <p className="rounded-sb-m border-[1.5px] border-sb-v-no-fg bg-sb-base px-3 py-2 font-bold text-sb-ink" data-testid="plan-cancel-needed">
          <span aria-hidden className="mr-1">!!</span>
          {cancelNotice}
        </p>
      ) : null}
      {voidedNoRecord ? null : <ReportStatusBox status={status} changes={plan.reportChanges} />}
      <DeadlineBox deadline={plan.report.deadline} compact />
      <ReportBox report={plan.report} compact part="body" voidedNoRecord={voidedNoRecord} />
    </section>
  );
}

function Step({ n, href, title, state, children }: { readonly n: 1 | 2 | 3; readonly href: string; readonly title: string; readonly state: ReactNode; readonly children: ReactNode }) {
  return (
    <li>
      <a href={href} className="flex min-h-14 items-start gap-3 px-4 py-3 hover:bg-sb-hover" data-testid={`plan-step-${n}`}>
        <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sb-pill border-[1.5px] border-sb-ink sb-num text-sm font-bold">
          {n}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-base font-bold text-sb-ink">{title}</span>
            <span className="text-sm text-sb-ink-2">{state}</span>
          </span>
          <span className="text-sm leading-relaxed text-sb-ink-2">{children}</span>
        </span>
      </a>
    </li>
  );
}

/** 通報の手順：① 内容を確認 → ② DIPS で本人が通報 → ③ 結果を記録。押すと通報の作業台の該当の位置へ移る。 */
export function PlanSteps({ planId, statusLabel, missing }: { readonly planId: string; readonly statusLabel: string; readonly missing: number | null }) {
  const base = `/ops/plans/${planId}/report`;
  return (
    <section aria-label="通報の手順" className="flex flex-col gap-2" data-testid="plan-steps">
      <h2 className="opx-eyebrow">通報の手順</h2>
      <ol className="flex flex-col divide-y divide-sb-rule overflow-hidden rounded-sb-l bg-sb-base opx-shadow">
        <Step n={1} href={`${base}#inputs`} title="内容を確認" state={missing === null ? "確認する" : `計画の内容から未入力の必須 ${missing} 件`}>
          通報する内容と、未入力・要確認の項目を確かめます。
        </Step>
        <Step n={2} href={`${base}#items`} title="DIPS で本人が通報" state="本人の操作">
          項目をコピーして、DIPS 2.0 で本人が認証し、最終確認のうえ通報します。
        </Step>
        <Step n={3} href={`${base}#record`} title="結果を記録" state={statusLabel}>
          通報した日時と受付番号を記録します。
        </Step>
      </ol>
    </section>
  );
}
