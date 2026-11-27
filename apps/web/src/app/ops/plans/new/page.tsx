import { PLAN_JUDGEMENT_DISCLAIMER } from "@soraban/regulations";
import { JudgePills } from "@/components/ops/judge-pills";
import { DipsNotice } from "@/components/ops/plan-ui";
import { PlanWizard } from "@/components/ops/plan-wizard";
import { Forbidden } from "@/components/ops/versions";
import { Note, PageHeader } from "@/components/ops/ui";
import { parsePlanHandoff } from "@/lib/plan-options";
import { requireOpsMember } from "@/server/ops/page";
import { permitHelperFor } from "@/server/ops/permit-page";
import { initialFromHandoff, planCreateDenied, planFormOptions } from "@/server/ops/plan-page";

// 飛行計画の入力。判定画面の「この判定で飛行計画を作る」から来たときは、判定の入力（地点・飛行の方法・許可・予定日）だけを引き継ぐ。
// 判定の結果は引き継がない：保存するとサーバーが判定を実行して、その結果を判定の根拠として残す。
export default async function PlanNewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx, me } = await requireOpsMember();
  const denied = planCreateDenied(me);
  if (denied) return <Forbidden message={denied} />;
  const handoff = parsePlanHandoff(await searchParams);
  const { aircraft, pilots, fixedPilotId, places } = await planFormOptions(ctx, me);
  // 判定画面から引き継いだ入力が 1 つでもあるか（段 ① に注記を出す）
  const hasHandoff = Boolean(
    handoff.lat || handoff.lng || handoff.weightG || handoff.plannedDate || handoff.purpose || handoff.access || handoff.observer || handoff.flags.length > 0 || handoff.permits.length > 0,
  );
  const permitHelper = await permitHelperFor(ctx, null);
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="飛行計画の入力" back={{ href: "/ops/plans", label: "飛行計画の一覧" }}>
        <Note>{PLAN_JUDGEMENT_DISCLAIMER}</Note>
        <DipsNotice />
      </PageHeader>
      <JudgePills lead="地点がまだ決まっていないときは、先に判定画面で調べられます" />
      <PlanWizard
        aircraft={aircraft}
        pilots={pilots}
        fixedPilotId={fixedPilotId}
        places={places}
        initial={initialFromHandoff(handoff)}
        permitHelper={permitHelper}
        handoff={hasHandoff}
        {...(handoff.weightG ? { handoffWeightG: handoff.weightG } : {})}
      />
    </main>
  );
}
