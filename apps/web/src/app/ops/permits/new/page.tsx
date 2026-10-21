import { PermitForm } from "@/components/ops/permits-client";
import { PermitDeclaration } from "@/components/ops/permit-ui";
import { PageHeader } from "@/components/ops/ui";
import { Forbidden } from "@/components/ops/versions";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";
import { PERMIT_DECLARATION_NOTE, PERMIT_FORMAT_UNVERIFIED_NOTE, PERMIT_KIND_LABEL, PERMIT_KINDS, PERMIT_NO_DIPS_NOTE } from "@/server/ops/permit-logic";
import { permitFormOptions } from "@/server/ops/permit-page";

// 許可・承認の登録（運航管理者だけ）。許可・承認の結果は、利用者が DIPS 等で得たものを手で登録する（DIPS には接続しない）。
export default async function PermitNewPage() {
  const { ctx, me } = await requireOpsMember();
  if (!can(me.member.role, "permit.create")) return <Forbidden />;
  const { aircraft, pilots } = await permitFormOptions(ctx);
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="許可・承認の登録" back={{ href: "/ops/permits", label: "許可・承認の一覧" }}>
        <PermitDeclaration declaration={PERMIT_DECLARATION_NOTE} noDipsNote={PERMIT_NO_DIPS_NOTE} />
        <p className="text-xs leading-relaxed text-ink-mute">{PERMIT_FORMAT_UNVERIFIED_NOTE}</p>
      </PageHeader>
      <PermitForm
        kindChoices={PERMIT_KINDS.map((k) => ({ value: k, label: PERMIT_KIND_LABEL[k] }))}
        aircraftOptions={aircraft}
        pilotOptions={pilots}
      />
    </main>
  );
}
