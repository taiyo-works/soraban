import { InspectionForm } from "@/components/ops/records-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { safeReturnTo } from "@/lib/ops-return";
import { getPlan } from "@/server/ops/plans";
import { isUuid, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied, recordFormOptions } from "@/server/ops/record-page";

// 日常点検の入力（Sprint 11 設計 E、様式2 の 9 項目）。
// ?planId=…&returnTo=… で、現場モードから来たとき（Sprint 12c）：計画の機体・操縦者を引き継ぎ、保存後に returnTo（/ops/ 配下の同一オリジンのパスだけ）へ戻る。
export default async function InspectionNewPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ aircraftId?: string; planId?: string; returnTo?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const denied = recordCreateDenied(me);
  if (denied) return <Forbidden message={denied} />;
  const sp = await searchParams;
  const { aircraft, pilots, fixedPilotId } = await recordFormOptions(ctx, me);
  let aircraftId = sp.aircraftId && isUuid(sp.aircraftId) ? sp.aircraftId.toLowerCase() : undefined;
  let pilotId: string | undefined;
  if (sp.planId && isUuid(sp.planId)) {
    try {
      const plan = await getPlan(ctx, sp.planId);
      aircraftId = plan.aircraftId;
      pilotId = plan.pilotId;
    } catch (e) {
      if (!(e instanceof OpsError && e.status === 404)) throw e;
    }
  }
  const returnTo = safeReturnTo(sp.returnTo);
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="日常点検の入力" back={{ href: "/ops/inspections", label: "点検の一覧" }}>
        <p className="text-xs leading-relaxed text-sb-ink-3">飛行の前（または後）に行った日常点検の結果を入力します。</p>
      </PageHeader>
      <InspectionForm aircraft={aircraft} pilots={pilots} fixedPilotId={fixedPilotId} memberId={me.member.id} initialAircraftId={aircraftId} {...(pilotId ? { initialPilotId: pilotId } : {})} {...(returnTo ? { returnTo } : {})} />
    </main>
  );
}
