// 事故・ヒヤリハットの純粋関数（Sprint 12e 設計 C）。DB・時計・ネットワークに触れない（現在時刻は引数で受け取る）。
//   validateIncident        記録の入力検査（full：事務所の詳細な記録／quick：現場の簡易記録）。版の data（snake_case）を作る
//   validateIncidentReport  国への報告の記録の入力検査（reported／consulted／retract）
//   incidentFactsSource     報告の記録の指紋の元（事象の類型・区分・けがの有無・人数）。ハッシュはサービス層が計算する
//   incidentReportState     報告の状態（reported／consulted／none）と「内容が変わった」を行から導出する（保存しない）
//   incidentNextActions     次にやること（報告の要否を確認する・詳細を記入する）を記録の有無から導出する（保存しない）
//
// 守ること：目安（lib/ops-incident.ts の incidentGuidance）はサーバーが事実から計算する。リクエストの目安・スナップショット・
// detail_pending・source は読まない。事象の類型・けがの有無・機体の損傷に既定値を置かない（未選択は 400）。
import { NEXT_ACTION_LABEL } from "@soraban/dips";
import { checkCoordinate, parseJstMinute } from "@/lib/ops-time";
import {
  EVENT_TYPE_NONE,
  EVENT_TYPE_UNKNOWN,
  eventTypeKeysOf,
  INCIDENT_CHANGED_SINCE_REPORT,
  INCIDENT_CONTACTS,
  INCIDENT_DETAIL_DUE_DAYS,
  INCIDENT_FOLLOW_UPS,
  INCIDENT_GUIDANCE_REVISION,
  INCIDENT_GUIDANCE_REVISIONS,
  INCIDENT_KINDS,
  INCIDENT_LIMITS,
  INCIDENT_PHASES,
  INCIDENT_REPORT_ACTIONS,
  INCIDENT_REPORT_CHANNELS,
  incidentHref,
  INJURY_EVENT_TYPES,
  YES_NO_UNKNOWN,
  type GuidanceTable,
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
import type { NextActionTier } from "./report-logic";
import type { TodayNextAction } from "./today-logic";

type Input = Readonly<Record<string, unknown>>;
type FieldMap = Record<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";
const isDate = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

// ---- 入力の項目（API の camelCase → 版の data の snake_case） ---------------------------------

export const INCIDENT_FIELDS: Readonly<Record<string, string>> = {
  kind: "kind",
  occurredAt: "occurred_at",
  phase: "phase",
  placeName: "place_name",
  latitude: "latitude",
  longitude: "longitude",
  planId: "plan_id",
  flightRecordId: "flight_record_id",
  aircraftId: "aircraft_id",
  pilotId: "pilot_id",
  eventTypes: "event_types",
  peopleInjury: "people_injury",
  aircraftDamage: "aircraft_damage",
  injuredCount: "injured_count",
  contactsMade: "contacts_made",
  summary: "summary",
  details: "details",
  factorsNote: "factors_note",
  actionsTaken: "actions_taken",
  preventionNote: "prevention_note",
  followUpStatus: "follow_up_status",
  followUpOn: "follow_up_on",
  detailPending: "detail_pending",
};

/** 版の履歴の「変わった項目」の表示名（版の data のキー → 名称）。 */
export const INCIDENT_FIELD_LABELS: Readonly<Record<string, string>> = {
  kind: "区分",
  occurred_at: "起きた日時",
  phase: "起きた場面",
  place_name: "場所",
  latitude: "緯度",
  longitude: "経度",
  plan_id: "飛行計画",
  snapshot_id: "判定スナップショット",
  flight_record_id: "日誌（飛行記録）",
  aircraft_id: "機体",
  pilot_id: "操縦者",
  event_types: "事象の類型",
  people_injury: "けがをした人",
  aircraft_damage: "自社の機体の損傷",
  injured_count: "けがをした人の人数",
  contacts_made: "連絡した先",
  summary: "何が起きたか",
  details: "経過",
  factors_note: "考えられる要因",
  actions_taken: "とった対応",
  prevention_note: "再発防止",
  detail_pending: "詳細の未記入",
  source: "記録した画面",
  follow_up_status: "対応の状況",
  follow_up_on: "対応が済んだ日",
  guidance_level: "目安",
  guidance_revision: "類型のデータの版",
  client_request_id: "送信の識別子",
};

/** 版の data（サーバーが決める snapshot_id・guidance_*・client_request_id を除く）。 */
export type IncidentData = {
  readonly kind: IncidentKind;
  /** JST の `YYYY-MM-DDTHH:MM`。 */
  readonly occurred_at: string;
  readonly phase: IncidentPhase | null;
  readonly place_name: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly plan_id: string | null;
  readonly flight_record_id: string | null;
  readonly aircraft_id: string | null;
  readonly pilot_id: string | null;
  readonly event_types: readonly string[];
  readonly people_injury: YesNoUnknown;
  readonly aircraft_damage: YesNoUnknown;
  readonly injured_count: number | null;
  readonly contacts_made: readonly IncidentContact[];
  readonly summary: string | null;
  readonly details: string | null;
  readonly factors_note: string | null;
  readonly actions_taken: string | null;
  readonly prevention_note: string | null;
  readonly detail_pending: boolean;
  readonly source: IncidentSource;
  readonly follow_up_status: IncidentFollowUp;
  readonly follow_up_on: string | null;
};

export type IncidentValidated =
  | { readonly ok: true; readonly data: IncidentData; readonly occurredAtDate: Date; readonly queued: boolean }
  | { readonly ok: false; readonly errors: FieldMap; readonly codes: FieldMap };

export type IncidentMode = "full" | "quick";

/** 理由コード → 文言（項目ごとの誤り）。 */
export const INCIDENT_VALIDATION_MESSAGE: Readonly<Record<string, string>> = {
  required: "選択・入力してください",
  invalid: "値が正しくありません",
  unknown_value: "選べない値です",
  too_long: "長すぎます",
  time_format: "日時は YYYY-MM-DDTHH:MM（日本時間、分まで）で指定してください",
  event_types_required: "事象の類型を 1 つ以上選んでください",
  event_types_exclusive: "「上のどれにも当たらない」「まだ分からない」は、ほかの類型と一緒に選べません",
  unknown_event_type: "この版の類型にない値です",
  duplicate: "同じ値が重複しています",
  injury_type_missing: "けがをした人がいるときは、けがの類型（重さが分からなければ「まだ分からない」）を選んでください",
  injured_count_requires_injury: "けがをした人の人数は、けがをした人が「ある」のときだけ入力できます",
  out_of_range: "範囲の外です",
  coordinate_pair: "緯度と経度は両方入力するか、両方空にしてください",
  follow_up_date_required: "対応済みにするときは、対応が済んだ日を入力してください",
  follow_up_date_not_allowed: "対応が済んだ日は、対応済みのときだけ入力できます",
};

const collector = () => {
  const errors: FieldMap = {};
  const codes: FieldMap = {};
  const fail = (key: string, code: string, message?: string): void => {
    if (key in errors) return;
    errors[key] = message ?? INCIDENT_VALIDATION_MESSAGE[code] ?? "値が正しくありません";
    codes[key] = code;
  };
  return { errors, codes, fail };
};

const pickEnum = <T extends string>(
  c: ReturnType<typeof collector>,
  input: Input,
  key: string,
  values: readonly T[],
  required: boolean,
): T | null => {
  const v = input[key];
  if (!present(v)) {
    if (required) c.fail(key, "required");
    return null;
  }
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    c.fail(key, "unknown_value", `次のいずれかを選んでください：${values.join("・")}`);
    return null;
  }
  return v as T;
};

const pickText = (c: ReturnType<typeof collector>, input: Input, key: string, max: number, required: boolean): string | null => {
  const raw = input[key];
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    c.fail(key, "invalid", "文字で入力してください");
    return null;
  }
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "") {
    if (required) c.fail(key, "required");
    return null;
  }
  if (v.length > max) {
    c.fail(key, "too_long", `${max} 文字以内にしてください`);
    return null;
  }
  return v;
};

const pickUuid = (c: ReturnType<typeof collector>, input: Input, key: string): string | null => {
  const v = input[key];
  if (!present(v)) return null;
  if (typeof v !== "string" || !UUID.test(v)) {
    c.fail(key, "invalid");
    return null;
  }
  return v.toLowerCase();
};

const pickOccurredAt = (c: ReturnType<typeof collector>, input: Input): { text: string; date: Date } | null => {
  const at = input["occurredAt"];
  if (!present(at)) {
    c.fail("occurredAt", "required", "起きた日時を入力してください");
    return null;
  }
  const d = parseJstMinute(at);
  if (!d) {
    c.fail("occurredAt", "time_format");
    return null;
  }
  return { text: at as string, date: d };
};

const pickQueued = (c: ReturnType<typeof collector>, input: Input): boolean => {
  const q = input["queued"];
  if (!present(q)) return false;
  if (typeof q !== "boolean") {
    c.fail("queued", "invalid", "queued は真偽値です");
    return false;
  }
  return q;
};

/**
 * 事象の類型の検査：配列で 1 件以上（既定値なし）・重複なし・none と unknown は単独・値はその版にあるものだけ。
 */
export const checkEventTypes = (
  v: unknown,
  revision: number = INCIDENT_GUIDANCE_REVISION,
  table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS,
): { ok: true; value: string[] } | { ok: false; code: string } => {
  if (!present(v) || (Array.isArray(v) && v.length === 0)) return { ok: false, code: "event_types_required" };
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return { ok: false, code: "invalid" };
  const list = v as string[];
  if (new Set(list).size !== list.length) return { ok: false, code: "duplicate" };
  const allowed = new Set(eventTypeKeysOf(revision, table));
  if (list.some((x) => !allowed.has(x))) return { ok: false, code: "unknown_event_type" };
  if (list.length > 1 && list.some((x) => x === EVENT_TYPE_NONE || x === EVENT_TYPE_UNKNOWN)) return { ok: false, code: "event_types_exclusive" };
  return { ok: true, value: list };
};

/**
 * 記録の入力検査。
 *   full：区分・起きた日時・何が起きたか（1〜200 文字）・事象の類型（1 件以上）・けがの有無・機体の損傷が必須。detailPending=true
 *         （簡易記録の詳細をまだ補わない訂正）のときだけ、何が起きたかを省略できる。source は office（訂正では呼び出し側が元の値を使う）。
 *   quick：区分・起きた日時・けがの有無だけが必須。事象の類型は ["unknown"]、機体の損傷は unknown、detail_pending は真、
 *          source は field_quick。ほかの項目（自由記述・座標など）は読まない（計画の ID だけは読む）。
 */
export const validateIncident = (
  input: Input,
  mode: IncidentMode,
  revision: number = INCIDENT_GUIDANCE_REVISION,
  table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS,
): IncidentValidated => {
  const c = collector();
  const kind = pickEnum(c, input, "kind", INCIDENT_KINDS, true);
  const at = pickOccurredAt(c, input);
  const peopleInjury = pickEnum(c, input, "peopleInjury", YES_NO_UNKNOWN, true);
  const planId = pickUuid(c, input, "planId");
  const queued = pickQueued(c, input);

  if (mode === "quick") {
    if (Object.keys(c.errors).length > 0 || !kind || !at || !peopleInjury) return { ok: false, errors: c.errors, codes: c.codes };
    return {
      ok: true,
      occurredAtDate: at.date,
      queued,
      data: {
        kind,
        occurred_at: at.text,
        phase: null,
        place_name: null,
        latitude: null,
        longitude: null,
        plan_id: planId,
        flight_record_id: null,
        aircraft_id: null,
        pilot_id: null,
        event_types: [EVENT_TYPE_UNKNOWN],
        people_injury: peopleInjury,
        aircraft_damage: "unknown",
        injured_count: null,
        contacts_made: [],
        summary: null,
        details: null,
        factors_note: null,
        actions_taken: null,
        prevention_note: null,
        detail_pending: true,
        source: "field_quick",
        follow_up_status: "open",
        follow_up_on: null,
      },
    };
  }

  // full
  let detailPending = false;
  if (present(input["detailPending"])) {
    if (typeof input["detailPending"] !== "boolean") c.fail("detailPending", "invalid", "detailPending は真偽値です");
    else detailPending = input["detailPending"];
  }
  const aircraftDamage = pickEnum(c, input, "aircraftDamage", YES_NO_UNKNOWN, true);
  const phase = pickEnum(c, input, "phase", INCIDENT_PHASES, false);
  const summary = pickText(c, input, "summary", INCIDENT_LIMITS.summary, !detailPending);
  const details = pickText(c, input, "details", INCIDENT_LIMITS.details, false);
  const factorsNote = pickText(c, input, "factorsNote", INCIDENT_LIMITS.factorsNote, false);
  const actionsTaken = pickText(c, input, "actionsTaken", INCIDENT_LIMITS.actionsTaken, false);
  const preventionNote = pickText(c, input, "preventionNote", INCIDENT_LIMITS.preventionNote, false);
  const placeName = pickText(c, input, "placeName", INCIDENT_LIMITS.placeName, false);
  const flightRecordId = pickUuid(c, input, "flightRecordId");
  const aircraftId = pickUuid(c, input, "aircraftId");
  const pilotId = pickUuid(c, input, "pilotId");

  let eventTypes: string[] = [];
  const et = checkEventTypes(input["eventTypes"], revision, table);
  if (!et.ok) c.fail("eventTypes", et.code);
  else eventTypes = et.value;

  if (peopleInjury === "yes" && et.ok && !eventTypes.some((x) => (INJURY_EVENT_TYPES as readonly string[]).includes(x) || x === EVENT_TYPE_UNKNOWN)) {
    c.fail("eventTypes", "injury_type_missing");
  }

  let injuredCount: number | null = null;
  const ic = input["injuredCount"];
  if (present(ic)) {
    const n = typeof ic === "number" ? ic : typeof ic === "string" && /^\d+$/.test(ic.trim()) ? Number(ic) : NaN;
    if (!Number.isInteger(n)) c.fail("injuredCount", "invalid", "人数は整数で入力してください");
    else if (n < 0 || n > INCIDENT_LIMITS.injuredCountMax) c.fail("injuredCount", "out_of_range", `人数は 0〜${INCIDENT_LIMITS.injuredCountMax} です`);
    else if (peopleInjury !== "yes") c.fail("injuredCount", "injured_count_requires_injury");
    else injuredCount = n;
  }

  let lat: number | null = null;
  let lng: number | null = null;
  const hasLat = present(input["latitude"]);
  const hasLng = present(input["longitude"]);
  if (hasLat !== hasLng) c.fail(hasLat ? "longitude" : "latitude", "coordinate_pair");
  else if (hasLat) {
    const a = checkCoordinate(input["latitude"], "lat");
    const b = checkCoordinate(input["longitude"], "lng");
    if (!a.ok) c.fail("latitude", a.code, "緯度の値が正しくありません（−90〜90、小数 6 桁まで）");
    else lat = a.value;
    if (!b.ok) c.fail("longitude", b.code, "経度の値が正しくありません（−180〜180、小数 6 桁まで）");
    else lng = b.value;
  }

  let contacts: IncidentContact[] = [];
  const cm = input["contactsMade"];
  if (present(cm)) {
    if (!Array.isArray(cm) || cm.some((x) => typeof x !== "string")) c.fail("contactsMade", "invalid", "連絡した先は選択肢の配列です");
    else if (cm.some((x) => !(INCIDENT_CONTACTS as readonly string[]).includes(x as string))) c.fail("contactsMade", "unknown_value", `次から選んでください：${INCIDENT_CONTACTS.join("・")}`);
    else if (new Set(cm).size !== cm.length) c.fail("contactsMade", "duplicate");
    else contacts = cm as IncidentContact[];
  }

  const followUp = pickEnum(c, input, "followUpStatus", INCIDENT_FOLLOW_UPS, false) ?? "open";
  let followUpOn: string | null = null;
  const fo = input["followUpOn"];
  if (present(fo)) {
    if (typeof fo !== "string" || !isDate(fo)) c.fail("followUpOn", "invalid", "日付は YYYY-MM-DD で入力してください");
    else if (followUp !== "done") c.fail("followUpOn", "follow_up_date_not_allowed");
    else followUpOn = fo;
  } else if (followUp === "done") c.fail("followUpOn", "follow_up_date_required");

  if (Object.keys(c.errors).length > 0 || !kind || !at || !peopleInjury || !aircraftDamage) return { ok: false, errors: c.errors, codes: c.codes };
  return {
    ok: true,
    occurredAtDate: at.date,
    queued,
    data: {
      kind,
      occurred_at: at.text,
      phase,
      place_name: placeName,
      latitude: lat,
      longitude: lng,
      plan_id: planId,
      flight_record_id: flightRecordId,
      aircraft_id: aircraftId,
      pilot_id: pilotId,
      event_types: eventTypes,
      people_injury: peopleInjury,
      aircraft_damage: aircraftDamage,
      injured_count: injuredCount,
      contacts_made: contacts,
      summary,
      details,
      factors_note: factorsNote,
      actions_taken: actionsTaken,
      prevention_note: preventionNote,
      detail_pending: detailPending,
      source: "office",
      follow_up_status: followUp,
      follow_up_on: followUpOn,
    },
  };
};

/**
 * 訂正で使う類型のデータの版。事象の類型を変えない（入力に無い、または保存済みと同じ組）なら保存済みの版（guidance_revision）で
 * 検査し、目安もその版で計算する（後の版で類型のキーが廃止・改名されても、変えない値を現在の版で拒まない）。
 * 類型を変えるなら現在の版で検査し、版を上げて目安を再計算する。
 */
export const correctionRevision = (
  inputEventTypes: unknown,
  stored: { readonly eventTypes: readonly string[]; readonly revision: number },
  current: number = INCIDENT_GUIDANCE_REVISION,
): number => {
  if (inputEventTypes === undefined) return stored.revision;
  if (!Array.isArray(inputEventTypes) || inputEventTypes.some((x) => typeof x !== "string")) return current;
  const a = [...(inputEventTypes as string[])].sort();
  const b = [...stored.eventTypes].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]) ? stored.revision : current;
};

/**
 * 訂正の入力検査（full）。merged は保存済みの値に入力を重ねたもの、input は訂正の入力そのもの（事象の類型を変えるかを見る）。
 * 返す revision は、目安の計算と版の data に入れる類型のデータの版。
 */
export const validateIncidentCorrection = (
  merged: Input,
  input: Input,
  stored: { readonly eventTypes: readonly string[]; readonly revision: number },
  current: number = INCIDENT_GUIDANCE_REVISION,
  table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS,
): { readonly v: IncidentValidated; readonly revision: number } => {
  const revision = correctionRevision("eventTypes" in input ? input["eventTypes"] : undefined, stored, current);
  return { v: validateIncident(merged, "full", revision, table), revision };
};

// ---- 国への報告の記録 --------------------------------------------------------------------------

export type IncidentReportData = {
  readonly action: IncidentReportAction;
  /** JST の `YYYY-MM-DDTHH:MM`（reported・consulted）。 */
  readonly done_at: string | null;
  readonly channel: IncidentReportChannel | null;
  readonly channel_note: string | null;
  readonly reference: string | null;
  readonly reference_absent: boolean;
  readonly note: string | null;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly target_record_id: string | null;
  readonly reason: string | null;
};

export type IncidentReportValidated =
  | { readonly ok: true; readonly data: IncidentReportData; readonly doneAtDate: Date | null }
  | { readonly ok: false; readonly errors: FieldMap; readonly codes: FieldMap };

/**
 * 報告の記録の入力検査（設計 B）。
 *   reported：日時・送り先（dips／other。other は補足が必須）・番号か「番号が表示されなかった」のどちらか一方・
 *             確認（reportCompleted が真）が必須。
 *   consulted：日時・note（確かめた相手と結果の要点）・確認（consultationDone が真）が必須。
 *   retract：取り下げる行（targetRecordId）と理由が必須。
 * 記録した時点の版・指紋・記録者・時刻はサーバーが決める（本文から読まない）。
 */
export const validateIncidentReport = (input: Input): IncidentReportValidated => {
  const c = collector();
  const action = pickEnum(c, input, "action", INCIDENT_REPORT_ACTIONS, true);
  let doneAt: { text: string; date: Date } | null = null;
  let channel: IncidentReportChannel | null = null;
  let channelNote: string | null = null;
  let reference: string | null = null;
  let referenceAbsent = false;
  let note: string | null = null;
  let checks: Record<string, boolean> = {};
  let target: string | null = null;
  let reason: string | null = null;

  const checkTrue = (key: "reportCompleted" | "consultationDone"): void => {
    const ch = input["checks"];
    const ok = ch !== null && typeof ch === "object" && !Array.isArray(ch) && (ch as Record<string, unknown>)[key] === true;
    if (!ok) c.fail("checks", "checks_required", "確認のチェックを入れてください");
    else checks = { [key]: true };
  };
  const pickDoneAt = (): void => {
    const v = input["doneAt"];
    if (!present(v)) return c.fail("doneAt", "required", "日時を入力してください");
    const d = parseJstMinute(v);
    if (!d) return c.fail("doneAt", "time_format");
    doneAt = { text: v as string, date: d };
  };

  if (action === "reported") {
    pickDoneAt();
    channel = pickEnum(c, input, "channel", INCIDENT_REPORT_CHANNELS, true);
    channelNote = pickText(c, input, "channelNote", INCIDENT_LIMITS.channelNote, channel === "other");
    if (channel !== "other" && channelNote !== null) {
      c.fail("channelNote", "not_allowed", "送り先の補足は「その他」のときだけ入力できます");
      channelNote = null;
    }
    reference = pickText(c, input, "reference", INCIDENT_LIMITS.reference, false);
    const ra = input["referenceAbsent"];
    if (present(ra) && typeof ra !== "boolean") c.fail("referenceAbsent", "invalid", "referenceAbsent は真偽値です");
    else referenceAbsent = ra === true;
    if ((reference !== null) === referenceAbsent && !("reference" in c.errors)) {
      c.fail("reference", "reference_or_absent", "番号を入力するか、「番号が表示されなかった」を選んでください（どちらか一方）");
    }
    note = pickText(c, input, "note", INCIDENT_LIMITS.reportNote, false);
    checkTrue("reportCompleted");
  } else if (action === "consulted") {
    pickDoneAt();
    note = pickText(c, input, "note", INCIDENT_LIMITS.reportNote, true);
    checkTrue("consultationDone");
  } else if (action === "retract") {
    target = pickUuid(c, input, "targetRecordId");
    if (target === null && !("targetRecordId" in c.errors)) c.fail("targetRecordId", "required", "取り下げる記録を選んでください");
    reason = pickText(c, input, "reason", INCIDENT_LIMITS.reason, true);
  }

  if (Object.keys(c.errors).length > 0 || !action) return { ok: false, errors: c.errors, codes: c.codes };
  const d = doneAt as { text: string; date: Date } | null;
  return {
    ok: true,
    doneAtDate: d?.date ?? null,
    data: {
      action,
      done_at: d?.text ?? null,
      channel,
      channel_note: channelNote,
      reference,
      reference_absent: referenceAbsent,
      note,
      checks,
      target_record_id: target,
      reason,
    },
  };
};

// ---- 指紋・報告の状態 -------------------------------------------------------------------------

export type IncidentFacts = {
  readonly kind: string;
  readonly event_types: readonly string[];
  readonly people_injury: string;
  readonly injured_count: number | null;
};

/** 報告の記録の指紋の元（事象の類型は並べ替える）。サービス層が SHA-256 にする。 */
export const incidentFactsSource = (f: IncidentFacts): string =>
  JSON.stringify(["soraban-incident-facts-v1", f.kind, [...f.event_types].sort(), f.people_injury, f.injured_count ?? null]);

export type IncidentReportRecordLite = {
  readonly id: string;
  readonly action: IncidentReportAction;
  readonly targetRecordId: string | null;
  readonly factsFingerprint: string;
};

export type IncidentReportState = {
  readonly code: IncidentReportStateCode;
  /** 有効な（取り下げられていない reported・consulted の）行の ID。 */
  readonly activeIds: readonly string[];
  readonly retractedIds: readonly string[];
  /** 有効な記録はあるが、どれも現在の事実の指紋と違う（記録のあとで事実が変わった）。 */
  readonly changedSinceReport: boolean;
};

/** 報告の状態を行から導出する（保存しない）。reported ＞ consulted ＞ none。 */
export const incidentReportState = (records: readonly IncidentReportRecordLite[], currentFingerprint: string): IncidentReportState => {
  const retracted = new Set(records.filter((r) => r.action === "retract" && r.targetRecordId).map((r) => r.targetRecordId!));
  const active = records.filter((r) => (r.action === "reported" || r.action === "consulted") && !retracted.has(r.id));
  const code: IncidentReportStateCode = active.some((r) => r.action === "reported") ? "reported" : active.length > 0 ? "consulted" : "none";
  return {
    code,
    activeIds: active.map((r) => r.id),
    retractedIds: [...retracted],
    changedSinceReport: active.length > 0 && !active.some((r) => r.factsFingerprint === currentFingerprint),
  };
};

// ---- 次にやること -----------------------------------------------------------------------------

/** 報告の要否の確認（通報の漏れと同じ重さ）。 */
export const INCIDENT_CONFIRM_TIER: NextActionTier = 1;
/** 詳細の記入（日誌と同じ重さ）。 */
export const INCIDENT_DETAIL_TIER: NextActionTier = 3;

export type IncidentActionInput = {
  readonly id: string;
  /** 一覧で記録を見分けるための短い表示（要約か区分）。 */
  readonly label: string;
  readonly occurredAt: Date;
  /** 起きた日（JST の YYYY-MM-DD）。 */
  readonly occurredDate: string;
  readonly now: Date;
  /** 今日（JST の YYYY-MM-DD）。 */
  readonly today: string;
  readonly voided: boolean;
  readonly guidanceLevel: IncidentGuidanceLevel;
  readonly reportState: Pick<IncidentReportState, "code" | "changedSinceReport">;
  readonly detailPending: boolean;
  readonly planId: string | null;
  readonly planTitle: string | null;
  readonly can: { readonly report: boolean; readonly update: boolean };
};

const daysBetween = (a: string, b: string): number => {
  const t = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
};

/**
 * 記録ごとの次にやること（記録の有無から毎回導出する）。
 *   事故・ヒヤリハットの報告の要否を確認する（tier 1）：目安が possible で、報告の記録も要否を確かめた記録も無い、または記録のあとで
 *     事実が変わった。日数・時間では消さない（消えるのは、報告・確認の記録が付いたとき、訂正で目安が none_selected になったとき、取消のとき）。
 *   事故・ヒヤリハットの詳細を記入する（tier 3）：現場の簡易記録で詳細が未記入。起きた日から 14 日目まで（社内の目安）。
 * 期限の日付は作らない。canAct が偽のものは、画面がリンクにせず「運航管理者に依頼」と示す。
 */
export const incidentNextActions = (list: readonly IncidentActionInput[]): TodayNextAction[] => {
  const out: TodayNextAction[] = [];
  for (const i of list) {
    if (i.voided) continue;
    const startsInMinutes = Math.floor((i.occurredAt.getTime() - i.now.getTime()) / 60_000);
    const when = `${i.occurredDate}「${i.label}」`;
    const base = { dueLabel: null, startsInMinutes, planId: i.planId, planTitle: i.planTitle };
    if (i.guidanceLevel === "possible" && (i.reportState.code === "none" || i.reportState.changedSinceReport)) {
      out.push({
        ...base,
        id: "confirm_incident_report",
        label: NEXT_ACTION_LABEL.confirm_incident_report,
        reason: i.reportState.changedSinceReport
          ? `${when}：${INCIDENT_CHANGED_SINCE_REPORT}`
          : `${when}：目安は「報告の対象になる可能性があります」です。報告の要否を確かめて、結果を記録してください`,
        href: incidentHref(i.id, "report"),
        tier: INCIDENT_CONFIRM_TIER,
        canAct: i.can.report,
      });
    }
    if (i.detailPending) {
      const days = daysBetween(i.occurredDate, i.today);
      if (days <= INCIDENT_DETAIL_DUE_DAYS) {
        out.push({
          ...base,
          id: "complete_incident_detail",
          label: NEXT_ACTION_LABEL.complete_incident_detail,
          reason: `${when}：現場の簡易記録です。事象の類型などの詳細を記入してください`,
          href: incidentHref(i.id, "correct"),
          tier: INCIDENT_DETAIL_TIER,
          canAct: i.can.update,
        });
      }
    }
  }
  return out;
};
