import Link from "next/link";
import { Badge, buttonFieldClass, Note, PageHeader } from "@/components/ops/ui";
import { DipsNotice, NextActionItem, PlanStateBadge, ReportBadge, ReportStatusBadge, StaleBadge, VerdictBadge } from "@/components/ops/plan-ui";
import { jstDate } from "@/lib/ops-time";
import { PLAN_JUDGEMENT_DISCLAIMER } from "@soraban/regulations";
import { requireOpsMember } from "@/server/ops/page";
import { planCreateDenied } from "@/server/ops/plan-page";
import { listPlans, type PlanDto } from "@/server/ops/plans";
import { nowOf } from "@/server/ops/records";

const VIEWS = [
  { key: "upcoming", label: "これから" },
  { key: "past", label: "過去" },
  { key: "voided", label: "中止" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

/** `YYYY-MM-DD` の前の日（過去の表示の上限を「今日より前」にするため）。 */
const prevDate = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** 行全体のカード（li の枠）の中で、本体のリンク。次にやることは同じ枠の下半分に置く（リンクの中に入れない）。 */
const rowLinkClass = "grid grid-cols-1 gap-2 rounded-t-sharp px-3 py-3 text-sm transition-colors hover:bg-paper-soft focus-visible:bg-paper-soft";

const tabClass = (active: boolean) =>
  `inline-flex min-h-11 items-center px-4 text-sm ${active ? "bg-brand-700 text-paper" : "bg-paper text-ink-soft hover:bg-paper-soft"}`;

// 飛行計画の一覧（これから／過去／中止）。各行に予定日時・計画名・機体・操縦者・導出の状態・通報の要否・判定の結論・「判定が古い」の印。
// 運航管理者には「確認待ち」の絞り込みを出す。
export default async function PlanListPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, me } = await requireOpsMember();
  const sp = await searchParams;
  const view: ViewKey = VIEWS.some((v) => v.key === sp["view"]) ? (sp["view"] as ViewKey) : "upcoming";
  const manager = me.member.role === "manager";
  const pendingOnly = manager && sp["state"] === "pending";
  // 「対応が必要」：次にやることのうち、確認・再判定・通報・許可・警察など（推奨だけのものは含めない）がある計画
  const attentionOnly = sp["attention"] === "1";
  const today = jstDate(nowOf(ctx));
  // 表示ごとの絞り込み（日付・中止）は、500 件の上限の前に DB で行う。
  const stateFilter = pendingOnly ? { state: "pending" as const } : {};
  const viewFilter =
    view === "voided"
      ? { voidedOnly: true }
      : view === "past"
        ? { to: prevDate(today) }
        : { from: today, oldestFirst: true };
  const all = await listPlans(ctx, { ...viewFilter, ...stateFilter });
  const byView: PlanDto[] =
    view === "voided"
      ? all.filter((p) => p.voided)
      : view === "past"
        ? all.filter((p) => !p.voided && p.plannedDate < today)
        : all.filter((p) => !p.voided && p.plannedDate >= today);
  const rows: PlanDto[] = attentionOnly ? byView.filter((p) => p.nextAction !== null && p.nextAction.tier <= 4) : byView;
  const denied = planCreateDenied(me);
  const href = (v: ViewKey, pending: boolean, attention: boolean = attentionOnly) =>
    `/ops/plans?view=${v}${pending ? "&state=pending" : ""}${attention ? "&attention=1" : ""}`;
  return (
    <main className="flex flex-col gap-6">
      <PageHeader
        title="飛行計画"
        aside={
          denied === null ? (
            <Link prefetch={false} href="/ops/plans/new" className={buttonFieldClass} data-testid="plan-new-link">
              飛行計画を作る
            </Link>
          ) : null
        }
      >
        {denied !== null ? <Note>{denied}</Note> : null}
        <Note>{PLAN_JUDGEMENT_DISCLAIMER}</Note>
      </PageHeader>
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="表示する計画" className="inline-flex self-start overflow-hidden rounded-sharp border border-rule">
          {VIEWS.map((v, i) => (
            <Link
              key={v.key}
              href={href(v.key, pendingOnly)}
              prefetch={false}
              className={`${tabClass(v.key === view)} ${i > 0 ? "border-l border-rule" : ""}`}
              aria-current={v.key === view ? "page" : undefined}
              data-testid={`plan-view-${v.key}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <Link
          href={href(view, pendingOnly, !attentionOnly)}
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-sharp border border-rule px-4 text-sm text-ink-soft hover:bg-paper-soft aria-[current=true]:border-brand-700 aria-[current=true]:text-brand-700"
          aria-current={attentionOnly ? "true" : undefined}
          data-testid="plan-filter-attention"
        >
          {attentionOnly ? "✓ 対応が必要なものだけ（解除する）" : "対応が必要なものだけ表示"}
        </Link>
        {manager ? (
          <Link
            href={href(view, !pendingOnly)}
            prefetch={false}
            className="inline-flex min-h-11 items-center rounded-sharp border border-rule px-4 text-sm text-ink-soft hover:bg-paper-soft aria-[current=true]:border-brand-700 aria-[current=true]:text-brand-700"
            aria-current={pendingOnly ? "true" : undefined}
            data-testid="plan-filter-pending"
          >
            {pendingOnly ? "✓ 確認待ちだけ（解除する）" : "確認待ちだけ表示"}
          </Link>
        ) : null}
      </div>
      <p className="font-mono text-[11px] tnum text-ink-mute" data-testid="plan-count">
        {rows.length} 件
      </p>
      {rows.length === 0 ? (
        <p className="border-y border-rule py-6 text-center text-sm text-ink-mute">該当する飛行計画はありません。</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="plan-list">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-col rounded-sharp border border-rule bg-paper">
              <Link prefetch={false} href={`/ops/plans/${p.id}`} className={rowLinkClass} data-testid="plan-row">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-sm tnum text-ink" data-testid="plan-row-start">
                    {p.plannedStartAtJst}
                  </span>
                  <span className="min-w-0 break-words font-medium text-ink" data-testid="plan-row-title">
                    {p.title}
                  </span>
                  {p.voided ? <Badge tone="red">中止</Badge> : null}
                </span>
                <span className="text-xs text-ink-soft">
                  <span className="font-mono">{p.registrationMark}</span>
                  <span aria-hidden className="mx-1.5 text-rule">
                    ／
                  </span>
                  {p.pilotName}
                </span>
                <span className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <PlanStateBadge state={p.state} label={p.stateLabel} />
                    {p.freshness.stale ? <StaleBadge /> : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <ReportBadge report={p.report} />
                    <ReportStatusBadge status={p.report.status} />
                    <VerdictBadge level={p.judgement.verdictLevel} unknownCount={p.judgement.verdictUnknownCount} />
                  </span>
                </span>
              </Link>
              {p.nextAction ? (
                <div className="border-t border-rule bg-paper-soft/60" data-testid="plan-row-next">
                  <NextActionItem action={p.nextAction} testId="plan-row-next-action" />
                  {p.nextActionCount > 1 ? (
                    <p className="px-3 pb-2.5 pl-[3.75rem] text-xs text-ink-mute" data-testid="plan-row-next-count">
                      ほか {p.nextActionCount - 1} 件（詳細で確認できます）
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <DipsNotice />
    </main>
  );
}
