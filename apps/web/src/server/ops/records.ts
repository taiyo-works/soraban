// 飛行記録・日常点検記録のサービス層（Sprint 11 設計 B・C・D・F・G）。画面と API の両方がここを通る。
// 認可は authz.ts の can()、DB の読み書きは store.ts（org_id 必須）だけで行う。版の仕組みは Sprint 10 と同じ。
import { randomUUID } from "node:crypto";
import type { PilotRow } from "@soraban/db";
import { formatJst, formatLanding, jstDate, parseJstMinute, toJstInput } from "@/lib/ops-time";
import { INSPECTION_ITEMS, type InspectionItemKey, type InspectionResult, type InspectionTiming } from "@/lib/ops-records";
import { can } from "./authz";
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
import { OpsError, type FlightWithTotal, type InspectionWithAircraft, type RecordFilter } from "./store";
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

const nowOf = (ctx: OpsContext): Date => (ctx.now ? ctx.now() : new Date());

const invalid = <T>(v: RecordValidated<T>, extra?: { errors: Record<string, string>; codes: Record<string, string> }): never => {
  const errors = { ...(extra?.errors ?? {}), ...(v.ok ? {} : v.errors) };
  const codes = { ...(extra?.codes ?? {}), ...(v.ok ? {} : v.codes) };
  throw new OpsError(400, "invalid_input", errors, codes);
};

const fieldError = (key: string, code: string, message: string): never => {
  throw new OpsError(400, "invalid_input", { [key]: message }, { [key]: code });
};

const pickFields = (input: Input, fields: Readonly<Record<string, string>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) if (k in input) out[k] = input[k];
  return out;
};

/** 利用者に結び付いた（取消していない）操縦者の行。無ければ null。 */
const myPilot = async (ctx: OpsContext): Promise<PilotRow | null> =>
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

const loadAircraftForRecord = async (ctx: OpsContext, aircraftId: string, creating: boolean) => {
  const a = await store.getAircraft(ctx.db, ctx.member.org_id, aircraftId);
  if (!a) throw new OpsError(404, "not_found");
  if (creating && (a.voided_at !== null || a.status === "deregistered")) throw new OpsError(409, "aircraft_unavailable");
  return a;
};

const loadPilotForRecord = async (ctx: OpsContext, pilotId: string, key: string, unchanged: boolean) => {
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
  readonly version: number;
  readonly voided: boolean;
  readonly voidedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));
const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

const defectDto = (d: DefectData): DefectDto => ({
  occurredOn: d.occurred_on,
  description: d.description,
  actionOn: d.action_on,
  action: d.action,
  confirmerName: d.confirmer_name,
});

const flightDto = (r: FlightWithTotal, mine: PilotRow | null, ctx: OpsContext, revealLicense: boolean): FlightDto => {
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
  return (await store.listFlights(ctx.db, ctx.member.org_id, filter)).map((r) => flightDto(r, mine, ctx, false));
};

const loadFlight = async (ctx: OpsContext, id: string): Promise<FlightWithTotal> => {
  const r = isUuid(id) ? await store.getFlight(ctx.db, ctx.member.org_id, id) : null;
  if (!r) throw new OpsError(404, "not_found");
  return r;
};

export const getFlight = async (ctx: OpsContext, id: string): Promise<FlightDto> => {
  assertCan(ctx, "flight.read");
  return flightDto(await loadFlight(ctx, id), await myPilot(ctx), ctx, true);
};

/** 保存は止めない警告（設計 E）。 */
export type RecordWarning = "no_inspection_on_day" | "recent_inspection_abnormal" | "license_expired" | "aircraft_suspended";

export const WARNING_MESSAGES: Readonly<Record<RecordWarning, string>> = {
  no_inspection_on_day: "この機体の、飛行日の日常点検がありません。",
  recent_inspection_abnormal: "この機体の直近の日常点検に「異常」があります。",
  license_expired: "操縦者の技能証明の有効期限が飛行日より前です。",
  aircraft_suspended: "この機体は休止中です。",
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
  return out;
};

/**
 * 同じ組織で同じ送信の識別子の作成が既にあるか。あれば、作成者が要求した利用者と同じときだけその記録の ID を返す。
 * 別の利用者の作成なら 409（request_conflict）。共用の端末で前の利用者の下書きの識別子が残っていた場合などに、
 * 他人の記録を返さないため。
 */
const existingRequest = async (
  ctx: OpsContext,
  entityType: "flight_record" | "daily_inspection",
  requestId: string,
): Promise<string | null> => {
  const owner = await store.findRequestOwner(ctx.db, ctx.member.org_id, entityType, requestId);
  if (!owner) return null;
  if (owner.actor_member_id !== ctx.member.id) throw new OpsError(409, "request_conflict");
  return owner.id;
};

/** API の UUID の比較用（大文字・小文字を区別しない）。 */
const normId = (v: unknown): unknown => (typeof v === "string" ? v.toLowerCase() : v);

export type SaveResult<T> = { readonly created: boolean; readonly record: T; readonly warnings: readonly RecordWarning[] };

/** 日常点検の紐付けを確かめる（他の組織は 404、別の機体・取消済みは 400）。 */
const checkInspectionLink = async (ctx: OpsContext, inspectionId: string | null, aircraftId: string): Promise<void> => {
  if (inspectionId === null) return;
  const i = await store.getInspection(ctx.db, ctx.member.org_id, inspectionId);
  if (!i) throw new OpsError(404, "not_found");
  if (i.aircraft_id !== aircraftId) fieldError("dailyInspectionId", "inspection_mismatch", "同じ機体の日常点検を選んでください");
  if (i.voided_at !== null) fieldError("dailyInspectionId", "inspection_voided", "取消された日常点検は選べません");
};

export const createFlight = async (ctx: OpsContext, body: unknown): Promise<SaveResult<FlightDto>> => {
  const mine = await assertMayCreate(ctx, "flight.create");
  const input = asInput(body);
  const req = parseClientRequestId(input["clientRequestId"]);
  const v = validateFlight(input, nowOf(ctx));
  if (!req.ok || !v.ok) {
    return invalid(v, req.ok ? undefined : { errors: { clientRequestId: "送信の識別子が正しくありません" }, codes: { clientRequestId: "invalid" } });
  }
  // 二重送信：同じ組織で同じ識別子の作成が既にあれば、新しい記録を作らずに既存の記録を返す
  if (req.value) {
    const existingId = await existingRequest(ctx, "flight_record", req.value);
    if (existingId) return { created: false, record: flightDto(await loadFlight(ctx, existingId), mine, ctx, true), warnings: [] };
  }
  const isSelf = mine !== null && mine.id === v.data.pilot_id;
  if (!can(ctx.member.role, "flight.create", { isSelf })) throw new OpsError(403, "forbidden");
  await loadAircraftForRecord(ctx, v.data.aircraft_id, true);
  const pilot = await loadPilotForRecord(ctx, v.data.pilot_id, "pilotId", false);
  await checkInspectionLink(ctx, v.data.daily_inspection_id, v.data.aircraft_id);
  const id = randomUUID();
  try {
    await store.appendVersion(ctx.db, {
      orgId: ctx.member.org_id,
      entityType: "flight_record",
      entityId: id,
      op: "create",
      data: {
        ...v.data,
        flight_plan_id: null,
        snapshot_id: null,
        // 作成時点の写し（画面から送らせない。設計 B）
        pilot_name: pilot.full_name,
        pilot_license_number: pilot.license_number,
        pilot_version: pilot.current_version,
        client_request_id: req.value,
      },
      reason: null,
      actorMemberId: ctx.member.id,
    });
  } catch (e) {
    if (e instanceof OpsError && e.code === "duplicate_request" && req.value) {
      const existingId = await existingRequest(ctx, "flight_record", req.value);
      if (existingId) return { created: false, record: flightDto(await loadFlight(ctx, existingId), mine, ctx, true), warnings: [] };
    }
    throw e;
  }
  const saved = await loadFlight(ctx, id);
  return { created: true, record: flightDto(saved, mine, ctx, true), warnings: await flightWarnings(ctx, saved) };
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
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "flight_record",
    entityId: id,
    op: "update",
    data: {
      ...v.data,
      flight_plan_id: base["flight_plan_id"] ?? null,
      snapshot_id: base["snapshot_id"] ?? null,
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
  return { created: false, record: flightDto(saved, mine, ctx, true), warnings: await flightWarnings(ctx, saved) };
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

export const listInspections = async (ctx: OpsContext, filter: RecordFilter = {}): Promise<InspectionDto[]> => {
  assertCan(ctx, "inspection.read");
  const mine = await myPilot(ctx);
  return (await store.listInspections(ctx.db, ctx.member.org_id, filter)).map((r) => inspectionDto(r, mine));
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

export const createInspection = async (ctx: OpsContext, body: unknown): Promise<SaveResult<InspectionDto>> => {
  const mine = await assertMayCreate(ctx, "inspection.create");
  const input = asInput(body);
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
  try {
    await store.appendVersion(ctx.db, {
      orgId: ctx.member.org_id,
      entityType: "daily_inspection",
      entityId: id,
      op: "create",
      data: {
        ...v.data,
        inspector_name: pilot.full_name,
        inspector_version: pilot.current_version,
        client_request_id: req.value,
      },
      reason: null,
      actorMemberId: ctx.member.id,
    });
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
