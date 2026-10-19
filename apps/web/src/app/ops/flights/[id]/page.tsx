import { notFound } from "next/navigation";
import { VoidForm } from "@/components/ops/ops-client";
import { FlightForm } from "@/components/ops/records-client";
import { VersionList } from "@/components/ops/versions";
import { Badge, DetailList, LicenseNumber, Note, PageHeader, Section } from "@/components/ops/ui";
import { formatHm } from "@/lib/ops-time";
import { SPECIFIC_FLIGHT_TYPE_LABELS } from "@/lib/ops-records";
import { getFlight, listFlightVersions } from "@/server/ops/records";
import { OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { canCorrectRecord, recordFormOptions } from "@/server/ops/record-page";

// 飛行記録の詳細（全項目・訂正・取消・版の一覧）。取消済みでも詳細と版の一覧は残る。
export default async function FlightDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let f;
  try {
    f = await getFlight(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listFlightVersions(ctx, id);
  const manager = me.member.role === "manager";
  const correctable = !f.voided && canCorrectRecord(me, f.isSelf);
  const options = correctable ? await recordFormOptions(ctx, me) : null;
  const coord = (lat: number | null, lng: number | null, acc: number | null) =>
    lat === null || lng === null ? null : (
      <span className="block font-mono text-xs text-ink-soft tnum">
        {lat}, {lng}（WGS84）{acc !== null ? `／精度 約 ${acc} m` : ""}
      </span>
    );
  const rows: [string, React.ReactNode][] = [
    ["飛行年月日", <span key="d" className="font-mono tnum" data-testid="flight-date">{f.flightDate}</span>],
    ["機体（登録記号）", <span key="a" className="font-mono">{f.registrationMark}</span>],
    [
      "操縦者",
      <span key="p" className="flex flex-col">
        <span data-testid="flight-pilot-name">{f.pilotName}</span>
        {f.pilotLicenseNumber ? (
          <span className="text-xs text-ink-soft">
            技能証明書番号：<LicenseNumber value={f.pilotLicenseNumber} data-testid="flight-license" />
          </span>
        ) : (
          <span className="text-xs text-ink-mute">技能証明なし</span>
        )}
        <span className="text-xs text-ink-mute">（記録した時点の内容）</span>
      </span>,
    ],
    ["飛行の目的", f.purpose],
    ["経由地", f.waypoints ?? "—"],
    [
      "特定飛行の形態",
      f.specificFlightTypes.length === 0 ? "該当なし" : f.specificFlightTypes.map((t) => SPECIFIC_FLIGHT_TYPE_LABELS[t] ?? t).join("、"),
    ],
    [
      "離陸",
      <span key="t" className="flex flex-col">
        <span className="font-mono tnum" data-testid="flight-takeoff">{f.takeoffAtJst.slice(11)}</span>
        <span>{f.takeoffPlace}</span>
        {coord(f.takeoffLat, f.takeoffLng, f.takeoffAccuracyM)}
      </span>,
    ],
    [
      "着陸",
      <span key="l" className="flex flex-col">
        <span className="font-mono tnum" data-testid="flight-landing">{f.landingAtJst}</span>
        <span>{f.landingPlace}</span>
        {coord(f.landingLat, f.landingLng, f.landingAccuracyM)}
      </span>,
    ],
    ["飛行時間", <span key="m" className="font-mono tnum" data-testid="flight-minutes-detail">{formatHm(f.flightMinutes)}</span>],
    [
      "総飛行時間（機体）",
      f.totalFlightMinutes === null ? (
        <Badge key="tt" tone="mute" data-testid="flight-total">取消済み（数えない）</Badge>
      ) : (
        <span key="tt" className="font-mono tnum" data-testid="flight-total">{formatHm(f.totalFlightMinutes)}</span>
      ),
    ],
    ["飛行の安全に影響のあった事項", f.safetyIssue ? <span key="s">あり：{f.safetyIssueDetail}</span> : "なし"],
    [
      "不具合（記事）",
      f.defects.length === 0 ? (
        "なし"
      ) : (
        <ul key="df" className="flex flex-col gap-2">
          {f.defects.map((d, i) => (
            <li key={i} className="flex flex-col border-l-2 border-rule pl-2">
              <span>
                <span className="font-mono text-xs tnum text-ink-mute">{d.occurredOn}</span> {d.description}
              </span>
              <span className="text-xs text-ink-soft">
                処置：{d.actionOn ?? "—"} {d.action ?? ""}／確認者：{d.confirmerName ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      ),
    ],
    ["日常点検", f.dailyInspectionId ? <a key="i" href={`/ops/inspections/${f.dailyInspectionId}`} className="text-brand-700 underline underline-offset-2">紐付けた点検を見る</a> : "紐付けなし"],
  ];
  return (
    <main className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="飛行記録の詳細"
          back={{ href: "/ops/flights", label: "飛行記録の一覧" }}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="break-all">
                {f.flightDate} {f.registrationMark}
              </span>
              {f.voided ? <Badge tone="red">取消済み</Badge> : null}
            </span>
          }
        />
        {f.voided ? (
          <Note tone="red">この飛行記録は取り消されています。総飛行時間には数えません。記載内容と版の一覧は残しています。</Note>
        ) : correctable ? null : (
          <Note>訂正は運航管理者と、記録の操縦者本人だけが行えます。</Note>
        )}
        <DetailList rows={rows} data-testid="flight-detail" />
      </div>
      {correctable && options ? (
        <Section title="訂正" description="記載の誤りを直します。訂正前の内容は版として残ります。">
          <details className="group">
            <summary className="cursor-pointer text-sm text-brand-700 underline underline-offset-2">訂正の入力を開く</summary>
            <div className="pt-4">
              <FlightForm key={f.version} aircraft={options.aircraft} pilots={options.pilots} fixedPilotId={options.fixedPilotId} editing={f} />
            </div>
          </details>
        </Section>
      ) : null}
      <VersionList versions={versions} />
      {manager && !f.voided ? (
        <Section
          title="取消"
          tone="danger"
          description="誤って入力した飛行記録を取り消します。削除ではありません。取り消した記録は総飛行時間に数えなくなり、記載内容と版の一覧は残ります。"
        >
          <VoidForm url={`/api/ops/flights/${f.id}/void`} version={f.version} label="この飛行記録" />
        </Section>
      ) : null}
    </main>
  );
}
