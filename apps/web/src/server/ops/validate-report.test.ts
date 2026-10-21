// Sprint 12b 契約 5・7・17（入力検査）：通報・手続きの記録の API の入力検査。
import { describe, expect, it } from "vitest";
import {
  mergeCorrection,
  PROCEDURE_CHECK_KEYS,
  pickCorrectionChanges,
  REPORT_FIELD_LABELS,
  validateCopyAudit,
  validateCreateReport,
  validateProcedureRecord,
  validateReportMeta,
  validateResolve,
  validateRetry,
} from "./validate-report";

const NOW = new Date("2027-01-05T03:00:00Z");
const UUID = "11111111-1111-4111-8111-111111111111";
const codes = (r: { ok: boolean; codes?: Record<string, string> }) => (r.ok ? {} : r.codes);

describe("validateCreateReport", () => {
  it("新規・変更は expectedPlanVersion が必須。取消は任意", () => {
    expect(codes(validateCreateReport({ kind: "new" }))).toEqual({ expectedPlanVersion: "required" });
    expect(codes(validateCreateReport({ kind: "change" }))).toEqual({ expectedPlanVersion: "required" });
    expect(validateCreateReport({ kind: "cancel" }).ok).toBe(true);
    expect(codes(validateCreateReport({ kind: "new", expectedPlanVersion: 0 }))).toEqual({ expectedPlanVersion: "invalid" });
    expect(codes(validateCreateReport({ kind: "new", expectedPlanVersion: "2" }))).toEqual({ expectedPlanVersion: "invalid" });
  });

  it("種別・元の通報の検査。新規に元の通報は付けられない", () => {
    expect(codes(validateCreateReport({ kind: "x", expectedPlanVersion: 1 }))).toEqual({ kind: "invalid" });
    expect(codes(validateCreateReport({ kind: "new", expectedPlanVersion: 1, baseReportId: UUID }))).toEqual({ baseReportId: "not_allowed" });
    expect(codes(validateCreateReport({ kind: "change", expectedPlanVersion: 1, baseReportId: "nope" }))).toEqual({ baseReportId: "invalid" });
    const ok = validateCreateReport({ kind: "change", expectedPlanVersion: 3, baseReportId: UUID.toUpperCase() });
    expect(ok.ok && ok.data.baseReportId).toBe(UUID);
  });

  it("サーバーが決める値（指紋・冪等性キー・状態・送信元・スナップショットなど）は読まない", () => {
    const r = validateCreateReport({
      kind: "new",
      expectedPlanVersion: 1,
      fingerprint: "x",
      idempotencyKey: "x",
      status: "reported_manual",
      channel: "api",
      snapshotId: UUID,
      planVersion: 99,
      mapRevision: 99,
      reportedAt: "2027-01-01T00:00",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.data).sort()).toEqual(["baseReportId", "confirmSend", "expectedPlanVersion", "inputs", "kind", "manualRaw", "mockScenario"]);
  });

  it("通報の画面の入力の誤りは項目ごとに返す。模擬のシナリオは決められた値だけ", () => {
    expect(codes(validateCreateReport({ kind: "new", expectedPlanVersion: 1, inputs: { flightSpeed: 0, plannedMaxTime: 33 } }))).toEqual({
      flightSpeed: "range",
      plannedMaxTime: "step",
    });
    expect(codes(validateCreateReport({ kind: "new", expectedPlanVersion: 1, mockScenario: "boom" }))).toEqual({ mockScenario: "invalid" });
    for (const s of ["ok", "rejected", "unauthorized", "server_error", "timeout", "unknown_status"]) {
      const r = validateCreateReport({ kind: "new", expectedPlanVersion: 1, mockScenario: s, confirmSend: true });
      expect(r.ok && r.data.mockScenario).toBe(s);
      expect(r.ok && r.data.confirmSend).toBe(true);
    }
    // confirmSend は true のときだけ真
    expect(validateCreateReport({ kind: "new", expectedPlanVersion: 1, confirmSend: "true" }).ok && 1).toBe(1);
    const r = validateCreateReport({ kind: "new", expectedPlanVersion: 1, confirmSend: "true" });
    expect(r.ok && r.data.confirmSend).toBe(false);
  });
});

describe("validateReportMeta / validateResolve / validateRetry", () => {
  it("expectedVersion と理由が必須", () => {
    expect(codes(validateReportMeta({}))).toEqual({ expectedVersion: "required", reason: "required" });
    expect(codes(validateReportMeta({ expectedVersion: 1 }))).toEqual({ reason: "required" });
    expect(codes(validateReportMeta({ expectedVersion: 1, reason: "a".repeat(501) }))).toEqual({ reason: "too_long" });
    expect(validateReportMeta({ expectedVersion: 2, reason: " 誤り " })).toEqual({ ok: true, data: { expectedVersion: 2, reason: "誤り" } });
  });
  it("結果不明の確定は reported／not_reported", () => {
    expect(codes(validateResolve({}))).toEqual({ outcome: "invalid" });
    expect(validateResolve({ outcome: "reported", manual: { a: 1 } }).ok).toBe(true);
    expect(validateResolve({ outcome: "not_reported" }).ok).toBe(true);
  });
  it("再送の本文は confirmSend とシナリオ", () => {
    expect(validateRetry({ confirmSend: true, mockScenario: "ok" })).toEqual({ ok: true, data: { confirmSend: true, mockScenario: "ok" } });
    expect(codes(validateRetry({ mockScenario: 1 }))).toEqual({ mockScenario: "invalid" });
  });
});

describe("mergeCorrection（手動記録の訂正）", () => {
  type Cur = { reportedAt: string | null; dipsNumber: string | null; numberUnavailable: boolean; memo: string | null };
  const cur: Cur = { reportedAt: "2027-01-05T11:30", dipsNumber: "FP-1", numberUnavailable: false, memo: null };
  const merge = (changes: Record<string, unknown>, current: Cur = cur) =>
    mergeCorrection(current, pickCorrectionChanges(changes), NOW, "number_or_declared_unavailable");

  it("指定のあった項目だけを現在の値に重ねる", () => {
    expect(merge({ dipsNumber: "FP-2" })).toMatchObject({ ok: true, data: { reportedAt: "2027-01-05T11:30", dipsNumber: "FP-2", numberUnavailable: false } });
    expect(merge({ memo: "控え" })).toMatchObject({ ok: true, data: { dipsNumber: "FP-1", memo: "控え" } });
    expect(merge({ reportedAt: "2027-01-05T10:00" })).toMatchObject({ ok: true, data: { reportedAt: "2027-01-05T10:00" } });
  });

  it("番号を入れれば宣言が外れ、宣言を入れれば番号が消える（メモが必要）", () => {
    const decl = { reportedAt: "2027-01-05T11:30", dipsNumber: null, numberUnavailable: true, memo: "番号が出なかった" };
    expect(merge({ dipsNumber: "FP-3" }, decl)).toMatchObject({ ok: true, data: { dipsNumber: "FP-3", numberUnavailable: false } });
    expect(merge({ numberUnavailable: true })).toMatchObject({ ok: false, codes: { memo: "memo_required" } });
    expect(merge({ numberUnavailable: true, memo: "出なかった" })).toMatchObject({ ok: true, data: { dipsNumber: null, numberUnavailable: true } });
  });

  it("未来の日時・形の誤りは拒否。二つの確認は求めない", () => {
    expect(merge({ reportedAt: "2027-01-05T12:01" })).toMatchObject({ ok: false, codes: { reportedAt: "in_future" } });
    expect(merge({ reportedAt: "2027-01-05" })).toMatchObject({ ok: false, codes: { reportedAt: "time_format" } });
    expect(merge({ dipsNumber: "" })).toMatchObject({ ok: false, codes: { dipsNumber: "number_required" } });
    expect(merge({ memo: null })).toMatchObject({ ok: true });
  });

  it("訂正で読む項目は 4 つだけ", () => {
    expect(Object.keys(pickCorrectionChanges({ reportedAt: 1, dipsNumber: 1, numberUnavailable: 1, memo: 1, status: "x", channel: "api", fingerprint: "x" })).sort()).toEqual([
      "dipsNumber",
      "memo",
      "numberUnavailable",
      "reportedAt",
    ]);
  });
});

describe("validateCopyAudit", () => {
  const known = new Set(["name", "start_time"]);
  it("key か keys。未知の key・空・多すぎるのは誤り。値は受け取らない", () => {
    expect(validateCopyAudit({ key: "name" }, known)).toEqual({ ok: true, data: { keys: ["name"] } });
    expect(validateCopyAudit({ keys: ["name", "start_time"], value: "x" }, known)).toEqual({ ok: true, data: { keys: ["name", "start_time"] } });
    expect(codes(validateCopyAudit({}, known))).toEqual({ keys: "required" });
    expect(codes(validateCopyAudit({ keys: [] }, known))).toEqual({ keys: "required" });
    expect(codes(validateCopyAudit({ keys: ["name", "zzz"] }, known))).toEqual({ keys: "unknown_key" });
    expect(codes(validateCopyAudit({ keys: [1] }, known))).toEqual({ keys: "unknown_key" });
    expect(codes(validateCopyAudit({ keys: Array(101).fill("name") }, known))).toEqual({ keys: "too_many" });
  });
});

describe("validateProcedureRecord", () => {
  const done = { kind: "dips_permit", action: "done", doneAt: "2027-01-05T11:00", checks: { applicationCompleted: true } };
  it("done はすべての確認が真のときだけ", () => {
    expect(validateProcedureRecord(done, NOW).ok).toBe(true);
    expect(codes(validateProcedureRecord({ ...done, checks: { applicationCompleted: false } }, NOW))).toEqual({ "checks.applicationCompleted": "confirm_required" });
    expect(codes(validateProcedureRecord({ ...done, checks: undefined }, NOW))).toEqual({ "checks.applicationCompleted": "confirm_required" });
    const police = { kind: "small_drone_law", action: "done", doneAt: "2027-01-05T11:00" };
    expect(codes(validateProcedureRecord({ ...police, checks: { facilityConsentObtained: true } }, NOW))).toEqual({ "checks.policeNoticeDone": "confirm_required" });
    expect(codes(validateProcedureRecord({ ...police, checks: {} }, NOW))).toEqual({
      "checks.facilityConsentObtained": "confirm_required",
      "checks.policeNoticeDone": "confirm_required",
    });
    expect(validateProcedureRecord({ ...police, checks: { facilityConsentObtained: true, policeNoticeDone: true }, reference: " R-1 " }, NOW)).toMatchObject({
      ok: true,
      data: { reference: "R-1" },
    });
    expect(PROCEDURE_CHECK_KEYS.dips_permit).toEqual(["applicationCompleted"]);
  });
  it("日時は JST 分の形で未来は誤り。種類・操作の値、控えの長さ", () => {
    expect(codes(validateProcedureRecord({ ...done, doneAt: undefined }, NOW))).toEqual({ doneAt: "required" });
    expect(codes(validateProcedureRecord({ ...done, doneAt: "2027-01-05T12:01" }, NOW))).toEqual({ doneAt: "in_future" });
    expect(codes(validateProcedureRecord({ ...done, doneAt: "x" }, NOW))).toEqual({ doneAt: "time_format" });
    expect(codes(validateProcedureRecord({ ...done, kind: "x" }, NOW))).toMatchObject({ kind: "invalid" });
    expect(codes(validateProcedureRecord({ ...done, action: "x" }, NOW))).toMatchObject({ action: "invalid" });
    expect(codes(validateProcedureRecord({ ...done, reference: "あ".repeat(101) }, NOW))).toEqual({ reference: "too_long" });
  });
  it("retract は理由が必須で、確認も日時も要らない", () => {
    expect(codes(validateProcedureRecord({ kind: "dips_permit", action: "retract" }, NOW))).toEqual({ reason: "required" });
    expect(validateProcedureRecord({ kind: "dips_permit", action: "retract", reason: "誤り" }, NOW)).toMatchObject({ ok: true, data: { reason: "誤り", doneAt: null } });
  });
  it("計画の版は任意（あれば整数）", () => {
    expect(codes(validateProcedureRecord({ ...done, expectedPlanVersion: 0 }, NOW))).toEqual({ expectedPlanVersion: "invalid" });
    expect(validateProcedureRecord({ ...done, expectedPlanVersion: 3 }, NOW)).toMatchObject({ ok: true, data: { expectedPlanVersion: 3 } });
  });
});

describe("通報の版の履歴の項目名", () => {
  it("版の data の列が項目名を持つ", () => {
    for (const k of ["status", "reported_at", "dips_number", "memo", "number_unavailable"]) expect(REPORT_FIELD_LABELS[k]).toBeTruthy();
  });
});
