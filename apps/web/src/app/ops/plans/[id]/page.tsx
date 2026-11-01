import Link from "next/link";
import { PLAN_JUDGEMENT_DISCLAIMER } from "@soraban/regulations";
import { ChangeNotice } from "@/components/ops/change-notice";
import { NextActionsList, PlanDigest } from "@/components/ops/plan-ui";
import { PlanAnchorCompat } from "@/components/ops/plan-anchor-compat";
import { PlanFrame } from "@/components/ops/plan-frame";
import { PlanSteps, ReportStatusCard } from "@/components/ops/plan-main-ui";
import { buttonOutlineBrandClass, VERSION_NOTICE_TARGET } from "@/components/ops/ui";
import { getPlanReport } from "@/server/ops/reports";
import { loadPlan } from "./_load";

// 通報の主画面（Sprint 17-2）：通報の状況カード（状況・期限・主操作 1 つ）→ 通報の手順（3 つ）→ ほかの要点（判定の 1 行・確認の 1 行）→
// 次にやること → 免責。判定は /judgement、計画（概要・確認・手続き・版・中止）は /overview、飛行記録・事故は /journal。
// 判定を見なくても、通報の準備と記録はここと /report で完結する。
export default async function PlanDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, id, plan } = await loadPlan(params);
  const j = plan.judgement;
  // 手順 ① の件数（未入力の必須項目）。読めなくても画面は止めない。
  let missing: number | null = null;
  if (!plan.voided) {
    try {
      missing = (await getPlanReport(ctx, id)).prepared.missingRequiredCount;
    } catch {
      missing = null;
    }
  }

  return (
    <PlanFrame plan={plan} current="report" eyebrow="通報の状況">
      <PlanAnchorCompat planId={plan.id} />
      <div className="flex flex-col gap-4">
        {/* 保存・訂正の直後の結果の通知（版の一覧は /overview にあるため、ここでも受け取る） */}
        <ChangeNotice target={VERSION_NOTICE_TARGET} />
        <ChangeNotice target="report" />
        <ReportStatusCard plan={plan} />
        {plan.voided ? null : <PlanSteps planId={plan.id} statusLabel={plan.report.status.shortLabel} missing={missing} />}
        <PlanDigest
          planId={id}
          verdictLevel={j.verdictLevel}
          unknownCount={j.verdictUnknownCount}
          state={plan.state}
          stateLabel={plan.stateLabel}
          stale={plan.freshness.stale}
          sourcesStale={plan.staleSources.length > 0}
        />
        <NextActionsList actions={plan.nextActions} limit={2} />
        <div className="flex flex-wrap gap-3">
          <a href={`/ops/plans/${plan.id}/report`} className={buttonOutlineBrandClass} data-testid="plan-report-link">
            通報の内容を見る
          </a>
          <Link prefetch={false} href={`/ops/plans/${plan.id}/field`} className={buttonOutlineBrandClass} data-testid="plan-field-link">
            現場モードを開く
          </Link>
        </div>
        <p className="opx-note" data-testid="plan-disclaimer">
          {PLAN_JUDGEMENT_DISCLAIMER}
        </p>
      </div>
    </PlanFrame>
  );
}
