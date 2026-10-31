// 現場モードの画面の内容（FieldViewDto）を、先読みの束（FieldBundlePlan）と現在の時刻から組み立てる（Sprint 15 設計 3・契約 B-5）。
// 純粋関数。DB・時計・ネットワーク・ブラウザに触れない。サーバー（GET /api/ops/plans/[id]/field・現場の画面）と、圏外の端末
// （IndexedDB に保存した先読みの束から画面を開くとき）が同じ関数を通るので、同じ入力なら書類・手続きの判定と未了事項が同じになる。
//
// 守ること：
//   - 先読みの束には、許可リストの項目だけを入れる（sanitizeFieldBundle）。技能証明書の番号・座標・自由記述（計画の目的・備考）・
//     他の人の計画・判定スナップショットの全文は入れない。読み込むたびにも同じ許可リストで絞る（端末の保存が壊れていても画面を壊さない）。
//   - 判定の純粋関数（docs-judge・field-logic）はそのまま使う。判定エンジン（@soraban/regulations）は呼ばない。
import {
  EMERGENCY_DESIGNATED_WARNING,
  EMERGENCY_SOURCE_OPTIONS,
  FIELD_CHECK_ITEMS,
  FIELD_CHECK_ITEM_LABEL,
  FIELD_CHECK_RESULT_LABEL,
  FIELD_DOC_HUMAN_CONFIRMED_LABEL,
  FIELD_DOC_KEYS,
  FIELD_DOC_LABEL,
  FIELD_DOC_STATUS_LABEL,
  FIELD_EMERGENCY_SOURCE_NOTE,
  FIELD_GAP_ITEMS,
  FIELD_GAP_STATES,
  FIELD_RESTRICTION_UNCONFIRMED_NOTE,
  FIELD_STATE_ABNORMAL,
  FIELD_STATE_DONE,
  FIELD_STATE_IN_FLIGHT,
  FIELD_STATE_JOURNAL_DONE,
  FIELD_STATE_JOURNAL_PENDING,
  FIELD_STATE_TODO,
  FLIGHT_RESTRICTION_SOURCE,
  INSPECTION_ABNORMAL_GUIDANCE,
  fieldGapLabel,
  outsidePlanWindowLabel,
  withFieldReturn,
  type FieldCheckItem,
  type FieldCheckResult,
  type FieldDocKey,
  type FieldEventItem,
  type FieldEventKind,
  type FieldSiteValues,
} from "@/lib/ops-field";
import { jstDate, jstTime, toJstInput } from "@/lib/ops-time";
import { docGapsOf, judgeFieldDocs, type DocJudgement, type DocsJudgeInput, type DocsPermitNumber } from "./docs-judge";
import { fieldState, takeoffGaps, type FieldEventLite, type FieldFlight, type FieldGap, type FieldState, type InspectionLite } from "./field-logic";
import type { PlanState } from "./plan-logic";

// ---- 未了事項の表示 ------------------------------------------------------------

export type GapDto = FieldGap & { readonly label: string };

export const gapDto = (g: { readonly item: string; readonly state: string }): GapDto => ({
  item: g.item as FieldGap["item"],
  state: g.state as FieldGap["state"],
  label: fieldGapLabel(g),
});

// ---- 画面の DTO ------------------------------------------------------------

export type WindowNoticeDto = {
  readonly code: "outside_plan_window";
  readonly label: string;
  readonly earlyMinutes: number;
  readonly lateMinutes: number;
};

export type FieldItemDto = {
  readonly item: FieldCheckItem;
  readonly label: string;
  readonly done: boolean;
  /** 済／未／異常あり（文字。色だけで区別しない）。 */
  readonly stateLabel: string;
  /** 済の時刻（表示用 HH:MM）。 */
  readonly time: string | null;
  readonly result: FieldCheckResult | null;
  readonly resultLabel: string | null;
  /** 緊急用務空域の確認元（選択肢の ID と題名）。 */
  readonly source: string | null;
  readonly sourceTitle: string | null;
  /** 取り消す対象の確認の行の ID（日常点検・未は null）。 */
  readonly eventId: string | null;
  readonly inspectionId: string | null;
  readonly abnormal: boolean;
  readonly designated: boolean;
  /** 目立たせる警告（指定されている・異常あり・通報の記録なし 等）。止める文言にしない。 */
  readonly warning: string | null;
  /** 取り消すボタンを出してよいか（行があり、記録する権限がある）。 */
  readonly undoable: boolean;
};

export type FieldDocDto = {
  readonly key: FieldDocKey;
  readonly label: string;
  readonly status: DocJudgement["status"];
  readonly effective: DocJudgement["effective"];
  /** 状態の語（確認済み／要確認／満たさない）。人が確認した場合は「確認済み（人が確認）」。 */
  readonly statusLabel: string;
  readonly basis: readonly string[];
  readonly notes: readonly string[];
  /** 登録の画面（現場画面へ戻る returnTo つき）。 */
  readonly href: string | null;
  readonly canConfirm: boolean;
  /** 人が確認した行の ID（取り消す対象）。 */
  readonly humanConfirmEventId: string | null;
  readonly humanConfirmedTime: string | null;
};

export type FieldFlightDto = {
  readonly takeoffEventId: string;
  readonly takeoffClientEventId: string;
  readonly takeoffAt: string;
  readonly takeoffTime: string;
  readonly takeoffQueued: boolean;
  readonly gaps: readonly GapDto[];
  readonly landingEventId: string | null;
  readonly landingAt: string | null;
  readonly landingTime: string | null;
  readonly landingQueued: boolean;
  readonly journalEventId: string | null;
  readonly flightRecordId: string | null;
  readonly phase: FieldFlight["phase"];
  readonly phaseLabel: string;
  /** Sprint 14：何回目の飛行か（1 始まり）と、飛行後点検の状態。 */
  readonly roundNumber: number;
  /** この飛行のラウンドの飛行前の日常点検の ID（日誌への引き継ぎ）。 */
  readonly preInspectionId: string | null;
  readonly post: { readonly done: boolean; readonly inspectionId: string | null; readonly abnormal: boolean; readonly time: string | null };
  /** 計画の時間帯の外の知らせ（離陸が早い・着陸が遅い）。 */
  readonly windowNotice: WindowNoticeDto | null;
};

export type FieldReportDto = {
  readonly requirementKind: string;
  readonly requirementLabel: string;
  readonly statusCode: string;
  readonly statusLabel: string;
  readonly statusMark: string;
  /** 通報の日時・番号（手動記録なら「手動（利用者の申告）」を含む表示）。無ければ null。 */
  readonly detail: string | null;
  readonly effectiveReportId: string | null;
  /** 記録の取得元（手動＝利用者の申告）。 */
  readonly channelLabel: string | null;
  /** 推奨・対象外の計画：「この飛行は通報の記録を必須としません」。それ以外は null。 */
  readonly notRequiredNote: string | null;
  readonly warning: string | null;
  /** 「通報内容を開く」の経路。 */
  readonly reportHref: string;
  /** 「通報内容を再確認した」を出してよいか（有効な通報がある）。 */
  readonly canRecheck: boolean;
};

export type FieldPlanSummaryDto = {
  readonly id: string;
  readonly title: string;
  readonly plannedDate: string;
  readonly plannedStartAtJst: string;
  readonly plannedEndAtJst: string;
  /** 表示用 `HH:MM〜HH:MM`。 */
  readonly timeLabel: string;
  readonly durationMinutes: number;
  readonly registrationMark: string;
  readonly modelName: string;
  readonly pilotName: string;
  readonly placeName: string;
  /** 飛行の目的（自由記述）。先読みの束には入れない（圏外で組み立てた画面では空）。 */
  readonly purpose: string;
  readonly permitNumbers: string | null;
  /** 許可番号ごとの照合の状態（Sprint 12d。読み取りだけ。判定の結論は変えない）。 */
  readonly permitStates: readonly { readonly numberText: string; readonly status: string; readonly statusLabel: string }[];
  readonly voided: boolean;
  readonly state: string;
  readonly stateLabel: string;
  readonly verdictLevel: string;
  readonly verdictLabel: string;
  readonly judgementStale: boolean;
  readonly isSelf: boolean;
};

export type FieldViewDto = {
  readonly serverNow: string;
  /** サーバーの現在（JST の `YYYY-MM-DDTHH:MM`）。圏外で組み立てたときは端末の現在。 */
  readonly serverNowJst: string;
  readonly today: string;
  readonly plan: FieldPlanSummaryDto;
  readonly canRecord: boolean;
  readonly canJournal: boolean;
  readonly canInspect: boolean;
  /** 飛行前の 4 項目（日常点検、緊急用務空域、通報済みの再確認、携行品の順）。 */
  readonly items: readonly FieldItemDto[];
  readonly report: FieldReportDto;
  /** Sprint 14：書類・手続き 6 項目の判定（登録内容から導出。画面を開くたびに作り直す）。 */
  readonly docs: readonly FieldDocDto[];
  /** Sprint 14：いまのラウンド（飛行中ならその飛行、そうでなければ次に始める飛行）の空域（飛行自粛要請）・現場状況。 */
  readonly round: {
    readonly number: number;
    readonly restriction: {
      readonly done: boolean;
      readonly eventId: string | null;
      readonly time: string | null;
      readonly sourceTitle: string;
      /** 公表ページの URL。一次情報で確かめられていないときは null（URL を創作しない）。 */
      readonly url: string | null;
      readonly note: string;
    };
    readonly emergencyNote: string;
    readonly site: {
      readonly done: boolean;
      readonly eventId: string | null;
      readonly time: string | null;
      readonly values: FieldSiteValues | null;
      /** 備考（自由記述）。サーバーで開いたときだけ。先読みの束・端末には残さない。 */
      readonly note: string | null;
      readonly attention: boolean;
    };
  };
  /** Sprint 14：飛行後点検が未了の飛行の数。 */
  readonly postPendingCount: number;
  readonly emergencySources: readonly { readonly id: string; readonly title: string; readonly url: string }[];
  /** 離陸 → 着陸 → 日誌の組（離陸の古い順。複数回の離着陸がありうる）。 */
  readonly flights: readonly FieldFlightDto[];
  readonly openFlightEventId: string | null;
  /** 着陸済みで日誌待ちの離陸の ID（古い順）。 */
  readonly pendingJournalTakeoffEventIds: readonly string[];
  /** いま離陸した場合の未了事項の予告（離陸は止めない）。 */
  readonly takeoffPreview: readonly GapDto[];
  /** 同じ日の、他の計画（切り替えボタン用。無ければ空）。 */
  readonly sameDayPlans: readonly { readonly id: string; readonly title: string; readonly timeLabel: string; readonly isCurrent: boolean }[];
  /**
   * 状態を端末で導出し直すための入力（送信待ちの行を足して fieldState に渡し、押した結果を即座に反映する）。
   * 技能証明書番号・氏名は含まない。
   */
  readonly stateInput: {
    readonly events: readonly FieldEventLite[];
    readonly inspections: readonly InspectionLite[];
    readonly flightRecords: readonly { readonly id: string; readonly voided: boolean }[];
    readonly day: string;
    /** 計画の現在の版（書類・手続きの人の確認は同じ版の行だけが有効）。 */
    readonly planVersion: number;
  };
};

// ---- 先読みの束（端末に保存する当日の最小データ） ------------------------------------------------

/** 先読みの束の形の版。形を変えたら上げる（古い束は読まずに捨てる）。 */
export const FIELD_BUNDLE_VERSION = 1;

/** 先読みの束の要約で使う計画の項目（FieldPlanSummaryDto から自由記述の purpose を除き、予定の開始の ISO を足したもの）。 */
export type FieldBundlePlanSummary = Omit<FieldPlanSummaryDto, "purpose"> & {
  /** 予定の開始（ISO）。計画の時間帯の外の知らせに使う。 */
  readonly startIso: string;
};

/** 書類・手続きの判定の入力（人の確認と判定時刻を除く。圏外では端末の送信待ちの人の確認と、端末の時刻で判定する）。 */
export type FieldBundleDocsInput = Omit<DocsJudgeInput, "humanConfirms" | "atJst">;

/** 離陸の未了事項の入力（計画・通報の状態）。 */
export type FieldGapInput = {
  readonly requirementKind: string;
  readonly reportStatusCode: string;
  /** 有効な通報の、離陸と前後を比べる時刻（通報日時と記録の時刻の遅い方。JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly effectiveReportedAt: string | null;
  readonly planState: PlanState;
  readonly judgementStale: boolean;
};

/** 圏外の点検・日誌の入力に使う、計画の機体・操縦者などの ID と、直近の点検の結果。 */
export type FieldBundleForm = {
  readonly aircraftId: string;
  readonly pilotId: string;
  /** 計画の判定から引き継ぐ特定飛行の形態（日誌の初期値。表示だけ。送るときはサーバーが計画から入れる）。 */
  readonly specificFlightTypes: readonly string[];
  /** 直近の点検（その機体の。前日・当日の範囲）。 */
  readonly lastInspection: { readonly inspectedAt: string; readonly timing: "pre_flight" | "post_flight"; readonly hasAbnormal: boolean } | null;
};

export type FieldBundlePlan = {
  readonly v: typeof FIELD_BUNDLE_VERSION;
  /** 束の持ち主（利用者の内部 ID）。他の利用者の束は読まない・返さない。 */
  readonly memberId: string;
  readonly planId: string;
  /** 先読みした時刻（サーバーの現在。ISO）。画面の「先読みの最終更新」。 */
  readonly fetchedAt: string;
  readonly plan: FieldBundlePlanSummary;
  readonly perms: { readonly canRecord: boolean; readonly canJournal: boolean; readonly canInspect: boolean };
  readonly report: FieldReportDto;
  readonly docs: FieldBundleDocsInput;
  readonly gap: FieldGapInput;
  readonly state: {
    readonly events: readonly FieldEventLite[];
    readonly inspections: readonly InspectionLite[];
    readonly flightRecords: readonly { readonly id: string; readonly voided: boolean }[];
    readonly planVersion: number;
  };
  readonly form: FieldBundleForm;
};

/** 先読みが古いと注記する基準（時間）。理由は sanitizeFieldBundle の上の注記と PR の説明（docs/evaluations/sprint-15-pr-notes.md）。 */
export const FIELD_BUNDLE_STALE_HOURS = 12;

/** 先読みが基準時間より古いか（登録が変わった可能性がある）。 */
export const fieldBundleIsStale = (fetchedAtIso: string, nowMs: number): boolean => {
  const t = Date.parse(fetchedAtIso);
  return !Number.isFinite(t) || nowMs - t > FIELD_BUNDLE_STALE_HOURS * 3600_000;
};

// ---- 許可リスト（端末に入る・端末から読む項目を絞る） -------------------------------------------
//
// 先読みの束は API の応答としても、IndexedDB に保存するときも、読み込むときも、この関数を通す。
// 項目を名前で 1 つずつ拾い、型が違えば捨てる（余計な項目＝技能証明書の番号・座標・備考などが紛れ込んでも残らない）。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length <= max ? v : null);
const strOrNull = (v: unknown, max = 200): string | null | undefined => (v === null ? null : typeof v === "string" && v.length <= max ? v : undefined);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined);
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);
const arr = <T,>(v: unknown, f: (x: unknown) => T | null, max = 1000): T[] | null => {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: T[] = [];
  for (const x of v) {
    const y = f(x);
    if (y === null) return null;
    out.push(y);
  }
  return out;
};
/** 計画ごとの現場の行は数十行を想定（Sprint 14 の前提：500 行を超えない）。 */
const MAX_EVENTS = 500;

const EVENT_KINDS: readonly string[] = ["check", "takeoff", "landing", "undo", "journal_linked"];
const EVENT_ITEMS: readonly string[] = [...FIELD_CHECK_ITEMS, "docs_confirm", "flight_restriction", "site_conditions"];
const CHECK_RESULTS: readonly string[] = ["done", "not_designated", "designated"];
const PLAN_STATES: readonly string[] = ["draft", "pending", "approved", "returned", "approved_stale", "returned_stale", "voided"];

const sanitizeSite = (v: unknown): FieldSiteValues | null | undefined => {
  if (v === null || v === undefined) return null;
  if (!isRec(v)) return undefined;
  const c = (x: unknown) => (x === "none" || x === "present" ? x : null);
  const tp = c(v["thirdParty"]);
  const oa = c(v["otherAircraft"]);
  const rain = c(v["rain"]);
  const vis = v["visibility"] === "good" || v["visibility"] === "limited" ? v["visibility"] : null;
  const wind = numOrNull(v["windMs"]);
  const temp = numOrNull(v["tempC"]);
  if (!tp || !oa || !rain || !vis || wind === undefined || temp === undefined) return undefined;
  return { thirdParty: tp, otherAircraft: oa, rain, visibility: vis, windMs: wind, tempC: temp };
};

const sanitizeGap = (v: unknown): FieldGap | null =>
  isRec(v) && (FIELD_GAP_ITEMS as readonly string[]).includes(v["item"] as string) && (FIELD_GAP_STATES as readonly string[]).includes(v["state"] as string)
    ? { item: v["item"] as FieldGap["item"], state: v["state"] as FieldGap["state"] }
    : null;

/** 現場の行（備考の自由記述 note・記録者の氏名は持たない形）。 */
export const sanitizeEventLite = (v: unknown): FieldEventLite | null => {
  if (!isRec(v)) return null;
  const id = str(v["id"], 64);
  const cid = uuid(v["clientEventId"]);
  const kind = str(v["kind"], 20);
  if (!id || !cid || !kind || !EVENT_KINDS.includes(kind)) return null;
  const item = strOrNull(v["item"], 40);
  if (item === undefined || (item !== null && !EVENT_ITEMS.includes(item))) return null;
  const result = strOrNull(v["result"], 20);
  if (result === undefined || (result !== null && !CHECK_RESULTS.includes(result))) return null;
  const source = strOrNull(v["source"], 100);
  const target = strOrNull(v["targetEventId"], 64);
  const fr = strOrNull(v["flightRecordId"], 64);
  const ins = strOrNull(v["inspectionId"], 64);
  const rep = strOrNull(v["reportId"], 64);
  const occurredAt = str(v["occurredAt"], 40);
  const recordedKey = str(v["recordedKey"], 64);
  const queued = bool(v["queued"]);
  if (source === undefined || target === undefined || fr === undefined || ins === undefined || rep === undefined) return null;
  if (!occurredAt || !recordedKey || queued === null) return null;
  const docKey = v["docKey"] === undefined ? null : strOrNull(v["docKey"], 20);
  if (docKey === undefined || (docKey !== null && !(FIELD_DOC_KEYS as readonly string[]).includes(docKey))) return null;
  const site = sanitizeSite(v["site"]);
  if (site === undefined) return null;
  const gaps = v["gaps"] === null || v["gaps"] === undefined ? null : arr(v["gaps"], sanitizeGap, 40);
  if (v["gaps"] !== null && v["gaps"] !== undefined && gaps === null) return null;
  const pv = v["planVersion"] === undefined || v["planVersion"] === null ? null : int(v["planVersion"]);
  return {
    id,
    clientEventId: cid,
    kind: kind as FieldEventKind,
    item: item as FieldEventItem | null,
    result: result as FieldCheckResult | null,
    source,
    planVersion: pv,
    docKey: docKey as FieldDocKey | null,
    site,
    targetEventId: target,
    flightRecordId: fr,
    inspectionId: ins,
    reportId: rep,
    occurredAt,
    recordedKey,
    queued,
    gaps,
  };
};

const sanitizeInspectionLite = (v: unknown): InspectionLite | null => {
  if (!isRec(v)) return null;
  const id = str(v["id"], 64);
  const at = str(v["inspectedAt"], 40);
  const date = str(v["date"], 10);
  const timing = v["timing"] === "pre_flight" || v["timing"] === "post_flight" ? v["timing"] : null;
  const ab = bool(v["hasAbnormal"]);
  return id && at && date && timing && ab !== null ? { id, inspectedAt: at, date, timing, hasAbnormal: ab } : null;
};

const sanitizePermitNumber = (v: unknown): DocsPermitNumber | null => {
  if (!isRec(v)) return null;
  const numberText = str(v["numberText"], 100);
  const status = str(v["status"], 30);
  const reg = strOrNull(v["registrationId"], 64);
  const pn = strOrNull(v["permitNumber"], 100);
  const ver = v["versionNo"] === null ? null : int(v["versionNo"]);
  const from = strOrNull(v["validFrom"], 10);
  const to = strOrNull(v["validTo"], 10);
  const kinds = v["kinds"] === undefined ? [] : arr(v["kinds"], (x) => str(x, 40), 20);
  const reasons = arr(v["reasonLabels"], (x) => str(x, 300), 20);
  if (!numberText || !status || reg === undefined || pn === undefined || (v["versionNo"] !== null && ver === null) || from === undefined || to === undefined || !kinds || !reasons) return null;
  return { numberText, status, registrationId: reg, permitNumber: pn, versionNo: ver, validFrom: from, validTo: to, kinds, reasonLabels: reasons };
};

const sanitizeDocsInput = (v: unknown): FieldBundleDocsInput | null => {
  if (!isRec(v)) return null;
  const start = str(v["plannedStartAtJst"], 16);
  const end = str(v["plannedEndAtJst"], 16);
  const wanted = arr(v["wantedKinds"], (x) => str(x, 40), 20);
  const permits = arr(v["permits"], sanitizePermitNumber, 50);
  if (!start || !end || !wanted || !permits) return null;
  let aircraft: FieldBundleDocsInput["aircraft"] = null;
  if (v["aircraft"] !== null) {
    const a = v["aircraft"];
    if (!isRec(a)) return null;
    const id = uuid(a["id"]);
    const mark = str(a["registrationMark"], 40);
    const status = a["status"] === "active" || a["status"] === "suspended" || a["status"] === "deregistered" ? a["status"] : null;
    const voided = bool(a["voided"]);
    if (!id || mark === null || !status || voided === null) return null;
    aircraft = { id, registrationMark: mark, status, voided };
  }
  let pilot: FieldBundleDocsInput["pilot"] = null;
  if (v["pilot"] !== null) {
    const p = v["pilot"];
    if (!isRec(p)) return null;
    const id = uuid(p["id"]);
    const name = str(p["fullName"], 100);
    const has = bool(p["hasLicense"]);
    const exp = strOrNull(p["licenseExpiresOn"], 10);
    const lim = bool(p["hasLimitation"]);
    const voided = p["voided"] === undefined ? false : bool(p["voided"]);
    // 技能証明書の番号（licenseNumber など）は拾わない
    if (!id || name === null || has === null || exp === undefined || lim === null || voided === null) return null;
    pilot = { id, fullName: name, hasLicense: has, licenseExpiresOn: exp, hasLimitation: lim, voided };
  }
  const r = v["report"];
  if (!isRec(r)) return null;
  const rk = str(r["requirementKind"], 40);
  const sc = str(r["statusCode"], 40);
  if (!rk || !sc) return null;
  let effective: FieldBundleDocsInput["report"]["effective"] = null;
  if (r["effective"] !== null) {
    const e = r["effective"];
    if (!isRec(e)) return null;
    const id = str(e["id"], 64);
    const dn = strOrNull(e["dipsNumber"], 100);
    const nu = bool(e["numberUnavailable"]);
    const ra = strOrNull(e["reportedAtJst"], 16);
    const rc = e["recordedAtJst"] === undefined ? null : strOrNull(e["recordedAtJst"], 16);
    if (!id || dn === undefined || nu === null || ra === undefined || rc === undefined) return null;
    effective = { id, dipsNumber: dn, numberUnavailable: nu, reportedAtJst: ra, recordedAtJst: rc };
  }
  return { plannedStartAtJst: start, plannedEndAtJst: end, wantedKinds: wanted, permits, aircraft, pilot, report: { requirementKind: rk, statusCode: sc, effective } };
};

const sanitizeReport = (v: unknown): FieldReportDto | null => {
  if (!isRec(v)) return null;
  const s = (k: string, max = 300) => str(v[k], max);
  const n = (k: string, max = 300) => strOrNull(v[k], max);
  const out = {
    requirementKind: s("requirementKind", 40),
    requirementLabel: s("requirementLabel"),
    statusCode: s("statusCode", 40),
    statusLabel: s("statusLabel"),
    statusMark: s("statusMark", 10),
    detail: n("detail"),
    effectiveReportId: n("effectiveReportId", 64),
    channelLabel: n("channelLabel"),
    notRequiredNote: n("notRequiredNote"),
    warning: n("warning"),
    reportHref: s("reportHref"),
    canRecheck: bool(v["canRecheck"]),
  };
  if (!out.requirementKind || out.requirementLabel === null || !out.statusCode || out.statusLabel === null || out.statusMark === null || out.reportHref === null || out.canRecheck === null) return null;
  if ([out.detail, out.effectiveReportId, out.channelLabel, out.notRequiredNote, out.warning].some((x) => x === undefined)) return null;
  return out as FieldReportDto;
};

const sanitizePlanSummary = (v: unknown): FieldBundlePlanSummary | null => {
  if (!isRec(v)) return null;
  const s = (k: string, max = 200) => str(v[k], max);
  const id = uuid(v["id"]);
  const permitNumbers = strOrNull(v["permitNumbers"], 500);
  const permitStates = arr(
    v["permitStates"],
    (x) => {
      if (!isRec(x)) return null;
      const a = str(x["numberText"], 100);
      const b = str(x["status"], 30);
      const c = str(x["statusLabel"], 100);
      return a !== null && b !== null && c !== null ? { numberText: a, status: b, statusLabel: c } : null;
    },
    50,
  );
  const duration = int(v["durationMinutes"]);
  const voided = bool(v["voided"]);
  const stale = bool(v["judgementStale"]);
  const self = bool(v["isSelf"]);
  const out = {
    id,
    title: s("title"),
    plannedDate: s("plannedDate", 10),
    plannedStartAtJst: s("plannedStartAtJst", 20),
    plannedEndAtJst: s("plannedEndAtJst", 20),
    timeLabel: s("timeLabel", 20),
    durationMinutes: duration,
    registrationMark: s("registrationMark", 40),
    modelName: s("modelName", 100),
    pilotName: s("pilotName", 100),
    placeName: s("placeName", 100),
    permitNumbers,
    permitStates,
    voided,
    state: s("state", 30),
    stateLabel: s("stateLabel", 60),
    verdictLevel: s("verdictLevel", 40),
    verdictLabel: s("verdictLabel", 60),
    judgementStale: stale,
    isSelf: self,
    startIso: s("startIso", 40),
  };
  if (permitNumbers === undefined) return null;
  for (const [k, x] of Object.entries(out)) if (x === null && k !== "permitNumbers") return null;
  return out as FieldBundlePlanSummary;
};

/**
 * 先読みの束を許可リストの項目だけに絞る。形が違えば null（端末の保存が壊れていても画面を壊さない）。
 * 入れるもの（設計の判断 3「含めるもの」）：計画の要約（日時・場所名・機体・操縦者・特定飛行の形態）、書類・手続きの判定に要る
 * 登録内容の要約（許可の番号・期間・範囲の要約、通報の状態と受付番号・日時、機体の登録記号と状態、操縦者の氏名と技能証明の有効期限・限定の有無）、
 * 現場の行（備考なし）、直近の点検の結果、計画の版。
 * 入れないもの：技能証明書の番号、座標（緯度・経度）、自由記述（計画の目的・備考・特記事項）、他の人の計画、判定スナップショットの全文。
 * 古さの基準（FIELD_BUNDLE_STALE_HOURS = 12 時間）：朝に事務所で開いて夕方まで現場で使う 1 日の運用（約 10 時間）では注記を出さず、
 * 前日以前に先読みした束（登録が変わった可能性が高い）には注記を出す。
 */
export const sanitizeFieldBundle = (raw: unknown): FieldBundlePlan | null => {
  if (!isRec(raw) || raw["v"] !== FIELD_BUNDLE_VERSION) return null;
  const memberId = uuid(raw["memberId"]);
  const planId = uuid(raw["planId"]);
  const fetchedAt = str(raw["fetchedAt"], 40);
  const plan = sanitizePlanSummary(raw["plan"]);
  const report = sanitizeReport(raw["report"]);
  const docs = sanitizeDocsInput(raw["docs"]);
  if (!memberId || !planId || !fetchedAt || !plan || plan.id !== planId || !report || !docs) return null;
  const pm = raw["perms"];
  if (!isRec(pm)) return null;
  const perms = { canRecord: bool(pm["canRecord"]), canJournal: bool(pm["canJournal"]), canInspect: bool(pm["canInspect"]) };
  if (perms.canRecord === null || perms.canJournal === null || perms.canInspect === null) return null;
  const g = raw["gap"];
  if (!isRec(g)) return null;
  const gap = {
    requirementKind: str(g["requirementKind"], 40),
    reportStatusCode: str(g["reportStatusCode"], 40),
    effectiveReportedAt: strOrNull(g["effectiveReportedAt"], 16),
    planState: typeof g["planState"] === "string" && PLAN_STATES.includes(g["planState"]) ? (g["planState"] as PlanState) : null,
    judgementStale: bool(g["judgementStale"]),
  };
  if (!gap.requirementKind || !gap.reportStatusCode || gap.effectiveReportedAt === undefined || !gap.planState || gap.judgementStale === null) return null;
  const st = raw["state"];
  if (!isRec(st)) return null;
  const events = arr(st["events"], sanitizeEventLite, MAX_EVENTS);
  const inspections = arr(st["inspections"], sanitizeInspectionLite, MAX_EVENTS);
  const flightRecords = arr(
    st["flightRecords"],
    (x) => (isRec(x) && str(x["id"], 64) && typeof x["voided"] === "boolean" ? { id: x["id"] as string, voided: x["voided"] as boolean } : null),
    MAX_EVENTS,
  );
  const planVersion = int(st["planVersion"]);
  if (!events || !inspections || !flightRecords || planVersion === null) return null;
  const f = raw["form"];
  if (!isRec(f)) return null;
  const aircraftId = uuid(f["aircraftId"]);
  const pilotId = uuid(f["pilotId"]);
  const types = arr(f["specificFlightTypes"], (x) => str(x, 40), 20);
  let last: FieldBundleForm["lastInspection"] = null;
  if (f["lastInspection"] !== null && f["lastInspection"] !== undefined) {
    const l = f["lastInspection"];
    if (!isRec(l)) return null;
    const at = str(l["inspectedAt"], 40);
    const timing = l["timing"] === "pre_flight" || l["timing"] === "post_flight" ? l["timing"] : null;
    const ab = bool(l["hasAbnormal"]);
    if (!at || !timing || ab === null) return null;
    last = { inspectedAt: at, timing, hasAbnormal: ab };
  }
  if (!aircraftId || !pilotId || !types) return null;
  return {
    v: FIELD_BUNDLE_VERSION,
    memberId,
    planId,
    fetchedAt,
    plan,
    perms: perms as FieldBundlePlan["perms"],
    report,
    docs,
    gap: gap as FieldGapInput,
    state: { events, inspections, flightRecords, planVersion },
    form: { aircraftId, pilotId, specificFlightTypes: types, lastInspection: last },
  };
};

// ---- 組み立て -----------------------------------------------------------------

const MINUTE_MS = 60_000;

const PHASE_LABEL: Readonly<Record<FieldFlight["phase"], string>> = {
  in_flight: FIELD_STATE_IN_FLIGHT,
  journal_pending: FIELD_STATE_JOURNAL_PENDING,
  journaled: FIELD_STATE_JOURNAL_DONE,
};

const sourceTitle = (id: string | null): string | null => EMERGENCY_SOURCE_OPTIONS.find((o) => o.id === id)?.title ?? null;

/** 計画の時間帯の外の知らせ（離陸が早い・着陸が遅い）。 */
export const windowNoticeOf = (startIso: string, durationMinutes: number, takeoffAt: Date | null, landingAt: Date | null): WindowNoticeDto | null => {
  const start = Date.parse(startIso);
  const end = start + durationMinutes * MINUTE_MS;
  const early = takeoffAt ? Math.max(0, Math.ceil((start - takeoffAt.getTime()) / MINUTE_MS)) : 0;
  const late = landingAt ? Math.max(0, Math.ceil((landingAt.getTime() - end) / MINUTE_MS)) : 0;
  if (early === 0 && late === 0) return null;
  return { code: "outside_plan_window", label: outsidePlanWindowLabel(early, late), earlyMinutes: early, lateMinutes: late };
};

/** 書類・手続きの判定の入力（束の登録内容 + 人の確認 + 判定時刻）。 */
export const docsInputOf = (docs: FieldBundleDocsInput, state: FieldState, atJst: string): DocsJudgeInput => ({
  ...docs,
  atJst,
  humanConfirms: state.docConfirms,
});

/** 離陸の未了事項（サーバーの離陸の記録・画面の予告・圏外の予告が同じ関数を通る）。 */
export const gapsFromInput = (g: FieldGapInput, state: FieldState, takeoffAtJst: string, docs: readonly DocJudgement[]): FieldGap[] =>
  takeoffGaps({
    checks: state.checks,
    requirementKind: g.requirementKind,
    reportStatusCode: g.reportStatusCode,
    effectiveReportedAt: g.effectiveReportedAt,
    takeoffAtJst,
    planState: g.planState,
    judgementStale: g.judgementStale,
    reportUnverified: docs.some((d) => d.key === "report" && d.countsAsGap),
    round: {
      docs: docGapsOf(docs),
      restrictionDone: state.round.restriction.done,
      site: { done: state.round.site.done, attention: state.round.site.attention },
    },
  });

export type ComposeOptions = {
  /** 現在（サーバーの現在、または圏外の端末の現在）。 */
  readonly now: Date;
  /** 計画の目的（自由記述。サーバーで開いたときだけ）。 */
  readonly purpose?: string;
  /** いまのラウンドの現場状況の備考（自由記述。サーバーで開いたときだけ）。 */
  readonly siteNote?: (eventId: string) => string | null;
  /** 同じ日の計画（サーバーで開いたときだけ）。 */
  readonly sameDayPlans?: FieldViewDto["sameDayPlans"];
  /** 束に無い行（端末の送信待ちなど）。 */
  readonly extraEvents?: readonly FieldEventLite[];
  readonly extraInspections?: readonly InspectionLite[];
  readonly extraFlightRecords?: readonly { readonly id: string; readonly voided: boolean }[];
};

/**
 * 先読みの束と現在の時刻から、現場の画面の内容を組み立てる。サーバーの GET /api/ops/plans/[id]/field と同じ関数。
 * 日常点検は「今日」（now の JST の日付）で導出する。書類・手続きは、飛行中ならその離陸の時刻、そうでなければ now で判定する。
 */
export const composeFieldView = (b: FieldBundlePlan, o: ComposeOptions): FieldViewDto => {
  const now = o.now;
  const today = jstDate(now);
  const planId = b.planId;
  const events = [...b.state.events, ...(o.extraEvents ?? [])];
  const inspections = [...b.state.inspections, ...(o.extraInspections ?? [])];
  const flightRecords = [...b.state.flightRecords, ...(o.extraFlightRecords ?? [])];
  const state = fieldState({ events, inspections, flightRecords, day: today, planVersion: b.state.planVersion });
  const canRecord = b.perms.canRecord;
  const atJst = state.openFlight ? toJstInput(new Date(state.openFlight.takeoffAt)) : toJstInput(now);
  const docJudgements = judgeFieldDocs(docsInputOf(b.docs, state, atJst));
  const docs = docJudgements.map(
    (d): FieldDocDto => ({
      key: d.key,
      label: FIELD_DOC_LABEL[d.key],
      status: d.status,
      effective: d.effective,
      statusLabel: d.effective === "confirmed_human" ? FIELD_DOC_HUMAN_CONFIRMED_LABEL : FIELD_DOC_STATUS_LABEL[d.status],
      basis: d.basis,
      notes: d.notes,
      href: d.key === "report" ? withFieldReturn(`/ops/plans/${planId}/report`, planId) : d.href ? withFieldReturn(d.href, planId) : null,
      canConfirm: d.canConfirm && canRecord && !b.plan.voided,
      humanConfirmEventId: d.humanConfirmEventId,
      humanConfirmedTime: d.humanConfirmedAt ? jstTime(new Date(d.humanConfirmedAt)) : null,
    }),
  );
  const report = b.report;
  const items = FIELD_CHECK_ITEMS.map((item): FieldItemDto => {
    const c = state.checks[item];
    const warning =
      item === "inspection" && c.abnormal
        ? INSPECTION_ABNORMAL_GUIDANCE
        : item === "emergency_airspace" && c.designated
          ? EMERGENCY_DESIGNATED_WARNING
          : item === "report_recheck"
            ? report.warning
            : null;
    return {
      item,
      label: FIELD_CHECK_ITEM_LABEL[item],
      done: c.done,
      stateLabel: !c.done ? FIELD_STATE_TODO : c.abnormal ? FIELD_STATE_ABNORMAL : FIELD_STATE_DONE,
      time: c.at ? jstTime(new Date(c.at)) : null,
      result: c.result,
      resultLabel: c.result ? FIELD_CHECK_RESULT_LABEL[c.result] : null,
      source: c.source,
      sourceTitle: sourceTitle(c.source),
      eventId: c.eventId,
      inspectionId: c.inspectionId,
      abnormal: c.abnormal,
      designated: c.designated,
      warning,
      undoable: c.eventId !== null && canRecord,
    };
  });
  const flights = state.flights.map(
    (f): FieldFlightDto => ({
      takeoffEventId: f.takeoffEventId,
      takeoffClientEventId: f.takeoffClientEventId,
      takeoffAt: toJstInput(new Date(f.takeoffAt)),
      takeoffTime: jstTime(new Date(f.takeoffAt)),
      takeoffQueued: f.takeoffQueued,
      gaps: f.gaps.map(gapDto),
      landingEventId: f.landingEventId,
      landingAt: f.landingAt ? toJstInput(new Date(f.landingAt)) : null,
      landingTime: f.landingAt ? jstTime(new Date(f.landingAt)) : null,
      landingQueued: f.landingQueued,
      journalEventId: f.journalEventId,
      flightRecordId: f.flightRecordId,
      phase: f.phase,
      phaseLabel: PHASE_LABEL[f.phase],
      roundNumber: f.roundIndex + 1,
      preInspectionId: f.preInspectionId,
      post: { done: f.post.done, inspectionId: f.post.inspectionId, abnormal: f.post.abnormal, time: f.post.at ? jstTime(new Date(f.post.at)) : null },
      windowNotice: windowNoticeOf(b.plan.startIso, b.plan.durationMinutes, new Date(f.takeoffAt), f.landingAt ? new Date(f.landingAt) : null),
    }),
  );
  const { startIso: _startIso, ...summary } = b.plan;
  void _startIso;
  return {
    serverNow: now.toISOString(),
    serverNowJst: toJstInput(now),
    today,
    plan: { ...summary, purpose: o.purpose ?? "" },
    canRecord,
    canJournal: b.perms.canJournal,
    canInspect: b.perms.canInspect,
    items,
    report,
    docs,
    round: {
      number: state.round.index + 1,
      restriction: {
        done: state.round.restriction.done,
        eventId: state.round.restriction.eventId,
        time: state.round.restriction.at ? jstTime(new Date(state.round.restriction.at)) : null,
        sourceTitle: FLIGHT_RESTRICTION_SOURCE.title,
        url: FLIGHT_RESTRICTION_SOURCE.url,
        note:
          FLIGHT_RESTRICTION_SOURCE.url === null
            ? FIELD_RESTRICTION_UNCONFIRMED_NOTE
            : `確認元：${FLIGHT_RESTRICTION_SOURCE.title}／確認日 ${FLIGHT_RESTRICTION_SOURCE.checkedOn ?? "未記録"}`,
      },
      emergencyNote: FIELD_EMERGENCY_SOURCE_NOTE,
      site: {
        done: state.round.site.done,
        eventId: state.round.site.eventId,
        time: state.round.site.at ? jstTime(new Date(state.round.site.at)) : null,
        values: state.round.site.values,
        note: state.round.site.eventId && o.siteNote ? o.siteNote(state.round.site.eventId) : null,
        attention: state.round.site.attention,
      },
    },
    postPendingCount: state.postPending.length,
    emergencySources: EMERGENCY_SOURCE_OPTIONS,
    flights,
    openFlightEventId: state.openFlight?.takeoffEventId ?? null,
    pendingJournalTakeoffEventIds: state.pendingJournal.map((f) => f.takeoffEventId),
    takeoffPreview: gapsFromInput(b.gap, state, toJstInput(now), docJudgements).map(gapDto),
    sameDayPlans: o.sameDayPlans ?? [],
    stateInput: { events, inspections, flightRecords, day: today, planVersion: b.state.planVersion },
  };
};
