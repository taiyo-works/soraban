// 通報・手続きの記録の API の入力検査（Sprint 12b 設計 G）。純粋関数。
// 本文のうち、サーバーが決める値（指紋・冪等性キー・対応表の版・状態・計画の版・スナップショット・送信元・通報日時の根拠）は読まない。
// 手動の記録・通報の画面の入力の細かい検査は @soraban/dips の validateManualResult・validateReportInputs が行う。
import {
  MOCK_SCENARIOS,
  PROCEDURE_RECORD_KINDS,
  REPORT_KINDS,
  parseJstMinuteString,
  validateManualResult,
  validateReason,
  validateReportInputs,
  type ManualResult,
  type MockScenario,
  type ProcedureRecordKind,
  type ReportInputs,
  type ReportKind,
} from "@soraban/dips";
import type { NumberPolicy } from "@soraban/dips";
import { collector, present, type RecordValidated } from "./validate-records";

type Input = Readonly<Record<string, unknown>>;

/** 通報の記録（flight_report）の版の data の項目名 → 表示名（版の差分の項目名に使う）。 */
export const REPORT_FIELD_LABELS: Readonly<Record<string, string>> = {
  plan_id: "計画",
  kind: "種別",
  base_report_id: "元の通報",
  snapshot_id: "判定スナップショット",
  plan_version: "計画の版",
  fingerprint: "通報の指紋",
  fingerprint_parts: "通報の指紋の元の値",
  map_revision: "項目の対応表の版",
  channel: "送信元",
  status: "状態",
  idempotency_key: "冪等性キー",
  reported_at: "通報日時",
  dips_number: "DIPS の番号",
  number_unavailable: "番号が表示されなかった",
  confirmed_dips_done: "確認：DIPS で通報を完了した",
  confirmed_matches_latest: "確認：最新の版と一致している",
  content: "通報内容の写し",
  memo: "メモ",
  error_kind: "失敗の種類",
  external_ref: "外部の参照",
  external_status: "外部の状況",
};

export type Fields = { readonly errors: Record<string, string>; readonly codes: Record<string, string> };

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// ---- 通報の記録を作る ----------------------------------------------

export type CreateReportInput = {
  readonly kind: ReportKind;
  readonly baseReportId: string | null;
  readonly expectedPlanVersion: number | null;
  readonly inputs: ReportInputs | undefined;
  /** 手動（取消を含む）：利用者が DIPS で通報した結果。検査は dips の validateManualResult（アダプターが行う）。 */
  readonly manualRaw: unknown;
  readonly confirmSend: boolean;
  readonly mockScenario: MockScenario | undefined;
};

/** POST …/reports の本文。種別・元の通報・計画の版・通報の画面の入力・送信の確認を読む。 */
export const validateCreateReport = (input: Input): RecordValidated<CreateReportInput> => {
  const c = collector();
  const kind = input["kind"];
  if (typeof kind !== "string" || !(REPORT_KINDS as readonly string[]).includes(kind)) {
    c.fail("kind", "invalid", "種別は new・change・cancel のいずれかです");
  }
  let baseReportId: string | null = null;
  if (present(input["baseReportId"])) {
    if (!isUuid(input["baseReportId"])) c.fail("baseReportId", "invalid", "元の通報が正しくありません");
    else baseReportId = (input["baseReportId"] as string).toLowerCase();
  }
  if (kind === "new" && baseReportId !== null) c.fail("baseReportId", "not_allowed", "新規の通報に元の通報は指定できません");

  let expectedPlanVersion: number | null = null;
  const ev = input["expectedPlanVersion"];
  if (present(ev)) {
    if (typeof ev !== "number" || !Number.isInteger(ev) || ev < 1) c.fail("expectedPlanVersion", "invalid", "計画の版番号が正しくありません");
    else expectedPlanVersion = ev;
  } else if (kind === "new" || kind === "change") {
    c.fail("expectedPlanVersion", "required", "計画の版番号が必要です");
  }

  const inputs = validateReportInputs(input["inputs"]);
  if (!inputs.ok) for (const [k, m] of Object.entries(inputs.errors)) c.fail(k, inputs.codes[k] ?? "invalid", m);

  let mockScenario: MockScenario | undefined;
  const ms = input["mockScenario"];
  if (present(ms)) {
    if (typeof ms !== "string" || !(MOCK_SCENARIOS as readonly string[]).includes(ms)) c.fail("mockScenario", "invalid", "模擬のシナリオが正しくありません");
    else mockScenario = ms as MockScenario;
  }

  return c.result(() => ({
    kind: kind as ReportKind,
    baseReportId,
    expectedPlanVersion,
    inputs: inputs.ok && input["inputs"] !== undefined ? inputs.data : undefined,
    manualRaw: input["manual"],
    confirmSend: input["confirmSend"] === true,
    mockScenario,
  }));
};

// ---- 訂正・取り下げ・確定・再送 ------------------------------------

export type ChangeMetaInput = { readonly expectedVersion: number; readonly reason: string };

/** expectedVersion（行の版）と理由（必須）。 */
export const validateReportMeta = (input: Input): RecordValidated<ChangeMetaInput> => {
  const c = collector();
  const v = input["expectedVersion"];
  let expectedVersion = 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) c.fail("expectedVersion", "required", "版番号が必要です");
  else expectedVersion = v;
  const reason = validateReason(input["reason"]);
  if (!reason.ok) for (const [k, m] of Object.entries(reason.errors)) c.fail(k, reason.codes[k] ?? "invalid", m);
  return c.result(() => ({ expectedVersion, reason: reason.ok ? reason.data : "" }));
};

export type CorrectionChanges = {
  readonly reportedAt?: string | null;
  readonly dipsNumber?: string | null;
  readonly numberUnavailable?: boolean;
  readonly memo?: string | null;
};

/** 手動記録の訂正で変える項目（通報日時・番号・番号なしの宣言・メモ）。指定のあった項目だけを返す。 */
export const pickCorrectionChanges = (input: Input): CorrectionChanges => {
  const out: Record<string, unknown> = {};
  for (const k of ["reportedAt", "dipsNumber", "numberUnavailable", "memo"] as const) if (k in input) out[k] = input[k];
  return out as CorrectionChanges;
};

export type ExistingManualFields = {
  readonly reportedAt: string | null;
  readonly dipsNumber: string | null;
  readonly numberUnavailable: boolean;
  readonly memo: string | null;
};

/**
 * 訂正の入力を、現在の値に重ねて検査する。番号を入れて宣言の指定が無ければ宣言を外し、宣言を入れて番号の指定が無ければ番号を消す
 * （片方だけを変えたときに、番号と宣言が両立しない誤りにならないように）。
 */
export const mergeCorrection = (
  current: ExistingManualFields,
  changes: CorrectionChanges,
  now: Date,
  numberPolicy: NumberPolicy,
): RecordValidated<ManualResult> => {
  const hasNumber = "dipsNumber" in changes;
  const hasDecl = "numberUnavailable" in changes;
  const dipsNumber = hasNumber ? changes.dipsNumber : hasDecl && changes.numberUnavailable === true ? null : current.dipsNumber;
  const numberUnavailable = hasDecl
    ? changes.numberUnavailable
    : hasNumber && typeof changes.dipsNumber === "string" && changes.dipsNumber.trim() !== ""
      ? false
      : current.numberUnavailable;
  const r = validateManualResult(
    {
      reportedAt: "reportedAt" in changes ? changes.reportedAt : current.reportedAt,
      dipsNumber,
      numberUnavailable,
      memo: "memo" in changes ? changes.memo : current.memo,
    },
    now,
    { numberPolicy, requireConfirmations: false },
  );
  return r.ok ? { ok: true, data: r.data } : { ok: false, errors: r.errors, codes: r.codes };
};

export type ResolveInput = {
  readonly outcome: "reported" | "not_reported";
  readonly manualRaw: unknown;
};

/** 結果不明の確定：DIPS の画面で確かめた結果（通報されていた／されていなかった）。 */
export const validateResolve = (input: Input): RecordValidated<ResolveInput> => {
  const c = collector();
  const o = input["outcome"];
  if (o !== "reported" && o !== "not_reported") c.fail("outcome", "invalid", "通報されていたか、されていなかったかを選んでください");
  return c.result(() => ({ outcome: o as "reported" | "not_reported", manualRaw: input["manual"] }));
};

/** 失敗の再送の本文：送信の確認とシナリオ。 */
export const validateRetry = (input: Input): RecordValidated<{ confirmSend: boolean; mockScenario: MockScenario | undefined }> => {
  const c = collector();
  let mockScenario: MockScenario | undefined;
  const ms = input["mockScenario"];
  if (present(ms)) {
    if (typeof ms !== "string" || !(MOCK_SCENARIOS as readonly string[]).includes(ms)) c.fail("mockScenario", "invalid", "模擬のシナリオが正しくありません");
    else mockScenario = ms as MockScenario;
  }
  return c.result(() => ({ confirmSend: input["confirmSend"] === true, mockScenario }));
};

// ---- コピーの監査 --------------------------------------------------

export const MAX_COPY_AUDIT_KEYS = 100;

/** コピーした項目の key（1 件か一覧）。値は受け取らない（値は記録しない）。 */
export const validateCopyAudit = (input: Input, knownKeys: ReadonlySet<string>): RecordValidated<{ keys: string[] }> => {
  const c = collector();
  const raw = "keys" in input ? input["keys"] : "key" in input ? [input["key"]] : undefined;
  const keys: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) {
    c.fail("keys", "required", "コピーした項目の key が必要です");
  } else if (raw.length > MAX_COPY_AUDIT_KEYS) {
    c.fail("keys", "too_many", `一度に記録できるのは ${MAX_COPY_AUDIT_KEYS} 項目までです`);
  } else {
    for (const k of raw) {
      if (typeof k !== "string" || !knownKeys.has(k)) {
        c.fail("keys", "unknown_key", "項目の key が正しくありません");
        break;
      }
      keys.push(k);
    }
  }
  return c.result(() => ({ keys }));
};

// ---- 手続きの「済み」の記録 ----------------------------------------

export type ProcedureRecordInput = {
  readonly kind: ProcedureRecordKind;
  readonly action: "done" | "retract";
  /** JST の `YYYY-MM-DDTHH:MM`（done のとき）。 */
  readonly doneAt: string | null;
  readonly reference: string | null;
  readonly reason: string | null;
  readonly expectedPlanVersion: number | null;
};

/** done の確認項目（すべて真のときだけ記録できる）。 */
export const PROCEDURE_CHECK_KEYS: Readonly<Record<ProcedureRecordKind, readonly string[]>> = {
  dips_permit: ["applicationCompleted"],
  small_drone_law: ["facilityConsentObtained", "policeNoticeDone"],
};

export const MAX_PROCEDURE_REFERENCE = 100;

/** POST …/procedure-records の本文。done はすべての確認が真のときだけ。 */
export const validateProcedureRecord = (input: Input, now: Date): RecordValidated<ProcedureRecordInput> => {
  const c = collector();
  const kind = input["kind"];
  if (typeof kind !== "string" || !(PROCEDURE_RECORD_KINDS as readonly string[]).includes(kind)) {
    c.fail("kind", "invalid", "種類は dips_permit か small_drone_law です");
  }
  const action = input["action"];
  if (action !== "done" && action !== "retract") c.fail("action", "invalid", "操作は done か retract です");

  let doneAt: string | null = null;
  if (action === "done") {
    if (!present(input["doneAt"])) c.fail("doneAt", "required", "日時を入力してください");
    else {
      const d = parseJstMinuteString(input["doneAt"]);
      if (!d) c.fail("doneAt", "time_format", "日付と時刻を YYYY-MM-DDTHH:MM（日本時間、分まで）で入力してください");
      else if (d.getTime() > now.getTime()) c.fail("doneAt", "in_future", "日時が現在より後です");
      else doneAt = input["doneAt"] as string;
    }
    const checks = input["checks"];
    const need = typeof kind === "string" ? (PROCEDURE_CHECK_KEYS[kind as ProcedureRecordKind] ?? []) : [];
    const have = checks && typeof checks === "object" && !Array.isArray(checks) ? (checks as Record<string, unknown>) : {};
    for (const k of need) if (have[k] !== true) c.fail(`checks.${k}`, "confirm_required", "この確認が必要です");
  }

  let reference: string | null = null;
  if (present(input["reference"])) {
    if (typeof input["reference"] !== "string") c.fail("reference", "invalid", "控えの番号は文字で入力してください");
    else if (Array.from(input["reference"].trim()).length > MAX_PROCEDURE_REFERENCE) {
      c.fail("reference", "too_long", `控えの番号は ${MAX_PROCEDURE_REFERENCE} 文字以内にしてください`);
    } else reference = input["reference"].trim() || null;
  }

  let reason: string | null = null;
  if (action === "retract") {
    const r = validateReason(input["reason"]);
    if (!r.ok) for (const [k, m] of Object.entries(r.errors)) c.fail(k, r.codes[k] ?? "invalid", m);
    else reason = r.data;
  }

  let expectedPlanVersion: number | null = null;
  if (present(input["expectedPlanVersion"])) {
    const ev = input["expectedPlanVersion"];
    if (typeof ev !== "number" || !Number.isInteger(ev) || ev < 1) c.fail("expectedPlanVersion", "invalid", "計画の版番号が正しくありません");
    else expectedPlanVersion = ev;
  }

  return c.result(() => ({
    kind: kind as ProcedureRecordKind,
    action: action as "done" | "retract",
    doneAt,
    reference,
    reason,
    expectedPlanVersion,
  }));
};
