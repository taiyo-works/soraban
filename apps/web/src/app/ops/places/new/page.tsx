import { PlaceForm } from "@/components/ops/plans-client";
import { Forbidden } from "@/components/ops/versions";
import { PageHeader } from "@/components/ops/ui";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";

// よく使う地点の登録（運航管理者のみ）。
export default async function PlaceNewPage() {
  const { me } = await requireOpsMember();
  if (!can(me.member.role, "place.create")) return <Forbidden />;
  return (
    <main className="flex max-w-xl flex-col gap-6">
      <PageHeader title="よく使う地点の登録" back={{ href: "/ops/places", label: "よく使う地点" }} />
      <PlaceForm />
    </main>
  );
}
