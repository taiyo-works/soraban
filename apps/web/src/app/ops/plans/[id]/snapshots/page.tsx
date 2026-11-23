import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Note, PageHeader } from "@/components/ops/ui";
import { DipsNotice, SNAPSHOT_REASON_LABEL, VerdictBadge } from "@/components/ops/plan-ui";
import { formatJst } from "@/lib/ops-time";
import { requireOpsMember } from "@/server/ops/page";
import { getPlan, listSnapshots } from "@/server/ops/plans";
import { OpsError } from "@/server/ops/service";

// 判定スナップショットの一覧（通し番号・作成日時・理由・結論・証跡 ID・エンジンの版）。現在のものに印を付ける。
// スナップショットは不変で、判定をやり直しても前のものは残る。
export default async function SnapshotListPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx } = await requireOpsMember();
  const { id } = await params;
  let plan;
  try {
    plan = await getPlan(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const list = await listSnapshots(ctx, id);
  return (
    <main className="flex flex-col gap-6">
      <PageHeader title="判定の履歴" eyebrow={plan.title} back={{ href: `/ops/plans/${id}/judgement`, label: "判定" }}>
        <Note body>判定をやり直しても、前の判定は書き換えられず、ここに残ります。</Note>
      </PageHeader>
      <ol className="flex flex-col gap-3" data-testid="snapshot-list">
        {[...list].reverse().map((s) => (
          <li key={s.id}>
            <Link prefetch={false}
              href={`/ops/plans/${id}/snapshots/${s.id}`}
              className="opx-row opx-row-card"
              data-testid="snapshot-row"
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="sb-num text-sm font-bold tnum" data-testid="snapshot-seq">
                  判定 {s.seq}
                </span>
                {s.isCurrent ? <Badge tone="brand" data-testid="snapshot-current">現在の判定</Badge> : null}
                <time dateTime={s.createdAt} className="sb-num text-sm tnum text-sb-ink-2">
                  {formatJst(new Date(s.createdAt))}
                </time>
                <span className="text-sm text-sb-ink-2" data-testid="snapshot-reason">
                  {SNAPSHOT_REASON_LABEL[s.reason] ?? s.reason}
                </span>
              </span>
              <VerdictBadge level={s.verdictLevel} unknownCount={s.verdictUnknownCount} />
              <span className="break-all sb-num text-sm tnum text-sb-ink-3">
                地点判定 {s.checkEvidenceId}
                <span aria-hidden className="mx-1.5">／</span>
                方法を含む判定 {s.diagnosisEvidenceId}
              </span>
              <span className="break-all sb-num text-sm tnum text-sb-ink-3">{s.engineVersion}</span>
            </Link>
          </li>
        ))}
      </ol>
      <DipsNotice />
    </main>
  );
}
