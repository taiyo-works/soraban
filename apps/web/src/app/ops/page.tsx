import type { Metadata } from "next";
import Link from "next/link";
import { PLAN_JUDGEMENT_DISCLAIMER } from "@soraban/regulations";
import { JudgePills } from "@/components/ops/judge-pills";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { TodayCard, TodayDeadlines, TodayEmpty, TodayNextActions, TodayRest, TodayUpcoming } from "@/components/ops/today-ui";
import { buttonClass, NoticeBar } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { formatDay } from "@/lib/ops-day";
import { planCreateDenied } from "@/server/ops/plan-page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { requireOpsMember } from "@/server/ops/page";
import { getToday } from "@/server/ops/today";

// ホーム（Sprint 12c 設計 C・G。Sprint 12g-1b で「今日」から改名し、新しい部品で作り直した）：
//   今日（なければ次）の飛行を大きなカード 1 枚で出し（行程の 1 行つき）、その下に動詞で始まる「次にやること」を急ぐ順に並べる。
//   右には「近づく期限」と「直近の飛行」。件数だけのタイルは作らない。予定のない日は、何もない旨と次の一手を先頭に出す。
// 保存された状態は読まず、記録の有無から毎回導出する（server/ops/today.ts）。判定は目安で、通報・申請は DIPS で行う。
// ログイン中の利用者の名前・役割・ログアウトは、右上の利用者メニューにある（components/ops/ops-nav.tsx）。
export const metadata: Metadata = { title: "ホーム" };

export default async function OpsHome() {
  const { ctx, me } = await requireOpsMember();
  const canEnter = recordCreateDenied(me) === null;
  const canPlan = planCreateDenied(me) === null;
  const today = await getToday(ctx);
  return (
    <main className="flex flex-col gap-6" data-testid="ops-today">
      <DraftOwnerGuard memberId={me.member.id} />
      <div className="flex flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-h1 font-semibold text-fg" data-testid="today-heading">
              ホーム
            </h1>
            <span className="text-table tabular-nums text-fg-mute" data-testid="today-date">
              <time dateTime={today.today}>{formatDay(today.today, today.today)}</time>
            </span>
          </div>
          {/* 予定のない日は、先頭のカードに「飛行計画を作る」がある。同じ画面に同じ操作を 2 つ置かない。判定への入口は、下のピル（上部） */}
          {today.card && canPlan ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/ops/plans/new" prefetch={false} className={buttonClass("secondary", "md", "min-h-11")} data-testid="ops-enter-plan">
                <Icon name="plus" size={18} />
                飛行計画を作る
              </Link>
            </div>
          ) : null}
        </header>
        <JudgePills />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          {today.card ? <TodayCard card={today.card} today={today.today} nextActions={today.nextActions} /> : today.empty ? <TodayEmpty empty={today.empty} canPlan={canPlan} /> : null}
          <TodayRest rows={today.rest} />
          <TodayNextActions actions={today.nextActions} total={today.nextActionTotal} plansHref={today.plansHref} today={today.today} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <TodayDeadlines deadlines={today.deadlines} today={today.today} />
          <TodayUpcoming flights={today.upcoming} today={today.today} />
        </div>
      </div>

      {canEnter ? (
        <nav aria-label="記録の入力" className="flex flex-col gap-2 border-t border-line pt-5">
          <p className="text-aux text-fg-mute">記録を入力</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/ops/flights/new" prefetch={false} className={buttonClass("secondary", "md", "min-h-14 sm:min-h-11")} data-testid="ops-enter-flight">
              <Icon name="flight" size={18} />
              飛行記録を入力
            </Link>
            <Link href="/ops/inspections/new" prefetch={false} className={buttonClass("secondary", "md", "min-h-14 sm:min-h-11")} data-testid="ops-enter-inspection">
              <Icon name="inspection" size={18} />
              日常点検を入力
            </Link>
          </div>
        </nav>
      ) : null}
      <NoticeBar meaning="neutral" icon="info" data-testid="today-disclaimer">
        {PLAN_JUDGEMENT_DISCLAIMER}そらばんは DIPS に送信しません。
      </NoticeBar>
    </main>
  );
}
