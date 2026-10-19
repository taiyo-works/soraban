// 飛行記録・日常点検記録の入力検査（Sprint 11 設計 A・B）。純粋関数。
// API の本文（camelCase）を検査し、版の data（ヘッド表の列名＝snake_case）を作る。誤りは項目ごとに理由コードと文言で返す。
// 操縦者・実施者の氏名と技能証明書番号の写しはサービス層が DB から写す（画面から送らせない）。ここでは受け取らない。
import {
  checkCoordinate,
  flightMinutesFromInput,
  parseJstMinute,
  TIME_ERROR_MESSAGES,
  type CoordinateErrorCode,
} from "@/lib/ops-time";
import {
  INSPECTION_ITEMS,
  INSPECTION_TIMINGS,
  MAX_DEFECTS,
  MAX_LONG_TEXT,
  MAX_PLACE,
  MAX_PURPOSE,
  MAX_WAYPOINTS,
  SPECIFIC_FLIGHT_TYPES,
  type InspectionItemKey,
  type InspectionResult,
  type InspectionTiming,
  type SpecificFlightType,
} from "@/lib/ops-records";

type Input = Readonly<Record<string, unknown>>;
type FieldMap = Readonly<Record<string, string>>;

export type RecordValidated<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly errors: FieldMap; readonly codes: FieldMap };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

const isDate = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const COORD_MESSAGES: Readonly<Record<CoordinateErrorCode | "coordinate_pair", string>> = {
  coordinate_format: "数値（10 進度）で入力してください",
  coordinate_range: "緯度は −90〜90、経度は −180〜180 の範囲です",
  coordinate_precision: "小数は 6 桁までです",
  coordinate_pair: "緯度と経度は両方入力するか、両方空にしてください",
};

/** 誤りを集める小さな道具。 */
const collector = () => {
  const errors: Record<string, string> = {};
  const codes: Record<string, string> = {};
  const fail = (key: string, code: string, message: string): void => {
    if (key in errors) return;
    errors[key] = message;
    codes[key] = code;
  };
  const text = (input: Input, key: string, label: string, max: number, required: boolean): string | null => {
    const raw = input[key];
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      fail(key, "invalid", `${label}は文字で入力してください`);
      return null;
    }
    const v = str(raw);
    if (!v) {
      if (required) fail(key, "required", `${label}を入力してください`);
      return null;
    }
    if (v.length > max) {
      fail(key, "too_long", `${label}は ${max} 文字以内にしてください`);
      return null;
    }
    return v;
  };
  const uuid = (input: Input, key: string, label: string, required: boolean): string | null => {
    const v = input[key];
    if (!present(v)) {
      if (required) fail(key, "required", `${label}を選んでください`);
      return null;
    }
    if (!isUuid(v)) {
      fail(key, "invalid", `${label}が正しくありません`);
      return null;
    }
    return v.toLowerCase();
  };
  /** 場所の緯度・経度・精度（すべて任意。緯度と経度は両方か両方なし）。 */
  const position = (input: Input, latKey: string, lngKey: string, accKey: string) => {
    const hasLat = present(input[latKey]);
    const hasLng = present(input[lngKey]);
    let lat: number | null = null;
    let lng: number | null = null;
    if (hasLat !== hasLng) {
      fail(hasLat ? lngKey : latKey, "coordinate_pair", COORD_MESSAGES.coordinate_pair);
    } else if (hasLat) {
      const a = checkCoordinate(input[latKey], "lat");
      const b = checkCoordinate(input[lngKey], "lng");
      if (!a.ok) fail(latKey, a.code, `緯度：${COORD_MESSAGES[a.code]}`);
      else lat = a.value;
      if (!b.ok) fail(lngKey, b.code, `経度：${COORD_MESSAGES[b.code]}`);
      else lng = b.value;
    }
    let acc: number | null = null;
    const accRaw = input[accKey];
    if (present(accRaw)) {
      const n = typeof accRaw === "number" ? accRaw : Number(accRaw);
      if (!Number.isFinite(n) || n < 0 || n > 100_000) fail(accKey, "invalid", "測位の精度は 0〜100000 m です");
      else if (lat === null) fail(accKey, "invalid", "測位の精度は緯度・経度と一緒に入力してください");
      else acc = Math.round(n);
    }
    return { lat, lng, acc };
  };
  const result = <T>(data: () => T): RecordValidated<T> =>
    Object.keys(errors).length > 0 ? { ok: false, errors, codes } : { ok: true, data: data() };
  return { fail, text, uuid, position, result };
};

// ---- 飛行記録 ------------------------------------------------

export type DefectData = {
  readonly occurred_on: string;
  readonly description: string;
  readonly action_on: string | null;
  readonly action: string | null;
  readonly confirmer_name: string | null;
};

/** 入力検査で作る飛行記録の data（操縦者の写しと DB が求める値を除く）。 */
export type FlightInputData = {
  readonly aircraft_id: string;
  readonly pilot_id: string;
  readonly daily_inspection_id: string | null;
  readonly purpose: string;
  readonly waypoints: string | null;
  readonly specific_flight_types: readonly SpecificFlightType[];
  readonly takeoff_place: string;
  readonly takeoff_lat: number | null;
  readonly takeoff_lng: number | null;
  readonly takeoff_accuracy_m: number | null;
  readonly landing_place: string;
  readonly landing_lat: number | null;
  readonly landing_lng: number | null;
  readonly landing_accuracy_m: number | null;
  /** JST の `YYYY-MM-DDTHH:MM`。DB が timestamptz にする。 */
  readonly takeoff_at: string;
  readonly landing_at: string;
  readonly safety_issue: boolean;
  readonly safety_issue_detail: string | null;
  readonly defects: readonly DefectData[];
};

/** 飛行記録の項目（API の名前 → data の列名）。訂正の合成と、版の差分の項目名に使う。 */
export const FLIGHT_FIELDS = {
  aircraftId: "aircraft_id",
  pilotId: "pilot_id",
  dailyInspectionId: "daily_inspection_id",
  purpose: "purpose",
  waypoints: "waypoints",
  specificFlightTypes: "specific_flight_types",
  takeoffPlace: "takeoff_place",
  takeoffLat: "takeoff_lat",
  takeoffLng: "takeoff_lng",
  takeoffAccuracyM: "takeoff_accuracy_m",
  landingPlace: "landing_place",
  landingLat: "landing_lat",
  landingLng: "landing_lng",
  landingAccuracyM: "landing_accuracy_m",
  takeoffAt: "takeoff_at",
  landingAt: "landing_at",
  safetyIssue: "safety_issue",
  safetyIssueDetail: "safety_issue_detail",
  defects: "defects",
} as const;

export const FLIGHT_FIELD_LABELS: Readonly<Record<string, string>> = {
  aircraft_id: "機体",
  pilot_id: "操縦者",
  daily_inspection_id: "日常点検",
  purpose: "飛行の目的",
  waypoints: "経由地",
  specific_flight_types: "特定飛行の形態",
  takeoff_place: "離陸場所",
  takeoff_lat: "離陸場所の緯度",
  takeoff_lng: "離陸場所の経度",
  takeoff_accuracy_m: "離陸場所の測位の精度",
  landing_place: "着陸場所",
  landing_lat: "着陸場所の緯度",
  landing_lng: "着陸場所の経度",
  landing_accuracy_m: "着陸場所の測位の精度",
  takeoff_at: "離陸時刻",
  landing_at: "着陸時刻",
  safety_issue: "飛行の安全に影響のあった事項の有無",
  safety_issue_detail: "飛行の安全に影響のあった事項の内容",
  defects: "不具合",
  pilot_name: "操縦者の氏名（写し）",
  pilot_license_number: "技能証明書番号（写し）",
  pilot_version: "写した操縦者の版",
  flight_minutes: "飛行時間",
  flight_date: "飛行年月日",
  client_request_id: "送信の識別子",
  flight_plan_id: "飛行計画",
  snapshot_id: "判定スナップショット",
};

const FLIGHT_TYPE_KEYS: readonly string[] = SPECIFIC_FLIGHT_TYPES.map((t) => t.key);

const validateDefects = (raw: unknown, c: ReturnType<typeof collector>): DefectData[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    c.fail("defects", "invalid", "不具合の形が正しくありません");
    return [];
  }
  if (raw.length > MAX_DEFECTS) {
    c.fail("defects", "too_many", `不具合は ${MAX_DEFECTS} 件までです`);
    return [];
  }
  const out: DefectData[] = [];
  raw.forEach((d: unknown, i) => {
    const k = (f: string) => `defects.${i}.${f}`;
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      c.fail(`defects.${i}`, "invalid", "不具合の形が正しくありません");
      return;
    }
    const o = d as Input;
    const date = (f: string, label: string, required: boolean): string | null => {
      const v = str(o[f]);
      if (!v) {
        if (required) c.fail(k(f), "required", `${label}を入力してください`);
        return null;
      }
      if (!isDate(v)) {
        c.fail(k(f), "date_format", `${label}は YYYY-MM-DD の日付で入力してください`);
        return null;
      }
      return v;
    };
    const t = (f: string, label: string, max: number, required: boolean): string | null => {
      const v = str(o[f]);
      if (!v) {
        if (required) c.fail(k(f), "required", `${label}を入力してください`);
        return null;
      }
      if (v.length > max) {
        c.fail(k(f), "too_long", `${label}は ${max} 文字以内にしてください`);
        return null;
      }
      return v;
    };
    const occurred = date("occurredOn", "不具合の発生日", true);
    const description = t("description", "不具合事項", MAX_LONG_TEXT, true);
    const actionOn = date("actionOn", "処置日", false);
    const action = t("action", "処置その他", MAX_LONG_TEXT, false);
    const confirmer = t("confirmerName", "確認者の氏名", MAX_PLACE, false);
    if (occurred && description) {
      out.push({ occurred_on: occurred, description, action_on: actionOn, action, confirmer_name: confirmer });
    }
  });
  return out;
};

/**
 * 飛行記録の入力検査。now は離陸が未来でないかの判定に使う（省略すると判定しない）。
 * 時刻の誤り（形・順序・長さ・未来）は takeoffAt または landingAt に理由コードで返す。
 */
export const validateFlight = (input: Input, now?: Date): RecordValidated<FlightInputData> => {
  const c = collector();
  const aircraftId = c.uuid(input, "aircraftId", "機体", true);
  const pilotId = c.uuid(input, "pilotId", "操縦者", true);
  const inspectionId = c.uuid(input, "dailyInspectionId", "日常点検", false);
  const purpose = c.text(input, "purpose", "飛行の目的", MAX_PURPOSE, true);
  const waypoints = c.text(input, "waypoints", "経由地", MAX_WAYPOINTS, false);

  let types: SpecificFlightType[] = [];
  const rawTypes = input["specificFlightTypes"];
  if (rawTypes !== undefined && rawTypes !== null) {
    if (!Array.isArray(rawTypes) || rawTypes.some((t) => typeof t !== "string")) {
      c.fail("specificFlightTypes", "invalid", "特定飛行の形態の形が正しくありません");
    } else if (rawTypes.some((t) => !FLIGHT_TYPE_KEYS.includes(t as string))) {
      c.fail("specificFlightTypes", "unknown_value", "特定飛行の形態に選択肢にない値があります");
    } else {
      // 重複を除き、定義の順に並べる（版の差分が並び順で出ないようにする）
      const set = new Set(rawTypes as string[]);
      types = FLIGHT_TYPE_KEYS.filter((k) => set.has(k)) as SpecificFlightType[];
    }
  }

  const takeoffPlace = c.text(input, "takeoffPlace", "離陸場所", MAX_PLACE, true);
  const tPos = c.position(input, "takeoffLat", "takeoffLng", "takeoffAccuracyM");
  const landingPlace = c.text(input, "landingPlace", "着陸場所", MAX_PLACE, true);
  const lPos = c.position(input, "landingLat", "landingLng", "landingAccuracyM");

  const takeoffAt = input["takeoffAt"];
  const landingAt = input["landingAt"];
  const tOk = parseJstMinute(takeoffAt) !== null;
  const lOk = parseJstMinute(landingAt) !== null;
  if (!present(takeoffAt)) c.fail("takeoffAt", "required", "離陸時刻を入力してください");
  else if (!tOk) c.fail("takeoffAt", "time_format", TIME_ERROR_MESSAGES.time_format);
  if (!present(landingAt)) c.fail("landingAt", "required", "着陸時刻を入力してください");
  else if (!lOk) c.fail("landingAt", "time_format", TIME_ERROR_MESSAGES.time_format);
  if (tOk && lOk) {
    const r = flightMinutesFromInput(takeoffAt, landingAt, now);
    if (!r.ok) c.fail(r.code === "takeoff_in_future" ? "takeoffAt" : "landingAt", r.code, TIME_ERROR_MESSAGES[r.code]);
  }

  const safety = input["safetyIssue"];
  let detail: string | null = null;
  if (typeof safety !== "boolean") c.fail("safetyIssue", "required", "飛行の安全に影響のあった事項の有無を選んでください");
  else if (safety) {
    detail = c.text(input, "safetyIssueDetail", "飛行の安全に影響のあった事項の内容", MAX_LONG_TEXT, false);
    // 長すぎる等で既に誤りにした場合は fail が何もしない（最初の誤りだけを返す）
    if (!detail) c.fail("safetyIssueDetail", "detail_required", "「あり」の場合は内容を入力してください");
  }

  const defects = validateDefects(input["defects"], c);

  return c.result(() => ({
    aircraft_id: aircraftId!,
    pilot_id: pilotId!,
    daily_inspection_id: inspectionId,
    purpose: purpose!,
    waypoints,
    specific_flight_types: types,
    takeoff_place: takeoffPlace!,
    takeoff_lat: tPos.lat,
    takeoff_lng: tPos.lng,
    takeoff_accuracy_m: tPos.acc,
    landing_place: landingPlace!,
    landing_lat: lPos.lat,
    landing_lng: lPos.lng,
    landing_accuracy_m: lPos.acc,
    takeoff_at: takeoffAt as string,
    landing_at: landingAt as string,
    safety_issue: safety as boolean,
    safety_issue_detail: safety ? detail : null,
    defects,
  }));
};

// ---- 日常点検記録 --------------------------------------------

export type InspectionItemData = { readonly result: InspectionResult; readonly note: string | null };

export type InspectionInputData = {
  readonly aircraft_id: string;
  readonly pilot_id: string;
  /** JST の `YYYY-MM-DDTHH:MM`。 */
  readonly inspected_at: string;
  readonly timing: InspectionTiming;
  readonly place_name: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracy_m: number | null;
  readonly items: Readonly<Record<InspectionItemKey, InspectionItemData>>;
  readonly special_notes: string | null;
};

export const INSPECTION_FIELDS = {
  aircraftId: "aircraft_id",
  pilotId: "pilot_id",
  inspectedAt: "inspected_at",
  timing: "timing",
  placeName: "place_name",
  latitude: "latitude",
  longitude: "longitude",
  accuracyM: "accuracy_m",
  items: "items",
  specialNotes: "special_notes",
} as const;

export const INSPECTION_FIELD_LABELS: Readonly<Record<string, string>> = {
  aircraft_id: "機体",
  pilot_id: "実施者",
  inspected_at: "実施日時",
  inspected_date: "実施年月日",
  timing: "区分",
  place_name: "実施場所",
  latitude: "実施場所の緯度",
  longitude: "実施場所の経度",
  accuracy_m: "実施場所の測位の精度",
  items: "点検項目の結果",
  has_abnormal: "異常の有無",
  special_notes: "特記事項",
  inspector_name: "実施者の氏名（写し）",
  inspector_version: "写した操縦者の版",
  client_request_id: "送信の識別子",
};

export const validateInspection = (input: Input, now?: Date): RecordValidated<InspectionInputData> => {
  const c = collector();
  const aircraftId = c.uuid(input, "aircraftId", "機体", true);
  const pilotId = c.uuid(input, "pilotId", "実施者", true);

  const at = input["inspectedAt"];
  const atDate = parseJstMinute(at);
  if (!present(at)) c.fail("inspectedAt", "required", "実施日時を入力してください");
  else if (!atDate) c.fail("inspectedAt", "time_format", TIME_ERROR_MESSAGES.time_format);
  else if (now && atDate.getTime() > Math.floor(now.getTime() / 60_000) * 60_000) {
    c.fail("inspectedAt", "in_future", "実施日時が現在より後です");
  }

  const timingRaw = input["timing"] ?? "pre_flight";
  if (!INSPECTION_TIMINGS.includes(timingRaw as InspectionTiming)) c.fail("timing", "unknown_value", "区分は飛行前か飛行後です");

  const placeName = c.text(input, "placeName", "実施場所", MAX_PLACE, true);
  const pos = c.position(input, "latitude", "longitude", "accuracyM");

  const rawItems = input["items"];
  const items: Partial<Record<InspectionItemKey, InspectionItemData>> = {};
  if (!rawItems || typeof rawItems !== "object" || Array.isArray(rawItems)) {
    c.fail("items", "required", "点検項目の結果を入力してください");
  } else {
    const obj = rawItems as Input;
    for (const key of Object.keys(obj)) {
      if (!INSPECTION_ITEMS.some((it) => it.key === key)) c.fail(`items.${key}`, "unknown_value", "点検項目にない項目です");
    }
    for (const it of INSPECTION_ITEMS) {
      const k = `items.${it.key}`;
      const v = obj[it.key];
      const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Input) : null;
      const result = o ? o["result"] : undefined;
      if (result === undefined || result === null || result === "") {
        c.fail(k, "required", `${it.label}の結果（正常・異常）を選んでください`);
        continue;
      }
      if (result !== "normal" && result !== "abnormal") {
        c.fail(k, "invalid_result", `${it.label}の結果は「正常」か「異常」です`);
        continue;
      }
      const noteRaw = o!["note"];
      const note = str(noteRaw);
      if (note && note.length > MAX_LONG_TEXT) {
        c.fail(`${k}.note`, "too_long", `${it.label}の備考は ${MAX_LONG_TEXT} 文字以内にしてください`);
        continue;
      }
      if (result === "abnormal" && !note) {
        c.fail(`${k}.note`, "note_required", `${it.label}が「異常」の場合は備考を入力してください`);
        continue;
      }
      items[it.key] = { result, note };
    }
  }
  const specialNotes = c.text(input, "specialNotes", "特記事項", MAX_LONG_TEXT, false);

  return c.result(() => ({
    aircraft_id: aircraftId!,
    pilot_id: pilotId!,
    inspected_at: at as string,
    timing: timingRaw as InspectionTiming,
    place_name: placeName!,
    latitude: pos.lat,
    longitude: pos.lng,
    accuracy_m: pos.acc,
    items: items as Record<InspectionItemKey, InspectionItemData>,
    special_notes: specialNotes,
  }));
};

/** 送信の識別子（二重送信の防止）。UUID でなければ無視せず 400。 */
export const parseClientRequestId = (v: unknown): { ok: true; value: string | null } | { ok: false } => {
  if (!present(v)) return { ok: true, value: null };
  return isUuid(v) ? { ok: true, value: v.toLowerCase() } : { ok: false };
};
