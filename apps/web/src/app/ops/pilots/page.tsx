import Link from "next/link";
import { listPilots } from "@/server/ops/service";
import { LICENSE_CLASS_LABELS, requireOpsMember } from "@/server/ops/page";

// 操縦者の一覧。技能証明書番号は常に末尾 4 桁以外を伏せる。
export default async function PilotListPage({ searchParams }: { readonly searchParams: Promise<{ includeVoided?: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const includeVoided = (await searchParams).includeVoided === "1";
  const rows = await listPilots(ctx, includeVoided);
  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg text-ink">操縦者</h1>
        {me.member.role === "manager" ? (
          <Link href="/ops/pilots/new" className="border border-indigo-700 bg-indigo-700 px-4 py-2 text-sm text-paper">
            操縦者を登録
          </Link>
        ) : null}
      </div>
      <Link href={includeVoided ? "/ops/pilots" : "/ops/pilots?includeVoided=1"} className="text-sm text-indigo-700 underline">
        {includeVoided ? "取消済みを隠す" : "取消済みを含める"}
      </Link>
      {rows.length === 0 ? <p className="text-sm text-ink-mute">登録された操縦者はいません。</p> : null}
      <ul className="flex flex-col gap-2" data-testid="pilot-list">
        {rows.map((p) => (
          <li key={p.id}>
            <Link href={`/ops/pilots/${p.id}`} className="flex flex-col gap-0.5 border border-rule px-3 py-2 text-sm">
              <span className="text-ink">{p.fullName}</span>
              <span className="break-all text-ink-soft">
                {p.hasLicense && p.licenseClass ? `${LICENSE_CLASS_LABELS[p.licenseClass]}・${p.licenseNumber}` : "技能証明なし"}
                {p.voided ? "・取消済み" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
