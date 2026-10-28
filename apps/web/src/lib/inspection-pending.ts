// 点検の一覧の「未実施」（Sprint 12h PR ③a、docs/sprints/sprint-12h-pr3.md §5.2）の導出。純粋関数。DB・時計・ネットワークに触れない。
//
// 範囲（のりさんの決定 2026-10-27）：まず「今日の計画で、飛行前の日常点検がまだないもの」だけを出す。
//   飛行後の未実施・過去日・先の日の計画は、運用の取り決めが決まるまで出さない（定義を作らない）。
// 元になるのは、ホーム（getToday）がすでに導いている「次にやること」の do_inspection
//   （飛行当日の計画で、計画の機体の飛行前の点検が今日付けで無いとき。取消した点検・他の機体の点検・日付の境界（JST）は、その導出が扱う）。
//   新しい問い合わせ・API・DB は足さない。計画の名称・時刻・機体は、同じ結果の card・rest から引く。
import type { TodayDto } from "@/server/ops/today";

export type PendingInspection = {
  readonly planId: string;
  readonly title: string;
  /** `HH:MM〜HH:MM`。 */
  readonly timeLabel: string;
  readonly registrationMark: string;
  /** 点検の入力へ（計画から引き継ぐ）。 */
  readonly href: string;
  /** 押せるか（点検を入力できる役割か）。偽のときはリンクにせず、理由を文で示す。 */
  readonly canAct: boolean;
};

type Source = Pick<TodayDto, "card" | "rest" | "nextActions">;

/** 今日の飛行前の点検が無い計画を、予定の早い順に返す（同じ計画は 1 件）。 */
export const pendingPreflightInspections = (today: Source): PendingInspection[] => {
  const plans = new Map<string, { title: string; timeLabel: string; registrationMark: string }>();
  if (today.card) plans.set(today.card.planId, { title: today.card.title, timeLabel: today.card.timeLabel, registrationMark: today.card.registrationMark });
  for (const r of today.rest) plans.set(r.planId, { title: r.title, timeLabel: r.timeLabel, registrationMark: r.registrationMark });

  const seen = new Set<string>();
  const out: (PendingInspection & { readonly startsIn: number })[] = [];
  for (const a of today.nextActions) {
    if (a.id !== "do_inspection" || a.planId === null || seen.has(a.planId)) continue;
    const p = plans.get(a.planId);
    // 計画の細目が card・rest に無いときは、名称だけで出す（機体の欄は空）。出さずに落とすと、未実施が消えて見える
    seen.add(a.planId);
    out.push({
      planId: a.planId,
      title: p?.title ?? a.planTitle ?? "",
      timeLabel: p?.timeLabel ?? "",
      registrationMark: p?.registrationMark ?? "",
      href: a.href,
      canAct: a.canAct,
      startsIn: a.startsInMinutes,
    });
  }
  return out.sort((x, y) => x.startsIn - y.startsIn || (x.planId < y.planId ? -1 : 1)).map(({ planId, title, timeLabel, registrationMark, href, canAct }) => ({ planId, title, timeLabel, registrationMark, href, canAct }));
};
