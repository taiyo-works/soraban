// 「今日」と次にやることの拡張（Sprint 12c 設計 C）。純粋関数。DB・時計・ネットワークに触れない。
//   todayModel               今日（なければ次）の飛行の大きなカード 1 枚と、今日の残りの計画の選び方
//   fieldNextActions         計画ごとの、飛行当日・現場の次にやること（着陸・日常点検・緊急用務空域・日誌）
//   mismatchNextActions      直近の飛行記録の食い違い（直近 3 日間だけ出る。確認済みの記録は作らない）
//   licenseNextActions       操縦者の技能証明の有効期限（既存の列だけから導出。期限一覧は 12f）
//
// 守ること：
//   - 保存された状態は読まない。記録の有無から毎回導出する（記録を足すだけで一覧が変わる）。
//   - 既存の 12b の項目の tier・条件・文言は変えない。並びは compareNextActions（tier、飛行開始までの時間）。
//   - 境界：予定終了の 60 分後（その時点から出す）、食い違いは離陸から 3 日（72 時間）まで、技能証明は有効期限の 60 日前から
//     （期限日の翌日から期限切れ＝ tier 3）。
import { NEXT_ACTION_LABEL } from "@soraban/dips";
import { fieldHref, inspectionNewHref, journalNewHref, JOURNAL_MISMATCH_RECENT_DAYS } from "@/lib/ops-field";
import type { MemberRoleDb } from "@soraban/db";
import type { FieldState } from "./field-logic";
import type { JournalMismatch } from "./journal-logic";
import { compareNextActions, type NextAction, type NextActionTier } from "./report-logic";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** 日誌の記入を促すまでの時間（予定終了から。分）。 */
export const JOURNAL_DUE_AFTER_END_MINUTES = 60;
/** 技能証明の更新を促す期間（有効期限の何日前から）。 */
export const LICENSE_NOTICE_DAYS = 60;
/** 次にやることの対象にする計画の期間（今日から何日以内に始まる計画。今日を含む）。 */
export const NEXT_ACTION_WINDOW_DAYS = 7;
/** 次にやることを出す件数の上限。 */
export const TODAY_NEXT_ACTION_LIMIT = 8;
/** `/` の「今日」の帯に出す次にやることの件数。 */
export const HOME_BAND_NEXT_ACTION_LIMIT = 3;

/** YYYY-MM-DD に日数を足す（暦の日。タイムゾーンに依らない）。 */
export const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
};

/** 2 つの YYYY-MM-DD の差（b − a。日数）。 */
export const daysBetween = (a: string, b: string): number => {
  const t = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / DAY_MS);
};

// ---- 今日のカードの選び方 --------------------------------------------------------

export type TodayPlanLite = {
  readonly id: string;
  readonly plannedStartAt: Date;
  readonly durationMinutes: number;
  /** 予定開始の JST の日付。 */
  readonly plannedDate: string;
  readonly voided: boolean;
  /** 計画の操縦者が、要求した利用者に結び付いた操縦者か。 */
  readonly isSelf: boolean;
  /** 飛行中の離陸がある。 */
  readonly inFlight: boolean;
};

export type TodayCardReason = "in_flight" | "today" | "next";

export type TodayModel = {
  /** 今日（JST の YYYY-MM-DD）。 */
  readonly today: string;
  readonly card: { readonly planId: string; readonly reason: TodayCardReason } | null;
  /** カードの下に 1 行ずつ出す、今日の残りの計画（中止していない。カードの計画を除く。操縦者役割は自分の飛行を先に、あとは予定開始の順）。 */
  readonly rest: readonly string[];
};

const endOf = (p: TodayPlanLite): number => p.plannedStartAt.getTime() + p.durationMinutes * MINUTE_MS;

const byStart = (a: TodayPlanLite, b: TodayPlanLite): number =>
  a.plannedStartAt.getTime() - b.plannedStartAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 今日の飛行の選び方（設計 C）。
 *   カード 1 枚：飛行中の離陸がある計画 ＞ 今日の計画のうち予定の終了が現在より後で最も早いもの ＞
 *   （それが無ければ）これから最も近い計画 ＞ 空。
 *   操縦者役割の利用者には、各段で自分が操縦者の飛行を先に出す。
 *   対象は、中止していない計画（飛行中の離陸がある計画は、中止していても着陸のために出す）。
 */
export const todayModel = (i: {
  readonly now: Date;
  readonly today: string;
  readonly role: MemberRoleDb;
  readonly plans: readonly TodayPlanLite[];
}): TodayModel => {
  const live = i.plans.filter((p) => !p.voided);
  const pilotFirst = <T extends TodayPlanLite>(list: readonly T[]): readonly T[] => {
    if (i.role !== "pilot") return list;
    const mine = list.filter((p) => p.isSelf);
    return mine.length > 0 ? mine : list;
  };
  const nowMs = i.now.getTime();

  let card: TodayModel["card"] = null;
  const inFlight = pilotFirst(i.plans.filter((p) => p.inFlight)).slice().sort(byStart);
  if (inFlight[0]) card = { planId: inFlight[0].id, reason: "in_flight" };

  if (card === null) {
    const todays = pilotFirst(live.filter((p) => p.plannedDate === i.today && endOf(p) > nowMs));
    const first = todays.slice().sort((a, b) => endOf(a) - endOf(b) || byStart(a, b))[0];
    if (first) card = { planId: first.id, reason: "today" };
  }
  if (card === null) {
    const upcoming = pilotFirst(live.filter((p) => p.plannedStartAt.getTime() > nowMs));
    const first = upcoming.slice().sort(byStart)[0];
    if (first) card = { planId: first.id, reason: "next" };
  }

  const restPlans = live.filter((p) => p.plannedDate === i.today && p.id !== card?.planId);
  const ordered =
    i.role === "pilot"
      ? [...restPlans.filter((p) => p.isSelf).sort(byStart), ...restPlans.filter((p) => !p.isSelf).sort(byStart)]
      : restPlans.sort(byStart);
  return { today: i.today, card, rest: ordered.map((p) => p.id) };
};

// ---- 計画ごとの、飛行当日・現場の次にやること ---------------------------------------------

/** 次にやることに、どの計画の作業かを添えたもの（今日の画面の一覧用）。 */
export type TodayNextAction = NextAction & {
  readonly planId: string | null;
  readonly planTitle: string | null;
};

export type FieldActionInput = {
  readonly planId: string;
  readonly planTitle: string;
  readonly plannedStartAt: Date;
  readonly durationMinutes: number;
  /** 予定開始の JST の日付。 */
  readonly plannedDate: string;
  readonly voided: boolean;
  readonly now: Date;
  /** 今日（JST の YYYY-MM-DD）。 */
  readonly today: string;
  /** 現場の状態（日常点検は今日の日付で導出したもの）。 */
  readonly state: FieldState;
  /** その計画に結び付いた、取消していない飛行記録がある。 */
  readonly hasFlightRecord: boolean;
  readonly can: {
    readonly record: boolean;
    readonly inspect: boolean;
    readonly journal: boolean;
  };
};

/**
 * 飛行当日・現場の次にやること。
 *   着陸を記録する（tier 1）：飛行中の離陸がある（中止した計画でも出す）
 *   日常点検をする（tier 3）：飛行当日で、計画の機体の飛行前の点検が今日付けで無い
 *   緊急用務空域を確認する（tier 3）：飛行当日で、確認の行（取り消されていない）が無い
 *   飛行後点検をする（tier 3）：着陸済みで、その飛行の後の飛行後の日常点検が無い（Sprint 14）
 *   日誌を記入する（tier 3）：日誌待ちの着陸がある。または予定終了から 60 分を過ぎても、飛行記録も離陸の行も無い
 * 中止した計画は、着陸を記録する・日誌を記入する（日誌待ち）だけを出す。
 */
export const fieldNextActions = (i: FieldActionInput): TodayNextAction[] => {
  const out: TodayNextAction[] = [];
  const startsInMinutes = Math.floor((i.plannedStartAt.getTime() - i.now.getTime()) / MINUTE_MS);
  const add = (
    id: "record_landing" | "do_inspection" | "check_emergency_airspace" | "do_post_inspection" | "write_journal",
    tier: NextActionTier,
    reason: string,
    href: string,
    canAct: boolean,
  ): void => {
    out.push({
      id,
      label: NEXT_ACTION_LABEL[id],
      reason,
      href,
      tier,
      dueLabel: null,
      canAct,
      startsInMinutes,
      planId: i.planId,
      planTitle: i.planTitle,
    });
  };

  if (i.state.openFlight) {
    add("record_landing", 1, "飛行中です。着陸したら記録します", fieldHref(i.planId, "flight"), i.can.record);
  }
  const isToday = i.plannedDate === i.today;
  if (!i.voided && isToday) {
    if (!i.state.checks.inspection.done) {
      add("do_inspection", 3, "飛行当日です。この機体の飛行前の日常点検の記録がありません", inspectionNewHref(i.planId), i.can.inspect);
    }
    if (!i.state.checks.emergency_airspace.done) {
      add("check_emergency_airspace", 3, "飛行当日です。緊急用務空域の確認の記録がありません", fieldHref(i.planId, "preflight"), i.can.record);
    }
  }
  // Sprint 14：着陸のあと、飛行後点検が未了（日付に関わらず、日誌待ちと同じく残る）。後回しにできるが、ここに出続ける
  const postPending = i.state.postPending[0];
  if (postPending) {
    add("do_post_inspection", 3, "着陸を記録しました。飛行後点検の記録がありません", fieldHref(i.planId, "post"), i.can.inspect);
  }
  const pending = i.state.pendingJournal[0];
  if (pending) {
    add("write_journal", 3, "着陸を記録しました。日誌を記入します", journalNewHref(i.planId, pending.takeoffEventId), i.can.journal);
  } else if (
    !i.voided &&
    i.state.flights.length === 0 &&
    !i.hasFlightRecord &&
    i.now.getTime() >= i.plannedStartAt.getTime() + (i.durationMinutes + JOURNAL_DUE_AFTER_END_MINUTES) * MINUTE_MS
  ) {
    add(
      "write_journal",
      3,
      "計画の予定終了から 60 分を過ぎましたが、飛行記録も離陸の記録もありません。飛ばなかった場合は計画を中止してください",
      journalNewHref(i.planId),
      i.can.journal,
    );
  }
  return out;
};

// ---- 日誌の食い違い（直近 3 日間） ---------------------------------------------------

export type MismatchActionInput = {
  readonly flightId: string;
  readonly planId: string | null;
  readonly planTitle: string | null;
  readonly takeoffAt: Date;
  readonly now: Date;
  readonly mismatches: readonly JournalMismatch[];
};

/** 直近 3 日間（離陸から 72 時間以内）の飛行記録に食い違いが 1 件以上あれば、その飛行記録への項目を 1 件返す。 */
export const mismatchNextActions = (list: readonly MismatchActionInput[]): TodayNextAction[] =>
  list
    .filter((m) => m.mismatches.length > 0 && m.now.getTime() - m.takeoffAt.getTime() <= JOURNAL_MISMATCH_RECENT_DAYS * DAY_MS)
    .map(
      (m): TodayNextAction => ({
        id: "review_journal_mismatch",
        label: NEXT_ACTION_LABEL.review_journal_mismatch,
        reason: m.mismatches.map((x) => x.label).join(" "),
        href: `/ops/flights/${m.flightId}`,
        tier: 4,
        dueLabel: null,
        canAct: true,
        startsInMinutes: Math.floor((m.takeoffAt.getTime() - m.now.getTime()) / MINUTE_MS),
        planId: m.planId,
        planTitle: m.planTitle,
      }),
    );

// ---- 技能証明の有効期限 ------------------------------------------------------------

export type LicenseActionInput = {
  readonly pilotId: string;
  readonly pilotName: string;
  /** 有効期限（YYYY-MM-DD）。未入力は null。 */
  readonly expiresOn: string | null;
  readonly today: string;
  /** 期限が近い順に並べるための、その操縦者の最も早い計画の飛行開始までの分。 */
  readonly startsInMinutes: number;
  readonly canAct: boolean;
};

/**
 * 技能証明を更新する。有効期限が今日から 60 日以内（tier 5）。期限日の翌日以降は期限切れ（tier 3）。
 * 期限日の当日はまだ有効。期限が未入力なら出さない。
 */
export const licenseNextActions = (list: readonly LicenseActionInput[]): TodayNextAction[] => {
  const out: TodayNextAction[] = [];
  for (const p of list) {
    if (p.expiresOn === null) continue;
    const left = daysBetween(p.today, p.expiresOn);
    if (left > LICENSE_NOTICE_DAYS) continue;
    const expired = left < 0;
    out.push({
      id: "renew_license",
      label: NEXT_ACTION_LABEL.renew_license,
      reason: expired
        ? `${p.pilotName}の技能証明の有効期限が切れています（${p.expiresOn}）`
        : `${p.pilotName}の技能証明の有効期限まで ${left} 日です（${p.expiresOn}）`,
      href: `/ops/pilots/${p.pilotId}`,
      tier: expired ? 3 : 5,
      dueLabel: null,
      canAct: p.canAct,
      startsInMinutes: p.startsInMinutes,
      planId: null,
      planTitle: null,
    });
  }
  return out;
};

/** 複数の計画をまたいで並べ（tier、飛行開始までの時間）、上位 limit 件に絞る。 */
export const rankNextActions = (list: readonly TodayNextAction[], limit: number = TODAY_NEXT_ACTION_LIMIT): TodayNextAction[] =>
  [...list].sort(compareNextActions).slice(0, limit);
