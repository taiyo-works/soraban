import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import type { PlanDto } from "@/server/ops/plans";
import { HashScroll } from "./hash-scroll";
import { PlanStateBadge, StaleBadge } from "./plan-ui";
import { Note, PageHeader } from "./ui";

// 飛行計画の共通の枠（Sprint 17-1）：戻る・タイトル・状態の札・タブ（計画｜通報｜当日｜日誌）。
// 判定は補助の画面（/judgement）で、タブの外に置く。通報の主画面と通報の作業台（/report）は、どちらも「通報」のタブが現在。

export type PlanTabKey = "overview" | "report" | "field" | "journal";

const TABS: readonly { readonly key: PlanTabKey; readonly label: string; readonly path: string }[] = [
  { key: "overview", label: "計画", path: "/overview" },
  { key: "report", label: "通報", path: "" },
  { key: "field", label: "当日", path: "/field" },
  { key: "journal", label: "日誌", path: "/journal" },
];

/** 計画の画面のタブ。current が無い画面（判定）では、どのタブにも aria-current を付けない。 */
export function PlanTabs({ planId, current }: { readonly planId: string; readonly current?: PlanTabKey }) {
  return (
    <nav aria-label="計画の画面" data-testid="plan-tabs" className="grid grid-cols-4 gap-1 rounded-sb-pill bg-sb-sunken p-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          prefetch={false}
          href={`/ops/plans/${planId}${t.path}`}
          aria-current={current === t.key ? "page" : undefined}
          data-testid={`plan-tab-${t.key}`}
          className={cx(
            "flex min-h-12 min-w-0 items-center justify-center rounded-sb-pill px-2 text-base",
            current === t.key ? "bg-sb-inverse font-bold text-sb-inverse-fg" : "font-medium text-sb-ink hover:bg-sb-hover",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** 全タブの共通の枠：見出し（戻る・タイトル・状態の札）＋中止の注記＋タブ。本文は children。 */
export function PlanFrame({
  plan,
  current,
  eyebrow,
  back,
  children,
}: {
  readonly plan: PlanDto;
  readonly current?: PlanTabKey;
  readonly eyebrow: string;
  readonly back?: { readonly href: string; readonly label: string };
  readonly children: ReactNode;
}) {
  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <PageHeader
          eyebrow={eyebrow}
          back={back ?? { href: "/ops/plans", label: "飛行計画の一覧" }}
          title={<span className="break-words" data-testid="plan-title-heading">{plan.title}</span>}
        >
          <div className="flex flex-wrap items-center gap-2">
            <PlanStateBadge state={plan.state} label={plan.stateLabel} />
            {plan.freshness.stale ? <StaleBadge /> : null}
            <span className="sb-num text-sm tnum text-sb-ink-3">版 {plan.version}</span>
          </div>
        </PageHeader>
        {plan.voided ? <Note tone="red" body>この計画は中止されています。記載内容と判定の履歴、版の一覧は残しています。</Note> : null}
        <PlanTabs planId={plan.id} {...(current ? { current } : {})} />
      </div>
      <HashScroll />
      {children}
    </main>
  );
}
