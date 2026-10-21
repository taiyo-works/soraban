import Link from "next/link";
import { PLAN_JUDGEMENT_DISCLAIMER } from "@soraban/regulations";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { TodayCard, TodayEmpty, TodayNextActions, TodayRest } from "@/components/ops/today-ui";
import { buttonFieldClass, buttonOutlineBrandClass } from "@/components/ops/ui";
import { planCreateDenied } from "@/server/ops/plan-page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { requireOpsMember, ROLE_LABELS } from "@/server/ops/page";
import { getToday } from "@/server/ops/today";

// 「今日」（Sprint 12c 設計 C・G）：今日（なければ次）の飛行を大きなカード 1 枚で出し、その下に動詞で始まる「次にやること」を
// 急ぐ順に並べる。件数だけのタイルは作らない。メニューとログアウトは「その他」（/ops/more）へ移した。
// 保存された状態は読まず、記録の有無から毎回導出する（server/ops/today.ts）。判定は目安で、通報・申請は DIPS で行う。
export default async function OpsHome() {
  const { ctx, me } = await requireOpsMember();
  const role = me.member.role;
  const canEnter = recordCreateDenied(me) === null;
  const canPlan = planCreateDenied(me) === null;
  const today = await getToday(ctx);
  return (
    <main className="flex flex-col gap-8" data-testid="ops-today">
      <DraftOwnerGuard memberId={me.member.id} />
      <section className="flex flex-col gap-1" aria-label="ログイン中の利用者">
        <p className="eyebrow">{me.org.name}</p>
        <h1 className="font-display text-2xl font-light leading-tight text-ink" data-testid="today-heading">
          今日
          <span className="ml-3 font-mono text-sm tnum text-ink-soft" data-testid="today-date">
            {today.today}
          </span>
        </h1>
        <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-ink-soft">
          <span data-testid="ops-me-name">{me.member.displayName}</span>
          <span data-testid="ops-me-role">
            <span>役割：</span>
            {ROLE_LABELS[role]}
          </span>
        </p>
      </section>

      {today.card ? <TodayCard card={today.card} /> : today.empty ? <TodayEmpty empty={today.empty} /> : null}
      <TodayRest rows={today.rest} />
      <TodayNextActions actions={today.nextActions} total={today.nextActionTotal} plansHref={today.plansHref} />

      {canEnter || canPlan ? (
        <nav aria-label="記録の入力" className="flex flex-col gap-3 border-t border-rule pt-5">
          <p className="eyebrow" aria-hidden>
            記録を入力
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {canPlan ? (
              <Link href="/ops/plans/new" prefetch={false} className={buttonOutlineBrandClass.replace("min-h-11", "min-h-14").replace("text-sm", "text-base")} data-testid="ops-enter-plan">
                飛行計画を作る
              </Link>
            ) : null}
            {canEnter ? (
              <>
                <Link href="/ops/flights/new" prefetch={false} className={buttonFieldClass} data-testid="ops-enter-flight">
                  飛行記録を入力
                </Link>
                <Link href="/ops/inspections/new" prefetch={false} className={buttonOutlineBrandClass.replace("min-h-11", "min-h-14").replace("text-sm", "text-base")} data-testid="ops-enter-inspection">
                  日常点検を入力
                </Link>
              </>
            ) : null}
          </div>
        </nav>
      ) : null}
      <p className="max-w-xl border-l-2 border-brand-700 pl-3 text-xs leading-relaxed text-ink-soft" data-testid="today-disclaimer">
        {PLAN_JUDGEMENT_DISCLAIMER}そらばんは DIPS に送信しません。
      </p>
    </main>
  );
}
