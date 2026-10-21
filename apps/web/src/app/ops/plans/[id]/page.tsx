import Link from "next/link";
import { notFound } from "next/navigation";
import { PLAN_JUDGEMENT_DISCLAIMER, PERMIT_VALUE_LABEL, PURPOSE_VALUE_LABEL, SPECIFIC_FLIGHT_FLAG_LABEL, type FlightVerdict, type SpecificFlightFlag } from "@soraban/regulations";
import { ChangeNotice } from "@/components/ops/change-notice";
import { VoidForm } from "@/components/ops/ops-client";
import { PlanDigest, PlanStateBadge, ReportBox, StaleBadge } from "@/components/ops/plan-ui";
import { ConfirmPanel, RejudgeButton, RequestConfirmationButton } from "@/components/ops/plans-client";
import { Badge, buttonOutlineBrandClass, DetailList, Note, PageHeader, Section } from "@/components/ops/ui";
import { VersionList } from "@/components/ops/versions";
import { VerdictSummary } from "@/components/verdict-summary";
import { unknownCountLabel } from "@/lib/verdict-display";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";
import { SELF_CONFIRMATION_LABEL } from "@/server/ops/plan-logic";
import { canUpdatePlan } from "@/server/ops/plan-page";
import { getPlan, getSnapshot, listPlanVersions } from "@/server/ops/plans";
import { recordCreateDenied } from "@/server/ops/record-page";
import { OpsError } from "@/server/ops/service";
import { JUDGEMENT_LINK_MISSING_LABEL } from "@/server/ops/records";

const DECISION_LABEL = { approved: "確認", returned: "差し戻し" } as const;
const mono = "font-mono text-xs tnum break-all";

// 飛行計画の詳細：概要／判定の要約／通報の要否／確認の状況／この計画の飛行記録／版の履歴（Sprint 12a 設計 F）。
export default async function PlanDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let plan;
  try {
    plan = await getPlan(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const [snapshot, versions] = await Promise.all([getSnapshot(ctx, id, plan.currentSnapshotId), listPlanVersions(ctx, id)]);
  const verdict = (snapshot.result as { verdict?: FlightVerdict }).verdict;
  const updatable = !plan.voided && canUpdatePlan(me, plan.isSelf);
  const manager = me.member.role === "manager";
  const cancellable = !plan.voided && can(me.member.role, "plan.cancel", { isSelf: plan.isSelf });
  const canConfirm = !plan.voided && can(me.member.role, "plan.confirm") && plan.status === "active" && plan.state !== "approved";
  const canMakeFlight = !plan.voided && recordCreateDenied(me) === null;
  const j = plan.judgement;

  const overview: [string, React.ReactNode][] = [
    ["予定開始（日本時間）", <span key="s" className="font-mono tnum" data-testid="plan-start">{plan.plannedStartAtJst}</span>],
    ["所要時間", `${plan.durationMinutes} 分`],
    ["機体", <span key="a" className="font-mono">{plan.registrationMark}（{plan.modelName}）</span>],
    ["操縦者", <span key="p" data-testid="plan-pilot-name">{plan.pilotName}</span>],
    ["飛行の目的", plan.purpose],
    [
      "場所",
      <span key="pl" className="flex flex-col">
        <span>{plan.placeName}</span>
        <span className="font-mono text-xs tnum text-ink-soft">
          {plan.latitude}, {plan.longitude}（WGS84）{plan.radiusM !== null ? `／半径 ${plan.radiusM} m` : ""}
        </span>
      </span>,
    ],
    ["最大高度", plan.maxAltitudeM === null ? "—" : `${plan.maxAltitudeM} m`],
    [
      "飛行の方法・空域（選択）",
      plan.flags.length === 0 ? "なし" : plan.flags.map((f) => SPECIFIC_FLIGHT_FLAG_LABEL[f as SpecificFlightFlag] ?? f).join("、"),
    ],
    ["許可・承認・同意", plan.pilotPermits.length === 0 ? "なし" : plan.pilotPermits.map((p) => PERMIT_VALUE_LABEL[p] ?? p).join("、")],
    ["運航の目的（例外）", plan.judgementPurpose ? (PURPOSE_VALUE_LABEL[plan.judgementPurpose] ?? plan.judgementPurpose) : "通常運航"],
    ["許可・承認の番号", plan.permitNumbers ?? "—"],
    ["メモ", plan.notes ?? "—"],
  ];

  return (
    <main className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <PageHeader
          eyebrow="飛行計画の詳細"
          back={{ href: "/ops/plans", label: "飛行計画の一覧" }}
          title={<span className="break-words" data-testid="plan-title-heading">{plan.title}</span>}
        >
          <div className="flex flex-wrap items-center gap-2">
            <PlanStateBadge state={plan.state} label={plan.stateLabel} />
            {plan.freshness.stale ? <StaleBadge /> : null}
            <span className="font-mono text-[11px] tnum text-ink-mute">版 {plan.version}</span>
          </div>
        </PageHeader>
        {plan.voided ? <Note tone="red">この計画は中止されています。記載内容と判定の履歴、版の一覧は残しています。</Note> : null}
        <p
          className="border-l-2 border-brand-700 pl-3 text-sm leading-relaxed text-ink"
          data-testid="plan-disclaimer"
        >
          {PLAN_JUDGEMENT_DISCLAIMER}
        </p>
        <PlanDigest
          verdictLevel={j.verdictLevel}
          unknownCount={j.verdictUnknownCount}
          report={plan.report}
          state={plan.state}
          stateLabel={plan.stateLabel}
          stale={plan.freshness.stale}
        />
        {updatable ? (
          <div className="flex flex-wrap gap-3">
            <Link prefetch={false} href={`/ops/plans/${plan.id}/edit`} className={buttonOutlineBrandClass} data-testid="plan-edit-link">
              計画を訂正する
            </Link>
          </div>
        ) : null}
      </div>

      <Section title="概要" aria-label="概要">
        <DetailList rows={overview} data-testid="plan-overview" />
      </Section>

      <Section id="sec-report" title="通報の要否" aria-label="通報の要否" description="通報そのものは DIPS 2.0 で行います。そらばんは送信しません。">
        <ReportBox report={plan.report} />
      </Section>

      <Section id="sec-confirm" title="確認の状況" aria-label="確認の状況" description="運航管理者が、計画と判定を確認します。確認は、確認した版に対するものです。">
        <ChangeNotice target="confirmations" />
        <div className="flex flex-wrap items-center gap-3" data-testid="plan-confirmation-status">
          <PlanStateBadge state={plan.state} label={plan.stateLabel} />
          {plan.selfConfirmation ? <Badge tone="amber" data-testid="plan-self-confirmation">{SELF_CONFIRMATION_LABEL}</Badge> : null}
        </div>
        <dl className="flex flex-col border-t border-rule text-sm" data-testid="plan-confirm-facts">
          <div className="grid grid-cols-1 gap-0.5 border-b border-rule-soft py-2.5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-xs text-ink-mute sm:text-sm">判定不能の件数</dt>
            <dd data-testid="plan-unknown-count">{j.verdictUnknownCount > 0 ? unknownCountLabel(j.verdictUnknownCount) : "判定不能 0 件"}</dd>
          </div>
          <div className="grid grid-cols-1 gap-0.5 border-b border-rule-soft py-2.5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-xs text-ink-mute sm:text-sm">出典・確認日が古い項目（90 日超）</dt>
            <dd data-testid="plan-stale-sources">
              {plan.staleSources.length === 0 ? (
                "ありません"
              ) : (
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {plan.staleSources.map((s) => (
                    <li key={s.id}>
                      {s.name}：確認日 {s.verifiedAt}
                      {s.ageDays !== null ? `（${s.ageDays} 日前）` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
        {plan.state === "draft" ? (
          <div className="flex flex-col gap-2">
            <Note>下書きです。確認を依頼すると、運航管理者が確認できます。</Note>
            {updatable ? <RequestConfirmationButton planId={plan.id} version={plan.version} /> : null}
          </div>
        ) : null}
        {plan.confirmations.length === 0 ? (
          plan.state !== "draft" && !plan.voided ? <p className="text-sm text-ink-mute">確認の記録はまだありません。</p> : null
        ) : (
          <ol className="flex flex-col border-t border-rule" data-testid="plan-confirmations">
            {[...plan.confirmations].reverse().map((c) => (
              <li key={c.id} className={`flex flex-col gap-1 border-b border-l-4 border-b-rule-soft py-3 pl-3 text-sm ${c.decision === "approved" ? "border-l-signal-green" : "border-l-signal-red"}`} data-testid="plan-confirmation-row">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge tone={c.decision === "approved" ? "green" : "red"} data-testid="plan-confirmation-decision">
                    <span aria-hidden className="mr-1">{c.decision === "approved" ? "✓" : "↩"}</span>
                    {DECISION_LABEL[c.decision]}
                  </Badge>
                  {c.selfConfirmation ? <Badge tone="amber">{SELF_CONFIRMATION_LABEL}</Badge> : null}
                  <span className="font-mono text-xs tnum text-ink-mute">版 {c.planVersion}</span>
                  <time dateTime={c.createdAt} className="font-mono text-xs tnum text-ink-soft">{c.createdAtJst}</time>
                  <span>{c.confirmerName}</span>
                </p>
                {c.reason ? <p className="break-all text-ink-soft">理由：{c.reason}</p> : null}
              </li>
            ))}
          </ol>
        )}
        {canConfirm ? <ConfirmPanel planId={plan.id} version={plan.version} stale={plan.freshness.stale} /> : null}
        {!manager && plan.status === "active" && !plan.voided ? <Note>確認・差し戻しは運航管理者だけが行えます。</Note> : null}
      </Section>

      <Section
        id="sec-verdict"
        title="判定の要約"
        aria-label="判定の要約"
        description="結論と、判定の根拠です。計画を保存したときに、サーバーが実行した判定（現在のスナップショット）です。"
      >
        <VerdictSummary verdict={verdict} pending={false} failed={verdict === undefined} />
        <DetailList
          data-testid="plan-judgement"
          rows={[
            ["判定の通し番号", <span key="n" data-testid="plan-snapshot-seq">{j.seq}</span>],
            ["判定の日時", <time key="t" dateTime={j.checkedAt} className="font-mono text-xs tnum">{j.checkedAt}</time>],
            ["地点判定の証跡 ID", <span key="c" className={mono} data-testid="plan-check-evidence">{j.checkEvidenceId}</span>],
            ["申請支援の証跡 ID", <span key="d" className={mono} data-testid="plan-diagnosis-evidence">{j.diagnosisEvidenceId}</span>],
            ["エンジンの版", <span key="e" className={mono}>{j.engineVersion}</span>],
          ]}
        />
        {plan.freshness.stale ? (
          <div className="flex flex-col gap-2 border-l-2 border-signal-amber pl-3" data-testid="plan-stale-box">
            <p className="text-sm font-medium text-ink">判定が古くなっています</p>
            <ul className="list-disc pl-5 text-sm text-ink-soft" data-testid="plan-stale-reasons">
              {plan.freshness.reasons.map((r) => (
                <li key={r.code}>{r.label}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Link prefetch={false} href={`/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`} className={buttonOutlineBrandClass} data-testid="plan-basis-link">
            判定の根拠を見る
          </Link>
          <Link prefetch={false} href={`/ops/plans/${plan.id}/snapshots`} className="inline-flex min-h-11 items-center text-sm text-brand-700 underline underline-offset-2" data-testid="plan-snapshots-link">
            判定の履歴を見る
          </Link>
        </div>
        {updatable ? <RejudgeButton planId={plan.id} version={plan.version} highlight={plan.freshness.stale} /> : null}
      </Section>

      <Section title="この計画の飛行記録" aria-label="この計画の飛行記録">
        {plan.flights.length === 0 ? (
          <p className="text-sm text-ink-mute" data-testid="plan-flights-empty">結びついた飛行記録はありません。</p>
        ) : (
          <ul className="flex flex-col border-t border-rule" data-testid="plan-flights">
            {plan.flights.map((f) => (
              <li key={f.id} className="border-b border-rule-soft">
                <Link prefetch={false} href={`/ops/flights/${f.id}`} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm hover:bg-paper-soft" data-testid="plan-flight-row">
                  <span className="font-mono tnum">{f.flightDate}</span>
                  <span className="font-mono tnum">{f.takeoffAtJst.slice(11)}–{f.landingAtJst}</span>
                  <span className="font-mono text-ink-soft">{f.registrationMark}</span>
                  <span>{f.pilotName}</span>
                  {f.voided ? <Badge tone="red">取消済み</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {canMakeFlight ? (
          <div className="flex flex-col gap-2">
            <Link prefetch={false} href={`/ops/flights/new?planId=${plan.id}`} className={`${buttonOutlineBrandClass} self-start`} data-testid="plan-make-flight">
              飛行記録を作る
            </Link>
            <p className="text-xs text-ink-mute">機体・操縦者・目的・場所・特定飛行の形態を引き継ぎます。離陸・着陸の時刻は、実際の時刻を入れてください。</p>
          </div>
        ) : null}
        <p className="text-xs text-ink-mute">{JUDGEMENT_LINK_MISSING_LABEL}の記録は、飛行記録の一覧と詳細に出ます。</p>
      </Section>

      <VersionList versions={versions} />

      {cancellable ? (
        <Section
          title="中止"
          tone="danger"
          description="計画を中止します。削除ではありません。中止した計画は訂正・確認・再判定・飛行記録の紐付けができなくなり、記載内容と版の一覧は残ります。"
        >
          <VoidForm url={`/api/ops/plans/${plan.id}/void`} version={plan.version} label="この計画" />
        </Section>
      ) : null}
    </main>
  );
}
