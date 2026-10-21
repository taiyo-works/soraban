import { FlightForm, type FlightFromPlan } from "@/components/ops/records-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { isUuid, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { specificFlightTypesFromFlags } from "@/server/ops/plan-logic";
import { getPlan, getSnapshot } from "@/server/ops/plans";
import { recordCreateDenied, recordFormOptions } from "@/server/ops/record-page";

// 飛行記録の入力（Sprint 11 設計 E）。現場のスマートフォンで、離陸・着陸の時刻を「今」で入れる。
// ?aircraftId=…&inspectionId=… で、日常点検の詳細から機体と点検を候補に入れた状態で開く。
// ?planId=… で、飛行計画から作る（Sprint 12a 設計 G）：機体・操縦者・目的・場所・特定飛行の形態を引き継ぐ。離着陸の時刻は引き継がない。
export default async function FlightNewPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ aircraftId?: string; inspectionId?: string; planId?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const denied = recordCreateDenied(me);
  if (denied) return <Forbidden message={denied} />;
  const sp = await searchParams;
  const { aircraft, pilots, fixedPilotId } = await recordFormOptions(ctx, me);
  const aircraftId = sp.aircraftId && isUuid(sp.aircraftId) ? sp.aircraftId.toLowerCase() : undefined;
  const inspectionId = sp.inspectionId && isUuid(sp.inspectionId) ? sp.inspectionId.toLowerCase() : undefined;

  let fromPlan: FlightFromPlan | undefined;
  let planProblem: string | null = null;
  if (sp.planId) {
    try {
      const plan = await getPlan(ctx, sp.planId);
      if (plan.voided) {
        planProblem = "中止した計画からは飛行記録を作れません。";
      } else {
        const snapshot = await getSnapshot(ctx, plan.id, plan.currentSnapshotId);
        const flags = (snapshot.result as { flags?: readonly string[] }).flags ?? [];
        fromPlan = {
          planId: plan.id,
          title: plan.title,
          aircraftId: plan.aircraftId,
          pilotId: plan.pilotId,
          purpose: plan.purpose,
          placeName: plan.placeName,
          lat: plan.latitude,
          lng: plan.longitude,
          specificFlightTypes: specificFlightTypesFromFlags(flags),
        };
      }
    } catch (e) {
      if (!(e instanceof OpsError && e.status === 404)) throw e;
      planProblem = "指定された飛行計画が見つかりません。";
    }
  }
  if (planProblem) return <Forbidden message={planProblem} />;
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="飛行記録の入力" back={{ href: "/ops/flights", label: "飛行記録の一覧" }}>
        <p className="text-xs leading-relaxed text-ink-mute">
          1 回の飛行（電源を入れて離陸し、着陸して電源を切るまで）を 1 件として入力します。飛行時間は離陸・着陸の時刻から自動で求めます。
        </p>
      </PageHeader>
      <FlightForm
        aircraft={aircraft}
        pilots={pilots}
        fixedPilotId={fixedPilotId}
        memberId={me.member.id}
        initialAircraftId={aircraftId}
        initialInspectionId={inspectionId}
        {...(fromPlan ? { fromPlan } : {})}
      />
    </main>
  );
}
