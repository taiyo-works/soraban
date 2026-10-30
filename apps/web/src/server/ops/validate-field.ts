// 現場の記録（POST /api/ops/plans/[id]/field-events）の入力検査（Sprint 12c 設計 E）。純粋関数。
//   - 読むのは kind・clientEventId・occurredAt・item・result・source・targetEventId（targetClientEventId）・queued・note だけ。
//     snapshotId・planVersion・gaps・recordedAt・contentHash などサーバー（DB）が決める値は読まない。
//   - 日常点検（item=inspection）は確認の行を持たない（実際の日常点検の記録から導出する）ため、記録できない。
//   - 緊急用務空域は情報源（選択肢の ID）と結果（not_designated／designated）が必須。
import {
  EMERGENCY_SOURCE_OPTIONS,
  FIELD_DOC_KEYS,
  FIELD_RECORDABLE_CHECK_ITEMS,
  FIELD_RECORDABLE_KINDS,
  SITE_NOTE_REQUIRED_MESSAGE,
  SITE_TEMP_RANGE,
  SITE_WIND_RANGE,
  isEmergencySource,
  siteHasAttention,
  type FieldCheckResult,
  type FieldDocKey,
  type FieldRecordableCheckItem,
  type FieldSiteValues,
} from "@/lib/ops-field";
import { parseJstMinute } from "@/lib/ops-time";
import { isUuid } from "./validate-records";

type Input = Readonly<Record<string, unknown>>;

export type FieldEventInput =
  | {
      readonly kind: "check";
      readonly item: FieldRecordableCheckItem;
      readonly result: FieldCheckResult;
      readonly source: string | null;
      /** docs_confirm のとき。 */
      readonly docKey: FieldDocKey | null;
      /** site_conditions のとき。 */
      readonly site: FieldSiteValues | null;
    }
  | { readonly kind: "takeoff" }
  | { readonly kind: "landing" }
  | { readonly kind: "undo" };

export type FieldEventData = FieldEventInput & {
  readonly clientEventId: string;
  /** 事実の時刻（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly occurredAt: string;
  /** 事実の時刻（Date）。 */
  readonly occurredAtDate: Date;
  /** landing（省略可）・undo（必須）が指す行（ID か端末の識別子）。 */
  readonly targetRef: string | null;
  readonly queued: boolean;
  readonly note: string | null;
};

export type FieldValidated =
  | { readonly ok: true; readonly data: FieldEventData }
  | { readonly ok: false; readonly errors: Record<string, string>; readonly codes: Record<string, string> };

export const FIELD_NOTE_MAX = 300;

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

const SITE_ENUMS = {
  thirdParty: ["none", "present"],
  otherAircraft: ["none", "present"],
  rain: ["none", "present"],
  visibility: ["good", "limited"],
} as const;

/** 現場状況の入力（選択 4 つは必須、風速・気温は任意）。範囲外・選択肢の外は 400（key は site.○○）。 */
const parseSite = (
  raw: unknown,
  bad: (key: string, code: string, message: string) => void,
): FieldSiteValues | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    bad("site", "required", "現場状況（site）が必要です");
    return null;
  }
  const r = raw as Record<string, unknown>;
  let ok = true;
  for (const [k, allowed] of Object.entries(SITE_ENUMS)) {
    const v = r[k];
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      bad(`site.${k}`, present(v) ? "invalid" : "required", `${k} は ${allowed.join("・")} のいずれかです`);
      ok = false;
    }
  }
  const numField = (k: "windMs" | "tempC", range: { readonly min: number; readonly max: number }): number | null | undefined => {
    const v = r[k];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < range.min || v > range.max) {
      bad(`site.${k}`, "out_of_range", `${k} は ${range.min} 以上 ${range.max} 以下の数値です`);
      ok = false;
      return undefined;
    }
    return Math.round(v * 10) / 10;
  };
  const windMs = numField("windMs", SITE_WIND_RANGE);
  const tempC = numField("tempC", SITE_TEMP_RANGE);
  if (!ok || windMs === undefined || tempC === undefined) return null;
  return {
    thirdParty: r["thirdParty"] as FieldSiteValues["thirdParty"],
    otherAircraft: r["otherAircraft"] as FieldSiteValues["otherAircraft"],
    rain: r["rain"] as FieldSiteValues["rain"],
    visibility: r["visibility"] as FieldSiteValues["visibility"],
    windMs,
    tempC,
  };
};

export const validateFieldEvent = (input: Input): FieldValidated => {
  const errors: Record<string, string> = {};
  const codes: Record<string, string> = {};
  const bad = (key: string, code: string, message: string): void => {
    errors[key] = message;
    codes[key] = code;
  };

  const cid = input["clientEventId"];
  let clientEventId = "";
  if (!present(cid)) bad("clientEventId", "required", "端末の識別子（clientEventId）が必要です");
  else if (!isUuid(cid)) bad("clientEventId", "invalid", "端末の識別子が正しくありません");
  else clientEventId = cid.toLowerCase();

  const kind = input["kind"];
  if (typeof kind !== "string" || !(FIELD_RECORDABLE_KINDS as readonly string[]).includes(kind)) {
    bad("kind", kind === "journal_linked" ? "not_recordable" : "invalid", "種別は check・takeoff・landing・undo のいずれかです");
  }

  const at = input["occurredAt"];
  let occurredAtDate: Date | null = null;
  if (!present(at)) bad("occurredAt", "required", "事実の時刻（occurredAt）が必要です");
  else {
    occurredAtDate = parseJstMinute(at);
    if (!occurredAtDate) bad("occurredAt", "time_format", "時刻は YYYY-MM-DDTHH:MM（日本時間、分まで）で指定してください");
  }

  let queued = false;
  if (present(input["queued"])) {
    if (typeof input["queued"] !== "boolean") bad("queued", "invalid", "queued は真偽値です");
    else queued = input["queued"];
  }

  let note: string | null = null;
  if (present(input["note"])) {
    if (typeof input["note"] !== "string") bad("note", "invalid", "メモは文字列です");
    else {
      const t = input["note"].trim();
      if (t.length > FIELD_NOTE_MAX) bad("note", "too_long", `メモは ${FIELD_NOTE_MAX} 文字までです`);
      else note = t === "" ? null : t;
    }
  }

  // 指す行（ID か端末の識別子）。landing は省略可（飛行中の離陸）、undo は必須
  const t1 = input["targetEventId"];
  const t2 = input["targetClientEventId"];
  let targetRef: string | null = null;
  for (const [key, v] of [
    ["targetEventId", t1],
    ["targetClientEventId", t2],
  ] as const) {
    if (!present(v)) continue;
    if (!isUuid(v)) bad(key, "invalid", "対象の行が正しくありません");
    else if (targetRef !== null && targetRef !== v.toLowerCase()) bad(key, "target_conflict", "対象の行が食い違っています");
    else targetRef = v.toLowerCase();
  }
  if (kind === "undo" && targetRef === null && !errors["targetEventId"] && !errors["targetClientEventId"]) {
    bad("targetEventId", "required", "取り消す行（targetEventId）が必要です");
  }

  // 確認
  let item: FieldRecordableCheckItem | null = null;
  let result: FieldCheckResult = "done";
  let source: string | null = null;
  let docKey: FieldDocKey | null = null;
  let site: FieldSiteValues | null = null;
  if (kind === "check") {
    const raw = input["item"];
    if (raw === "inspection") {
      bad("item", "derived", "日常点検は、実際の日常点検の記録から導出されます（確認の行は作りません）");
    } else if (typeof raw !== "string" || !(FIELD_RECORDABLE_CHECK_ITEMS as readonly string[]).includes(raw)) {
      bad("item", present(raw) ? "invalid" : "required", `確認の項目は ${FIELD_RECORDABLE_CHECK_ITEMS.join("・")} のいずれかです`);
    } else {
      item = raw as FieldRecordableCheckItem;
    }
    if (item === "docs_confirm") {
      const k = input["docKey"];
      if (typeof k !== "string" || !(FIELD_DOC_KEYS as readonly string[]).includes(k)) {
        bad("docKey", present(k) ? "invalid" : "required", `書類・手続きの項目（docKey）は ${FIELD_DOC_KEYS.join("・")} のいずれかです`);
      } else docKey = k as FieldDocKey;
    }
    if (item === "site_conditions") {
      const sv = parseSite(input["site"], bad);
      if (sv) {
        site = sv;
        if (siteHasAttention(sv) && note === null && !errors["note"]) bad("note", "note_required", SITE_NOTE_REQUIRED_MESSAGE);
      }
    }
    if (item === "emergency_airspace") {
      const r = input["result"];
      if (r !== "not_designated" && r !== "designated") {
        bad("result", present(r) ? "invalid" : "required", "結果は not_designated（指定されていない）か designated（指定されている）です");
      } else result = r;
      const s = input["source"];
      if (!present(s)) bad("source", "required", "緊急用務空域の確認元を選んでください");
      else if (!isEmergencySource(s)) {
        bad("source", "unknown_source", `確認元は次のいずれかを選んでください：${EMERGENCY_SOURCE_OPTIONS.map((o) => o.id).join("・")}`);
      } else source = s;
    } else if (item !== null) {
      const r = input["result"];
      if (present(r) && r !== "done") bad("result", "invalid", "この項目の結果は done です");
    }
  }

  if (Object.keys(errors).length > 0 || occurredAtDate === null || typeof kind !== "string") return { ok: false, errors, codes };
  const base = { clientEventId, occurredAt: input["occurredAt"] as string, occurredAtDate, targetRef, queued, note };
  switch (kind) {
    case "check":
      return { ok: true, data: { ...base, kind: "check", item: item!, result, source, docKey, site } };
    case "takeoff":
      return { ok: true, data: { ...base, kind: "takeoff" } };
    case "landing":
      return { ok: true, data: { ...base, kind: "landing" } };
    default:
      return { ok: true, data: { ...base, kind: "undo" } };
  }
};
