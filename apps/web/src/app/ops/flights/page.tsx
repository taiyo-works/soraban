import Link from "next/link";
import { RecordFilter } from "@/components/ops/record-filter";
import { Badge, buttonPrimaryClass, CellLabel, ListHead, listRowClass, Note, PageHeader } from "@/components/ops/ui";
import { formatHm } from "@/lib/ops-time";
import { listFlights, parseRecordFilter } from "@/server/ops/records";
import { listAircraft, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied } from "@/server/ops/record-page";

const GRID = "sm:grid-cols-[6.5rem_minmax(0,8rem)_minmax(0,1fr)_7rem_4rem_5rem]";

// 飛行記録の一覧（新しい順。機体・期間で絞り込み）。各行に飛行年月日・機体・操縦者・離着陸時刻・飛行時間・総飛行時間。
export default async function FlightListPage({
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
  const [rows, aircraft] = await Promise.all([listFlights(ctx, filter), listAircraft(ctx, true)]);
  const canCreate = recordCreateDenied(me) === null;
  return (
    <main className="flex flex-col gap-6">
      <PageHeader
        title="飛行記録"
        back={{ href: "/ops", label: "運航管理のトップ" }}
        aside={
          canCreate ? (
            <Link href="/ops/flights/new" className={`${buttonPrimaryClass} min-h-12`}>
              飛行記録を入力
            </Link>
          ) : null
        }
      >
        {canCreate ? null : <Note>{recordCreateDenied(me)}</Note>}
      </PageHeader>
      <RecordFilter basePath="/ops/flights" aircraft={aircraft} value={filter} />
      <p className="font-mono text-[11px] tnum text-ink-mute">{rows.length} 件</p>
      {rows.length === 0 ? (
        <p className="border-y border-rule py-6 text-center text-sm text-ink-mute">飛行記録はありません。</p>
      ) : (
        <div className="flex flex-col">
          <ListHead columns={["飛行年月日", "機体", "操縦者", "離陸–着陸", "飛行時間", "総飛行時間"]} gridClass={GRID} />
          <ul className="flex flex-col gap-2 sm:gap-0" data-testid="flight-list">
            {rows.map((f) => (
              <li key={f.id}>
                <Link href={`/ops/flights/${f.id}`} className={`${listRowClass} ${GRID} ${f.voided ? "text-ink-mute" : ""}`}>
                  <span className="font-mono tnum text-ink">
                    <CellLabel>飛行年月日</CellLabel>
                    {f.flightDate}
                  </span>
                  <span className="min-w-0 break-all font-mono text-ink-soft">
                    <CellLabel>機体</CellLabel>
                    {f.registrationMark}
                  </span>
                  <span className="min-w-0 break-words">
                    <CellLabel>操縦者</CellLabel>
                    {f.pilotName}
                  </span>
                  <span className="font-mono text-[13px] tnum">
                    <CellLabel>離陸–着陸</CellLabel>
                    {f.takeoffAtJst.slice(11)}–{f.landingAtJst}
                  </span>
                  <span className="font-mono tnum">
                    <CellLabel>飛行時間</CellLabel>
                    {formatHm(f.flightMinutes)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 font-mono tnum">
                    <CellLabel>総飛行時間</CellLabel>
                    {f.totalFlightMinutes === null ? <Badge tone="red">取消済み</Badge> : formatHm(f.totalFlightMinutes)}
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
