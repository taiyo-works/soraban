import { AircraftForm } from "@/components/ops/ops-client";
import { Forbidden } from "@/components/ops/versions";
import { requireOpsMember } from "@/server/ops/page";

export default async function AircraftNewPage() {
  const { me } = await requireOpsMember();
  if (me.member.role !== "manager") return <Forbidden />;
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-lg text-ink">機体の登録</h1>
      <AircraftForm />
    </main>
  );
}
