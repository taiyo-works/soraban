import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Note, PageHeader } from "@/components/ops/ui";
import { formatDay } from "@/lib/ops-day";
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
const rowLinkClass = "grid grid-cols-1 gap-2 rounded-t-sb-l px-4 py-4 text-sm transition-colors hover:bg-sb-hover focus-visible:bg-sb-hover";

// 飛行計画の一覧（これから／過去／中止）。各行に予定日時・計画名・機体・操縦者・導出の状態・通報の要否・判定の結論・「判定が古い」の印。
// 運航管理者には「確認待ち」の絞り込みを出す。
export const metadata: Metadata = { title: "計画" };

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
        meta={
          // 16-F（F-6）：題の補足 1 行（14px。ホームの日付と同じ形）
          <span className="opx-num" data-testid="plans-today">
            今日 <time dateTime={today}>{formatDay(today, today)}</time>
          </span>
        }
        aside={
          denied === null ? (
            <Link prefetch={false} href="/ops/plans/new" data-variant="primary" className="opx-btn opx-btn-primary" data-testid="plan-new-link">
              飛行計画を作る
            </Link>
          ) : null
        }
      >
        {denied !== null ? <Note body>{denied}</Note> : null}
        <Note>{PLAN_JUDGEMENT_DISCLAIMER}</Note>
      </PageHeader>
      <div className="flex flex-col gap-3">
        <nav aria-label="表示する計画" className="opx-seg">
          {VIEWS.map((v) => (
            // 同じ画面の ?view= の切り替えは通常のリンク（<a>）。理由は点検の一覧のチップと同じ
            <a key={v.key} href={href(v.key, pendingOnly)} aria-current={v.key === view ? "page" : undefined} data-testid={`plan-view-${v.key}`}>
              {v.label}
            </a>
          ))}
        </nav>
        <div className="opx-seg">
          <a href={href(view, pendingOnly, !attentionOnly)} aria-current={attentionOnly ? "true" : undefined} data-testid="plan-filter-attention">
            {attentionOnly ? "✓ 対応が必要なものだけ（解除する）" : "対応が必要なものだけ表示"}
          </a>
          {manager ? (
            <a href={href(view, !pendingOnly)} aria-current={pendingOnly ? "true" : undefined} data-testid="plan-filter-pending">
              {pendingOnly ? "✓ 確認待ちだけ（解除する）" : "確認待ちだけ表示"}
            </a>
          ) : null}
        </div>
      </div>
      <p data-note="" className="sb-num text-sm font-bold tnum text-sb-ink-3" data-testid="plan-count">
        {rows.length} 件
      </p>
      {rows.length === 0 ? (
        <p className="sb-block-soft text-center text-sb-ink-2">該当する飛行計画はありません。</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="plan-list">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-col rounded-sb-l bg-sb-base opx-shadow">
              <Link prefetch={false} href={`/ops/plans/${p.id}`} className={rowLinkClass} data-testid="plan-row">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="sb-num text-sm tnum text-sb-ink" data-testid="plan-row-start">
                    {p.plannedStartAtJst}
                  </span>
                  <span className="min-w-0 break-words font-medium text-sb-ink" data-testid="plan-row-title">
                    {p.title}
                  </span>
                  {p.voided ? <Badge tone="red">中止</Badge> : null}
                </span>
                <span className="text-sm text-sb-ink-2">
                  <span className="sb-num">{p.registrationMark}</span>
                  <span aria-hidden className="mx-1.5 text-sb-ink-3">
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
                <div className="rounded-b-sb-l border-t border-sb-rule bg-sb-sunken" data-testid="plan-row-next">
                  <NextActionItem action={p.nextAction} testId="plan-row-next-action" />
                  {p.nextActionCount > 1 ? (
                    <p data-note="" className="px-3 pb-2.5 pl-[2.625rem] text-sm text-sb-ink-3" data-testid="plan-row-next-count">
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
