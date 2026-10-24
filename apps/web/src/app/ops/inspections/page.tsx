import type { Metadata } from "next";
import Link from "next/link";
import { RecordFilter } from "@/components/ops/record-filter";
import { Badge, buttonFieldClass, CellLabel, ListHead, listRowClass, Note, PageHeader } from "@/components/ops/ui";
import { INSPECTION_TIMING_LABELS } from "@/lib/ops-records";
import { listInspections, parseRecordFilter } from "@/server/ops/records";
import { listAircraft, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { BACK_TO } from "@/components/ops/ops-nav-model";

// 狭い画面のカード：1 行目に実施日時と結果、2 行目に機体と区分、3 行目に実施者。広い画面では表の 1 行。
const GRID = "grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[9rem_minmax(0,8rem)_minmax(0,1fr)_4rem_9rem] sm:gap-x-4";
const CARD = listRowClass.replace("grid-cols-1 ", "");

// 日常点検記録の一覧（新しい順。機体・期間で絞り込み）。
export const metadata: Metadata = { title: "日常点検" };

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
  const [rows, aircraft] = await Promise.all([listInspections(ctx, filter), listAircraft(ctx, true)]);
  const canCreate = recordCreateDenied(me) === null;
  return (
    <main className="flex flex-col gap-6">
      <PageHeader
        title="日常点検"
        back={BACK_TO.journal}
        aside={
          canCreate ? (
            <Link href="/ops/inspections/new" className={buttonFieldClass}>
              日常点検を入力
            </Link>
          ) : null
        }
      >
        {canCreate ? null : <Note>{recordCreateDenied(me)}</Note>}
      </PageHeader>
      <RecordFilter basePath="/ops/inspections" aircraft={aircraft} value={filter} />
      <p className="font-mono text-[11px] tnum text-ink-mute">{rows.length} 件</p>
      {rows.length === 0 ? (
        <p className="border-y border-rule py-6 text-center text-sm text-ink-mute">日常点検の記録はありません。</p>
      ) : (
        <div className="flex flex-col">
          <ListHead columns={["実施日時", "機体", "実施者", "区分", "結果"]} gridClass={GRID} />
          <ul className="flex flex-col gap-2 sm:gap-0" data-testid="inspection-list">
            {rows.map((i) => (
              <li key={i.id}>
                <Link href={`/ops/inspections/${i.id}`} className={`${CARD} ${GRID} ${i.voided ? "text-ink-mute" : ""}`}>
                  <span className="col-start-1 row-start-1 font-mono text-base tnum text-ink sm:col-auto sm:row-auto sm:text-[13px]">
                    <span className="sr-only">実施日時</span>
                    {i.inspectedAtJst}
                  </span>
                  <span className="col-start-1 row-start-2 min-w-0 break-all font-mono text-ink-soft sm:col-auto sm:row-auto">
                    <span className="sr-only">機体</span>
                    {i.registrationMark}
                  </span>
                  <span className="col-span-2 col-start-1 row-start-3 min-w-0 break-words text-ink-soft sm:col-span-1 sm:col-auto sm:row-auto sm:text-ink">
                    <CellLabel>実施者</CellLabel>
                    {i.inspectorName}
                  </span>
                  <span className="col-start-2 row-start-2 text-right text-ink-soft sm:col-auto sm:row-auto sm:text-left sm:text-ink">
                    <span className="sr-only">区分</span>
                    {INSPECTION_TIMING_LABELS[i.timing]}
                  </span>
                  <span className="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-1.5 sm:col-auto sm:row-auto sm:justify-start">
                    <span className="sr-only">結果</span>
                    {i.hasAbnormal ? <Badge tone="red">異常あり</Badge> : <Badge tone="green">正常</Badge>}
                    {i.voided ? <Badge tone="red">取消済み</Badge> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
