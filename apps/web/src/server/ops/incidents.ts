// 事故・ヒヤリハットのサービス層（Sprint 12e 設計 B・C・D）。画面と API の両方がここを通る。
// 認可は authz.ts の can()、DB の読み書きは store.ts（org_id 必須）だけで行う。
//
//   listIncidents            GET  /api/ops/incidents                 一覧（?kind・?followUp・?planId・?reportState・?includeVoided=1）
//   createIncident           POST /api/ops/incidents                 作成（mode = full／quick。clientRequestId で二重を防ぐ）
//   getIncident              GET  /api/ops/incidents/[id]            詳細（事実・目安・報告の記録・報告の状態）
//   updateIncident           PATCH /api/ops/incidents/[id]           訂正（expectedVersion・reason 必須。目安を再計算する）
//   voidIncident             POST /api/ops/incidents/[id]/void       誤登録の取消（運航管理者のみ。理由必須。物理削除なし）
//   listIncidentVersions     GET  /api/ops/incidents/[id]/versions   版の履歴（ハッシュの連鎖と各版の内容）
//   createIncidentReport     POST /api/ops/incidents/[id]/reports    国への報告の記録（reported／consulted／retract。利用者の申告）
//   listPlanIncidents        GET  /api/ops/plans/[id]/incidents      その計画に結び付いた記録の要約
//   listFlightIncidents      GET  /api/ops/flights/[id]/incidents    その日誌（飛行記録）に結び付いた記録の要約
//   incidentTodayActions     「今日」の次にやること（報告の要否を確認する・詳細を記入する）
//
// 守ること：
//   - そらばんは国・DIPS へ何も送信しない（外部への通信をしない）。報告の記録は利用者の申告。
//   - 目安・スナップショット・detail_pending・source・記録者・指紋は、サーバー（と DB）が決める。リクエストの値は読まない。
//   - 個人を特定する情報は持たない（操縦者は ID だけを持ち、氏名は表示のたびに引く）。
import { createHash, randomUUID } from "node:crypto";
import type { MemberRoleDb } from "@soraban/db";
import { checkFieldTime } from "@/lib/ops-field";
import {
  eventTypeLabel,
  GUIDANCE_STATUS_LABEL,
  INCIDENT_CHANGED_SINCE_REPORT,
  INCIDENT_CONTACT_LABEL,
  INCIDENT_DETAIL_PENDING_LABEL,
  INCIDENT_DETAIL_DUE_DAYS,
  INCIDENT_DETAIL_PENDING_MARK,
  INCIDENT_EVENT_TYPE_NOTICE,
  INCIDENT_FACT_NOTICE,
  INCIDENT_FOLLOW_UP_LABEL,
  INCIDENT_GUIDANCE_LABEL,
  INCIDENT_GUIDANCE_REVISION,
  INCIDENT_KIND_LABEL,
  INCIDENT_KIND_NOTICE,
  INCIDENT_KINDS,
  INCIDENT_OFFICIAL_PROCEDURE_NOTICE,
  INCIDENT_PERSONAL_INFO_NOTICE,
  INCIDENT_PHASE_LABEL,
  INCIDENT_REPORT_ACTION_LABEL,
  INCIDENT_REPORT_CHANNEL_LABEL,
  INCIDENT_REPORT_RECORD_NOTICE,
  INCIDENT_REPORT_STATE_LABEL,
  INCIDENT_SAFETY_FIRST,
  INCIDENT_SOURCE_LABEL,
  INCIDENT_FOLLOW_UPS,
  INCIDENT_VOIDED_LABEL,
  incidentGuidance,
  incidentGuidanceNote,
  guidanceTextOf,
  incidentNewHref,
  incidentQuickHref,
  YES_NO_UNKNOWN_LABEL,
  type IncidentContact,
  type IncidentFollowUp,
  type IncidentGuidanceLevel,
  type IncidentKind,
  type IncidentPhase,
  type IncidentReportAction,
  type IncidentReportChannel,
  type IncidentReportStateCode,
  type IncidentSource,
  type YesNoUnknown,
} from "@/lib/ops-incident";
import { jstDate } from "@/lib/ops-time";
import { can, type OpsAction } from "./authz";
import {
  INCIDENT_FIELD_LABELS,
  INCIDENT_FIELDS,
  incidentFactsSource,
  incidentNextActions,
  incidentReportState,
  validateIncident,
  validateIncidentCorrection,
  validateIncidentReport,
  type IncidentData,
  type IncidentFacts,
  type IncidentMode,
  type IncidentReportState,
} from "./incident-logic";
import { asDate, fieldError, invalid, nowOf, pickFields } from "./records";
import { asInput, assertCan, formatJstMinute, isUuid, type OpsContext, type VersionDto } from "./service";
import * as store from "./store";
import { OpsError, type IncidentReportRowWithTimes, type IncidentRowWithJoins } from "./store";
import type { TodayNextAction } from "./today-logic";
import { validateChangeMeta } from "./validate";
import { parseClientRequestId } from "./validate-records";

const MINUTE_MS = 60_000;
/** 未来の許容（分）。12c の現場の記録と同じ。 */
const FUTURE_TOLERANCE_MIN = 5;

// ---- 固定の文言（画面・API の応答に常に添える） ---------------------------------------------

export type IncidentNoticesDto = {
  /** G1：最初の案内（入力画面の最上部）。 */
  readonly safetyFirst: string;
  /** N1：事実の記録の注意（全画面）。 */
  readonly fact: string;
  /** N2：公式の手続き。 */
  readonly officialProcedure: string;
  /** N3：報告の記録は利用者の申告。 */
  readonly reportRecord: string;
  /** N4：目安の注意（出典・照合の状態はいまの版から）。 */
  readonly guidance: string;
  /** N5：個人情報を書かない。 */
  readonly personalInfo: string;
  /** N6：区分は法令上の区分ではない。 */
  readonly kind: string;
  /** N7：類型の選び方。 */
  readonly eventType: string;
};

export const incidentNotices = (revision: number = INCIDENT_GUIDANCE_REVISION): IncidentNoticesDto => ({
  safetyFirst: INCIDENT_SAFETY_FIRST,
  fact: INCIDENT_FACT_NOTICE,
  officialProcedure: INCIDENT_OFFICIAL_PROCEDURE_NOTICE,
  reportRecord: INCIDENT_REPORT_RECORD_NOTICE,
  guidance: incidentGuidanceNote(revision),
  personalInfo: INCIDENT_PERSONAL_INFO_NOTICE,
  kind: INCIDENT_KIND_NOTICE,
  eventType: INCIDENT_EVENT_TYPE_NOTICE,
});

// ---- DTO -----------------------------------------------------------------------------------

export type IncidentGuidanceDto = {
  readonly level: IncidentGuidanceLevel;
  /** 短い表示と記号（色だけで区別しない）。 */
  readonly label: string;
  readonly mark: string;
  /** 目安の案内の文（保存した版のデータから）。 */
  readonly text: string;
  /** N4（保存した版の出典・状態つき）。 */
  readonly note: string;
  /** 保存した類型のデータの版・出典・状態（当時の根拠）。 */
  readonly revision: number;
  readonly source: string;
  readonly status: "confirmed" | "unconfirmed";
  readonly statusLabel: string;
  /** possible に倒した類型（unknown を含む）。 */
  readonly reasons: readonly { readonly key: string; readonly label: string }[];
};

export type IncidentReportStateDto = {
  readonly code: IncidentReportStateCode;
  readonly label: string;
  readonly mark: string;
  /** 報告・確認の記録のあとで事実（類型・区分・けがの有無・人数）が変わった。 */
  readonly changedSinceReport: boolean;
  readonly changedLabel: string | null;
  /** 有効な（取り下げられていない）報告・確認の記録の数。 */
  readonly activeCount: number;
};

export type IncidentDto = {
  readonly id: string;
  readonly kind: IncidentKind;
  readonly kindLabel: string;
  /** 起きた日時（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly occurredAt: string;
  /** 表示用 `YYYY-MM-DD HH:MM`。 */
  readonly occurredAtJst: string;
  readonly occurredDate: string;
  readonly phase: IncidentPhase | null;
  readonly phaseLabel: string | null;
  readonly placeName: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly planId: string | null;
  readonly planTitle: string | null;
  readonly snapshotId: string | null;
  readonly snapshotSeq: number | null;
  readonly flightRecordId: string | null;
  readonly aircraftId: string | null;
  readonly registrationMark: string | null;
  readonly pilotId: string | null;
  /** 操縦者の氏名（表示のたびに引く。記録には写しを持たない）。 */
  readonly pilotName: string | null;
  /** 保存した版の名称で読む。 */
  readonly eventTypes: readonly { readonly key: string; readonly label: string }[];
  readonly peopleInjury: YesNoUnknown;
  readonly peopleInjuryLabel: string;
  readonly aircraftDamage: YesNoUnknown;
  readonly aircraftDamageLabel: string;
  readonly injuredCount: number | null;
  readonly contactsMade: readonly { readonly key: IncidentContact; readonly label: string }[];
  readonly summary: string | null;
  readonly details: string | null;
  readonly factorsNote: string | null;
  readonly actionsTaken: string | null;
  readonly preventionNote: string | null;
  readonly detailPending: boolean;
  /** 簡易記録の印（detailPending のとき）。 */
  readonly detailPendingLabel: string | null;
  readonly detailPendingMark: string | null;
  readonly source: IncidentSource;
  readonly sourceLabel: string;
  readonly followUpStatus: IncidentFollowUp;
  readonly followUpLabel: string;
  readonly followUpOn: string | null;
  readonly guidance: IncidentGuidanceDto;
  readonly reportState: IncidentReportStateDto;
  readonly version: number;
  readonly voided: boolean;
  readonly voidedLabel: string | null;
  readonly voidedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdByMemberId: string | null;
  readonly createdByName: string | null;
  /** 要求した利用者の自分の分（記録を作った本人か、記録の操縦者が自分）。 */
  readonly isSelf: boolean;
  readonly canUpdate: boolean;
  readonly canReport: boolean;
  readonly canVoid: boolean;
};

export type IncidentReportRecordDto = {
  readonly id: string;
  readonly action: IncidentReportAction;
  readonly actionLabel: string;
  /** 報告した・確かめた日時（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly doneAt: string | null;
  readonly doneAtJst: string | null;
  readonly channel: IncidentReportChannel | null;
  readonly channelLabel: string | null;
  readonly channelNote: string | null;
  readonly reference: string | null;
  readonly referenceAbsent: boolean;
  readonly note: string | null;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly targetRecordId: string | null;
  /** 記録した時点の記録の版。 */
  readonly incidentVersion: number;
  readonly factsFingerprint: string;
  readonly reason: string | null;
  readonly recordedByMemberId: string;
  /** その時点の表示名・役割の写し（DB が決める）。 */
  readonly recordedByName: string;
  readonly recordedByRole: MemberRoleDb;
  readonly createdAt: string;
  readonly contentHash: string;
  /** 取り下げられた（取り下げの行が指している）。 */
  readonly retracted: boolean;
  /** 有効な報告・確認の記録（取り下げられていない reported・consulted）。 */
  readonly active: boolean;
  /** 「利用者の申告」の注記（N3）。 */
  readonly declaration: string;
};

export type IncidentDetailDto = IncidentDto & {
  readonly reportRecords: readonly IncidentReportRecordDto[];
  readonly notices: IncidentNoticesDto;
};

export type IncidentContentDto = {
  readonly kind: IncidentKind;
  readonly kindLabel: string;
  readonly occurredAt: string;
  readonly eventTypes: readonly { readonly key: string; readonly label: string }[];
  readonly peopleInjury: string;
  readonly aircraftDamage: string;
  readonly injuredCount: number | null;
  readonly summary: string | null;
  readonly details: string | null;
  readonly factorsNote: string | null;
  readonly actionsTaken: string | null;
  readonly preventionNote: string | null;
  readonly detailPending: boolean;
  readonly followUpStatus: string;
  readonly followUpOn: string | null;
  readonly planId: string | null;
  readonly snapshotId: string | null;
  readonly flightRecordId: string | null;
  readonly aircraftId: string | null;
  readonly pilotId: string | null;
  readonly guidanceLevel: string;
  readonly guidanceRevision: number;
};

export type IncidentVersionDto = VersionDto & {
  readonly contentHash: string;
  readonly prevHash: string;
  /** その版の内容（類型の名称はその版の目安の版で読む）。 */
  readonly content: IncidentContentDto;
};

// ---- 変換 ----------------------------------------------------------------------------------

const isoOf = (v: unknown): string => asDate(v).toISOString();
const numOf = (v: string | number | null): number | null => (v === null ? null : Number(v));

/** 報告の記録の指紋（事象の類型・区分・けがの有無・人数）。 */
export const incidentFingerprint = (f: IncidentFacts): string => createHash("sha256").update(incidentFactsSource(f), "utf8").digest("hex");

const factsOfRow = (r: IncidentRowWithJoins): IncidentFacts => ({
  kind: r.kind,
  event_types: r.event_types,
  people_injury: r.people_injury,
  injured_count: r.injured_count,
});

const reportLite = (rows: readonly IncidentReportRowWithTimes[]) =>
  rows.map((x) => ({ id: x.id, action: x.action, targetRecordId: x.target_record_id, factsFingerprint: x.facts_fingerprint }));

const stateOf = (r: IncidentRowWithJoins, reports: readonly IncidentReportRowWithTimes[]): IncidentReportState =>
  incidentReportState(reportLite(reports), incidentFingerprint(factsOfRow(r)));

const isSelfOf = (ctx: OpsContext, r: IncidentRowWithJoins): boolean =>
  r.created_by_member_id === ctx.member.id || (r.pilot_member_id !== null && r.pilot_member_id === ctx.member.id);

/** 目安の表示。目安の値は保存した値（当時の計算）を使い、文・出典・状態は保存した版のデータから出す。 */
const guidanceDto = (r: Pick<IncidentRowWithJoins, "event_types" | "guidance_revision" | "guidance_level">): IncidentGuidanceDto => {
  const g = incidentGuidance(r.event_types, r.guidance_revision);
  const level = r.guidance_level;
  return {
    level,
    label: INCIDENT_GUIDANCE_LABEL[level].label,
    mark: INCIDENT_GUIDANCE_LABEL[level].mark,
    text: guidanceTextOf(level, g.revision),
    note: incidentGuidanceNote(g.revision),
    revision: g.revision,
    source: g.source,
    status: g.status,
    statusLabel: GUIDANCE_STATUS_LABEL[g.status],
    reasons: g.reasons.map((key) => ({ key, label: eventTypeLabel(key, g.revision) })),
  };
};

const reportStateDto = (s: IncidentReportState): IncidentReportStateDto => ({
  code: s.code,
  label: INCIDENT_REPORT_STATE_LABEL[s.code].label,
  mark: INCIDENT_REPORT_STATE_LABEL[s.code].mark,
  changedSinceReport: s.changedSinceReport,
  changedLabel: s.changedSinceReport ? INCIDENT_CHANGED_SINCE_REPORT : null,
  activeCount: s.activeIds.length,
});

export const incidentDto = (ctx: OpsContext, r: IncidentRowWithJoins, reports: readonly IncidentReportRowWithTimes[]): IncidentDto => {
  const isSelf = isSelfOf(ctx, r);
  const voided = r.voided_at !== null;
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: INCIDENT_KIND_LABEL[r.kind],
    occurredAt: r.occurred_at_jst,
    occurredAtJst: r.occurred_at_jst.replace("T", " "),
    occurredDate: r.occurred_at_jst.slice(0, 10),
    phase: r.phase,
    phaseLabel: r.phase ? INCIDENT_PHASE_LABEL[r.phase] : null,
    placeName: r.place_name,
    latitude: numOf(r.latitude),
    longitude: numOf(r.longitude),
    planId: r.plan_id,
    planTitle: r.plan_title,
    snapshotId: r.snapshot_id,
    snapshotSeq: r.snapshot_seq,
    flightRecordId: r.flight_record_id,
    aircraftId: r.aircraft_id,
    registrationMark: r.registration_mark,
    pilotId: r.pilot_id,
    pilotName: r.pilot_name,
    eventTypes: r.event_types.map((key) => ({ key, label: eventTypeLabel(key, r.guidance_revision) })),
    peopleInjury: r.people_injury,
    peopleInjuryLabel: YES_NO_UNKNOWN_LABEL[r.people_injury],
    aircraftDamage: r.aircraft_damage,
    aircraftDamageLabel: YES_NO_UNKNOWN_LABEL[r.aircraft_damage],
    injuredCount: r.injured_count,
    contactsMade: r.contacts_made.map((key) => ({ key, label: INCIDENT_CONTACT_LABEL[key] })),
    summary: r.summary,
    details: r.details,
    factorsNote: r.factors_note,
    actionsTaken: r.actions_taken,
    preventionNote: r.prevention_note,
    detailPending: r.detail_pending,
    detailPendingLabel: r.detail_pending ? INCIDENT_DETAIL_PENDING_LABEL : null,
    detailPendingMark: r.detail_pending ? INCIDENT_DETAIL_PENDING_MARK : null,
    source: r.source,
    sourceLabel: INCIDENT_SOURCE_LABEL[r.source],
    followUpStatus: r.follow_up_status,
    followUpLabel: INCIDENT_FOLLOW_UP_LABEL[r.follow_up_status],
    followUpOn: r.follow_up_on,
    guidance: guidanceDto(r),
    reportState: reportStateDto(stateOf(r, reports)),
    version: r.current_version,
    voided,
    voidedLabel: voided ? INCIDENT_VOIDED_LABEL : null,
    voidedAt: r.voided_at === null ? null : isoOf(r.voided_at),
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
    createdByMemberId: r.created_by_member_id,
    createdByName: r.created_by_name,
    isSelf,
    canUpdate: !voided && can(ctx.member.role, "incident.update", { isSelf }),
    canReport: !voided && can(ctx.member.role, "incident.report", { isSelf }),
    canVoid: !voided && can(ctx.member.role, "incident.void", { isSelf }),
  };
};

const reportRecordDto = (x: IncidentReportRowWithTimes, retracted: ReadonlySet<string>): IncidentReportRecordDto => ({
  id: x.id,
  action: x.action,
  actionLabel: INCIDENT_REPORT_ACTION_LABEL[x.action],
  doneAt: x.done_at_jst,
  doneAtJst: x.done_at_jst ? x.done_at_jst.replace("T", " ") : null,
  channel: x.channel,
  channelLabel: x.channel ? INCIDENT_REPORT_CHANNEL_LABEL[x.channel] : null,
  channelNote: x.channel_note,
  reference: x.reference,
  referenceAbsent: x.reference_absent,
  note: x.note,
  checks: x.checks,
  targetRecordId: x.target_record_id,
  incidentVersion: x.incident_version,
  factsFingerprint: x.facts_fingerprint,
  reason: x.reason,
  recordedByMemberId: x.recorded_by_member_id,
  recordedByName: x.recorded_by_name,
  recordedByRole: x.recorded_by_role,
  createdAt: isoOf(x.created_at),
  contentHash: x.content_hash,
  retracted: retracted.has(x.id),
  active: (x.action === "reported" || x.action === "consulted") && !retracted.has(x.id),
  declaration: INCIDENT_REPORT_RECORD_NOTICE,
});

const groupReports = (rows: readonly IncidentReportRowWithTimes[]): Map<string, IncidentReportRowWithTimes[]> => {
  const by = new Map<string, IncidentReportRowWithTimes[]>();
  for (const x of rows) by.set(x.incident_id, [...(by.get(x.incident_id) ?? []), x]);
  return by;
};

// ---- 一覧・詳細 ------------------------------------------------------------------------------

export type IncidentListFilter = {
  readonly includeVoided?: boolean;
  readonly kind?: IncidentKind;
  readonly followUp?: IncidentFollowUp;
  readonly planId?: string;
  /** 報告の状態（導出）：none・reported・consulted、または changed（記録のあとで事実が変わった）。 */
  readonly reportState?: IncidentReportStateCode | "changed";
  /** 現場の簡易記録で詳細が未記入のものだけ。 */
  readonly detailPending?: boolean;
};

const REPORT_STATE_FILTERS = ["none", "reported", "consulted", "changed"] as const;

/** 一覧の絞り込み（クエリ）を読む。 */
export const parseIncidentFilter = (q: URLSearchParams): IncidentListFilter => {
  const kind = q.get("kind");
  if (kind && !(INCIDENT_KINDS as readonly string[]).includes(kind)) fieldError("kind", "unknown_value", `区分は ${INCIDENT_KINDS.join("・")} のいずれかです`);
  const followUp = q.get("followUp");
  if (followUp && !(INCIDENT_FOLLOW_UPS as readonly string[]).includes(followUp)) fieldError("followUp", "unknown_value", "対応の状況は open・done のいずれかです");
  const planId = q.get("planId");
  if (planId && !isUuid(planId)) fieldError("planId", "invalid", "計画の ID が正しくありません");
  const reportState = q.get("reportState");
  if (reportState && !(REPORT_STATE_FILTERS as readonly string[]).includes(reportState)) {
    fieldError("reportState", "unknown_value", `報告の状態は ${REPORT_STATE_FILTERS.join("・")} のいずれかです`);
  }
  return {
    ...(q.get("includeVoided") === "1" ? { includeVoided: true } : {}),
    ...(kind ? { kind: kind as IncidentKind } : {}),
    ...(followUp ? { followUp: followUp as IncidentFollowUp } : {}),
    ...(planId ? { planId: planId.toLowerCase() } : {}),
    ...(reportState ? { reportState: reportState as IncidentListFilter["reportState"] } : {}),
    ...(q.get("detailPending") === "1" ? { detailPending: true } : {}),
  };
};

/** 行と報告の記録をまとめて引いて DTO にする（クエリは 2 回。記録の件数に依らない）。 */
const loadDtos = async (ctx: OpsContext, rows: readonly IncidentRowWithJoins[]): Promise<IncidentDto[]> => {
  const reports = groupReports(await store.listIncidentReportRecordsFor(ctx.db, ctx.member.org_id, rows.map((r) => r.id)));
  return rows.map((r) => incidentDto(ctx, r, reports.get(r.id) ?? []));
};

export const listIncidents = async (ctx: OpsContext, filter: IncidentListFilter = {}): Promise<IncidentDto[]> => {
  assertCan(ctx, "incident.read");
  const rows = await store.listIncidents(ctx.db, ctx.member.org_id, {
    ...(filter.includeVoided ? { includeVoided: true } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.followUp ? { followUp: filter.followUp } : {}),
    ...(filter.planId ? { planId: filter.planId } : {}),
    // 導出の絞り込みも上限（LIMIT 500）の前に SQL でかける（古い一致する記録が漏れない）
    ...(filter.reportState ? { reportState: filter.reportState } : {}),
    ...(filter.detailPending ? { detailPending: true } : {}),
  });
  // 表示の導出（報告の記録から）との一致を確かめる。SQL の絞り込みと同じ結果になる（食い違えば表示側が正）
  let out = await loadDtos(ctx, rows);
  if (filter.reportState === "changed") out = out.filter((d) => d.reportState.changedSinceReport);
  else if (filter.reportState) out = out.filter((d) => d.reportState.code === filter.reportState);
  return out;
};

const loadIncident = async (ctx: OpsContext, id: string): Promise<IncidentRowWithJoins> => {
  const r = isUuid(id) ? await store.getIncident(ctx.db, ctx.member.org_id, id.toLowerCase()) : null;
  if (!r) throw new OpsError(404, "not_found");
  return r;
};

export const getIncident = async (ctx: OpsContext, id: string): Promise<IncidentDetailDto> => {
  assertCan(ctx, "incident.read");
  const r = await loadIncident(ctx, id);
  const reports = await store.listIncidentReportRecordsFor(ctx.db, ctx.member.org_id, [r.id]);
  const retracted = new Set(reports.filter((x) => x.action === "retract" && x.target_record_id).map((x) => x.target_record_id!));
  return {
    ...incidentDto(ctx, r, reports),
    reportRecords: reports.map((x) => reportRecordDto(x, retracted)),
    notices: incidentNotices(),
  };
};

// ---- 版の履歴 --------------------------------------------------------------------------------

const contentOfData = (d: Readonly<Record<string, unknown>>): IncidentContentDto => {
  const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const revision = typeof d["guidance_revision"] === "number" ? d["guidance_revision"] : INCIDENT_GUIDANCE_REVISION;
  const kind = (INCIDENT_KINDS as readonly string[]).includes(String(d["kind"])) ? (d["kind"] as IncidentKind) : "undetermined";
  const types = Array.isArray(d["event_types"]) ? (d["event_types"] as string[]) : [];
  return {
    kind,
    kindLabel: INCIDENT_KIND_LABEL[kind],
    occurredAt: s(d["occurred_at"]) ?? "",
    eventTypes: types.map((key) => ({ key, label: eventTypeLabel(key, revision) })),
    peopleInjury: s(d["people_injury"]) ?? "",
    aircraftDamage: s(d["aircraft_damage"]) ?? "",
    injuredCount: typeof d["injured_count"] === "number" ? d["injured_count"] : null,
    summary: s(d["summary"]),
    details: s(d["details"]),
    factorsNote: s(d["factors_note"]),
    actionsTaken: s(d["actions_taken"]),
    preventionNote: s(d["prevention_note"]),
    detailPending: d["detail_pending"] === true,
    followUpStatus: s(d["follow_up_status"]) ?? "open",
    followUpOn: s(d["follow_up_on"]),
    planId: s(d["plan_id"]),
    snapshotId: s(d["snapshot_id"]),
    flightRecordId: s(d["flight_record_id"]),
    aircraftId: s(d["aircraft_id"]),
    pilotId: s(d["pilot_id"]),
    guidanceLevel: s(d["guidance_level"]) ?? "",
    guidanceRevision: revision,
  };
};

/** 版の履歴（ハッシュの連鎖と、各版の内容つき）。他の組織・存在しない記録は 404。 */
export const listIncidentVersions = async (ctx: OpsContext, id: string): Promise<IncidentVersionDto[]> => {
  assertCan(ctx, "incident.read");
  const r = await loadIncident(ctx, id);
  const rows = await store.listVersions(ctx.db, ctx.member.org_id, "incident_record", r.id);
  if (rows.length === 0) throw new OpsError(404, "not_found");
  return rows.map((v, i) => {
    const created = asDate(v.created_at);
    const prev = i > 0 ? rows[i - 1]!.data : null;
    const changed =
      prev && v.op === "update"
        ? Object.keys({ ...prev, ...v.data }).filter((k) => k !== REQUEST_INTENT_KEY && JSON.stringify(prev[k] ?? null) !== JSON.stringify(v.data[k] ?? null))
        : [];
    return {
      versionNo: v.version_no,
      op: v.op,
      actorName: v.actor_kind === "system" ? "システム" : (v.actor_display_name ?? "（不明）"),
      createdAt: created.toISOString(),
      createdAtJst: formatJstMinute(created),
      reason: v.reason,
      changedFields: changed.map((k) => INCIDENT_FIELD_LABELS[k] ?? k),
      contentHash: v.content_hash,
      prevHash: v.prev_hash,
      content: contentOfData(v.data),
    };
  });
};

// ---- 書き込み --------------------------------------------------------------------------------

/** clientRequestId から、組織ごとに決まる記録の ID を作る（同じ ID の作成は版が重複するため、二重の登録を防げる）。 */
const idFromRequest = (orgId: string, requestId: string): string => {
  const h = createHash("sha256").update(`incident_record:${orgId}:${requestId}`).digest("hex");
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** 計画・日誌から引き継ぐ項目（入力が空のときだけ埋める）。 */
const INHERITED = ["plan_id", "aircraft_id", "pilot_id", "place_name", "latitude", "longitude"] as const;

/**
 * 計画・日誌（飛行記録）・機体・操縦者を確かめ、空の項目を引き継ぐ。他の組織の行は 404。
 * 計画があれば機体・操縦者・場所を、日誌があれば計画・機体・操縦者・離陸の場所を引き継ぐ。計画と日誌の計画が違えば 400。
 */
const resolveLinks = async (ctx: OpsContext, d: IncidentData): Promise<IncidentData> => {
  const org = ctx.member.org_id;
  let out: IncidentData = d;
  if (d.flight_record_id) {
    const f = await store.getFlight(ctx.db, org, d.flight_record_id);
    if (!f) throw new OpsError(404, "not_found");
    if (out.plan_id && f.flight_plan_id !== out.plan_id) fieldError("flightRecordId", "plan_mismatch", "日誌の計画と、飛行計画が違います");
    out = {
      ...out,
      plan_id: out.plan_id ?? f.flight_plan_id,
      aircraft_id: out.aircraft_id ?? f.aircraft_id,
      pilot_id: out.pilot_id ?? f.pilot_id,
      place_name: out.place_name ?? (f.takeoff_place ? f.takeoff_place.slice(0, 100) : null),
    };
  }
  if (out.plan_id) {
    const p = await store.getPlan(ctx.db, org, out.plan_id);
    if (!p) throw new OpsError(404, "not_found");
    const hasPos = out.latitude !== null;
    out = {
      ...out,
      aircraft_id: out.aircraft_id ?? p.aircraft_id,
      pilot_id: out.pilot_id ?? p.pilot_id,
      place_name: out.place_name ?? (p.place_name ? p.place_name.slice(0, 100) : null),
      latitude: hasPos ? out.latitude : numOf(p.latitude as unknown as string),
      longitude: hasPos ? out.longitude : numOf(p.longitude as unknown as string),
    };
  }
  if (out.aircraft_id && (await store.listAircraftMarks(ctx.db, org, [out.aircraft_id])).length === 0) throw new OpsError(404, "not_found");
  if (out.pilot_id && (await store.listPilotNames(ctx.db, org, [out.pilot_id])).length === 0) throw new OpsError(404, "not_found");
  return out;
};

/** 時刻の検査（12c の規則を再利用）。full：未来 5 分超だけ。quick：その場の送信は ±5 分、送信待ちは 72 時間まで。 */
const checkTime = (ctx: OpsContext, mode: IncidentMode, at: Date, queued: boolean): void => {
  const now = nowOf(ctx);
  if (mode === "quick") {
    const tc = checkFieldTime(at, now, queued);
    if (!tc.ok) throw new OpsError(400, tc.code, { occurredAt: "起きた日時を確かめてください" }, { occurredAt: tc.code });
    return;
  }
  if ((at.getTime() - now.getTime()) / MINUTE_MS > FUTURE_TOLERANCE_MIN) {
    throw new OpsError(400, "future_time", { occurredAt: "起きた日時が現在より先です" }, { occurredAt: "future_time" });
  }
};

/**
 * サーバーが決める項目を足した版の data。snapshot_id は DB が決める（送った値は使われない）。
 * 目安は revision（既定は現在の版。訂正で類型を変えないときは保存済みの版）のデータで計算する。
 */
const versionData = (
  d: IncidentData,
  extra: { readonly clientRequestId: string | null; readonly source: string },
  revision: number = INCIDENT_GUIDANCE_REVISION,
): Record<string, unknown> => {
  const g = incidentGuidance(d.event_types, revision);
  return {
    ...d,
    source: extra.source,
    snapshot_id: null,
    guidance_level: g.level,
    guidance_revision: g.revision,
    client_request_id: extra.clientRequestId,
  };
};

/** 引き継ぐ項目の、版の data のキー → API の入力のキー。 */
const INHERITED_INPUT: Readonly<Record<(typeof INHERITED)[number], string>> = {
  plan_id: "planId",
  aircraft_id: "aircraftId",
  pilot_id: "pilotId",
  place_name: "placeName",
  latitude: "latitude",
  longitude: "longitude",
};

/** 引き継ぐ項目の、最初の要求の意図：省略（引き継ぎ待ち）・明示的に空（null・空文字）・値あり。 */
type InheritedIntent = "omitted" | "null" | "value";
/** 最初の版の data に残す、要求の意図（引き継ぎ先の計画などが後で変わっても、再送との比較に使える）。 */
export const REQUEST_INTENT_KEY = "client_request_intent";

/**
 * 要求の意図を正規化する。入力で省略した（undefined。簡易記録が読まない項目を含む）なら omitted、
 * 検査後に空なら null（明示的に空）、値があれば value。キーごとの対応なので、入力の順序に依らない。
 */
const requestIntent = (d: IncidentData, raw: Readonly<Record<string, unknown>>, mode: IncidentMode): Record<string, InheritedIntent> => {
  const out: Record<string, InheritedIntent> = {};
  for (const k of INHERITED) {
    const omitted = raw[INHERITED_INPUT[k]] === undefined || (mode === "quick" && k !== "plan_id");
    out[k] = omitted ? "omitted" : d[k] === null ? "null" : "value";
  }
  return out;
};

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * 同じ clientRequestId の再送が、最初の作成と同じ内容か（作成者も同じであること）。比べるのは最初の要求の意図で、
 * 計画などから引き継いだ現在の値を再び解決して比べない（最初の応答が失われたあとに計画が更新されても、同じ本文の再送は成功する）。
 * 引き継ぐ項目は、再送の側が：
 *   - 省略 → 引き継ぎ待ちとして比べない。
 *   - 明示的に空 → 最初の要求が値を明示していたら内容が違う（消した）。最初が省略・空なら同じ。
 *   - 値あり → 最初に保存した値と比べる（引き継ぎで入った値と同じでも同じ要求）。
 * 最初の版に意図が残っていない記録（この修正より前・seed）は、空の項目を比べない。
 */
const sameRequest = (
  ctx: OpsContext,
  first: { data: Record<string, unknown>; actor_member_id: string | null },
  d: IncidentData,
  raw: Readonly<Record<string, unknown>>,
  mode: IncidentMode,
): boolean => {
  if (first.actor_member_id !== ctx.member.id) return false;
  const stored = first.data[REQUEST_INTENT_KEY];
  const firstIntent = stored !== null && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const again = requestIntent(d, raw, mode);
  for (const [k, v] of Object.entries(d)) {
    if ((INHERITED as readonly string[]).includes(k)) {
      const intent = again[k]!;
      if (intent === "omitted") continue;
      if (intent === "null") {
        if (firstIntent[k] === "value") return false;
        continue;
      }
    }
    if (!sameValue(first.data[k], v)) return false;
  }
  return true;
};

export type IncidentSaveResult = { readonly created: boolean; readonly record: IncidentDetailDto };

/**
 * 作成。mode = full（事務所）／quick（現場の簡易記録）。運航管理者と操縦者（誰の飛行でも）。閲覧者は 403。
 * 同じ clientRequestId の再送は、内容が同じなら新しい行を作らず既存を返し（created=false → 200）、内容が違えば 409 request_conflict。
 */
export const createIncident = async (ctx: OpsContext, body: unknown): Promise<IncidentSaveResult> => {
  assertCan(ctx, "incident.create");
  const input = asInput(body);
  const modeRaw = input["mode"] ?? "full";
  if (modeRaw !== "full" && modeRaw !== "quick") fieldError("mode", "unknown_value", "mode は full・quick のいずれかです");
  const mode = modeRaw as IncidentMode;
  const req = parseClientRequestId(input["clientRequestId"]);
  // 作成では detailPending を読まない（簡易記録だけが詳細の未記入を作る）
  const { detailPending: _ignored, ...rest } = input as Record<string, unknown>;
  void _ignored;
  const v = validateIncident(rest, mode);
  const reqErr = !req.ok
    ? { errors: { clientRequestId: "送信の識別子が正しくありません" }, codes: { clientRequestId: "invalid" } }
    : mode === "quick" && req.value === null
      ? { errors: { clientRequestId: "送信の識別子（clientRequestId）が必要です" }, codes: { clientRequestId: "required" } }
      : undefined;
  if (!v.ok || reqErr) return invalid(v, reqErr);
  const requestId = req.ok ? req.value : null;
  const id = requestId ? idFromRequest(ctx.member.org_id, requestId) : randomUUID();

  // 再送：同じ内容なら既存を返す（時刻の検査より先。送信待ちの再送が古くなっても、記録済みなら成功として返す）
  if (requestId) {
    const first = await store.firstVersionOf(ctx.db, ctx.member.org_id, "incident_record", id);
    if (first) {
      if (!sameRequest(ctx, first, v.data, rest, mode)) throw new OpsError(409, "request_conflict");
      return { created: false, record: await getIncident(ctx, id) };
    }
  }
  checkTime(ctx, mode, v.occurredAtDate, v.queued);
  const data = await resolveLinks(ctx, v.data);
  try {
    await store.appendVersion(ctx.db, {
      orgId: ctx.member.org_id,
      entityType: "incident_record",
      entityId: id,
      op: "create",
      data: { ...versionData(data, { clientRequestId: requestId, source: data.source }), [REQUEST_INTENT_KEY]: requestIntent(v.data, rest, mode) },
      reason: null,
      actorMemberId: ctx.member.id,
    });
  } catch (e) {
    // 並行の再送：先に作られた記録と比べる
    if (e instanceof OpsError && (e.code === "already_exists" || e.code === "duplicate_request") && requestId) {
      const first = await store.firstVersionOf(ctx.db, ctx.member.org_id, "incident_record", id);
      if (first && sameRequest(ctx, first, v.data, rest, mode)) return { created: false, record: await getIncident(ctx, id) };
      throw new OpsError(409, "request_conflict");
    }
    throw e;
  }
  return { created: true, record: await getIncident(ctx, id) };
};

/**
 * ロックを取ってから、記録を読み直して認可を確かめる（変更系の共通の入口）。呼び出し側が開いたトランザクションの中で呼び、
 * ロックはトランザクションの終わりまで保持される。記録の操縦者に結び付いた利用者（pilots.member_id）も、操縦者の鍵を共有で取って
 * 読み直す（認可の根拠が書き込みまで変わらない。ロックの取得順は 記録の鍵 → 操縦者の鍵 の一方向）。
 * 最初の認可（ロックの前）のあとで、運航管理者が担当の操縦者を付け替えたり、取消したりできる。ロックの後の最新の記録で
 * 認可（isSelf＝いまの担当の操縦者か、運航管理者のみ など）をやり直し、権限がなければ 403 にする。
 * 取消済みなら 409 voided（allowVoided のとき以外）。baseVersion を渡すと、読み直した版が違えば 409 version_conflict
 * （ロックの前に読んだ記録をもとに作った内容を、新しい版へ上書きしない）。
 */
const lockAndReauthorize = async (
  ctx: OpsContext,
  c: store.OpsTx,
  incidentId: string,
  action: OpsAction,
  opts: { readonly allowVoided?: boolean; readonly baseVersion?: number } = {},
): Promise<IncidentRowWithJoins> => {
  await store.lockIncidentOn(c, incidentId);
  const row = await store.getIncident(c, ctx.member.org_id, incidentId);
  if (!row) throw new OpsError(404, "not_found");
  // 記録の操縦者に結び付いた利用者も、確定した最新の値を、書き込みまで変わらない形で読む（操縦者の更新の割り込みを受けない）
  const fresh = row.pilot_id ? { ...row, pilot_member_id: await store.lockPilotMemberOn(c, ctx.member.org_id, row.pilot_id) } : row;
  assertCan(ctx, action, isSelfOf(ctx, fresh));
  if (!opts.allowVoided && fresh.voided_at !== null) throw new OpsError(409, "voided");
  if (opts.baseVersion !== undefined && fresh.current_version !== opts.baseVersion) throw new OpsError(409, "version_conflict");
  return fresh;
};

/** 版の data（snake_case）を API の入力の形（camelCase）にする（訂正の合成用）。 */
const inputFromData = (d: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [api, col] of Object.entries(INCIDENT_FIELDS)) out[api] = d[col];
  return out;
};

/**
 * 訂正（expectedVersion・reason 必須。違う版なら 409 version_conflict）。運航管理者と自分の分（作った本人・記録の操縦者が自分）。
 * 事象の類型・区分の変更で目安とデータの版を再計算する（本文の目安は読まない）。detailPending を外すには summary が要る。
 */
export const updateIncident = async (ctx: OpsContext, id: string, body: unknown): Promise<IncidentDetailDto> => {
  const current = await loadIncident(ctx, id);
  assertCan(ctx, "incident.update", isSelfOf(ctx, current));
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  const base = (await store.latestVersionData(ctx.db, ctx.member.org_id, "incident_record", current.id)) ?? {};
  // 事象の類型を変えないなら保存済みの版で検査する（変えない値を現在の版で拒まない）。変えるなら現在の版で検査し、目安を再計算する
  const { v, revision } = validateIncidentCorrection({ ...inputFromData(base), ...pickFields(input, INCIDENT_FIELDS) }, input, {
    eventTypes: current.event_types,
    revision: current.guidance_revision,
  });
  if (!meta.ok || !v.ok) return invalid(v, meta.ok ? undefined : { errors: { ...meta.errors }, codes: {} });
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  checkTime(ctx, "full", v.occurredAtDate, false);
  const data = await resolveLinks(ctx, v.data);
  await store.withTransaction(ctx.db, async (c) => {
    // ロックの後の最新の記録で認可をやり直す（担当の操縦者が付け替えられていたら 403）
    await lockAndReauthorize(ctx, c, current.id, "incident.update", { baseVersion: current.current_version });
    await store.appendVersionOn(c, {
      orgId: ctx.member.org_id,
      entityType: "incident_record",
      entityId: current.id,
      op: "update",
      data: versionData(
        data,
        {
          clientRequestId: typeof base["client_request_id"] === "string" ? base["client_request_id"] : null,
          source: typeof base["source"] === "string" ? base["source"] : "office",
        },
        revision,
      ),
      reason: meta.data.reason,
      actorMemberId: ctx.member.id,
      expectedVersion: meta.data.expectedVersion,
    });
  });
  return getIncident(ctx, current.id);
};

/** 誤登録の取消（運航管理者のみ。理由必須。物理削除はしない）。取消した記録は訂正・報告の記録ができない。 */
export const voidIncident = async (ctx: OpsContext, id: string, body: unknown): Promise<IncidentDetailDto> => {
  const current = await loadIncident(ctx, id);
  assertCan(ctx, "incident.void", isSelfOf(ctx, current));
  const meta = validateChangeMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const base = (await store.latestVersionData(ctx.db, ctx.member.org_id, "incident_record", current.id)) ?? {};
  await store.withTransaction(ctx.db, async (c) => {
    await lockAndReauthorize(ctx, c, current.id, "incident.void", { baseVersion: current.current_version });
    await store.appendVersionOn(c, {
      orgId: ctx.member.org_id,
      entityType: "incident_record",
      entityId: current.id,
      op: "void",
      data: base,
      reason: meta.data.reason,
      actorMemberId: ctx.member.id,
      expectedVersion: meta.data.expectedVersion,
    });
  });
  return getIncident(ctx, current.id);
};

export type IncidentReportResult = {
  readonly record: IncidentReportRecordDto;
  /** 記録したあとの報告の状態。 */
  readonly reportState: IncidentReportStateDto;
};

/**
 * 国への報告の記録（reported／consulted／retract）を 1 行追記する。運航管理者と自分の分。閲覧者は 403。
 * 記録した時点の版（DB）と事実の指紋（サーバー）を残す。確認のチェックが欠けると 400。取り下げた行は有効から外れ、元の行は残る。
 * そらばんは国・DIPS へ何も送信しない。
 */
export const createIncidentReport = async (ctx: OpsContext, id: string, body: unknown): Promise<IncidentReportResult> => {
  const current = await loadIncident(ctx, id);
  assertCan(ctx, "incident.report", isSelfOf(ctx, current));
  const v = validateIncidentReport(asInput(body));
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors, v.codes);
  const d = v.data;
  if (v.doneAtDate && (v.doneAtDate.getTime() - nowOf(ctx).getTime()) / MINUTE_MS > FUTURE_TOLERANCE_MIN) {
    throw new OpsError(400, "future_time", { doneAt: "日時が現在より先です" }, { doneAt: "future_time" });
  }
  if (d.action !== "retract" && current.voided_at !== null) throw new OpsError(409, "voided");
  const org = ctx.member.org_id;
  const newId = await store.withTransaction(ctx.db, async (c) => {
    // 排他の下で、最新の記録を読み直して認可をやり直し（担当の操縦者の付け替え・取消のあとの要求を入れない）、指紋を決める。
    // 取り下げは取消済みの記録にもできる（従来どおり）
    const fresh = await lockAndReauthorize(ctx, c, current.id, "incident.report", { allowVoided: d.action === "retract" });
    if (d.action === "retract") {
      const rows = await store.listIncidentReportRecordsFor(c, org, [current.id]);
      const target = rows.find((x) => x.id === d.target_record_id);
      if (!target) throw new OpsError(404, "not_found");
      if (target.action === "retract") throw new OpsError(409, "invalid_target");
      if (rows.some((x) => x.action === "retract" && x.target_record_id === target.id)) throw new OpsError(409, "already_retracted");
    }
    try {
      return await store.insertIncidentReportOn(c, {
        orgId: org,
        incidentId: current.id,
        action: d.action,
        doneAtJst: d.done_at,
        channel: d.channel,
        channelNote: d.channel_note,
        reference: d.reference,
        referenceAbsent: d.reference_absent,
        note: d.note,
        checks: d.checks,
        targetRecordId: d.target_record_id,
        factsFingerprint: incidentFingerprint(factsOfRow(fresh)),
        reason: d.reason,
        recordedByMemberId: ctx.member.id,
      });
    } catch (e) {
      const o = (e ?? {}) as { code?: unknown; constraint?: unknown };
      if (o.code === "23505" && o.constraint === "uq_incident_report_records_retract_target") throw new OpsError(409, "already_retracted");
      throw e;
    }
  });
  const after = await getIncident(ctx, current.id);
  return { record: after.reportRecords.find((x) => x.id === newId)!, reportState: after.reportState };
};

// ---- 計画・日誌に結び付いた記録 ------------------------------------------------------------------

export type LinkedIncidentsDto = {
  readonly count: number;
  readonly incidents: readonly IncidentDto[];
  /** 「記録する」の経路（計画・日誌を初期値にする）。 */
  readonly newHref: string;
  readonly canCreate: boolean;
  readonly notices: Pick<IncidentNoticesDto, "fact" | "officialProcedure">;
};

export type PlanIncidentsDto = LinkedIncidentsDto & {
  readonly planId: string;
  /** 現場の簡易記録の経路。 */
  readonly quickHref: string;
};

export type FlightIncidentsDto = LinkedIncidentsDto & {
  readonly flightRecordId: string;
  readonly planId: string | null;
  /** 日誌の「安全に影響のあった事項」。真のとき、画面は「事故・ヒヤリハットとして記録する」（リンクだけ。自動で作らない）を出す。 */
  readonly safetyIssue: boolean;
  readonly safetyIssueDetail: string | null;
  /** 「事故・ヒヤリハットとして記録する」の経路（要約に安全に影響のあった事項を入れる）。safetyIssue が偽なら null。 */
  readonly safetyIssueHref: string | null;
};

const linkedNotices = (): LinkedIncidentsDto["notices"] => ({ fact: INCIDENT_FACT_NOTICE, officialProcedure: INCIDENT_OFFICIAL_PROCEDURE_NOTICE });

/** その計画に結び付いた記録（取消を除く）。計画の閲覧と同じ認可（全役割）。他の組織の計画は 404。 */
export const listPlanIncidents = async (ctx: OpsContext, planId: string): Promise<PlanIncidentsDto> => {
  assertCan(ctx, "incident.read");
  const p = isUuid(planId) ? await store.getPlan(ctx.db, ctx.member.org_id, planId.toLowerCase()) : null;
  if (!p) throw new OpsError(404, "not_found");
  const incidents = await loadDtos(ctx, await store.listIncidents(ctx.db, ctx.member.org_id, { planId: p.id }));
  return {
    planId: p.id,
    count: incidents.length,
    incidents,
    newHref: incidentNewHref({ planId: p.id }),
    quickHref: incidentQuickHref(p.id),
    canCreate: can(ctx.member.role, "incident.create"),
    notices: linkedNotices(),
  };
};

/** その日誌（飛行記録）に結び付いた記録（取消を除く）。他の組織の飛行記録は 404。 */
export const listFlightIncidents = async (ctx: OpsContext, flightId: string): Promise<FlightIncidentsDto> => {
  assertCan(ctx, "incident.read");
  const f = isUuid(flightId) ? await store.getFlight(ctx.db, ctx.member.org_id, flightId.toLowerCase()) : null;
  if (!f) throw new OpsError(404, "not_found");
  const incidents = await loadDtos(ctx, await store.listIncidents(ctx.db, ctx.member.org_id, { flightRecordId: f.id }));
  return {
    flightRecordId: f.id,
    planId: f.flight_plan_id,
    count: incidents.length,
    incidents,
    newHref: incidentNewHref({ planId: f.flight_plan_id, flightRecordId: f.id }),
    canCreate: can(ctx.member.role, "incident.create"),
    safetyIssue: f.safety_issue,
    safetyIssueDetail: f.safety_issue_detail,
    safetyIssueHref: f.safety_issue
      ? incidentNewHref({ planId: f.flight_plan_id, flightRecordId: f.id, summary: (f.safety_issue_detail ?? "").slice(0, 200) || null })
      : null,
    notices: linkedNotices(),
  };
};

// ---- 「今日」の次にやること ------------------------------------------------------------------------

/** YYYY-MM-DD の日付から days 日前の日付。 */
const daysBefore = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - days * 86_400_000).toISOString().slice(0, 10);
};

/**
 * 事故・ヒヤリハットの次にやること（記録の有無から毎回導出する。保存しない）。未解決の候補と、その報告の記録をまとめて引く（2 クエリ）。
 * 候補は一覧の上限なしで引く（報告の要否の確認は、確認が済むまで日数・件数に関係なく出し続ける）。計画に結び付かない記録の分も出る。
 */
export const incidentTodayActions = async (ctx: OpsContext): Promise<TodayNextAction[]> => {
  if (!can(ctx.member.role, "incident.read")) return [];
  const now = nowOf(ctx);
  const today = jstDate(now);
  const candidates = await store.listIncidentTodayCandidates(ctx.db, ctx.member.org_id, daysBefore(today, INCIDENT_DETAIL_DUE_DAYS));
  const reports = groupReports(await store.listIncidentReportRecordsFor(ctx.db, ctx.member.org_id, candidates.map((r) => r.id)));
  return incidentNextActions(
    candidates.map((r) => {
      const isSelf = isSelfOf(ctx, r);
      const st = stateOf(r, reports.get(r.id) ?? []);
      return {
        id: r.id,
        label: r.summary ?? INCIDENT_KIND_LABEL[r.kind],
        occurredAt: asDate(r.occurred_at),
        occurredDate: r.occurred_at_jst.slice(0, 10),
        now,
        today,
        voided: r.voided_at !== null,
        guidanceLevel: r.guidance_level,
        reportState: st,
        detailPending: r.detail_pending,
        planId: r.plan_id,
        planTitle: r.plan_title,
        can: { report: can(ctx.member.role, "incident.report", { isSelf }), update: can(ctx.member.role, "incident.update", { isSelf }) },
      };
    }),
  );
};
