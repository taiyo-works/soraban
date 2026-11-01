import { safeReturnTo } from "@/lib/ops-return";
import { notFound } from "next/navigation";
import { ChangeNotice } from "@/components/ops/change-notice";
import { PlanTabs } from "@/components/ops/plan-frame";
import { Note, PageHeader } from "@/components/ops/ui";
import { ReportScreen } from "@/components/ops/report-client";
import { requireOpsMember } from "@/server/ops/page";
import { getPlanReport } from "@/server/ops/reports";
import { OpsError } from "@/server/ops/service";
import type { ReportKind } from "@soraban/dips";

// 通報の画面（Sprint 12b 設計 H）：通報内容を DIPS の入力順に並べて項目ごとにコピーし、通報の結果を記録する。
// そらばんは DIPS に送信しない。記録するまで「通報済み」とは出さない。表示用の文言は @soraban/dips の定数だけを使う。
export default async function PlanReportPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  const sp = await searchParams;
  const k = sp["kind"];
  const kind: ReportKind | undefined = k === "new" || k === "change" || k === "cancel" ? k : undefined;
  let view;
  try {
    view = await getPlanReport(ctx, id, kind ? { kind } : {});
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    if (e instanceof OpsError && e.status === 503) {
      return (
        <main className="flex max-w-xl flex-col gap-4" data-testid="report-unavailable">
          <h1 className="opx-h1">通報の機能を使えません</h1>
          <Note tone="red">通報の送信元の設定が正しくありません。管理者に連絡してください。</Note>
        </main>
      );
    }
    throw e;
  }
  return (
    <main className="flex flex-col gap-8">
      <PageHeader
        eyebrow="通報の内容"
        back={safeReturnTo(sp["returnTo"]) ? { href: safeReturnTo(sp["returnTo"])!, label: "現場モードへ戻る" } : { href: `/ops/plans/${view.planId}`, label: "飛行計画の詳細" }}
        title={<span className="break-words" data-testid="report-plan-title">{view.planTitle}</span>}
      />
      <PlanTabs planId={view.planId} current="report" />
      <ChangeNotice target="report" />
      <ReportScreen key={`${view.planVersion}-${view.reports.length}-${view.reports[0]?.version ?? 0}`} initial={view} memberId={me.member.id} />
    </main>
  );
}
