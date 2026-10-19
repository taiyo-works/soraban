import Link from "next/link";
import { RecordFilter } from "@/components/ops/record-filter";
import { Badge, buttonPrimaryClass, CellLabel, ListHead, listRowClass, Note, PageHeader } from "@/components/ops/ui";
import { INSPECTION_TIMING_LABELS } from "@/lib/ops-records";
import { listInspections, parseRecordFilter } from "@/server/ops/records";
import { listAircraft, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied } from "@/server/ops/record-page";

const GRID = "sm:grid-cols-[9rem_minmax(0,8rem)_minmax(0,1fr)_4rem_6rem]";

// 日常点検記録の一覧（新しい順。機体・期間で絞り込み）。
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
        back={{ href: "/ops", label: "運航管理のトップ" }}
        aside={
          canCreate ? (
            <Link href="/ops/inspections/new" className={`${buttonPrimaryClass} min-h-12`}>
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
                <Link href={`/ops/inspections/${i.id}`} className={`${listRowClass} ${GRID} ${i.voided ? "text-ink-mute" : ""}`}>
                  <span className="font-mono text-[13px] tnum text-ink">
                    <CellLabel>実施日時</CellLabel>
                    {i.inspectedAtJst}
                  </span>
                  <span className="min-w-0 break-all font-mono text-ink-soft">
                    <CellLabel>機体</CellLabel>
                    {i.registrationMark}
                  </span>
                  <span className="min-w-0 break-words">
                    <CellLabel>実施者</CellLabel>
                    {i.inspectorName}
                  </span>
                  <span>
                    <CellLabel>区分</CellLabel>
                    {INSPECTION_TIMING_LABELS[i.timing]}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <CellLabel>結果</CellLabel>
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
