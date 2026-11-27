import { notFound } from "next/navigation";
import { PLAN_JUDGEMENT_DISCLAIMER } from "@soraban/regulations";
import { DipsNotice } from "@/components/ops/plan-ui";
import { PlanForm } from "@/components/ops/plans-client";
import { Forbidden } from "@/components/ops/versions";
import { Note, PageHeader } from "@/components/ops/ui";
import { requireOpsMember } from "@/server/ops/page";
import { permitHelperFor } from "@/server/ops/permit-page";
import { canUpdatePlan, initialFromPlan, planFormOptions } from "@/server/ops/plan-page";
import { getPlan } from "@/server/ops/plans";
import { OpsError } from "@/server/ops/service";

// 飛行計画の訂正。判定に関わる項目を変えると、保存時にサーバーが判定をやり直して新しいスナップショットを作る。
export default async function PlanEditPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let plan;
  try {
    plan = await getPlan(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  if (plan.voided) return <Forbidden message="中止した計画は訂正できません。" />;
  if (!canUpdatePlan(me, plan.isSelf)) return <Forbidden message="計画の訂正は運航管理者と、計画の操縦者本人だけが行えます。" />;
  const options = await planFormOptions(ctx, me);
  const permitHelper = await permitHelperFor(ctx, plan.id);
  const { pilots, fixedPilotId, places } = options;
  // 機体は訂正で変えられない。抹消した機体でも、選択肢に残して表示する
  const aircraft = options.aircraft.some((a) => a.id === plan.aircraftId)
    ? options.aircraft
    : [
        ...options.aircraft,
        {
          id: plan.aircraftId,
          registrationMark: plan.registrationMark,
          modelName: plan.modelName,
          status: "deregistered" as const,
          maxTakeoffWeightKg: plan.droneWeightG === null ? null : plan.droneWeightG / 1000,
        },
      ];
  return (
    <main className="flex flex-col gap-6" data-testid="plan-edit-screen">
      <PageHeader title="飛行計画の訂正" back={{ href: `/ops/plans/${plan.id}`, label: "飛行計画の詳細" }}>
        <Note>{PLAN_JUDGEMENT_DISCLAIMER}</Note>
        <DipsNotice />
      </PageHeader>
      <PlanForm
        key={plan.version}
        aircraft={aircraft}
        pilots={pilots}
        fixedPilotId={fixedPilotId}
        places={places}
        initial={initialFromPlan(plan)}
        editing={{ id: plan.id, version: plan.version }}
        permitHelper={permitHelper}
      />
    </main>
  );
}
