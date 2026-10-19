import { notFound } from "next/navigation";
import { AircraftForm, VoidForm } from "@/components/ops/ops-client";
import { VersionList } from "@/components/ops/versions";
import { getAircraft, listAircraftVersions, OpsError } from "@/server/ops/service";
import { AIRCRAFT_STATUS_LABELS, CERT_CLASS_LABELS, formatMinutes, requireOpsMember } from "@/server/ops/page";

// 機体の詳細（訂正・取消・版の一覧）。取消済みでも詳細と版の一覧は残る。
export default async function AircraftDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let a;
  try {
    a = await getAircraft(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listAircraftVersions(ctx, id);
  const manager = me.member.role === "manager";
  const rows: [string, string][] = [
    ["登録記号", a.registrationMark],
    ["型式名", a.modelName],
    ["設計製造者", a.manufacturer],
    ["製造番号", a.serialNumber],
    ["型式認証", a.typeCertified ? `あり（${a.typeCertCategory}・${a.typeCertModel}・${a.typeCertNumber}）` : "なし"],
    ["機体認証", a.airworthinessClass ? `${CERT_CLASS_LABELS[a.airworthinessClass]}（${a.airworthinessCertNumber}）` : "なし"],
    ["最大離陸重量", a.maxTakeoffWeightKg === null ? "—" : `${a.maxTakeoffWeightKg} kg`],
    ["使用開始時の既存の総飛行時間", formatMinutes(a.initialFlightMinutes)],
    ["状態", AIRCRAFT_STATUS_LABELS[a.status]],
  ];
  return (
    <main className="flex flex-col gap-6">
      <h1 className="break-all text-lg text-ink">
        機体 {a.registrationMark}
        {a.voided ? <span className="ml-2 text-sm text-signal-red">取消済み</span> : null}
      </h1>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="aircraft-detail">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-mute">{k}</dt>
            <dd className="break-all text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {manager && !a.voided ? (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-base text-ink">訂正</h2>
            <AircraftForm key={a.version} initial={a} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-base text-ink">取消</h2>
            <VoidForm url={`/api/ops/aircraft/${a.id}/void`} version={a.version} label="この機体" />
          </section>
        </>
      ) : null}
      <VersionList versions={versions} />
    </main>
  );
}
