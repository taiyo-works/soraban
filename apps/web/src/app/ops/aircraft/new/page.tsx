import { AircraftForm } from "@/components/ops/ops-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { requireOpsMember } from "@/server/ops/page";

export default async function AircraftNewPage() {
  const { me } = await requireOpsMember();
  if (me.member.role !== "manager") return <Forbidden />;
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="機体の登録" back={{ href: "/ops/aircraft", label: "機体の一覧" }}>
        <p className="text-xs leading-relaxed text-sb-ink-3">
          「必須」の項目を入力してください。登録した内容は、あとから理由を添えて訂正できます。
        </p>
      </PageHeader>
      <AircraftForm />
    </main>
  );
}
