import { PilotForm } from "@/components/ops/ops-client";
import { Forbidden } from "@/components/ops/versions";
import { listMembers } from "@/server/ops/service";
import { requireOpsMember, ROLE_LABELS } from "@/server/ops/page";

export default async function PilotNewPage() {
  const { ctx, me } = await requireOpsMember();
  if (me.member.role !== "manager") return <Forbidden />;
  const members = await listMembers(ctx);
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-lg text-ink">操縦者の登録</h1>
      <PilotForm memberOptions={members.map((m) => ({ id: m.id, label: `${m.displayName}（${ROLE_LABELS[m.role]}）` }))} />
    </main>
  );
}
