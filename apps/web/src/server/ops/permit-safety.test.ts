// Sprint 12d 契約 6・10（単体）：許可の登録の安全の性質を、判定エンジンと組み合わせて網羅して確かめる。
//   (a) 登録がない・範囲外・期限切れ・失効・取消・未登録・確認できない場合は、許可なしの判定と同じ（要手続きのまま）
//   (b) 範囲内でも、元の判定が該当・該当の可能性・判定不能の項目は手続き不要にならない（最上位は手続き済み（条件付き））
//   (c) 空港の敷地内・緊急用務空域は飛行不可のまま
//   (d) 空港等周辺の項目は、個別許可が範囲内でも要手続きのまま
//   同値の確認：登録で適用した値の判定は、同じ値を手入力した判定画面の判定（/api/diagnose）と同一
// エンジン（packages/regulations/src）は変えない。入力は buildJudgementInput → toDiagnosisRunInput → runDiagnosis（計画の判定と同じ経路）。
import { type FlightContext, type FlightVerdict, type SpecificFlightFlag } from "@soraban/regulations";
import { describe, expect, it } from "vitest";
import { runRegulationCheckWith, type RegulationDataProvider } from "../check-core";
import { runDiagnosis } from "../diagnose-core";
import { handleDiagnosePost } from "../handlers";
import { BASELINE_LOCATIONS, BASELINE_NOW, baselineProvider } from "../sprint11e-baseline";
import { buildJudgementInput, toDiagnosisRunInput, type PlanJudgementFields } from "./plan-logic";
import {
  EMPTY_PERMIT_APPLICATION,
  matchPlanPermits,
  type PermitKind,
  type PermitRegistration,
  type PlanPermitInput,
} from "./permit-logic";

type Loc = { readonly lat: number; readonly lng: number };
type Point = { readonly name: string; readonly loc: Loc; readonly provider: RegulationDataProvider };

const YONAGO = BASELINE_LOCATIONS[0];
const POINTS: readonly Point[] = [
  ...BASELINE_LOCATIONS.map((l) => ({ name: l.name, loc: l.loc as Loc, provider: baselineProvider(l.muni) })),
  // DID の外（山間部）
  { name: "DID 外", loc: { lat: 35.25, lng: 133.45 }, provider: baselineProvider("31202") },
  // DID のデータが読めない（判定不能）
  {
    name: "判定不能の地点",
    loc: YONAGO.loc as Loc,
    provider: { ...baselineProvider("31202"), loadDid: async () => null, didPrefCodes: async () => [] },
  },
];

const FLAG_SETS: readonly (readonly SpecificFlightFlag[])[] = [
  [],
  ["airspace_150m"],
  ["method_night"],
  ["method_bvlos"],
  ["method_30m", "method_event"],
  ["method_dangerous", "method_drop"],
  ["airspace_150m", "method_night", "method_bvlos", "method_30m", "method_event", "method_dangerous", "method_drop"],
  ["airspace_emergency"],
  ["airspace_airport"],
  ["airspace_airport", "airspace_150m", "method_night"],
];

const WEIGHTS: readonly (number | null)[] = [900, 50, null];

const LEVEL_RANK = { no_fly: 3, needs_procedure: 2, procedure_done: 1, no_procedure: 0 } as const;
const ITEM_RANK = { ...LEVEL_RANK, unknown: 2 } as const;

const ALL_DIPS: PermitKind[] = ["did", "150m", "night", "bvlos", "30m", "event", "dangerous", "drop"];

const baseReg: PermitRegistration = {
  id: "11111111-1111-4111-8111-111111111111",
  versionNo: 1,
  versionHash: "a".repeat(64),
  permitNumber: "P-001",
  permitNumberKey: "P-001",
  coverage: "blanket",
  kinds: ALL_DIPS,
  airportNames: [],
  issuedOn: "2026-09-25",
  validFrom: "2026-10-01",
  validTo: "2027-09-30",
  status: "active",
  revokedOn: null,
  voided: false,
  placeScope: { type: "nationwide" },
  aircraftScope: { type: "any" },
  pilotScope: { type: "any" },
  maxAltitudeM: null,
  maxWeightKg: null,
  requiresObserver: false,
  requiresAccessControl: false,
  conditionsText: null,
};

/** 範囲に収まる登録（DIPS の全種類）と、収まらない・確認できない登録。 */
const IN_RANGE: PermitRegistration = baseReg;
const NOT_APPLIED: readonly { readonly name: string; readonly reg: PermitRegistration | null }[] = [
  { name: "登録なし（未登録）", reg: null },
  { name: "期限切れ", reg: { ...baseReg, validTo: "2026-12-31" } },
  { name: "開始前", reg: { ...baseReg, validFrom: "2027-02-01" } },
  { name: "失効", reg: { ...baseReg, status: "revoked", revokedOn: "2027-01-14" } },
  { name: "取消", reg: { ...baseReg, voided: true } },
  { name: "場所が文章のみ", reg: { ...baseReg, placeScope: { type: "text", text: "県内" } } },
  { name: "場所が範囲外の円", reg: { ...baseReg, placeScope: { type: "circles", circles: [{ lat: 43, lng: 141, radiusM: 1000 }] } } },
  { name: "別の機体の許可", reg: { ...baseReg, aircraftScope: { type: "listed", ids: ["99999999-9999-4999-8999-999999999999"] } } },
  { name: "別の操縦者の許可", reg: { ...baseReg, pilotScope: { type: "listed", ids: ["99999999-9999-4999-8999-999999999998"] } } },
];

const PLAN_FIELDS = (loc: Loc, flags: readonly SpecificFlightFlag[]): PlanJudgementFields => ({
  latitude: loc.lat,
  longitude: loc.lng,
  plannedDate: "2027-01-14",
  maxAltitudeM: null,
  flags,
  pilotPermits: [],
  judgementPurpose: null,
  accessControl: null,
  thirdPartyOverflight: null,
  bvlosWithObserver: null,
});

const planInput = (loc: Loc, flags: readonly SpecificFlightFlag[], weightG: number | null): PlanPermitInput => ({
  startAt: "2027-01-14T10:00",
  durationMinutes: 60,
  lat: loc.lat,
  lng: loc.lng,
  radiusM: 100,
  maxAltitudeM: null,
  flags,
  accessControl: null,
  observer: null,
  aircraftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  aircraftWeightG: weightG,
  pilotId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  permitNumbers: "P-001",
});

const judge = async (p: Point, flags: readonly SpecificFlightFlag[], weightG: number | null, reg: PermitRegistration | null) => {
  const m = matchPlanPermits(planInput(p.loc, flags, weightG), reg ? [reg] : []);
  const input = buildJudgementInput(PLAN_FIELDS(p.loc, flags), { maxTakeoffWeightKg: weightG === null ? null : weightG / 1000 }, m);
  const run = await runDiagnosis(
    toDiagnosisRunInput(input),
    (loc: Loc, ctx?: FlightContext) => runRegulationCheckWith(p.provider, loc, ctx, BASELINE_NOW),
    BASELINE_NOW,
  );
  return { match: m, input, response: run.response, verdict: run.response.verdict as FlightVerdict };
};

describe("契約 6：安全の性質（固定の地点 × フラグ × 重量 × 登録の状態）", () => {
  it("(a) 登録がない・範囲外・期限切れ・失効・取消・未登録・確認できない場合は、許可なしの判定と同じ。入力に許可も根拠も足さない", async () => {
    let n = 0;
    for (const p of POINTS) {
      for (const flags of FLAG_SETS) {
        for (const w of WEIGHTS) {
          const none = await judge(p, flags, w, null);
          for (const c of NOT_APPLIED) {
            const r = await judge(p, flags, w, c.reg);
            const label = `${p.name}|${flags.join("+") || "なし"}|${w}|${c.name}`;
            expect(r.match.grantedValues, label).toEqual([]);
            expect(r.input.pilotPermits, label).toEqual([]);
            expect("permitBasis" in r.input, label).toBe(false);
            expect(JSON.stringify(r.response), label).toBe(JSON.stringify(none.response));
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("(b) 範囲内でも、元の判定が該当・該当の可能性・判定不能の項目は手続き不要にならない。最上位は手続き済み（条件付き）まで。no_fly は変わらない", async () => {
    let appliedSomewhere = false;
    let procedureDone = 0;
    for (const p of POINTS) {
      for (const flags of FLAG_SETS) {
        for (const w of WEIGHTS) {
          const none = await judge(p, flags, w, null);
          const withPermit = await judge(p, flags, w, IN_RANGE);
          const label = `${p.name}|${flags.join("+") || "なし"}|${w}`;
          if (withPermit.match.grantedValues.length > 0) appliedSomewhere = true;
          // 全体：手続き不要になるのは、許可なしでも手続き不要のときだけ
          if (none.verdict.level !== "no_procedure") expect(withPermit.verdict.level, label).not.toBe("no_procedure");
          if (none.verdict.level === "no_fly") expect(withPermit.verdict.level, label).toBe("no_fly");
          if (withPermit.verdict.level === "procedure_done") procedureDone++;
          // 項目ごと
          expect(withPermit.verdict.items.map((i) => i.id), label).toEqual(none.verdict.items.map((i) => i.id));
          withPermit.verdict.items.forEach((it, idx) => {
            const before = none.verdict.items[idx]!;
            if (before.verdict !== "no_procedure") expect(it.verdict, `${label}|${it.id}`).not.toBe("no_procedure");
            if (before.verdict === "no_fly") expect(it.verdict, `${label}|${it.id}`).toBe("no_fly");
            if (before.verdict === "unknown") expect(it.verdict, `${label}|${it.id}`).not.toBe("no_procedure");
            // 許可で手続き済み（条件付き）になるのは、元が要手続きの項目だけ（該当しない項目を手続き済みにしない）
            if (it.verdict === "procedure_done") expect(before.verdict, `${label}|${it.id}`).toBe("needs_procedure");
            expect(ITEM_RANK[it.verdict], `${label}|${it.id}`).toBeGreaterThanOrEqual(Math.min(ITEM_RANK[before.verdict], 1));
          });
        }
      }
    }
    expect(appliedSomewhere).toBe(true);
    // 許可が効く組み合わせが実際にある（検査が空振りでない）。最上位は手続き済み（条件付き）まで
    expect(procedureDone).toBeGreaterThan(5);
  });

  it("(c) 空港の敷地内と緊急用務空域は、許可があっても飛行不可のまま", async () => {
    const onsite = POINTS.find((p) => p.name === "出雲縁結び空港の敷地内")!;
    for (const flags of FLAG_SETS) {
      for (const w of WEIGHTS) {
        const r = await judge(onsite, flags, w, IN_RANGE);
        expect(r.verdict.level, `${flags.join("+")}|${w}`).toBe("no_fly");
        const none = await judge(onsite, flags, w, null);
        expect(none.verdict.level).toBe("no_fly");
      }
    }
    for (const p of POINTS) {
      for (const w of WEIGHTS) {
        const r = await judge(p, ["airspace_emergency"], w, IN_RANGE);
        const none = await judge(p, ["airspace_emergency"], w, null);
        expect(none.verdict.level, `${p.name}|${w}`).toBe("no_fly");
        expect(r.verdict.level, `${p.name}|${w}`).toBe("no_fly");
        const em = r.verdict.items.find((i) => i.id === "airspace_emergency");
        expect(em?.verdict, `${p.name}|${w}`).toBe("no_fly");
      }
    }
  });

  it("(d) 空港等周辺の項目は、個別許可（airport）が範囲内でも要手続きのまま。DIPS の包括許可でも要手続きのまま", async () => {
    const airportReg: PermitRegistration = {
      ...baseReg,
      coverage: "individual",
      kinds: ["airport"],
      airportNames: ["出雲縁結び空港"],
      placeScope: { type: "circles", circles: [{ lat: 35.44, lng: 132.89, radiusM: 10_000 }] },
    };
    const near = POINTS.find((p) => p.name === "出雲縁結び空港の周辺")!;
    let checked = 0;
    for (const flags of FLAG_SETS) {
      for (const w of WEIGHTS) {
        for (const reg of [airportReg, IN_RANGE, { ...IN_RANGE, kinds: [...ALL_DIPS, "airport"] as PermitKind[], coverage: "individual" as const, airportNames: ["A"], placeScope: airportReg.placeScope }]) {
          const none = await judge(near, flags, w, null);
          const r = await judge(near, flags, w, reg);
          const airportItems = r.verdict.items.filter((i) => /airport/.test(i.id));
          for (const it of airportItems) {
            const before = none.verdict.items.find((x) => x.id === it.id)!;
            if (before.verdict === "needs_procedure") {
              expect(it.verdict, `${flags.join("+")}|${w}|${it.id}`).toBe("needs_procedure");
              checked++;
            }
          }
          // airport の登録は判定に使う値を生まない
          if (reg === airportReg) expect(r.match.grantedValues).toEqual([]);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("契約 10：同値の確認（登録で適用した値の判定 = 同じ値を手入力した判定画面の判定）", () => {
  it("runDiagnosis の応答が、/api/diagnose に同じ値を入力した応答と JSON で一致する（判定の時刻を固定）", async () => {
    let compared = 0;
    for (const p of POINTS) {
      for (const flags of FLAG_SETS) {
        for (const w of WEIGHTS) {
          const r = await judge(p, flags, w, IN_RANGE);
          const body = {
            lat: p.loc.lat,
            lng: p.loc.lng,
            flags: r.input.flags,
            plannedDate: "2027-01-14",
            ...(w !== null ? { droneWeightG: w } : {}),
            ...(r.input.pilotPermits.length > 0 ? { pilotPermits: r.input.pilotPermits } : {}),
          };
          const res = await handleDiagnosePost(
            new Request("http://x/api/diagnose", { method: "POST", body: JSON.stringify(body) }),
            (loc: Loc, ctx?: FlightContext) => runRegulationCheckWith(p.provider, loc, ctx, BASELINE_NOW),
          );
          const typed = await res.json();
          expect(typed, `${p.name}|${flags.join("+") || "なし"}|${w}`).toEqual(JSON.parse(JSON.stringify(r.response)));
          compared++;
        }
      }
    }
    expect(compared).toBe(POINTS.length * FLAG_SETS.length * WEIGHTS.length);
  });

  it("許可番号のない計画（適用なし）の判定の入力は、12c までと同じ（permitBasis のキーなし・pilotPermits は手入力の値だけ）", () => {
    const f = PLAN_FIELDS(YONAGO.loc as Loc, ["method_night"]);
    const a = buildJudgementInput(f, { maxTakeoffWeightKg: 0.9 });
    const b = buildJudgementInput(f, { maxTakeoffWeightKg: 0.9 }, EMPTY_PERMIT_APPLICATION);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a)).toEqual(["lat", "lng", "droneWeightG", "flags", "plannedDate", "pilotPermits"]);
  });
});
