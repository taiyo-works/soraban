import Link from "next/link";
import { Badge, buttonFieldClass, listRowClass, Note, PageHeader } from "@/components/ops/ui";
import { DipsNotice, PlanStateBadge, ReportBadge, StaleBadge, VerdictBadge } from "@/components/ops/plan-ui";
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
  const all = await listPlans(ctx, { includeVoided: true, ...(pendingOnly ? { state: "pending" as const } : {}) });
  const today = jstDate(nowOf(ctx));
  const rows: PlanDto[] =
    view === "voided"
      ? all.filter((p) => p.voided)
      : view === "past"
        ? all.filter((p) => !p.voided && p.plannedDate < today)
        : all.filter((p) => !p.voided && p.plannedDate >= today).reverse();
  const denied = planCreateDenied(me);
  const href = (v: ViewKey, pending: boolean) => `/ops/plans?view=${v}${pending ? "&state=pending" : ""}`;
  return (
    <main className="flex flex-col gap-6">
      <PageHeader
        title="飛行計画"
        back={{ href: "/ops", label: "運航管理のトップ" }}
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
            <li key={p.id}>
              <Link prefetch={false} href={`/ops/plans/${p.id}`} className={`${listRowClass} sm:grid-cols-1 sm:gap-1.5 sm:rounded-sharp sm:border sm:bg-paper sm:px-3`} data-testid="plan-row">
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
                    <VerdictBadge level={p.judgement.verdictLevel} unknownCount={p.judgement.verdictUnknownCount} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <DipsNotice />
    </main>
  );
}
