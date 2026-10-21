// 飛行計画のサービス層（Sprint 12a 設計 A〜E）。画面と API の両方がここを通る。
// 認可は authz.ts の can()、DB の読み書きは store.ts（org_id 必須）だけで行う。版の仕組みは Sprint 10 と同じ。
//
// 計画の保存（作成・判定に関わる項目の訂正・再判定）では、サーバーが判定を実行して保存する（リクエストの値は読まない）。
// 地点判定の証跡（evidence_log）→ 判定スナップショット → 計画の版（record_versions）を 1 つのトランザクションで書く。
import { randomUUID } from "node:crypto";
import type { PilotRow, PlanConfirmationRow, SnapshotReasonDb } from "@soraban/db";
import {
  PROCEDURES_REVISION,
  PROCEDURES_VERIFIED_AT,
  reportRequirement,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  type ReportRequirement,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { diffFingerprintParts, type FingerprintChange } from "@soraban/dips";
import { formatJst, jstDate, parseJstMinute, toJstInput } from "@/lib/ops-time";
import type { DiagnosisRun } from "@/server/diagnose-core";
import { toEvidenceLogInsert } from "@/server/evidence-log";
import { can } from "./authz";
import { runJudge } from "./judge";
import {
  currentFingerprintPartsOf,
  emptyExtras,
  loadReportExtras,
  summarizePlanReport,
  summarizeProcedureRecords,
  type PlanReportDto,
  type PlanReportExtras,
  type ProcedureRecordSummaryDto,
} from "./report-dto";
import type { NextAction } from "./report-logic";
import {
  buildJudgementInput,
  confirmationState,
  currentFreshnessContext,
  FRESHNESS_REASON_LABEL,
  PLAN_STATES,
  planJudgementChanged,
  snapshotFreshness,
  staleSources,
  type FreshnessReason,
  type JudgementInput,
  type PlanJudgementFields,
  type PlanState,
  type StaleSource,
} from "./plan-logic";
import {
  asDate,
  existingRequest,
  fieldError,
  invalid,
  loadAircraftForRecord,
  loadPilotForRecord,
  myPilot,
  normId,
  nowOf,
  pickFields,
  type SaveResult,
} from "./records";
import * as rec from "./records";
import {
  asInput,
  assertCan,
  iso,
  isUuid,
  listEntityVersions,
  type OpsContext,
  type VersionDto,
} from "./service";
import * as store from "./store";
import { OpsError, type PlanWithJoins, type SnapshotFullRow, type SnapshotListRow } from "./store";
import { PLAN_FIELDS, validatePlan, type PlanInputData } from "./validate-plan";
import { parseClientRequestId } from "./validate-records";
import { validateChangeMeta } from "./validate";

type Input = Readonly<Record<string, unknown>>;

// ---- DTO -----------------------------------------------------

export type SnapshotSummaryDto = {
  readonly id: string;
  readonly seq: number;
  readonly reason: SnapshotReasonDb;
  /** 4 段の結論（no_fly／needs_procedure／procedure_done／no_procedure）。 */
  readonly verdictLevel: string;
  readonly verdictUnknownCount: number;
  readonly category: string;
  readonly engineVersion: string;
  readonly checkedAt: string;
  /** 地点判定の証跡 ID。 */
  readonly checkEvidenceId: string;
  /** 申請支援の証跡 ID。 */
  readonly diagnosisEvidenceId: string;
  readonly datasets: readonly { readonly id: string; readonly name: string; readonly baseYear: number | null; readonly verifiedAt: string }[];
  readonly proceduresRevision: number;
  readonly proceduresVerifiedAt: string;
  readonly createdAt: string;
};

export type FreshnessDto = {
  readonly stale: boolean;
  readonly reasons: readonly { readonly code: FreshnessReason; readonly label: string }[];
};

export type ConfirmationDto = {
  readonly id: string;
  readonly planVersion: number;
  readonly snapshotId: string;
  readonly decision: "approved" | "returned";
  readonly reason: string | null;
  readonly confirmerMemberId: string;
  /** 確認した時点の表示名の写し。 */
  readonly confirmerName: string;
  /** 確認者が、その版を保存した利用者である、または計画の操縦者に結び付いた利用者である（DB が決める）。 */
  readonly selfConfirmation: boolean;
  readonly createdAt: string;
  readonly createdAtJst: string;
  readonly contentHash: string;
};

export type PlanDto = {
  readonly id: string;
  readonly title: string;
  readonly aircraftId: string;
  readonly registrationMark: string;
  readonly modelName: string;
  readonly pilotId: string;
  /** 操縦者の氏名（ID だけを保存し、表示のたびに引く）。 */
  readonly pilotName: string;
  /** 計画の操縦者が、要求した利用者に結び付いた操縦者か。 */
  readonly isSelf: boolean;
  /** 日本時間の `YYYY-MM-DDTHH:MM`（入力の形）。 */
  readonly plannedStartAt: string;
  /** 表示用 `YYYY-MM-DD HH:MM`。 */
  readonly plannedStartAtJst: string;
  readonly durationMinutes: number;
  readonly plannedDate: string;
  readonly purpose: string;
  readonly placeName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusM: number | null;
  readonly savedPlaceId: string | null;
  readonly maxAltitudeM: number | null;
  readonly flags: readonly string[];
  readonly pilotPermits: readonly string[];
  readonly judgementPurpose: string | null;
  readonly accessControl: boolean | null;
  readonly thirdPartyOverflight: boolean | null;
  readonly bvlosWithObserver: boolean | null;
  /** 判定した時点の機体重量（g）の写し。 */
  readonly droneWeightG: number | null;
  readonly permitNumbers: string | null;
  readonly notes: string | null;
  /** 保存する状態（draft／active）。取消は voided。 */
  readonly status: "draft" | "active";
  readonly currentSnapshotId: string;
  readonly version: number;
  readonly voided: boolean;
  readonly voidedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  /** 確認の状態（確認の記録と版から求めた導出）。 */
  readonly state: PlanState;
  readonly stateLabel: string;
  readonly selfConfirmation: boolean;
  readonly latestConfirmation: ConfirmationDto | null;
  /** 現在の判定スナップショットの要約。 */
  readonly judgement: SnapshotSummaryDto;
  /** 判定が古いか（機体の重量の変更・エンジンの版・データの確認日・手続きデータの版）。 */
  readonly freshness: FreshnessDto;
  /**
   * 通報の要否（ReportRequirement）に、導出の状況（status）と期限（deadline）を足したもの（Sprint 12b）。
   * 記録（reported_manual・submitted_api）が無いうちは「通報済み」にならない。保存した状態は読まず、毎回導出する。
   */
  readonly report: PlanReportDto;
  /** 計画ごとの「次にやること」の先頭の 1 件（無ければ null）と件数（一覧用。Sprint 12b）。 */
  readonly nextAction: NextAction | null;
  readonly nextActionCount: number;
  /** 出典・確認日が古い項目（90 日超）。確認の画面に出す。 */
  readonly staleSources: readonly StaleSource[];
};

export type PlanDetailDto = PlanDto & {
  readonly confirmations: readonly ConfirmationDto[];
  /** この計画に結びついた飛行記録。 */
  readonly flights: readonly rec.FlightDto[];
  /** 「次にやること」の全件（tier、飛行開始までの時間の順。Sprint 12b）。 */
  readonly nextActions: readonly NextAction[];
  /** 有効な通報があり、通報時から計画が変わっているとき、変わった項目（変更点の表示）。 */
  readonly reportChanges: readonly FingerprintChange[];
  /** 手続きの「済み」の記録の要約（許可・承認の申請、飛行禁止法の同意・通報。Sprint 12b）。 */
  readonly procedureRecords: readonly ProcedureRecordSummaryDto[];
};

export type SnapshotListDto = SnapshotSummaryDto & {
  readonly input: Record<string, unknown>;
  readonly createdByName: string | null;
  readonly prevHash: string;
  readonly contentHash: string;
  readonly isCurrent: boolean;
};

export type SnapshotDetailDto = SnapshotListDto & {
  /** 保存した判定の結果（/api/diagnose の応答と同じ形）。再計算はしない。 */
  readonly result: Record<string, unknown>;
  readonly report: ReportRequirement;
  readonly staleSources: readonly StaleSource[];
};

const confirmationDto = (r: PlanConfirmationRow): ConfirmationDto => {
  const at = asDate(r.created_at);
  return {
    id: r.id,
    planVersion: r.plan_version,
    snapshotId: r.snapshot_id,
    decision: r.decision,
    reason: r.reason,
    confirmerMemberId: r.confirmer_member_id,
    confirmerName: r.confirmer_name,
    selfConfirmation: r.self_confirmation,
    createdAt: at.toISOString(),
    createdAtJst: formatJst(at),
    contentHash: r.content_hash,
  };
};

const planFields = (r: PlanWithJoins): PlanJudgementFields => ({
  latitude: Number(r.latitude),
  longitude: Number(r.longitude),
  plannedDate: r.planned_date_text,
  maxAltitudeM: r.max_altitude_m,
  flags: r.flags,
  pilotPermits: r.pilot_permits,
  judgementPurpose: r.judgement_purpose,
  accessControl: r.access_control,
  thirdPartyOverflight: r.third_party_overflight,
  bvlosWithObserver: r.bvlos_with_observer,
});

const aircraftWeight = (r: PlanWithJoins) => ({
  maxTakeoffWeightKg: r.aircraft_max_takeoff_weight_kg === null ? null : Number(r.aircraft_max_takeoff_weight_kg),
});

const snapshotSummary = (r: PlanWithJoins): SnapshotSummaryDto => ({
  id: r.current_snapshot_id,
  seq: r.snapshot_seq,
  reason: r.snapshot_reason,
  verdictLevel: r.verdict_level,
  verdictUnknownCount: r.verdict_unknown_count,
  category: r.category,
  engineVersion: r.engine_version,
  checkedAt: asDate(r.snapshot_checked_at).toISOString(),
  checkEvidenceId: r.check_evidence_id,
  diagnosisEvidenceId: r.diagnosis_evidence_id,
  datasets: r.snapshot_datasets,
  proceduresRevision: r.procedures_revision,
  proceduresVerifiedAt: r.procedures_verified_at,
  createdAt: asDate(r.snapshot_created_at).toISOString(),
});

const planDto = (
  ctx: OpsContext,
  r: PlanWithJoins,
  confirmations: readonly PlanConfirmationRow[],
  mine: PilotRow | null,
  extras: PlanReportExtras = emptyExtras(),
): PlanDto => {
  const start = asDate(r.planned_start_at);
  const confirmationDtos = confirmations.map(confirmationDto);
  const state = confirmationState(
    { status: r.status, voided: r.voided_at !== null, version: r.current_version },
    confirmationDtos,
  );
  const latest = state.latest === null ? null : (confirmationDtos.find((c) => c.id === (state.latest as { id?: string }).id) ?? null);
  const freshness = snapshotFreshness({
    snapshot: {
      input: r.snapshot_input,
      engineVersion: r.engine_version,
      datasets: r.snapshot_datasets,
      proceduresRevision: r.procedures_revision,
      proceduresVerifiedAt: r.procedures_verified_at,
    },
    plan: planFields(r),
    aircraft: aircraftWeight(r),
    now: ctx.freshnessNow ?? currentFreshnessContext(),
  });
  const input = r.snapshot_input as { droneWeightG?: number | null; purpose?: string | null };
  const requirement = reportRequirement({
    input: { droneWeightG: input.droneWeightG ?? null, purpose: input.purpose ?? null },
    result: r.snapshot_result_slim,
  });
  const summary = summarizePlanReport({
    ctx,
    plan: r,
    isSelf: mine !== null && mine.id === r.pilot_id,
    planState: state.state,
    judgementStale: freshness.stale,
    requirement,
    extras,
    now: nowOf(ctx),
  });
  return {
    id: r.id,
    title: r.title,
    aircraftId: r.aircraft_id,
    registrationMark: r.registration_mark,
    modelName: r.model_name,
    pilotId: r.pilot_id,
    pilotName: r.pilot_name,
    isSelf: mine !== null && mine.id === r.pilot_id,
    plannedStartAt: toJstInput(start),
    plannedStartAtJst: formatJst(start),
    durationMinutes: r.duration_minutes,
    plannedDate: r.planned_date_text,
    purpose: r.purpose,
    placeName: r.place_name,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    radiusM: r.radius_m,
    savedPlaceId: r.saved_place_id,
    maxAltitudeM: r.max_altitude_m,
    flags: r.flags,
    pilotPermits: r.pilot_permits,
    judgementPurpose: r.judgement_purpose,
    accessControl: r.access_control,
    thirdPartyOverflight: r.third_party_overflight,
    bvlosWithObserver: r.bvlos_with_observer,
    droneWeightG: r.drone_weight_g,
    permitNumbers: r.permit_numbers,
    notes: r.notes,
    status: r.status,
    currentSnapshotId: r.current_snapshot_id,
    version: r.current_version,
    voided: r.voided_at !== null,
    voidedAt: iso(r.voided_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    state: state.state,
    stateLabel: state.label,
    selfConfirmation: state.selfConfirmation,
    latestConfirmation: latest,
    judgement: snapshotSummary(r),
    freshness: {
      stale: freshness.stale,
      reasons: freshness.reasons.map((code) => ({ code, label: FRESHNESS_REASON_LABEL[code] })),
    },
    report: summary.report,
    nextAction: summary.nextActions[0] ?? null,
    nextActionCount: summary.nextActions.length,
    staleSources: staleSources(
      {
        datasets: r.snapshot_datasets,
        proceduresVerifiedAt: r.procedures_verified_at,
      },
      nowOf(ctx),
    ),
  };
};

/** 詳細の追加分：次にやることの全件・通報時からの変更点・手続きの記録。 */
const detailExtras = (ctx: OpsContext, r: PlanWithJoins, dto: PlanDto, mine: PilotRow | null, extras: PlanReportExtras) => {
  const summary = summarizePlanReport({
    ctx,
    plan: r,
    isSelf: mine !== null && mine.id === r.pilot_id,
    planState: dto.state,
    judgementStale: dto.freshness.stale,
    requirement: dto.report,
    extras,
    now: nowOf(ctx),
  });
  const effective = dto.report.status.effectiveId ? extras.rows.find((x) => x.id === dto.report.status.effectiveId) : undefined;
  const flagLabel = (f: string) => SPECIFIC_FLIGHT_FLAG_LABEL[f as SpecificFlightFlag] ?? f;
  return {
    nextActions: summary.nextActions,
    reportChanges: effective
      ? diffFingerprintParts(effective.fingerprint_parts as never, currentFingerprintPartsOf(r), { flagLabel })
      : [],
    procedureRecords: summarizeProcedureRecords(extras.records, r),
  };
};

// ---- 読み出し ------------------------------------------------

export type PlanListFilter = {
  readonly aircraftId?: string;
  readonly pilotId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly includeVoided?: boolean;
  /** 中止した計画だけ（一覧の「中止」の表示用。上限の前に絞る）。 */
  readonly voidedOnly?: boolean;
  /** 予定開始の古い順に返す（既定は新しい順。「これから」の表示用）。 */
  readonly oldestFirst?: boolean;
  /** 導出の状態での絞り込み（例：確認待ち pending）。 */
  readonly state?: PlanState;
};

/** 一覧の絞り込み（クエリ）を読む。from・to・aircraftId・pilotId・includeVoided は飛行記録と同じ。status は導出の状態。 */
export const parsePlanFilter = (q: URLSearchParams): PlanListFilter => {
  const base = rec.parseRecordFilter(q);
  const status = q.get("status");
  if (status && !(PLAN_STATES as readonly string[]).includes(status)) {
    fieldError("status", "unknown_value", `状態は ${PLAN_STATES.join("・")} のいずれかです`);
  }
  return { ...base, ...(status ? { state: status as PlanState } : {}) };
};

const withConfirmations = async (ctx: OpsContext, rows: readonly PlanWithJoins[]) => {
  const all = await store.listConfirmationsFor(ctx.db, ctx.member.org_id, rows.map((r) => r.id));
  const by = new Map<string, PlanConfirmationRow[]>();
  for (const c of all) by.set(c.plan_id, [...(by.get(c.plan_id) ?? []), c]);
  return by;
};

export const listPlans = async (ctx: OpsContext, filter: PlanListFilter = {}): Promise<PlanDto[]> => {
  assertCan(ctx, "plan.read");
  const mine = await myPilot(ctx);
  const rows = await store.listPlans(ctx.db, ctx.member.org_id, filter);
  const by = await withConfirmations(ctx, rows);
  const extras = await loadReportExtras(ctx, rows.map((r) => r.id));
  const dtos = rows.map((r) => planDto(ctx, r, by.get(r.id) ?? [], mine, extras.get(r.id)));
  return filter.state ? dtos.filter((d) => d.state === filter.state) : dtos;
};

export const loadPlan = async (ctx: OpsContext, id: string): Promise<PlanWithJoins> => {
  const r = isUuid(id) ? await store.getPlan(ctx.db, ctx.member.org_id, id) : null;
  if (!r) throw new OpsError(404, "not_found");
  return r;
};

const planDtoOf = async (ctx: OpsContext, r: PlanWithJoins, mine: PilotRow | null): Promise<PlanDto> =>
  planDto(
    ctx,
    r,
    (await withConfirmations(ctx, [r])).get(r.id) ?? [],
    mine,
    (await loadReportExtras(ctx, [r.id])).get(r.id),
  );

/** 通報の API が使う、計画の行・要求した利用者の操縦者・計画の DTO・通報の導出に必要な値の組。 */
export const loadPlanBundle = async (
  ctx: OpsContext,
  id: string,
): Promise<{ plan: PlanWithJoins; mine: PilotRow | null; dto: PlanDto; extras: PlanReportExtras }> => {
  const plan = await loadPlan(ctx, id);
  const mine = await myPilot(ctx);
  const confirmations = await store.listConfirmationsFor(ctx.db, ctx.member.org_id, [plan.id]);
  const extras = (await loadReportExtras(ctx, [plan.id])).get(plan.id) ?? emptyExtras();
  return { plan, mine, dto: planDto(ctx, plan, confirmations, mine, extras), extras };
};

export const getPlan = async (ctx: OpsContext, id: string): Promise<PlanDetailDto> => {
  assertCan(ctx, "plan.read");
  const r = await loadPlan(ctx, id);
  const mine = await myPilot(ctx);
  const confirmations = await store.listConfirmationsFor(ctx.db, ctx.member.org_id, [r.id]);
  const flights = await rec.listFlightsForPlan(ctx, r.id);
  const extras = (await loadReportExtras(ctx, [r.id])).get(r.id) ?? emptyExtras();
  const dto = planDto(ctx, r, confirmations, mine, extras);
  return { ...dto, confirmations: confirmations.map(confirmationDto), flights, ...detailExtras(ctx, r, dto, mine, extras) };
};

export const listPlanVersions = async (ctx: OpsContext, id: string): Promise<VersionDto[]> => {
  assertCan(ctx, "plan.read");
  await loadPlan(ctx, id);
  return listEntityVersions(ctx, "flight_plan", id);
};

export const listPlanConfirmations = async (ctx: OpsContext, id: string): Promise<ConfirmationDto[]> => {
  assertCan(ctx, "plan.read");
  await loadPlan(ctx, id);
  return (await store.listConfirmationsFor(ctx.db, ctx.member.org_id, [id])).map(confirmationDto);
};

const snapshotListDto = (r: SnapshotListRow, currentId: string): SnapshotListDto => ({
  id: r.id,
  seq: r.seq,
  reason: r.reason,
  verdictLevel: r.verdict_level,
  verdictUnknownCount: r.verdict_unknown_count,
  category: r.category,
  engineVersion: r.engine_version,
  checkedAt: asDate(r.checked_at).toISOString(),
  checkEvidenceId: r.check_evidence_id,
  diagnosisEvidenceId: r.diagnosis_evidence_id,
  datasets: r.datasets,
  proceduresRevision: r.procedures_revision,
  proceduresVerifiedAt: r.procedures_verified_at,
  createdAt: asDate(r.created_at).toISOString(),
  input: r.input,
  createdByName: r.created_by_name,
  prevHash: r.prev_hash,
  contentHash: r.content_hash,
  isCurrent: r.id === currentId,
});

/** スナップショットの一覧（result を除く）。 */
export const listSnapshots = async (ctx: OpsContext, planId: string): Promise<SnapshotListDto[]> => {
  assertCan(ctx, "snapshot.read");
  const plan = await loadPlan(ctx, planId);
  return (await store.listSnapshots(ctx.db, ctx.member.org_id, planId)).map((r) => snapshotListDto(r, plan.current_snapshot_id));
};

/** スナップショット 1 件（result を含む）。他の計画・他の組織のものは 404。 */
export const getSnapshot = async (ctx: OpsContext, planId: string, snapshotId: string): Promise<SnapshotDetailDto> => {
  assertCan(ctx, "snapshot.read");
  const plan = await loadPlan(ctx, planId);
  const r: SnapshotFullRow | null = isUuid(snapshotId)
    ? await store.getSnapshot(ctx.db, ctx.member.org_id, planId, snapshotId)
    : null;
  if (!r) throw new OpsError(404, "not_found");
  const input = r.input as { droneWeightG?: number | null; purpose?: string | null };
  return {
    ...snapshotListDto(r, plan.current_snapshot_id),
    result: r.result,
    report: reportRequirement({
      input: { droneWeightG: input.droneWeightG ?? null, purpose: input.purpose ?? null },
      result: r.result as never,
    }),
    staleSources: staleSources({ datasets: r.datasets, proceduresVerifiedAt: r.procedures_verified_at }, nowOf(ctx)),
  };
};

// ---- 書き込みの共通部分 ----------------------------------------

/** 利用者の操作でないシステムの値は無い。計画の操作は常に利用者が行う。 */
const mustMayCreate = async (ctx: OpsContext): Promise<PilotRow | null> => {
  const mine = await myPilot(ctx);
  if (!can(ctx.member.role, "plan.create", { isSelf: true }) || (ctx.member.role !== "manager" && !mine)) {
    throw new OpsError(403, "forbidden");
  }
  return mine;
};

/** 版の data（snake_case）を API の入力の形（camelCase）にする（訂正の合成用）。 */
const planInputFromData = (d: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [api, col] of Object.entries(PLAN_FIELDS)) out[api] = d[col];
  return out;
};

/** 検査済みの計画の項目から、判定に関わる項目（判定の入力の元）を作る。 */
const judgementFieldsOf = (d: PlanInputData): PlanJudgementFields => {
  const start = parseJstMinute(d.planned_start_at);
  return {
    latitude: d.latitude,
    longitude: d.longitude,
    plannedDate: start ? jstDate(start) : "",
    maxAltitudeM: d.max_altitude_m,
    flags: d.flags,
    pilotPermits: d.pilot_permits,
    judgementPurpose: d.judgement_purpose,
    accessControl: d.access_control,
    thirdPartyOverflight: d.third_party_overflight,
    bvlosWithObserver: d.bvlos_with_observer,
  };
};

/** よく使う地点を選んだときの確認（他の組織は 404、取消済みは 400）。 */
const checkSavedPlace = async (ctx: OpsContext, savedPlaceId: string | null): Promise<void> => {
  if (savedPlaceId === null) return;
  const p = await store.getSavedPlace(ctx.db, ctx.member.org_id, savedPlaceId);
  if (!p) throw new OpsError(404, "not_found");
  if (p.voided_at !== null) fieldError("savedPlaceId", "place_voided", "取消された地点は選べません");
};

type JudgedWrite = {
  readonly planId: string;
  readonly snapshotId: string;
  readonly reason: SnapshotReasonDb;
  readonly input: JudgementInput;
  readonly run: DiagnosisRun;
  readonly version: Omit<store.AppendVersion, "orgId" | "entityType" | "entityId" | "actorMemberId">;
};

/**
 * 地点判定の証跡 → 判定スナップショット → 計画の版を、1 つのトランザクションで書く（設計 A5）。
 * どれかが失敗したら全部取り消す（計画の版の追加が失敗してもスナップショットが残らない）。
 */
const writeJudged = async (ctx: OpsContext, w: JudgedWrite): Promise<number> => {
  const res = w.run.response;
  return store.withTransaction(ctx.db, async (c) => {
    await store.insertEvidenceOn(c, toEvidenceLogInsert(w.run.check, { lat: w.input.lat, lng: w.input.lng }));
    await store.insertSnapshotOn(c, {
      id: w.snapshotId,
      orgId: ctx.member.org_id,
      planId: w.planId,
      reason: w.reason,
      input: w.input,
      result: res,
      verdictLevel: res.verdict?.level ?? "needs_procedure",
      verdictUnknownCount: res.verdict?.unknownCount ?? 0,
      category: res.category,
      engineVersion: res.engineVersion,
      checkedAt: res.checkedAt,
      checkEvidenceId: res.checkEvidenceId ?? w.run.check.evidenceId,
      diagnosisEvidenceId: res.evidenceId,
      datasets: res.datasets ?? [],
      proceduresRevision: PROCEDURES_REVISION,
      proceduresVerifiedAt: PROCEDURES_VERIFIED_AT,
      createdByMemberId: ctx.member.id,
    });
    return store.appendVersionOn(c, {
      ...w.version,
      orgId: ctx.member.org_id,
      entityType: "flight_plan",
      entityId: w.planId,
      actorMemberId: ctx.member.id,
    });
  });
};

const latestData = async (ctx: OpsContext, id: string): Promise<Record<string, unknown>> =>
  (await store.latestVersionData(ctx.db, ctx.member.org_id, "flight_plan", id)) ?? {};

/** 計画の判定を実行する（上限つき。失敗は 503）。 */
const judgePlan = (ctx: OpsContext, input: JudgementInput): Promise<DiagnosisRun> =>
  runJudge(ctx.judge, input, () => nowOf(ctx), ctx.judgeTimeoutMs);

// ---- 作成 ----------------------------------------------------

export const createPlan = async (ctx: OpsContext, body: unknown): Promise<SaveResult<PlanDto>> => {
  const mine = await mustMayCreate(ctx);
  const input = asInput(body);
  const req = parseClientRequestId(input["clientRequestId"]);
  const v = validatePlan(input);
  if (!req.ok || !v.ok) {
    return invalid(v, req.ok ? undefined : { errors: { clientRequestId: "送信の識別子が正しくありません" }, codes: { clientRequestId: "invalid" } });
  }
  // 二重送信：同じ組織で同じ識別子の作成が既にあれば、新しい計画を作らずに既存の計画を返す
  if (req.value) {
    const existingId = await existingRequest(ctx, "flight_plan", req.value);
    if (existingId) return { created: false, record: await planDtoOf(ctx, await loadPlan(ctx, existingId), mine), warnings: [] };
  }
  const isSelf = mine !== null && mine.id === v.data.pilot_id;
  if (!can(ctx.member.role, "plan.create", { isSelf })) throw new OpsError(403, "forbidden");
  const aircraft = await loadAircraftForRecord(ctx, v.data.aircraft_id, true);
  await loadPilotForRecord(ctx, v.data.pilot_id, "pilotId", false);
  await checkSavedPlace(ctx, v.data.saved_place_id);

  // 保存時にサーバーが判定を実行する（リクエストの判定の値は読まない）。失敗・時間切れは 503 で何も保存しない
  const planId = randomUUID();
  const judgement = buildJudgementInput(judgementFieldsOf(v.data), {
    maxTakeoffWeightKg: aircraft.max_takeoff_weight_kg === null ? null : Number(aircraft.max_takeoff_weight_kg),
  });
  const run = await judgePlan(ctx, judgement);
  const snapshotId = randomUUID();
  try {
    await writeJudged(ctx, {
      planId,
      snapshotId,
      reason: "initial",
      input: judgement,
      run,
      version: {
        op: "create",
        data: {
          ...v.data,
          drone_weight_g: judgement.droneWeightG,
          status: "draft",
          current_snapshot_id: snapshotId,
          client_request_id: req.value,
        },
        reason: null,
      },
    });
  } catch (e) {
    if (e instanceof OpsError && e.code === "duplicate_request" && req.value) {
      const existingId = await existingRequest(ctx, "flight_plan", req.value);
      if (existingId) return { created: false, record: await planDtoOf(ctx, await loadPlan(ctx, existingId), mine), warnings: [] };
    }
    throw e;
  }
  return { created: true, record: await planDtoOf(ctx, await loadPlan(ctx, planId), mine), warnings: [] };
};

// ---- 訂正 ----------------------------------------------------

export const updatePlan = async (ctx: OpsContext, id: string, body: unknown): Promise<SaveResult<PlanDto>> => {
  const current = await loadPlan(ctx, id);
  const mine = await myPilot(ctx);
  const isSelf = mine !== null && mine.id === current.pilot_id;
  assertCan(ctx, "plan.update", isSelf);
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  if ("aircraftId" in input && normId(input["aircraftId"]) !== current.aircraft_id) {
    throw new OpsError(
      400,
      "invalid_input",
      { aircraftId: "機体は訂正で変えられません。誤った場合は中止して作り直してください", ...(meta.ok ? {} : meta.errors) },
      { aircraftId: "aircraft_immutable" },
    );
  }
  const base = await latestData(ctx, id);
  const merged = { ...planInputFromData(base), ...pickFields(input, PLAN_FIELDS), aircraftId: current.aircraft_id };
  const v = validatePlan(merged);
  if (!meta.ok || !v.ok) return invalid(v, meta.ok ? undefined : { errors: { ...meta.errors }, codes: {} });
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const pilotChanged = v.data.pilot_id !== current.pilot_id;
  if (pilotChanged && !can(ctx.member.role, "plan.update", { isSelf: mine !== null && mine.id === v.data.pilot_id })) {
    throw new OpsError(403, "forbidden");
  }
  await loadPilotForRecord(ctx, v.data.pilot_id, "pilotId", !pilotChanged);
  if (v.data.saved_place_id !== current.saved_place_id) await checkSavedPlace(ctx, v.data.saved_place_id);

  const nextData = {
    ...v.data,
    drone_weight_g: base["drone_weight_g"] ?? null,
    status: current.status,
    current_snapshot_id: current.current_snapshot_id,
    client_request_id: current.client_request_id,
  };
  if (!planJudgementChanged(base, { ...base, ...v.data })) {
    // 判定に関わらない項目の訂正：スナップショットは増やさない
    await store.appendVersion(ctx.db, {
      orgId: ctx.member.org_id,
      entityType: "flight_plan",
      entityId: id,
      op: "update",
      data: nextData,
      reason: meta.data.reason,
      actorMemberId: ctx.member.id,
      expectedVersion: meta.data.expectedVersion,
    });
  } else {
    // 判定に関わる項目の訂正：同じトランザクションで、新しい版と新しいスナップショットを作る
    const judgement = buildJudgementInput(judgementFieldsOf(v.data), {
      maxTakeoffWeightKg: current.aircraft_max_takeoff_weight_kg === null ? null : Number(current.aircraft_max_takeoff_weight_kg),
    });
    const run = await judgePlan(ctx, judgement);
    const snapshotId = randomUUID();
    await writeJudged(ctx, {
      planId: id,
      snapshotId,
      reason: "input_changed",
      input: judgement,
      run,
      version: {
        op: "update",
        data: { ...nextData, drone_weight_g: judgement.droneWeightG, current_snapshot_id: snapshotId },
        reason: meta.data.reason,
        expectedVersion: meta.data.expectedVersion,
      },
    });
  }
  return { created: false, record: await planDtoOf(ctx, await loadPlan(ctx, id), mine), warnings: [] };
};

// ---- 確認を依頼する・再判定・中止 -------------------------------

/** 本文の expectedVersion（任意）。あれば楽観的排他に使う。 */
const optionalExpectedVersion = (input: Input): number | undefined => {
  const v = input["expectedVersion"];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new OpsError(400, "invalid_input", { expectedVersion: "版番号が正しくありません" }, { expectedVersion: "invalid" });
  }
  return v;
};

/** 確認を依頼する（draft → active）。計画の訂正の版として残す。 */
export const requestConfirmation = async (ctx: OpsContext, id: string, body: unknown): Promise<PlanDto> => {
  const current = await loadPlan(ctx, id);
  const mine = await myPilot(ctx);
  assertCan(ctx, "plan.update", mine !== null && mine.id === current.pilot_id);
  // 版の指定がなければ、読んだ時点の版を使う（読んでから書くまでの間に入った訂正を上書きしない）。
  const expectedVersion = optionalExpectedVersion(asInput(body ?? {})) ?? current.current_version;
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  if (current.status === "active") throw new OpsError(409, "already_requested");
  const base = await latestData(ctx, id);
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "flight_plan",
    entityId: id,
    op: "update",
    data: { ...base, status: "active" },
    reason: "確認を依頼",
    actorMemberId: ctx.member.id,
    expectedVersion,
  });
  return planDtoOf(ctx, await loadPlan(ctx, id), mine);
};

/**
 * 判定をやり直す。新しいスナップショット（根拠のデータ・エンジンの版が変わっていれば data_updated、それ以外は manual）と、
 * current_snapshot_id を替えた計画の版を作る。計画の版が上がるため、確認は「前の版への確認」になる。
 */
export const rejudgePlan = async (ctx: OpsContext, id: string, body: unknown): Promise<PlanDto> => {
  const current = await loadPlan(ctx, id);
  const mine = await myPilot(ctx);
  assertCan(ctx, "plan.update", mine !== null && mine.id === current.pilot_id);
  // 判定の待ち時間（最大 20 秒）の間に入った訂正を上書きしないよう、版の指定がなければ読んだ時点の版を使う。
  const expectedVersion = optionalExpectedVersion(asInput(body ?? {})) ?? current.current_version;
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const before = planDto(ctx, current, [], mine).freshness.reasons.map((r) => r.code);
  const reason: SnapshotReasonDb = before.some((c) => c !== "input_changed") ? "data_updated" : "manual";
  const base = await latestData(ctx, id);
  const judgement = buildJudgementInput(planFields(current), aircraftWeight(current));
  const run = await judgePlan(ctx, judgement);
  const snapshotId = randomUUID();
  await writeJudged(ctx, {
    planId: id,
    snapshotId,
    reason,
    input: judgement,
    run,
    version: {
      op: "update",
      data: { ...base, drone_weight_g: judgement.droneWeightG, current_snapshot_id: snapshotId },
      reason: "判定をやり直し",
      expectedVersion,
    },
  });
  return planDtoOf(ctx, await loadPlan(ctx, id), mine);
};

/** 計画を中止する（取消の版。行は消さない）。 */
export const voidPlan = async (ctx: OpsContext, id: string, body: unknown): Promise<PlanDto> => {
  const current = await loadPlan(ctx, id);
  const mine = await myPilot(ctx);
  assertCan(ctx, "plan.cancel", mine !== null && mine.id === current.pilot_id);
  const meta = validateChangeMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "flight_plan",
    entityId: id,
    op: "void",
    data: await latestData(ctx, id),
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return planDtoOf(ctx, await loadPlan(ctx, id), mine);
};

// ---- 運航管理者の確認 ------------------------------------------

export type ConfirmResult = { readonly confirmation: ConfirmationDto; readonly plan: PlanDto };

/**
 * 運航管理者が確認・差し戻しをする。最新の版に対してだけできる（draft・取消・最新でない版は 409）。
 * 差し戻しは理由が必須。自己確認かどうかは DB が決める。
 */
export const confirmPlan = async (ctx: OpsContext, id: string, body: unknown): Promise<ConfirmResult> => {
  const current = await loadPlan(ctx, id);
  assertCan(ctx, "plan.confirm");
  const input = asInput(body);
  const errors: Record<string, string> = {};
  const codes: Record<string, string> = {};
  const decision = input["decision"];
  if (decision !== "approved" && decision !== "returned") {
    errors["decision"] = "確認か差し戻しかを選んでください";
    codes["decision"] = "invalid";
  }
  const expected = input["expectedVersion"];
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 1) {
    errors["expectedVersion"] = "版番号が必要です";
    codes["expectedVersion"] = "required";
  }
  const rawReason = input["reason"];
  let reason: string | null = null;
  if (rawReason !== undefined && rawReason !== null && typeof rawReason !== "string") {
    errors["reason"] = "理由は文字で入力してください";
    codes["reason"] = "invalid";
  } else if (typeof rawReason === "string" && rawReason.trim() !== "") {
    reason = rawReason.trim();
    if (reason.length > 500) {
      errors["reason"] = "理由は 500 文字以内にしてください";
      codes["reason"] = "too_long";
    }
  }
  if (decision === "returned" && reason === null && !("reason" in errors)) {
    errors["reason"] = "差し戻しの理由を入力してください";
    codes["reason"] = "required";
  }
  if (Object.keys(errors).length > 0) throw new OpsError(400, "invalid_input", errors, codes);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  if (current.status !== "active") throw new OpsError(409, "not_requested");
  if (expected !== current.current_version) throw new OpsError(409, "version_conflict");
  const confirmationId = await store.insertConfirmation(ctx.db, {
    orgId: ctx.member.org_id,
    planId: id,
    planVersion: expected as number,
    snapshotId: current.current_snapshot_id,
    decision: decision as "approved" | "returned",
    reason,
    confirmerMemberId: ctx.member.id,
  });
  const mine = await myPilot(ctx);
  const all = await store.listConfirmationsFor(ctx.db, ctx.member.org_id, [id]);
  const saved = all.find((c) => c.id === confirmationId)!;
  const extras = (await loadReportExtras(ctx, [id])).get(id);
  return { confirmation: confirmationDto(saved), plan: planDto(ctx, await loadPlan(ctx, id), all, mine, extras) };
};

