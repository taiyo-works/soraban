import { FlightForm, type FlightFromField, type FlightFromPlan } from "@/components/ops/records-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { isUuid, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { specificFlightTypesFromFlags } from "@/server/ops/plan-logic";
import { can } from "@/server/ops/authz";
import { getFieldView } from "@/server/ops/field";
import { journalPreInspectionId } from "@/server/ops/field-logic";
import { getPlan, getSnapshot } from "@/server/ops/plans";
import { recordCreateDenied, recordFormOptions } from "@/server/ops/record-page";

// 飛行記録の入力（Sprint 11 設計 E）。現場のスマートフォンで、離陸・着陸の時刻を「今」で入れる。
// ?aircraftId=…&inspectionId=… で、日常点検の詳細から機体と点検を候補に入れた状態で開く。
// ?planId=… で、飛行計画から作る（Sprint 12a 設計 G）：機体・操縦者・目的・場所・特定飛行の形態を引き継ぐ。離着陸の時刻は引き継がない。
// ?planId=…&takeoffEventId=… で、現場モードから作る（Sprint 12c 設計 G）：現場で押した実際の離着陸の時刻と、飛行前の日常点検を引き継ぐ。
// 計画の予定時刻は、どちらの場合も離着陸の時刻に入れない。
export default async function FlightNewPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ aircraftId?: string; inspectionId?: string; planId?: string; takeoffEventId?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const denied = recordCreateDenied(me);
  if (denied) return <Forbidden message={denied} />;
  const sp = await searchParams;
  const { aircraft, pilots, fixedPilotId } = await recordFormOptions(ctx, me);
  const aircraftId = sp.aircraftId && isUuid(sp.aircraftId) ? sp.aircraftId.toLowerCase() : undefined;
  const inspectionId = sp.inspectionId && isUuid(sp.inspectionId) ? sp.inspectionId.toLowerCase() : undefined;

  let fromPlan: FlightFromPlan | undefined;
  let fromField: FlightFromField | undefined;
  let planProblem: string | null = null;
  if (sp.planId) {
    try {
      const plan = await getPlan(ctx, sp.planId);
      const takeoffRef = sp.takeoffEventId && isUuid(sp.takeoffEventId) ? sp.takeoffEventId.toLowerCase() : null;
      if (plan.voided && takeoffRef === null) {
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
          // Sprint 15（X-3）：点検を計画に結び付けるのは現場の記録と同じ権限（運航管理者、または計画の操縦者本人）。
          // 権限が無ければ、日誌の画面の点検のリンクに planId を付けない（保存して初めて 403 を知る形にしない）
          canLinkInspection: can(ctx.member.role, "field.record", { isSelf: plan.isSelf }),
        };
        if (takeoffRef) {
          // 現場モードの離陸の行（ID か端末の識別子）から、実際の離着陸の時刻と飛行前の点検を引き継ぐ。まだ届いていなければ端末の送信待ちから取る。
          const view = await getFieldView(ctx, plan.id);
          const flight = view.flights.find((x) => x.takeoffEventId === takeoffRef || x.takeoffClientEventId === takeoffRef);
          fromField = {
            takeoffEventId: takeoffRef,
            takeoffAt: flight?.takeoffAt ?? null,
            landingAt: flight?.landingAt ?? null,
            // 着陸でラウンドが閉じるため、現在のラウンドではなく、この飛行のラウンドの点検を使う。着陸より後の点検（次の飛行の
            // ラウンドの点検）で代えない（Sprint 15 X-1）
            inspectionId: journalPreInspectionId(flight, view.items.find((x) => x.item === "inspection")?.inspectionId ?? null),
            // 離陸と着陸の両方の時刻が決まったときだけ「解決済み」。着陸がまだなら送信待ちから回復を試みる
            resolved: flight?.takeoffAt != null && flight.landingAt != null,
            takeoffRefs: [takeoffRef, flight?.takeoffEventId, flight?.takeoffClientEventId].filter((x): x is string => typeof x === "string"),
          };
        }
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
        <p className="text-xs leading-relaxed text-sb-ink-3">
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
        {...(fromField ? { fromField } : {})}
      />
    </main>
  );
}
