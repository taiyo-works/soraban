import type { Metadata } from "next";
import Link from "next/link";
import { RecordFilter } from "@/components/ops/record-filter";
import { Icon } from "@/components/ui/icons";
import { Notice, PageHeader } from "@/components/ops/ui";
import { PillLink } from "@/components/ui/sb-parts";
import { pendingPreflightInspections } from "@/lib/inspection-pending";
import { INSPECTION_TIMING_LABELS, INSPECTION_TIMINGS, type InspectionTiming } from "@/lib/ops-records";
import { listInspections, parseRecordFilter } from "@/server/ops/records";
import { listAircraft, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { getToday } from "@/server/ops/today";

// 点検（Sprint 12h PR ③a：メニューの 1 段目の画面。これまでは日誌の下の一覧だった）。
// 上から 「新しい点検」→「未実施」（今日の計画で、飛行前の点検がまだないもの。記録より上）→「記録」（区分・機体・期間で絞り込み、新しい順）。
// 未実施の範囲：今日の飛行前だけ。飛行後・過去日・先の日は、運用の取り決めが決まるまで出さない（lib/inspection-pending.ts）。
export const metadata: Metadata = { title: "点検" };

const NEXT_ACTIONS_ALL = 200;

const parseTiming = (v: string | undefined): InspectionTiming | null => (INSPECTION_TIMINGS as readonly string[]).includes(v ?? "") ? (v as InspectionTiming) : null;

/** 区分の絞り込みのチップの行き先（機体・期間などの絞り込みは引き継ぐ）。 */
const chipHref = (sp: Record<string, string | undefined>, timing: InspectionTiming | null): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (k !== "timing" && v) q.set(k, v);
  if (timing) q.set("timing", timing);
  const s = q.toString();
  return s ? `/ops/inspections?${s}` : "/ops/inspections";
};

function SecHead({ title, aside, testId }: { readonly title: string; readonly aside?: string; readonly testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="sb-sec-head flex-1" style={{ marginBottom: 0 }}>
        <h2>{title}</h2>
      </div>
      {aside ? (
        <p className="sb-num text-[13px] text-sb-ink-3" {...(testId ? { "data-testid": testId } : {})}>
          {aside}
        </p>
      ) : null}
    </div>
  );
}

export default async function InspectionListPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, me } = await requireOpsMember();
  const sp = await searchParams;
  let filter;
  try {
    filter = parseRecordFilter(sp);
  } catch (e) {
    if (!(e instanceof OpsError)) throw e;
    filter = {};
  }
  const timing = parseTiming(sp["timing"]);
  const [rows, aircraft, today] = await Promise.all([listInspections(ctx, filter, timing ?? undefined), listAircraft(ctx, true), getToday(ctx, { limit: NEXT_ACTIONS_ALL })]);
  const pending = pendingPreflightInspections(today);
  const denied = recordCreateDenied(me);
  const canCreate = denied === null;
  return (
    <main className="flex flex-col gap-6" data-testid="ops-inspections">
      <PageHeader title="点検" meta="飛行前・飛行後の日常点検" />

      {canCreate ? (
        <div className="flex flex-col sm:items-start">
          <PillLink variant="primary" href="/ops/inspections/new" data-testid="inspection-new">
            新しい点検
          </PillLink>
        </div>
      ) : (
        <Notice>{denied}</Notice>
      )}

      <section aria-label="未実施" className="flex flex-col gap-3" data-testid="inspection-pending">
        <SecHead title="未実施" aside={`${pending.length} 件`} testId="inspection-pending-count" />
        <p className="text-[13px] text-sb-ink-3" data-testid="inspection-pending-scope">
          今日の計画で、飛行前の点検の記録がまだないものです。
        </p>
        {pending.length === 0 ? (
          <p className="sb-block-soft text-table text-sb-ink-2" data-testid="inspection-pending-empty">
            未実施の点検はありません。
          </p>
        ) : (
          <div className="sb-block">
            <ul className="sb-rows flex flex-col" data-testid="inspection-pending-list">
              {pending.map((p) => {
                const body = (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="sb-tag sb-tag-deadline">今日</span>
                        <span className="sb-tag">飛行前</span>
                        <span className="sb-tag sb-tag-strong">－ 未実施</span>
                      </span>
                      <span className="text-body font-bold text-sb-ink [text-wrap:pretty]" data-testid="inspection-pending-title">
                        {p.title}
                        {p.timeLabel ? <span className="sb-num ml-2 text-table font-medium text-sb-ink-2">{p.timeLabel}</span> : null}
                      </span>
                      {p.registrationMark ? (
                        <span className="text-[13px] text-sb-ink-3">
                          機体 <span className="sb-num text-sb-ink-2">{p.registrationMark}</span>
                        </span>
                      ) : null}
                      {p.canAct ? null : (
                        <span className="text-table text-sb-ink-3" data-testid="inspection-pending-cannot">
                          点検の入力は、運航管理者または計画の操縦者本人が行います。
                        </span>
                      )}
                    </span>
                    {p.canAct ? (
                      <span className="sb-go-dot" aria-hidden="true">
                        <Icon name="chevron-right" size={20} />
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <li key={p.planId} data-testid="inspection-pending-row" data-plan-id={p.planId}>
                    {p.canAct ? (
                      <a href={p.href} className="sb-row" data-testid="inspection-pending-link" aria-label={`点検を入力する：${p.title}`}>
                        {body}
                      </a>
                    ) : (
                      <div className="sb-row">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section aria-label="記録" className="flex flex-col gap-3" data-testid="inspection-records">
        <SecHead title="記録" aside="新しい順" />
        <nav aria-label="区分で絞り込む" className="sb-chips" data-testid="inspection-timing-filter">
          {([null, ...INSPECTION_TIMINGS] as const).map((t) => (
            // 同じ画面の ?timing= の切り替えは通常のリンク（<a>。画面ごと読み直す）。next/link だと、行き来を繰り返すうちに、サーバーが 200 を返しているのに
            // 画面と URL が切り替わらないことがある（Sprint 12h PR ③b1 の調査：docs/evaluations/12h-pr3b1-test-changes.md §E）。prefetch={false} でも直らなかった
            <a key={t ?? "all"} href={chipHref(sp, t)} aria-current={timing === t ? "true" : undefined} className="sb-chip" data-testid={`inspection-timing-${t ?? "all"}`}>
              {t ? INSPECTION_TIMING_LABELS[t] : "すべて"}
            </a>
          ))}
        </nav>
        <RecordFilter basePath="/ops/inspections" aircraft={aircraft} value={filter} hidden={timing ? { timing } : {}} />
        <p className="sb-num text-[13px] text-sb-ink-3" data-testid="inspection-count">
          {rows.length} 件
        </p>
        {rows.length === 0 ? (
          <p className="sb-block-soft text-table text-sb-ink-2" data-testid="inspection-empty">
            日常点検の記録はありません。
          </p>
        ) : (
          <div className="sb-block">
            <ul className="sb-rows flex flex-col" data-testid="inspection-list">
              {rows.map((i) => (
                <li key={i.id}>
                  <Link href={`/ops/inspections/${i.id}`} prefetch={false} className="sb-row" data-testid="inspection-row">
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="sb-tag sb-num">
                          <span className="sr-only">実施日時</span>
                          {i.inspectedAtJst}
                        </span>
                        <span className="sb-tag">
                          <span className="sr-only">区分</span>
                          {INSPECTION_TIMING_LABELS[i.timing]}
                        </span>
                        <span className="sr-only">結果</span>
                        {i.hasAbnormal ? (
                          <span className="sb-tag sb-tag-strong" data-result="abnormal">
                            <span aria-hidden="true">！ </span>異常あり
                          </span>
                        ) : (
                          <span className="sb-tag" data-result="normal">
                            <span aria-hidden="true">✓ </span>正常
                          </span>
                        )}
                        {i.voided ? <span className="sb-tag">取消済み</span> : null}
                      </span>
                      <span className={`text-body font-bold ${i.voided ? "text-sb-ink-3 line-through" : "text-sb-ink"}`}>
                        <span className="sr-only">機体</span>
                        <span className="sb-num break-all">{i.registrationMark}</span>
                      </span>
                      <span className="break-words text-table text-sb-ink-2">
                        <span className="text-[13px] text-sb-ink-3">実施者 </span>
                        {i.inspectorName}
                      </span>
                    </span>
                    <span className="sb-go-dot" aria-hidden="true">
                      <Icon name="chevron-right" size={20} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
