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
      <PageHeader title="判定の履歴" eyebrow={plan.title} back={{ href: `/ops/plans/${id}`, label: "飛行計画の詳細" }}>
        <Note>判定をやり直しても、前の判定は書き換えられず、ここに残ります。</Note>
      </PageHeader>
      <ol className="flex flex-col gap-2" data-testid="snapshot-list">
        {[...list].reverse().map((s) => (
          <li key={s.id}>
            <Link prefetch={false}
              href={`/ops/plans/${id}/snapshots/${s.id}`}
              className="flex flex-col gap-1.5 rounded-sharp border border-rule bg-paper px-3 py-3 text-sm hover:bg-paper-soft"
              data-testid="snapshot-row"
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-sm tnum" data-testid="snapshot-seq">
                  判定 {s.seq}
                </span>
                {s.isCurrent ? <Badge tone="brand" data-testid="snapshot-current">現在の判定</Badge> : null}
                <time dateTime={s.createdAt} className="font-mono text-xs tnum text-ink-soft">
                  {formatJst(new Date(s.createdAt))}
                </time>
                <span className="text-xs text-ink-soft" data-testid="snapshot-reason">
                  {SNAPSHOT_REASON_LABEL[s.reason] ?? s.reason}
                </span>
              </span>
              <VerdictBadge level={s.verdictLevel} unknownCount={s.verdictUnknownCount} />
              <span className="break-all font-mono text-[11px] tnum text-ink-mute">
                地点判定 {s.checkEvidenceId}
                <span aria-hidden className="mx-1.5">／</span>
                申請支援 {s.diagnosisEvidenceId}
              </span>
              <span className="break-all font-mono text-[11px] tnum text-ink-mute">{s.engineVersion}</span>
            </Link>
          </li>
        ))}
      </ol>
      <DipsNotice />
    </main>
  );
}
