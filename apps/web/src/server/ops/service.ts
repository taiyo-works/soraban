// 運航管理のサービス層（Sprint 10）。画面（サーバーコンポーネント）と API（ルートハンドラ）の両方がここを通る。
// 認可は authz.ts の can() だけで判断し、DB の読み書きは store.ts（org_id 必須）だけで行う。
import { randomUUID } from "node:crypto";
import type { MemberRoleDb, MemberRow, PilotRow, RecordEntityTypeDb } from "@soraban/db";
import type { Identity } from "./auth/identity";
import { can, type OpsAction } from "./authz";
import * as store from "./store";
import { OpsError, type AircraftWithTotal, type OpsDb, type PilotWithTotal } from "./store";
import { FLIGHT_FIELD_LABELS, INSPECTION_FIELD_LABELS } from "./validate-records";
import {
  AIRCRAFT_FIELD_LABELS,
  AIRCRAFT_FIELDS,
  maskLicenseNumber,
  MEMBER_FIELD_LABELS,
  PILOT_FIELD_LABELS,
  PILOT_FIELDS,
  validateAircraft,
  validateChangeMeta,
  validateMemberInvite,
  validatePilot,
  type AircraftData,
  type PilotData,
} from "./validate";

export { OpsError } from "./store";

export type OpsContext = {
  readonly db: OpsDb;
  readonly member: MemberRow;
  /** 現在時刻（離陸が未来でないかの判定に使う）。省略時は実時刻。テスト用の時計は availability.ts の opsNow。 */
  readonly now?: () => Date;
};

type Input = Readonly<Record<string, unknown>>;

export const assertCan = (ctx: OpsContext, action: OpsAction, isSelf?: boolean): void => {
  if (!can(ctx.member.role, action, { isSelf })) throw new OpsError(403, "forbidden");
};

export const asInput = (body: unknown): Input => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OpsError(400, "invalid_body");
  return body as Input;
};

export const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

// ---- 利用者の解決（設計 B「利用者として扱う条件」） ----------

export type MemberResolution =
  | { readonly kind: "member"; readonly member: MemberRow }
  | { readonly kind: "no_access" };

/**
 * Identity から利用者を決める。(1) 結び付き済みの active な利用者、または (2) 未結び付きで emailVerified が真、
 * メールアドレスが invited の行と一致する場合（結び付けて active にし、版を 1 つ追加する）。それ以外は no_access。
 */
export const resolveMember = async (db: OpsDb, identity: Identity): Promise<MemberResolution> => {
  const linked = await store.findMemberByAuth(db, identity.provider, identity.authUserId);
  if (linked) return linked.status === "active" ? { kind: "member", member: linked } : { kind: "no_access" };
  if (!identity.emailVerified) return { kind: "no_access" };
  const invited = await store.findInvitedByEmail(db, identity.email);
  // 第1段階は 1 人 1 組織。複数の組織に招待されている場合は結び付けない。
  if (invited.length !== 1) return { kind: "no_access" };
  const m = invited[0]!;
  try {
    await store.appendVersion(db, {
      orgId: m.org_id,
      entityType: "member",
      entityId: m.id,
      op: "update",
      data: {
        email: m.email,
        display_name: m.display_name,
        role: m.role,
        status: "active",
        auth_provider: identity.provider,
        auth_user_id: identity.authUserId,
      },
      reason: "初回ログインで本人確認の ID に結び付け",
      actorMemberId: null,
      expectedVersion: m.current_version,
    });
  } catch (e) {
    if (e instanceof OpsError) {
      // 同時の初回ログイン等で先に結び付いた場合は、改めて結び付き済みの利用者を探す。
      const again = await store.findMemberByAuth(db, identity.provider, identity.authUserId);
      if (again && again.status === "active") return { kind: "member", member: again };
      return { kind: "no_access" };
    }
    throw e;
  }
  const member = await store.findMemberByAuth(db, identity.provider, identity.authUserId);
  return member && member.status === "active" ? { kind: "member", member } : { kind: "no_access" };
};

// ---- 自分 ----------------------------------------------------

export type MeDto = {
  readonly member: { readonly id: string; readonly displayName: string; readonly email: string; readonly role: MemberRoleDb };
  readonly org: { readonly id: string; readonly name: string };
  readonly pilotId: string | null;
};

export const getMe = async (ctx: OpsContext): Promise<MeDto> => {
  const org = await store.getOrganization(ctx.db, ctx.member.org_id);
  const pilot = await store.findPilotByMember(ctx.db, ctx.member.org_id, ctx.member.id);
  return {
    member: {
      id: ctx.member.id,
      displayName: ctx.member.display_name,
      email: ctx.member.email,
      role: ctx.member.role,
    },
    org: { id: ctx.member.org_id, name: org?.name ?? "" },
    pilotId: pilot?.id ?? null,
  };
};

// ---- 版の一覧 ------------------------------------------------

export type VersionDto = {
  readonly versionNo: number;
  readonly op: "create" | "update" | "void";
  readonly actorName: string;
  readonly createdAt: string;
  /** 日本時間（分まで）。例：2026-12-07 10:15 */
  readonly createdAtJst: string;
  readonly reason: string | null;
  /** 直前の版から変わった項目名（登録・取消では空）。 */
  readonly changedFields: readonly string[];
};

export const formatJstMinute = (d: Date): string => {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
};

const LABELS: Record<RecordEntityTypeDb, Readonly<Record<string, string>>> = {
  aircraft: AIRCRAFT_FIELD_LABELS,
  pilot: PILOT_FIELD_LABELS,
  member: MEMBER_FIELD_LABELS,
  flight_record: FLIGHT_FIELD_LABELS,
  daily_inspection: INSPECTION_FIELD_LABELS,
};

/** 2 つの版の data で値が違う項目の名前（表示名）を返す。 */
export const changedFieldLabels = (
  entityType: RecordEntityTypeDb,
  prev: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): string[] => {
  const labels = LABELS[entityType];
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])];
  return keys
    .filter((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null))
    .map((k) => labels[k] ?? k);
};

export const listEntityVersions = async (
  ctx: OpsContext,
  entityType: RecordEntityTypeDb,
  entityId: string,
): Promise<VersionDto[]> => {
  const rows = await store.listVersions(ctx.db, ctx.member.org_id, entityType, entityId);
  if (rows.length === 0) throw new OpsError(404, "not_found");
  return rows.map((r, i) => {
    const created = new Date(r.created_at as unknown as string | Date);
    return {
      versionNo: r.version_no,
      op: r.op,
      actorName: r.actor_kind === "system" ? "システム" : (r.actor_display_name ?? "（不明）"),
      createdAt: created.toISOString(),
      createdAtJst: formatJstMinute(created),
      reason: r.reason,
      changedFields: r.op === "update" && i > 0 ? changedFieldLabels(entityType, rows[i - 1]!.data, r.data) : [],
    };
  });
};

// ---- 機体 ----------------------------------------------------

export type AircraftDto = {
  readonly id: string;
  readonly registrationMark: string;
  readonly modelName: string;
  readonly manufacturer: string;
  readonly serialNumber: string;
  readonly typeCertified: boolean;
  readonly typeCertCategory: string | null;
  readonly typeCertModel: string | null;
  readonly typeCertNumber: string | null;
  readonly airworthinessClass: "first" | "second" | null;
  readonly airworthinessCertNumber: string | null;
  readonly maxTakeoffWeightKg: number | null;
  readonly initialFlightMinutes: number;
  readonly status: "active" | "suspended" | "deregistered";
  /** 現在の総飛行時間（分）＝既存の総飛行時間＋取消していない飛行記録の飛行時間の合計（Sprint 11 設計 C）。 */
  readonly totalFlightMinutes: number;
  readonly flightCount: number;
  readonly version: number;
  readonly voided: boolean;
  readonly voidedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

const aircraftDto = (r: AircraftWithTotal): AircraftDto => ({
  id: r.id,
  registrationMark: r.registration_mark,
  modelName: r.model_name,
  manufacturer: r.manufacturer,
  serialNumber: r.serial_number,
  typeCertified: r.type_certified,
  typeCertCategory: r.type_cert_category,
  typeCertModel: r.type_cert_model,
  typeCertNumber: r.type_cert_number,
  airworthinessClass: r.airworthiness_class,
  airworthinessCertNumber: r.airworthiness_cert_number,
  maxTakeoffWeightKg: r.max_takeoff_weight_kg === null ? null : Number(r.max_takeoff_weight_kg),
  initialFlightMinutes: r.initial_flight_minutes,
  status: r.status,
  totalFlightMinutes: Number(r.total_flight_minutes),
  flightCount: Number(r.flight_count),
  version: r.current_version,
  voided: r.voided_at !== null,
  voidedAt: iso(r.voided_at),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const aircraftData = (d: Omit<AircraftDto, "totalFlightMinutes" | "flightCount">): AircraftData => ({
  registration_mark: d.registrationMark,
  model_name: d.modelName,
  manufacturer: d.manufacturer,
  serial_number: d.serialNumber,
  type_certified: d.typeCertified,
  type_cert_category: d.typeCertCategory,
  type_cert_model: d.typeCertModel,
  type_cert_number: d.typeCertNumber,
  airworthiness_class: d.airworthinessClass,
  airworthiness_cert_number: d.airworthinessCertNumber,
  max_takeoff_weight_kg: d.maxTakeoffWeightKg,
  initial_flight_minutes: d.initialFlightMinutes,
  status: d.status,
});

const pickFields = (input: Input, fields: Readonly<Record<string, string>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) if (k in input) out[k] = input[k];
  return out;
};

export const listAircraft = async (ctx: OpsContext, includeVoided = false): Promise<AircraftDto[]> => {
  assertCan(ctx, "aircraft.read");
  return (await store.listAircraft(ctx.db, ctx.member.org_id, includeVoided)).map(aircraftDto);
};

export const getAircraft = async (ctx: OpsContext, id: string): Promise<AircraftDto> => {
  assertCan(ctx, "aircraft.read");
  const r = isUuid(id) ? await store.getAircraft(ctx.db, ctx.member.org_id, id) : null;
  if (!r) throw new OpsError(404, "not_found");
  return aircraftDto(r);
};

export const createAircraft = async (ctx: OpsContext, body: unknown): Promise<AircraftDto> => {
  assertCan(ctx, "aircraft.create");
  const v = validateAircraft(asInput(body));
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors);
  const id = randomUUID();
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "aircraft",
    entityId: id,
    op: "create",
    data: v.data,
    reason: null,
    actorMemberId: ctx.member.id,
  });
  return getAircraft(ctx, id);
};

export const updateAircraft = async (ctx: OpsContext, id: string, body: unknown): Promise<AircraftDto> => {
  assertCan(ctx, "aircraft.update");
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  const current = await getAircraft(ctx, id);
  const merged = { ...current, ...pickFields(input, AIRCRAFT_FIELDS) };
  const v = validateAircraft(merged);
  const errors = { ...(meta.ok ? {} : meta.errors), ...(v.ok ? {} : v.errors) };
  if (!meta.ok || !v.ok) throw new OpsError(400, "invalid_input", errors);
  if (current.voided) throw new OpsError(409, "voided");
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "aircraft",
    entityId: id,
    op: "update",
    data: v.data,
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return getAircraft(ctx, id);
};

export const voidAircraft = async (ctx: OpsContext, id: string, body: unknown): Promise<AircraftDto> => {
  assertCan(ctx, "aircraft.void");
  const meta = validateChangeMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors);
  const current = await getAircraft(ctx, id);
  if (current.voided) throw new OpsError(409, "voided");
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "aircraft",
    entityId: id,
    op: "void",
    data: aircraftData(current),
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return getAircraft(ctx, id);
};

export const listAircraftVersions = async (ctx: OpsContext, id: string): Promise<VersionDto[]> => {
  await getAircraft(ctx, id);
  return listEntityVersions(ctx, "aircraft", id);
};

// ---- 操縦者 --------------------------------------------------

export type PilotDto = {
  readonly id: string;
  readonly fullName: string;
  readonly hasLicense: boolean;
  readonly licenseClass: "first" | "second" | null;
  /** 一覧では常に末尾 4 桁以外を伏せる。詳細では運航管理者と本人にだけ全桁。 */
  readonly licenseNumber: string | null;
  readonly licenseNumberMasked: boolean;
  readonly licenseExpiresOn: string | null;
  readonly limitationType: boolean;
  readonly limitationWeight: boolean;
  readonly limitationDaytime: boolean;
  readonly limitationVlos: boolean;
  readonly memberId: string | null;
  readonly isSelf: boolean;
  /** そらばんで記録した飛行の累計（分。初期値なし。Sprint 11 設計 C）。 */
  readonly recordedFlightMinutes: number;
  readonly recordedFlightCount: number;
  readonly version: number;
  readonly voided: boolean;
  readonly voidedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

export const dateOnly = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // pg は date をローカル時刻の 0 時の Date にする。
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};

const pilotDto = (r: PilotWithTotal, ctx: OpsContext, revealLicense: boolean): PilotDto => {
  const isSelf = r.member_id !== null && r.member_id === ctx.member.id;
  const reveal = revealLicense && can(ctx.member.role, "pilot.readLicenseNumber", { isSelf });
  return {
    id: r.id,
    fullName: r.full_name,
    hasLicense: r.has_license,
    licenseClass: r.license_class,
    licenseNumber: reveal ? r.license_number : maskLicenseNumber(r.license_number),
    licenseNumberMasked: !reveal && r.license_number !== null,
    licenseExpiresOn: dateOnly(r.license_expires_on),
    limitationType: r.limitation_type,
    limitationWeight: r.limitation_weight,
    limitationDaytime: r.limitation_daytime,
    limitationVlos: r.limitation_vlos,
    memberId: r.member_id,
    isSelf,
    recordedFlightMinutes: Number(r.recorded_flight_minutes),
    recordedFlightCount: Number(r.recorded_flight_count),
    version: r.current_version,
    voided: r.voided_at !== null,
    voidedAt: iso(r.voided_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
};

const pilotData = (r: PilotRow): PilotData => ({
  full_name: r.full_name,
  has_license: r.has_license,
  license_class: r.license_class,
  license_number: r.license_number,
  license_expires_on: dateOnly(r.license_expires_on),
  limitation_type: r.limitation_type,
  limitation_weight: r.limitation_weight,
  limitation_daytime: r.limitation_daytime,
  limitation_vlos: r.limitation_vlos,
  member_id: r.member_id,
});

/** PilotRow を API の入力の形（camelCase）にする（訂正の合成用。番号は伏せない）。 */
const pilotInput = (r: PilotRow): Record<string, unknown> => ({
  fullName: r.full_name,
  hasLicense: r.has_license,
  licenseClass: r.license_class,
  licenseNumber: r.license_number,
  licenseExpiresOn: dateOnly(r.license_expires_on),
  limitationType: r.limitation_type,
  limitationWeight: r.limitation_weight,
  limitationDaytime: r.limitation_daytime,
  limitationVlos: r.limitation_vlos,
  memberId: r.member_id,
});

const loadPilot = async (ctx: OpsContext, id: string): Promise<PilotWithTotal> => {
  const r = isUuid(id) ? await store.getPilot(ctx.db, ctx.member.org_id, id) : null;
  if (!r) throw new OpsError(404, "not_found");
  return r;
};

const ensureMemberInOrg = async (ctx: OpsContext, memberId: string | null): Promise<void> => {
  if (memberId === null) return;
  const m = await store.getMember(ctx.db, ctx.member.org_id, memberId);
  if (!m || m.voided_at !== null) throw new OpsError(400, "invalid_input", { memberId: "結び付ける利用者が見つかりません" });
};

export const listPilots = async (ctx: OpsContext, includeVoided = false): Promise<PilotDto[]> => {
  assertCan(ctx, "pilot.read");
  return (await store.listPilots(ctx.db, ctx.member.org_id, includeVoided)).map((r) => pilotDto(r, ctx, false));
};

export const getPilot = async (ctx: OpsContext, id: string): Promise<PilotDto> => {
  assertCan(ctx, "pilot.read");
  return pilotDto(await loadPilot(ctx, id), ctx, true);
};

export const createPilot = async (ctx: OpsContext, body: unknown): Promise<PilotDto> => {
  assertCan(ctx, "pilot.create");
  const v = validatePilot(asInput(body));
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors);
  if (v.data.member_id !== null) assertCan(ctx, "pilot.link");
  await ensureMemberInOrg(ctx, v.data.member_id);
  const id = randomUUID();
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "pilot",
    entityId: id,
    op: "create",
    data: v.data,
    reason: null,
    actorMemberId: ctx.member.id,
  });
  return getPilot(ctx, id);
};

export const updatePilot = async (ctx: OpsContext, id: string, body: unknown): Promise<PilotDto> => {
  const current = await loadPilot(ctx, id);
  const isSelf = current.member_id !== null && current.member_id === ctx.member.id;
  assertCan(ctx, "pilot.update", isSelf);
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  const merged = { ...pilotInput(current), ...pickFields(input, PILOT_FIELDS) };
  const v = validatePilot(merged);
  const errors = { ...(meta.ok ? {} : meta.errors), ...(v.ok ? {} : v.errors) };
  if (!meta.ok || !v.ok) throw new OpsError(400, "invalid_input", errors);
  if (v.data.member_id !== current.member_id) assertCan(ctx, "pilot.link");
  await ensureMemberInOrg(ctx, v.data.member_id);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "pilot",
    entityId: id,
    op: "update",
    data: v.data,
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return getPilot(ctx, id);
};

export const voidPilot = async (ctx: OpsContext, id: string, body: unknown): Promise<PilotDto> => {
  assertCan(ctx, "pilot.void");
  const meta = validateChangeMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors);
  const current = await loadPilot(ctx, id);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "pilot",
    entityId: id,
    op: "void",
    data: pilotData(current),
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return getPilot(ctx, id);
};

export const listPilotVersions = async (ctx: OpsContext, id: string): Promise<VersionDto[]> => {
  await loadPilot(ctx, id);
  return listEntityVersions(ctx, "pilot", id);
};

// ---- 利用者 --------------------------------------------------

export type MemberDto = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: MemberRoleDb;
  readonly status: "invited" | "active" | "disabled";
  readonly linked: boolean;
  readonly version: number;
};

const memberDto = (r: MemberRow): MemberDto => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
  status: r.status,
  linked: r.auth_user_id !== null,
  version: r.current_version,
});

const memberData = (r: MemberRow) => ({
  email: r.email,
  display_name: r.display_name,
  role: r.role,
  status: r.status,
  auth_provider: r.auth_provider,
  auth_user_id: r.auth_user_id,
});

export const listMembers = async (ctx: OpsContext): Promise<MemberDto[]> => {
  assertCan(ctx, "member.read");
  return (await store.listMembers(ctx.db, ctx.member.org_id)).map(memberDto);
};

const loadMember = async (ctx: OpsContext, id: string): Promise<MemberRow> => {
  const r = isUuid(id) ? await store.getMember(ctx.db, ctx.member.org_id, id) : null;
  if (!r || r.voided_at !== null) throw new OpsError(404, "not_found");
  return r;
};

export const getMemberDto = async (ctx: OpsContext, id: string): Promise<MemberDto> => {
  assertCan(ctx, "member.read");
  return memberDto(await loadMember(ctx, id));
};

export const inviteMember = async (ctx: OpsContext, body: unknown): Promise<MemberDto> => {
  assertCan(ctx, "member.invite");
  const v = validateMemberInvite(asInput(body));
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors);
  const id = randomUUID();
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "member",
    entityId: id,
    op: "create",
    data: { ...v.data, status: "invited", auth_provider: null, auth_user_id: null },
    reason: null,
    actorMemberId: ctx.member.id,
  });
  return getMemberDto(ctx, id);
};

const ROLES: readonly MemberRoleDb[] = ["manager", "pilot", "viewer"];

/** 利用者の役割の変更・停止・再開・表示名の変更（運航管理者のみ）。 */
export const updateMember = async (ctx: OpsContext, id: string, body: unknown): Promise<MemberDto> => {
  assertCan(ctx, "member.update");
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  const current = await loadMember(ctx, id);
  const errors: Record<string, string> = meta.ok ? {} : { ...meta.errors };
  let role = current.role;
  if ("role" in input) {
    if (!ROLES.includes(input["role"] as MemberRoleDb)) errors["role"] = "役割が正しくありません";
    else role = input["role"] as MemberRoleDb;
  }
  let status = current.status;
  if ("status" in input) {
    const s = input["status"];
    if (s === "disabled") status = "disabled";
    else if (s === "active") status = current.auth_user_id ? "active" : "invited";
    else errors["status"] = "状態は active か disabled です";
  }
  let displayName = current.display_name;
  if ("displayName" in input) {
    const d = typeof input["displayName"] === "string" ? input["displayName"].trim() : "";
    if (!d || d.length > 100) errors["displayName"] = "表示名は 1〜100 文字です";
    else displayName = d;
  }
  if (!meta.ok || Object.keys(errors).length > 0) throw new OpsError(400, "invalid_input", errors);
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "member",
    entityId: id,
    op: "update",
    data: { ...memberData(current), role, status, display_name: displayName },
    reason: meta.ok ? meta.data.reason : "",
    actorMemberId: ctx.member.id,
    expectedVersion: meta.ok ? meta.data.expectedVersion : undefined,
  });
  return getMemberDto(ctx, id);
};

export const listMemberVersions = async (ctx: OpsContext, id: string): Promise<VersionDto[]> => {
  assertCan(ctx, "member.read");
  await loadMember(ctx, id);
  return listEntityVersions(ctx, "member", id);
};

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
