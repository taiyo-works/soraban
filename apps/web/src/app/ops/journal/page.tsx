import Link from "next/link";
import { MismatchBadges } from "@/components/ops/journal-ui";
import { Badge, buttonFieldClass, buttonOutlineBrandClass, Note, PageHeader } from "@/components/ops/ui";
import { INSPECTION_TIMING_LABELS } from "@/lib/ops-records";
import { formatHm, jstDate } from "@/lib/ops-time";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { listFlights, listInspections, nowOf, type FlightDto, type InspectionDto } from "@/server/ops/records";

const RECENT_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;

type Tab = "all" | "flights" | "inspections";
const TABS: readonly (readonly [Tab, string])[] = [
  ["all", "すべて"],
  ["flights", "飛行記録"],
  ["inspections", "日常点検"],
];

/** 種別の札：飛行記録は藍の塗り（▶）、日常点検は枠だけ（✓）。色に頼らず、記号と文字で見分ける。 */
function KindTag({ kind }: { readonly kind: "flight" | "inspection" }) {
  return kind === "flight" ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-sharp border-2 border-brand-700 bg-brand-700 px-2 py-px text-xs font-bold leading-5 text-paper">
      <span aria-hidden>▶</span>飛行記録
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-sharp border-2 border-ink-mute bg-paper px-2 py-px text-xs font-bold leading-5 text-ink">
      <span aria-hidden>✓</span>日常点検
    </span>
  );
}

type Row =
  | { readonly kind: "flight"; readonly at: string; readonly f: FlightDto }
  | { readonly kind: "inspection"; readonly at: string; readonly i: InspectionDto };

// 「日誌」（Sprint 12c 設計 G）：飛行記録と日常点検の入口と、最近 14 日の合算の一覧（日付順。食い違いの札つき）。
// 既存の /ops/flights・/ops/inspections の経路・機能は変えず、入口と見せ方でまとめる。
export default async function OpsJournalPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | undefined>> }) {
  const { ctx, me } = await requireOpsMember();
  const sp = await searchParams;
  const tab: Tab = sp["tab"] === "flights" || sp["tab"] === "inspections" ? sp["tab"] : "all";
  const canCreate = recordCreateDenied(me) === null;
  const now = nowOf(ctx);
  const from = jstDate(new Date(now.getTime() - (RECENT_DAYS - 1) * DAY_MS));
  const to = jstDate(now);
  const [flights, inspections] = await Promise.all([listFlights(ctx, { from, to }), listInspections(ctx, { from, to })]);
  const rows: Row[] = [
    ...(tab !== "inspections" ? flights.map((f): Row => ({ kind: "flight", at: f.takeoffAt, f })) : []),
    ...(tab !== "flights" ? inspections.map((i): Row => ({ kind: "inspection", at: i.inspectedAt, i })) : []),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <main className="flex flex-col gap-6" data-testid="ops-journal">
      <DraftOwnerGuard memberId={me.member.id} />
      <PageHeader title="日誌" eyebrow="飛行記録と日常点検" />
      {canCreate ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link href="/ops/flights/new" prefetch={false} className={buttonFieldClass} data-testid="journal-new-flight">
            飛行記録を入力
          </Link>
          <Link href="/ops/inspections/new" prefetch={false} className={buttonOutlineBrandClass.replace("min-h-11", "min-h-14").replace("text-sm", "text-base")} data-testid="journal-new-inspection">
            日常点検を入力
          </Link>
        </div>
      ) : (
        <Note>{recordCreateDenied(me)}</Note>
      )}
      <nav aria-label="表示する記録" className="grid grid-cols-3 overflow-hidden rounded-sharp border-2 border-brand-700 sm:inline-grid sm:self-start" data-testid="journal-tabs">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={key === "all" ? "/ops/journal" : `/ops/journal?tab=${key}`}
            prefetch={false}
            aria-current={tab === key ? "page" : undefined}
            data-testid={`journal-tab-${key}`}
            className={`inline-flex min-h-12 items-center justify-center gap-1.5 whitespace-nowrap border-l-2 border-brand-700 px-3 text-sm first:border-l-0 sm:px-6 ${tab === key ? "bg-brand-700 font-bold text-paper" : "bg-paper text-brand-700 hover:bg-brand-50"}`}
          >
            {tab === key ? <span aria-hidden>●</span> : null}
            {label}
          </Link>
        ))}
      </nav>
      <p className="font-mono text-[11px] tnum text-ink-soft" data-testid="journal-range">
        最近 {RECENT_DAYS} 日（{from}〜{to}）　{rows.length} 件
      </p>
      {rows.length === 0 ? (
        <p className="border-y border-rule py-6 text-center text-sm text-ink-soft" data-testid="journal-empty">
          最近 {RECENT_DAYS} 日の記録はありません。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule-soft rounded-sharp border border-rule bg-paper" data-testid="journal-list">
          {rows.map((r) =>
            r.kind === "flight" ? (
              <li key={`f-${r.f.id}`} data-testid="journal-row" data-kind="flight">
                <Link prefetch={false} href={`/ops/flights/${r.f.id}`} className="flex min-h-14 flex-col gap-2 border-l-4 border-brand-700 px-3 py-3 text-sm hover:bg-paper-soft" data-testid="journal-row-link">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <KindTag kind="flight" />
                    {r.f.voided ? <Badge tone="red">取消済み</Badge> : null}
                    <span className="font-mono text-base tnum text-ink">{r.f.flightDate}</span>
                    <span className="font-mono text-base text-ink">
                      {r.f.takeoffAtJst.slice(11)}–{r.f.landingAtJst}
                    </span>
                    <span className="font-mono tnum text-ink-soft">{formatHm(r.f.flightMinutes)}</span>
                  </span>
                  <span className="text-ink-soft">
                    <span className="font-mono">{r.f.registrationMark}</span>／{r.f.pilotName}
                  </span>
                  <MismatchBadges mismatches={r.f.mismatches} />
                </Link>
              </li>
            ) : (
              <li key={`i-${r.i.id}`} data-testid="journal-row" data-kind="inspection">
                <Link prefetch={false} href={`/ops/inspections/${r.i.id}`} className="flex min-h-14 flex-col gap-2 border-l-4 border-ink-mute px-3 py-3 text-sm hover:bg-paper-soft" data-testid="journal-row-link">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <KindTag kind="inspection" />
                    {r.i.voided ? <Badge tone="red">取消済み</Badge> : null}
                    <span className="font-mono text-base tnum text-ink">{r.i.inspectedAtJst}</span>
                    <span className="text-ink-soft">{INSPECTION_TIMING_LABELS[r.i.timing]}</span>
                    {r.i.hasAbnormal ? (
                      <Badge tone="red">
                        <span aria-hidden>！ </span>異常あり
                      </Badge>
                    ) : (
                      <Badge tone="green">
                        <span aria-hidden>✓ </span>異常なし
                      </Badge>
                    )}
                  </span>
                  <span className="text-ink-soft">
                    <span className="font-mono">{r.i.registrationMark}</span>／{r.i.inspectorName}
                  </span>
                </Link>
              </li>
            ),
          )}
        </ul>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/ops/flights" prefetch={false} className="inline-flex min-h-11 items-center text-brand-700 underline underline-offset-2" data-testid="journal-flights-link">
          飛行記録の一覧へ
        </Link>
        <Link href="/ops/inspections" prefetch={false} className="inline-flex min-h-11 items-center text-brand-700 underline underline-offset-2" data-testid="journal-inspections-link">
          日常点検の一覧へ
        </Link>
      </div>
    </main>
  );
}
