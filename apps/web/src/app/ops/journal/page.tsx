import type { Metadata } from "next";
import Link from "next/link";
import { MismatchBadges } from "@/components/ops/journal-ui";
import { Icon } from "@/components/ui/icons";
import { Notice, PageHeader } from "@/components/ops/ui";
import { INSPECTION_TIMING_LABELS } from "@/lib/ops-records";
import { formatHm, jstDate } from "@/lib/ops-time";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { listFlights, listInspections, nowOf, type FlightDto, type InspectionDto } from "@/server/ops/records";

const RECENT_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;

type Tab = "all" | "flights" | "inspections";
/** 事故・ヒヤリハット（incidents）は一覧が別の画面（/ops/incidents。URL は変えない）なので、切り替えではなくそこへの入口。 */
const TABS: readonly (readonly [Tab | "incidents", string, string])[] = [
  ["all", "すべて", "/ops/journal"],
  ["flights", "飛行記録", "/ops/journal?tab=flights"],
  ["inspections", "日常点検", "/ops/journal?tab=inspections"],
  ["incidents", "事故・ヒヤリハット", "/ops/incidents"],
];

/** 種別の札：形の違う記号（アイコン）と文字で見分ける。 */
function KindTag({ kind }: { readonly kind: "flight" | "inspection" }) {
  return kind === "flight" ? (
    <span className="sb-tag sb-tag-strong">
      <Icon name="flight" size={14} />
      飛行記録
    </span>
  ) : (
    <span className="sb-tag">
      <Icon name="inspection" size={14} />
      日常点検
    </span>
  );
}

type Row =
  | { readonly kind: "flight"; readonly at: string; readonly f: FlightDto }
  | { readonly kind: "inspection"; readonly at: string; readonly i: InspectionDto };

// 「日誌」（Sprint 12c 設計 G）：飛行記録と日常点検の入口と、最近 14 日の合算の一覧（日付順。食い違いの札つき）。
// 既存の /ops/flights・/ops/inspections の経路・機能は変えず、入口と見せ方でまとめる。
// Sprint 12g-1b：事故・ヒヤリハットも日誌の中へ（4 つ目の種類と、入力の入口「事故・ヒヤリハットを記録」）。新しい部品に置き換えた。
export const metadata: Metadata = { title: "日誌" };

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

  const denied = recordCreateDenied(me);
  const canIncident = can(me.member.role, "incident.create");
  const entryClass = "opx-btn min-h-14 w-full sm:w-auto";
  return (
    <main className="flex flex-col gap-6" data-testid="ops-journal">
      <DraftOwnerGuard memberId={me.member.id} />
      <PageHeader title="日誌" meta="飛行記録・日常点検・事故・ヒヤリハット" />
      {/* 点検は独立した画面になった（下タブ・左メニューの「点検」）。日誌の中の日常点検はそのまま残し、一覧への入口を 1 本だけ足す */}
      <Link href="/ops/inspections" prefetch={false} className="opx-underlink -mt-3 self-start" data-testid="journal-to-inspections">
        点検の一覧へ
      </Link>
      {canCreate || canIncident ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {canCreate ? (
            <>
              <Link href="/ops/flights/new" prefetch={false} className="opx-btn opx-btn-primary min-h-14 w-full sm:w-auto" data-testid="journal-new-flight">
                飛行記録を入力
              </Link>
              <Link href="/ops/inspections/new" prefetch={false} className={entryClass} data-testid="journal-new-inspection">
                日常点検を入力
              </Link>
            </>
          ) : null}
          {canIncident ? (
            <Link href="/ops/incidents/new" prefetch={false} className={entryClass} data-testid="journal-new-incident">
              事故・ヒヤリハットを記録
            </Link>
          ) : null}
        </div>
      ) : null}
      {denied ? (
        <Notice>{denied}</Notice>
      ) : null}
      <nav aria-label="表示する記録" className="opx-seg" data-testid="journal-tabs">
        {TABS.map(([key, label, href]) => (
          // 同じ画面の ?tab= の切り替えは通常のリンク（<a>）。理由は点検の一覧のチップと同じ
          <a key={key} href={href} aria-current={tab === key ? "page" : undefined} data-testid={`journal-tab-${key}`}>
            {label}
          </a>
        ))}
      </nav>
      <p className="sb-num text-sm text-sb-ink-3" data-testid="journal-range">
        最近 {RECENT_DAYS} 日（{from}〜{to}）　{rows.length} 件
      </p>
      {rows.length === 0 ? (
        <p className="sb-block-soft text-sm text-sb-ink-2" data-testid="journal-empty">
          最近 {RECENT_DAYS} 日の記録はありません。
        </p>
      ) : (
        <ul className="sb-block sb-rows !py-1" data-testid="journal-list">
          {rows.map((r) =>
            r.kind === "flight" ? (
              <li key={`f-${r.f.id}`} data-testid="journal-row" data-kind="flight">
                <Link prefetch={false} href={`/ops/flights/${r.f.id}`} className="sb-row !flex-col !items-stretch !gap-2" data-testid="journal-row-link">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <KindTag kind="flight" />
                    {r.f.voided ? (
                      <span className="sb-tag">取消済み</span>
                    ) : null}
                    <span className="sb-num text-[1rem] font-bold text-sb-ink">{r.f.flightDate}</span>
                    <span className="sb-num text-[1rem] font-bold text-sb-ink">
                      {r.f.takeoffAtJst.slice(11)}–{r.f.landingAtJst}
                    </span>
                    <span className="sb-num text-sb-ink-2">{formatHm(r.f.flightMinutes)}</span>
                  </span>
                  <span className="text-sb-ink-2">
                    <span className="sb-num">{r.f.registrationMark}</span>／{r.f.pilotName}
                  </span>
                  <MismatchBadges mismatches={r.f.mismatches} />
                </Link>
              </li>
            ) : (
              <li key={`i-${r.i.id}`} data-testid="journal-row" data-kind="inspection">
                <Link prefetch={false} href={`/ops/inspections/${r.i.id}`} className="sb-row !flex-col !items-stretch !gap-2" data-testid="journal-row-link">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <KindTag kind="inspection" />
                    {r.i.voided ? (
                      <span className="sb-tag">取消済み</span>
                    ) : null}
                    <span className="sb-num text-[1rem] font-bold text-sb-ink">{r.i.inspectedAtJst}</span>
                    <span className="text-sb-ink-2">{INSPECTION_TIMING_LABELS[r.i.timing]}</span>
                    {r.i.hasAbnormal ? (
                      <span className="sb-tag sb-tag-strong">
                        <span aria-hidden="true">！ </span>異常あり
                      </span>
                    ) : (
                      <span className="sb-tag">
                        <span aria-hidden="true">✓ </span>異常なし
                      </span>
                    )}
                  </span>
                  <span className="text-sb-ink-2">
                    <span className="sb-num">{r.i.registrationMark}</span>／{r.i.inspectorName}
                  </span>
                </Link>
              </li>
            ),
          )}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Link href="/ops/flights" prefetch={false} className="opx-underlink" data-testid="journal-flights-link">
          飛行記録の一覧へ
        </Link>
        <Link href="/ops/inspections" prefetch={false} className="opx-underlink" data-testid="journal-inspections-link">
          日常点検の一覧へ
        </Link>
      </div>
    </main>
  );
}
