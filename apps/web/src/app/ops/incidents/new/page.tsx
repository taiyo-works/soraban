import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { IncidentForm } from "@/components/ops/incident-client";
import { IncidentFactNotice, IncidentSafetyFirst } from "@/components/ops/incident-ui";
import { PageHeader } from "@/components/ops/ui";
import { can } from "@/server/ops/authz";
import { incidentFormOptions, newIncidentInitial } from "@/server/ops/incident-page";
import { requireOpsMember } from "@/server/ops/page";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 事故・ヒヤリハットの記録（事務所。Sprint 12e 設計 E）。最上部に G1（最初の案内）、そのあとに N1 と入力欄。
// ?planId・?flightRecordId・?summary（日誌の「安全に影響のあった事項」から）は、画面側で初期値に入れるだけ（記録は保存するまで作らない）。
export default async function IncidentNewPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ planId?: string; flightRecordId?: string; summary?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const sp = await searchParams;
  const planId = sp.planId && UUID.test(sp.planId) ? sp.planId.toLowerCase() : null;
  const flightRecordId = sp.flightRecordId && UUID.test(sp.flightRecordId) ? sp.flightRecordId.toLowerCase() : null;
  const canCreate = can(me.member.role, "incident.create");
  const opts = canCreate ? await incidentFormOptions(ctx, planId) : null;
  return (
    <main className="flex flex-col gap-6" data-testid="incident-new-page">
      {/* G1：入力欄より前（画面の上でも DOM の順でも）。読まずに入力を進めても妨げない */}
      <IncidentSafetyFirst />
      <DraftOwnerGuard memberId={me.member.id} />
      <PageHeader title="事故・ヒヤリハットの記録" back={{ href: "/ops/incidents", label: "事故・ヒヤリハットの一覧" }}>
        <IncidentFactNotice />
      </PageHeader>
      {opts ? (
        <IncidentForm
          mode="create"
          initial={newIncidentInitial(ctx, { planId, flightRecordId, summary: sp.summary ?? null })}
          plans={opts.plans}
          aircraft={opts.aircraft}
          pilots={opts.pilots}
        />
      ) : (
        <p className="opx-note" data-testid="incident-new-forbidden">
          閲覧者は記録できません。運航管理者または操縦者に記録を依頼してください。
        </p>
      )}
    </main>
  );
}
