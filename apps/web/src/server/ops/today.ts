// 「ホーム」（旧「今日」）のサービス層（Sprint 12c 設計 C）。GET /api/ops/today と、`/` の「ホーム」の帯・`/ops` が使う。
//   - 今日（なければ次）の飛行の大きなカード 1 枚と、今日の残りの計画、動詞で始まる「次にやること」（上位 8 件）を返す。
//   - 一覧の要約の値だけを使う（判定の result 全体は読まない）。保存された状態は読まず、記録の有無から毎回導出する。
//   - 対象は、今日から 7 日以内に始まる計画と、飛行中・日誌待ちの計画（離陸の行から 30 日さかのぼる）。
//   - クエリ数は計画の件数に比例しない（計画・確認・通報・現場の行・日常点検・飛行記録をまとめて引く）。
//   - Sprint 12g-1b：行程の 1 行（card.journey・upcoming[].journey）と近づく期限（deadlines）を足した。どちらも読み取りだけで、
//     行程は読み込み済みの計画から導出する。期限のために、操縦者と許可・承認の行を全員分 1 回ずつ読む（追加は許可・承認の 1 問い合わせ。
//     操縦者は従来、7 日以内の計画に操縦者がいるときだけ読んでいたが、期限のため毎回 1 回読む）。
import { VERDICT_LABEL } from "@soraban/regulations";
import { fieldHref, TODAY_EMPTY_ACTIONS, TODAY_EMPTY_NONE, TODAY_EMPTY_TODAY } from "@/lib/ops-field";
import { jstDate, jstTime, toJstInput } from "@/lib/ops-time";
import { can } from "./authz";
import { fieldState, type FieldEventLite, type FieldFlightRecordLite, type FieldState } from "./field-logic";
import { deadlines as deadlinesOf, type DeadlineDto } from "./deadlines-logic";
import { fieldInspectionLites, toLite } from "./field-rows";
import { enrichFlights } from "./flight-extras";
import { incidentTodayActions } from "./incidents";
import { journeyStages, type JourneyStageDto } from "./journey-logic";
import { hasReportNumber, prepInspectionKey, prepReportKey, type PrepInspectionKey, type PrepJudgementInput, type PrepReportKey } from "./prep-card-logic";
import { loadPlanSummaries, type PlanDto } from "./plans";
import { asDate, myPilot, nowOf } from "./records";
import type { NextAction } from "./report-logic";
import { assertCan, dateOnly, type OpsContext } from "./service";
import * as store from "./store";
import type { PlanWithJoins } from "./store";
import {
  addDays,
  daysBetween,
  fieldNextActions,
  HOME_BAND_NEXT_ACTION_LIMIT,
  licenseNextActions,
  mismatchNextActions,
  NEXT_ACTION_WINDOW_DAYS,
  rankNextActions,
  todayModel,
  TODAY_NEXT_ACTION_LIMIT,
  type TodayCardReason,
  type TodayNextAction,
  type TodayPlanLite,
} from "./today-logic";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** 飛行中・日誌待ちの計画を拾うために、離陸の行をさかのぼる日数。 */
export const TAKEOFF_LOOKBACK_DAYS = 30;

// ---- DTO -----------------------------------------------------------------

export type TodayBadgeCode = "in_flight" | "journal_pending" | "journaled" | "ended" | "planned";

export type TodayBadgeDto = {
  readonly code: TodayBadgeCode;
  /** 状況の札（文字）。 */
  readonly label: string;
  /** 記号（文字と一緒に出す。色だけで区別しない）。 */
  readonly mark: string;
};

const BADGE: Readonly<Record<TodayBadgeCode, TodayBadgeDto>> = {
  in_flight: { code: "in_flight", label: "飛行中", mark: "▶" },
  journal_pending: { code: "journal_pending", label: "日誌待ち", mark: "！" },
  journaled: { code: "journaled", label: "日誌済み", mark: "✓" },
  ended: { code: "ended", label: "終了", mark: "－" },
  planned: { code: "planned", label: "予定", mark: "○" },
};

export type TodayCardDto = {
  readonly planId: string;
  readonly reason: TodayCardReason;
  readonly reasonLabel: string;
  readonly title: string;
  readonly plannedDate: string;
  readonly plannedStartAtJst: string;
  readonly plannedEndAtJst: string;
  /** 表示用 `HH:MM〜HH:MM`。 */
  readonly timeLabel: string;
  readonly registrationMark: string;
  readonly modelName: string;
  readonly pilotName: string;
  readonly placeName: string;
  /** 判定の段階（4 段のラベル）。 */
  readonly verdictLevel: string;
  readonly verdictLabel: string;
  readonly judgementStale: boolean;
  /** 通報の状況（既存の導出と文言をそのまま使う）。 */
  readonly report: {
    readonly requirementKind: string;
    readonly requirementLabel: string;
    readonly statusCode: string;
    readonly statusLabel: string;
    readonly statusShortLabel: string;
    readonly statusMark: string;
    readonly detail: string | null;
  };
  /** 確認の状況（運航管理者の確認。既存の導出と文言）。 */
  readonly confirmation: { readonly state: string; readonly label: string };
  readonly badge: TodayBadgeDto;
  /** 準備カード（Sprint 16-G。通報・飛行前点検・判定の 3 行の材料。語の選び方は prep-card-logic）。 */
  readonly prep: {
    readonly report: PrepReportKey;
    readonly inspection: PrepInspectionKey;
    readonly judgement: PrepJudgementInput;
  };
  /** 行程の 7 段（判定→計画→確認→通報→点検→飛行→日誌。記録の有無から毎回導出する）。 */
  readonly journey: readonly JourneyStageDto[];
  /** 主ボタン 1 つ：当日の計画は「現場モードを開く」、それ以外は「計画を開く」。 */
  readonly primary: { readonly kind: "field" | "plan"; readonly label: string; readonly href: string };
};

export type TodayRowDto = {
  readonly planId: string;
  readonly title: string;
  readonly timeLabel: string;
  readonly plannedStartAtJst: string;
  readonly registrationMark: string;
  readonly pilotName: string;
  readonly confirmationLabel: string;
  readonly reportShortLabel: string;
  /** 状況の札（飛行中・日誌待ち・日誌済み・終了・予定）。 */
  readonly badge: TodayBadgeDto;
  readonly href: string;
};

/** 直近の飛行（今日より先の日に始まる計画。行程つき）。 */
export type TodayUpcomingDto = {
  readonly planId: string;
  readonly title: string;
  readonly plannedDate: string;
  readonly timeLabel: string;
  /** 今日から計画の日までの日数（明日＝1）。 */
  readonly daysLeft: number;
  readonly href: string;
  readonly journey: readonly JourneyStageDto[];
};

/** ホームの「直近の飛行」に出す件数。 */
export const UPCOMING_LIMIT = 3;

export type TodayEmptyDto = {
  /** 何がないか。 */
  readonly message: string;
  /** 次にできること。 */
  readonly actions: readonly { readonly label: string; readonly href: string }[];
};

export type TodayDto = {
  readonly serverNow: string;
  readonly serverNowJst: string;
  /** 今日（JST の YYYY-MM-DD）。 */
  readonly today: string;
  readonly card: TodayCardDto | null;
  /** カードの下に 1 行ずつ出す、今日の残りの計画。 */
  readonly rest: readonly TodayRowDto[];
  /** 直近の飛行（今日より先の日に始まる計画。計画の窓の中から作る。行程つき）。 */
  readonly upcoming: readonly TodayUpcomingDto[];
  /** 近づく期限（技能証明の有効期限と、許可・承認の有効な最終日。60 日以内、最大 5 件）。 */
  readonly deadlines: readonly DeadlineDto[];
  /** 動詞で始まる「次にやること」（急ぐ順の上位 8 件）。 */
  readonly nextActions: readonly TodayNextAction[];
  /** 次にやることの総数（上位 8 件に収まらない分を「計画の一覧へ」で案内する）。 */
  readonly nextActionTotal: number;
  /** 計画の一覧の経路（「計画の一覧へ」）。 */
  readonly plansHref: string;
  /** カードがないときの、何がないかと次にできること（件数だけのタイルは作らない）。 */
  readonly empty: TodayEmptyDto | null;
};

// ---- 組み立て ---------------------------------------------------------------

const planLite = (r: PlanWithJoins, isSelf: boolean, inFlight: boolean): TodayPlanLite => ({
  id: r.id,
  plannedStartAt: asDate(r.planned_start_at),
  durationMinutes: r.duration_minutes,
  plannedDate: r.planned_date_text,
  voided: r.voided_at !== null,
  isSelf,
  inFlight,
});

const timeLabelOf = (r: PlanWithJoins): string => {
  const s = asDate(r.planned_start_at);
  return `${jstTime(s)}〜${jstTime(new Date(s.getTime() + r.duration_minutes * MINUTE_MS))}`;
};

const badgeOf = (now: Date, r: PlanWithJoins, state: FieldState | undefined): TodayBadgeDto => {
  if (state?.openFlight) return BADGE.in_flight;
  if (state && state.pendingJournal.length > 0) return BADGE.journal_pending;
  if (state && state.flights.length > 0) return BADGE.journaled;
  const end = asDate(r.planned_start_at).getTime() + r.duration_minutes * MINUTE_MS;
  return end <= now.getTime() ? BADGE.ended : BADGE.planned;
};

const journeyOf = (r: PlanWithJoins, dto: PlanDto, state: FieldState | undefined, hasFlightRecord: boolean, today: string): JourneyStageDto[] =>
  journeyStages({
    hasSnapshot: dto.currentSnapshotId !== "",
    judgementStale: dto.freshness.stale,
    planState: dto.state,
    reportStatus: dto.report.status.code,
    // 日常点検は飛行当日の記録。先の日の計画では、まだ数えない
    inspectionDone: r.planned_date_text === today && (state?.checks.inspection.done ?? false),
    hasLandedFlight: (state?.flights ?? []).some((f) => f.landingEventId !== null),
    inFlight: state?.openFlight != null,
    journalPending: (state?.pendingJournal.length ?? 0) > 0,
    hasFlightRecord,
  });

const REASON_LABEL: Readonly<Record<TodayCardReason, string>> = {
  in_flight: "飛行中",
  today: "今日の飛行",
  next: "次の飛行",
};

/**
 * 「今日」の画面の内容を組み立てる。閲覧は全役割（canAct が役割と自分の飛行で決まる）。他の組織の計画・記録は出ない。
 * limit は次にやることの件数の上限（`/` の帯は 3 件）。
 */
export const getToday = async (ctx: OpsContext, opts: { readonly limit?: number } = {}): Promise<TodayDto> => {
  assertCan(ctx, "field.read");
  const org = ctx.member.org_id;
  const role = ctx.member.role;
  const now = nowOf(ctx);
  const today = jstDate(now);
  const mine = await myPilot(ctx);

  // 計画：今日から 7 日以内に始まる計画 ＋ 離陸の行がある（飛行中・日誌待ちの）計画
  const windowRows = await store.listPlans(ctx.db, org, {
    from: today,
    to: addDays(today, NEXT_ACTION_WINDOW_DAYS),
    oldestFirst: true,
  });
  const takeoffPlanIds = await store.listPlanIdsWithTakeoffSince(ctx.db, org, new Date(now.getTime() - TAKEOFF_LOOKBACK_DAYS * DAY_MS));
  const known = new Set(windowRows.map((r) => r.id));
  const extraRows = await store.listPlansByIds(
    ctx.db,
    org,
    takeoffPlanIds.filter((id) => !known.has(id)),
  );
  const rows = [...windowRows, ...extraRows];
  const planIds = rows.map((r) => r.id);

  // まとめて引く（計画の件数に比例しない）
  const [events, inspectionRows, flightRecordPlanIds] = await Promise.all([
    store.listFieldEventsFor(ctx.db, org, planIds),
    store.listFieldInspections(ctx.db, org, [...new Set(rows.map((r) => r.aircraft_id))], today),
    store.plansWithFlightRecords(ctx.db, org, planIds),
  ]);
  const linkedRecordIds = events.map((e) => e.flight_record_id).filter((x): x is string => x !== null);
  const voidState = await store.listFlightRecordVoidState(ctx.db, org, linkedRecordIds);
  const summaries = await loadPlanSummaries(ctx, rows, mine);

  // 計画ごとの現場の状態（日常点検は今日の日付で導出する）
  const eventsBy = new Map<string, FieldEventLite[]>();
  for (const e of events) eventsBy.set(e.plan_id, [...(eventsBy.get(e.plan_id) ?? []), toLite(e)]);
  const recordState: FieldFlightRecordLite[] = voidState;
  const stateBy = new Map<string, FieldState>();
  for (const r of rows) {
    // 飛行前・飛行後の日常点検（飛行後点検の未了を導出する。Sprint 14）
    const inspections = fieldInspectionLites(inspectionRows.filter((x) => x.aircraft_id === r.aircraft_id));
    stateBy.set(r.id, fieldState({ events: eventsBy.get(r.id) ?? [], inspections, flightRecords: recordState, day: today }));
  }

  // 今日のカード
  const isSelfOf = (r: PlanWithJoins): boolean => mine !== null && mine.id === r.pilot_id;
  const model = todayModel({
    now,
    today,
    role,
    plans: rows.map((r) => planLite(r, isSelfOf(r), stateBy.get(r.id)?.openFlight != null)),
  });
  const summaryBy = new Map(summaries.map((s) => [s.row.id, s]));

  // 準備カードの判定の行の材料：カードの計画の現在の判定の項目を段階ごとに数える（1 回の問い合わせ。失敗しても画面の他の部分は出す）
  const prepJudgement = await (async (): Promise<PrepJudgementInput> => {
    if (!model.card) return { kind: "load_failed" };
    const s = summaryBy.get(model.card.planId);
    if (!s) return { kind: "load_failed" };
    const stale = s.dto.freshness.stale;
    try {
      const c = await store.snapshotItemCounts(ctx.db, org, s.row.current_snapshot_id);
      if (!c) return { kind: "no_record", stale };
      return { kind: "counts", stale, counts: { noFly: c.no_fly, needs: c.needs_procedure, unknown: c.unknown, done: c.procedure_done, none: c.no_procedure } };
    } catch {
      return { kind: "load_failed" };
    }
  })();

  const card = ((): TodayCardDto | null => {
    if (!model.card) return null;
    const s = summaryBy.get(model.card.planId);
    if (!s) return null;
    const r = s.row;
    const dto = s.dto;
    const start = asDate(r.planned_start_at);
    const isToday = r.planned_date_text === today;
    const inFlight = stateBy.get(r.id)?.openFlight != null;
    // 有効な通報の行（受付番号の有無を準備カードの通報の行に使う）
    const effective = dto.report.status.effectiveId ? (s.extras.rows.find((x) => x.id === dto.report.status.effectiveId) ?? null) : null;
    return {
      planId: r.id,
      reason: model.card.reason,
      reasonLabel: REASON_LABEL[model.card.reason],
      title: r.title,
      plannedDate: r.planned_date_text,
      plannedStartAtJst: dto.plannedStartAtJst,
      plannedEndAtJst: toJstInput(new Date(start.getTime() + r.duration_minutes * MINUTE_MS)).replace("T", " "),
      timeLabel: timeLabelOf(r),
      registrationMark: r.registration_mark,
      modelName: r.model_name,
      pilotName: r.pilot_name,
      placeName: r.place_name,
      verdictLevel: dto.judgement.verdictLevel,
      verdictLabel: (VERDICT_LABEL as Record<string, string>)[dto.judgement.verdictLevel] ?? dto.judgement.verdictLevel,
      judgementStale: dto.freshness.stale,
      report: {
        requirementKind: dto.report.kind,
        requirementLabel: dto.report.label,
        statusCode: dto.report.status.code,
        statusLabel: dto.report.status.label,
        statusShortLabel: dto.report.status.shortLabel,
        statusMark: dto.report.status.mark,
        detail: dto.report.status.detail,
      },
      confirmation: { state: dto.state, label: dto.stateLabel },
      badge: badgeOf(now, r, stateBy.get(r.id)),
      prep: {
        report: prepReportKey(dto.report.status.code, hasReportNumber(effective ? { dipsNumber: effective.dips_number, numberUnavailable: effective.number_unavailable } : null)),
        inspection: prepInspectionKey({
          isFlightDay: isToday,
          done: stateBy.get(r.id)?.checks.inspection.done ?? false,
          abnormal: stateBy.get(r.id)?.checks.inspection.abnormal ?? false,
        }),
        judgement: prepJudgement,
      },
      journey: journeyOf(r, dto, stateBy.get(r.id), flightRecordPlanIds.has(r.id), today),
      primary:
        isToday || inFlight
          ? { kind: "field", label: "現場モードを開く", href: fieldHref(r.id) }
          : { kind: "plan", label: "計画を開く", href: `/ops/plans/${r.id}` },
    };
  })();

  const rest = model.rest
    .map((id): TodayRowDto | null => {
      const s = summaryBy.get(id);
      if (!s) return null;
      return {
        planId: id,
        title: s.row.title,
        timeLabel: timeLabelOf(s.row),
        plannedStartAtJst: s.dto.plannedStartAtJst,
        registrationMark: s.row.registration_mark,
        pilotName: s.row.pilot_name,
        confirmationLabel: s.dto.stateLabel,
        reportShortLabel: s.dto.report.status.shortLabel,
        badge: badgeOf(now, s.row, stateBy.get(id)),
        href: `/ops/plans/${id}`,
      };
    })
    .filter((x): x is TodayRowDto => x !== null);

  // 直近の飛行：今日より先の日に始まる、中止していない計画（すでに読み込んだ窓の中から作る。追加の問い合わせはしない）
  const upcoming = summaries
    .filter((s) => s.row.voided_at === null && s.row.planned_date_text > today)
    .sort((a, b) => asDate(a.row.planned_start_at).getTime() - asDate(b.row.planned_start_at).getTime() || (a.row.id < b.row.id ? -1 : 1))
    .slice(0, UPCOMING_LIMIT)
    .map(
      (s): TodayUpcomingDto => ({
        planId: s.row.id,
        title: s.row.title,
        plannedDate: s.row.planned_date_text,
        timeLabel: timeLabelOf(s.row),
        daysLeft: daysBetween(today, s.row.planned_date_text),
        href: `/ops/plans/${s.row.id}`,
        journey: journeyOf(s.row, s.dto, stateBy.get(s.row.id), flightRecordPlanIds.has(s.row.id), today),
      }),
    );

  // 次にやること：12b の導出（planNextActions）＋ 飛行当日・現場の導出 ＋ 食い違い ＋ 技能証明
  const actions: TodayNextAction[] = [];
  const inWindow = (r: PlanWithJoins): boolean =>
    r.planned_date_text >= today && r.planned_date_text <= addDays(today, NEXT_ACTION_WINDOW_DAYS);
  const startOf = new Map<string, number>();
  for (const s of summaries) {
    const r = s.row;
    const state = stateBy.get(r.id)!;
    const live = r.voided_at === null;
    const relevant = (live && inWindow(r)) || state.openFlight !== null || state.pendingJournal.length > 0;
    if (!relevant) continue;
    const isSelf = isSelfOf(r);
    const planId = r.id;
    if (live && inWindow(r)) {
      for (const a of s.nextActions as readonly NextAction[]) actions.push({ ...a, planId, planTitle: r.title });
      startOf.set(r.pilot_id, Math.min(startOf.get(r.pilot_id) ?? Infinity, Math.floor((asDate(r.planned_start_at).getTime() - now.getTime()) / MINUTE_MS)));
    }
    actions.push(
      ...fieldNextActions({
        planId,
        planTitle: r.title,
        plannedStartAt: asDate(r.planned_start_at),
        durationMinutes: r.duration_minutes,
        plannedDate: r.planned_date_text,
        voided: !live,
        now,
        today,
        state,
        hasFlightRecord: flightRecordPlanIds.has(planId),
        can: {
          record: can(role, "field.record", { isSelf }),
          inspect: can(role, "inspection.create", { isSelf }),
          journal: can(role, "flight.create", { isSelf }),
        },
      }),
    );
  }

  // 直近 3 日間の飛行記録の食い違い（確認済みの記録は作らない。時間で消える）
  const recent = await store.listFlightsSince(ctx.db, org, new Date(now.getTime() - 3 * DAY_MS));
  const extras = await enrichFlights(ctx.db, org, recent);
  actions.push(
    ...mismatchNextActions(
      recent.map((f) => ({
        flightId: f.id,
        planId: f.flight_plan_id,
        planTitle: extras.get(f.id)?.planTitle ?? null,
        takeoffAt: asDate(f.takeoff_at),
        now,
        mismatches: extras.get(f.id)?.mismatches ?? [],
      })),
    ),
  );

  // 技能証明の有効期限（今日から 7 日以内に始まる計画の操縦者。既存の列だけ。期限一覧は 12f）と、ホームの「近づく期限」の材料。
  // 操縦者と許可・承認の行は、組織の全員分を 1 回ずつ読む（閲覧は全役割。authz.ts の pilot.read・permit.read）
  const [allPilots, permitRows] = await Promise.all([store.listPilots(ctx.db, org, false), store.listPermits(ctx.db, org, false)]);
  const pilotIds = new Set(rows.filter((r) => r.voided_at === null && inWindow(r)).map((r) => r.pilot_id));
  if (pilotIds.size > 0) {
    actions.push(
      ...licenseNextActions(
        allPilots
          .filter((p) => pilotIds.has(p.id))
          .map((p) => ({
            pilotId: p.id,
            pilotName: p.full_name,
            expiresOn: dateOnly(p.license_expires_on),
            today,
            startsInMinutes: startOf.get(p.id) ?? 0,
            canAct: can(role, "pilot.update", { isSelf: p.member_id === ctx.member.id }),
          })),
      ),
    );
  }
  const deadlines = deadlinesOf({
    today,
    pilots: allPilots.map((p) => ({ id: p.id, name: p.full_name, licenseExpiresOn: dateOnly(p.license_expires_on), voided: p.voided_at !== null })),
    permits: permitRows.map((r) => ({
      id: r.id,
      permitNumber: r.permit_number,
      coverage: r.coverage,
      validTo: r.valid_to,
      revokedOn: r.revoked_on,
      status: r.status,
      voided: r.voided_at !== null,
    })),
  });

  // Sprint 12e：事故・ヒヤリハット（報告の要否を確認する・詳細を記入する）。計画に結び付かない記録の分も出る
  actions.push(...(await incidentTodayActions(ctx)));

  const limit = opts.limit ?? TODAY_NEXT_ACTION_LIMIT;
  const ranked = rankNextActions(actions, limit);
  return {
    serverNow: now.toISOString(),
    serverNowJst: toJstInput(now),
    today,
    card,
    rest,
    upcoming,
    deadlines,
    nextActions: ranked,
    nextActionTotal: actions.length,
    plansHref: "/ops/plans",
    empty: card
      ? null
      : {
          message: rest.length > 0 ? TODAY_EMPTY_TODAY : TODAY_EMPTY_NONE,
          actions: TODAY_EMPTY_ACTIONS,
        },
  };
};

export { HOME_BAND_NEXT_ACTION_LIMIT };
