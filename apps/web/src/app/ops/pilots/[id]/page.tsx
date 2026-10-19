import { notFound } from "next/navigation";
import { PilotForm, VoidForm } from "@/components/ops/ops-client";
import { VersionList } from "@/components/ops/versions";
import { getPilot, listMembers, listPilotVersions, OpsError } from "@/server/ops/service";
import { LICENSE_CLASS_LABELS, requireOpsMember, ROLE_LABELS } from "@/server/ops/page";

// 操縦者の詳細。技能証明書番号の全桁は運航管理者と本人にだけ示す（API の応答そのものから除く）。
export default async function PilotDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let p;
  try {
    p = await getPilot(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listPilotVersions(ctx, id);
  const manager = me.member.role === "manager";
  const canEdit = !p.voided && (manager || (me.member.role === "pilot" && p.isSelf));
  const members = manager ? await listMembers(ctx) : [];
  const limits = [
    p.limitationType ? "種類" : null,
    p.limitationWeight ? "重量" : null,
    p.limitationDaytime ? "昼間" : null,
    p.limitationVlos ? "目視内" : null,
  ].filter(Boolean);
  const rows: [string, string][] = [
    ["氏名", p.fullName],
    ["技能証明", p.hasLicense && p.licenseClass ? `${LICENSE_CLASS_LABELS[p.licenseClass]}` : "なし"],
    ["技能証明書番号", p.licenseNumber ?? "—"],
    ["有効期限", p.licenseExpiresOn ?? "—"],
    ["限定事項", limits.length > 0 ? limits.join("・") : "なし"],
  ];
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-lg text-ink">
        操縦者 {p.fullName}
        {p.voided ? <span className="ml-2 text-sm text-signal-red">取消済み</span> : null}
      </h1>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="pilot-detail">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-mute">{k}</dt>
            <dd className="break-all text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {canEdit ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base text-ink">訂正</h2>
          <PilotForm
            key={p.version}
            initial={p}
            memberOptions={
              manager ? members.map((m) => ({ id: m.id, label: `${m.displayName}（${ROLE_LABELS[m.role]}）` })) : undefined
            }
          />
        </section>
      ) : null}
      {manager && !p.voided ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base text-ink">取消</h2>
          <VoidForm url={`/api/ops/pilots/${p.id}/void`} version={p.version} label="この操縦者" />
        </section>
      ) : null}
      <VersionList versions={versions} />
    </main>
  );
}
