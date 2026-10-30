// 飛行記録・日常点検記録のサービス層（Sprint 11 設計 B・C・D・F・G）。画面と API の両方がここを通る。
// 認可は authz.ts の can()、DB の読み書きは store.ts（org_id 必須）だけで行う。版の仕組みは Sprint 10 と同じ。
import { randomUUID } from "node:crypto";
import type { PilotRow } from "@soraban/db";
import { floorToMinute, formatJst, formatLanding, jstDate, parseJstMinute, toJstInput } from "@/lib/ops-time";
import { INSPECTION_ITEMS, type InspectionItemKey, type InspectionResult, type InspectionTiming } from "@/lib/ops-records";
import {
  JOURNAL_MISMATCH_REPORT_AFTER_TAKEOFF,
  JOURNAL_MISMATCH_REPORT_MISSING,
} from "@/lib/ops-field";
import { can } from "./authz";
import { checkJournalLink } from "./field-logic";
import { specificFlightTypesFromFlags } from "./plan-logic";
import { loadFieldState } from "./field-rows";
import { emptyFlightExtra, enrichFlights, type FlightExtra, type GapDto } from "./flight-extras";
import type { JournalMismatch } from "./journal-logic";
import {
  asInput,
  assertCan,
  dateOnly,
  iso,
  isUuid,
  listEntityVersions,
  type OpsContext,
  type VersionDto,
} from "./service";
import * as store from "./store";
import { OpsError, type FlightWithTotal, type InspectionWithAircraft, type PlanWithJoins, type RecordFilter } from "./store";
import { maskLicenseNumber, validateChangeMeta } from "./validate";
import {
  FLIGHT_FIELDS,
  INSPECTION_FIELDS,
  parseClientRequestId,
  validateFlight,
  validateInspection,
  type DefectData,
  type RecordValidated,
} from "./validate-records";

type Input = Readonly<Record<string, unknown>>;

export const nowOf = (ctx: OpsContext): Date => (ctx.now ? ctx.now() : new Date());

export const invalid = <T>(v: RecordValidated<T>, extra?: { errors: Record<string, string>; codes: Record<string, string> }): never => {
  const errors = { ...(extra?.errors ?? {}), ...(v.ok ? {} : v.errors) };
  const codes = { ...(extra?.codes ?? {}), ...(v.ok ? {} : v.codes) };
  throw new OpsError(400, "invalid_input", errors, codes);
};

export const fieldError = (key: string, code: string, message: string): never => {
  throw new OpsError(400, "invalid_input", { [key]: message }, { [key]: code });
};

export const pickFields = (input: Input, fields: Readonly<Record<string, string>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) if (k in input) out[k] = input[k];
  return out;
};

/** 利用者に結び付いた（取消していない）操縦者の行。無ければ null。 */
export const myPilot = async (ctx: OpsContext): Promise<PilotRow | null> =>
  store.findPilotByMember(ctx.db, ctx.member.org_id, ctx.member.id);

/**
 * 作成の前の認可。閲覧者は 403。操縦者役割は、自分に結び付いた操縦者の行がなければ 403
 * （本文の検査より先に判断する。記録の操縦者が自分かどうかは本文の検査の後で確かめる）。
 */
const assertMayCreate = async (ctx: OpsContext, action: "flight.create" | "inspection.create"): Promise<PilotRow | null> => {
  const mine = await myPilot(ctx);
  if (!can(ctx.member.role, action, { isSelf: true }) || (ctx.member.role !== "manager" && !mine)) {
    throw new OpsError(403, "forbidden");
  }
  return mine;
};

export const loadAircraftForRecord = async (ctx: OpsContext, aircraftId: string, creating: boolean) => {
  const a = await store.getAircraft(ctx.db, ctx.member.org_id, aircraftId);
  if (!a) throw new OpsError(404, "not_found");
  if (creating && (a.voided_at !== null || a.status === "deregistered")) throw new OpsError(409, "aircraft_unavailable");
  return a;
};

export const loadPilotForRecord = async (ctx: OpsContext, pilotId: string, key: string, unchanged: boolean) => {
  const p = await store.getPilot(ctx.db, ctx.member.org_id, pilotId);
  if (!p) throw new OpsError(404, "not_found");
  if (p.voided_at !== null && !unchanged) fieldError(key, "pilot_voided", "取消された操縦者は選べません");
  return p;
};

// ---- 飛行記録 ------------------------------------------------

export type DefectDto = {
  readonly occurredOn: string;
  readonly description: string;
  readonly actionOn: string | null;
  readonly action: string | null;
  readonly confirmerName: string | null;
};

export type JudgementLink = "linked" | "not_required" | "missing";

/** 「判定の根拠が紐づいていません」（judgementLink が missing のとき、一覧と詳細に出す）。 */
export const JUDGEMENT_LINK_MISSING_LABEL = "判定の根拠が紐づいていません";

export const judgementLinkOf = (planId: string | null, specificFlightTypes: readonly string[]): JudgementLink =>
  planId !== null ? "linked" : specificFlightTypes.length > 0 ? "missing" : "not_required";

export type FlightDto = {
  readonly id: string;
  readonly aircraftId: string;
  readonly registrationMark: string;
  readonly pilotId: string;
  /** 作成・訂正の時点の操縦者の氏名の写し。 */
  readonly pilotName: string;
  /** 技能証明書番号の写し。一覧では常に末尾 4 桁以外を伏せる。詳細では運航管理者と本人にだけ全桁。 */
  readonly pilotLicenseNumber: string | null;
  readonly pilotLicenseNumberMasked: boolean;
  readonly pilotVersion: number;
  /** 記録の操縦者が、要求した利用者に結び付いた操縦者か。 */
  readonly isSelf: boolean;
  readonly dailyInspectionId: string | null;
  readonly flightPlanId: string | null;
  readonly snapshotId: string | null;
  /**
   * 判定の根拠との紐付け（Sprint 12a）。linked＝計画あり／not_required＝特定飛行の形態なし・計画なし／
   * missing＝特定飛行の形態があるのに計画なし（「判定の根拠が紐づいていません」と表示する）。
   */
  readonly judgementLink: JudgementLink;
  readonly purpose: string;
  readonly waypoints: string | null;
  readonly specificFlightTypes: readonly string[];
  readonly takeoffPlace: string;
  readonly takeoffLat: number | null;
  readonly takeoffLng: number | null;
  readonly takeoffAccuracyM: number | null;
  readonly landingPlace: string;
  readonly landingLat: number | null;
  readonly landingLng: number | null;
  readonly landingAccuracyM: number | null;
  /** 日本時間の `YYYY-MM-DDTHH:MM`（入力の形）。 */
  readonly takeoffAt: string;
  readonly landingAt: string;
  /** 表示用。離陸は `YYYY-MM-DD HH:MM`、着陸は `HH:MM` か「翌日 HH:MM」。 */
  readonly takeoffAtJst: string;
  readonly landingAtJst: string;
  readonly flightMinutes: number;
  readonly flightDate: string;
  /** 機体の総飛行時間（分）。取消済みは null。 */
  readonly totalFlightMinutes: number | null;
  readonly safetyIssue: boolean;
  readonly safetyIssueDetail: string | null;
  readonly defects: readonly DefectDto[];
  /**
   * 日誌の食い違い（Sprint 12c）：計画の時間帯の外・特定飛行で離陸の時点に通報の記録がない・通報の記録が離陸より後。
   * 保存した値ではなく、毎回導出する。保存は止めない。計画なしは空。
   */
  readonly mismatches: readonly JournalMismatch[];
  /** 結び付いた離陸の行の、離陸時の未了事項の写し（現場モードを経由しなければ null）。 */
  readonly takeoffGaps: readonly GapDto[] | null;
  /** 結び付いた離陸の行の ID（現場モードを経由しなければ null）。 */
  readonly takeoffEventId: string | null;
  readonly version: number;
  readonly voided: boolean;
  readonly voidedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

export const num = (v: string | number | null): number | null => (v === null ? null : Number(v));
export const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

const defectDto = (d: DefectData): DefectDto => ({
  occurredOn: d.occurred_on,
  description: d.description,
  actionOn: d.action_on,
  action: d.action,
  confirmerName: d.confirmer_name,
});

const flightDto = (
  r: FlightWithTotal,
  mine: PilotRow | null,
  ctx: OpsContext,
  revealLicense: boolean,
  extra: FlightExtra = emptyFlightExtra(),
): FlightDto => {
  const isSelf = mine !== null && mine.id === r.pilot_id;
  const reveal = revealLicense && can(ctx.member.role, "flight.readLicenseNumber", { isSelf });
  const takeoff = asDate(r.takeoff_at);
  const landing = asDate(r.landing_at);
  return {
    id: r.id,
    aircraftId: r.aircraft_id,
    registrationMark: r.registration_mark,
    pilotId: r.pilot_id,
    pilotName: r.pilot_name,
    pilotLicenseNumber: reveal ? r.pilot_license_number : maskLicenseNumber(r.pilot_license_number),
    pilotLicenseNumberMasked: !reveal && r.pilot_license_number !== null,
    pilotVersion: r.pilot_version,
    isSelf,
    dailyInspectionId: r.daily_inspection_id,
    flightPlanId: r.flight_plan_id,
    snapshotId: r.snapshot_id,
    judgementLink: judgementLinkOf(r.flight_plan_id, r.specific_flight_types),
    purpose: r.purpose,
    waypoints: r.waypoints,
    specificFlightTypes: r.specific_flight_types,
    takeoffPlace: r.takeoff_place,
    takeoffLat: num(r.takeoff_lat),
    takeoffLng: num(r.takeoff_lng),
    takeoffAccuracyM: r.takeoff_accuracy_m,
    landingPlace: r.landing_place,
    landingLat: num(r.landing_lat),
    landingLng: num(r.landing_lng),
    landingAccuracyM: r.landing_accuracy_m,
    takeoffAt: toJstInput(takeoff),
    landingAt: toJstInput(landing),
    takeoffAtJst: formatJst(takeoff),
    landingAtJst: formatLanding(takeoff, landing),
    flightMinutes: r.flight_minutes,
    flightDate: r.flight_date_text,
    totalFlightMinutes: r.voided_at === null && r.total_flight_minutes !== null ? Number(r.total_flight_minutes) : null,
    safetyIssue: r.safety_issue,
    safetyIssueDetail: r.safety_issue_detail,
    defects: (r.defects ?? []).map(defectDto),
    mismatches: extra.mismatches,
    takeoffGaps: extra.takeoffGaps,
    takeoffEventId: extra.takeoffEventId,
    version: r.current_version,
    voided: r.voided_at !== null,
    voidedAt: iso(r.voided_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
};

/** 版の data（snake_case）を API の入力の形（camelCase）にする（訂正の合成用）。 */
const flightInputFromData = (d: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [api, col] of Object.entries(FLIGHT_FIELDS)) out[api] = d[col];
  const defects = Array.isArray(d["defects"]) ? (d["defects"] as DefectData[]) : [];
  out["defects"] = defects.map(defectDto);
  return out;
};

const filterFrom = (q: URLSearchParams | Readonly<Record<string, string | undefined>>): RecordFilter => {
  const get = (k: string): string | undefined =>
    q instanceof URLSearchParams ? (q.get(k) ?? undefined) : (q[k] ?? undefined);
  const date = (k: string): string | undefined => {
    const v = get(k);
    if (!v) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      fieldError(k, "date_format", "日付は YYYY-MM-DD で指定してください");
    }
    return v;
  };
  const id = (k: string): string | undefined => {
    const v = get(k);
    if (!v) return undefined;
    if (!isUuid(v)) fieldError(k, "invalid", "ID が正しくありません");
    return v.toLowerCase();
  };
  return { aircraftId: id("aircraftId"), pilotId: id("pilotId"), from: date("from"), to: date("to"), includeVoided: get("includeVoided") === "1" };
};

export const parseRecordFilter = filterFrom;

export const listFlights = async (ctx: OpsContext, filter: RecordFilter = {}): Promise<FlightDto[]> => {
  assertCan(ctx, "flight.read");
  const mine = await myPilot(ctx);
  // 一覧では技能証明書番号を常に伏せる（設計 G）
  const rows = await store.listFlights(ctx.db, ctx.member.org_id, filter);
  // 食い違いは飛行記録の ID の集合でまとめて引く（件数に比例してクエリが増えない）
  const extras = await enrichFlights(ctx.db, ctx.member.org_id, rows);
  return rows.map((r) => flightDto(r, mine, ctx, false, extras.get(r.id)));
};

const loadFlight = async (ctx: OpsContext, id: string): Promise<FlightWithTotal> => {
  const r = isUuid(id) ? await store.getFlight(ctx.db, ctx.member.org_id, id) : null;
  if (!r) throw new OpsError(404, "not_found");
  return r;
};

export const getFlight = async (ctx: OpsContext, id: string): Promise<FlightDto> => {
  assertCan(ctx, "flight.read");
  const row = await loadFlight(ctx, id);
  const extra = (await enrichFlights(ctx.db, ctx.member.org_id, [row])).get(row.id);
  return flightDto(row, await myPilot(ctx), ctx, true, extra);
};

/** 保存は止めない警告（設計 E）。 */
export type RecordWarning =
  | "no_inspection_on_day"
  | "recent_inspection_abnormal"
  | "license_expired"
  | "aircraft_suspended"
  | "differs_from_plan"
  // Sprint 12c：日誌の食い違い（知らせるだけ。保存は止めない）
  | "outside_plan_window"
  | "report_missing"
  | "report_after_takeoff";

export const WARNING_MESSAGES: Readonly<Record<RecordWarning, string>> = {
  no_inspection_on_day: "この機体の、飛行日の日常点検がありません。",
  recent_inspection_abnormal: "この機体の直近の日常点検に「異常」があります。",
  license_expired: "操縦者の技能証明の有効期限が飛行日より前です。",
  aircraft_suspended: "この機体は休止中です。",
  differs_from_plan: "飛行計画と違う機体・操縦者・時間帯で記録されています。",
  outside_plan_window: "計画の時間帯の外で飛行しています。",
  report_missing: JOURNAL_MISMATCH_REPORT_MISSING,
  report_after_takeoff: JOURNAL_MISMATCH_REPORT_AFTER_TAKEOFF,
};

const flightWarnings = async (ctx: OpsContext, f: FlightWithTotal): Promise<RecordWarning[]> => {
  const out: RecordWarning[] = [];
  const a = await store.getAircraft(ctx.db, ctx.member.org_id, f.aircraft_id);
  const p = await store.getPilot(ctx.db, ctx.member.org_id, f.pilot_id);
  if ((await store.countInspectionsOn(ctx.db, ctx.member.org_id, f.aircraft_id, f.flight_date_text)) === 0) {
    out.push("no_inspection_on_day");
  }
  const latest = await store.latestInspectionBefore(ctx.db, ctx.member.org_id, f.aircraft_id, asDate(f.takeoff_at));
  if (latest?.has_abnormal) out.push("recent_inspection_abnormal");
  const expires = p ? dateOnly(p.license_expires_on) : null;
  if (expires && expires < f.flight_date_text) out.push("license_expired");
  if (a?.status === "suspended") out.push("aircraft_suspended");
  // 計画と違う機体・操縦者・時間帯のとき（現場の差し替えがありうるため、保存は止めない）
  if (f.flight_plan_id) {
    const plan = await store.getPlan(ctx.db, ctx.member.org_id, f.flight_plan_id);
    if (plan) {
      const start = asDate(plan.planned_start_at).getTime();
      const end = start + plan.duration_minutes * 60_000;
      if (
        plan.aircraft_id !== f.aircraft_id ||
        plan.pilot_id !== f.pilot_id ||
        asDate(f.takeoff_at).getTime() < start ||
        asDate(f.landing_at).getTime() > end
      ) {
        out.push("differs_from_plan");
      }
    }
  }
  return out;
};

/**
 * 飛行計画との紐付けを確かめる（Sprint 12a 設計 G）。他の組織の計画は 404、中止した計画は 409（plan_cancelled）。
 * snapshot_id は計画の現在のスナップショットをサーバーが入れる（リクエストの snapshotId は読まない）。
 */
const resolvePlanLink = async (
  ctx: OpsContext,
  raw: unknown,
): Promise<{ readonly planId: string; readonly snapshotId: string } | null> => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !isUuid(raw)) fieldError("flightPlanId", "invalid", "飛行計画が正しくありません");
  const plan = await store.getPlan(ctx.db, ctx.member.org_id, (raw as string).toLowerCase());
  if (!plan) throw new OpsError(404, "not_found");
  if (plan.voided_at !== null) throw new OpsError(409, "plan_cancelled");
  return { planId: plan.id, snapshotId: plan.current_snapshot_id };
};

/** この計画に結びついた（取消していない）飛行記録。 */
export const listFlightsForPlan = async (ctx: OpsContext, planId: string): Promise<FlightDto[]> => {
  assertCan(ctx, "flight.read");
  const mine = await myPilot(ctx);
  const rows = await store.listFlightsByPlan(ctx.db, ctx.member.org_id, planId);
  const extras = await enrichFlights(ctx.db, ctx.member.org_id, rows);
  return rows.map((r) => flightDto(r, mine, ctx, false, extras.get(r.id)));
};

/**
 * 同じ組織で同じ送信の識別子の作成が既にあるか。あれば、作成者が要求した利用者と同じときだけその記録の ID を返す。
 * 別の利用者の作成なら 409（request_conflict）。共用の端末で前の利用者の下書きの識別子が残っていた場合などに、
 * 他人の記録を返さないため。
 */
export const existingRequest = async (
  ctx: OpsContext,
  entityType: "flight_record" | "daily_inspection" | "flight_plan",
  requestId: string,
): Promise<string | null> => {
  const owner = await store.findRequestOwner(ctx.db, ctx.member.org_id, entityType, requestId);
  if (!owner) return null;
  if (owner.actor_member_id !== ctx.member.id) throw new OpsError(409, "request_conflict");
  return owner.id;
};

/** API の UUID の比較用（大文字・小文字を区別しない）。 */
export const normId = (v: unknown): unknown => (typeof v === "string" ? v.toLowerCase() : v);

export type SaveResult<T> = { readonly created: boolean; readonly record: T; readonly warnings: readonly RecordWarning[] };

/** 日常点検の紐付けを確かめる（他の組織は 404、別の機体・取消済みは 400）。 */
const checkInspectionLink = async (ctx: OpsContext, inspectionId: string | null, aircraftId: string): Promise<void> => {
  if (inspectionId === null) return;
  const i = await store.getInspection(ctx.db, ctx.member.org_id, inspectionId);
  if (!i) throw new OpsError(404, "not_found");
  if (i.aircraft_id !== aircraftId) fieldError("dailyInspectionId", "inspection_mismatch", "同じ機体の日常点検を選んでください");
  if (i.voided_at !== null) fieldError("dailyInspectionId", "inspection_voided", "取消された日常点検は選べません");
};

/** 飛行記録の応答（保存直後）：警告に日誌の食い違いのコードを足す。食い違いがあっても保存は成功している。 */
const savedFlightOut = async (
  ctx: OpsContext,
  saved: FlightWithTotal,
  mine: PilotRow | null,
): Promise<{ readonly record: FlightDto; readonly warnings: RecordWarning[] }> => {
  const extra = (await enrichFlights(ctx.db, ctx.member.org_id, [saved])).get(saved.id) ?? emptyFlightExtra();
  const warnings = [...(await flightWarnings(ctx, saved)), ...extra.mismatches.map((m): RecordWarning => m.code)];
  return { record: flightDto(saved, mine, ctx, true, extra), warnings };
};

/** 同じ送信の識別子の既存の記録を返す（新しい記録を作らない）。 */
const replayFlight = async (ctx: OpsContext, existingId: string, mine: PilotRow | null): Promise<SaveResult<FlightDto>> => {
  const row = await loadFlight(ctx, existingId);
  const extra = (await enrichFlights(ctx.db, ctx.member.org_id, [row])).get(row.id);
  return { created: false, record: flightDto(row, mine, ctx, true, extra), warnings: [] };
};

/**
 * 日誌に結び付ける離陸の行（takeoffEventId。離陸の行の ID か端末の識別子）を確かめる（Sprint 12c）。
 * 着陸していない離陸・取り消された離陸・他の計画の離陸は 400、すでに日誌済みの離陸は 409 already_journaled。
 * 計画は離陸の行の計画。中止した計画でも、すでに離陸した飛行の日誌は残せる。
 */
const resolveTakeoffLink = async (
  ctx: OpsContext,
  input: Input,
): Promise<{ readonly planId: string; readonly snapshotId: string; readonly takeoffEventId: string } | null> => {
  const raw = input["takeoffEventId"];
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !isUuid(raw)) fieldError("takeoffEventId", "invalid", "離陸の記録が正しくありません");
  const ev = await store.getFieldEventByRef(ctx.db, ctx.member.org_id, raw as string);
  if (!ev || ev.kind !== "takeoff") fieldError("takeoffEventId", "invalid_target", "結び付ける離陸の記録が見つかりません");
  const takeoff = ev!;
  const given = input["flightPlanId"];
  if (given !== undefined && given !== null && given !== "" && normId(given) !== takeoff.plan_id) {
    fieldError("flightPlanId", "plan_mismatch", "離陸の記録の計画と、飛行計画が違います");
  }
  const plan = await store.getPlan(ctx.db, ctx.member.org_id, takeoff.plan_id);
  if (!plan) throw new OpsError(404, "not_found");
  const { state } = await loadFieldState(ctx.db, ctx.member.org_id, plan, null);
  const chk = checkJournalLink(state, takeoff.id);
  if (!chk.ok) {
    if (chk.status === 409) throw new OpsError(409, chk.code);
    fieldError("takeoffEventId", chk.code, chk.code === "no_landing" ? "着陸が記録されていない離陸には日誌を結び付けられません" : "結び付ける離陸の記録が正しくありません");
  }
  return { planId: plan.id, snapshotId: plan.current_snapshot_id, takeoffEventId: takeoff.id };
};

/**
 * Sprint 15：端末の送信待ちから送る日誌（fillFromPlan: true）は、端末に自由記述・座標を残さないため、目的・離着陸の場所・座標・
 * 特定飛行の形態を送らない。サーバーが計画（flightPlanId、または takeoffEventId の離陸の計画）から、画面の「計画から作る」と
 * 同じ値を入れる（送られた値があればそちらを使う）。計画が見つからなければ何もしない（入力検査が必須の項目を指摘する）。
 */
const fillFlightFromPlan = async (ctx: OpsContext, raw: Input): Promise<Input> => {
  if (raw["fillFromPlan"] !== true) return raw;
  let planId: string | null = typeof raw["flightPlanId"] === "string" && isUuid(raw["flightPlanId"]) ? raw["flightPlanId"].toLowerCase() : null;
  if (planId === null && typeof raw["takeoffEventId"] === "string" && isUuid(raw["takeoffEventId"])) {
    planId = (await store.getFieldEventByRef(ctx.db, ctx.member.org_id, raw["takeoffEventId"]))?.plan_id ?? null;
  }
  if (planId === null) return raw;
  const plan = await store.getPlan(ctx.db, ctx.member.org_id, planId);
  if (!plan) return raw;
  const empty = (k: string): boolean => raw[k] === undefined || raw[k] === null || (typeof raw[k] === "string" && (raw[k] as string).trim() === "");
  const snap = raw["specificFlightTypes"] === undefined ? await store.getSnapshot(ctx.db, ctx.member.org_id, plan.id, plan.current_snapshot_id) : null;
  const flags = ((snap?.result as { flags?: readonly string[] } | undefined)?.flags ?? []) as readonly string[];
  const lat = Number.isFinite(Number(plan.latitude)) ? Number(plan.latitude) : null;
  const lng = Number.isFinite(Number(plan.longitude)) ? Number(plan.longitude) : null;
  return {
    ...raw,
    ...(empty("purpose") ? { purpose: plan.purpose } : {}),
    ...(empty("takeoffPlace") ? { takeoffPlace: plan.place_name } : {}),
    ...(empty("landingPlace") ? { landingPlace: plan.place_name } : {}),
    ...(empty("takeoffLat") && empty("takeoffLng") && lat !== null && lng !== null ? { takeoffLat: lat, takeoffLng: lng } : {}),
    ...(empty("landingLat") && empty("landingLng") && lat !== null && lng !== null ? { landingLat: lat, landingLng: lng } : {}),
    ...(raw["specificFlightTypes"] === undefined ? { specificFlightTypes: specificFlightTypesFromFlags(flags) } : {}),
  };
};

export const createFlight = async (ctx: OpsContext, body: unknown): Promise<SaveResult<FlightDto>> => {
  const mine = await assertMayCreate(ctx, "flight.create");
  const input = await fillFlightFromPlan(ctx, asInput(body));
  const req = parseClientRequestId(input["clientRequestId"]);
  const v = validateFlight(input, nowOf(ctx));
  if (!req.ok || !v.ok) {
    return invalid(v, req.ok ? undefined : { errors: { clientRequestId: "送信の識別子が正しくありません" }, codes: { clientRequestId: "invalid" } });
  }
  // 二重送信：同じ組織で同じ識別子の作成が既にあれば、新しい記録を作らずに既存の記録を返す
  if (req.value) {
    const existingId = await existingRequest(ctx, "flight_record", req.value);
    if (existingId) return replayFlight(ctx, existingId, mine);
  }
  const isSelf = mine !== null && mine.id === v.data.pilot_id;
  if (!can(ctx.member.role, "flight.create", { isSelf })) throw new OpsError(403, "forbidden");
  await loadAircraftForRecord(ctx, v.data.aircraft_id, true);
  const pilot = await loadPilotForRecord(ctx, v.data.pilot_id, "pilotId", false);
  await checkInspectionLink(ctx, v.data.daily_inspection_id, v.data.aircraft_id);
  // 現場モードの離陸の行（takeoffEventId）があれば、その計画に結び付ける（中止した計画でも可）。なければ従来の flightPlanId。
  const takeoffLink = await resolveTakeoffLink(ctx, input);
  const link = takeoffLink ?? (await resolvePlanLink(ctx, input["flightPlanId"]));
  const id = randomUUID();
  const version = {
    orgId: ctx.member.org_id,
    entityType: "flight_record" as const,
    entityId: id,
    op: "create" as const,
    data: {
      ...v.data,
      flight_plan_id: link?.planId ?? null,
      snapshot_id: link?.snapshotId ?? null,
      // 作成時点の写し（画面から送らせない。設計 B）
      pilot_name: pilot.full_name,
      pilot_license_number: pilot.license_number,
      pilot_version: pilot.current_version,
      client_request_id: req.value,
    },
    reason: null,
    actorMemberId: ctx.member.id,
  };
  try {
    if (takeoffLink) {
      // 飛行記録の作成と journal_linked の追記は、同じトランザクション（どちらかが失敗すれば両方残らない）
      await store.withTransaction(ctx.db, async (c) => {
        await store.lockPlanOn(c, takeoffLink.planId);
        const plan = await store.getPlan(c, ctx.member.org_id, takeoffLink.planId);
        if (!plan) throw new OpsError(404, "not_found");
        const { state } = await loadFieldState(c, ctx.member.org_id, plan, null);
        const chk = checkJournalLink(state, takeoffLink.takeoffEventId);
        if (!chk.ok) {
          if (chk.status === 409) throw new OpsError(409, chk.code);
          throw new OpsError(400, "invalid_input", { takeoffEventId: "結び付ける離陸の記録が正しくありません" }, { takeoffEventId: chk.code });
        }
        await store.appendVersionOn(c, { ...version, data: { ...version.data, snapshot_id: plan.current_snapshot_id } });
        await store.insertFieldEventOn(c, {
          orgId: ctx.member.org_id,
          planId: plan.id,
          kind: "journal_linked",
          item: null,
          result: null,
          source: null,
          targetEventId: takeoffLink.takeoffEventId,
          flightRecordId: id,
          inspectionId: null,
          reportId: null,
          occurredAtJst: toJstInput(floorToMinute(nowOf(ctx))),
          gaps: null,
          note: null,
          queued: false,
          clientEventId: randomUUID(),
          recordedByMemberId: ctx.member.id,
        });
      });
    } else {
      await store.appendVersion(ctx.db, version);
    }
  } catch (e) {
    if (e instanceof OpsError && e.code === "duplicate_request" && req.value) {
      const existingId = await existingRequest(ctx, "flight_record", req.value);
      if (existingId) return replayFlight(ctx, existingId, mine);
    }
    throw e;
  }
  const saved = await loadFlight(ctx, id);
  return { created: true, ...(await savedFlightOut(ctx, saved, mine)) };
};

export const updateFlight = async (ctx: OpsContext, id: string, body: unknown): Promise<SaveResult<FlightDto>> => {
  const current = await loadFlight(ctx, id);
  const mine = await myPilot(ctx);
  const isSelf = mine !== null && mine.id === current.pilot_id;
  assertCan(ctx, "flight.update", isSelf);
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  if ("aircraftId" in input && normId(input["aircraftId"]) !== current.aircraft_id) {
    throw new OpsError(
      400,
      "invalid_input",
      { aircraftId: "機体は訂正で変えられません。誤った場合は取り消して作り直してください", ...(meta.ok ? {} : meta.errors) },
      { aircraftId: "aircraft_immutable" },
    );
  }
  const base = (await store.latestVersionData(ctx.db, ctx.member.org_id, "flight_record", id)) ?? {};
  const merged = { ...flightInputFromData(base), ...pickFields(input, FLIGHT_FIELDS), aircraftId: current.aircraft_id };
  const v = validateFlight(merged, nowOf(ctx));
  if (!meta.ok || !v.ok) return invalid(v, meta.ok ? undefined : { errors: { ...meta.errors }, codes: {} });
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const pilotChanged = v.data.pilot_id !== current.pilot_id;
  if (pilotChanged && !can(ctx.member.role, "flight.update", { isSelf: mine !== null && mine.id === v.data.pilot_id })) {
    throw new OpsError(403, "forbidden");
  }
  const pilot = await loadPilotForRecord(ctx, v.data.pilot_id, "pilotId", !pilotChanged);
  await checkInspectionLink(ctx, v.data.daily_inspection_id, v.data.aircraft_id);
  // 飛行計画の紐付け：NULL のときだけ後から設定できる。設定した後の付け替え・解除はできない（誤りは取消して作り直す）
  let planId = (base["flight_plan_id"] as string | null | undefined) ?? null;
  let snapshotId = (base["snapshot_id"] as string | null | undefined) ?? null;
  if ("flightPlanId" in input) {
    const raw = input["flightPlanId"];
    const requested =
      raw === undefined || raw === null || raw === "" ? null : typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : "invalid";
    if (requested === "invalid") fieldError("flightPlanId", "invalid", "飛行計画が正しくありません");
    if (planId !== null) {
      if (requested !== planId) {
        fieldError("flightPlanId", "plan_immutable", "飛行計画は後から付け替え・解除できません。誤りは取り消して作り直してください");
      }
    } else if (requested !== null) {
      const link = await resolvePlanLink(ctx, requested);
      planId = link?.planId ?? null;
      snapshotId = link?.snapshotId ?? null;
    }
  }
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "flight_record",
    entityId: id,
    op: "update",
    data: {
      ...v.data,
      flight_plan_id: planId,
      snapshot_id: snapshotId,
      // 操縦者を変えない訂正では、記載した時点の写しを保つ。変えた場合は訂正の時点の写しにする
      pilot_name: pilotChanged ? pilot.full_name : current.pilot_name,
      pilot_license_number: pilotChanged ? pilot.license_number : current.pilot_license_number,
      pilot_version: pilotChanged ? pilot.current_version : current.pilot_version,
      client_request_id: current.client_request_id,
    },
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  const saved = await loadFlight(ctx, id);
  return { created: false, ...(await savedFlightOut(ctx, saved, mine)) };
};

export const voidFlight = async (ctx: OpsContext, id: string, body: unknown): Promise<FlightDto> => {
  assertCan(ctx, "flight.void");
  const meta = validateChangeMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors);
  const current = await loadFlight(ctx, id);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const data = (await store.latestVersionData(ctx.db, ctx.member.org_id, "flight_record", id)) ?? {};
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "flight_record",
    entityId: id,
    op: "void",
    data,
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return getFlight(ctx, id);
};

export const listFlightVersions = async (ctx: OpsContext, id: string): Promise<VersionDto[]> => {
  await getFlight(ctx, id);
  return listEntityVersions(ctx, "flight_record", id);
};

// ---- 日常点検記録 --------------------------------------------

export type InspectionItemDto = {
  readonly key: InspectionItemKey;
  readonly label: string;
  readonly result: InspectionResult;
  readonly note: string | null;
};

export type InspectionDto = {
  readonly id: string;
  readonly aircraftId: string;
  readonly registrationMark: string;
  readonly pilotId: string;
  /** 作成・訂正の時点の実施者の氏名の写し。 */
  readonly inspectorName: string;
  readonly inspectorVersion: number;
  readonly isSelf: boolean;
  readonly inspectedAt: string;
  readonly inspectedAtJst: string;
  readonly inspectedDate: string;
  readonly timing: InspectionTiming;
  readonly placeName: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyM: number | null;
  /** 様式2 の順の 9 項目。 */
  readonly items: readonly InspectionItemDto[];
  readonly hasAbnormal: boolean;
  readonly specialNotes: string | null;
  readonly version: number;
  readonly voided: boolean;
  readonly voidedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

const inspectionDto = (r: InspectionWithAircraft, mine: PilotRow | null): InspectionDto => {
  const at = asDate(r.inspected_at);
  return {
    id: r.id,
    aircraftId: r.aircraft_id,
    registrationMark: r.registration_mark,
    pilotId: r.pilot_id,
    inspectorName: r.inspector_name,
    inspectorVersion: r.inspector_version,
    isSelf: mine !== null && mine.id === r.pilot_id,
    inspectedAt: toJstInput(at),
    inspectedAtJst: formatJst(at),
    inspectedDate: r.inspected_date_text,
    timing: r.timing,
    placeName: r.place_name,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    accuracyM: r.accuracy_m,
    items: INSPECTION_ITEMS.map((it) => ({
      key: it.key,
      label: it.label,
      result: r.items[it.key]?.result ?? "normal",
      note: r.items[it.key]?.note ?? null,
    })),
    hasAbnormal: r.has_abnormal,
    specialNotes: r.special_notes,
    version: r.current_version,
    voided: r.voided_at !== null,
    voidedAt: iso(r.voided_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
};

const inspectionInputFromData = (d: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [api, col] of Object.entries(INSPECTION_FIELDS)) out[api] = d[col];
  return out;
};

export const listInspections = async (ctx: OpsContext, filter: RecordFilter = {}, timing?: "pre_flight" | "post_flight"): Promise<InspectionDto[]> => {
  assertCan(ctx, "inspection.read");
  const mine = await myPilot(ctx);
  return (await store.listInspections(ctx.db, ctx.member.org_id, filter, timing)).map((r) => inspectionDto(r, mine));
};

const loadInspection = async (ctx: OpsContext, id: string): Promise<InspectionWithAircraft> => {
  const r = isUuid(id) ? await store.getInspection(ctx.db, ctx.member.org_id, id) : null;
  if (!r) throw new OpsError(404, "not_found");
  return r;
};

export const getInspection = async (ctx: OpsContext, id: string): Promise<InspectionDto> => {
  assertCan(ctx, "inspection.read");
  return inspectionDto(await loadInspection(ctx, id), await myPilot(ctx));
};

/**
 * Sprint 15（R-1）：点検を結び付ける飛行計画（planId）。同じ組織の計画だけ（無ければ 400 plan_not_found）。
 * 結び付けるのは、計画の機体と点検の機体が同じで、計画が中止されていないときだけ（呼び出し側が判定する）。
 */
const resolveInspectionPlan = async (ctx: OpsContext, raw: unknown): Promise<PlanWithJoins | null> => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !isUuid(raw)) fieldError("planId", "invalid", "飛行計画が正しくありません");
  const plan = await store.getPlan(ctx.db, ctx.member.org_id, (raw as string).toLowerCase());
  if (!plan) fieldError("planId", "plan_not_found", "飛行計画が見つかりません");
  return plan;
};

/**
 * 日常点検を作る。Sprint 15：
 *   - planId があれば、点検の保存と同じトランザクションで、その計画の現場の記録に「点検の結び付き」（kind=check・item=inspection・
 *     inspection_id）を追記する（R-1。飛行後点検は、この結び付きのある点検だけを、その計画の「済」に数える）。
 *   - fillFromPlan: true（端末の送信待ちから送る点検）なら、実施場所が空のとき計画の場所名を入れる（端末に場所を残さないため）。
 *   - queued: true は、結び付きの行の「送信待ちを経由した」印に写す。
 */
export const createInspection = async (ctx: OpsContext, body: unknown): Promise<SaveResult<InspectionDto>> => {
  const mine = await assertMayCreate(ctx, "inspection.create");
  const raw = asInput(body);
  const plan = await resolveInspectionPlan(ctx, raw["planId"]);
  const input: Input =
    plan && raw["fillFromPlan"] === true && (typeof raw["placeName"] !== "string" || raw["placeName"].trim() === "")
      ? { ...raw, placeName: plan.place_name }
      : raw;
  const req = parseClientRequestId(input["clientRequestId"]);
  const v = validateInspection(input, nowOf(ctx));
  if (!req.ok || !v.ok) {
    return invalid(v, req.ok ? undefined : { errors: { clientRequestId: "送信の識別子が正しくありません" }, codes: { clientRequestId: "invalid" } });
  }
  if (req.value) {
    const existingId = await existingRequest(ctx, "daily_inspection", req.value);
    if (existingId) return { created: false, record: inspectionDto(await loadInspection(ctx, existingId), mine), warnings: [] };
  }
  const isSelf = mine !== null && mine.id === v.data.pilot_id;
  if (!can(ctx.member.role, "inspection.create", { isSelf })) throw new OpsError(403, "forbidden");
  const aircraft = await loadAircraftForRecord(ctx, v.data.aircraft_id, true);
  const pilot = await loadPilotForRecord(ctx, v.data.pilot_id, "pilotId", false);
  const id = randomUUID();
  const version = {
    orgId: ctx.member.org_id,
    entityType: "daily_inspection" as const,
    entityId: id,
    op: "create" as const,
    data: {
      ...v.data,
      inspector_name: pilot.full_name,
      inspector_version: pilot.current_version,
      client_request_id: req.value,
    },
    reason: null,
    actorMemberId: ctx.member.id,
  };
  // 計画の機体と同じ機体の点検で、計画が中止されていないときだけ結び付ける（中止した計画には確認の行を追記できない）
  const linkPlan = plan && plan.aircraft_id === v.data.aircraft_id && plan.voided_at === null ? plan : null;
  try {
    if (linkPlan) {
      await store.withTransaction(ctx.db, async (c) => {
        await store.lockPlanOn(c, linkPlan.id);
        await store.appendVersionOn(c, version);
        await store.insertFieldEventOn(c, {
          orgId: ctx.member.org_id,
          planId: linkPlan.id,
          kind: "check",
          item: "inspection",
          result: "done",
          source: null,
          targetEventId: null,
          flightRecordId: null,
          inspectionId: id,
          reportId: null,
          occurredAtJst: v.data.inspected_at,
          gaps: null,
          note: null,
          queued: input["queued"] === true,
          clientEventId: randomUUID(),
          recordedByMemberId: ctx.member.id,
        });
      });
    } else {
      await store.appendVersion(ctx.db, version);
    }
  } catch (e) {
    if (e instanceof OpsError && e.code === "duplicate_request" && req.value) {
      const existingId = await existingRequest(ctx, "daily_inspection", req.value);
      if (existingId) return { created: false, record: inspectionDto(await loadInspection(ctx, existingId), mine), warnings: [] };
    }
    throw e;
  }
  const warnings: RecordWarning[] = aircraft.status === "suspended" ? ["aircraft_suspended"] : [];
  return { created: true, record: inspectionDto(await loadInspection(ctx, id), mine), warnings };
};

export const updateInspection = async (ctx: OpsContext, id: string, body: unknown): Promise<InspectionDto> => {
  const current = await loadInspection(ctx, id);
  const mine = await myPilot(ctx);
  assertCan(ctx, "inspection.update", mine !== null && mine.id === current.pilot_id);
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  if ("aircraftId" in input && normId(input["aircraftId"]) !== current.aircraft_id) {
    throw new OpsError(
      400,
      "invalid_input",
      { aircraftId: "機体は訂正で変えられません。誤った場合は取り消して作り直してください", ...(meta.ok ? {} : meta.errors) },
      { aircraftId: "aircraft_immutable" },
    );
  }
  const base = (await store.latestVersionData(ctx.db, ctx.member.org_id, "daily_inspection", id)) ?? {};
  const merged = { ...inspectionInputFromData(base), ...pickFields(input, INSPECTION_FIELDS), aircraftId: current.aircraft_id };
  const v = validateInspection(merged, nowOf(ctx));
  if (!meta.ok || !v.ok) return invalid(v, meta.ok ? undefined : { errors: { ...meta.errors }, codes: {} });
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const pilotChanged = v.data.pilot_id !== current.pilot_id;
  if (pilotChanged && !can(ctx.member.role, "inspection.update", { isSelf: mine !== null && mine.id === v.data.pilot_id })) {
    throw new OpsError(403, "forbidden");
  }
  const pilot = await loadPilotForRecord(ctx, v.data.pilot_id, "pilotId", !pilotChanged);
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "daily_inspection",
    entityId: id,
    op: "update",
    data: {
      ...v.data,
      inspector_name: pilotChanged ? pilot.full_name : current.inspector_name,
      inspector_version: pilotChanged ? pilot.current_version : current.inspector_version,
      client_request_id: current.client_request_id,
    },
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return getInspection(ctx, id);
};

export const voidInspection = async (ctx: OpsContext, id: string, body: unknown): Promise<InspectionDto> => {
  assertCan(ctx, "inspection.void");
  const meta = validateChangeMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors);
  const current = await loadInspection(ctx, id);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const data = (await store.latestVersionData(ctx.db, ctx.member.org_id, "daily_inspection", id)) ?? {};
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "daily_inspection",
    entityId: id,
    op: "void",
    data,
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return getInspection(ctx, id);
};

export const listInspectionVersions = async (ctx: OpsContext, id: string): Promise<VersionDto[]> => {
  await getInspection(ctx, id);
  return listEntityVersions(ctx, "daily_inspection", id);
};

/** 入力画面で使う JST の日付（離陸時刻の入力の形から）。形が違えば null。 */
export const jstDateOfInput = (s: string): string | null => {
  const d = parseJstMinute(s);
  return d ? jstDate(d) : null;
};
