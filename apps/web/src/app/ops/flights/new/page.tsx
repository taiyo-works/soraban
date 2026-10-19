import { FlightForm } from "@/components/ops/records-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { isUuid } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied, recordFormOptions } from "@/server/ops/record-page";

// 飛行記録の入力（Sprint 11 設計 E）。現場のスマートフォンで、離陸・着陸の時刻を「今」で入れる。
// ?aircraftId=…&inspectionId=… で、日常点検の詳細から機体と点検を候補に入れた状態で開く。
export default async function FlightNewPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ aircraftId?: string; inspectionId?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const denied = recordCreateDenied(me);
  if (denied) return <Forbidden message={denied} />;
  const sp = await searchParams;
  const { aircraft, pilots, fixedPilotId } = await recordFormOptions(ctx, me);
  const aircraftId = sp.aircraftId && isUuid(sp.aircraftId) ? sp.aircraftId.toLowerCase() : undefined;
  const inspectionId = sp.inspectionId && isUuid(sp.inspectionId) ? sp.inspectionId.toLowerCase() : undefined;
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
      />
    </main>
  );
}
