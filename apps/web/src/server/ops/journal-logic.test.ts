// Sprint 12c 契約 5：journalMismatches の全組合せ（計画の時間帯の分数・要否・通報の有無と離陸の前後・計画なし）。
import type { ReportRowLite } from "@soraban/dips";
import { describe, expect, it } from "vitest";
import { journalMismatches, type JournalMismatchInput } from "./journal-logic";

const jst = (s: string): Date => new Date(`${s}:00+09:00`);
const START = jst("2027-01-05T13:00");
const plan = (requirementKind: string, durationMinutes = 60) => ({ plannedStartAt: START, durationMinutes, requirementKind });

let n = 0;
const report = (
  reportedAt: string | null,
  over: Partial<ReportRowLite> = {},
): ReportRowLite => {
  n += 1;
  return {
    id: `r${n}`,
    kind: "new",
    status: "reported_manual",
    channel: "manual",
    createdAt: `2027-01-04T00:00:00.${String(n).padStart(6, "0")}Z`,
    updatedAt: `2027-01-04T00:00:00.${String(n).padStart(6, "0")}Z`,
    fingerprint: "fp",
    reportedAt,
    dipsNumber: "123",
    numberUnavailable: false,
    ...over,
  };
};

const run = (over: Partial<JournalMismatchInput> & Pick<JournalMismatchInput, "takeoffAt" | "landingAt">) =>
  journalMismatches({ plan: plan("required"), reports: [], ...over });
const codes = (r: ReturnType<typeof run>) => r.map((x) => x.code);

describe("journalMismatches：計画の時間帯", () => {
  const rep = [report("2027-01-04T10:00")];
  it("時間帯の中なら食い違いなし。境界（予定開始ちょうど・予定終了ちょうど）も中", () => {
    expect(run({ takeoffAt: jst("2027-01-05T13:00"), landingAt: jst("2027-01-05T14:00"), reports: rep })).toEqual([]);
    expect(run({ takeoffAt: jst("2027-01-05T13:10"), landingAt: jst("2027-01-05T13:50"), reports: rep })).toEqual([]);
  });
  it("離陸が早い：早い分数を出す", () => {
    const r = run({ takeoffAt: jst("2027-01-05T12:48"), landingAt: jst("2027-01-05T13:30"), reports: rep });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: "outside_plan_window", earlyMinutes: 12, lateMinutes: 0 });
    expect(r[0]!.label).toBe("計画の時間帯の外で飛行しています（離陸が 12 分早い）。");
  });
  it("着陸が遅い：遅い分数を出す", () => {
    const r = run({ takeoffAt: jst("2027-01-05T13:10"), landingAt: jst("2027-01-05T14:08"), reports: rep });
    expect(r[0]).toMatchObject({ code: "outside_plan_window", earlyMinutes: 0, lateMinutes: 8 });
    expect(r[0]!.label).toBe("計画の時間帯の外で飛行しています（着陸が 8 分遅い）。");
  });
  it("離陸が早く着陸も遅い：両方を「／」でつなぐ", () => {
    const r = run({ takeoffAt: jst("2027-01-05T12:48"), landingAt: jst("2027-01-05T14:08"), reports: rep });
    expect(r[0]!.label).toBe("計画の時間帯の外で飛行しています（離陸が 12 分早い／着陸が 8 分遅い）。");
    expect(r[0]).toMatchObject({ earlyMinutes: 12, lateMinutes: 8 });
  });
  it("1 分の食い違いも出す", () => {
    expect(codes(run({ takeoffAt: jst("2027-01-05T12:59"), landingAt: jst("2027-01-05T13:30"), reports: rep }))).toEqual(["outside_plan_window"]);
    expect(codes(run({ takeoffAt: jst("2027-01-05T13:00"), landingAt: jst("2027-01-05T14:01"), reports: rep }))).toEqual(["outside_plan_window"]);
  });
});

describe("journalMismatches：通報の記録", () => {
  const flight = { takeoffAt: jst("2027-01-05T13:10"), landingAt: jst("2027-01-05T13:40") };
  it("要・要確認で通報の記録がなければ report_missing", () => {
    for (const k of ["required", "confirm"]) {
      const r = run({ ...flight, plan: plan(k), reports: [] });
      expect(codes(r)).toEqual(["report_missing"]);
      expect(r[0]!.label).toBe("特定飛行ですが、離陸の時点で DIPS の通報の記録がありません。");
    }
  });
  it("離陸より前の有効な通報があれば食い違いなし。離陸と同じ分も有効", () => {
    expect(run({ ...flight, reports: [report("2027-01-05T09:00")] })).toEqual([]);
    expect(run({ ...flight, reports: [report("2027-01-05T13:10")] })).toEqual([]);
  });
  it("通報の記録が離陸より後：事前の通報として数えない（report_missing と report_after_takeoff）", () => {
    const r = run({ ...flight, reports: [report("2027-01-05T13:11")] });
    expect(codes(r)).toEqual(["report_missing", "report_after_takeoff"]);
    expect(r[1]!.label).toBe("通報の記録が離陸より後です。事前の通報として数えません。");
  });
  it("離陸より前の通報があり、変更通報が離陸より後なら食い違いなし", () => {
    const first = report("2027-01-05T09:00");
    const change = report("2027-01-05T14:00", { kind: "change" });
    expect(run({ ...flight, reports: [first, change] })).toEqual([]);
  });
  it("完了していない通報（送信中・失敗・取り下げ）は有効と数えない", () => {
    for (const status of ["prepared", "failed", "unknown", "retracted"] as const) {
      expect(codes(run({ ...flight, reports: [report("2027-01-05T09:00", { status })] }))).toEqual(["report_missing"]);
    }
  });
  it("離陸より前に通報したが、離陸の前に取り消した（完了した取消）なら report_missing", () => {
    const first = report("2027-01-05T09:00");
    const cancel = report("2027-01-05T10:00", { kind: "cancel" });
    expect(codes(run({ ...flight, reports: [first, cancel] }))).toEqual(["report_missing"]);
    // 取消が離陸より後なら、離陸の時点では有効だった
    const late = report("2027-01-05T15:00", { kind: "cancel" });
    expect(run({ ...flight, reports: [first, late] })).toEqual([]);
  });
  it("推奨・対象外（模型航空機）には通報の食い違いを出さない", () => {
    for (const k of ["recommended", "not_applicable_model"]) {
      expect(run({ ...flight, plan: plan(k), reports: [] })).toEqual([]);
      expect(run({ ...flight, plan: plan(k), reports: [report("2027-01-05T14:00")] })).toEqual([]);
    }
  });
  it("推奨でも、時間帯の外は出す", () => {
    expect(codes(run({ takeoffAt: jst("2027-01-05T12:00"), landingAt: jst("2027-01-05T12:30"), plan: plan("recommended") }))).toEqual(["outside_plan_window"]);
  });
  it("時間帯の外と通報なしは同時に出る（順は時間帯、通報）", () => {
    expect(codes(run({ takeoffAt: jst("2027-01-05T12:00"), landingAt: jst("2027-01-05T12:30"), reports: [] }))).toEqual(["outside_plan_window", "report_missing"]);
  });
});

describe("journalMismatches：計画なし", () => {
  it("計画なしの記録は食い違いなし（判定の根拠が紐づいていません、は 12a のまま）", () => {
    expect(journalMismatches({ takeoffAt: jst("2027-01-05T03:00"), landingAt: jst("2027-01-05T04:00"), plan: null, reports: [] })).toEqual([]);
  });
});
