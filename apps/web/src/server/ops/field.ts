// 現場モードのサービス層（Sprint 12c 設計 A・B・D・E）。画面と API の両方がここを通る。
// 認可は authz.ts の can()、DB の読み書きは store.ts（org_id 必須）だけで行う。
//
//   getFieldView      GET  /api/ops/plans/[id]/field         現場モードの状態（確認項目・飛行の組・未了事項の予告・通報の状況）
//   listFieldEvents   GET  /api/ops/plans/[id]/field-events   現場の事実の行
//   recordFieldEvent  POST /api/ops/plans/[id]/field-events   1 行を追記する（確認・離陸・着陸・取り消す）
//
// 守ること：
//   - 離陸は未了事項があっても 201 で記録する（事実の記録を止めない）。未了事項はサーバーが導出して gaps に写しを残す
//     （リクエストの gaps・snapshotId・planVersion は読まない）。
//   - 遷移の規則は field-logic.ts の decideTransition が 1 か所で決める。計画ごとの排他（pg_advisory_xact_lock）の下で検査して書く。
//   - 同じ clientEventId の再送は、内容が同じなら新しい行を作らず既存を 200 で返す。内容が違えば 409 request_conflict。
//   - 技能証明書番号・氏名は行に入れない。DIPS へは送信しない（自分の DB だけ）。
import { VERDICT_LABEL } from "@soraban/regulations";
import {
  EMERGENCY_DESIGNATED_WARNING,
  EMERGENCY_SOURCE_OPTIONS,
  FIELD_CHECK_ITEMS,
  FIELD_CHECK_ITEM_LABEL,
  FIELD_REPORT_CHANGED_WARNING,
  FIELD_REPORT_NONE_WARNING,
  FIELD_REPORT_NOT_REQUIRED_MODEL,
  FIELD_REPORT_NOT_REQUIRED_RECOMMENDED,
  FIELD_STATE_ABNORMAL,
  FIELD_STATE_DONE,
  FIELD_STATE_IN_FLIGHT,
  FIELD_STATE_JOURNAL_DONE,
  FIELD_STATE_JOURNAL_PENDING,
  FIELD_STATE_TODO,
  FIELD_CHECK_RESULT_LABEL,
  INSPECTION_ABNORMAL_GUIDANCE,
  checkFieldTime,
  fieldErrorMessage,
  outsidePlanWindowLabel,
  type FieldCheckItem,
  type FieldCheckResult,
  type FieldEventKind,
} from "@/lib/ops-field";
import { formatJst, jstDate, jstTime, toJstInput } from "@/lib/ops-time";
import { can } from "./authz";
import { decideTransition, takeoffGaps, type FieldEventLite, type FieldFlight, type InspectionLite, type FieldGap, type FieldState, type FieldRequest } from "./field-logic";
import { loadFieldState } from "./field-rows";
import { gapDto, type GapDto } from "./flight-extras";
import { loadPlanBundle } from "./plans";
import { asDate, nowOf } from "./records";
import { asInput, assertCan, type OpsContext } from "./service";
import * as store from "./store";
import { OpsError, type FieldEventRowWithTimes, type PlanWithJoins } from "./store";
import { validateFieldEvent, type FieldEventData } from "./validate-field";
import type { PlanDto } from "./plans";

// ---- DTO -----------------------------------------------------------------

export type WindowNoticeDto = {
  readonly code: "outside_plan_window";
  readonly label: string;
  readonly earlyMinutes: number;
  readonly lateMinutes: number;
};

export type FieldEventDto = {
  readonly id: string;
  readonly planId: string;
  readonly kind: FieldEventKind;
  readonly item: FieldCheckItem | null;
  readonly result: FieldCheckResult | null;
  readonly source: string | null;
  readonly targetEventId: string | null;
  readonly flightRecordId: string | null;
  readonly inspectionId: string | null;
  readonly reportId: string | null;
  /** 事実の時刻（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly occurredAt: string;
  readonly occurredAtJst: string;
  /** 表示用 `HH:MM`。 */
  readonly occurredTime: string;
  /** 記録した時点の計画の現在のスナップショットと版（DB が決める）。 */
  readonly snapshotId: string;
  readonly planVersion: number;
  /** takeoff だけ：離陸の時点の未了事項の写し（それ以外は null）。 */
  readonly gaps: readonly GapDto[] | null;
  readonly note: string | null;
  readonly queued: boolean;
  readonly clientEventId: string;
  readonly recordedByMemberId: string;
  /** 記録した時点の表示名・役割の写し。 */
  readonly recordedByName: string;
  readonly recordedByRole: string;
  readonly recordedAt: string;
  readonly contentHash: string;
};

export const fieldEventDto = (r: FieldEventRowWithTimes): FieldEventDto => ({
  id: r.id,
  planId: r.plan_id,
  kind: r.kind,
  item: r.item,
  result: r.result,
  source: r.source,
  targetEventId: r.target_event_id,
  flightRecordId: r.flight_record_id,
  inspectionId: r.inspection_id,
  reportId: r.report_id,
  occurredAt: r.occurred_at_jst,
  occurredAtJst: r.occurred_at_jst.replace("T", " "),
  occurredTime: r.occurred_at_jst.slice(11),
  snapshotId: r.snapshot_id,
  planVersion: r.plan_version,
  gaps: r.gaps === null ? null : r.gaps.map(gapDto),
  note: r.note,
  queued: r.queued,
  clientEventId: r.client_event_id,
  recordedByMemberId: r.recorded_by_member_id,
  recordedByName: r.recorded_by_name,
  recordedByRole: r.recorded_by_role,
  recordedAt: asDate(r.recorded_at).toISOString(),
  contentHash: r.content_hash,
});

/** POST の応答：記録した行（gaps は離陸の未了事項）に、時間帯の外の知らせと、再送の印を足したもの。 */
export type FieldEventPostDto = FieldEventDto & {
  /** 離陸・着陸が計画の時間帯の外なら、知らせる内容（記録は成功している）。 */
  readonly windowNotice: WindowNoticeDto | null;
  /** 同じ clientEventId の再送で、既存の行を返した（新しい行を作っていない）。 */
  readonly duplicate: boolean;
};

export type FieldItemDto = {
  readonly item: FieldCheckItem;
  readonly label: string;
  readonly done: boolean;
  /** 済／未／異常あり（文字。色だけで区別しない）。 */
  readonly stateLabel: string;
  /** 済の時刻（表示用 HH:MM）。 */
  readonly time: string | null;
  readonly result: FieldCheckResult | null;
  readonly resultLabel: string | null;
  /** 緊急用務空域の確認元（選択肢の ID と題名）。 */
  readonly source: string | null;
  readonly sourceTitle: string | null;
  /** 取り消す対象の確認の行の ID（日常点検・未は null）。 */
  readonly eventId: string | null;
  readonly inspectionId: string | null;
  readonly abnormal: boolean;
  readonly designated: boolean;
  /** 目立たせる警告（指定されている・異常あり・通報の記録なし 等）。止める文言にしない。 */
  readonly warning: string | null;
  /** 取り消すボタンを出してよいか（行があり、記録する権限がある）。 */
  readonly undoable: boolean;
};

export type FieldFlightDto = {
  readonly takeoffEventId: string;
  readonly takeoffClientEventId: string;
  readonly takeoffAt: string;
  readonly takeoffTime: string;
  readonly takeoffQueued: boolean;
  readonly gaps: readonly GapDto[];
  readonly landingEventId: string | null;
  readonly landingAt: string | null;
  readonly landingTime: string | null;
  readonly landingQueued: boolean;
  readonly journalEventId: string | null;
  readonly flightRecordId: string | null;
  readonly phase: FieldFlight["phase"];
  readonly phaseLabel: string;
  /** 計画の時間帯の外の知らせ（離陸が早い・着陸が遅い）。 */
  readonly windowNotice: WindowNoticeDto | null;
};

export type FieldReportDto = {
  readonly requirementKind: string;
  readonly requirementLabel: string;
  readonly statusCode: string;
  readonly statusLabel: string;
  readonly statusMark: string;
  /** 通報の日時・番号（手動記録なら「手動（利用者の申告）」を含む表示）。無ければ null。 */
  readonly detail: string | null;
  readonly effectiveReportId: string | null;
  /** 記録の取得元（手動＝利用者の申告）。 */
  readonly channelLabel: string | null;
  /** 推奨・対象外の計画：「この飛行は通報の記録を必須としません」。それ以外は null。 */
  readonly notRequiredNote: string | null;
  readonly warning: string | null;
  /** 「通報内容を開く」の経路。 */
  readonly reportHref: string;
  /** 「通報内容を再確認した」を出してよいか（有効な通報がある）。 */
  readonly canRecheck: boolean;
};

export type FieldViewDto = {
  readonly serverNow: string;
  /** サーバーの現在（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly serverNowJst: string;
  readonly today: string;
  readonly plan: {
    readonly id: string;
    readonly title: string;
    readonly plannedDate: string;
    readonly plannedStartAtJst: string;
    readonly plannedEndAtJst: string;
    /** 表示用 `HH:MM〜HH:MM`。 */
    readonly timeLabel: string;
    readonly durationMinutes: number;
    readonly registrationMark: string;
    readonly modelName: string;
    readonly pilotName: string;
    readonly placeName: string;
    readonly purpose: string;
    readonly permitNumbers: string | null;
    readonly voided: boolean;
    readonly state: string;
    readonly stateLabel: string;
    readonly verdictLevel: string;
    readonly verdictLabel: string;
    readonly judgementStale: boolean;
    readonly isSelf: boolean;
  };
  readonly canRecord: boolean;
  readonly canJournal: boolean;
  readonly canInspect: boolean;
  /** 飛行前の 4 項目（日常点検、緊急用務空域、通報済みの再確認、携行品の順）。 */
  readonly items: readonly FieldItemDto[];
  readonly report: FieldReportDto;
  readonly emergencySources: readonly { readonly id: string; readonly title: string; readonly url: string }[];
  /** 離陸 → 着陸 → 日誌の組（離陸の古い順。複数回の離着陸がありうる）。 */
  readonly flights: readonly FieldFlightDto[];
  readonly openFlightEventId: string | null;
  /** 着陸済みで日誌待ちの離陸の ID（古い順）。 */
  readonly pendingJournalTakeoffEventIds: readonly string[];
  /** いま離陸した場合の未了事項の予告（離陸は止めない）。 */
  readonly takeoffPreview: readonly GapDto[];
  /** 同じ日の、他の計画（切り替えボタン用。無ければ空）。 */
  readonly sameDayPlans: readonly { readonly id: string; readonly title: string; readonly timeLabel: string; readonly isCurrent: boolean }[];
  /**
   * 状態を端末で導出し直すための入力（送信待ちの行を足して fieldState に渡し、押した結果を即座に反映する）。
   * 技能証明書番号・氏名は含まない。
   */
  readonly stateInput: {
    readonly events: readonly FieldEventLite[];
    readonly inspections: readonly InspectionLite[];
    readonly flightRecords: readonly { readonly id: string; readonly voided: boolean }[];
    readonly day: string;
  };
};

// ---- 通報の状況（再掲） ----------------------------------------------------

const CHANNEL_LABEL: Readonly<Record<string, string>> = {
  manual: "手動（利用者の申告）",
  mock: "模擬の送信（開発用）",
  api: "API による送信",
};

const reportBlock = (plan: PlanWithJoins, dto: PlanDto, extras: Awaited<ReturnType<typeof loadPlanBundle>>["extras"]): FieldReportDto => {
  const kind = dto.report.kind;
  const st = dto.report.status;
  const needs = kind === "required" || kind === "confirm";
  const effective = st.effectiveId ? extras.rows.find((r) => r.id === st.effectiveId) : undefined;
  const warning = !needs
    ? null
    : st.code === "change_review"
      ? FIELD_REPORT_CHANGED_WARNING
      : st.code === "reported"
        ? null
        : FIELD_REPORT_NONE_WARNING;
  return {
    requirementKind: kind,
    requirementLabel: dto.report.label,
    statusCode: st.code,
    statusLabel: st.label,
    statusMark: st.mark,
    detail: effective ? st.detail : null,
    effectiveReportId: st.effectiveId,
    channelLabel: effective ? (CHANNEL_LABEL[effective.channel] ?? null) : null,
    notRequiredNote:
      kind === "recommended" ? FIELD_REPORT_NOT_REQUIRED_RECOMMENDED : kind === "not_applicable_model" ? FIELD_REPORT_NOT_REQUIRED_MODEL : null,
    warning,
    reportHref: `/ops/plans/${plan.id}/report`,
    canRecheck: st.effectiveId !== null,
  };
};

// ---- 時間帯の外の知らせ ---------------------------------------------------------

const MINUTE_MS = 60_000;

const windowNotice = (plan: PlanWithJoins, takeoffAt: Date | null, landingAt: Date | null): WindowNoticeDto | null => {
  const start = asDate(plan.planned_start_at).getTime();
  const end = start + plan.duration_minutes * MINUTE_MS;
  const early = takeoffAt ? Math.max(0, Math.ceil((start - takeoffAt.getTime()) / MINUTE_MS)) : 0;
  const late = landingAt ? Math.max(0, Math.ceil((landingAt.getTime() - end) / MINUTE_MS)) : 0;
  if (early === 0 && late === 0) return null;
  return { code: "outside_plan_window", label: outsidePlanWindowLabel(early, late), earlyMinutes: early, lateMinutes: late };
};

// ---- 離陸の未了事項（サーバーが導出する） ----------------------------------------------

type Bundle = Awaited<ReturnType<typeof loadPlanBundle>>;

const effectiveReportedAt = (b: Bundle): string | null => {
  const id = b.dto.report.status.effectiveId;
  return id ? (b.extras.rows.find((r) => r.id === id)?.reported_at_jst ?? null) : null;
};

const gapsFor = (b: Bundle, checks: FieldState["checks"], takeoffAtJst: string): FieldGap[] =>
  takeoffGaps({
    checks,
    requirementKind: b.dto.report.kind,
    reportStatusCode: b.dto.report.status.code,
    effectiveReportedAt: effectiveReportedAt(b),
    takeoffAtJst,
    planState: b.dto.state,
    judgementStale: b.dto.freshness.stale,
  });

// ---- 現場モードの状態 -------------------------------------------------------------

const PHASE_LABEL: Readonly<Record<FieldFlight["phase"], string>> = {
  in_flight: FIELD_STATE_IN_FLIGHT,
  journal_pending: FIELD_STATE_JOURNAL_PENDING,
  journaled: FIELD_STATE_JOURNAL_DONE,
};

const sourceTitle = (id: string | null): string | null => EMERGENCY_SOURCE_OPTIONS.find((o) => o.id === id)?.title ?? null;

export const getFieldView = async (ctx: OpsContext, planId: string): Promise<FieldViewDto> => {
  assertCan(ctx, "field.read");
  const b = await loadPlanBundle(ctx, planId);
  const { plan, dto } = b;
  const now = nowOf(ctx);
  const today = jstDate(now);
  const org = ctx.member.org_id;
  const loaded = await loadFieldState(ctx.db, org, plan, today);
  const state = loaded.state;
  const canRecord = can(ctx.member.role, "field.record", { isSelf: dto.isSelf });
  const start = asDate(plan.planned_start_at);
  const end = new Date(start.getTime() + plan.duration_minutes * MINUTE_MS);
  const report = reportBlock(plan, dto, b.extras);

  const items = FIELD_CHECK_ITEMS.map((item): FieldItemDto => {
    const c = state.checks[item];
    const warning =
      item === "inspection" && c.abnormal
        ? INSPECTION_ABNORMAL_GUIDANCE
        : item === "emergency_airspace" && c.designated
          ? EMERGENCY_DESIGNATED_WARNING
          : item === "report_recheck"
            ? report.warning
            : null;
    return {
      item,
      label: FIELD_CHECK_ITEM_LABEL[item],
      done: c.done,
      stateLabel: !c.done ? FIELD_STATE_TODO : c.abnormal ? FIELD_STATE_ABNORMAL : FIELD_STATE_DONE,
      time: c.at ? jstTime(new Date(c.at)) : null,
      result: c.result,
      resultLabel: c.result ? FIELD_CHECK_RESULT_LABEL[c.result] : null,
      source: c.source,
      sourceTitle: sourceTitle(c.source),
      eventId: c.eventId,
      inspectionId: c.inspectionId,
      abnormal: c.abnormal,
      designated: c.designated,
      warning,
      undoable: c.eventId !== null && canRecord,
    };
  });

  const flights = state.flights.map(
    (f): FieldFlightDto => ({
      takeoffEventId: f.takeoffEventId,
      takeoffClientEventId: f.takeoffClientEventId,
      takeoffAt: toJstInput(new Date(f.takeoffAt)),
      takeoffTime: jstTime(new Date(f.takeoffAt)),
      takeoffQueued: f.takeoffQueued,
      gaps: f.gaps.map(gapDto),
      landingEventId: f.landingEventId,
      landingAt: f.landingAt ? toJstInput(new Date(f.landingAt)) : null,
      landingTime: f.landingAt ? jstTime(new Date(f.landingAt)) : null,
      landingQueued: f.landingQueued,
      journalEventId: f.journalEventId,
      flightRecordId: f.flightRecordId,
      phase: f.phase,
      phaseLabel: PHASE_LABEL[f.phase],
      windowNotice: windowNotice(plan, new Date(f.takeoffAt), f.landingAt ? new Date(f.landingAt) : null),
    }),
  );

  const sameDay = (await store.listPlans(ctx.db, org, { from: plan.planned_date_text, to: plan.planned_date_text, oldestFirst: true }))
    .filter((p) => p.voided_at === null)
    .map((p) => {
      const s = asDate(p.planned_start_at);
      return {
        id: p.id,
        title: p.title,
        timeLabel: `${jstTime(s)}〜${jstTime(new Date(s.getTime() + p.duration_minutes * MINUTE_MS))}`,
        isCurrent: p.id === plan.id,
      };
    });

  return {
    serverNow: now.toISOString(),
    serverNowJst: toJstInput(now),
    today,
    plan: {
      id: plan.id,
      title: plan.title,
      plannedDate: plan.planned_date_text,
      plannedStartAtJst: formatJst(start),
      plannedEndAtJst: formatJst(end),
      timeLabel: `${jstTime(start)}〜${jstTime(end)}`,
      durationMinutes: plan.duration_minutes,
      registrationMark: plan.registration_mark,
      modelName: plan.model_name,
      pilotName: plan.pilot_name,
      placeName: plan.place_name,
      purpose: plan.purpose,
      permitNumbers: plan.permit_numbers,
      voided: plan.voided_at !== null,
      state: dto.state,
      stateLabel: dto.stateLabel,
      verdictLevel: dto.judgement.verdictLevel,
      verdictLabel: (VERDICT_LABEL as Record<string, string>)[dto.judgement.verdictLevel] ?? dto.judgement.verdictLevel,
      judgementStale: dto.freshness.stale,
      isSelf: dto.isSelf,
    },
    canRecord,
    canJournal: can(ctx.member.role, "flight.create", { isSelf: dto.isSelf }),
    canInspect: can(ctx.member.role, "inspection.create", { isSelf: dto.isSelf }),
    items,
    report,
    emergencySources: EMERGENCY_SOURCE_OPTIONS,
    flights,
    openFlightEventId: state.openFlight?.takeoffEventId ?? null,
    pendingJournalTakeoffEventIds: state.pendingJournal.map((f) => f.takeoffEventId),
    takeoffPreview: gapsFor(b, state.checks, toJstInput(now)).map(gapDto),
    sameDayPlans: sameDay.length > 1 ? sameDay : [],
    stateInput: {
      events: loaded.events,
      inspections: loaded.inspections,
      flightRecords: loaded.flightRecords,
      day: today,
    },
  };
};

export const listFieldEvents = async (ctx: OpsContext, planId: string): Promise<{ readonly events: FieldEventDto[] }> => {
  assertCan(ctx, "field.read");
  const { plan } = await loadPlanBundle(ctx, planId);
  return { events: (await store.listFieldEventsFor(ctx.db, ctx.member.org_id, [plan.id])).map(fieldEventDto) };
};

// ---- 追記 --------------------------------------------------------------------

/** 同じ clientEventId の既存の行が、再送された内容と同じか（queued は送信の経路なので比べない）。 */
const sameContent = async (ctx: OpsContext, existing: FieldEventRowWithTimes, planId: string, d: FieldEventData): Promise<boolean> => {
  if (existing.plan_id !== planId || existing.recorded_by_member_id !== ctx.member.id) return false;
  if (existing.kind !== d.kind || existing.occurred_at_jst !== d.occurredAt) return false;
  if ((existing.note ?? null) !== d.note) return false;
  if (d.kind === "check") {
    if (existing.item !== d.item || existing.result !== d.result || (existing.source ?? null) !== d.source) return false;
  }
  if (d.targetRef !== null) {
    const t = await store.getFieldEventByRef(ctx.db, ctx.member.org_id, d.targetRef);
    if (!t || existing.target_event_id !== t.id) return false;
  }
  return true;
};

const conflictFromInsert = (e: unknown): never => {
  const o = (e ?? {}) as { code?: unknown; constraint?: unknown };
  if (o.code === "23505") {
    const c = typeof o.constraint === "string" ? o.constraint : "";
    if (c === "uq_flight_field_events_undo_target") throw new OpsError(409, "already_undone");
    if (c === "uq_flight_field_events_client_event") throw new OpsError(409, "request_conflict");
  }
  throw e;
};

export type FieldRecordResult = { readonly created: boolean; readonly event: FieldEventPostDto };

/**
 * 現場の事実を 1 行追記する。確認（check）・離陸（takeoff）・着陸（landing）・取り消す（undo）。
 * 運航管理者は全員分（代理入力）、操縦者は自分が操縦者の計画だけ、閲覧者は 403。他の組織の計画は 404。
 */
export const recordFieldEvent = async (ctx: OpsContext, planId: string, body: unknown): Promise<FieldRecordResult> => {
  const b0 = await loadPlanBundle(ctx, planId);
  assertCan(ctx, "field.record", b0.dto.isSelf);
  const v = validateFieldEvent(asInput(body));
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors, v.codes);
  const d = v.data;
  const org = ctx.member.org_id;

  // 再送（二重送信・応答を落とした再試行）：同じ内容なら既存の行を 200 で返し、内容が違えば 409
  const existing = await store.findFieldEventByClientId(ctx.db, org, d.clientEventId);
  if (existing) {
    if (!(await sameContent(ctx, existing, b0.plan.id, d))) throw new OpsError(409, "request_conflict");
    return { created: false, event: { ...fieldEventDto(existing), windowNotice: null, duplicate: true } };
  }

  // 時刻の検査（未来・端末の時計のずれ・古すぎる送信待ち）
  const now = nowOf(ctx);
  const tc = checkFieldTime(d.occurredAtDate, now, d.queued);
  if (!tc.ok) throw new OpsError(400, tc.code, { occurredAt: fieldErrorMessage(tc.code) }, { occurredAt: tc.code });

  const outcome = await store.withTransaction(ctx.db, async (c) => {
    // 計画ごとの排他（二重の離陸を並行リクエストですり抜けられないように、計画の版・確認と同じ鍵）
    await store.lockPlanOn(c, b0.plan.id);
    const again = await store.findFieldEventByClientId(c, org, d.clientEventId);
    if (again) {
      if (!(await sameContent(ctx, again, b0.plan.id, d))) throw new OpsError(409, "request_conflict");
      return { row: again, created: false, notice: null as WindowNoticeDto | null };
    }
    // 排他の下で、最新の計画・状態を読み直す
    const b = await loadPlanBundle(ctx, planId);
    const today = jstDate(now);
    const loaded = await loadFieldState(c, org, b.plan, today);
    const req: FieldRequest =
      d.kind === "check"
        ? { kind: "check", item: d.item }
        : d.kind === "takeoff"
          ? { kind: "takeoff" }
          : d.kind === "landing"
            ? { kind: "landing", targetEventId: d.targetRef }
            : { kind: "undo", targetEventId: d.targetRef! };
    const tr = decideTransition(loaded.events, loaded.state, req, { planCancelled: b.plan.voided_at !== null });
    if (!tr.ok) throw new OpsError(tr.status, tr.code);

    let gaps: readonly FieldGap[] | null = null;
    let reportId: string | null = null;
    let notice: WindowNoticeDto | null = null;
    if (d.kind === "takeoff") {
      // 日常点検は離陸の日で導出する（日付をまたぐ場合に備える）
      const takeoffDay = jstDate(d.occurredAtDate);
      const forDay = takeoffDay === today ? loaded : await loadFieldState(c, org, b.plan, takeoffDay);
      gaps = gapsFor(b, forDay.state.checks, d.occurredAt);
      notice = windowNotice(b.plan, d.occurredAtDate, null);
    } else if (d.kind === "landing") {
      const open = loaded.state.openFlight;
      notice = windowNotice(b.plan, open ? new Date(open.takeoffAt) : null, d.occurredAtDate);
    } else if (d.kind === "check" && d.item === "report_recheck") {
      reportId = b.dto.report.status.effectiveId;
    }

    let id: string;
    try {
      id = await store.insertFieldEventOn(c, {
        orgId: org,
        planId: b.plan.id,
        kind: d.kind,
        item: d.kind === "check" ? d.item : null,
        result: d.kind === "check" ? d.result : null,
        source: d.kind === "check" ? d.source : null,
        targetEventId: tr.targetEventId,
        flightRecordId: null,
        inspectionId: null,
        reportId,
        occurredAtJst: d.occurredAt,
        gaps,
        note: d.note,
        queued: d.queued,
        clientEventId: d.clientEventId,
        recordedByMemberId: ctx.member.id,
      });
    } catch (e) {
      return conflictFromInsert(e);
    }
    const row = (await store.findFieldEventByClientId(c, org, d.clientEventId))!;
    if (row.id !== id) throw new OpsError(409, "request_conflict");
    return { row, created: true, notice };
  });

  return { created: outcome.created, event: { ...fieldEventDto(outcome.row), windowNotice: outcome.notice, duplicate: !outcome.created } };
};
