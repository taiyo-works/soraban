// 通報内容の整形（prepare。Sprint 12b 設計 C）。副作用なし。どのアダプターでも、同じ入力・同じ対応表の版なら同じ結果。
// 項目の値域の根拠は FPR ガイドライン 1.10 版（原本 p46〜52）。対応表（data/report-fields.json）の順に項目を並べる。
//
// 整形の規則：
//   - 名称は 30 文字（コードポイント）まで。超えるときは切り詰めずに警告する。
//   - 所要時間は 5 分単位に切り上げる（終了日時は所要時間から計算されるため、切り上げが安全側）。
//   - 高度は 1〜999 m。未入力・0・999 超は値を変えずに警告する。
//   - 経路は円（Circle）の GeoJSON 文字列だけ。半径が無ければ警告する。コピー対象にしない（座標を表示する）。
//   - 未入力があっても記録はできる（件数は警告として出す）。
//   - 個人情報（技能証明書番号・氏名）は personal の印を付け、通報の記録の写しには入れない（contentOf）。
import { computeFingerprint, fingerprintPartsOf } from "./fingerprint";
import {
  displayFields,
  REPORT_FIELDS,
  type ReportField,
  type ReportFieldsData,
} from "./fields";
import {
  dipsOnlyValue,
  PREPARE_WARNING_MESSAGE,
  type PrepareWarningCode,
} from "./messages";
import type {
  PlanForReport,
  PreparedGroup,
  PreparedItem,
  PreparedItemStatus,
  PreparedReport,
  PrepareWarning,
  ReportKind,
} from "./types";
import { charCount, MAX_REPORT_NAME_CHARS } from "./validate";

const warn = (code: PrepareWarningCode, extra = ""): PrepareWarning => ({
  code,
  message: extra ? `${PREPARE_WARNING_MESSAGE[code]}（${extra}）` : PREPARE_WARNING_MESSAGE[code],
});

/** 項目 1 つの整形結果（対応表の行の情報を足す前）。 */
type Draft = {
  readonly status: PreparedItemStatus;
  readonly value: string | null;
  readonly apiValue: string | null;
  /** 省略時は value（コピーできる状態のとき）。 */
  readonly copyText?: string | null;
  readonly warnings?: readonly PrepareWarning[];
  readonly missing?: boolean;
  /** 必須か（既定は対応表の apiRequired が required）。 */
  readonly required?: boolean;
  readonly copyable?: boolean;
};

const filled = (value: string, apiValue: string = value, extra: Partial<Draft> = {}): Draft => ({
  status: "filled",
  value,
  apiValue,
  ...extra,
});

const absent = (field: ReportField, warnings: readonly PrepareWarning[] = [], required?: boolean): Draft => ({
  status: "missing",
  value: null,
  apiValue: null,
  missing: true,
  warnings,
  ...(required !== undefined ? { required } : { required: field.apiRequired === "required" }),
});

const notApplicable = (): Draft => ({ status: "not_applicable", value: null, apiValue: null, missing: false, required: false });

const AIRSPACE_CODE: Readonly<Record<string, number>> = { airspace_did: 1, airspace_150m: 2, airspace_airport: 3 };
const FLIGHT_TYPE_CODE: Readonly<Record<string, number>> = {
  method_30m: 1,
  method_event: 2,
  method_night: 3,
  method_bvlos: 4,
  method_dangerous: 5,
  method_drop: 6,
};

/** yyyyMMdd□HHmm（□は半角スペース）。 */
export const toApiStartTime = (startAt: string): string => `${startAt.slice(0, 4)}${startAt.slice(5, 7)}${startAt.slice(8, 10)} ${startAt.slice(11, 13)}${startAt.slice(14, 16)}`;

/** 所要時間（分）を 5 分単位に切り上げる（下限 5）。 */
export const roundUpTo5 = (minutes: number): number => Math.max(5, Math.ceil(minutes / 5) * 5);

/** 円の経路の GeoJSON 文字列。半径の置き場所は対応表のデータで決める（原本の不一致。※要確認）。 */
export const buildCircleGeoJson = (
  lat: number,
  lng: number,
  radiusM: number,
  placement: ReportFieldsData["routeFormat"]["circleRadiusPlacement"] = "properties",
): string => {
  const geometry: Record<string, unknown> = { type: "Circle", center: [lng, lat] };
  if (placement === "geometry" || placement === "both") geometry["radius"] = radiusM;
  return JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: placement === "properties" || placement === "both" ? { radius: radiusM } : {},
        geometry,
      },
    ],
  });
};

const codeText = (field: ReportField, code: string | number): string => {
  const label = field.codes?.[String(code)];
  return label ? `${code} ${label}` : String(code);
};

const yesNo = (field: ReportField, v: "1" | "0" | null | undefined, missingWarning?: PrepareWarning): Draft => {
  if (v === undefined || v === null) return absent(field, missingWarning ? [missingWarning] : []);
  const label = field.codes?.[v] ?? v;
  return filled(label, v, { copyText: label });
};

type Ctx = { readonly plan: PlanForReport; readonly fields: ReportFieldsData };

const draftFor = (field: ReportField, { plan, fields }: Ctx): Draft | null => {
  const inputs = plan.inputs;
  switch (field.key) {
    case "name": {
      const base = (inputs.reportName ?? "").trim() || plan.title;
      return filled(base, base, charCount(base) > MAX_REPORT_NAME_CHARS ? { warnings: [warn("name_too_long", `${charCount(base)} 文字`)] } : {});
    }
    case "purposes": {
      const list = inputs.flightPurposes;
      if (!list || list.length === 0) return absent(field);
      const sorted = [...list].sort((a, b) => a - b);
      return filled(sorted.map((c) => codeText(field, c)).join("・"), JSON.stringify(sorted), {
        copyText: sorted.map((c) => field.codes?.[String(c)] ?? String(c)).join("、"),
      });
    }
    case "other_business_text": {
      if (!inputs.flightPurposes?.includes(13)) return notApplicable();
      const t = inputs.otherBusinessText?.trim();
      return t ? filled(t) : absent(field, [warn("purpose_text_missing")], true);
    }
    case "other_non_business_text": {
      if (!inputs.flightPurposes?.includes(16)) return notApplicable();
      const t = inputs.otherNonBusinessText?.trim();
      return t ? filled(t) : absent(field, [warn("purpose_text_missing")], true);
    }
    case "airspace": {
      const codes = [...new Set(plan.snapshot.flags.map((f) => AIRSPACE_CODE[f]).filter((c): c is number => c !== undefined))].sort((a, b) => a - b);
      const warnings = plan.snapshot.flags.includes("airspace_emergency") ? [warn("emergency_airspace")] : [];
      return filled(codes.length === 0 ? "なし" : codes.map((c) => codeText(field, c)).join("・"), JSON.stringify(codes), {
        copyText: codes.length === 0 ? null : codes.map((c) => field.codes?.[String(c)] ?? String(c)).join("、"),
        warnings,
      });
    }
    case "flight_type": {
      const codes = [...new Set(plan.snapshot.flags.map((f) => FLIGHT_TYPE_CODE[f]).filter((c): c is number => c !== undefined))].sort((a, b) => a - b);
      return filled(codes.length === 0 ? "なし" : codes.map((c) => codeText(field, c)).join("・"), JSON.stringify(codes), {
        copyText: codes.length === 0 ? null : codes.map((c) => field.codes?.[String(c)] ?? String(c)).join("、"),
      });
    }
    case "assistants": {
      const n = inputs.assistantsNumber;
      if (n === undefined || n === null) return absent(field);
      if (!Number.isInteger(n) || n < 0) return filled(String(n), String(n), { warnings: [warn("assistants_invalid")] });
      return filled(String(n));
    }
    case "departure": {
      const v = (inputs.departurePoint ?? "").trim() || plan.placeName;
      return filled(v);
    }
    case "start_time":
      return filled(`${plan.startAt.replace("T", " ")} JST`, toApiStartTime(plan.startAt), { copyText: plan.startAt.replace("T", " ") });
    case "max_time": {
      const n = inputs.plannedMaxTime;
      if (n === undefined || n === null) return absent(field);
      const ok = Number.isInteger(n) && n >= 5 && n <= 1440 && n % 5 === 0;
      return filled(String(n), String(n), ok ? {} : { warnings: [warn("max_time_invalid")] });
    }
    case "flight_time": {
      const d = plan.durationMinutes;
      const rounded = roundUpTo5(d);
      const warnings: PrepareWarning[] = [];
      if (rounded !== d) warnings.push(warn("duration_rounded_up", `計画は ${d} 分 → ${rounded} 分`));
      if (rounded > 1440) warnings.push(warn("duration_out_of_range"));
      return filled(String(rounded), String(rounded), warnings.length > 0 ? { warnings } : {});
    }
    case "speed": {
      const n = inputs.flightSpeed;
      if (n === undefined || n === null) return absent(field);
      const ok = Number.isInteger(n) && n >= 1 && n <= 999;
      return filled(String(n), String(n), ok ? {} : { warnings: [warn("speed_invalid")] });
    }
    case "altitude": {
      const a = plan.maxAltitudeM;
      if (a === null) return absent(field, [warn("altitude_missing")]);
      return filled(String(a), String(a), a < 1 || a > 999 ? { warnings: [warn("altitude_out_of_range", `計画の最大高度は ${a} m`)] } : {});
    }
    case "route": {
      const lat = plan.latitude;
      const lng = plan.longitude;
      const center = `中心 経度 ${lng}・緯度 ${lat}`;
      if (plan.radiusM === null) {
        return { status: "route", value: center, apiValue: null, missing: false, required: false, copyable: false, copyText: null, warnings: [warn("radius_missing")] };
      }
      return {
        status: "route",
        value: `${center}・半径 ${plan.radiusM} m`,
        apiValue: buildCircleGeoJson(lat, lng, plan.radiusM, fields.routeFormat.circleRadiusPlacement),
        missing: false,
        required: false,
        copyable: false,
        copyText: null,
      };
    }
    case "destination": {
      const v = (inputs.destinationPoint ?? "").trim() || plan.placeName;
      return filled(v);
    }
    case "onsite_control": {
      const v = plan.accessControl === null ? null : plan.accessControl ? "1" : "0";
      return yesNo(field, v, warn("onsite_control_missing"));
    }
    case "onsite_control_l3":
      return yesNo(field, inputs.onsiteControlL3);
    case "onsite_control_l35":
      return yesNo(field, inputs.onsiteControlL35);
    case "onsite_control2":
      return yesNo(field, inputs.onsiteControl2);
    case "mooring":
      return yesNo(field, inputs.mooring);
    case "pilot_name":
      return filled(plan.pilot.fullName);
    case "skill_number": {
      const n = plan.pilot.licenseNumber;
      if (n === null || n === "") return absent(field, [warn("license_missing")], false);
      if (plan.pilot.licenseNumberMasked) {
        return filled(n, n, { copyable: false, copyText: null, warnings: [warn("license_masked")] });
      }
      return filled(n);
    }
    case "first_class":
    case "second_class": {
      const cls = plan.pilot.licenseClass;
      const on = field.key === "first_class" ? cls === "first" : cls === "second";
      const v = on ? "1" : "0";
      return filled(field.codes?.[v] ?? v, v, { copyText: field.codes?.[v] ?? v });
    }
    case "pilot_maker":
    case "maker":
      return filled(plan.aircraft.manufacturer);
    case "pilot_model":
    case "model":
      return filled(plan.aircraft.modelName);
    case "certification_number": {
      const n = plan.aircraft.airworthinessCertNumber?.trim();
      return n ? filled(n) : absent(field, [], false);
    }
    case "symbol":
      return filled(plan.aircraft.registrationMark);
    case "certification1":
    case "certification2": {
      const cls = plan.aircraft.airworthinessClass;
      const on = field.key === "certification1" ? cls === "first" : cls === "second";
      const v = on ? "1" : "0";
      return filled(field.codes?.[v] ?? v, v, { copyText: field.codes?.[v] ?? v });
    }
    case "max_weight": {
      const w = plan.aircraft.maxTakeoffWeightKg;
      return w === null ? absent(field, [warn("weight_missing")]) : filled(String(w));
    }
    case "permit_number": {
      const n = plan.permitNumbers?.trim();
      if (n) return filled(n);
      if (plan.snapshot.permitProcedureIds.length > 0) return absent(field, [warn("permit_number_missing")], true);
      return notApplicable();
    }
    case "permit_date":
    case "permit_start":
    case "permit_finish": {
      // 結びついた登録がちょうど 1 件のときだけ、許可書発行日・許可期間を出す（登録は利用者の申告。形式は未確認）
      const r = plan.permitRegistration;
      if (!r) return null;
      const v = field.key === "permit_date" ? r.issuedOn : field.key === "permit_start" ? r.validFrom : r.validTo;
      return filled(v, v.replaceAll("-", ""), { warnings: [warn("permit_dates_format_unconfirmed")] });
    }
    default:
      return null;
  }
};

const toItem = (field: ReportField, draft: Draft | null): PreparedItem => {
  const base = {
    key: field.key,
    apiNo: field.apiNo,
    apiField: field.apiField,
    label: field.label,
    dipsScreenLabel: field.dipsScreenLabel,
    order: field.order,
    group: field.group,
    source: field.source,
    personal: field.personal,
    unit: field.unit,
    requirementRef: field.requirementRef,
    screenStatus: field.screenStatus,
  };
  // そらばんが持たない項目（および、処理を持たない未知の項目）は、DIPS で入力する
  if (draft === null) {
    return {
      ...base,
      status: "dips_only",
      value: dipsOnlyValue(field.apiField),
      apiValue: null,
      copyText: null,
      copyable: false,
      missing: false,
      required: false,
      warnings: [],
    };
  }
  const copyable = field.copyable && draft.copyable !== false && draft.status !== "route" && draft.status !== "not_applicable";
  const copyText = !copyable ? null : draft.copyText !== undefined ? draft.copyText : draft.value;
  return {
    ...base,
    status: draft.status,
    value: draft.value,
    apiValue: draft.apiValue,
    copyText,
    copyable: copyable && copyText !== null && copyText !== "",
    missing: draft.missing === true,
    required: draft.required ?? field.apiRequired === "required",
    warnings: draft.warnings ?? [],
  };
};

/**
 * 通報内容を整える（副作用なし）。fields を省略すると同梱の対応表を使う（テストでは確認済みの行を持つ表を渡す）。
 */
export const prepareReport = (
  plan: PlanForReport,
  kind: ReportKind,
  fields: ReportFieldsData = REPORT_FIELDS,
): PreparedReport => {
  const ctx: Ctx = { plan, fields };
  const rows = displayFields(fields);
  const items = rows.map((f): PreparedItem => {
    if (f.source === "dips_only") return toItem(f, null);
    return toItem(f, draftFor(f, ctx));
  });

  const groups: PreparedGroup[] = [...fields.groups]
    .sort((a, b) => a.order - b.order)
    .map((g) => {
      const keys = rows.filter((r) => r.group === g.id);
      return {
        id: g.id,
        label: g.label,
        order: g.order,
        needsConfirmation: keys.some((r) => r.screenStatus === "unconfirmed"),
        itemKeys: keys.map((r) => r.key),
      };
    })
    .filter((g) => g.itemKeys.length > 0);

  // 全体の警告：項目の警告を重複なく集める
  const seen = new Set<string>();
  const warnings: PrepareWarning[] = [];
  for (const it of items) {
    for (const w of it.warnings) {
      const k = `${w.code}|${w.message}`;
      if (!seen.has(k)) {
        seen.add(k);
        warnings.push(w);
      }
    }
  }
  const missingRequiredCount = items.filter((i) => i.missing && i.required).length;
  if (missingRequiredCount > 0) {
    warnings.push({
      code: "missing_required",
      message: `未入力の必須項目が ${missingRequiredCount} 件あります（記録はできます）`,
    });
  }

  const parts = fingerprintPartsOf(plan);
  return {
    kind,
    planId: plan.planId,
    mapRevision: fields.revision,
    mapVerifiedAt: fields.verifiedAt,
    items,
    groups,
    warnings,
    missingRequiredCount,
    fingerprint: computeFingerprint(parts),
    fingerprintParts: parts,
    snapshot: plan.snapshot,
    inputs: plan.inputs,
  };
};

/** 通報の記録（content）に写す内容。個人情報（personal）と、そらばんが持たない項目（dips_only）は入れない。 */
export type ReportContent = {
  readonly version: 1;
  readonly mapRevision: number;
  readonly items: readonly { readonly key: string; readonly value: string | null; readonly apiValue: string | null }[];
  readonly inputs: Readonly<Record<string, unknown>>;
};

export const contentOf = (p: PreparedReport): ReportContent => ({
  version: 1,
  mapRevision: p.mapRevision,
  items: p.items
    .filter((i) => !i.personal && i.status !== "dips_only")
    .map((i) => ({ key: i.key, value: i.value, apiValue: i.apiValue })),
  inputs: { ...(p.inputs as Record<string, unknown>) },
});
