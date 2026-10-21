// 飛行計画・よく使う地点の入力検査（Sprint 12a 設計 B・E）。純粋関数。
// API の本文（camelCase）を検査し、版の data（ヘッド表の列名＝snake_case）を作る。誤りは項目ごとに理由コードと文言で返す。
// 判定の結果らしき値（verdict・result・snapshot・evidenceId など）はここでも読まない（保存時にサーバーが判定を実行する）。
// 予定日（planned_date）・機体重量の写し（drone_weight_g）・状態・現在のスナップショットはサービス層と DB が決める（受け取らない）。
import { SPECIFIC_FLIGHT_FLAG_LABEL, type SpecificFlightFlag } from "@soraban/regulations";
import { parseJstMinute, TIME_ERROR_MESSAGES, checkCoordinate } from "@/lib/ops-time";
import { DIPS_PERMIT_FROM_REGISTRY_MESSAGE, isDipsPermitValue } from "./permit-logic";
import { COORD_MESSAGES, collector, present, type RecordValidated } from "./validate-records";

type Input = Readonly<Record<string, unknown>>;

export const MAX_PLAN_TITLE = 100;
export const MAX_PLAN_PURPOSE = 100;
export const MAX_PLAN_PLACE = 100;
export const MAX_PERMIT_NUMBERS = 200;
export const MAX_PLAN_NOTES = 500;
export const MAX_PLACE_ADDRESS = 200;
export const MAX_PLACE_NOTE = 200;

/** 判定の目的の例外（判定画面の purpose と同じ値）。 */
export const JUDGEMENT_PURPOSES = ["emergency", "public_duty", "city_event"] as const;
export type JudgementPurpose = (typeof JUDGEMENT_PURPOSES)[number];

/** 飛行の方法・空域のフラグの定義順（固定の順に並べる）。 */
export const PLAN_FLAG_ORDER = Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[];

/**
 * 計画に手入力できる同意・通報・公園・文化庁の値。旧版の値（mlit・合成値）は入れられない。
 * DIPS の許可・承認（mlit・mlit:<種類>）は手入力できない（400 dips_permit_from_registry）。登録の照合から判定に入る（Sprint 12d）。
 */
export const PLAN_PERMIT_VALUES: readonly string[] = [
  "facility_manager",
  "pref_pubsafety_notice",
  "park_manager",
  "bunkacho_or_kyoiku",
];

// ---- 飛行計画 ------------------------------------------------

/** 入力検査で作る飛行計画の data（DB が決める値と、サービス層が決める値を除く）。 */
export type PlanInputData = {
  readonly title: string;
  readonly aircraft_id: string;
  readonly pilot_id: string;
  /** JST の `YYYY-MM-DDTHH:MM`。DB が timestamptz にする。 */
  readonly planned_start_at: string;
  readonly duration_minutes: number;
  readonly purpose: string;
  readonly place_name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radius_m: number | null;
  readonly saved_place_id: string | null;
  readonly max_altitude_m: number | null;
  readonly flags: readonly SpecificFlightFlag[];
  readonly pilot_permits: readonly string[];
  readonly judgement_purpose: JudgementPurpose | null;
  readonly access_control: boolean | null;
  readonly third_party_overflight: boolean | null;
  readonly bvlos_with_observer: boolean | null;
  readonly permit_numbers: string | null;
  readonly notes: string | null;
};

/** 飛行計画の項目（API の名前 → data の列名）。訂正の合成と、版の差分の項目名に使う。 */
export const PLAN_FIELDS = {
  title: "title",
  aircraftId: "aircraft_id",
  pilotId: "pilot_id",
  plannedStartAt: "planned_start_at",
  durationMinutes: "duration_minutes",
  purpose: "purpose",
  placeName: "place_name",
  latitude: "latitude",
  longitude: "longitude",
  radiusM: "radius_m",
  savedPlaceId: "saved_place_id",
  maxAltitudeM: "max_altitude_m",
  flags: "flags",
  pilotPermits: "pilot_permits",
  judgementPurpose: "judgement_purpose",
  accessControl: "access_control",
  thirdPartyOverflight: "third_party_overflight",
  bvlosWithObserver: "bvlos_with_observer",
  permitNumbers: "permit_numbers",
  notes: "notes",
} as const;

export const PLAN_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "計画名",
  aircraft_id: "機体",
  pilot_id: "操縦者",
  planned_start_at: "予定開始",
  duration_minutes: "所要時間",
  planned_date: "予定日",
  purpose: "飛行の目的",
  place_name: "場所の名称",
  latitude: "緯度",
  longitude: "経度",
  radius_m: "範囲の半径",
  saved_place_id: "よく使う地点",
  max_altitude_m: "最大高度",
  flags: "飛行の方法・空域",
  pilot_permits: "許可・承認の種類",
  judgement_purpose: "目的の例外",
  access_control: "立入管理措置",
  third_party_overflight: "第三者上空の飛行",
  bvlos_with_observer: "補助者の配置",
  drone_weight_g: "機体重量（判定時の写し）",
  permit_numbers: "許可・承認の番号",
  notes: "メモ",
  status: "状態",
  current_snapshot_id: "判定スナップショット",
  client_request_id: "送信の識別子",
};

/** 判定に関わる項目（設計 A4）。これを変える訂正は、同じトランザクションで新しいスナップショットを作る。 */
export const PLAN_JUDGEMENT_COLUMNS = [
  "latitude",
  "longitude",
  "flags",
  "max_altitude_m",
  "pilot_permits",
  "judgement_purpose",
  "access_control",
  "third_party_overflight",
  "bvlos_with_observer",
] as const;

const intIn = (
  c: ReturnType<typeof collector>,
  input: Input,
  key: string,
  label: string,
  min: number,
  max: number,
  required: boolean,
): number | null => {
  const raw = input[key];
  if (!present(raw)) {
    if (required) c.fail(key, "required", `${label}を入力してください`);
    return null;
  }
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    c.fail(key, "invalid", `${label}は整数で入力してください`);
    return null;
  }
  if (n < min || n > max) {
    c.fail(key, "out_of_range", `${label}は ${min}〜${max} の範囲で入力してください`);
    return null;
  }
  return n;
};

const boolOrNull = (c: ReturnType<typeof collector>, input: Input, key: string, label: string): boolean | null => {
  const v = input[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "boolean") {
    c.fail(key, "invalid", `${label}は はい／いいえ で指定してください`);
    return null;
  }
  return v;
};

/** 飛行計画の入力検査。 */
export const validatePlan = (input: Input): RecordValidated<PlanInputData> => {
  const c = collector();
  const title = c.text(input, "title", "計画名", MAX_PLAN_TITLE, true);
  const aircraftId = c.uuid(input, "aircraftId", "機体", true);
  const pilotId = c.uuid(input, "pilotId", "操縦者", true);

  const start = input["plannedStartAt"];
  if (!present(start)) c.fail("plannedStartAt", "required", "予定開始を入力してください");
  else if (parseJstMinute(start) === null) c.fail("plannedStartAt", "time_format", TIME_ERROR_MESSAGES.time_format);

  const duration = intIn(c, input, "durationMinutes", "所要時間（分）", 1, 1440, true);
  const purpose = c.text(input, "purpose", "飛行の目的", MAX_PLAN_PURPOSE, true);
  const placeName = c.text(input, "placeName", "場所の名称", MAX_PLAN_PLACE, true);

  let lat: number | null = null;
  let lng: number | null = null;
  if (!present(input["latitude"])) c.fail("latitude", "required", "緯度を入力してください");
  else {
    const a = checkCoordinate(input["latitude"], "lat");
    if (!a.ok) c.fail("latitude", a.code, `緯度：${COORD_MESSAGES[a.code]}`);
    else lat = a.value;
  }
  if (!present(input["longitude"])) c.fail("longitude", "required", "経度を入力してください");
  else {
    const b = checkCoordinate(input["longitude"], "lng");
    if (!b.ok) c.fail("longitude", b.code, `経度：${COORD_MESSAGES[b.code]}`);
    else lng = b.value;
  }

  const radius = intIn(c, input, "radiusM", "範囲の半径（m）", 1, 10_000, false);
  const savedPlaceId = c.uuid(input, "savedPlaceId", "よく使う地点", false);
  const maxAltitude = intIn(c, input, "maxAltitudeM", "最大高度（m）", 0, 2000, false);

  // 飛行の方法・空域のフラグ。重複を除き、定義の順に並べる（版の差分が並び順で出ないようにする）
  let flags: SpecificFlightFlag[] = [];
  const rawFlags = input["flags"];
  if (rawFlags !== undefined && rawFlags !== null) {
    if (!Array.isArray(rawFlags) || rawFlags.some((f) => typeof f !== "string")) {
      c.fail("flags", "invalid", "飛行の方法・空域の形が正しくありません");
    } else if (rawFlags.some((f) => !PLAN_FLAG_ORDER.includes(f as SpecificFlightFlag))) {
      c.fail("flags", "unknown_value", "飛行の方法・空域に選択肢にない値があります");
    } else {
      const set = new Set(rawFlags as string[]);
      flags = PLAN_FLAG_ORDER.filter((k) => set.has(k));
    }
  }

  // 許可・承認・同意の種類。重複を除き、並べ替える
  let permits: string[] = [];
  const rawPermits = input["pilotPermits"];
  if (rawPermits !== undefined && rawPermits !== null) {
    if (!Array.isArray(rawPermits) || rawPermits.some((p) => typeof p !== "string")) {
      c.fail("pilotPermits", "invalid", "許可・承認の種類の形が正しくありません");
    } else if (rawPermits.some((p) => isDipsPermitValue(p as string))) {
      c.fail("pilotPermits", "dips_permit_from_registry", DIPS_PERMIT_FROM_REGISTRY_MESSAGE);
    } else if (rawPermits.some((p) => !PLAN_PERMIT_VALUES.includes(p as string))) {
      c.fail("pilotPermits", "unknown_value", "許可・承認の種類に選択肢にない値があります");
    } else {
      permits = [...new Set(rawPermits as string[])].sort();
    }
  }

  let purposeException: JudgementPurpose | null = null;
  const rawPurpose = input["judgementPurpose"];
  if (rawPurpose !== undefined && rawPurpose !== null && rawPurpose !== "") {
    if (!JUDGEMENT_PURPOSES.includes(rawPurpose as JudgementPurpose)) {
      c.fail("judgementPurpose", "unknown_value", "目的の例外に選択肢にない値があります");
    } else {
      purposeException = rawPurpose as JudgementPurpose;
    }
  }

  const accessControl = boolOrNull(c, input, "accessControl", "立入管理措置");
  const thirdParty = boolOrNull(c, input, "thirdPartyOverflight", "第三者上空の飛行");
  const observer = boolOrNull(c, input, "bvlosWithObserver", "補助者の配置");
  const permitNumbers = c.text(input, "permitNumbers", "許可・承認の番号", MAX_PERMIT_NUMBERS, false);
  const notes = c.text(input, "notes", "メモ", MAX_PLAN_NOTES, false);

  return c.result(() => ({
    title: title!,
    aircraft_id: aircraftId!,
    pilot_id: pilotId!,
    planned_start_at: start as string,
    duration_minutes: duration!,
    purpose: purpose!,
    place_name: placeName!,
    latitude: lat!,
    longitude: lng!,
    radius_m: radius,
    saved_place_id: savedPlaceId,
    max_altitude_m: maxAltitude,
    flags,
    pilot_permits: permits,
    judgement_purpose: purposeException,
    access_control: accessControl,
    third_party_overflight: thirdParty,
    bvlos_with_observer: observer,
    permit_numbers: permitNumbers,
    notes,
  }));
};

// ---- よく使う地点 --------------------------------------------

export type PlaceInputData = {
  readonly name: string;
  readonly address_text: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly note: string | null;
};

export const PLACE_FIELDS = {
  name: "name",
  addressText: "address_text",
  latitude: "latitude",
  longitude: "longitude",
  note: "note",
} as const;

export const PLACE_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "名称",
  address_text: "住所",
  latitude: "緯度",
  longitude: "経度",
  note: "メモ",
};

export const validatePlace = (input: Input): RecordValidated<PlaceInputData> => {
  const c = collector();
  const name = c.text(input, "name", "名称", 100, true);
  const address = c.text(input, "addressText", "住所", MAX_PLACE_ADDRESS, false);
  let lat: number | null = null;
  let lng: number | null = null;
  if (!present(input["latitude"])) c.fail("latitude", "required", "緯度を入力してください");
  else {
    const a = checkCoordinate(input["latitude"], "lat");
    if (!a.ok) c.fail("latitude", a.code, `緯度：${COORD_MESSAGES[a.code]}`);
    else lat = a.value;
  }
  if (!present(input["longitude"])) c.fail("longitude", "required", "経度を入力してください");
  else {
    const b = checkCoordinate(input["longitude"], "lng");
    if (!b.ok) c.fail("longitude", b.code, `経度：${COORD_MESSAGES[b.code]}`);
    else lng = b.value;
  }
  const note = c.text(input, "note", "メモ", MAX_PLACE_NOTE, false);
  return c.result(() => ({ name: name!, address_text: address, latitude: lat!, longitude: lng!, note }));
};

