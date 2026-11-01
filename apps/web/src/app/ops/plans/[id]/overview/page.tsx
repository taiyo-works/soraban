import Link from "next/link";
import { PERMIT_VALUE_LABEL, PURPOSE_VALUE_LABEL, SPECIFIC_FLIGHT_FLAG_LABEL, type SpecificFlightFlag } from "@soraban/regulations";
import { ChangeNotice } from "@/components/ops/change-notice";
import { VoidForm } from "@/components/ops/ops-client";
import { PlanStateBadge } from "@/components/ops/plan-ui";
import { PlanFrame } from "@/components/ops/plan-frame";
import { ProcedureRecordsPanel } from "@/components/ops/procedure-client";
import { ConfirmPanel, RequestConfirmationButton } from "@/components/ops/plans-client";
import { Badge, buttonOutlineBrandClass, DetailList, Note, Section } from "@/components/ops/ui";
import { VersionList } from "@/components/ops/versions";
import { unknownCountLabel } from "@/lib/verdict-display";
import { can } from "@/server/ops/authz";
import { isDipsPermitValue } from "@/server/ops/permit-logic";
import { SELF_CONFIRMATION_LABEL } from "@/server/ops/plan-logic";
import { canUpdatePlan } from "@/server/ops/plan-page";
import { listProcedureRecords } from "@/server/ops/procedure-records";
import { listPlanVersions } from "@/server/ops/plans";
import { loadPlan } from "../_load";

const DECISION_LABEL = { approved: "確認", returned: "差し戻し" } as const;

// 計画の画面（Sprint 17-1）：概要・手続きの記録（暫定。Sprint 18 で整理）・確認の状況・版の一覧・訂正・中止。
export default async function PlanOverviewPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me, id, plan } = await loadPlan(params);
  const [versions, procedureView] = await Promise.all([listPlanVersions(ctx, id), listProcedureRecords(ctx, id)]);
  const updatable = !plan.voided && canUpdatePlan(me, plan.isSelf);
  const manager = me.member.role === "manager";
  const cancellable = !plan.voided && can(me.member.role, "plan.cancel", { isSelf: plan.isSelf });
  const canConfirm = !plan.voided && can(me.member.role, "plan.confirm") && plan.status === "active" && plan.state !== "approved";
  const j = plan.judgement;

  const overview: [string, React.ReactNode][] = [
    ["予定開始（日本時間）", <span key="s" className="sb-num tnum" data-testid="plan-start">{plan.plannedStartAtJst}</span>],
    ["所要時間", `${plan.durationMinutes} 分`],
    ["機体", <span key="a" className="sb-num">{plan.registrationMark}（{plan.modelName}）</span>],
    ["操縦者", <span key="p" data-testid="plan-pilot-name">{plan.pilotName}</span>],
    ["飛行の目的", plan.purpose],
    [
      "場所",
      <span key="pl" className="flex flex-col">
        <span>{plan.placeName}</span>
        <span className="sb-num text-xs tnum text-sb-ink-2">
          {plan.latitude}, {plan.longitude}（WGS84）{plan.radiusM !== null ? `／半径 ${plan.radiusM} m` : ""}
        </span>
      </span>,
    ],
    ["最大高度", plan.maxAltitudeM === null ? "—" : `${plan.maxAltitudeM} m`],
    [
      "飛行の方法・空域（選択）",
      plan.flags.length === 0 ? "なし" : plan.flags.map((f) => SPECIFIC_FLIGHT_FLAG_LABEL[f as SpecificFlightFlag] ?? f).join("、"),
    ],
    [
      "同意・通報・許可（DIPS を除く）",
      (() => {
        const manual = plan.pilotPermits.filter((p) => !isDipsPermitValue(p));
        return manual.length === 0 ? "なし" : manual.map((p) => PERMIT_VALUE_LABEL[p] ?? p).join("、");
      })(),
    ],
    ["運航の目的（例外）", plan.judgementPurpose ? (PURPOSE_VALUE_LABEL[plan.judgementPurpose] ?? plan.judgementPurpose) : "通常運航"],
    ["許可・承認の番号", <span key="pn" className="break-all sb-num text-xs" data-testid="plan-permit-numbers-text">{plan.permitNumbers ?? "—"}</span>],
    ["メモ", plan.notes ?? "—"],
  ];

  return (
    <PlanFrame plan={plan} current="overview" eyebrow="計画">
        <Section title="概要" aria-label="概要">
          <DetailList rows={overview} compact data-testid="plan-overview" />
        </Section>

        {updatable ? (
          <div className="flex flex-wrap gap-3">
            <Link prefetch={false} href={`/ops/plans/${plan.id}/edit`} className={buttonOutlineBrandClass} data-testid="plan-edit-link">
              計画を訂正する
            </Link>
          </div>
        ) : null}

        <Section
          id="procedures"
          title="手続きの記録"
          aria-label="手続きの記録"
          description="許可・承認の申請と、小型無人機等飛行禁止法の同意・通報を、済んだら記録します。記録は利用者の申告です。"
        >
          <ChangeNotice target="procedures" />
          <details data-testid="plan-procedures-details" data-open-on-hash>
            <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">手続きの記録を開く</summary>
          <ProcedureRecordsPanel
            planId={plan.id}
            planVersion={plan.version}
            summary={procedureView.summary}
            records={procedureView.records}
            canRecord={procedureView.canRecord}
            voided={plan.voided}
          />
          </details>
        </Section>

        <Section id="sec-confirm" title="確認の状況" aria-label="確認の状況" description="運航管理者が、計画と判定を確認します。確認は、確認した版に対するものです。">
          <ChangeNotice target="confirmations" />
          <div className="flex flex-wrap items-center gap-3" data-testid="plan-confirmation-status">
            <PlanStateBadge state={plan.state} label={plan.stateLabel} />
            {plan.selfConfirmation ? <Badge tone="amber" data-testid="plan-self-confirmation">{SELF_CONFIRMATION_LABEL}</Badge> : null}
          </div>
          <dl className="flex flex-col border-t border-sb-rule text-sm" data-testid="plan-confirm-facts">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 border-b border-sb-rule py-2 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-xs text-sb-ink-3 sm:text-sm">判定不能の件数</dt>
              <dd data-testid="plan-unknown-count">{j.verdictUnknownCount > 0 ? unknownCountLabel(j.verdictUnknownCount) : "判定不能 0 件"}</dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 border-b border-sb-rule py-2 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-xs text-sb-ink-3 sm:text-sm">出典・確認日が古い項目（90 日超）</dt>
              <dd data-testid="plan-stale-sources">
                {plan.staleSources.length === 0 ? (
                  "ありません"
                ) : (
                  <details data-testid="plan-stale-sources-details">
                    <summary className="flex min-h-11 cursor-pointer select-none items-center font-medium text-sb-ink">{plan.staleSources.length} 件あります（開く）</summary>
                    <ul className="flex list-disc flex-col gap-1 pl-5">
                      {plan.staleSources.map((s) => (
                        <li key={s.id}>
                          {s.name}：確認日 {s.verifiedAt}
                          {s.ageDays !== null ? `（${s.ageDays} 日前）` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </dd>
            </div>
          </dl>
          {plan.state === "draft" ? (
            <div id="request-confirmation" className="flex scroll-mt-4 flex-col gap-2">
              <Note>下書きです。確認を依頼すると、運航管理者が確認できます。</Note>
              {updatable ? <RequestConfirmationButton planId={plan.id} version={plan.version} /> : null}
            </div>
          ) : null}
          {plan.confirmations.length === 0 ? (
            plan.state !== "draft" && !plan.voided ? <p className="text-sm text-sb-ink-3">確認の記録はまだありません。</p> : null
          ) : (
            <ol className="flex flex-col border-t border-sb-rule" data-testid="plan-confirmations">
              {[...plan.confirmations].reverse().map((c) => (
                <li key={c.id} className={`flex flex-col gap-1 border-b border-l-4 border-b-sb-rule py-3 pl-3 text-sm ${c.decision === "approved" ? "border-l-sb-ink" : "border-l-sb-v-no-fg"}`} data-testid="plan-confirmation-row">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={c.decision === "approved" ? "green" : "red"} data-testid="plan-confirmation-decision">
                      <span aria-hidden className="mr-1">{c.decision === "approved" ? "✓" : "↩"}</span>
                      {DECISION_LABEL[c.decision]}
                    </Badge>
                    {c.selfConfirmation ? <Badge tone="amber">{SELF_CONFIRMATION_LABEL}</Badge> : null}
                    <span className="sb-num text-xs tnum text-sb-ink-3">版 {c.planVersion}</span>
                    <time dateTime={c.createdAt} className="sb-num text-xs tnum text-sb-ink-2">{c.createdAtJst}</time>
                    <span>{c.confirmerName}</span>
                  </p>
                  {c.reason ? <p className="break-all text-sb-ink-2">理由：{c.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
          {canConfirm ? (
            <div id="confirm" className="scroll-mt-4">
              <ConfirmPanel planId={plan.id} version={plan.version} stale={plan.freshness.stale} />
            </div>
          ) : null}
          {!manager && plan.status === "active" && !plan.voided ? <Note>確認・差し戻しは運航管理者だけが行えます。</Note> : null}
        </Section>

        <VersionList versions={versions} />

        {cancellable ? (
          <Section
            title="中止"
            tone="danger"
            description="計画を中止します。削除ではありません。中止した計画は訂正・確認・再判定・飛行記録の紐付けができなくなり、記載内容と版の一覧は残ります。"
          >
            <details data-testid="plan-void-details">
              <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">この計画を中止する（開く）</summary>
              <VoidForm url={`/api/ops/plans/${plan.id}/void`} version={plan.version} label="この計画" />
            </details>
          </Section>
        ) : null}
    </PlanFrame>
  );
}
