import { InspectionForm } from "@/components/ops/records-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { DISCLAIMER_INSPECTION } from "@/lib/disclaimers";
import { safeReturnTo } from "@/lib/ops-return";
import { getPlan } from "@/server/ops/plans";
import { isUuid, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied, recordFormOptions } from "@/server/ops/record-page";

// 日常点検の入力（Sprint 11 設計 E、様式2 の 9 項目）。
// ?planId=…&returnTo=… で、現場モードから来たとき（Sprint 12c）：計画の機体・操縦者を引き継ぎ、保存後に returnTo（/ops/ 配下の同一オリジンのパスだけ）へ戻る。
// ?takeoffAt=YYYY-MM-DDTHH:MM で、日誌の入力から来たとき（Sprint 15 X-1）：飛行前の点検の実施日時がその飛行の離陸より後なら知らせる。
export default async function InspectionNewPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ aircraftId?: string; planId?: string; returnTo?: string; timing?: string; takeoffAt?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const denied = recordCreateDenied(me);
  if (denied) return <Forbidden message={denied} />;
  const sp = await searchParams;
  const { aircraft, pilots, fixedPilotId } = await recordFormOptions(ctx, me);
  let aircraftId = sp.aircraftId && isUuid(sp.aircraftId) ? sp.aircraftId.toLowerCase() : undefined;
  let pilotId: string | undefined;
  let planId: string | undefined;
  if (sp.planId && isUuid(sp.planId)) {
    try {
      const plan = await getPlan(ctx, sp.planId);
      aircraftId = plan.aircraftId;
      pilotId = plan.pilotId;
      planId = plan.id;
    } catch (e) {
      if (!(e instanceof OpsError && e.status === 404)) throw e;
    }
  }
  const returnTo = safeReturnTo(sp.returnTo);
  const initialTiming = sp.timing === "post_flight" ? ("post_flight" as const) : undefined;
  const flightTakeoffAt = typeof sp.takeoffAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(sp.takeoffAt) ? sp.takeoffAt : undefined;
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="日常点検の入力" back={{ href: "/ops/inspections", label: "点検の一覧" }}>
        <p className="text-sb-ink-3">飛行の前（または後）に行った日常点検の結果を入力します。</p>
        {/* 点検の免責（Sprint 18-3）。入力の先頭 */}
        <p className="text-base leading-relaxed text-sb-ink" data-testid="inspection-disclaimer">{DISCLAIMER_INSPECTION}</p>
      </PageHeader>
      <InspectionForm aircraft={aircraft} pilots={pilots} fixedPilotId={fixedPilotId} memberId={me.member.id} initialAircraftId={aircraftId} {...(pilotId ? { initialPilotId: pilotId } : {})} {...(initialTiming ? { initialTiming } : {})} {...(returnTo ? { returnTo } : {})} {...(planId ? { planId } : {})} {...(flightTakeoffAt ? { flightTakeoffAt } : {})} />
    </main>
  );
}
