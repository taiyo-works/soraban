// 許可・承認の登録の入力検査（Sprint 12d 設計 B・F）。純粋関数。
// API の本文（camelCase）を検査し、版の data（ヘッド表の列名＝snake_case）を作る。誤りは項目ごとに理由コードと文言で返す。
// 許可番号の鍵（permit_number_key）は normalizePermitNumber で作って data に入れる（DB は一意性だけを守る）。
// 状態（status）・失効日・取得元・外部の参照は、作成では決まった値（有効・なし・manual・空）。失効はサービス層の revoke が行う。
// 機体・操縦者が同じ組織のものかは、サービス層と DB のトリガーが確かめる（ここでは形だけ）。
import { checkCoordinate } from "@/lib/ops-time";
import { addDays, normalizePermitNumber, PERMIT_KINDS, PERMIT_NUMBER_SEPARATORS, type PermitKind } from "./permit-logic";
import { COORD_MESSAGES, collector, isUuid, present, type RecordValidated } from "./validate-records";

type Input = Readonly<Record<string, unknown>>;

export const MAX_PERMIT_NUMBER = 60;
export const MAX_AIRPORT_NAMES = 5;
export const MAX_AIRPORT_NAME = 50;
export const MAX_CIRCLES = 10;
export const MAX_CIRCLE_NAME = 50;
export const MAX_CIRCLE_RADIUS_M = 100_000;
export const MAX_PLACE_TEXT = 300;
export const MAX_SCOPE_IDS = 50;
export const MAX_PERMIT_ALTITUDE_M = 2000;
export const MAX_PERMIT_WEIGHT_KG = 999.99;
export const MAX_CONDITIONS_TEXT = 1000;

/**
 * 利用者の入力に含めさせない語（通報の不要を断言する言い方）。画面・API の文言にこの語を出さないための検査で、
 * 禁止語の grep（sprint11g.test.ts）に自分自身が当たらないよう、語を分けて持つ。
 */
export const FORBIDDEN_PHRASES: readonly string[] = [
  ["通報", "不要"],
  ["通報", "は不要"],
  ["通報の必要", "はありません"],
  ["通報", "しなくて"],
].map((parts) => parts.join(""));

export type PermitInputData = {
  readonly permit_number: string;
  readonly permit_number_key: string;
  readonly coverage: "blanket" | "individual";
  readonly kinds: readonly PermitKind[];
  readonly airport_names: readonly string[];
  readonly issued_on: string;
  readonly valid_from: string;
  readonly valid_to: string;
  readonly status: "active";
  readonly revoked_on: null;
  readonly place_scope: PlaceScopeData;
  readonly aircraft_scope: ListedScopeData;
  readonly pilot_scope: ListedScopeData;
  readonly max_altitude_m: number | null;
  readonly max_weight_kg: number | null;
  readonly requires_observer: boolean;
  readonly requires_access_control: boolean;
  readonly conditions_text: string | null;
  readonly source: "manual";
  readonly external_ref: Record<string, never>;
};

export type PlaceScopeData =
  | { readonly type: "nationwide" }
  | { readonly type: "circles"; readonly circles: readonly { readonly name?: string; readonly lat: number; readonly lng: number; readonly radiusM: number }[] }
  | { readonly type: "text"; readonly text: string };

export type ListedScopeData = { readonly type: "any" } | { readonly type: "listed"; readonly ids: readonly string[] };

/** 登録の項目（API の名前 → data の列名）。訂正の合成と、版の差分の項目名に使う。 */
export const PERMIT_FIELDS = {
  permitNumber: "permit_number",
  coverage: "coverage",
  kinds: "kinds",
  airportNames: "airport_names",
  issuedOn: "issued_on",
  validFrom: "valid_from",
  validTo: "valid_to",
  placeScope: "place_scope",
  aircraftScope: "aircraft_scope",
  pilotScope: "pilot_scope",
  maxAltitudeM: "max_altitude_m",
  maxWeightKg: "max_weight_kg",
  requiresObserver: "requires_observer",
  requiresAccessControl: "requires_access_control",
  conditionsText: "conditions_text",
} as const;

export const PERMIT_FIELD_LABELS: Readonly<Record<string, string>> = {
  permit_number: "許可・承認の番号",
  permit_number_key: "番号の照合の鍵",
  coverage: "包括／個別",
  kinds: "許可・承認の種類",
  airport_names: "空港名",
  issued_on: "許可書発行日",
  valid_from: "許可期間（自）",
  valid_to: "許可期間（至）",
  status: "状態",
  revoked_on: "失効日",
  place_scope: "場所の範囲",
  aircraft_scope: "機体の範囲",
  pilot_scope: "操縦者の範囲",
  max_altitude_m: "最大高度の条件",
  max_weight_kg: "機体重量の条件",
  requires_observer: "補助者の配置の条件",
  requires_access_control: "立入管理措置の条件",
  conditions_text: "照合できない条件（文章）",
  source: "取得元",
  external_ref: "外部の参照",
};

const isDate = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const hasForbidden = (s: string): boolean => FORBIDDEN_PHRASES.some((p) => s.includes(p));

const asObject = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** 許可・承認の登録の入力検査（作成。訂正は既存の値に入力を重ねてから同じ検査を通す）。 */
export const validatePermitRegistration = (input: Input): RecordValidated<PermitInputData> => {
  const c = collector();

  // 番号
  let number: string | null = null;
  const rawNumber = input["permitNumber"];
  if (rawNumber !== undefined && rawNumber !== null && typeof rawNumber !== "string") {
    c.fail("permitNumber", "invalid", "許可・承認の番号は文字で入力してください");
  } else {
    const t = typeof rawNumber === "string" ? rawNumber.trim() : "";
    if (t === "") c.fail("permitNumber", "required", "許可・承認の番号を入力してください");
    else if (t.length > MAX_PERMIT_NUMBER) c.fail("permitNumber", "too_long", `許可・承認の番号は ${MAX_PERMIT_NUMBER} 文字以内にしてください`);
    else if (PERMIT_NUMBER_SEPARATORS.test(t)) {
      c.fail("permitNumber", "invalid_char", "許可・承認の番号に区切り文字（, ， 、 ; ；）や改行は使えません。1 通ずつ登録してください");
    } else if (hasForbidden(t)) c.fail("permitNumber", "forbidden_phrase", "使えない語が含まれています");
    else number = t;
  }

  // 包括・個別
  const coverageRaw = input["coverage"];
  let coverage: "blanket" | "individual" | null = null;
  if (!present(coverageRaw)) c.fail("coverage", "required", "包括許可か個別許可かを選んでください");
  else if (coverageRaw !== "blanket" && coverageRaw !== "individual") c.fail("coverage", "unknown_value", "包括許可か個別許可かを選んでください");
  else coverage = coverageRaw;

  // 種類（重複を除き、定義の順に並べる）
  let kinds: PermitKind[] = [];
  const rawKinds = input["kinds"];
  if (!Array.isArray(rawKinds) || rawKinds.length === 0) {
    c.fail("kinds", rawKinds === undefined || rawKinds === null || (Array.isArray(rawKinds) && rawKinds.length === 0) ? "required" : "invalid", "許可・承認の種類を 1 つ以上選んでください");
  } else if (rawKinds.some((k) => typeof k !== "string" || !(PERMIT_KINDS as readonly string[]).includes(k))) {
    c.fail("kinds", "unknown_value", "許可・承認の種類に選択肢にない値があります");
  } else {
    const set = new Set(rawKinds as string[]);
    kinds = PERMIT_KINDS.filter((k) => set.has(k));
  }
  const hasAirport = kinds.includes("airport");
  if (hasAirport && coverage === "blanket") {
    c.fail("kinds", "airport_not_blanket", "空港等周辺の許可は個別許可だけです（包括許可には含められません）");
  }

  // 空港名（空港等周辺を含むときだけ）
  let airportNames: string[] = [];
  let namesFailed = false;
  const nameFail = (code: string, message: string): void => {
    namesFailed = true;
    c.fail("airportNames", code, message);
  };
  const rawNames = input["airportNames"];
  if (rawNames !== undefined && rawNames !== null) {
    if (!Array.isArray(rawNames) || rawNames.some((n) => typeof n !== "string")) nameFail("invalid", "空港名の形が正しくありません");
    else {
      const names = (rawNames as string[]).map((n) => n.trim()).filter((n) => n !== "");
      if (names.length > MAX_AIRPORT_NAMES) nameFail("too_many", `空港名は ${MAX_AIRPORT_NAMES} 件までです`);
      else if (names.some((n) => n.length > MAX_AIRPORT_NAME)) nameFail("too_long", `空港名は ${MAX_AIRPORT_NAME} 文字以内にしてください`);
      else if (names.some(hasForbidden)) nameFail("forbidden_phrase", "使えない語が含まれています");
      else airportNames = hasAirport ? names : [];
    }
  }
  if (hasAirport && airportNames.length === 0 && !namesFailed) {
    c.fail("airportNames", "required", "空港等周辺の許可には、どの空港の許可かを 1 件以上入力してください");
  }

  // 日付
  const dateField = (key: string, label: string): string | null => {
    const raw = input[key];
    if (!present(raw)) {
      c.fail(key, "required", `${label}を入力してください`);
      return null;
    }
    if (typeof raw !== "string" || !isDate(raw)) {
      c.fail(key, "date_format", `${label}は YYYY-MM-DD の日付で入力してください`);
      return null;
    }
    return raw;
  };
  const issuedOn = dateField("issuedOn", "許可書発行日");
  const validFrom = dateField("validFrom", "許可期間（自）");
  const validTo = dateField("validTo", "許可期間（至）");
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    c.fail("validTo", "period_order", "許可期間（至）は自の日以降にしてください");
  }

  // 場所の範囲
  let placeScope: PlaceScopeData | null = null;
  const ps = asObject(input["placeScope"]);
  if (ps === null) c.fail("placeScope", present(input["placeScope"]) ? "invalid" : "required", "場所の範囲を選んでください");
  else if (ps["type"] === "nationwide") {
    if (coverage === "individual") c.fail("placeScope", "individual_not_nationwide", "個別許可は全国を範囲にできません。円か文章で入力してください");
    else if (hasAirport) c.fail("placeScope", "airport_place", "空港等周辺の許可の場所は、円か文章で入力してください");
    else placeScope = { type: "nationwide" };
  } else if (ps["type"] === "circles") {
    const raw = ps["circles"];
    if (!Array.isArray(raw) || raw.length === 0) c.fail("placeScope", "required", "円を 1 件以上入力してください");
    else if (raw.length > MAX_CIRCLES) c.fail("placeScope", "too_many", `円は ${MAX_CIRCLES} 件までです`);
    else {
      const circles: { name?: string; lat: number; lng: number; radiusM: number }[] = [];
      let bad = false;
      for (const item of raw) {
        const o = asObject(item);
        if (o === null) {
          bad = true;
          c.fail("placeScope", "invalid", "円の形が正しくありません");
          break;
        }
        const a = checkCoordinate(o["lat"], "lat");
        const b = checkCoordinate(o["lng"], "lng");
        if (!a.ok) {
          bad = true;
          c.fail("placeScope", a.code, `円の緯度：${COORD_MESSAGES[a.code]}`);
        }
        if (!b.ok) {
          bad = true;
          c.fail("placeScope", b.code, `円の経度：${COORD_MESSAGES[b.code]}`);
        }
        const r = o["radiusM"];
        const rn = typeof r === "number" ? r : typeof r === "string" && r.trim() !== "" ? Number(r.trim()) : NaN;
        if (!Number.isInteger(rn) || rn < 1 || rn > MAX_CIRCLE_RADIUS_M) {
          bad = true;
          c.fail("placeScope", "radius_out_of_range", `円の半径は 1〜${MAX_CIRCLE_RADIUS_M} m の整数で入力してください`);
        }
        let name: string | undefined;
        const rawName = o["name"];
        if (present(rawName)) {
          if (typeof rawName !== "string" || rawName.trim().length > MAX_CIRCLE_NAME) {
            bad = true;
            c.fail("placeScope", "name_too_long", `円の名称は ${MAX_CIRCLE_NAME} 文字以内にしてください`);
          } else if (hasForbidden(rawName)) {
            bad = true;
            c.fail("placeScope", "forbidden_phrase", "使えない語が含まれています");
          } else name = rawName.trim();
        }
        if (!bad && a.ok && b.ok) circles.push({ ...(name ? { name } : {}), lat: a.value, lng: b.value, radiusM: rn });
      }
      if (!bad) placeScope = { type: "circles", circles };
    }
  } else if (ps["type"] === "text") {
    const t = ps["text"];
    if (t !== undefined && t !== null && typeof t !== "string") c.fail("placeScope", "invalid", "場所の文章は文字で入力してください");
    else {
      const text = typeof t === "string" ? t.trim() : "";
      if (text.length > MAX_PLACE_TEXT) c.fail("placeScope", "too_long", `場所の文章は ${MAX_PLACE_TEXT} 文字以内にしてください`);
      else if (hasForbidden(text)) c.fail("placeScope", "forbidden_phrase", "使えない語が含まれています");
      else placeScope = { type: "text", text };
    }
  } else c.fail("placeScope", "unknown_value", "場所の範囲は 全国・円・文章のみ のいずれかです");

  // 機体・操縦者の範囲
  const listed = (key: string, label: string): ListedScopeData | null => {
    const o = asObject(input[key]);
    if (o === null) {
      c.fail(key, present(input[key]) ? "invalid" : "required", `${label}の範囲を選んでください（限定しない／選ぶ）`);
      return null;
    }
    if (o["type"] === "any") return { type: "any" };
    if (o["type"] === "listed") {
      const ids = o["ids"];
      if (!Array.isArray(ids) || ids.length === 0) {
        c.fail(key, "required", `${label}を 1 件以上選んでください`);
        return null;
      }
      if (ids.some((x) => !isUuid(x))) {
        c.fail(key, "invalid", `${label}の指定が正しくありません`);
        return null;
      }
      const uniq = [...new Set((ids as string[]).map((x) => x.toLowerCase()))];
      if (uniq.length > MAX_SCOPE_IDS) {
        c.fail(key, "too_many", `${label}は ${MAX_SCOPE_IDS} 件までです`);
        return null;
      }
      return { type: "listed", ids: uniq };
    }
    c.fail(key, "unknown_value", `${label}の範囲は 限定しない／選ぶ のいずれかです`);
    return null;
  };
  const aircraftScope = listed("aircraftScope", "機体");
  const pilotScope = listed("pilotScope", "操縦者");

  // 条件
  const intIn = (key: string, label: string, min: number, max: number): number | null => {
    const raw = input[key];
    if (!present(raw)) return null;
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
  const maxAltitude = intIn("maxAltitudeM", "最大高度（m）", 0, MAX_PERMIT_ALTITUDE_M);
  let maxWeight: number | null = null;
  const rawWeight = input["maxWeightKg"];
  if (present(rawWeight)) {
    const n = typeof rawWeight === "number" ? rawWeight : typeof rawWeight === "string" && rawWeight.trim() !== "" ? Number(rawWeight.trim()) : NaN;
    if (!Number.isFinite(n)) c.fail("maxWeightKg", "invalid", "機体重量の条件は数値（kg）で入力してください");
    else if (n < 0 || n > MAX_PERMIT_WEIGHT_KG) c.fail("maxWeightKg", "out_of_range", `機体重量の条件は 0〜${MAX_PERMIT_WEIGHT_KG} kg の範囲で入力してください`);
    else if (Math.round(n * 100) / 100 !== n) c.fail("maxWeightKg", "precision", "機体重量の条件は小数第 2 位までです");
    else maxWeight = n;
  }
  const bool = (key: string, label: string): boolean => {
    const v = input[key];
    if (v === undefined || v === null) return false;
    if (typeof v !== "boolean") {
      c.fail(key, "invalid", `${label}は はい／いいえ で指定してください`);
      return false;
    }
    return v;
  };
  const requiresObserver = bool("requiresObserver", "補助者の配置の条件");
  const requiresAccessControl = bool("requiresAccessControl", "立入管理措置の条件");
  const conditionsText = c.text(input, "conditionsText", "照合できない条件", MAX_CONDITIONS_TEXT, false);
  if (conditionsText !== null && hasForbidden(conditionsText)) c.fail("conditionsText", "forbidden_phrase", "使えない語が含まれています");

  return c.result(() => ({
    permit_number: number!,
    permit_number_key: normalizePermitNumber(number!),
    coverage: coverage!,
    kinds,
    airport_names: airportNames,
    issued_on: issuedOn!,
    valid_from: validFrom!,
    valid_to: validTo!,
    status: "active",
    revoked_on: null,
    place_scope: placeScope!,
    aircraft_scope: aircraftScope!,
    pilot_scope: pilotScope!,
    max_altitude_m: maxAltitude,
    max_weight_kg: maxWeight,
    requires_observer: requiresObserver,
    requires_access_control: requiresAccessControl,
    conditions_text: conditionsText,
    source: "manual",
    external_ref: {},
  }));
};

/** 失効の入力（失効日 YYYY-MM-DD。この日以降は使えない）。理由・版は validateChangeMeta が検査する。 */
export const validateRevokedOn = (input: Input): RecordValidated<{ readonly revoked_on: string }> => {
  const c = collector();
  const raw = input["revokedOn"];
  let v: string | null = null;
  if (!present(raw)) c.fail("revokedOn", "required", "失効日を入力してください");
  else if (typeof raw !== "string" || !isDate(raw)) c.fail("revokedOn", "date_format", "失効日は YYYY-MM-DD の日付で入力してください");
  else v = raw;
  return c.result(() => ({ revoked_on: v! }));
};

/** 失効日の前日（有効な最終日）。画面の説明に使う。 */
export const lastValidDayBefore = (revokedOn: string): string => addDays(revokedOn, -1);
