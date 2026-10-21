// Sprint 12b 契約 2：項目の対応表（report-fields.json）。
import { describe, expect, it } from "vitest";
import {
  displayFields,
  FIELD_SOURCES,
  groupsNeedingConfirmation,
  REPORT_FIELDS,
  sortedFields,
  type ReportFieldsData,
} from "./fields";
import { FPR_CODES, FPR_ROWS } from "./fpr-guideline.fixture";
import { prepareReport } from "./prepare";
import { basePlan } from "./test-fixtures";

describe("項目の対応表（データ）", () => {
  it("revision・verifiedAt・出典がある", () => {
    expect(REPORT_FIELDS.revision).toBeGreaterThanOrEqual(1);
    expect(REPORT_FIELDS.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(REPORT_FIELDS.source.title).toContain("1.10 版");
    expect(REPORT_FIELDS.source.pages).toContain("p46");
    expect(REPORT_FIELDS.source.note).toContain("docs/references/dips-fpr-guideline-findings.md");
  });

  it("FPR 1.10 版 p46〜52 の項番 1〜88 と過不足なく対応する（項番・パラメータ名・型・必須）", () => {
    expect(REPORT_FIELDS.fields.map((f) => f.apiNo).sort((a, b) => a - b)).toEqual(FPR_ROWS.map((r) => r[0]));
    for (const [no, field, type, required] of FPR_ROWS) {
      const f = REPORT_FIELDS.fields.find((x) => x.apiNo === no);
      expect(f, `項番 ${no}`).toBeDefined();
      expect(f!.apiField, `項番 ${no} のパラメータ名`).toBe(field);
      expect(f!.apiType, `項番 ${no} の型`).toBe(type);
      expect(f!.apiRequired, `項番 ${no} の必須`).toBe(required);
      expect(f!.apiStatus).toBe("guideline_1_10");
    }
  });

  it("key が一意で、order が 1 から連続し、group が groups にあり、source が決められた値", () => {
    const keys = REPORT_FIELDS.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(sortedFields().map((f) => f.order)).toEqual(REPORT_FIELDS.fields.map((_, i) => i + 1));
    const groupIds = new Set(REPORT_FIELDS.groups.map((g) => g.id));
    for (const f of REPORT_FIELDS.fields) {
      expect(groupIds.has(f.group), f.key).toBe(true);
      expect(FIELD_SOURCES).toContain(f.source);
    }
  });

  it("値域：名称 30 文字、所要時間・航続可能時間は 5 分単位 5〜1440、速度・高度 1〜999", () => {
    const byField = (name: string) => REPORT_FIELDS.fields.find((f) => f.apiField === name && f.apiNo < 20)!;
    expect(byField("name").range).toEqual({ maxChars: 30 });
    expect(byField("plannedFlightTime").range).toEqual({ min: 5, max: 1440, step: 5 });
    expect(byField("plannedMaxTime").range).toEqual({ min: 5, max: 1440, step: 5 });
    expect(byField("flightSpeed").range).toEqual({ min: 1, max: 999, integer: true });
    expect(byField("flightAltitude").range).toEqual({ min: 1, max: 999, integer: true });
  });

  it("コード表：飛行目的 1〜16、飛行空域 1〜3、飛行方法 1〜6、機体の種類 1〜6", () => {
    const codes = (apiNo: number) => REPORT_FIELDS.fields.find((f) => f.apiNo === apiNo)!.codes;
    expect(codes(4)).toEqual(Object.fromEntries(Object.entries(FPR_CODES.flightPurpose)));
    expect(Object.keys(codes(7)!)).toEqual(Object.keys(FPR_CODES.flightAirspace));
    expect(Object.keys(codes(8)!)).toEqual(Object.keys(FPR_CODES.flightType));
    expect(Object.keys(codes(66)!)).toEqual(Object.keys(FPR_CODES.aircraftType));
    expect(Object.keys(codes(4)!)).toHaveLength(16);
  });

  it("個人情報（personal）の行は、技能証明書番号と氏名（操縦者）だけ", () => {
    const personal = REPORT_FIELDS.fields.filter((f) => f.personal);
    expect(personal.map((f) => f.apiNo).sort((a, b) => a - b)).toEqual([52, 59]);
    expect(REPORT_FIELDS.fields.find((f) => f.apiNo === 59)!.apiField).toBe("skillCertificationNumber");
  });

  it("コピー対象でない行：経路と api_only", () => {
    expect(REPORT_FIELDS.fields.find((f) => f.key === "route")!.copyable).toBe(false);
    for (const f of REPORT_FIELDS.fields.filter((x) => x.source === "api_only")) expect(f.copyable, f.key).toBe(false);
  });

  it("画面の入力順・項目名・通報要領との対応は未確認（null）。番号の扱いはデータで持つ", () => {
    for (const f of REPORT_FIELDS.fields) {
      expect(f.dipsScreenLabel).toBeNull();
      expect(f.requirementRef).toBeNull();
      expect(f.screenStatus).toBe("unconfirmed");
    }
    expect(REPORT_FIELDS.numberPolicy).toBe("number_or_declared_unavailable");
  });
});

describe("「※要確認」はデータから出る", () => {
  const confirmAll = (data: ReportFieldsData): ReportFieldsData => ({
    ...data,
    fields: data.fields.map((f) => ({ ...f, screenStatus: "confirmed" as const })),
  });

  it("unconfirmed の行を含むまとまりに出て、confirmed にすると消える", () => {
    const before = groupsNeedingConfirmation();
    // 画面に出る行を持つまとまりはすべて対象
    const groupsWithRows = new Set(displayFields().map((f) => f.group));
    expect([...before].sort()).toEqual([...groupsWithRows].sort());
    expect(groupsNeedingConfirmation(confirmAll(REPORT_FIELDS)).size).toBe(0);

    // 1 つのまとまりの行だけ confirmed にすると、そのまとまりだけ消える
    const pilotConfirmed: ReportFieldsData = {
      ...REPORT_FIELDS,
      fields: REPORT_FIELDS.fields.map((f) => (f.group === "pilot" ? { ...f, screenStatus: "confirmed" as const } : f)),
    };
    const after = groupsNeedingConfirmation(pilotConfirmed);
    expect(after.has("pilot")).toBe(false);
    expect(after.has("flight")).toBe(true);
    // 一部の行だけ confirmed なら、まとまりには残る
    const one: ReportFieldsData = {
      ...REPORT_FIELDS,
      fields: REPORT_FIELDS.fields.map((f) => (f.key === "pilot_name" ? { ...f, screenStatus: "confirmed" as const } : f)),
    };
    expect(groupsNeedingConfirmation(one).has("pilot")).toBe(true);
  });

  it("prepare の結果の groups.needsConfirmation が同じデータから決まる", () => {
    const unconfirmed = prepareReport(basePlan(), "new");
    expect(unconfirmed.groups.every((g) => g.needsConfirmation)).toBe(true);
    const confirmed = prepareReport(basePlan(), "new", confirmAll(REPORT_FIELDS));
    expect(confirmed.groups.every((g) => !g.needsConfirmation)).toBe(true);
  });
});
