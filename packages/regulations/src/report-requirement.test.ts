// Sprint 12a 契約 15（単体）：通報の要否。重量（なし・50g・100g・900g・25kg 以上）× category（6 種）× 目的の例外の全組合せ。
// Sprint 12b 契約 1：category が I のとき、判定不能の件数（なし・0・1・3）で「推奨」と「要確認（要として扱う）」に分かれる。
import { describe, expect, it } from "vitest";
import {
  PLAN_JUDGEMENT_DISCLAIMER,
  REPORT_FIXED_NOTE,
  REPORT_PURPOSE_EXCEPTION_NOTE,
  REPORT_REASON,
  REPORT_REQUIREMENT_LABEL,
  reportFlightReason,
  reportRequirement,
  reportRequirementText,
  reportUnknownCountReason,
  type ReportRequirementKind,
  type ReportRequirementSnapshot,
} from "./report-requirement";
import { SPECIFIC_FLIGHT_FLAG_LABEL, type DiagnosisCategory, type SpecificFlightFlag } from "./diagnosis";

/** どの出力の文言にも含めてはならない言葉（通報が要らないと読める言い回し）。 */
const REPORT_FORBIDDEN_PHRASES: readonly string[] = ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて"];
const containsForbiddenReportPhrase = (text: string): boolean => REPORT_FORBIDDEN_PHRASES.some((p) => text.includes(p));

const WEIGHTS: readonly (number | null)[] = [null, 50, 100, 900, 25_000, 30_000];
const CATEGORIES: readonly DiagnosisCategory[] = [
  "I",
  "needs_verification",
  "II_A",
  "II_B_eligible",
  "III_level4",
  "emergency_no_fly",
];
const PURPOSES: readonly (string | undefined)[] = [undefined, "emergency", "public_duty", "city_event"];
/** 判定不能の件数：なし（欠けている）・0・1・3（＋ null・数でない値）。 */
const UNKNOWN_COUNTS: readonly UnknownCount[] = ["missing", 0, 1, 3, "null", "nan"];
const ALL_FLAGS = Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[];

/** 判定不能の件数（12b）。"missing" は件数が欠けている（verdict に unknownCount がない）。 */
type UnknownCount = number | "missing" | "null" | "nan";

const verdictOf = (purpose: string | undefined, unknown: UnknownCount): Record<string, unknown> => ({
  ...(purpose ? { purpose } : {}),
  ...(unknown === "missing" ? {} : { unknownCount: unknown === "null" ? null : unknown === "nan" ? Number.NaN : unknown }),
});

const snap = (
  weight: number | null,
  category: DiagnosisCategory,
  flags: readonly SpecificFlightFlag[],
  purpose?: string,
  unknown: UnknownCount = 0,
): ReportRequirementSnapshot => ({
  input: { droneWeightG: weight, ...(purpose ? { purpose } : {}) },
  result: { ...(weight !== null ? { droneWeightG: weight } : {}), category, flags, verdict: verdictOf(purpose, unknown) },
});

const expectedKind = (weight: number | null, category: DiagnosisCategory, unknown: UnknownCount = 0): ReportRequirementKind =>
  weight === null
    ? "confirm"
    : weight < 100
      ? "not_applicable_model"
      : category !== "I"
        ? "required"
        : typeof unknown === "number" && unknown === 0
          ? "recommended"
          : "confirm";

describe("reportRequirement（全組合せ）", () => {
  for (const w of WEIGHTS) {
    for (const c of CATEGORIES) {
      for (const p of PURPOSES) {
        for (const u of UNKNOWN_COUNTS) {
        it(`重量 ${w ?? "なし"} × ${c} × 目的 ${p ?? "なし"} × 判定不能 ${u}`, () => {
          const flags: SpecificFlightFlag[] = c === "I" ? [] : ["method_night", "airspace_did"];
          const r = reportRequirement(snap(w, c, flags, p, u));
          expect(r.kind).toBe(expectedKind(w, c, u));
          expect(r.label).toBe(REPORT_REQUIREMENT_LABEL[r.kind]);
          expect(r.note).toBe(REPORT_FIXED_NOTE);
          // 目的の例外の添え書きは、要として扱う種類（要確認・要）で、緊急・公務のときだけ
          const wantsNote = (p === "emergency" || p === "public_duty") && (r.kind === "confirm" || r.kind === "required");
          expect(r.exceptionNote).toBe(wantsNote ? REPORT_PURPOSE_EXCEPTION_NOTE : null);
          // どの文言にも禁止語がない
          expect(containsForbiddenReportPhrase(reportRequirementText(r))).toBe(false);
        });
        }
      }
    }
  }

  it("重量なしは要確認（要として扱います）。根拠は「機体の重量が分からないため」", () => {
    const r = reportRequirement(snap(null, "I", []));
    expect(r.kind).toBe("confirm");
    expect(r.label).toBe("通報：要確認（要として扱います）");
    expect(r.reasons).toEqual([REPORT_REASON.weightUnknown]);
  });

  it("結果が成立していない（結果なし・区分なし・飛行の一覧なし）は要確認。重量があっても", () => {
    for (const s of [
      { input: { droneWeightG: 900 }, result: null },
      { input: { droneWeightG: 900 } },
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, flags: [] } },
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, category: "II_A" } },
      {},
    ] as ReportRequirementSnapshot[]) {
      expect(reportRequirement(s).kind).toBe("confirm");
    }
    expect(reportRequirement({ input: { droneWeightG: 900 }, result: null }).reasons).toEqual([REPORT_REASON.resultMissing]);
  });

  it("負の重量・数でない重量は不明として扱う（要確認）", () => {
    expect(reportRequirement(snap(-1, "II_A", ["method_night"])).kind).toBe("confirm");
    expect(reportRequirement(snap(Number.NaN, "II_A", ["method_night"])).kind).toBe("confirm");
  });

  it("境界：99.9g は対象外（模型航空機）、100g は要・推奨の判定へ", () => {
    expect(reportRequirement(snap(99.9, "II_A", ["method_night"])).kind).toBe("not_applicable_model");
    expect(reportRequirement(snap(100, "II_A", ["method_night"])).kind).toBe("required");
    expect(reportRequirement(snap(100, "I", [])).kind).toBe("recommended");
    expect(reportRequirement(snap(24_999, "I", [])).kind).toBe("recommended");
    expect(reportRequirement(snap(25_000, "I", [])).kind).toBe("recommended");
  });

  it("夜間飛行の計画は「通報：要」と「夜間飛行に当たるため」", () => {
    const r = reportRequirement(snap(900, "II_A", ["method_night"]));
    expect(r.label).toBe("通報：要");
    expect(r.reasons).toContain("夜間飛行に当たるため");
  });

  it("要の根拠に、当たった特定飛行をすべて並べる（定義の順）", () => {
    const flags: SpecificFlightFlag[] = ["method_drop", "airspace_did", "method_night", "airspace_150m"];
    const r = reportRequirement(snap(900, "II_A", flags));
    const expected = ALL_FLAGS.filter((f) => flags.includes(f)).map(reportFlightReason);
    expect(r.reasons).toEqual(expected);
    expect(r.reasons).toHaveLength(4);
  });

  it("全ての特定飛行のフラグを並べても、禁止語が出ない", () => {
    const r = reportRequirement(snap(900, "III_level4", ALL_FLAGS));
    expect(r.reasons).toHaveLength(ALL_FLAGS.length);
    expect(containsForbiddenReportPhrase(reportRequirementText(r))).toBe(false);
  });

  it("DID の該当を確認できない（needs_verification）は要。根拠は判定不能", () => {
    const r = reportRequirement(snap(900, "needs_verification", []));
    expect(r.kind).toBe("required");
    expect(r.reasons).toEqual([REPORT_REASON.needsVerification]);
    expect(r.reasons.join()).toContain("判定不能");
  });

  it("緊急用務空域（emergency_no_fly）は要。飛行できない判定を併記する", () => {
    const r = reportRequirement(snap(900, "emergency_no_fly", ["airspace_emergency"]));
    expect(r.kind).toBe("required");
    expect(r.reasons).toContain(REPORT_REASON.emergencyNoFly);
    expect(r.reasons).toContain("緊急用務空域に当たるため");
  });

  it("要でも根拠が空にならない（区分だけが特定飛行のとき）", () => {
    const r = reportRequirement(snap(900, "II_A", []));
    expect(r.kind).toBe("required");
    expect(r.reasons).toEqual([REPORT_REASON.specificFlightFallback]);
  });

  it("特定飛行に当たらない計画は「義務ではないが推奨」", () => {
    const r = reportRequirement(snap(900, "I", []));
    expect(r.label).toBe("通報：義務ではないが推奨");
    expect(r.reasons).toEqual([REPORT_REASON.noSpecificFlight]);
  });

  it("12b：category が I でも、判定不能が 1 件以上あれば「要確認（要として扱います）」。根拠に件数を示す", () => {
    for (const n of [1, 3, 10]) {
      const r = reportRequirement(snap(900, "I", [], undefined, n));
      expect(r.kind).toBe("confirm");
      expect(r.label).toBe("通報：要確認（要として扱います）");
      expect(r.reasons).toEqual([reportUnknownCountReason(n)]);
      expect(r.reasons[0]).toBe(`判定不能の項目が ${n} 件あるため、要として扱う`);
    }
  });

  it("12b：判定不能が 0 件なら従来どおり「義務ではないが推奨」", () => {
    const r = reportRequirement(snap(900, "I", [], undefined, 0));
    expect(r.kind).toBe("recommended");
    expect(r.label).toBe("通報：義務ではないが推奨");
    expect(r.reasons).toEqual([REPORT_REASON.noSpecificFlight]);
  });

  it("12b：件数が欠けているとき（verdict なし・unknownCount なし・null・数でない・負）は、0 とみなさず要確認に倒す", () => {
    for (const s of [
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, category: "I", flags: [] } },
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, category: "I", flags: [], verdict: null } },
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, category: "I", flags: [], verdict: {} } },
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, category: "I", flags: [], verdict: { unknownCount: null } } },
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, category: "I", flags: [], verdict: { unknownCount: Number.NaN } } },
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, category: "I", flags: [], verdict: { unknownCount: -1 } } },
      { input: { droneWeightG: 900 }, result: { droneWeightG: 900, category: "I", flags: [], verdict: { unknownCount: "0" as never } } },
    ] as ReportRequirementSnapshot[]) {
      const r = reportRequirement(s);
      expect(r.kind).toBe("confirm");
      expect(r.reasons).toEqual([REPORT_REASON.unknownCountMissing]);
    }
  });

  it("12b：重量が分からない・100g 未満・category が I 以外は、判定不能の件数に関係なく従来どおり", () => {
    expect(reportRequirement(snap(null, "I", [], undefined, 0)).kind).toBe("confirm");
    expect(reportRequirement(snap(50, "I", [], undefined, 3)).kind).toBe("not_applicable_model");
    expect(reportRequirement(snap(900, "II_A", ["method_night"], undefined, 3)).kind).toBe("required");
    expect(reportRequirement(snap(900, "needs_verification", [], undefined, 3)).reasons).toEqual([REPORT_REASON.needsVerification]);
  });

  it("12b：判定不能による要確認でも、目的の例外（緊急・公務）の添え書きは同じ扱い（表示は変えず、要として扱う）", () => {
    const r = reportRequirement(snap(900, "I", [], "emergency", 2));
    expect(r.kind).toBe("confirm");
    expect(r.exceptionNote).toBe(REPORT_PURPOSE_EXCEPTION_NOTE);
    expect(reportRequirement(snap(900, "I", [], "city_event", 2)).exceptionNote).toBeNull();
  });

  it("12b：固定の文言から「次の版で追加します」が消え、記録の案内になる", () => {
    expect(REPORT_FIXED_NOTE).not.toContain("次の版で追加します");
    expect(REPORT_FIXED_NOTE).toContain("日時と番号");
    expect(REPORT_FIXED_NOTE).toContain("記録");
    for (const k of ["confirm", "required", "recommended", "not_applicable_model"] as const) {
      expect(REPORT_REQUIREMENT_LABEL[k]).toBeTruthy();
    }
    expect(reportRequirementText(reportRequirement(snap(900, "I", [], undefined, 1)))).not.toContain("次の版で追加します");
  });

  it("100g 未満は対象外（模型航空機）。第134条の3 は別の手続きと添える", () => {
    const r = reportRequirement(snap(50, "I", []));
    expect(r.label).toBe("通報：DIPS の飛行計画の通報は対象外（模型航空機）");
    expect(r.reasons.join()).toContain("第134条の3");
  });

  it("目的の例外は input.purpose か result.verdict.purpose のどちらからでも読む。city_event は例外にしない", () => {
    const fromInput = reportRequirement({ input: { droneWeightG: 900, purpose: "emergency" }, result: { category: "II_A", flags: ["method_night"] } });
    expect(fromInput.exceptionNote).toBe(REPORT_PURPOSE_EXCEPTION_NOTE);
    const fromResult = reportRequirement({ input: { droneWeightG: 900 }, result: { category: "II_A", flags: ["method_night"], verdict: { purpose: "public_duty" } } });
    expect(fromResult.exceptionNote).toBe(REPORT_PURPOSE_EXCEPTION_NOTE);
    const city = reportRequirement(snap(900, "II_A", ["method_night"], "city_event"));
    expect(city.exceptionNote).toBeNull();
    // 例外があっても表示は変えない
    expect(fromInput.kind).toBe("required");
    expect(fromInput.label).toBe("通報：要");
  });

  it("結果の weight が入力の weight より優先される（結果にあれば結果を使う）", () => {
    const r = reportRequirement({ input: { droneWeightG: 50 }, result: { droneWeightG: 900, category: "II_A", flags: ["method_night"] } });
    expect(r.kind).toBe("required");
  });
});

describe("表示用の定数に禁止語がない", () => {
  it("定数の全文を検査する", () => {
    const texts = [
      ...Object.values(REPORT_REQUIREMENT_LABEL),
      ...Object.values(REPORT_REASON),
      REPORT_PURPOSE_EXCEPTION_NOTE,
      REPORT_FIXED_NOTE,
      PLAN_JUDGEMENT_DISCLAIMER,
      ...ALL_FLAGS.map(reportFlightReason),
    ];
    for (const t of texts) {
      for (const p of REPORT_FORBIDDEN_PHRASES) expect(t, `「${p}」を含む: ${t}`).not.toContain(p);
    }
  });

  it("禁止語の検査自体が働く（含む文字列を検出する）", () => {
    for (const p of REPORT_FORBIDDEN_PHRASES) expect(containsForbiddenReportPhrase(`これは${p}です`)).toBe(true);
    expect(containsForbiddenReportPhrase("通報：要")).toBe(false);
  });

  it("固定の文言は、DIPS に送信しないことと、公式の手続きで行うことを含む", () => {
    expect(REPORT_FIXED_NOTE).toContain("そらばんは DIPS に送信しません");
    expect(REPORT_FIXED_NOTE).toContain("申請・通報は DIPS 2.0 などの公式の手続きで行ってください");
    expect(PLAN_JUDGEMENT_DISCLAIMER).toBe("判定は入力された情報の範囲での目安です。申請・通報は DIPS 2.0 などの公式の手続きで行ってください。");
  });
});
