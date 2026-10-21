// 通報の記録のサービス層（Sprint 12b 設計 B〜G）。画面と API の両方がここを通る。
// そらばんは DIPS に送信しない。手動アダプター（既定）は、利用者が DIPS で通報した結果を記録する（利用者の申告）。
// 模擬アダプターは開発・CI・E2E だけ（本番・プレビューでは設定が拒否する）で、同じプロセスの中の模擬の結果を返す。
//
// 守ること：
//   - 記録（reported_manual・submitted_api）が無いうちは「通報済み」を出さない（状態は毎回導出する）。
//   - サーバーが決めるもの：指紋・冪等性キー・対応表の版・状態・計画の版・スナップショット・送信元。リクエストの同名の値は読まない。
//   - 状態の遷移の許可はアプリの遷移表（@soraban/dips の transitions.ts）が 1 か所で決める。DB は列の整合と組織・計画・版の検査だけ。
//   - 外部（模擬）を呼ぶ間、トランザクションを開けておかない：①prepared の行と監査を書く → ②アダプターを呼ぶ（上限 10 秒）→
//     ③結果の版と監査を書く。③が失敗しても②の結果で再送しない（prepared のまま「結果不明」として扱う）。
//   - 監査（flight_report_attempts）に、秘密・トークン・技能証明書番号・氏名・内容の全文を入れない（内容はハッシュと要約）。
import { randomUUID } from "node:crypto";
import type { PilotRow } from "@soraban/db";
import {
  ADAPTER_MODE_LABEL,
  assertTransition,
  ATTEMPT_OPERATION_LABEL,
  cancelGeneration,
  cancelStateLabel,
  canTransition,
  computeIdempotencyKey,
  contentOf,
  CORRECTABLE_STATES,
  DIPS_CONFIG_ERROR_MESSAGE,
  diffFingerprintParts,
  effectiveReport,
  effectiveState,
  externalStatusLabel,
  fieldByKey,
  FIELD_SOURCES,
  GatewayInputError,
  isPreparedStale,
  latestLiveReport,
  ManualGateway,
  MockGateway,
  REPORT_CHANNEL_LABEL,
  REPORT_ERROR_KIND_LABEL,
  REPORT_FIELDS,
  REPORT_KIND_LABEL,
  reportStateLabel,
  resolveDipsAdapterConfig,
  sha256Hex,
  validateManualResult,
  validateReportInputs,
  WARNING_JUDGEMENT_STALE,
  WARNING_PLAN_DRAFT,
  WARNING_PLAN_NOT_CONFIRMED,
  WARNING_PLAN_VOIDED,
  type FingerprintChange,
  type GatewayCapabilities,
  type ManualResult,
  type MockScenario,
  type NotificationGateway,
  type PlanForReport,
  type PreparedReport,
  type ReportChannel,
  type ReportInputs,
  type ReportKind,
  type ReportState,
  type ReportStatusResult,
  type SubmitResult,
} from "@soraban/dips";
import type { ReportRequirement, SpecificFlightFlag } from "@soraban/regulations";
import { SPECIFIC_FLIGHT_FLAG_LABEL } from "@soraban/regulations";
import { formatJst, toJstInput } from "@/lib/ops-time";
import { can } from "./authz";
import { currentFingerprintPartsOf, rowLite, summarizePlanReport, type PlanReportExtras } from "./report-dto";
import type { DeadlineState } from "./report-logic";
import { reportRegistrationOf } from "./permit-logic";
import type { PermitMatchResult } from "./permit-logic";
import { loadPlan, loadPlanBundle } from "./plans";
import type { PlanState } from "./plan-logic";
import { asDate, nowOf } from "./records";
import { asInput, assertCan, listEntityVersions, type OpsContext } from "./service";
import * as store from "./store";
import { OpsError, type PlanWithJoins, type ReportRowWithTimes } from "./store";
import { maskLicenseNumber } from "./validate";
import {
  mergeCorrection,
  pickCorrectionChanges,
  validateCopyAudit,
  validateCreateReport,
  validateReportMeta,
  validateResolve,
  validateRetry,
} from "./validate-report";

/** 外部（模擬）の呼び出しの上限（ミリ秒）。 */
export const EXTERNAL_CALL_TIMEOUT_MS = 10_000;

const PERMIT_PROCEDURE = /^(flight-permission-|flight-approval-)/;

// ---- DTO -----------------------------------------------------------

export type ReportActionsDto = {
  /** 番号・日時・メモを理由つきで訂正できる。 */
  readonly correct: boolean;
  /** 記録の誤りとして取り下げられる（手動の記録で、取り下げていない最新の行）。 */
  readonly retract: boolean;
  /** 結果不明を確定できる（DIPS の画面で確かめた結果を記録する）。 */
  readonly resolve: boolean;
  /** 失敗の再送（模擬。同じ行・同じ冪等性キー）。 */
  readonly retry: boolean;
};

export type ReportDto = {
  readonly id: string;
  readonly planId: string;
  readonly kind: ReportKind;
  readonly kindLabel: string;
  readonly baseReportId: string | null;
  /** manual／mock／api。 */
  readonly channel: ReportChannel;
  /** 「手動（利用者の申告）」「模擬（開発用）」「API」。 */
  readonly channelLabel: string;
  /** 保存した状態。 */
  readonly status: ReportState;
  /** prepared のまま 5 分を超えたものは unknown（結果不明）として扱う。 */
  readonly effectiveState: ReportState;
  readonly stale: boolean;
  readonly statusLabel: string;
  readonly version: number;
  readonly planVersion: number;
  readonly snapshotId: string;
  readonly snapshotSeq: number;
  /** 地点判定・申請支援の証跡 ID（スナップショットから）。 */
  readonly checkEvidenceId: string;
  readonly diagnosisEvidenceId: string;
  readonly fingerprint: string;
  readonly fingerprintParts: Record<string, unknown>;
  readonly mapRevision: number;
  readonly idempotencyKey: string;
  /** 通報日時（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly reportedAt: string | null;
  readonly reportedAtJst: string | null;
  readonly dipsNumber: string | null;
  readonly numberUnavailable: boolean;
  readonly confirmedDipsDone: boolean;
  readonly confirmedMatchesLatest: boolean;
  readonly memo: string | null;
  readonly errorKind: string | null;
  readonly errorMessage: string | null;
  readonly externalRef: Record<string, unknown> | null;
  readonly externalStatus: Record<string, unknown> | null;
  /** 未知の外部状況の表示（「状況：不明（生の値）」）。状態は増やさない。 */
  readonly externalStatusLabel: string | null;
  /** 整えた通報内容の写し（技能証明書番号・氏名を含まない）。 */
  readonly content: Record<string, unknown>;
  readonly createdAt: string;
  readonly createdAtJst: string;
  readonly updatedAt: string;
  readonly updatedAtJst: string;
  /** 有効な通報（完了した新規・変更の最新で、取消が後に無い）か。 */
  readonly isEffective: boolean;
  readonly actions: ReportActionsDto;
};

export type AttemptDto = {
  readonly id: string;
  readonly reportId: string | null;
  readonly operation: string;
  readonly operationLabel: string;
  readonly memberId: string;
  /** その時点の表示名・役割の写し。 */
  readonly memberName: string;
  readonly memberRole: string;
  readonly adapter: string;
  readonly idempotencyKey: string | null;
  readonly payloadHash: string | null;
  readonly summary: string | null;
  readonly mapRevision: number | null;
  readonly checkEvidenceId: string | null;
  readonly diagnosisEvidenceId: string | null;
  readonly result: string;
  readonly httpStatus: number | null;
  readonly errorKind: string | null;
  readonly dipsNumber: string | null;
  readonly createdAt: string;
  readonly createdAtJst: string;
};

export type ReportWarningDto = { readonly code: string; readonly message: string };

export type PlanReportView = {
  readonly planId: string;
  readonly planTitle: string;
  readonly planVersion: number;
  readonly planStatus: "draft" | "active";
  readonly planVoided: boolean;
  readonly planState: PlanState;
  readonly isSelf: boolean;
  /**
   * 送信元（設定で決まる。全体に 1 つ）。画面の目立つ位置に出す固定の文言（手動：送信しない・記録するまで通報済みにならない・
   * 公式の手続き／模擬：実際の DIPS には送信されない）は、@soraban/dips の REPORT_NOTICE_BY_CHANNEL[name] を使う（API の応答には含めない）。
   */
  readonly adapter: {
    readonly name: "manual" | "mock";
    readonly label: string;
    readonly mode: GatewayCapabilities["mode"];
    readonly modeLabel: string;
    readonly canStatus: boolean;
    readonly canChange: boolean;
    readonly canCancel: boolean;
  };
  readonly requirement: ReportRequirement;
  readonly status: ReportStatusResult;
  readonly deadline: DeadlineState;
  /** この画面で勧める種別（有効な通報が無ければ new、計画が中止されていれば cancel、それ以外は change）。 */
  readonly suggestedKind: ReportKind;
  /** 整えた通報内容の種別。 */
  readonly kind: ReportKind;
  readonly prepared: {
    readonly kind: ReportKind;
    readonly items: PreparedReport["items"];
    readonly groups: PreparedReport["groups"];
    readonly warnings: PreparedReport["warnings"];
    readonly missingRequiredCount: number;
    readonly fingerprint: string;
    readonly fingerprintParts: PreparedReport["fingerprintParts"];
    readonly mapRevision: number;
    readonly mapVerifiedAt: string;
  };
  /** 適用した通報の画面の入力。 */
  readonly inputs: ReportInputs;
  /** request：リクエストの入力／previous：前の通報の入力を初期値にした／none。 */
  readonly inputsFrom: "request" | "previous" | "none";
  /** 有効な通報があり、通報時から計画が変わっているときの変更点。 */
  readonly fingerprintChanges: readonly FingerprintChange[];
  readonly effective: ReportDto | null;
  /** 通報の履歴（新しい順）。 */
  readonly reports: readonly ReportDto[];
  /** 試行の監査（新しい順、最大 50 件）。 */
  readonly audit: readonly AttemptDto[];
  readonly snapshot: {
    readonly id: string;
    readonly seq: number;
    readonly checkEvidenceId: string;
    readonly diagnosisEvidenceId: string;
    readonly checkedAt: string;
  };
  readonly permissions: {
    /** 通報の記録・コピーの監査・訂正などができるか（運航管理者は全員分、操縦者は自分の計画だけ）。 */
    readonly record: boolean;
    /** 技能証明書番号の全桁を見られるか（運航管理者と本人だけ）。 */
    readonly revealLicenseNumber: boolean;
  };
  /** 新規・変更の記録ができるか（下書き・中止した計画はできない）。取消は中止した計画でもできる。 */
  readonly recordable: { readonly allowed: boolean; readonly reason: "draft" | "voided" | null };
  /** 確認前・判定が古いときなどの警告（記録は止めない）。 */
  readonly warnings: readonly ReportWarningDto[];
};

/** GET …/report の ?kind= の値（無指定は undefined）。 */
export type PlanReportViewKind = ReportKind | undefined;

export type CreateReportResult = { readonly created: boolean; readonly report: ReportDto; readonly view: PlanReportView };

// ---- 設定・ゲートウェイ ---------------------------------------------

type Selected = { readonly gateway: NotificationGateway; readonly channel: "manual" | "mock" };

/** 設定（DIPS_REPORT_ADAPTER）からアダプターを選ぶ。誤りは 503 adapter_unavailable（手動へ自動で落とさない）。 */
const selectGateway = (ctx: OpsContext): Selected => {
  const cfg = resolveDipsAdapterConfig(ctx.env ?? process.env);
  if (!cfg.ok) {
    throw new OpsError(503, "adapter_unavailable", { adapter: DIPS_CONFIG_ERROR_MESSAGE[cfg.reason] }, { adapter: cfg.reason });
  }
  const gateway = ctx.dips?.gateway ?? (cfg.adapter === "mock" ? new MockGateway() : new ManualGateway());
  return { gateway, channel: gateway.adapter === "mock" ? "mock" : "manual" };
};

// ---- 計画から通報内容の元を作る -----------------------------------------

type PlanBundle = {
  readonly plan: PlanWithJoins;
  readonly mine: PilotRow | null;
  readonly isSelf: boolean;
  readonly planState: PlanState;
  readonly stale: boolean;
  readonly requirement: ReportRequirement;
  readonly extras: PlanReportExtras;
  /** loadPlanBundle が読んだ許可の照合。状態・差分・通報内容は、すべてこの 1 回の読み取りから作る。 */
  readonly permits: PermitMatchResult;
};

const loadBundle = async (ctx: OpsContext, planId: string): Promise<PlanBundle> => {
  const { plan, mine, dto, extras, permits } = await loadPlanBundle(ctx, planId);
  const requirement: ReportRequirement = {
    kind: dto.report.kind,
    label: dto.report.label,
    reasons: dto.report.reasons,
    exceptionNote: dto.report.exceptionNote,
    note: dto.report.note,
  };
  return { plan, mine, isSelf: dto.isSelf, planState: dto.state, stale: dto.freshness.stale, requirement, extras, permits };
};

const buildPlanForReport = async (ctx: OpsContext, b: PlanBundle, inputs: ReportInputs): Promise<PlanForReport> => {
  const { plan } = b;
  const org = ctx.member.org_id;
  const aircraft = await store.getAircraft(ctx.db, org, plan.aircraft_id);
  const pilot = await store.getPilot(ctx.db, org, plan.pilot_id);
  if (!aircraft || !pilot) throw new OpsError(404, "not_found");
  const reveal = can(ctx.member.role, "flight.readLicenseNumber", { isSelf: b.isSelf });
  const licenseNumber = pilot.license_number === null ? null : reveal ? pilot.license_number : maskLicenseNumber(pilot.license_number);
  // 許可書発行日・許可期間（FPR No.76〜78）：計画の許可番号に結びつき、範囲に収まって適用された登録がちょうど 1 件のときだけ出す
  const registration = reportRegistrationOf(b.permits);
  return {
    planId: plan.id,
    title: plan.title,
    startAt: toJstInput(asDate(plan.planned_start_at)),
    durationMinutes: plan.duration_minutes,
    placeName: plan.place_name,
    latitude: Number(plan.latitude),
    longitude: Number(plan.longitude),
    radiusM: plan.radius_m,
    maxAltitudeM: plan.max_altitude_m,
    accessControl: plan.access_control,
    permitNumbers: plan.permit_numbers,
    permitRegistration:
      registration === null
        ? null
        : { registrationId: registration.id, versionNo: registration.versionNo, permitNumber: registration.permitNumber, issuedOn: registration.issuedOn, validFrom: registration.validFrom, validTo: registration.validTo },
    aircraftId: plan.aircraft_id,
    aircraft: {
      registrationMark: aircraft.registration_mark,
      modelName: aircraft.model_name,
      manufacturer: aircraft.manufacturer,
      airworthinessClass: aircraft.airworthiness_class,
      airworthinessCertNumber: aircraft.airworthiness_cert_number,
      maxTakeoffWeightKg: aircraft.max_takeoff_weight_kg === null ? null : Number(aircraft.max_takeoff_weight_kg),
    },
    pilotId: plan.pilot_id,
    pilot: {
      fullName: pilot.full_name,
      licenseClass: pilot.license_class,
      licenseNumber,
      licenseNumberMasked: !reveal,
    },
    snapshot: {
      id: plan.current_snapshot_id,
      checkEvidenceId: plan.check_evidence_id,
      diagnosisEvidenceId: plan.diagnosis_evidence_id,
      flags: plan.snapshot_result_slim.flags ?? [],
      permitProcedureIds: (plan.snapshot_result_slim.verdict.procedures ?? [])
        .map((p) => p.procedureId)
        .filter((id) => PERMIT_PROCEDURE.test(id) && id !== "flight-permission-emergency-airspace"),
    },
    inputs,
  };
};

// ---- 行 → DTO ------------------------------------------------------

const PERSON_FREE = (v: unknown): string | null => (typeof v === "string" ? v : null);

const reportDto = (r: ReportRowWithTimes, all: readonly ReportRowWithTimes[], b: PlanBundle, ctx: OpsContext): ReportDto => {
  const now = nowOf(ctx);
  const stale = isPreparedStale({ status: r.status, updatedAt: r.updated_at_us }, now);
  const eff = effectiveState({ status: r.status, updatedAt: r.updated_at_us }, now);
  const lites = all.map(rowLite);
  const effective = effectiveReport(lites);
  const live = latestLiveReport(lites);
  const created = asDate(r.created_at);
  const updated = asDate(r.updated_at);
  const role = ctx.member.role;
  const direct = r.channel !== "manual";
  const planActive = b.plan.status === "active" && b.plan.voided_at === null;
  const ext = r.external_status;
  return {
    id: r.id,
    planId: r.plan_id,
    kind: r.kind,
    kindLabel: REPORT_KIND_LABEL[r.kind],
    baseReportId: r.base_report_id,
    channel: r.channel,
    channelLabel: REPORT_CHANNEL_LABEL[r.channel],
    status: r.status,
    effectiveState: eff,
    stale,
    statusLabel: r.kind === "cancel" ? cancelStateLabel(r.status, stale) : reportStateLabel(r.status, r.channel, stale),
    version: r.current_version,
    planVersion: r.plan_version,
    snapshotId: r.snapshot_id,
    snapshotSeq: r.snapshot_seq,
    checkEvidenceId: r.check_evidence_id,
    diagnosisEvidenceId: r.diagnosis_evidence_id,
    fingerprint: r.fingerprint,
    fingerprintParts: r.fingerprint_parts,
    mapRevision: r.map_revision,
    idempotencyKey: r.idempotency_key,
    reportedAt: r.reported_at_jst,
    reportedAtJst: r.reported_at_jst ? r.reported_at_jst.replace("T", " ") : null,
    dipsNumber: r.dips_number,
    numberUnavailable: r.number_unavailable,
    confirmedDipsDone: r.confirmed_dips_done,
    confirmedMatchesLatest: r.confirmed_matches_latest,
    memo: r.memo,
    errorKind: r.error_kind,
    errorMessage: r.error_kind ? (REPORT_ERROR_KIND_LABEL[r.error_kind] ?? null) : null,
    externalRef: r.external_ref,
    externalStatus: ext,
    externalStatusLabel: ext && PERSON_FREE(ext["raw"]) !== null ? externalStatusLabel(ext["raw"] as string) : null,
    content: r.content,
    createdAt: created.toISOString(),
    createdAtJst: formatJst(created),
    updatedAt: updated.toISOString(),
    updatedAtJst: formatJst(updated),
    isEffective: effective?.id === r.id,
    actions: {
      correct: can(role, "report.correct", { isSelf: b.isSelf }) && CORRECTABLE_STATES.includes(r.status),
      retract:
        can(role, "report.retract", { isSelf: b.isSelf }) &&
        canTransition(r.status, "retracted", r.channel) &&
        live?.id === r.id,
      resolve: can(role, "report.resolve", { isSelf: b.isSelf }) && direct && eff === "unknown",
      retry: can(role, "report.record", { isSelf: b.isSelf }) && direct && r.status === "failed" && planActive && r.kind !== "cancel",
    },
  };
};

const attemptDto = (a: import("@soraban/db").FlightReportAttemptRow): AttemptDto => {
  const at = asDate(a.created_at);
  return {
    id: a.id,
    reportId: a.report_id,
    operation: a.operation,
    operationLabel: ATTEMPT_OPERATION_LABEL[a.operation] ?? a.operation,
    memberId: a.member_id,
    memberName: a.member_name,
    memberRole: a.member_role,
    adapter: a.adapter,
    idempotencyKey: a.idempotency_key,
    payloadHash: a.payload_hash,
    summary: a.summary,
    mapRevision: a.map_revision,
    checkEvidenceId: a.check_evidence_id,
    diagnosisEvidenceId: a.diagnosis_evidence_id,
    result: a.result,
    httpStatus: a.http_status,
    errorKind: a.error_kind,
    dipsNumber: a.dips_number,
    createdAt: at.toISOString(),
    createdAtJst: formatJst(at),
  };
};

// ---- 通報内容と履歴の表示 ---------------------------------------------

type ViewOptions = {
  readonly kind?: ReportKind;
  /** 検査済みの通報の画面の入力。無ければ前の通報の入力を初期値にする。 */
  readonly inputs?: ReportInputs;
};

const buildView = async (ctx: OpsContext, b: PlanBundle, selected: Selected, opts: ViewOptions): Promise<PlanReportView> => {
  const { plan, extras } = b;
  const rows = extras.rows;
  const lites = rows.map(rowLite);
  const permits = b.permits;
  const summary = summarizePlanReport({
    ctx,
    plan,
    isSelf: b.isSelf,
    planState: b.planState,
    judgementStale: b.stale,
    requirement: b.requirement,
    extras,
    now: nowOf(ctx),
    permits,
  });
  const status = summary.report.status;
  const eff = effectiveReport(lites);
  const effRow = eff ? rows.find((r) => r.id === eff.id)! : null;
  const voided = plan.voided_at !== null;
  const suggestedKind: ReportKind = !eff ? "new" : voided ? "cancel" : "change";
  const kind = opts.kind ?? suggestedKind;

  // 通報の画面の入力：リクエストの値、無ければ前の通報（有効な通報、無ければ取り下げていない最新）の入力
  let inputs: ReportInputs = {};
  let inputsFrom: PlanReportView["inputsFrom"] = "none";
  if (opts.inputs !== undefined) {
    inputs = opts.inputs;
    inputsFrom = "request";
  } else {
    const prev = effRow ?? [...rows].reverse().find((r) => r.status !== "retracted");
    const prevInputs = prev?.content["inputs"];
    if (prevInputs && typeof prevInputs === "object") {
      inputs = prevInputs as ReportInputs;
      inputsFrom = "previous";
    }
  }

  const planForReport = await buildPlanForReport(ctx, b, inputs);
  const prepared = selected.gateway.prepare(planForReport, kind);
  const caps = selected.gateway.capabilities();
  const flagLabel = (f: string) => SPECIFIC_FLIGHT_FLAG_LABEL[f as SpecificFlightFlag] ?? f;
  const fingerprintChanges = effRow
    ? diffFingerprintParts(effRow.fingerprint_parts as never, currentFingerprintPartsOf(plan, reportRegistrationOf(permits)), { flagLabel })
    : [];

  const warnings: ReportWarningDto[] = [];
  const draft = plan.status === "draft" && !voided;
  if (voided) warnings.push({ code: "plan_voided", message: WARNING_PLAN_VOIDED });
  if (draft) warnings.push({ code: "plan_draft", message: WARNING_PLAN_DRAFT });
  if (!voided && !draft && b.planState !== "approved") warnings.push({ code: "plan_not_confirmed", message: WARNING_PLAN_NOT_CONFIRMED });
  if (b.stale && !voided) warnings.push({ code: "judgement_stale", message: WARNING_JUDGEMENT_STALE });

  const attempts = await store.listAttempts(ctx.db, ctx.member.org_id, plan.id, 50);
  const reports = [...rows].reverse().map((r) => reportDto(r, rows, b, ctx));
  const recordAllowed = kind === "cancel" ? true : !voided && plan.status === "active";

  return {
    planId: plan.id,
    planTitle: plan.title,
    planVersion: plan.current_version,
    planStatus: plan.status,
    planVoided: voided,
    planState: b.planState,
    isSelf: b.isSelf,
    adapter: {
      name: selected.channel,
      label: REPORT_CHANNEL_LABEL[selected.channel],
      mode: caps.mode,
      modeLabel: ADAPTER_MODE_LABEL[caps.mode],
      canStatus: caps.canStatus,
      canChange: caps.canChange,
      canCancel: caps.canCancel,
    },
    requirement: b.requirement,
    status,
    deadline: summary.report.deadline,
    suggestedKind,
    kind,
    prepared: {
      kind: prepared.kind,
      items: prepared.items,
      groups: prepared.groups,
      warnings: prepared.warnings,
      missingRequiredCount: prepared.missingRequiredCount,
      fingerprint: prepared.fingerprint,
      fingerprintParts: prepared.fingerprintParts,
      mapRevision: prepared.mapRevision,
      mapVerifiedAt: prepared.mapVerifiedAt,
    },
    inputs,
    inputsFrom,
    fingerprintChanges,
    effective: effRow ? reportDto(effRow, rows, b, ctx) : null,
    reports,
    audit: attempts.map(attemptDto),
    snapshot: {
      id: plan.current_snapshot_id,
      seq: plan.snapshot_seq,
      checkEvidenceId: plan.check_evidence_id,
      diagnosisEvidenceId: plan.diagnosis_evidence_id,
      checkedAt: asDate(plan.snapshot_checked_at).toISOString(),
    },
    permissions: {
      record: can(ctx.member.role, "report.record", { isSelf: b.isSelf }),
      revealLicenseNumber: can(ctx.member.role, "flight.readLicenseNumber", { isSelf: b.isSelf }),
    },
    recordable: { allowed: recordAllowed, reason: recordAllowed ? null : voided ? "voided" : "draft" },
    warnings,
  };
};

/**
 * 通報内容（DIPS の入力順の項目の一覧）・アダプターと能力・通報の状況・期限・変更点・履歴・監査を返す。
 * 技能証明書番号の全桁は運航管理者と本人だけ（他は伏せ字でコピー対象にしない）。他の組織の計画は 404。
 */
export const getPlanReport = async (ctx: OpsContext, planId: string, opts: ViewOptions = {}): Promise<PlanReportView> => {
  assertCan(ctx, "report.read");
  const selected = selectGateway(ctx);
  const b = await loadBundle(ctx, planId);
  return buildView(ctx, b, selected, opts);
};

/** POST …/report：通報の画面の入力を重ねた整形のプレビュー（保存しない）。 */
export const previewPlanReport = async (ctx: OpsContext, planId: string, body: unknown): Promise<PlanReportView> => {
  assertCan(ctx, "report.read");
  const input = asInput(body ?? {});
  const kind = input["kind"];
  if (kind !== undefined && kind !== "new" && kind !== "change" && kind !== "cancel") {
    throw new OpsError(400, "invalid_input", { kind: "種別は new・change・cancel のいずれかです" }, { kind: "invalid" });
  }
  const inputs = validateReportInputs(input["inputs"]);
  if (!inputs.ok) throw new OpsError(400, "invalid_input", inputs.errors, inputs.codes);
  const selected = selectGateway(ctx);
  const b = await loadBundle(ctx, planId);
  return buildView(ctx, b, selected, { ...(kind ? { kind: kind as ReportKind } : {}), ...(input["inputs"] !== undefined ? { inputs: inputs.data } : {}) });
};

// ---- 書き込みの共通部分 -------------------------------------------------

const hashOf = (v: unknown): string => sha256Hex(JSON.stringify(v));

type AttemptBase = {
  readonly orgId: string;
  readonly planId: string;
  readonly memberId: string;
  readonly mapRevision: number;
  readonly checkEvidenceId: string;
  readonly diagnosisEvidenceId: string;
};

const attemptBase = (ctx: OpsContext, plan: PlanWithJoins, mapRevision: number): AttemptBase => ({
  orgId: ctx.member.org_id,
  planId: plan.id,
  memberId: ctx.member.id,
  mapRevision,
  checkEvidenceId: plan.check_evidence_id,
  diagnosisEvidenceId: plan.diagnosis_evidence_id,
});

type AttemptSpec = {
  readonly operation: store.AttemptInsert["operation"];
  readonly adapter: ReportChannel;
  readonly reportId: string | null;
  readonly key: string | null;
  readonly payloadHash: string | null;
  readonly summary: string;
  readonly result: store.AttemptInsert["result"];
  readonly httpStatus?: number | null;
  readonly errorKind?: string | null;
  readonly dipsNumber?: string | null;
};

const attemptRow = (base: AttemptBase, a: AttemptSpec): store.AttemptInsert => ({
  orgId: base.orgId,
  planId: base.planId,
  reportId: a.reportId,
  operation: a.operation,
  memberId: base.memberId,
  adapter: a.adapter,
  idempotencyKey: a.key,
  payloadHash: a.payloadHash,
  summary: a.summary.slice(0, 500),
  mapRevision: base.mapRevision,
  checkEvidenceId: base.checkEvidenceId,
  diagnosisEvidenceId: base.diagnosisEvidenceId,
  result: a.result,
  httpStatus: a.httpStatus ?? null,
  errorKind: a.errorKind ?? null,
  dipsNumber: a.dipsNumber ?? null,
});

/** 失敗した操作を監査に残す（最善の努力。失敗しても元の誤りを隠さない）。 */
const auditFailure = async (ctx: OpsContext, plan: PlanWithJoins, a: AttemptSpec, mapRevision: number, e: unknown): Promise<void> => {
  const errorKind = e instanceof OpsError ? e.code : "internal_error";
  const status = e instanceof OpsError ? e.status : 500;
  // 入力の誤り・認可の誤りは何も起きていないので残さない。競合・時間切れなど、操作が拒まれたものを残す
  if (e instanceof OpsError && (e.status === 400 || e.status === 403 || e.status === 404)) return;
  try {
    await store.insertAttempts(ctx.db, [
      attemptRow(attemptBase(ctx, plan, mapRevision), { ...a, result: "failure", httpStatus: status, errorKind }),
    ]);
  } catch (inner) {
    console.error(`[ops] report audit (failure) was not recorded: ${inner instanceof Error ? inner.name : "error"}`);
  }
};

const resultData = (base: Record<string, unknown>, r: SubmitResult): Record<string, unknown> => ({
  ...base,
  status: r.state,
  reported_at: r.reportedAt,
  dips_number: r.dipsNumber,
  number_unavailable: r.numberUnavailable,
  confirmed_dips_done: r.confirmedDipsDone,
  confirmed_matches_latest: r.confirmedMatchesLatest,
  memo: r.memo,
  error_kind: r.errorKind,
  external_ref: r.externalRef,
  external_status: r.externalStatus,
});

const newRowData = (a: {
  readonly planId: string;
  readonly kind: ReportKind;
  readonly baseReportId: string | null;
  readonly planVersion: number;
  readonly prepared: PreparedReport;
  readonly channel: ReportChannel;
  readonly key: string;
}): Record<string, unknown> => ({
  plan_id: a.planId,
  kind: a.kind,
  base_report_id: a.baseReportId,
  snapshot_id: a.prepared.snapshot.id,
  plan_version: a.planVersion,
  fingerprint: a.prepared.fingerprint,
  fingerprint_parts: a.prepared.fingerprintParts,
  map_revision: a.prepared.mapRevision,
  channel: a.channel,
  status: "prepared",
  idempotency_key: a.key,
  reported_at: null,
  dips_number: null,
  number_unavailable: false,
  confirmed_dips_done: false,
  confirmed_matches_latest: false,
  content: contentOf(a.prepared),
  memo: null,
  error_kind: null,
  external_ref: null,
  external_status: null,
});

const toFieldError = (e: GatewayInputError): OpsError => new OpsError(400, "invalid_input", e.fieldErrors, e.fieldCodes);

const loadRow = async (ctx: OpsContext, planId: string, rid: string): Promise<ReportRowWithTimes> => {
  const row = /^[0-9a-f-]{36}$/i.test(rid) ? await store.getReport(ctx.db, ctx.member.org_id, planId, rid.toLowerCase()) : null;
  if (!row) throw new OpsError(404, "not_found");
  return row;
};

const respond = async (ctx: OpsContext, planId: string, reportId: string, selected: Selected, created: boolean): Promise<CreateReportResult> => {
  const b = await loadBundle(ctx, planId);
  const view = await buildView(ctx, b, selected, {});
  const report = view.reports.find((r) => r.id === reportId);
  if (!report) throw new OpsError(404, "not_found");
  return { created, report, view };
};

// ---- 通報の記録を作る（新規・変更・取消） --------------------------------

/**
 * 通報の記録を作る。手動：利用者が DIPS で通報した結果（manual）を検査して reported_manual で記録する。
 * 模擬：送信内容の確認（confirmSend）の後、prepared を記録 → 模擬の結果 → 結果を記録。取消は、どのアダプターでも
 * 利用者が DIPS で取り消した結果の記録（手動）。同じ冪等性キーの記録があれば、新しい行を作らず既存の行を返す。
 */
export const createReport = async (ctx: OpsContext, planId: string, body: unknown): Promise<CreateReportResult> => {
  // 設定の誤りは何より先に 503（手動へ自動で落とさない）
  const selected = selectGateway(ctx);
  const b0 = await loadBundle(ctx, planId);
  assertCan(ctx, "report.record", b0.isSelf);
  const input = asInput(body);
  const v = validateCreateReport(input);
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors, v.codes);
  const { plan } = b0;
  const { kind } = v.data;
  const org = ctx.member.org_id;
  const now = nowOf(ctx);

  // 計画の版：新規・変更はクライアントが見た版が最新でなければ 409
  if (v.data.expectedPlanVersion !== null && v.data.expectedPlanVersion !== plan.current_version) {
    throw new OpsError(409, "version_conflict");
  }

  const extras = b0.extras;
  const lites = extras.rows.map(rowLite);
  const eff = effectiveReport(lites);
  // 変更・取消の元の通報：指定が無ければ現在の有効な通報。有効な通報が無ければ 409
  let baseReportId = v.data.baseReportId;
  if (kind !== "new") {
    if (!eff) throw new OpsError(409, "no_active_report");
    baseReportId = baseReportId ?? eff.id;
  }

  const inputsApplied: ReportInputs =
    v.data.inputs ??
    ((eff ? extras.rows.find((r) => r.id === eff.id) : undefined)?.content["inputs"] as ReportInputs | undefined) ??
    {};
  const planForReport = await buildPlanForReport(ctx, b0, inputsApplied);
  const prepared = selected.gateway.prepare(planForReport, kind);
  // 冪等性キーの基準：完了した取消の件数（世代）に、取り下げた行の件数を足す（取り下げのあと、同じ内容を記録し直せるように。
  // どちらも減らない数で、記録し直しのたびに増える）。変更・取消は元の通報の ID に、この数を添える。
  const generation = cancelGeneration(lites) + lites.filter((r) => r.status === "retracted").length;
  const key = computeIdempotencyKey({
    orgId: org,
    planId: plan.id,
    kind,
    fingerprint: prepared.fingerprint,
    basis: kind === "new" ? generation : `${baseReportId}#${generation}`,
  });

  // 二重送信（画面の再読み込み・二度押し）：新しい行を作らず、既存の行を返す。
  // ただし、有効な手動の通報（利用者の申告）がある計画へ、模擬で同じ内容を送ろうとしたときは 409 manual_report_exists
  // （DIPS 上で二重になる。冪等性キーは送信元を含まないため、ここで区別する）
  const existing = await store.findReportByKey(ctx.db, org, key);
  if (existing) {
    const direct = selected.channel === "mock" && kind !== "cancel";
    if (direct && existing.channel === "manual" && (existing.status === "reported_manual" || existing.status === "submitted_api")) {
      throw new OpsError(409, "manual_report_exists");
    }
    return respond(ctx, plan.id, existing.id, selected, false);
  }

  const reportId = randomUUID();
  const base = attemptBase(ctx, plan, prepared.mapRevision);
  const payloadHash = hashOf(contentOf(prepared));
  const actor = { memberId: ctx.member.id, displayName: ctx.member.display_name, role: ctx.member.role };

  // ---- 手動の記録（取消を含む。どのアダプターでも、取消は利用者が DIPS で取り消した結果の記録） ----
  if (selected.channel === "manual" || kind === "cancel") {
    const manual = selected.channel === "manual" ? selected.gateway : new ManualGateway();
    let result: SubmitResult;
    try {
      if (kind === "cancel") {
        const ref = { reportId: baseReportId!, dipsNumber: null };
        const cancelCtx = { idempotencyKey: key, actor, now, manualResult: asManualResult(v.data.manualRaw), prepared };
        let r = await selected.gateway.cancel(ref, cancelCtx);
        if (r.mode === "manual_record_required") r = await manual.cancel(ref, cancelCtx);
        if (r.mode !== "recorded") throw new OpsError(409, "cancel_not_supported");
        result = r.result;
      } else {
        result = await manual.submit(prepared, { idempotencyKey: key, actor, now, manualResult: asManualResult(v.data.manualRaw) });
      }
    } catch (e) {
      if (e instanceof GatewayInputError) throw toFieldError(e);
      throw e;
    }
    const spec: AttemptSpec = {
      operation: kind === "cancel" ? "cancel" : "manual_record",
      adapter: "manual",
      reportId,
      key,
      payloadHash,
      summary: `${REPORT_KIND_LABEL[kind]}の通報の結果を記録（手動・利用者の申告）`,
      result: "success",
      dipsNumber: result.dipsNumber,
    };
    try {
      await store.withTransaction(ctx.db, async (c) => {
        await store.appendVersionOn(c, {
          orgId: org,
          entityType: "flight_report",
          entityId: reportId,
          op: "create",
          data: resultData(
            newRowData({ planId: plan.id, kind, baseReportId, planVersion: plan.current_version, prepared, channel: "manual", key }),
            result,
          ),
          reason: null,
          actorMemberId: ctx.member.id,
        });
        await store.insertAttemptOn(c, attemptRow(base, spec));
      });
    } catch (e) {
      if (e instanceof OpsError && e.code === "duplicate_request") {
        const again = await store.findReportByKey(ctx.db, org, key);
        if (again) return respond(ctx, plan.id, again.id, selected, false);
      }
      await auditFailure(ctx, plan, { ...spec, reportId: null }, prepared.mapRevision, e);
      throw e;
    }
    return respond(ctx, plan.id, reportId, selected, true);
  }

  // ---- 模擬の送信（direct）：確認 → ①prepared → ②アダプター → ③結果 ----
  if (!v.data.confirmSend) {
    throw new OpsError(400, "invalid_input", { confirmSend: "送信内容を確認し、送信を確定してください" }, { confirmSend: "confirm_required" });
  }
  const begin: AttemptSpec = {
    operation: "submit",
    adapter: "mock",
    reportId,
    key,
    payloadHash,
    summary: `${REPORT_KIND_LABEL[kind]}の送信を開始（模擬・外部の呼び出しの前）`,
    result: "unknown",
  };
  try {
    await store.withTransaction(ctx.db, async (c) => {
      await store.appendVersionOn(c, {
        orgId: org,
        entityType: "flight_report",
        entityId: reportId,
        op: "create",
        data: newRowData({ planId: plan.id, kind, baseReportId, planVersion: plan.current_version, prepared, channel: "mock", key }),
        reason: null,
        actorMemberId: ctx.member.id,
      });
      await store.insertAttemptOn(c, attemptRow(base, begin));
    });
  } catch (e) {
    if (e instanceof OpsError && e.code === "duplicate_request") {
      const again = await store.findReportByKey(ctx.db, org, key);
      if (again) return respond(ctx, plan.id, again.id, selected, false);
    }
    await auditFailure(ctx, plan, { ...begin, reportId: null }, prepared.mapRevision, e);
    throw e;
  }
  await finishSend(ctx, { plan, reportId, key, prepared, version: 1, scenario: v.data.mockScenario, gateway: selected.gateway, payloadHash, actor });
  return respond(ctx, plan.id, reportId, selected, true);
};

const asManualResult = (raw: unknown): ManualResult => {
  // 検査は手動アダプター（validateManualResult）が行う。ここでは形だけを渡す
  return (raw ?? undefined) as ManualResult;
};

type FinishArgs = {
  readonly plan: PlanWithJoins;
  readonly reportId: string;
  readonly key: string;
  readonly prepared: PreparedReport;
  /** ①の直後の行の版（これに対して結果を書く）。 */
  readonly version: number;
  readonly scenario: MockScenario | undefined;
  readonly gateway: NotificationGateway;
  readonly payloadHash: string;
  readonly actor: { readonly memberId: string; readonly displayName: string; readonly role: string };
};

/** ②外部（模擬）の呼び出し（上限つき。トランザクションを開けない）→ ③結果の版と監査。 */
const finishSend = async (ctx: OpsContext, a: FinishArgs): Promise<void> => {
  const org = ctx.member.org_id;
  await ctx.dips?.afterBegin?.({ reportId: a.reportId });

  // ② 外部の呼び出し。時間切れ・例外は「結果不明」（自動で再送しない）
  const timeoutMs = ctx.dips?.timeoutMs ?? EXTERNAL_CALL_TIMEOUT_MS;
  let result: SubmitResult;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = a.gateway.submit(a.prepared, {
      idempotencyKey: a.key,
      actor: a.actor,
      now: nowOf(ctx),
      ...(a.scenario ? { mockScenario: a.scenario } : {}),
    });
    call.catch(() => undefined);
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const r = await Promise.race([call, timeout]);
    result = r === "timeout" ? unknownResult(a.prepared, "timeout") : r;
  } catch {
    result = unknownResult(a.prepared, "adapter_error");
  } finally {
    if (timer) clearTimeout(timer);
  }

  // ③ 結果の版と監査。失敗しても②の結果で再送しない（prepared のまま「結果不明」として扱う）
  try {
    await ctx.dips?.beforeResultWrite?.({ reportId: a.reportId });
    await store.withTransaction(ctx.db, async (c) => {
      assertTransition("prepared", result.state === "reported_manual" ? "submitted_api" : result.state, "mock");
      await store.appendVersionOn(c, {
        orgId: org,
        entityType: "flight_report",
        entityId: a.reportId,
        op: "update",
        data: resultData(await dataOn(c, org, a.reportId), result),
        reason: "送信の結果を記録（模擬）",
        actorMemberId: ctx.member.id,
        expectedVersion: a.version,
      });
      await store.insertAttemptOn(
        c,
        attemptRow(attemptBase(ctx, a.plan, a.prepared.mapRevision), {
          operation: "submit",
          adapter: "mock",
          reportId: a.reportId,
          key: a.key,
          payloadHash: a.payloadHash,
          summary: `${REPORT_KIND_LABEL[a.prepared.kind]}の送信の結果（模擬）：${resultSummary(result)}`,
          result: result.state === "submitted_api" ? "success" : result.state === "failed" ? "failure" : "unknown",
          httpStatus: result.httpStatus,
          errorKind: result.errorKind,
          dipsNumber: result.dipsNumber,
        }),
      );
    });
  } catch (e) {
    console.error(`[ops] mock send result was not recorded: ${e instanceof Error ? e.name : "error"}`);
    throw new OpsError(503, "result_not_recorded");
  }
};

const resultSummary = (r: SubmitResult): string =>
  r.state === "submitted_api"
    ? `受理${r.externalStatus ? "（未知の外部状況あり）" : ""}`
    : r.state === "failed"
      ? `確定した失敗（${r.errorKind ?? "error"}）`
      : `結果不明（${r.errorKind ?? "error"}）`;

const unknownResult = (prepared: PreparedReport, errorKind: "timeout" | "adapter_error"): SubmitResult => ({
  state: "unknown",
  reportedAt: null,
  dipsNumber: null,
  numberUnavailable: false,
  memo: null,
  confirmedDipsDone: false,
  confirmedMatchesLatest: false,
  errorKind,
  httpStatus: null,
  message: REPORT_ERROR_KIND_LABEL[errorKind] ?? null,
  externalRef: null,
  externalStatus: null,
  replayed: false,
  trace: {
    channel: "mock",
    snapshotId: prepared.snapshot.id,
    checkEvidenceId: prepared.snapshot.checkEvidenceId,
    diagnosisEvidenceId: prepared.snapshot.diagnosisEvidenceId,
    fingerprint: prepared.fingerprint,
    mapRevision: prepared.mapRevision,
  },
});

/** トランザクションの中で最新の版の data を読む（結果の書き込みの合成用）。 */
const dataOn = async (c: store.OpsTx, orgId: string, id: string): Promise<Record<string, unknown>> =>
  (
    await c.query<{ data: Record<string, unknown> }>(
      `select data from record_versions where org_id = $1 and entity_type = 'flight_report' and entity_id = $2
        order by version_no desc limit 1`,
      [orgId, id],
    )
  ).rows[0]?.data ?? {};

// ---- 手動記録の訂正 -------------------------------------------------------

/** 手動記録の訂正（番号・日時・メモ）。状態は変えず、理由つきの新しい版で直す。元の値は履歴に残る。 */
export const correctReport = async (ctx: OpsContext, planId: string, rid: string, body: unknown): Promise<CreateReportResult> => {
  const selected = selectGateway(ctx);
  const b = await loadBundle(ctx, planId);
  assertCan(ctx, "report.correct", b.isSelf);
  const row = await loadRow(ctx, planId, rid);
  const input = asInput(body);
  const meta = validateReportMeta(input);
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors, meta.codes);
  if (!CORRECTABLE_STATES.includes(row.status)) throw new OpsError(409, "not_correctable");
  const changes = pickCorrectionChanges(input);
  const merged = mergeCorrection(
    { reportedAt: row.reported_at_jst, dipsNumber: row.dips_number, numberUnavailable: row.number_unavailable, memo: row.memo },
    changes,
    nowOf(ctx),
    REPORT_FIELDS.numberPolicy,
  );
  if (!merged.ok) throw new OpsError(400, "invalid_input", merged.errors, merged.codes);
  const m = merged.data;
  const unchanged =
    m.reportedAt === row.reported_at_jst &&
    (m.dipsNumber ?? null) === row.dips_number &&
    m.numberUnavailable === row.number_unavailable &&
    (m.memo ?? null) === row.memo;
  if (unchanged) throw new OpsError(400, "invalid_input", { reason: "変更する項目がありません" }, { reason: "no_change" });

  const base = attemptBase(ctx, b.plan, row.map_revision);
  const spec: AttemptSpec = {
    operation: "correct",
    adapter: row.channel,
    reportId: row.id,
    key: row.idempotency_key,
    payloadHash: hashOf({ reportedAt: m.reportedAt, dipsNumber: m.dipsNumber ?? null, numberUnavailable: m.numberUnavailable, memo: m.memo ?? null }),
    summary: `通報の記録を訂正（理由あり）：${correctedFields(row, m).join("・")}`,
    result: "success",
    dipsNumber: m.dipsNumber ?? null,
  };
  try {
    await store.withTransaction(ctx.db, async (c) => {
      await store.appendVersionOn(c, {
        orgId: ctx.member.org_id,
        entityType: "flight_report",
        entityId: row.id,
        op: "update",
        data: {
          ...(await dataOn(c, ctx.member.org_id, row.id)),
          reported_at: m.reportedAt,
          dips_number: m.dipsNumber ?? null,
          number_unavailable: m.numberUnavailable,
          memo: m.memo ?? null,
        },
        reason: meta.data.reason,
        actorMemberId: ctx.member.id,
        expectedVersion: meta.data.expectedVersion,
      });
      await store.insertAttemptOn(c, attemptRow(base, spec));
    });
  } catch (e) {
    await auditFailure(ctx, b.plan, spec, row.map_revision, e);
    throw e;
  }
  return respond(ctx, planId, row.id, selected, false);
};

const correctedFields = (row: ReportRowWithTimes, m: ManualResult): string[] => {
  const out: string[] = [];
  if (m.reportedAt !== row.reported_at_jst) out.push("通報日時");
  if ((m.dipsNumber ?? null) !== row.dips_number || m.numberUnavailable !== row.number_unavailable) out.push("番号");
  if ((m.memo ?? null) !== row.memo) out.push("メモ");
  return out;
};

// ---- 取り下げ・結果不明の確定・失敗の再送 ----------------------------------

/** 記録の誤りの取り下げ（reported_manual → retracted。理由が必須）。取消（種別 cancel）とは別。元の値は履歴に残る。 */
export const retractReport = async (ctx: OpsContext, planId: string, rid: string, body: unknown): Promise<CreateReportResult> => {
  const selected = selectGateway(ctx);
  const b = await loadBundle(ctx, planId);
  assertCan(ctx, "report.retract", b.isSelf);
  const row = await loadRow(ctx, planId, rid);
  const meta = validateReportMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors, meta.codes);
  const extras = b.extras;
  if (!canTransition(row.status, "retracted", row.channel)) throw new OpsError(409, "invalid_transition");
  // 取り下げ後の有効な通報が不整合にならないよう、取り下げていない最新の行だけ取り下げられる
  if (latestLiveReport(extras.rows.map(rowLite))?.id !== row.id) throw new OpsError(409, "not_latest");
  const base = attemptBase(ctx, b.plan, row.map_revision);
  const spec: AttemptSpec = {
    operation: "retract",
    adapter: row.channel,
    reportId: row.id,
    key: row.idempotency_key,
    payloadHash: null,
    summary: `通報の記録を取り下げ（記録の誤り。理由あり）`,
    result: "success",
    dipsNumber: row.dips_number,
  };
  try {
    await store.withTransaction(ctx.db, async (c) => {
      await store.appendVersionOn(c, {
        orgId: ctx.member.org_id,
        entityType: "flight_report",
        entityId: row.id,
        op: "update",
        data: { ...(await dataOn(c, ctx.member.org_id, row.id)), status: "retracted" },
        reason: meta.data.reason,
        actorMemberId: ctx.member.id,
        expectedVersion: meta.data.expectedVersion,
      });
      await store.insertAttemptOn(c, attemptRow(base, spec));
    });
  } catch (e) {
    await auditFailure(ctx, b.plan, spec, row.map_revision, e);
    throw e;
  }
  return respond(ctx, planId, row.id, selected, false);
};

/**
 * 結果不明（unknown、または prepared のまま 5 分を超えた行）の確定。DIPS の画面で確かめた結果を記録する：
 * 通報されていた（reported_manual。通報日時・番号または宣言・二つの確認）／されていなかった（failed。再送できる）。理由が必須。
 */
export const resolveReport = async (ctx: OpsContext, planId: string, rid: string, body: unknown): Promise<CreateReportResult> => {
  const selected = selectGateway(ctx);
  const b = await loadBundle(ctx, planId);
  assertCan(ctx, "report.resolve", b.isSelf);
  const row = await loadRow(ctx, planId, rid);
  const input = asInput(body);
  const meta = validateReportMeta(input);
  const res = validateResolve(input);
  const errors = { ...(meta.ok ? {} : meta.errors), ...(res.ok ? {} : res.errors) };
  const codes = { ...(meta.ok ? {} : meta.codes), ...(res.ok ? {} : res.codes) };
  if (!meta.ok || !res.ok) throw new OpsError(400, "invalid_input", errors, codes);
  const now = nowOf(ctx);
  const stale = isPreparedStale({ status: row.status, updatedAt: row.updated_at_us }, now);
  if (!(row.status === "unknown" || stale) || row.channel === "manual") throw new OpsError(409, "invalid_transition");
  const to: ReportState = res.data.outcome === "reported" ? "reported_manual" : "failed";
  try {
    assertTransition(row.status, to, row.channel, { stale });
  } catch {
    throw new OpsError(409, "invalid_transition");
  }
  let manual: ManualResult | null = null;
  if (to === "reported_manual") {
    const v = validateManualResult(res.data.manualRaw, now, { numberPolicy: REPORT_FIELDS.numberPolicy });
    if (!v.ok) throw new OpsError(400, "invalid_input", v.errors, v.codes);
    manual = v.data;
  }
  const base = attemptBase(ctx, b.plan, row.map_revision);
  const spec: AttemptSpec = {
    operation: "resolve",
    adapter: row.channel,
    reportId: row.id,
    key: row.idempotency_key,
    payloadHash: null,
    summary: to === "reported_manual" ? "結果不明を確定：DIPS の画面で通報を確認（理由あり）" : "結果不明を確定：通報されていないことを確認（理由あり）",
    result: "success",
    dipsNumber: manual?.dipsNumber ?? null,
  };
  try {
    await store.withTransaction(ctx.db, async (c) => {
      const cur = await dataOn(c, ctx.member.org_id, row.id);
      const next =
        manual !== null
          ? {
              ...cur,
              status: "reported_manual",
              reported_at: manual.reportedAt,
              dips_number: manual.dipsNumber ?? null,
              number_unavailable: manual.numberUnavailable === true,
              confirmed_dips_done: true,
              confirmed_matches_latest: true,
              memo: manual.memo ?? null,
              error_kind: null,
            }
          : { ...cur, status: "failed", error_kind: "confirmed_not_registered" };
      await store.appendVersionOn(c, {
        orgId: ctx.member.org_id,
        entityType: "flight_report",
        entityId: row.id,
        op: "update",
        data: next,
        reason: meta.data.reason,
        actorMemberId: ctx.member.id,
        expectedVersion: meta.data.expectedVersion,
      });
      await store.insertAttemptOn(c, attemptRow(base, spec));
    });
  } catch (e) {
    await auditFailure(ctx, b.plan, spec, row.map_revision, e);
    throw e;
  }
  return respond(ctx, planId, row.id, selected, false);
};

/**
 * 失敗（failed）の再送（模擬。同じ行・同じ冪等性キー。版が増える）。failed のときだけ。計画が最新の版のままで、
 * 通報の指紋が変わっていないときだけ。①prepared → ②アダプター → ③結果。
 */
export const retryReport = async (ctx: OpsContext, planId: string, rid: string, body: unknown): Promise<CreateReportResult> => {
  const selected = selectGateway(ctx);
  const b = await loadBundle(ctx, planId);
  assertCan(ctx, "report.record", b.isSelf);
  const row = await loadRow(ctx, planId, rid);
  const v = validateRetry(asInput(body ?? {}));
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors, v.codes);
  if (row.channel === "manual" || selected.channel !== "mock") throw new OpsError(409, "invalid_transition");
  if (row.status !== "failed") throw new OpsError(409, "not_retryable");
  if (!canTransition("failed", "prepared", row.channel)) throw new OpsError(409, "invalid_transition");
  const { plan } = b;
  if (plan.voided_at !== null) throw new OpsError(409, "voided");
  if (plan.status !== "active") throw new OpsError(409, "not_requested");
  if (!v.data.confirmSend) {
    throw new OpsError(400, "invalid_input", { confirmSend: "送信内容を確認し、送信を確定してください" }, { confirmSend: "confirm_required" });
  }
  // 計画が通報の行の時点から変わっていれば再送しない（同じ行・同じキーで別の内容を送らない）
  const content = row.content["inputs"] as ReportInputs | undefined;
  const prepared = selected.gateway.prepare(await buildPlanForReport(ctx, b, content ?? {}), row.kind);
  if (prepared.fingerprint !== row.fingerprint || plan.current_version !== row.plan_version) {
    throw new OpsError(409, "version_conflict");
  }
  const base = attemptBase(ctx, plan, prepared.mapRevision);
  const payloadHash = hashOf(contentOf(prepared));
  const begin: AttemptSpec = {
    operation: "submit",
    adapter: "mock",
    reportId: row.id,
    key: row.idempotency_key,
    payloadHash,
    summary: `${REPORT_KIND_LABEL[row.kind]}の再送を開始（模擬・同じ行・同じ冪等性キー）`,
    result: "unknown",
  };
  let version: number;
  try {
    version = await store.withTransaction(ctx.db, async (c) => {
      const n = await store.appendVersionOn(c, {
        orgId: ctx.member.org_id,
        entityType: "flight_report",
        entityId: row.id,
        op: "update",
        data: { ...(await dataOn(c, ctx.member.org_id, row.id)), status: "prepared", error_kind: null },
        reason: "失敗した送信の再送",
        actorMemberId: ctx.member.id,
        expectedVersion: row.current_version,
      });
      await store.insertAttemptOn(c, attemptRow(base, begin));
      return n;
    });
  } catch (e) {
    await auditFailure(ctx, plan, begin, prepared.mapRevision, e);
    throw e;
  }
  const actor = { memberId: ctx.member.id, displayName: ctx.member.display_name, role: ctx.member.role };
  await finishSend(ctx, {
    plan,
    reportId: row.id,
    key: row.idempotency_key,
    prepared,
    version,
    scenario: v.data.mockScenario,
    gateway: selected.gateway,
    payloadHash,
    actor,
  });
  return respond(ctx, planId, row.id, selected, false);
};

// ---- コピーの監査 -----------------------------------------------------------

/** コピーした項目ごとに 1 行を監査に残す（値は記録しない。クライアントから送る。送れなくてもコピーは止めない）。 */
export const recordCopyAudit = async (ctx: OpsContext, planId: string, body: unknown): Promise<{ recorded: number }> => {
  const b = await loadBundle(ctx, planId);
  assertCan(ctx, "report.copyAudit", b.isSelf);
  const known = new Set(REPORT_FIELDS.fields.filter((f) => f.source !== "api_only" && FIELD_SOURCES.includes(f.source)).map((f) => f.key));
  const v = validateCopyAudit(asInput(body), known);
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors, v.codes);
  const cfg = resolveDipsAdapterConfig(ctx.env ?? process.env);
  const adapter: ReportChannel = cfg.ok ? cfg.adapter : "manual";
  const base = attemptBase(ctx, b.plan, REPORT_FIELDS.revision);
  await store.insertAttempts(
    ctx.db,
    v.data.keys.map((key) =>
      attemptRow(base, {
        operation: "copy",
        adapter,
        reportId: null,
        key: null,
        payloadHash: null,
        summary: `コピー：${key}（${fieldByKey(key)?.label ?? key}）`,
        result: "success",
      }),
    ),
  );
  return { recorded: v.data.keys.length };
};

/** 通報の行の版の履歴（訂正・取り下げ・確定の理由と、元の値）。 */
export const listReportVersions = async (ctx: OpsContext, planId: string, rid: string) => {
  assertCan(ctx, "report.read");
  await loadPlan(ctx, planId);
  const row = await loadRow(ctx, planId, rid);
  return listEntityVersions(ctx, "flight_report", row.id);
};

