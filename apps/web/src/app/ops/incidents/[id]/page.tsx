import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangeNotice } from "@/components/ops/change-notice";
import { DraftOwnerGuard, VoidForm } from "@/components/ops/ops-client";
import { IncidentConsultedForm, IncidentFollowUpForm, IncidentForm, IncidentReportedForm, IncidentRetractForm } from "@/components/ops/incident-client";
import { IncidentFactNotice, IncidentGuidanceView, IncidentOfficialNotice, IncidentReportRecordNotice, IncidentReportStateView } from "@/components/ops/incident-ui";
import { Badge, buttonGhostClass, buttonPrimaryClass, DetailList, PageHeader, Section } from "@/components/ops/ui";
import { VersionList } from "@/components/ops/versions";
import { INCIDENT_REPORT_REFERENCE_ABSENT_LABEL } from "@/lib/ops-incident";
import { toJstInput } from "@/lib/ops-time";
import { incidentFormOptions, incidentInitialOf } from "@/server/ops/incident-page";
import { getIncident, listIncidentVersions } from "@/server/ops/incidents";
import { requireOpsMember } from "@/server/ops/page";
import { nowOf } from "@/server/ops/records";
import { OpsError } from "@/server/ops/service";

/** 開閉の見出し（ボタンと同じ押しやすさ）。開閉の向きは ▸／▾ の印で示す（読み上げは details の開閉状態で伝わる）。 */
const SUMMARY = `${buttonGhostClass} cursor-pointer list-none gap-2 self-start [&::-webkit-details-marker]:hidden before:sb-num before:text-xs before:text-sb-ink-3 before:content-['▸'] [[open]>&]:border-sb-ink [[open]>&]:before:content-['▾']`;
/** 開いた details の中身（フォーム）。開閉の見出し（ボタン）の直下に積む。 */
const DETAILS = "flex flex-col gap-3 open:pb-1";

// 事故・ヒヤリハットの詳細（Sprint 12e 設計 E）：事実、目安と類型のデータの版・出典（N4）、報告の記録（N3）と報告の状態、
// 結び付いた計画・日誌・スナップショット、版の履歴、訂正（#correct）、対応の状況、取消（運航管理者のみ）。
// 「今日」の次にやることは #report（報告の要否の確認）・#correct（詳細の記入）へ移る。取消済みでも詳細と版の履歴は残る。
export default async function IncidentDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let d;
  try {
    d = await getIncident(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listIncidentVersions(ctx, id);
  const canUpdate = d.canUpdate && !d.voided;
  const canReport = d.canReport && !d.voided;
  const canVoid = d.canVoid && !d.voided;
  const opts = canUpdate ? await incidentFormOptions(ctx, d.planId) : null;
  const nowInput = toJstInput(nowOf(ctx));
  const title = d.summary ?? `${d.kindLabel}の記録（詳細は未記入）`;

  const rows: [string, React.ReactNode][] = [
    ["区分（利用者が選ぶ。法令上の区分ではありません）", <span key="k" data-testid="incident-detail-kind">{d.kindLabel}</span>],
    ["起きた日時", <span key="t" className="sb-num tnum" data-testid="incident-detail-time">{d.occurredAtJst}</span>],
    ["起きた場面", d.phaseLabel ?? "—"],
    ["場所", d.placeName ?? "—"],
    [
      "起きた事象の類型",
      <ul key="et" className="flex flex-col gap-0.5" data-testid="incident-detail-event-types">
        {d.eventTypes.map((t) => (
          <li key={t.key} data-key={t.key}>
            {t.label}
          </li>
        ))}
      </ul>,
    ],
    ["けがをした人", <span key="i" data-testid="incident-detail-injury">{d.peopleInjuryLabel}{d.injuredCount !== null ? `（${d.injuredCount} 人）` : ""}</span>],
    ["自社の機体の損傷", <span key="dm" data-testid="incident-detail-damage">{d.aircraftDamageLabel}</span>],
    ["連絡した先", d.contactsMade.length > 0 ? d.contactsMade.map((c) => c.label).join("、") : "—"],
    ["何が起きたか", <span key="s" data-testid="incident-detail-summary">{d.summary ?? "（未記入）"}</span>],
    ["経過", d.details ?? "—"],
    ["とった対応", d.actionsTaken ?? "—"],
    ["考えられる要因（推測）", d.factorsNote ?? "—"],
    ["再発防止", d.preventionNote ?? "—"],
    ["対応の状況", <span key="f" data-testid="incident-detail-follow-up">{d.followUpLabel}{d.followUpOn ? `（${d.followUpOn}）` : ""}</span>],
    ["機体", d.registrationMark ? <span key="a" className="sb-num">{d.registrationMark}</span> : "—"],
    ["操縦者", d.pilotName ?? "—"],
    [
      "飛行計画",
      d.planId ? (
        <span key="p" className="flex flex-col gap-0.5">
          <Link prefetch={false} href={`/ops/plans/${d.planId}`} className="text-sb-ink underline decoration-sb-orange decoration-2 underline-offset-4" data-testid="incident-detail-plan">
            {d.planTitle ?? "計画"}
          </Link>
          {d.snapshotId ? (
            <Link prefetch={false} href={`/ops/plans/${d.planId}/snapshots/${d.snapshotId}`} className="text-xs text-sb-ink underline decoration-sb-orange decoration-2 underline-offset-4" data-testid="incident-detail-snapshot">
              記録したときの判定スナップショット{d.snapshotSeq !== null ? `（第 ${d.snapshotSeq} 版）` : ""}
            </Link>
          ) : null}
        </span>
      ) : (
        "—"
      ),
    ],
    [
      "日誌（飛行記録）",
      d.flightRecordId ? (
        <Link key="fl" prefetch={false} href={`/ops/flights/${d.flightRecordId}`} className="text-sb-ink underline decoration-sb-orange decoration-2 underline-offset-4" data-testid="incident-detail-flight">
          日誌を見る
        </Link>
      ) : (
        "—"
      ),
    ],
    ["記録した画面", d.sourceLabel],
    ["記録した人", d.createdByName ?? "—"],
    ["現在の版", <span key="v" className="sb-num tnum" data-testid="incident-detail-version">版 {d.version}</span>],
  ];

  return (
    <main className="flex flex-col gap-10" data-testid="incident-detail-page" data-id={d.id}>
      <DraftOwnerGuard memberId={me.member.id} />
      {/* 簡易記録なら「詳細を記入する」を最上部に */}
      {d.detailPending && !d.voided ? (
        <div className="opx-edge-row opx-edge-attn !px-4 !py-3.5 text-sb-ink sm:!flex-row sm:items-center sm:justify-between" data-testid="incident-detail-pending">
          <p className="text-base font-medium">
            <span aria-hidden>{d.detailPendingMark} </span>
            {d.detailPendingLabel}
          </p>
          {canUpdate ? (
            <a href="#correct" className={`${buttonPrimaryClass} self-start`} data-testid="incident-detail-fill">
              詳細を記入する
            </a>
          ) : (
            <p className="text-sm text-sb-ink-2">詳細の記入は、運航管理者か、記録を作った本人・記録の操縦者が行えます。</p>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="事故・ヒヤリハットの詳細"
          back={{ href: "/ops/incidents", label: "事故・ヒヤリハットの一覧" }}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="break-all" data-testid="incident-title">{title}</span>
              {d.voided ? <Badge tone="red" data-testid="incident-voided">{`× ${d.voidedLabel ?? ""}`}</Badge> : null}
            </span>
          }
        >
          <IncidentFactNotice />
          <IncidentOfficialNotice />
        </PageHeader>
        {d.voided ? (
          <p className="opx-note opx-note-red">この記録は取り消されています（誤登録の記録）。内容と版の履歴は残しています。訂正・報告の記録はできません。</p>
        ) : null}
        <DetailList rows={rows} data-testid="incident-detail" />
      </div>

      <Section title="報告の対象になる可能性の目安" aria-label="目安" description="記録を保存したときに、選んだ事象の類型からサーバーが計算した値です（当時の類型のデータの版と出典を残しています）。">
        <IncidentGuidanceView
          g={{
            level: d.guidance.level,
            label: d.guidance.label,
            mark: d.guidance.mark,
            text: d.guidance.text,
            note: d.guidance.note,
            revision: d.guidance.revision,
            source: d.guidance.source,
            statusLabel: d.guidance.statusLabel,
          }}
        />
      </Section>

      <Section id="report" title="国への報告の記録" aria-label="国への報告の記録" description="報告は DIPS 2.0 などの公式の手続きで行い、その結果をここに記録します。">
        <ChangeNotice target="incident-report" />
        <div
          className={`opx-edge-row !gap-1.5 !px-4 !py-3 !text-base text-sb-ink ${d.reportState.changedSinceReport ? "opx-edge-attn" : ""}`}
        >
          <span className="opx-eyebrow">報告の状態</span>
          <IncidentReportStateView s={d.reportState} />
        </div>
        <IncidentReportRecordNotice />
        {d.reportRecords.length === 0 ? (
          <p className="sb-block-soft text-center text-sm text-sb-ink-2" data-testid="incident-report-records-empty">報告・確認の記録はありません。</p>
        ) : (
          <ol className="flex flex-col gap-2" data-testid="incident-report-records">
            {d.reportRecords.map((r) => (
              <li
                key={r.id}
                className={`opx-edge-row !gap-1.5 ${r.active ? "opx-edge-hl" : ""} ${r.retracted ? "text-sb-ink-3" : "text-sb-ink"}`}
                data-testid="incident-report-record"
                data-action={r.action}
                data-active={r.active ? "true" : "false"}
                data-retracted={r.retracted ? "true" : "false"}
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" data-testid="incident-report-record-action">{r.actionLabel}</span>
                  {r.retracted ? <Badge tone="mute">取り下げ済み</Badge> : null}
                  {r.doneAtJst ? <span className="sb-num text-xs tnum text-sb-ink-2">{r.doneAtJst}</span> : null}
                </p>
                {r.action === "reported" ? (
                  <p data-testid="incident-report-record-detail">
                    {r.channelLabel}
                    {r.channelNote ? `（${r.channelNote}）` : ""}／{r.referenceAbsent ? INCIDENT_REPORT_REFERENCE_ABSENT_LABEL : `番号 ${r.reference ?? ""}`}
                  </p>
                ) : null}
                {r.note ? <p className="opx-note break-all">{r.note}</p> : null}
                {r.reason ? <p className="opx-note break-all">理由：{r.reason}</p> : null}
                <p className="text-xs leading-relaxed text-sb-ink-2">
                  記録した人：{r.recordedByName}（記録時の版 {r.incidentVersion}）／{r.declaration}
                </p>
                {canReport && r.active ? (
                  <details className={`mt-1 ${DETAILS}`}>
                    <summary className={SUMMARY} data-testid="incident-retract-open">
                      この記録を取り下げる
                    </summary>
                    <IncidentRetractForm id={d.id} targetRecordId={r.id} />
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {canReport ? (
          <div className="flex flex-col gap-3">
            <details className={DETAILS} data-testid="incident-report-details">
              <summary className={SUMMARY} data-testid="incident-report-open">
                報告の結果を記録する
              </summary>
              <IncidentReportedForm id={d.id} defaultDoneAt={nowInput} />
            </details>
            <details className={DETAILS} data-testid="incident-consult-details">
              <summary className={SUMMARY} data-testid="incident-consult-open">
                報告の要否を確かめたことを記録する
              </summary>
              <IncidentConsultedForm id={d.id} defaultDoneAt={nowInput} />
            </details>
          </div>
        ) : !d.voided ? (
          <p className="opx-note !text-xs" data-testid="incident-report-denied">報告の記録は、運航管理者か、記録を作った本人・記録の操縦者が行えます。</p>
        ) : null}
      </Section>

      {canUpdate && opts ? (
        <Section id="correct" title={d.detailPending ? "詳細を記入する（訂正）" : "訂正"} aria-label="訂正" description="記載の誤りを直したり、あとから分かった事実を足したりします。訂正前の内容は版として残ります。">
          <IncidentForm key={d.version} mode="correct" initial={incidentInitialOf(d)} plans={opts.plans} aircraft={opts.aircraft} pilots={opts.pilots} id={d.id} version={d.version} />
        </Section>
      ) : !d.voided ? (
        <p id="correct" className="opx-note !text-xs" data-testid="incident-correct-denied">
          訂正は、運航管理者か、記録を作った本人・記録の操縦者が行えます。
        </p>
      ) : null}

      {canUpdate ? (
        <Section title="対応の状況の更新" aria-label="対応の状況の更新">
          <IncidentFollowUpForm id={d.id} version={d.version} status={d.followUpStatus} on={d.followUpOn} />
        </Section>
      ) : null}

      <VersionList versions={versions} />

      {canVoid ? (
        <Section title="取消" tone="danger" description="誤って記録したものを取り消します。削除ではありません。内容と版の履歴は誤登録の記録として残ります。">
          <VoidForm url={`/api/ops/incidents/${d.id}/void`} version={d.version} label="この記録" />
        </Section>
      ) : null}
    </main>
  );
}
