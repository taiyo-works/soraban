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
  FIELD_REPORT_CHANGED_WARNING,
  FIELD_REPORT_NONE_WARNING,
  FIELD_REPORT_NOT_REQUIRED_MODEL,
  FIELD_REPORT_NOT_REQUIRED_RECOMMENDED,
  checkFieldTime,
  fieldErrorMessage,
  type FieldCheckResult,
  type FieldDocKey,
  type FieldEventItem,
  type FieldEventKind,
  type FieldSiteValues,
} from "@/lib/ops-field";
import { formatJst, jstDate, jstTime, toJstInput } from "@/lib/ops-time";
import { can } from "./authz";
import { relevantDipsKinds } from "./permit-logic";
import { judgeFieldDocs, type DocJudgement, type DocsJudgeInput } from "./docs-judge";
import { decideTransition, type FieldGap, type FieldState, type FieldRequest } from "./field-logic";
import {
  FIELD_BUNDLE_VERSION,
  composeFieldView,
  docsInputOf,
  gapDto,
  gapsFromInput,
  sanitizeFieldBundle,
  windowNoticeOf,
  type FieldBundleDocsInput,
  type FieldBundlePlan,
  type FieldGapInput,
  type FieldReportDto,
  type FieldViewDto,
  type GapDto,
  type WindowNoticeDto,
} from "./field-compose";
import { specificFlightTypesFromFlags } from "./plan-logic";
import { loadFieldState } from "./field-rows";
import { planPermitInputOfRow } from "./permit-match";
import { loadPlanBundle } from "./plans";
import { asDate, nowOf } from "./records";
import { asInput, assertCan, dateOnly, type OpsContext } from "./service";
import * as store from "./store";
import { OpsError, type FieldEventRowWithTimes, type PlanWithJoins } from "./store";
import { validateFieldEvent, type FieldEventData } from "./validate-field";
import type { PlanDto } from "./plans";

export type {
  FieldDocDto,
  FieldFlightDto,
  FieldItemDto,
  FieldReportDto,
  FieldViewDto,
  WindowNoticeDto,
  FieldBundlePlan,
} from "./field-compose";

// ---- DTO -----------------------------------------------------------------

export type FieldEventDto = {
  readonly id: string;
  readonly planId: string;
  readonly kind: FieldEventKind;
  readonly item: FieldEventItem | null;
  readonly result: FieldCheckResult | null;
  readonly source: string | null;
  /** Sprint 14：docs_confirm の対象。それ以外は null。 */
  readonly docKey: FieldDocKey | null;
  /** Sprint 14：site_conditions の値。それ以外は null。 */
  readonly site: FieldSiteValues | null;
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

const siteOfRow = (r: FieldEventRowWithTimes): FieldSiteValues | null =>
  r.item === "site_conditions" && r.site_third_party && r.site_other_aircraft && r.site_rain && r.site_visibility
    ? {
        thirdParty: r.site_third_party,
        otherAircraft: r.site_other_aircraft,
        rain: r.site_rain,
        visibility: r.site_visibility,
        windMs: r.site_wind_ms === null ? null : Number(r.site_wind_ms),
        tempC: r.site_temp_c === null ? null : Number(r.site_temp_c),
      }
    : null;

export const fieldEventDto = (r: FieldEventRowWithTimes): FieldEventDto => ({
  id: r.id,
  planId: r.plan_id,
  kind: r.kind,
  item: r.item,
  result: r.result,
  source: r.source,
  docKey: r.doc_key,
  site: siteOfRow(r),
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

const windowNotice = (plan: PlanWithJoins, takeoffAt: Date | null, landingAt: Date | null): WindowNoticeDto | null =>
  windowNoticeOf(asDate(plan.planned_start_at).toISOString(), plan.duration_minutes, takeoffAt, landingAt);

// ---- 離陸の未了事項（サーバーが導出する） ----------------------------------------------

type Bundle = Awaited<ReturnType<typeof loadPlanBundle>>;

/**
 * 有効な通報の、離陸との前後を比べる時刻（JST の `YYYY-MM-DDTHH:MM`）。
 * Sprint 14 の再評価後のユーザー決定：通報の前後はサーバーが決める記録の時刻（created_at）で判定する。利用者が入力した
 * 通報日時（reported_at）が前でも、記録の時刻が離陸より後なら事前の通報として数えない。両方のうち遅い方を返す。
 */
const effectiveReportedAt = (b: Bundle): string | null => {
  const id = b.dto.report.status.effectiveId;
  const r = id ? b.extras.rows.find((x) => x.id === id) : undefined;
  if (!r) return null;
  const recorded = toJstInput(asDate(r.created_at));
  return r.reported_at_jst === null ? recorded : r.reported_at_jst > recorded ? r.reported_at_jst : recorded;
};

const gapInputOf = (b: Bundle): FieldGapInput => ({
  requirementKind: b.dto.report.kind,
  reportStatusCode: b.dto.report.status.code,
  effectiveReportedAt: effectiveReportedAt(b),
  planState: b.dto.state,
  judgementStale: b.dto.freshness.stale,
});

/**
 * 書類・手続きの判定の入力（人の確認と判定時刻を除く）を作る。同じ組織の計画・機体・操縦者・許可の照合・通報だけを読む（組織をまたがない）。
 * 技能証明書の番号は入れない（氏名・有効期限・限定の有無まで）。
 */
const loadDocsBase = async (q: store.OpsDb | store.OpsTx, orgId: string, b: Bundle): Promise<FieldBundleDocsInput> => {
  const plan = b.plan;
  const aircraft = await store.getAircraft(q as store.OpsDb, orgId, plan.aircraft_id);
  const pilot = await store.getPilot(q as store.OpsDb, orgId, plan.pilot_id);
  const eff = b.dto.report.status.effectiveId ? b.extras.rows.find((r) => r.id === b.dto.report.status.effectiveId) : undefined;
  return {
    plannedStartAtJst: toJstInput(asDate(plan.planned_start_at)),
    plannedEndAtJst: toJstInput(new Date(asDate(plan.planned_start_at).getTime() + plan.duration_minutes * MINUTE_MS)),
    wantedKinds: relevantDipsKinds(planPermitInputOfRow(plan).flags),
    permits: b.dto.permits.numbers.map((n) => ({
      numberText: n.numberText,
      kinds: n.kinds.map((k) => k.kind),
      status: n.status,
      registrationId: n.registrationId,
      permitNumber: n.permitNumber,
      versionNo: n.versionNo,
      validFrom: n.validFrom,
      validTo: n.validTo,
      reasonLabels: n.reasons.map((x) => x.label),
    })),
    aircraft: aircraft
      ? { id: aircraft.id, registrationMark: aircraft.registration_mark, status: aircraft.status, voided: aircraft.voided_at !== null }
      : null,
    pilot: pilot
      ? {
          id: pilot.id,
          fullName: pilot.full_name,
          hasLicense: pilot.has_license,
          licenseExpiresOn: dateOnly(pilot.license_expires_on),
          voided: pilot.voided_at !== null,
          hasLimitation: pilot.limitation_type || pilot.limitation_weight || pilot.limitation_daytime || pilot.limitation_vlos,
        }
      : null,
    report: {
      requirementKind: b.dto.report.kind,
      statusCode: b.dto.report.status.code,
      effective: eff
        ? {
            id: eff.id,
            dipsNumber: eff.dips_number,
            numberUnavailable: eff.number_unavailable,
            reportedAtJst: eff.reported_at_jst,
            recordedAtJst: toJstInput(asDate(eff.created_at)),
          }
        : null,
    },
  };
};

const loadDocsInput = async (q: store.OpsDb | store.OpsTx, orgId: string, b: Bundle, state: FieldState, atJst: string): Promise<DocsJudgeInput> =>
  docsInputOf(await loadDocsBase(q, orgId, b), state, atJst);

const gapsFor = (b: Bundle, state: FieldState, takeoffAtJst: string, docs: readonly DocJudgement[]): FieldGap[] =>
  gapsFromInput(gapInputOf(b), state, takeoffAtJst, docs);

// ---- 先読みの束・現場モードの状態 -------------------------------------------------------

/** 束を作る（許可リストで絞る前）。loaded は今日の日付で読んだ現場の行・点検・飛行記録。 */
const buildBundle = async (ctx: OpsContext, b: Bundle, loaded: Awaited<ReturnType<typeof loadFieldState>>, now: Date): Promise<FieldBundlePlan> => {
  const { plan, dto } = b;
  const start = asDate(plan.planned_start_at);
  const end = new Date(start.getTime() + plan.duration_minutes * MINUTE_MS);
  const snap = await store.getSnapshot(ctx.db, ctx.member.org_id, plan.id, plan.current_snapshot_id);
  const flags = ((snap?.result as { flags?: readonly string[] } | undefined)?.flags ?? []) as readonly string[];
  const insp = [...loaded.inspections].sort((x, y) => (x.inspectedAt < y.inspectedAt ? -1 : x.inspectedAt > y.inspectedAt ? 1 : 0));
  const last = insp[insp.length - 1];
  return {
    v: FIELD_BUNDLE_VERSION,
    memberId: ctx.member.id,
    planId: plan.id,
    fetchedAt: now.toISOString(),
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
      permitNumbers: plan.permit_numbers,
      permitStates: dto.permits.numbers.map((n) => ({ numberText: n.numberText, status: n.status, statusLabel: n.statusLabel })),
      voided: plan.voided_at !== null,
      state: dto.state,
      stateLabel: dto.stateLabel,
      verdictLevel: dto.judgement.verdictLevel,
      verdictLabel: (VERDICT_LABEL as Record<string, string>)[dto.judgement.verdictLevel] ?? dto.judgement.verdictLevel,
      judgementStale: dto.freshness.stale,
      isSelf: dto.isSelf,
      startIso: start.toISOString(),
    },
    perms: {
      canRecord: can(ctx.member.role, "field.record", { isSelf: dto.isSelf }),
      canJournal: can(ctx.member.role, "flight.create", { isSelf: dto.isSelf }),
      canInspect: can(ctx.member.role, "inspection.create", { isSelf: dto.isSelf }),
    },
    report: reportBlock(plan, dto, b.extras),
    docs: await loadDocsBase(ctx.db, ctx.member.org_id, b),
    gap: gapInputOf(b),
    state: { events: loaded.events, inspections: loaded.inspections, flightRecords: loaded.flightRecords, planVersion: plan.current_version },
    form: {
      aircraftId: plan.aircraft_id,
      pilotId: plan.pilot_id,
      specificFlightTypes: specificFlightTypesFromFlags(flags),
      lastInspection: last ? { inspectedAt: last.inspectedAt, timing: last.timing, hasAbnormal: last.hasAbnormal } : null,
    },
  };
};

export const getFieldView = async (ctx: OpsContext, planId: string): Promise<FieldViewDto> => {
  assertCan(ctx, "field.read");
  const b = await loadPlanBundle(ctx, planId);
  const { plan } = b;
  const now = nowOf(ctx);
  const today = jstDate(now);
  const org = ctx.member.org_id;
  const loaded = await loadFieldState(ctx.db, org, plan, today);
  const bundle = await buildBundle(ctx, b, loaded, now);
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
  // 画面と先読みの束が同じ組み立てを通る（契約 B-5）。束に入れない自由記述（目的・現場状況の備考）と同じ日の計画だけを足す
  return composeFieldView(bundle, {
    now,
    purpose: plan.purpose,
    siteNote: (eventId) => loaded.rows.find((r) => r.id === eventId)?.note ?? null,
    sameDayPlans: sameDay.length > 1 ? sameDay : [],
  });
};

/** 一覧の束の対象：今日と明日（JST）の、中止されていない、利用者が操縦者の計画（その利用者が現場で扱うもの）。 */
export const FIELD_BUNDLE_DAYS = 2;

/**
 * 先読みの束（Sprint 15 設計 3）。planId を渡すとその計画の束（運航管理者、または計画の操縦者本人だけ。他は 403、他の組織は 404）。
 * 渡さなければ、今日と明日の、利用者が操縦者の計画の束。どちらも許可リスト（sanitizeFieldBundle）で絞ってから返す。
 */
export const getFieldBundles = async (ctx: OpsContext, planId: string | null): Promise<{ readonly memberId: string; readonly serverNow: string; readonly bundles: FieldBundlePlan[] }> => {
  assertCan(ctx, "field.read");
  const now = nowOf(ctx);
  const today = jstDate(now);
  const org = ctx.member.org_id;
  const one = async (id: string): Promise<FieldBundlePlan | null> => {
    const b = await loadPlanBundle(ctx, id);
    const loaded = await loadFieldState(ctx.db, org, b.plan, today);
    return sanitizeFieldBundle(await buildBundle(ctx, b, loaded, now));
  };
  if (planId !== null) {
    const b = await loadPlanBundle(ctx, planId);
    // 他の人の計画は端末に入れない（記録できる人＝運航管理者・計画の操縦者本人だけ）
    if (!can(ctx.member.role, "field.record", { isSelf: b.dto.isSelf })) throw new OpsError(403, "forbidden");
    const x = await one(planId);
    return { memberId: ctx.member.id, serverNow: now.toISOString(), bundles: x ? [x] : [] };
  }
  const tomorrow = jstDate(new Date(now.getTime() + 24 * 3600_000));
  const rows = (await store.listPlans(ctx.db, org, { from: today, to: tomorrow, oldestFirst: true })).filter((p) => p.voided_at === null);
  const out: FieldBundlePlan[] = [];
  for (const p of rows) {
    const b = await loadPlanBundle(ctx, p.id);
    if (!b.dto.isSelf) continue;
    const x = await one(p.id);
    if (x) out.push(x);
  }
  return { memberId: ctx.member.id, serverNow: now.toISOString(), bundles: out };
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
    if ((existing.doc_key ?? null) !== d.docKey) return false;
    const es = siteOfRow(existing);
    if ((es === null) !== (d.site === null)) return false;
    if (es && d.site && JSON.stringify(es) !== JSON.stringify(d.site)) return false;
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
      // 書類・手続きは離陸の時点の登録内容で判定した結果を写す（あとで登録を変えても、離陸の gaps は書き換えない）
      const docsAtTakeoff = judgeFieldDocs(await loadDocsInput(c, org, b, forDay.state, d.occurredAt));
      gaps = gapsFor(b, forDay.state, d.occurredAt, docsAtTakeoff);
      notice = windowNotice(b.plan, d.occurredAtDate, null);
    } else if (d.kind === "landing") {
      const open = loaded.state.openFlight;
      notice = windowNotice(b.plan, open ? new Date(open.takeoffAt) : null, d.occurredAtDate);
    } else if (d.kind === "check" && d.item === "report_recheck") {
      reportId = b.dto.report.status.effectiveId;
    } else if (d.kind === "check" && d.item === "docs_confirm") {
      // 満たさない項目は人の確認で変えない（登録を直す）。要確認の項目だけ確認できる
      const open = loaded.state.openFlight;
      const docs = judgeFieldDocs(await loadDocsInput(c, org, b, loaded.state, open ? toJstInput(new Date(open.takeoffAt)) : toJstInput(now)));
      const hit = docs.find((x) => x.key === d.docKey);
      // 満たさない項目は登録を直す。自動で確認済みの項目・通報は、人の確認の対象にしない（要確認の項目だけ）
      if (hit && hit.status === "unmet") throw new OpsError(409, "doc_unmet");
      if (!hit || hit.status !== "needs_check" || hit.key === "report") throw new OpsError(409, "doc_not_confirmable");
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
        docKey: d.kind === "check" ? d.docKey : null,
        site: d.kind === "check" ? d.site : null,
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
