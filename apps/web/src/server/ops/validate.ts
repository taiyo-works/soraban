// 機体・操縦者・利用者の入力検査（Sprint 10 設計 D）。純粋関数。
// API の本文（camelCase）を検査し、版の data（ヘッド表の列名＝snake_case）を作る。誤りは項目ごとの理由で返す。
import type { AircraftStatusDb, CertClassDb, MemberRoleDb } from "@soraban/db";

export type FieldErrors = Readonly<Record<string, string>>;
export type Validated<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly errors: FieldErrors };

type Input = Readonly<Record<string, unknown>>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const isUuid = (v: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// ---- 機体 ----------------------------------------------------

export type AircraftData = {
  readonly registration_mark: string;
  readonly model_name: string;
  readonly manufacturer: string;
  readonly serial_number: string;
  readonly type_certified: boolean;
  readonly type_cert_category: string | null;
  readonly type_cert_model: string | null;
  readonly type_cert_number: string | null;
  readonly airworthiness_class: CertClassDb | null;
  readonly airworthiness_cert_number: string | null;
  readonly max_takeoff_weight_kg: number | null;
  readonly initial_flight_minutes: number;
  readonly status: AircraftStatusDb;
};

/** 機体の項目（API の名前 → data の列名）。訂正の差分表示の項目名にも使う。 */
export const AIRCRAFT_FIELDS = {
  registrationMark: "registration_mark",
  modelName: "model_name",
  manufacturer: "manufacturer",
  serialNumber: "serial_number",
  typeCertified: "type_certified",
  typeCertCategory: "type_cert_category",
  typeCertModel: "type_cert_model",
  typeCertNumber: "type_cert_number",
  airworthinessClass: "airworthiness_class",
  airworthinessCertNumber: "airworthiness_cert_number",
  maxTakeoffWeightKg: "max_takeoff_weight_kg",
  initialFlightMinutes: "initial_flight_minutes",
  status: "status",
} as const;

export const AIRCRAFT_FIELD_LABELS: Readonly<Record<string, string>> = {
  registration_mark: "登録記号",
  model_name: "型式名",
  manufacturer: "設計製造者",
  serial_number: "製造番号",
  type_certified: "型式認証の有無",
  type_cert_category: "型式認証の種類",
  type_cert_model: "型式",
  type_cert_number: "型式認証書番号",
  airworthiness_class: "機体認証の区分",
  airworthiness_cert_number: "機体認証書番号",
  max_takeoff_weight_kg: "最大離陸重量",
  initial_flight_minutes: "使用開始時の既存の総飛行時間",
  status: "状態",
};

const AIRCRAFT_STATUSES: readonly AircraftStatusDb[] = ["active", "suspended", "deregistered"];
const CERT_CLASSES: readonly CertClassDb[] = ["first", "second"];
const MAX_TEXT = 100;

export const validateAircraft = (input: Input): Validated<AircraftData> => {
  const errors: Record<string, string> = {};
  const text = (key: string, label: string): string | null => {
    const v = str(input[key]);
    if (!v) errors[key] = `${label}を入力してください`;
    else if (v.length > MAX_TEXT) errors[key] = `${label}は ${MAX_TEXT} 文字以内にしてください`;
    return v;
  };

  const regRaw = str(input["registrationMark"]);
  const registration = regRaw ? regRaw.toUpperCase().replace(/[\s-]/g, "") : null;
  if (!registration) errors["registrationMark"] = "登録記号を入力してください";
  else if (!/^JU[A-Z0-9]+$/.test(registration) || registration.length > 20) {
    errors["registrationMark"] = "登録記号は JU で始まる英数字で入力してください";
  }
  const modelName = text("modelName", "型式名");
  const manufacturer = text("manufacturer", "設計製造者");
  const serialNumber = text("serialNumber", "製造番号");

  const typeCertified = input["typeCertified"];
  if (typeof typeCertified !== "boolean") errors["typeCertified"] = "型式認証の有無を選んでください";
  let typeCertCategory: string | null = null;
  let typeCertModel: string | null = null;
  let typeCertNumber: string | null = null;
  if (typeCertified === true) {
    typeCertCategory = text("typeCertCategory", "型式認証の種類");
    typeCertModel = text("typeCertModel", "型式");
    typeCertNumber = text("typeCertNumber", "型式認証書番号");
  }

  let airworthinessClass: CertClassDb | null = null;
  let airworthinessCertNumber: string | null = null;
  const awc = input["airworthinessClass"];
  if (awc !== undefined && awc !== null && awc !== "") {
    if (!CERT_CLASSES.includes(awc as CertClassDb)) errors["airworthinessClass"] = "機体認証の区分は第一種か第二種です";
    else {
      airworthinessClass = awc as CertClassDb;
      airworthinessCertNumber = text("airworthinessCertNumber", "機体認証書番号");
    }
  } else if (str(input["airworthinessCertNumber"])) {
    errors["airworthinessClass"] = "機体認証書番号を入れる場合は区分を選んでください";
  }

  let mtow: number | null = null;
  const w = input["maxTakeoffWeightKg"];
  if (w !== undefined && w !== null && w !== "") {
    const n = typeof w === "number" ? w : typeof w === "string" ? Number(w) : NaN;
    if (!Number.isFinite(n) || n <= 0 || n >= 1_000_000) errors["maxTakeoffWeightKg"] = "最大離陸重量は正の数で入力してください";
    else if (Math.round(n * 10) !== n * 10) errors["maxTakeoffWeightKg"] = "最大離陸重量は小数第 1 位までです";
    else mtow = n;
  }

  let minutes = 0;
  const m = input["initialFlightMinutes"];
  if (m !== undefined && m !== null && m !== "") {
    if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m > 10_000_000) {
      errors["initialFlightMinutes"] = "既存の総飛行時間は 0 以上の整数（分）で入力してください";
    } else minutes = m;
  }

  const statusIn = input["status"] ?? "active";
  if (!AIRCRAFT_STATUSES.includes(statusIn as AircraftStatusDb)) errors["status"] = "状態が正しくありません";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      registration_mark: registration!,
      model_name: modelName!,
      manufacturer: manufacturer!,
      serial_number: serialNumber!,
      type_certified: typeCertified as boolean,
      type_cert_category: typeCertCategory,
      type_cert_model: typeCertModel,
      type_cert_number: typeCertNumber,
      airworthiness_class: airworthinessClass,
      airworthiness_cert_number: airworthinessCertNumber,
      max_takeoff_weight_kg: mtow,
      initial_flight_minutes: minutes,
      status: statusIn as AircraftStatusDb,
    },
  };
};

// ---- 操縦者 --------------------------------------------------

export type PilotData = {
  readonly full_name: string;
  readonly has_license: boolean;
  readonly license_class: CertClassDb | null;
  readonly license_number: string | null;
  readonly license_expires_on: string | null;
  readonly limitation_type: boolean;
  readonly limitation_weight: boolean;
  readonly limitation_daytime: boolean;
  readonly limitation_vlos: boolean;
  readonly member_id: string | null;
};

export const PILOT_FIELDS = {
  fullName: "full_name",
  hasLicense: "has_license",
  licenseClass: "license_class",
  licenseNumber: "license_number",
  licenseExpiresOn: "license_expires_on",
  limitationType: "limitation_type",
  limitationWeight: "limitation_weight",
  limitationDaytime: "limitation_daytime",
  limitationVlos: "limitation_vlos",
  memberId: "member_id",
} as const;

export const PILOT_FIELD_LABELS: Readonly<Record<string, string>> = {
  full_name: "氏名",
  has_license: "技能証明の有無",
  license_class: "技能証明の区分",
  license_number: "技能証明書番号",
  license_expires_on: "技能証明の有効期限",
  limitation_type: "種類の限定",
  limitation_weight: "重量の限定",
  limitation_daytime: "昼間の限定",
  limitation_vlos: "目視内の限定",
  member_id: "結び付ける利用者",
};

const isDate = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export const validatePilot = (input: Input): Validated<PilotData> => {
  const errors: Record<string, string> = {};
  const fullName = str(input["fullName"]);
  if (!fullName) errors["fullName"] = "氏名を入力してください";
  else if (fullName.length > MAX_TEXT) errors["fullName"] = `氏名は ${MAX_TEXT} 文字以内にしてください`;

  const hasLicense = input["hasLicense"];
  if (typeof hasLicense !== "boolean") errors["hasLicense"] = "技能証明の有無を選んでください";
  let licenseClass: CertClassDb | null = null;
  let licenseNumber: string | null = null;
  const lc = input["licenseClass"];
  const ln = str(input["licenseNumber"]);
  if (hasLicense === true) {
    if (!CERT_CLASSES.includes(lc as CertClassDb)) errors["licenseClass"] = "技能証明の区分（一等・二等）を選んでください";
    else licenseClass = lc as CertClassDb;
    if (!ln) errors["licenseNumber"] = "技能証明書番号を入力してください";
    else if (!/^[A-Za-z0-9-]{1,30}$/.test(ln)) errors["licenseNumber"] = "技能証明書番号は英数字と - の 30 文字以内です";
    else licenseNumber = ln;
  } else if (hasLicense === false) {
    if (ln) errors["licenseNumber"] = "技能証明なしの場合、技能証明書番号は入力できません";
    if (lc !== undefined && lc !== null && lc !== "") errors["licenseClass"] = "技能証明なしの場合、区分は選べません";
  }

  let expires: string | null = null;
  const ex = str(input["licenseExpiresOn"]);
  if (ex) {
    if (!isDate(ex)) errors["licenseExpiresOn"] = "有効期限は YYYY-MM-DD の日付で入力してください";
    else expires = ex;
  }

  const flag = (key: string): boolean => input[key] === true;

  let memberId: string | null = null;
  const mid = input["memberId"];
  if (mid !== undefined && mid !== null && mid !== "") {
    if (typeof mid !== "string" || !isUuid(mid)) errors["memberId"] = "結び付ける利用者が正しくありません";
    else memberId = mid.toLowerCase();
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      full_name: fullName!,
      has_license: hasLicense as boolean,
      license_class: licenseClass,
      license_number: licenseNumber,
      license_expires_on: expires,
      limitation_type: flag("limitationType"),
      limitation_weight: flag("limitationWeight"),
      limitation_daytime: flag("limitationDaytime"),
      limitation_vlos: flag("limitationVlos"),
      member_id: memberId,
    },
  };
};

// ---- 利用者 --------------------------------------------------

const ROLES: readonly MemberRoleDb[] = ["manager", "pilot", "viewer"];

export type MemberInvite = { readonly email: string; readonly display_name: string; readonly role: MemberRoleDb };

export const validateMemberInvite = (input: Input): Validated<MemberInvite> => {
  const errors: Record<string, string> = {};
  const email = str(input["email"])?.toLowerCase() ?? null;
  if (!email) errors["email"] = "メールアドレスを入力してください";
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) errors["email"] = "メールアドレスが正しくありません";
  const displayName = str(input["displayName"]);
  if (!displayName) errors["displayName"] = "表示名を入力してください";
  else if (displayName.length > MAX_TEXT) errors["displayName"] = `表示名は ${MAX_TEXT} 文字以内にしてください`;
  const role = input["role"];
  if (!ROLES.includes(role as MemberRoleDb)) errors["role"] = "役割を選んでください";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { email: email!, display_name: displayName!, role: role as MemberRoleDb } };
};

export const MEMBER_FIELD_LABELS: Readonly<Record<string, string>> = {
  email: "メールアドレス",
  display_name: "表示名",
  role: "役割",
  status: "状態",
  auth_provider: "本人確認の方式",
  auth_user_id: "本人確認の ID",
};

/** 訂正・取消の共通項目（expectedVersion・reason）。 */
export const validateChangeMeta = (
  input: Input,
): Validated<{ readonly expectedVersion: number; readonly reason: string }> => {
  const errors: Record<string, string> = {};
  const v = input["expectedVersion"];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) errors["expectedVersion"] = "版番号が必要です";
  const reason = str(input["reason"]);
  if (!reason) errors["reason"] = "理由を入力してください";
  else if (reason.length > 500) errors["reason"] = "理由は 500 文字以内にしてください";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { expectedVersion: v as number, reason: reason! } };
};

/** 技能証明書番号を末尾 4 桁以外伏せる。 */
export const maskLicenseNumber = (n: string | null): string | null => {
  if (n === null) return null;
  // 伏せ字は桁数が分からない固定長（4 文字）。4 文字以下の番号は末尾を見せると全桁が分かるため、すべて伏せる。
  const tail = n.length > 4 ? n.slice(-4) : "";
  return `****${tail}`;
};
