import { notFound } from "next/navigation";
import { LinkedIncidentsSection } from "@/components/ops/incident-ui";
import { VoidForm } from "@/components/ops/ops-client";
import { FlightForm } from "@/components/ops/records-client";
import { VersionList } from "@/components/ops/versions";
import { Badge, buttonGhostClass, buttonOutlineBrandClass, DetailList, LicenseNumber, Note, PageHeader, Section } from "@/components/ops/ui";
import { formatHm } from "@/lib/ops-time";
import { SPECIFIC_FLIGHT_TYPE_LABELS } from "@/lib/ops-records";
import { JudgementMissing } from "@/components/ops/plan-ui";
import { MismatchBadges, TakeoffGaps } from "@/components/ops/journal-ui";
import { fieldHref } from "@/lib/ops-field";
import { listFlightIncidents } from "@/server/ops/incidents";
import { getFlight, JUDGEMENT_LINK_MISSING_LABEL, listFlightVersions } from "@/server/ops/records";
import { OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { canCorrectRecord, recordFormOptions } from "@/server/ops/record-page";

/** 訂正の入力を開閉する見出し（ボタンと同じ押しやすさにする）。 */
const CORRECT_SUMMARY = `${buttonGhostClass} cursor-pointer list-none gap-2 self-start [&::-webkit-details-marker]:hidden`;

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
  const [versions, flightIncidents] = await Promise.all([listFlightVersions(ctx, id), listFlightIncidents(ctx, id)]);
  const manager = me.member.role === "manager";
  const correctable = !f.voided && canCorrectRecord(me, f.isSelf);
  const options = correctable ? await recordFormOptions(ctx, me) : null;
  const coord = (lat: number | null, lng: number | null, acc: number | null) =>
    lat === null || lng === null ? null : (
      <span className="block sb-num text-sm text-sb-ink-2 tnum">
        {lat}, {lng}（WGS84）{acc !== null ? `／精度 約 ${acc} m` : ""}
      </span>
    );
  const rows: [string, React.ReactNode][] = [
    ["機体（登録記号）", <span key="a" className="sb-num">{f.registrationMark}</span>],
    [
      "操縦者",
      <span key="p" className="flex flex-col">
        <span data-testid="flight-pilot-name">{f.pilotName}</span>
        {f.pilotLicenseNumber ? (
          <span className="text-sm text-sb-ink-2">
            技能証明書番号：<LicenseNumber value={f.pilotLicenseNumber} data-testid="flight-license" />
          </span>
        ) : (
          <span className="text-sm text-sb-ink-3">技能証明なし</span>
        )}
        <span className="text-sm text-sb-ink-3">（記録した時点の内容）</span>
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
        <span className="sb-num tnum">{f.takeoffAtJst.slice(11)}</span>
        <span>{f.takeoffPlace}</span>
        {coord(f.takeoffLat, f.takeoffLng, f.takeoffAccuracyM)}
      </span>,
    ],
    [
      "着陸",
      <span key="l" className="flex flex-col">
        <span className="sb-num tnum">{f.landingAtJst}</span>
        <span>{f.landingPlace}</span>
        {coord(f.landingLat, f.landingLng, f.landingAccuracyM)}
      </span>,
    ],
    [
      "飛行の安全に影響のあった事項",
      f.safetyIssue ? (
        <span key="s" className="flex flex-col items-start gap-1">
          <Badge tone="amber">あり</Badge>
          <span>{f.safetyIssueDetail}</span>
        </span>
      ) : (
        "なし"
      ),
    ],
    [
      "不具合（記事）",
      f.defects.length === 0 ? (
        "なし"
      ) : (
        <ul key="df" className="flex flex-col gap-2">
          {f.defects.map((d, i) => (
            <li key={i} className="flex flex-col gap-0.5 border-l-2 border-sb-rule pl-2">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="sb-num text-sm tnum text-sb-ink-3">{d.occurredOn}</span>
                <span>{d.description}</span>
                {d.actionOn === null && d.action === null ? <Badge tone="neutral">処置は未記載</Badge> : null}
              </span>
              <span className="text-sm text-sb-ink-2">
                処置：{d.actionOn ?? "—"} {d.action ?? ""}／確認者：{d.confirmerName ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      ),
    ],
    [
      "飛行計画・判定の根拠",
      f.flightPlanId ? (
        <span key="pl" className="flex flex-col items-start gap-2" data-testid="flight-plan-link-box">
          <a href={`/ops/plans/${f.flightPlanId}`} className={buttonOutlineBrandClass} data-testid="flight-plan-link">
            飛行計画を見る
          </a>
          {f.snapshotId ? (
            <a
              href={`/ops/plans/${f.flightPlanId}/snapshots/${f.snapshotId}`}
              className={buttonOutlineBrandClass}
              data-testid="flight-basis-link"
            >
              判定の根拠を見る（証跡 ID・エンジンの版・データセットの版）
            </a>
          ) : null}
        </span>
      ) : f.judgementLink === "missing" ? (
        <JudgementMissing key="pm" testId="flight-judgement-missing" label={JUDGEMENT_LINK_MISSING_LABEL} />
      ) : (
        "計画なし（特定飛行の形態なし）"
      ),
    ],
    ...(f.mismatches.length > 0
      ? ([["計画との食い違い", <MismatchBadges key="mm" mismatches={f.mismatches} />]] as [string, React.ReactNode][])
      : []),
    ...(f.takeoffEventId
      ? ([
          [
            "離陸時の未了事項（現場モードの記録）",
            <span key="tg" className="flex flex-col items-start gap-2" data-testid="flight-takeoff-gaps-box">
              <TakeoffGaps gaps={f.takeoffGaps} />
              {f.flightPlanId ? (
                <a href={fieldHref(f.flightPlanId)} className={buttonOutlineBrandClass} data-testid="flight-field-link">
                  現場モードを開く
                </a>
              ) : null}
            </span>,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ["日常点検", f.dailyInspectionId ? <a key="i" href={`/ops/inspections/${f.dailyInspectionId}`} className="-my-2 inline-flex min-h-12 items-center text-sb-ink underline underline-offset-2">紐付けた点検を見る</a> : "紐付けなし"],
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
        <dl
          aria-label="飛行の要点"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-sb-m border border-sb-rule bg-sb-rule sm:grid-cols-5"
        >
          {(
            [
              ["飛行年月日", <span key="d" data-testid="flight-date">{f.flightDate}</span>, "col-span-2 sm:col-span-1"],
              ["離陸", <span key="t" data-testid="flight-takeoff">{f.takeoffAtJst.slice(11)}</span>, ""],
              ["着陸", <span key="l" data-testid="flight-landing">{f.landingAtJst}</span>, ""],
              ["飛行時間", <span key="m" data-testid="flight-minutes-detail">{formatHm(f.flightMinutes)}</span>, ""],
              [
                "総飛行時間（機体）",
                f.totalFlightMinutes === null ? (
                  <Badge key="tt" tone="mute" data-testid="flight-total">取消済み（数えない）</Badge>
                ) : (
                  <span key="tt" data-testid="flight-total">{formatHm(f.totalFlightMinutes)}</span>
                ),
                "",
              ],
            ] as const
          ).map(([k, val, cls]) => (
            <div key={k} className={`flex flex-col gap-1 bg-sb-base px-3 py-2.5 ${cls}`}>
              <dt className="text-sm text-sb-ink-3">{k}</dt>
              <dd className="sb-num text-lg leading-tight tnum text-sb-ink">{val}</dd>
            </div>
          ))}
        </dl>
        <DetailList rows={rows} data-testid="flight-detail" />
      </div>
      {correctable && options ? (
        <Section title="訂正" description="記載の誤りを直します。訂正前の内容は版として残ります。">
          <details className="group/correct">
            <summary className={CORRECT_SUMMARY}>
              <span aria-hidden className="inline-block transition-transform group-open/correct:rotate-90">›</span>
              <span className="group-open/correct:hidden">訂正の入力を開く</span>
              <span className="hidden group-open/correct:inline">訂正の入力を閉じる</span>
            </summary>
            <div className="mt-4 border-l-2 border-sb-ink pl-3 sm:pl-5">
              <FlightForm key={f.version} aircraft={options.aircraft} pilots={options.pilots} fixedPilotId={options.fixedPilotId} memberId={me.member.id} editing={f} />
            </div>
          </details>
        </Section>
      ) : null}
      <LinkedIncidentsSection dto={flightIncidents} />

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
