// Sprint 12b 契約 5：手動の記録の検査、通報の画面の入力の検査。
import { describe, expect, it } from "vitest";
import {
  charCount,
  parseJstMinuteString,
  toJstMinuteString,
  validateManualResult,
  validateReason,
  validateReportInputs,
} from "./validate";

const NOW = new Date("2027-01-05T03:00:00Z"); // JST 2027-01-05 12:00
const ok = {
  reportedAt: "2027-01-05T11:30",
  dipsNumber: "FP-0001",
  confirmedDipsDone: true,
  confirmedMatchesLatest: true,
};
const codesOf = (r: ReturnType<typeof validateManualResult>) => (r.ok ? {} : r.codes);

describe("手動の記録", () => {
  it("正しい入力は通る（番号あり）", () => {
    const r = validateManualResult(ok, NOW);
    expect(r).toEqual({
      ok: true,
      data: { reportedAt: "2027-01-05T11:30", dipsNumber: "FP-0001", numberUnavailable: false, memo: null, confirmedDipsDone: true, confirmedMatchesLatest: true },
    });
  });

  it("二つの確認が揃わないと誤り", () => {
    expect(codesOf(validateManualResult({ ...ok, confirmedDipsDone: false }, NOW))).toEqual({ confirmedDipsDone: "confirm_required" });
    expect(codesOf(validateManualResult({ ...ok, confirmedMatchesLatest: false }, NOW))).toEqual({ confirmedMatchesLatest: "confirm_required" });
    expect(codesOf(validateManualResult({ ...ok, confirmedDipsDone: undefined, confirmedMatchesLatest: "true" }, NOW))).toEqual({
      confirmedDipsDone: "confirm_required",
      confirmedMatchesLatest: "confirm_required",
    });
    // 訂正では確認を求めない
    expect(validateManualResult({ ...ok, confirmedDipsDone: false }, NOW, { requireConfirmations: false }).ok).toBe(true);
  });

  it("番号か「番号が表示されなかった」の宣言のどちらかが必須。両方は誤り。宣言のときはメモが必須", () => {
    expect(codesOf(validateManualResult({ ...ok, dipsNumber: null }, NOW))).toEqual({ dipsNumber: "number_required" });
    expect(codesOf(validateManualResult({ ...ok, dipsNumber: "  " }, NOW))).toEqual({ dipsNumber: "number_required" });
    expect(codesOf(validateManualResult({ ...ok, numberUnavailable: true }, NOW))).toEqual({ numberUnavailable: "number_conflict" });
    expect(codesOf(validateManualResult({ ...ok, dipsNumber: null, numberUnavailable: true }, NOW))).toEqual({ memo: "memo_required" });
    const good = validateManualResult({ ...ok, dipsNumber: null, numberUnavailable: true, memo: "完了画面に番号が出なかった。13:05 に確認" }, NOW);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.data).toMatchObject({ dipsNumber: null, numberUnavailable: true });
    // 番号を必須にする方針（データ）なら宣言を認めない
    expect(
      codesOf(validateManualResult({ ...ok, dipsNumber: null, numberUnavailable: true, memo: "x" }, NOW, { numberPolicy: "required_number" })),
    ).toEqual({ numberUnavailable: "number_required" });
  });

  it("通報日時は JST 分の形。秒・タイムゾーン付き・存在しない日付は誤り。未来の時刻も誤り", () => {
    expect(codesOf(validateManualResult({ ...ok, reportedAt: undefined }, NOW))).toEqual({ reportedAt: "required" });
    for (const bad of ["2027-01-05 11:30", "2027-01-05T11:30:00", "2027-01-05T11:30+09:00", "2027-02-30T10:00", "x", 12345]) {
      expect(codesOf(validateManualResult({ ...ok, reportedAt: bad }, NOW)), String(bad)).toEqual({ reportedAt: "time_format" });
    }
    expect(codesOf(validateManualResult({ ...ok, reportedAt: "2027-01-05T12:01" }, NOW))).toEqual({ reportedAt: "in_future" });
    expect(validateManualResult({ ...ok, reportedAt: "2027-01-05T12:00" }, NOW).ok).toBe(true);
    expect(validateManualResult({ ...ok, reportedAt: "2026-12-31T23:59" }, NOW).ok).toBe(true);
  });

  it("番号・メモの長さ", () => {
    expect(codesOf(validateManualResult({ ...ok, dipsNumber: "x".repeat(51) }, NOW))).toEqual({ dipsNumber: "too_long" });
    expect(codesOf(validateManualResult({ ...ok, memo: "あ".repeat(501) }, NOW))).toEqual({ memo: "too_long" });
    expect(validateManualResult({ ...ok, memo: "あ".repeat(500) }, NOW).ok).toBe(true);
    expect(codesOf(validateManualResult({ ...ok, dipsNumber: "a\nb" }, NOW))).toEqual({ dipsNumber: "invalid" });
  });

  it("本文がない・形が違うと誤り", () => {
    expect(codesOf(validateManualResult(undefined, NOW))).toEqual({ manual: "required" });
    expect(codesOf(validateManualResult([], NOW))).toEqual({ manual: "required" });
  });
});

describe("通報の画面の入力", () => {
  it("空は通る（すべて任意）", () => {
    expect(validateReportInputs(undefined)).toEqual({ ok: true, data: {} });
    expect(validateReportInputs({})).toEqual({ ok: true, data: {} });
  });

  it("値域：補助者 0 以上、航続可能時間は 5 分単位 5〜1440、速度 1〜999、フラグは 1／0、飛行目的 1〜16", () => {
    const bad = (o: Record<string, unknown>) => {
      const r = validateReportInputs(o);
      return r.ok ? {} : r.codes;
    };
    expect(bad({ assistantsNumber: -1 })).toEqual({ assistantsNumber: "range" });
    expect(bad({ assistantsNumber: 1.5 })).toEqual({ assistantsNumber: "invalid" });
    expect(bad({ plannedMaxTime: 4 })).toEqual({ plannedMaxTime: "range" });
    expect(bad({ plannedMaxTime: 1445 })).toEqual({ plannedMaxTime: "range" });
    expect(bad({ plannedMaxTime: 33 })).toEqual({ plannedMaxTime: "step" });
    expect(bad({ flightSpeed: 0 })).toEqual({ flightSpeed: "range" });
    expect(bad({ flightSpeed: 1000 })).toEqual({ flightSpeed: "range" });
    expect(bad({ onsiteControlL3: "2" })).toEqual({ onsiteControlL3: "invalid" });
    expect(bad({ mooring: true })).toEqual({ mooring: "invalid" });
    expect(bad({ flightPurposes: [0] })).toEqual({ flightPurposes: "range" });
    expect(bad({ flightPurposes: [17] })).toEqual({ flightPurposes: "range" });
    expect(bad({ flightPurposes: "1" })).toEqual({ flightPurposes: "invalid" });
    const good = validateReportInputs({ assistantsNumber: "2", plannedMaxTime: 1440, flightSpeed: 999, onsiteControlL3: "1", mooring: "0", flightPurposes: [4, 1, 4] });
    expect(good).toEqual({
      ok: true,
      data: { assistantsNumber: 2, plannedMaxTime: 1440, flightSpeed: 999, onsiteControlL3: "1", mooring: "0", flightPurposes: [1, 4] },
    });
  });

  it("通報用の名称は 30 文字以内（コードポイント）", () => {
    const r = validateReportInputs({ reportName: "あ".repeat(31) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toEqual({ reportName: "name_too_long" });
    expect(validateReportInputs({ reportName: "あ".repeat(30) }).ok).toBe(true);
    expect(validateReportInputs({ reportName: "😀".repeat(30) }).ok).toBe(true);
    expect(charCount("😀".repeat(30))).toBe(30);
  });

  it("その他（13・16）を選んで理由を空にすると誤り。未指定（undefined）の間は通す", () => {
    const r = validateReportInputs({ flightPurposes: [13], otherBusinessText: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toEqual({ otherBusinessText: "required" });
    expect(validateReportInputs({ flightPurposes: [13] }).ok).toBe(true);
    expect(validateReportInputs({ flightPurposes: [13], otherBusinessText: "調査" }).ok).toBe(true);
  });

  it("未知のキーは読まない。null は消去として通す", () => {
    const r = validateReportInputs({ evil: "x", flightSpeed: null, departurePoint: "  米子港 " });
    expect(r).toEqual({ ok: true, data: { flightSpeed: null, departurePoint: "米子港" } });
  });

  it("オブジェクト以外は誤り", () => {
    expect(validateReportInputs("x").ok).toBe(false);
    expect(validateReportInputs([]).ok).toBe(false);
  });
});

describe("時刻・理由の補助", () => {
  it("JST 分の往復", () => {
    const d = parseJstMinuteString("2027-01-05T12:00");
    expect(d?.toISOString()).toBe("2027-01-05T03:00:00.000Z");
    expect(toJstMinuteString(d!)).toBe("2027-01-05T12:00");
    expect(parseJstMinuteString("2027-13-01T00:00")).toBeNull();
  });
  it("理由は必須で 500 文字まで", () => {
    expect(validateReason("").ok).toBe(false);
    expect(validateReason(undefined).ok).toBe(false);
    expect(validateReason("a".repeat(501)).ok).toBe(false);
    expect(validateReason(" 打ち間違い ")).toEqual({ ok: true, data: "打ち間違い" });
  });
});
