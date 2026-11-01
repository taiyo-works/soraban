import Link from "next/link";
import { LinkedIncidentsSection } from "@/components/ops/incident-ui";
import { PlanFrame } from "@/components/ops/plan-frame";
import { Badge, buttonOutlineBrandClass, Section } from "@/components/ops/ui";
import { JUDGEMENT_LINK_MISSING_LABEL } from "@/server/ops/records";
import { listPlanIncidents } from "@/server/ops/incidents";
import { recordCreateDenied } from "@/server/ops/record-page";
import { loadPlan } from "../_load";

// 日誌の画面（Sprint 17-1）：この計画の飛行記録、事故・ヒヤリハット、「飛行記録を作る」。
export default async function PlanJournalPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me, id, plan } = await loadPlan(params);
  const planIncidents = await listPlanIncidents(ctx, id);
  const canMakeFlight = !plan.voided && recordCreateDenied(me) === null;

  // 飛行記録は、新しい順の最新 5 件だけ出し、古い記録は畳む（件数を summary に出す）
  const RECENT = 5;
  const sorted = plan.flights; // 離陸の新しい順（store の並び）
  const shown = sorted.slice(0, RECENT);
  const older = sorted.slice(RECENT);
  const flightRow = (f: (typeof plan.flights)[number]) => (
    <li key={f.id} className="border-b border-sb-rule">
                  <Link prefetch={false} href={`/ops/flights/${f.id}`} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm hover:bg-sb-surface" data-testid="plan-flight-row">
                    <span className="sb-num tnum">{f.flightDate}</span>
                    <span className="sb-num tnum">{f.takeoffAtJst.slice(11)}–{f.landingAtJst}</span>
                    <span className="sb-num text-sb-ink-2">{f.registrationMark}</span>
                    <span>{f.pilotName}</span>
                    {f.voided ? <Badge tone="red">取消済み</Badge> : null}
                  </Link>
                </li>
  );

  return (
    <PlanFrame plan={plan} current="journal" eyebrow="日誌">
        <Section title="この計画の飛行記録" aria-label="この計画の飛行記録">
          {plan.flights.length === 0 ? (
            <p className="text-sm text-sb-ink-3" data-testid="plan-flights-empty">結びついた飛行記録はありません。</p>
          ) : (
            <>
              <ul className="flex flex-col border-t border-sb-rule" data-testid="plan-flights">
                {shown.map(flightRow)}
              </ul>
              {older.length > 0 ? (
                <details data-testid="plan-flights-older">
                  <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">古い飛行記録 {older.length} 件を見る（最新 {shown.length} 件は上に出ています）</summary>
                  <ul className="flex flex-col border-t border-sb-rule">{older.map(flightRow)}</ul>
                </details>
              ) : null}
            </>
          )}
          {canMakeFlight ? (
            <div className="flex flex-col gap-2">
              <Link prefetch={false} href={`/ops/flights/new?planId=${plan.id}`} className={`${buttonOutlineBrandClass} self-start`} data-testid="plan-make-flight">
                飛行記録を作る
              </Link>
              <p className="text-xs text-sb-ink-3">機体・操縦者・目的・場所・特定飛行の形態を引き継ぎます。離陸・着陸の時刻は、実際の時刻を入れてください。</p>
            </div>
          ) : null}
          <p className="text-xs text-sb-ink-3">{JUDGEMENT_LINK_MISSING_LABEL}の記録は、飛行記録の一覧と詳細に出ます。</p>
        </Section>

        <LinkedIncidentsSection dto={planIncidents} />
    </PlanFrame>
  );
}
