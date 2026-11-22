import { PilotForm } from "@/components/ops/ops-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { listMembers } from "@/server/ops/service";
import { requireOpsMember, ROLE_LABELS } from "@/server/ops/page";

export default async function PilotNewPage() {
  const { ctx, me } = await requireOpsMember();
  if (me.member.role !== "manager") return <Forbidden />;
  const members = await listMembers(ctx);
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="操縦者の登録" back={{ href: "/ops/pilots", label: "操縦者の一覧" }}>
        <p className="text-sm leading-relaxed text-sb-ink-3">
          「必須」の項目を入力してください。登録した内容は、あとから理由を添えて訂正できます。
        </p>
      </PageHeader>
      <PilotForm memberOptions={members.map((m) => ({ id: m.id, label: `${m.displayName}（${ROLE_LABELS[m.role]}）` }))} />
    </main>
  );
}
