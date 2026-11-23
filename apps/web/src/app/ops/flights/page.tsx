import type { Metadata } from "next";
import Link from "next/link";
import { RecordFilter } from "@/components/ops/record-filter";
import { Badge, buttonFieldClass, CellLabel, ListHead, listRowClass, Note, PageHeader } from "@/components/ops/ui";
import { formatHm } from "@/lib/ops-time";
import { JudgementMissing } from "@/components/ops/plan-ui";
import { MismatchBadges } from "@/components/ops/journal-ui";
import { JUDGEMENT_LINK_MISSING_LABEL, listFlights, parseRecordFilter } from "@/server/ops/records";
import { listAircraft, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { BACK_TO } from "@/components/ops/ops-nav-model";

// 狭い画面のカード：1 行目に飛行年月日と機体、2 行目に離着陸時刻と飛行時間、3 行目に操縦者と総飛行時間。
// 広い画面では表の 1 行（列の順は見出しのとおり）。
const GRID = "grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[6.5rem_minmax(0,8rem)_minmax(0,1fr)_8rem_4rem_6rem] sm:gap-x-4";
const CARD = listRowClass.replace("grid-cols-1 ", "");

// 飛行記録の一覧（新しい順。機体・期間で絞り込み）。各行に飛行年月日・機体・操縦者・離着陸時刻・飛行時間・総飛行時間。
export const metadata: Metadata = { title: "飛行記録" };

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
        back={BACK_TO.journal}
        aside={
          canCreate ? (
            <Link href="/ops/flights/new" className={buttonFieldClass}>
              飛行記録を入力
            </Link>
          ) : null
        }
      >
        {canCreate ? null : <Note body>{recordCreateDenied(me)}</Note>}
      </PageHeader>
      <RecordFilter basePath="/ops/flights" aircraft={aircraft} value={filter} />
      <p className="sb-num text-sm tnum text-sb-ink-3">{rows.length} 件</p>
      {rows.length === 0 ? (
        <p className="border-y border-sb-rule py-6 text-center text-sm text-sb-ink-3">飛行記録はありません。</p>
      ) : (
        <div className="flex flex-col">
          <ListHead columns={["飛行年月日", "機体", "操縦者", "離陸–着陸", "飛行時間", "総飛行時間"]} gridClass={GRID} />
          <ul className="flex flex-col gap-2 sm:gap-0" data-testid="flight-list">
            {rows.map((f) => (
              <li key={f.id}>
                <Link prefetch={false} href={`/ops/flights/${f.id}`} className={`${CARD} ${GRID} ${f.voided ? "text-sb-ink-3" : ""}`}>
                  <span className="col-start-1 row-start-1 sb-num tnum text-sb-ink sm:col-auto sm:row-auto">
                    <span className="sr-only">飛行年月日</span>
                    {f.flightDate}
                  </span>
                  <span className="col-span-2 col-start-2 row-start-1 min-w-0 break-all sb-num text-sb-ink-2 sm:col-span-1 sm:col-auto sm:row-auto">
                    <span className="sr-only">機体</span>
                    {f.registrationMark}
                  </span>
                  <span className="col-span-2 col-start-1 row-start-3 min-w-0 break-words text-sb-ink-2 sm:col-span-1 sm:col-auto sm:row-auto sm:text-sb-ink">
                    <CellLabel>操縦者</CellLabel>
                    {f.pilotName}
                  </span>
                  <span className="col-span-2 col-start-1 row-start-2 sb-num text-base tnum text-sb-ink sm:col-span-1 sm:col-auto sm:row-auto sm:text-sm">
                    <span className="sr-only">離陸–着陸</span>
                    {f.takeoffAtJst.slice(11)}–{f.landingAtJst}
                  </span>
                  <span className="col-start-3 row-start-2 text-right sb-num text-base tnum sm:col-auto sm:row-auto sm:text-left sm:text-sm">
                    <CellLabel>飛行時間</CellLabel>
                    {formatHm(f.flightMinutes)}
                  </span>
                  <span className="col-start-3 row-start-3 flex flex-wrap items-center justify-end gap-1.5 sb-num tnum sm:col-auto sm:row-auto sm:justify-start">
                    <CellLabel>総飛行時間</CellLabel>
                    {f.totalFlightMinutes === null ? <Badge tone="red">取消済み</Badge> : formatHm(f.totalFlightMinutes)}
                  </span>
                  {f.mismatches.length > 0 ? (
                    <span className="col-span-3 col-start-1 row-start-5 sm:col-span-6 sm:row-auto">
                      <MismatchBadges mismatches={f.mismatches} />
                    </span>
                  ) : null}
                  {f.judgementLink === "missing" ? (
                    <span className="col-span-3 col-start-1 row-start-4 sm:col-span-6 sm:row-auto" data-testid="flight-judgement-missing">
                      <JudgementMissing label={JUDGEMENT_LINK_MISSING_LABEL} />
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
