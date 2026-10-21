// 計画の応答に載せる通報の状況・期限・次にやること（Sprint 12b 設計 E・G）。plans.ts（計画の DTO）と reports.ts（通報の API）が使う。
// 状態は保存せず、通報の行（flight_reports）・手続きの記録（plan_procedure_records）・コピーの監査から毎回導出する。
import type { PermitMatchResult } from "./permit-logic";
import type { PlanProcedureRecordRow } from "@soraban/db";
import {
  fingerprintPartsOf,
  PROCEDURE_RECORD_DONE_LABEL,
  PROCEDURE_RECORD_KIND_LABEL,
  PROCEDURE_RECORD_KINDS,
  PROCEDURE_RECORD_NONE_LABEL,
  PROCEDURE_RECORD_RETRACTED_LABEL,
  PROCEDURE_RECORD_STALE_LABEL,
  computeFingerprint,
  reportStatus,
  type FingerprintParts,
  type ProcedureRecordKind,
  type ReportRowLite,
  type ReportStatusResult,
  type RequirementKind,
} from "@soraban/dips";
import type { ReportRequirement } from "@soraban/regulations";
import { formatJst, toJstInput } from "@/lib/ops-time";
import { can } from "./authz";
import { reportDeadlineState, planNextActions, type DeadlineState, type NextAction, type ProcedureRecordLite } from "./report-logic";
import type { PlanState } from "./plan-logic";
import { asDate } from "./records";
import type { OpsContext } from "./service";
import * as store from "./store";
import type { PlanWithJoins, ReportRowWithTimes } from "./store";

export type ProcedureRecordRowWithTimes = PlanProcedureRecordRow & { readonly created_at_us: string; readonly done_at_jst: string | null };

/** 計画ごとの通報の導出に必要な、DB から読んだ値。 */
export type PlanReportExtras = {
  readonly rows: readonly ReportRowWithTimes[];
  readonly records: readonly ProcedureRecordRowWithTimes[];
  readonly copied: boolean;
};

const EMPTY: PlanReportExtras = { rows: [], records: [], copied: false };

/** 複数の計画の通報の行・手続きの記録・コピーの監査を、3 回のクエリでまとめて読む（一覧で遅くしない）。 */
export const loadReportExtras = async (ctx: OpsContext, planIds: readonly string[]): Promise<Map<string, PlanReportExtras>> => {
  const org = ctx.member.org_id;
  const [rows, records, copied] = await Promise.all([
    store.listReportsFor(ctx.db, org, planIds),
    store.listProcedureRecordsFor(ctx.db, org, planIds),
    store.plansCopiedSinceLastReport(ctx.db, org, planIds),
  ]);
  const by = new Map<string, { rows: ReportRowWithTimes[]; records: ProcedureRecordRowWithTimes[] }>();
  for (const id of planIds) by.set(id, { rows: [], records: [] });
  for (const r of rows) by.get(r.plan_id)?.rows.push(r);
  for (const r of records) by.get(r.plan_id)?.records.push(r);
  return new Map([...by].map(([id, v]) => [id, { rows: v.rows, records: v.records, copied: copied.has(id) }]));
};

export const emptyExtras = (): PlanReportExtras => EMPTY;

/** 通報の行 → 導出に使う列。並べ替えにはマイクロ秒つきの時刻を使う。 */
export const rowLite = (r: ReportRowWithTimes): ReportRowLite => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  channel: r.channel,
  createdAt: r.created_at_us,
  updatedAt: r.updated_at_us,
  fingerprint: r.fingerprint,
  reportedAt: r.reported_at_jst,
  dipsNumber: r.dips_number,
  numberUnavailable: r.number_unavailable,
});

/** 種別ごとの最新の手続きの記録。 */
export const latestProcedureRecords = (
  records: readonly ProcedureRecordRowWithTimes[],
): Partial<Record<ProcedureRecordKind, ProcedureRecordLite & { readonly id: string }>> => {
  const out: Partial<Record<ProcedureRecordKind, ProcedureRecordLite & { id: string }>> = {};
  const sorted = [...records].sort((a, b) => (a.created_at_us < b.created_at_us ? -1 : a.created_at_us > b.created_at_us ? 1 : a.id < b.id ? -1 : 1));
  for (const r of sorted) out[r.kind] = { id: r.id, action: r.action, snapshotId: r.snapshot_id };
  return out;
};

/** 現在の計画の指紋の元の値。判定の最終の flags はスナップショットの結果から。 */
export const currentFingerprintPartsOf = (r: PlanWithJoins): FingerprintParts =>
  fingerprintPartsOf({
    startAt: toJstInput(asDate(r.planned_start_at)),
    durationMinutes: r.duration_minutes,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    radiusM: r.radius_m,
    maxAltitudeM: r.max_altitude_m,
    aircraftId: r.aircraft_id,
    pilotId: r.pilot_id,
    snapshot: { flags: r.snapshot_result_slim.flags ?? [] },
  });

/** 現在の計画の指紋（通報時の指紋と比べる）。 */
export const currentFingerprintOf = (r: PlanWithJoins): string => computeFingerprint(currentFingerprintPartsOf(r));

/** 通報の要否の応答に足す、導出の状況と期限（ReportRequirement の項目はそのまま）。 */
export type PlanReportDto = ReportRequirement & {
  readonly status: ReportStatusResult;
  readonly deadline: DeadlineState;
};

export type PlanReportSummary = {
  readonly report: PlanReportDto;
  readonly nextActions: readonly NextAction[];
  readonly currentFingerprint: string;
};

export type SummarizeInput = {
  readonly ctx: OpsContext;
  readonly plan: PlanWithJoins;
  readonly isSelf: boolean;
  readonly planState: PlanState;
  readonly judgementStale: boolean;
  readonly requirement: ReportRequirement;
  readonly extras: PlanReportExtras;
  readonly now: Date;
  /** 許可・承認の登録の照合（Sprint 12d）。指定しないときは「許可・承認の結果を登録する」を出さない。 */
  readonly permits?: PermitMatchResult;
};

/** 要否・通報の行・手続きの記録・時刻から、通報の状況・期限・次にやることを導出する（保存した状態は読まない）。 */
export const summarizePlanReport = (i: SummarizeInput): PlanReportSummary => {
  const lites = i.extras.rows.map(rowLite);
  const currentFingerprint = currentFingerprintOf(i.plan);
  const voided = i.plan.voided_at !== null;
  const requirementKind = i.requirement.kind as RequirementKind;
  const status = reportStatus({ requirementKind, rows: lites, currentFingerprint, planVoided: voided, now: i.now });
  const start = asDate(i.plan.planned_start_at);
  const deadline = reportDeadlineState({
    requirementKind,
    hasEffective: status.effectiveId !== null,
    planVoided: voided,
    plannedStartAt: start,
    now: i.now,
  });
  const role = i.ctx.member.role;
  const nextActions = planNextActions({
    planId: i.plan.id,
    plannedStartAt: start,
    now: i.now,
    planState: i.planState,
    judgementStale: i.judgementStale,
    currentSnapshotId: i.plan.current_snapshot_id,
    requirementKind,
    requirementLabel: i.requirement.label,
    status,
    deadline,
    copiedWithoutRecord: i.extras.copied,
    procedures: (i.plan.snapshot_result_slim.verdict.procedures ?? []).map((p) => ({
      procedureId: p.procedureId,
      deadlineLabel: p.deadlineLabel,
      deadlineDate: p.deadlineDate,
    })),
    procedureRecords: latestProcedureRecords(i.extras.records),
    can: {
      update: can(role, "plan.update", { isSelf: i.isSelf }),
      confirm: can(role, "plan.confirm"),
      record: can(role, "report.record", { isSelf: i.isSelf }),
    },
    ...(i.permits
      ? { permits: { applied: i.permits.numbers.some((n) => n.status === "applied"), canRegister: can(role, "permit.create") } }
      : {}),
  });
  return { report: { ...i.requirement, status, deadline }, nextActions, currentFingerprint };
};

// ---- 手続きの「済み」の記録の応答 ------------------------------------

export type ProcedureRecordDto = {
  readonly id: string;
  readonly kind: ProcedureRecordKind;
  readonly kindLabel: string;
  readonly action: "done" | "retract";
  /** 表示：「申請済み（利用者の申告）」など。取り下げは「取り下げました」。 */
  readonly label: string;
  /** done の日時（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly doneAt: string | null;
  /** 表示用 `YYYY-MM-DD HH:MM`。 */
  readonly doneAtJst: string | null;
  readonly reference: string | null;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly snapshotId: string;
  readonly planVersion: number;
  /** 記録した時点の表示名の写し。 */
  readonly recordedByName: string;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly createdAtJst: string;
  /** 記録が、計画の現在のスナップショットに対するものか。 */
  readonly forCurrentSnapshot: boolean;
};

export type ProcedureRecordStatusCode = "none" | "done" | "stale" | "retracted";

/** 種別ごとの手続きの記録の要約（計画の詳細の「手続きの記録」の節）。 */
export type ProcedureRecordSummaryDto = {
  readonly kind: ProcedureRecordKind;
  readonly kindLabel: string;
  /** 現在のスナップショットの手続きに、この種別の手続きがあるか（無ければ記録の対象でない）。 */
  readonly applicable: boolean;
  /** none 記録なし／done 現在のスナップショットに対する有効な記録／stale 前の判定に対する記録／retracted 取り下げ。 */
  readonly status: ProcedureRecordStatusCode;
  readonly statusLabel: string;
  readonly latest: ProcedureRecordDto | null;
  /** スナップショットの手続きが持つ期限の文言（そのまま。新しい日付を作らない）。 */
  readonly deadlineLabel: string | null;
};

export const procedureRecordDto = (r: ProcedureRecordRowWithTimes, currentSnapshotId: string): ProcedureRecordDto => {
  const at = asDate(r.created_at);
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: PROCEDURE_RECORD_KIND_LABEL[r.kind],
    action: r.action,
    label: r.action === "done" ? PROCEDURE_RECORD_DONE_LABEL[r.kind] : PROCEDURE_RECORD_RETRACTED_LABEL,
    doneAt: r.done_at_jst,
    doneAtJst: r.done_at_jst ? r.done_at_jst.replace("T", " ") : null,
    reference: r.reference,
    checks: r.checks,
    snapshotId: r.snapshot_id,
    planVersion: r.plan_version,
    recordedByName: r.recorded_by_name,
    reason: r.reason,
    createdAt: at.toISOString(),
    createdAtJst: formatJst(at),
    forCurrentSnapshot: r.snapshot_id === currentSnapshotId,
  };
};

const PERMIT_ID = /^(flight-permission-|flight-approval-)/;

export const summarizeProcedureRecords = (
  records: readonly ProcedureRecordRowWithTimes[],
  plan: PlanWithJoins,
): ProcedureRecordSummaryDto[] => {
  const procs = plan.snapshot_result_slim.verdict.procedures ?? [];
  const applicable: Record<ProcedureRecordKind, readonly (typeof procs)[number][]> = {
    dips_permit: procs.filter((p) => PERMIT_ID.test(p.procedureId) && p.procedureId !== "flight-permission-emergency-airspace"),
    small_drone_law: procs.filter((p) => p.procedureId === "small-drone-law-consent-notice"),
  };
  return PROCEDURE_RECORD_KINDS.map((kind): ProcedureRecordSummaryDto => {
    const rows = records.filter((r) => r.kind === kind);
    const latestRow = [...rows].sort((a, b) => (a.created_at_us < b.created_at_us ? -1 : a.created_at_us > b.created_at_us ? 1 : a.id < b.id ? -1 : 1)).pop();
    const latest = latestRow ? procedureRecordDto(latestRow, plan.current_snapshot_id) : null;
    const status: ProcedureRecordStatusCode =
      latest === null ? "none" : latest.action === "retract" ? "retracted" : latest.forCurrentSnapshot ? "done" : "stale";
    const dated = applicable[kind].filter((p) => p.deadlineDate !== null).sort((a, b) => (a.deadlineDate! < b.deadlineDate! ? -1 : 1))[0];
    return {
      kind,
      kindLabel: PROCEDURE_RECORD_KIND_LABEL[kind],
      applicable: applicable[kind].length > 0,
      status,
      statusLabel:
        status === "done" ? latest!.label : status === "stale" ? PROCEDURE_RECORD_STALE_LABEL : status === "retracted" ? PROCEDURE_RECORD_RETRACTED_LABEL : PROCEDURE_RECORD_NONE_LABEL,
      latest,
      deadlineLabel: (dated ?? applicable[kind][0])?.deadlineLabel ?? null,
    };
  });
};
