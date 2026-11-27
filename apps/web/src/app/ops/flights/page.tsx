import type { Metadata } from "next";
import Link from "next/link";
import { RecordFilter } from "@/components/ops/record-filter";
import { buttonFieldClass, Note, PageHeader } from "@/components/ops/ui";
import { ListCardLink } from "@/components/ui/sb-parts";
import { FlightCardBody } from "@/components/ops/journal-ui";
import { listFlights, parseRecordFilter } from "@/server/ops/records";
import { listAircraft, OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { BACK_TO } from "@/components/ops/ops-nav-model";

// 飛行記録の一覧（新しい順。機体・期間で絞り込み）。各カードに飛行年月日・機体・操縦者・離着陸時刻・飛行時間・総飛行時間（16-J J-1：一覧カード。日誌の飛行記録のカードと同じ部品）。
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
            <Link href="/ops/flights/new" data-variant="primary" className={buttonFieldClass}>
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
        <p className="sb-block-soft text-sb-ink-2">飛行記録はありません。</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="flight-list">
          {rows.map((f) => (
            <li key={f.id}>
              <ListCardLink href={`/ops/flights/${f.id}`} data-testid="flight-row">
                <FlightCardBody f={f} showTotal />
              </ListCardLink>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
