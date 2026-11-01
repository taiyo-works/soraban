import Link from "next/link";
import { PLAN_JUDGEMENT_DISCLAIMER } from "@soraban/regulations";
import { ChangeNotice } from "@/components/ops/change-notice";
import { DeadlineBox, NextActionsList, PlanDigest, ReportBox, ReportStatusBox } from "@/components/ops/plan-ui";
import { PlanAnchorCompat } from "@/components/ops/plan-anchor-compat";
import { PlanFrame } from "@/components/ops/plan-frame";
import { buttonOutlineBrandClass, Section, VERSION_NOTICE_TARGET } from "@/components/ops/ui";
import { loadPlan } from "./_load";

// 通報の主画面（Sprint 17-1。暫定）：通報の要否 ＋ 次にやること。判定は /judgement、計画（概要・確認・手続き・版・中止）は /overview、
// 飛行記録・事故は /journal へ移した。通報の状況カード・手順・判定の 1 行は 17-2 で作り込む。
export default async function PlanDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id, plan } = await loadPlan(params);
  const j = plan.judgement;

  return (
    <PlanFrame plan={plan} current="report" eyebrow="飛行計画の詳細">
      <PlanAnchorCompat planId={plan.id} />
      <div className="flex flex-col gap-4">
        {/* 保存・訂正の直後の結果の通知（版の一覧は /overview にあるため、ここでも受け取る） */}
        <ChangeNotice target={VERSION_NOTICE_TARGET} />
        <p className="opx-note" data-testid="plan-disclaimer">
          {PLAN_JUDGEMENT_DISCLAIMER}
        </p>
        <PlanDigest
          planId={id}
          verdictLevel={j.verdictLevel}
          unknownCount={j.verdictUnknownCount}
          report={plan.report}
          state={plan.state}
          stateLabel={plan.stateLabel}
          stale={plan.freshness.stale}
        />
        <NextActionsList actions={plan.nextActions} />
        <div className="flex flex-wrap gap-3">
          <Link prefetch={false} href={`/ops/plans/${plan.id}/field`} className={buttonOutlineBrandClass} data-testid="plan-field-link">
            現場モードを開く
          </Link>
        </div>
      </div>

      <Section id="sec-report" title="通報の要否" aria-label="通報の要否" description="通報そのものは DIPS 2.0 で行います。そらばんは送信しません。">
        <ReportBox report={plan.report} />
        <ChangeNotice target="report" />
        <ReportStatusBox status={plan.report.status} changes={plan.reportChanges} />
        <DeadlineBox deadline={plan.report.deadline} />
        <div className="flex flex-wrap items-center gap-3">
          <a href={`/ops/plans/${plan.id}/report`} className={buttonOutlineBrandClass} data-testid="plan-report-link">
            通報の内容を見る・結果を記録する
          </a>
        </div>
      </Section>
    </PlanFrame>
  );
}
