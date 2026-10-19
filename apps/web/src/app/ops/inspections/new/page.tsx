import { InspectionForm } from "@/components/ops/records-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { isUuid } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied, recordFormOptions } from "@/server/ops/record-page";

// 日常点検の入力（Sprint 11 設計 E、様式2 の 9 項目）。
export default async function InspectionNewPage({ searchParams }: { readonly searchParams: Promise<{ aircraftId?: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const denied = recordCreateDenied(me);
  if (denied) return <Forbidden message={denied} />;
  const sp = await searchParams;
  const { aircraft, pilots, fixedPilotId } = await recordFormOptions(ctx, me);
  const aircraftId = sp.aircraftId && isUuid(sp.aircraftId) ? sp.aircraftId.toLowerCase() : undefined;
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="日常点検の入力" back={{ href: "/ops/inspections", label: "日常点検の一覧" }}>
        <p className="text-xs leading-relaxed text-ink-mute">飛行の前（または後）に行った日常点検の結果を入力します。</p>
      </PageHeader>
      <InspectionForm aircraft={aircraft} pilots={pilots} fixedPilotId={fixedPilotId} memberId={me.member.id} initialAircraftId={aircraftId} />
    </main>
  );
}
