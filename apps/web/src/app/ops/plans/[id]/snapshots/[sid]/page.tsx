import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PERMIT_VALUE_LABEL,
  PLAN_JUDGEMENT_DISCLAIMER,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  type FlightVerdict,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { Badge, DetailList, Note, PageHeader, Section } from "@/components/ops/ui";
import { PermitBasisSection } from "@/components/ops/permit-ui";
import { DipsNotice, ReportBox, SNAPSHOT_REASON_LABEL } from "@/components/ops/plan-ui";
import { VerdictSummary } from "@/components/verdict-summary";
import { formatJst } from "@/lib/ops-time";
import { requireOpsMember } from "@/server/ops/page";
import { verdictPermitNotesFromBasis } from "@/server/ops/permit-page";
import { getPlan, getSnapshot } from "@/server/ops/plans";
import { OpsError } from "@/server/ops/service";

const mono = "sb-num text-xs tnum break-all";

// 判定の根拠：保存した判定の結果を、判定画面と同じ部品で読み取り専用に描く。再計算はしない（保存したものを見せる）。
// 証跡 ID（地点判定・申請支援）、エンジンの版、使ったデータセット（名称・基準年・確認日）、手続きデータの版と確認日、作成者・日時、ハッシュ。
export default async function SnapshotDetailPage({ params }: { readonly params: Promise<{ id: string; sid: string }> }) {
  const { ctx } = await requireOpsMember();
  const { id, sid } = await params;
  let plan;
  let s;
  try {
    plan = await getPlan(ctx, id);
    s = await getSnapshot(ctx, id, sid);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const verdict = (s.result as { verdict?: FlightVerdict }).verdict;
  const input = s.input as {
    lat?: number;
    lng?: number;
    droneWeightG?: number | null;
    flags?: string[];
    plannedDate?: string;
    pilotPermits?: string[];
    purpose?: string;
  };
  return (
    <main className="flex flex-col gap-10">
      <PageHeader
        eyebrow={`判定の根拠 — ${plan.title}`}
        title={<span data-testid="basis-heading">判定 {s.seq}</span>}
        back={{ href: `/ops/plans/${id}/snapshots`, label: "判定の履歴" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {s.isCurrent ? <Badge tone="brand" data-testid="snapshot-current">現在の判定</Badge> : <Badge tone="mute" data-testid="snapshot-past">過去の判定</Badge>}
          <span className="text-xs text-sb-ink-2">{SNAPSHOT_REASON_LABEL[s.reason] ?? s.reason}</span>
        </div>
        <Note>{PLAN_JUDGEMENT_DISCLAIMER}</Note>
      </PageHeader>

      <Section title="判定の結果" aria-label="判定の結果" description="計画を保存したときにサーバーが実行して保存した結果です。ここでは再計算しません。">
        <VerdictSummary verdict={verdict} pending={false} failed={verdict === undefined} permitNotes={verdictPermitNotesFromBasis(s.permitBasis)} />
      </Section>

      <Section title="根拠の記録" aria-label="根拠の記録">
        <DetailList
          data-testid="basis-facts"
          rows={[
            ["地点判定の証跡 ID", <span key="c" className={mono} data-testid="basis-check-evidence">{s.checkEvidenceId}</span>],
            ["申請支援の証跡 ID", <span key="d" className={mono} data-testid="basis-diagnosis-evidence">{s.diagnosisEvidenceId}</span>],
            ["エンジンの版", <span key="e" className={mono} data-testid="basis-engine">{s.engineVersion}</span>],
            ["判定の日時", <time key="t" dateTime={s.checkedAt} className="sb-num text-xs tnum">{formatJst(new Date(s.checkedAt))}（{s.checkedAt}）</time>],
            [
              "手続きデータの版",
              <span key="pr" className="sb-num text-xs tnum" data-testid="basis-procedures">
                第 {s.proceduresRevision} 版・確認日 {s.proceduresVerifiedAt}
              </span>,
            ],
            ["作成者", s.createdByName ?? "—"],
            ["作成日時（日本時間）", <time key="ca" dateTime={s.createdAt} className="sb-num text-xs tnum">{formatJst(new Date(s.createdAt))}</time>],
            ["直前のハッシュ", <span key="ph" className={mono}>{s.prevHash}</span>],
            ["内容のハッシュ", <span key="ch" className={mono} data-testid="basis-hash">{s.contentHash}</span>],
          ]}
        />
      </Section>

      <Section title="使ったデータセット" aria-label="使ったデータセット" description="名称・基準年・確認日。確認日が古い（90 日超）ものは印を付けます。">
        {s.datasets.length === 0 ? (
          <p className="sb-block-soft text-sm text-sb-ink-2">記録されたデータセットはありません。</p>
        ) : (
          <ul className="opx-card flex flex-col !py-2" data-testid="basis-datasets">
            {s.datasets.map((d) => {
              const stale = s.staleSources.some((x) => x.id === d.id);
              return (
                <li key={d.id} className="flex flex-col gap-0.5 border-b border-sb-rule py-2.5 text-sm last:border-b-0" data-testid="basis-dataset">
                  <span className="text-sb-ink">{d.name}</span>
                  <span className="sb-num text-xs tnum text-sb-ink-2">
                    基準年 {d.baseYear ?? "—"}／確認日 {d.verifiedAt}
                    {stale ? <Badge tone="amber">確認日が古い</Badge> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="判定の入力" aria-label="判定の入力" description="この判定に使った入力です（機体の重量は登録した最大離陸重量）。">
        <DetailList
          data-testid="basis-input"
          rows={[
            ["座標", <span key="l" className="sb-num text-xs tnum">{input.lat}, {input.lng}</span>],
            ["機体重量", input.droneWeightG === null || input.droneWeightG === undefined ? "未登録（重量が分からない）" : `${input.droneWeightG} g`],
            ["予定日", input.plannedDate ?? "—"],
            ["飛行の方法・空域（選択）", (input.flags ?? []).length === 0 ? "なし" : (input.flags ?? []).map((f) => SPECIFIC_FLIGHT_FLAG_LABEL[f as SpecificFlightFlag] ?? f).join("、")],
            ["許可・承認・同意（登録の照合で足した DIPS の値を含む）", (input.pilotPermits ?? []).length === 0 ? "なし" : (input.pilotPermits ?? []).map((p) => PERMIT_VALUE_LABEL[p] ?? p).join("、")],
          ]}
        />
      </Section>

      <PermitBasisSection basis={s.permitBasis} />

      <Section title="通報の要否" aria-label="通報の要否" description="この判定から求めた通報の要否です。">
        <ReportBox report={s.report} />
      </Section>

      <div className="flex flex-wrap gap-3">
        <Link prefetch={false} href={`/ops/plans/${id}`} className="opx-underlink text-sm" data-testid="basis-plan-link">
          飛行計画に戻る
        </Link>
      </div>
      <DipsNotice />
    </main>
  );
}
