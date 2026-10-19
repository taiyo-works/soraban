import Link from "next/link";
import { listAircraft } from "@/server/ops/service";
import { AIRCRAFT_STATUS_LABELS, requireOpsMember } from "@/server/ops/page";

// 機体の一覧（?includeVoided=1 で取消済みを含める）。
export default async function AircraftListPage({ searchParams }: { readonly searchParams: Promise<{ includeVoided?: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const includeVoided = (await searchParams).includeVoided === "1";
  const rows = await listAircraft(ctx, includeVoided);
  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg text-ink">機体</h1>
        {me.member.role === "manager" ? (
          <Link href="/ops/aircraft/new" className="border border-indigo-700 bg-indigo-700 px-4 py-2 text-sm text-paper">
            機体を登録
          </Link>
        ) : null}
      </div>
      <Link href={includeVoided ? "/ops/aircraft" : "/ops/aircraft?includeVoided=1"} className="text-sm text-indigo-700 underline">
        {includeVoided ? "取消済みを隠す" : "取消済みを含める"}
      </Link>
      {rows.length === 0 ? <p className="text-sm text-ink-mute">登録された機体はありません。</p> : null}
      <ul className="flex flex-col gap-2" data-testid="aircraft-list">
        {rows.map((a) => (
          <li key={a.id}>
            <Link href={`/ops/aircraft/${a.id}`} className="flex flex-col gap-0.5 border border-rule px-3 py-2 text-sm">
              <span className="break-all text-ink">{a.registrationMark}</span>
              <span className="text-ink-soft">
                {a.modelName}（{a.manufacturer}）・{AIRCRAFT_STATUS_LABELS[a.status]}
                {a.voided ? "・取消済み" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
