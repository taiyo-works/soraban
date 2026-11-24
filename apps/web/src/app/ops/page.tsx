import type { Metadata } from "next";
import { PLAN_JUDGEMENT_DISCLAIMER } from "@soraban/regulations";
import { Notice } from "@/components/ops/ui";
import { JudgePills } from "@/components/ops/judge-pills";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { FieldPrefetch } from "@/components/ops/field-prefetch";
import { HomePrepCard } from "@/components/ops/home-prep-card";
import { HomeAllPlans, HomeNextCard, HomePrimary, HomeQuick, TodayCard, TodayDeadlines, TodayDeadlinesRest, TodayEmpty, TodayNextActions, TodayRest, TodayUpcoming } from "@/components/ops/today-ui";
import { formatDay } from "@/lib/ops-day";
import { planCreateDenied } from "@/server/ops/plan-page";
import { recordCreateDenied } from "@/server/ops/record-page";
import { requireOpsMember } from "@/server/ops/page";
import { getToday } from "@/server/ops/today";

// ホーム（Sprint 12c 設計 C・G。Sprint 12g-1b で「今日」から改名。Sprint 16-G で構成を作り直した。契約 HM-1〜HM-6）：
//   上から ①題と補足（日付・場所）②準備カード（次の飛行が無いときは出さない）③次の予定（一覧カード 1 枚）と主ボタン 1 つ
//   ④近づく期限（60 日以内。無ければ段ごと出さない）⑤クイック操作 3 つ。判定へのピル・今日のカードの詳細・残りの予定・次にやること・
//   先の予定は、下段の「すべての予定」に畳む。計画が 0 件のときは、アイコン・一文・主ボタンだけ（HM-4）。件数だけのタイルは作らない。
// 保存された状態は読まず、記録の有無から毎回導出する（server/ops/today.ts）。判定は目安で、通報・申請は DIPS で行う。
// ログイン中の利用者の名前・役割・ログアウトは、右上の利用者メニューにある（components/ops/ops-nav.tsx）。
export const metadata: Metadata = { title: "ホーム" };

export default async function OpsHome() {
  const { ctx, me } = await requireOpsMember();
  const canEnter = recordCreateDenied(me) === null;
  const canPlan = planCreateDenied(me) === null;
  const today = await getToday(ctx);
  const card = today.card;
  // 主ボタン（HM-2）：次にやることのうち、押せる先頭の 1 件。無ければ「新しい計画」
  const primaryAction = today.nextActions.find((a) => a.canAct) ?? null;
  return (
    <main className="flex flex-col gap-3 lg:gap-6" data-testid="ops-today">
      <DraftOwnerGuard memberId={me.member.id} />
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" data-testid="home-head">
        <h1 className="opx-h1" data-testid="today-heading">
          ホーム
        </h1>
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-sb-ink-3" data-note="">
          <span className="opx-num" data-testid="today-date">
            <time dateTime={today.today}>{formatDay(today.today, today.today)}</time>
          </span>
          {card ? <span className="[overflow-wrap:anywhere]" data-testid="today-place">{card.placeName}</span> : null}
        </p>
      </header>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-7">
        <div className="flex min-w-0 flex-col gap-3 lg:gap-6">
          {card ? (
            <>
              <HomePrepCard input={card.prep} when={`${formatDay(card.plannedDate, today.today)} ${card.timeLabel}`} place={card.placeName} />
              <div className="flex flex-col gap-3">
                <HomeNextCard card={card} today={today.today} />
                <HomePrimary action={primaryAction} canPlan={canPlan} />
              </div>
            </>
          ) : today.empty ? (
            <TodayEmpty empty={today.empty} canPlan={canPlan} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:gap-6">
          <TodayDeadlines deadlines={today.deadlines} today={today.today} />
          <HomeQuick canEnter={canEnter} canPlan={canPlan} />
        </div>
      </div>

      <HomeAllPlans>
        <JudgePills />
        {card ? <TodayCard card={card} today={today.today} nextActions={today.nextActions} /> : null}
        <TodayDeadlinesRest deadlines={today.deadlines} today={today.today} />
        <TodayRest rows={today.rest} />
        <TodayNextActions actions={today.nextActions} total={today.nextActionTotal} plansHref={today.plansHref} today={today.today} />
        <TodayUpcoming flights={today.upcoming} today={today.today} />
        {/* ④の段は、60 日以内の期限が無いとき上には出さない（HM-1）。ここ（畳んだ中）に、無い旨を 1 行だけ残す */}
        {today.deadlines.length === 0 ? (
          <p className="text-sb-ink-2" data-testid="home-deadlines-empty">
            60 日以内に近づく期限はありません。
          </p>
        ) : null}
      </HomeAllPlans>
      {/* Sprint 15：圏外用の先読み・送信待ちの続き・ホーム画面への追加の案内（最初の画面の並びを変えないよう、下に置く） */}
      <FieldPrefetch memberId={me.member.id} />
      <Notice data-testid="today-disclaimer">
        {PLAN_JUDGEMENT_DISCLAIMER}そらばんは DIPS に送信しません。
      </Notice>
    </main>
  );
}
