// Sprint 12a 契約 9・11（単体）：buildJudgementInput・snapshotFreshness・confirmationState・staleSources。
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, PROCEDURES_REVISION } from "@soraban/regulations";
import {
  EMPTY_PERMIT_APPLICATION,
  isDipsPermitValue,
  type PermitApplication,
  type PermitBasisEntry,
} from "./permit-logic";
import {
  buildJudgementInput,
  canonicalJson,
  permitPartEquals,
  confirmationState,
  currentFreshnessContext,
  FLAG_TO_SPECIFIC_FLIGHT_TYPE,
  specificFlightTypesFromFlags,
  PLAN_STATE_LABEL,
  PLAN_STATES,
  planJudgementChanged,
  snapshotFreshness,
  staleSources,
  toDiagnosisRunInput,
  weightGramsFromKg,
  type ConfirmationLite,
  type PlanJudgementFields,
  type PlanState,
  type SnapshotFreshnessInput,
} from "./plan-logic";

const PLAN: PlanJudgementFields = {
  latitude: 35.434238,
  longitude: 133.380508,
  plannedDate: "2027-01-14",
  maxAltitudeM: null,
  flags: [],
  pilotPermits: [],
  judgementPurpose: null,
  accessControl: null,
  thirdPartyOverflight: null,
  bvlosWithObserver: null,
};

describe("buildJudgementInput（設計 A2）", () => {
  it("座標は小数 6 桁、機体の最大離陸重量（kg）× 1000 の整数、重量未登録は null", () => {
    expect(buildJudgementInput(PLAN, { maxTakeoffWeightKg: 0.9 }).droneWeightG).toBe(900);
    expect(buildJudgementInput(PLAN, { maxTakeoffWeightKg: 25 }).droneWeightG).toBe(25_000);
    expect(buildJudgementInput(PLAN, { maxTakeoffWeightKg: 0.1 }).droneWeightG).toBe(100);
    expect(buildJudgementInput(PLAN, { maxTakeoffWeightKg: 1.3 }).droneWeightG).toBe(1300);
    expect(buildJudgementInput(PLAN, { maxTakeoffWeightKg: null }).droneWeightG).toBeNull();
    const i = buildJudgementInput({ ...PLAN, latitude: 35.1234567891, longitude: 133.1 }, { maxTakeoffWeightKg: 1 });
    expect(i.lat).toBe(35.123457);
    expect(i.lng).toBe(133.1);
    expect(weightGramsFromKg(-1)).toBeNull();
  });

  it("フラグ：最大高度が 150m 以上なら airspace_150m を足し、重複を除き、固定の順に並べる。DID・空港は含めない", () => {
    const flags = ["method_drop", "airspace_did", "method_night", "airspace_airport", "method_night", "airspace_emergency"];
    const i = buildJudgementInput({ ...PLAN, flags, maxAltitudeM: 150 }, { maxTakeoffWeightKg: 1 });
    expect(i.flags).toEqual(["airspace_150m", "airspace_emergency", "method_night", "method_drop"]);
    expect(buildJudgementInput({ ...PLAN, flags: ["airspace_150m"], maxAltitudeM: 200 }, { maxTakeoffWeightKg: 1 }).flags).toEqual([
      "airspace_150m",
    ]);
    expect(buildJudgementInput({ ...PLAN, maxAltitudeM: 149 }, { maxTakeoffWeightKg: 1 }).flags).toEqual([]);
    expect(buildJudgementInput({ ...PLAN, maxAltitudeM: 0 }, { maxTakeoffWeightKg: 1 }).flags).toEqual([]);
  });

  it("許可は並べ替え済み・重複なし。目的・立入管理・第三者上空・補助者は指定があるときだけ入る", () => {
    const i = buildJudgementInput(
      { ...PLAN, pilotPermits: ["park_manager", "facility_manager", "park_manager"], judgementPurpose: "emergency", accessControl: false, thirdPartyOverflight: true, bvlosWithObserver: true },
      { maxTakeoffWeightKg: 1 },
    );
    expect(i.pilotPermits).toEqual(["facility_manager", "park_manager"]);
    expect(i).toMatchObject({ purpose: "emergency", accessControl: false, thirdPartyOverflight: true, bvlosWithObserver: true });
    const j = buildJudgementInput(PLAN, { maxTakeoffWeightKg: 1 });
    expect(Object.keys(j)).toEqual(["lat", "lng", "droneWeightG", "flags", "plannedDate", "pilotPermits"]);
  });

  it("同じ計画・機体からは常に同じ入力（キーの順に依らず比較できる）", () => {
    const a = buildJudgementInput({ ...PLAN, flags: ["method_night"] }, { maxTakeoffWeightKg: 0.9 });
    const b = buildJudgementInput({ ...PLAN, flags: ["method_night"] }, { maxTakeoffWeightKg: 0.9 });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });

  it("runDiagnosis の入力：重量 null・許可なしは渡さない。DID 非該当の自己申告は常に false", () => {
    const r = toDiagnosisRunInput(buildJudgementInput(PLAN, { maxTakeoffWeightKg: null }));
    expect(r).toEqual({ lat: 35.434238, lng: 133.380508, flags: [], plannedDate: "2027-01-14", didConfirmedNotApplicable: false });
    const w = toDiagnosisRunInput(
      buildJudgementInput({ ...PLAN, pilotPermits: ["park_manager"], judgementPurpose: "public_duty", accessControl: true }, { maxTakeoffWeightKg: 0.9 }),
    );
    expect(w).toMatchObject({ droneWeightG: 900, pilotPermits: ["park_manager"], purpose: "public_duty", accessControl: true });
  });
});

describe("planJudgementChanged（設計 A4）", () => {
  const base = {
    title: "A",
    planned_start_at: "2027-01-14T09:00",
    latitude: 35.434238,
    longitude: 133.380508,
    flags: ["method_night"],
    max_altitude_m: 100,
    pilot_permits: [],
    judgement_purpose: null,
    access_control: null,
    third_party_overflight: null,
    bvlos_with_observer: null,
    notes: null,
  };
  it("判定に関わる項目を変えると true", () => {
    for (const patch of [
      { latitude: 35.43 },
      { longitude: 133.38 },
      { planned_start_at: "2027-01-15T09:00" },
      { flags: ["method_night", "method_bvlos"] },
      { max_altitude_m: 120 },
      { pilot_permits: ["mlit:night"] },
      { judgement_purpose: "emergency" },
      { access_control: true },
      { third_party_overflight: false },
      { bvlos_with_observer: true },
    ]) {
      expect(planJudgementChanged(base, { ...base, ...patch }), JSON.stringify(patch)).toBe(true);
    }
  });
  it("判定に関わらない項目（計画名、予定の時刻、メモ、許可番号、目的の自由記述）を変えても false", () => {
    for (const patch of [
      { title: "B" },
      { planned_start_at: "2027-01-14T18:30" },
      { notes: "メモ" },
      { permit_numbers: "AB-1" },
      { purpose: "別の目的" },
      { place_name: "別の名称" },
      { duration_minutes: 90 },
      { pilot_id: "x" },
    ]) {
      expect(planJudgementChanged(base, { ...base, ...patch }), JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("snapshotFreshness（契約 9）", () => {
  const input = buildJudgementInput(PLAN, { maxTakeoffWeightKg: 0.9 });
  const now: SnapshotFreshnessInput["now"] = {
    engineVersion: "e1",
    datasetVerifiedAt: (id) => ({ "did-r2": "2026-10-18", "airports-seed": "2026-05-14" })[id],
    proceduresRevision: 3,
    proceduresVerifiedAt: "2026-10-19",
  };
  const snapshot = {
    input,
    engineVersion: "e1",
    datasets: [
      { id: "did-r2", verifiedAt: "2026-10-18" },
      { id: "airports-seed", verifiedAt: "2026-05-14" },
    ],
    proceduresRevision: 3,
    proceduresVerifiedAt: "2026-10-19",
  };
  const run = (over: Partial<SnapshotFreshnessInput> = {}) =>
    snapshotFreshness({ snapshot, plan: PLAN, aircraft: { maxTakeoffWeightKg: 0.9 }, now, ...over });

  it("入力・エンジンの版・データセットの確認日・手続きデータの版がすべて一致すれば新しい", () => {
    expect(run()).toEqual({ stale: false, reasons: [] });
  });
  it("機体の最大離陸重量の変更は input_changed（未登録への変更も）", () => {
    expect(run({ aircraft: { maxTakeoffWeightKg: 1.2 } })).toEqual({ stale: true, reasons: ["input_changed"] });
    expect(run({ aircraft: { maxTakeoffWeightKg: null } }).reasons).toEqual(["input_changed"]);
  });
  it("計画の入力の変更（場所・日付・フラグ）は input_changed", () => {
    expect(run({ plan: { ...PLAN, latitude: 35.5 } }).reasons).toEqual(["input_changed"]);
    expect(run({ plan: { ...PLAN, plannedDate: "2027-01-15" } }).reasons).toEqual(["input_changed"]);
    expect(run({ plan: { ...PLAN, flags: ["method_night"] } }).reasons).toEqual(["input_changed"]);
    expect(run({ plan: { ...PLAN, maxAltitudeM: 150 } }).reasons).toEqual(["input_changed"]);
  });
  it("エンジンの版の違いは engine_changed", () => {
    expect(run({ now: { ...now, engineVersion: "e2" } }).reasons).toEqual(["engine_changed"]);
  });
  it("データセットの確認日の違い（台帳にないものも）は data_changed", () => {
    expect(run({ now: { ...now, datasetVerifiedAt: (id) => (id === "did-r2" ? "2026-11-01" : "2026-05-14") } }).reasons).toEqual(["data_changed"]);
    expect(run({ now: { ...now, datasetVerifiedAt: (id) => (id === "did-r2" ? null : "2026-05-14") } }).reasons).toEqual(["data_changed"]);
  });
  it("手続きデータの版の違いは procedures_changed（確認日だけの違いも）", () => {
    expect(run({ now: { ...now, proceduresRevision: 4 } }).reasons).toEqual(["procedures_changed"]);
    expect(run({ now: { ...now, proceduresVerifiedAt: "2026-12-01" } }).reasons).toEqual(["procedures_changed"]);
    expect(run({ now: { ...now, proceduresVerifiedAt: undefined } }).stale).toBe(false);
  });
  it("複数の違いはすべて返す（固定の順）", () => {
    const r = run({
      aircraft: { maxTakeoffWeightKg: 2 },
      now: { ...now, engineVersion: "e2", proceduresRevision: 9, datasetVerifiedAt: () => "x" },
    });
    expect(r.reasons).toEqual(["input_changed", "engine_changed", "data_changed", "procedures_changed"]);
  });
  it("保存された入力は JSON を通っても一致する（キーの順・undefined に依らない）", () => {
    const stored = JSON.parse(JSON.stringify(input)) as unknown;
    expect(run({ snapshot: { ...snapshot, input: stored } }).stale).toBe(false);
  });
  it("現在の値（本番の既定）：現在のエンジンの版・手続きデータの版を返し、未知のデータセットは null", () => {
    const c = currentFreshnessContext();
    expect(c.engineVersion).toBe(ENGINE_VERSION);
    expect(c.proceduresRevision).toBe(PROCEDURES_REVISION);
    expect(c.datasetVerifiedAt("did-r2")).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(c.datasetVerifiedAt("unknown-dataset")).toBeNull();
  });
});

describe("confirmationState（契約 11）", () => {
  const at = (n: number): string => new Date(Date.UTC(2027, 0, 5, 0, n)).toISOString();
  const conf = (decision: "approved" | "returned", planVersion: number, n: number, self = false): ConfirmationLite => ({
    decision,
    planVersion,
    selfConfirmation: self,
    createdAt: at(n),
  });
  const plan = (status: "draft" | "active", version: number, voided = false) => ({ status, version, voided });

  const cases: readonly { name: string; plan: ReturnType<typeof plan>; list: ConfirmationLite[]; state: PlanState }[] = [
    { name: "下書き", plan: plan("draft", 1), list: [], state: "draft" },
    { name: "確認待ち", plan: plan("active", 2), list: [], state: "pending" },
    { name: "確認済み", plan: plan("active", 2), list: [conf("approved", 2, 1)], state: "approved" },
    { name: "前の版への確認（再確認が必要）", plan: plan("active", 3), list: [conf("approved", 2, 1)], state: "approved_stale" },
    { name: "差し戻し", plan: plan("active", 2), list: [conf("returned", 2, 1)], state: "returned" },
    { name: "修正済み（再確認待ち）", plan: plan("active", 3), list: [conf("returned", 2, 1)], state: "returned_stale" },
    { name: "中止（確認済みでも）", plan: plan("active", 4, true), list: [conf("approved", 4, 1)], state: "voided" },
    { name: "中止（下書きでも）", plan: plan("draft", 1, true), list: [], state: "voided" },
  ];
  for (const c of cases) {
    it(`${c.name} → ${c.state}`, () => {
      const r = confirmationState(c.plan, c.list);
      expect(r.state).toBe(c.state);
      expect(r.label).toBe(PLAN_STATE_LABEL[c.state]);
    });
  }

  it("7 つの状態をすべて網羅している", () => {
    expect(new Set(cases.map((c) => c.state))).toEqual(new Set(PLAN_STATES));
  });

  it("最新の確認で決まる：差し戻し → 修正 → 再確認で確認済み。確認 → 差し戻しで差し戻し", () => {
    expect(confirmationState(plan("active", 3), [conf("returned", 2, 1), conf("approved", 3, 2)]).state).toBe("approved");
    expect(confirmationState(plan("active", 2), [conf("approved", 2, 1), conf("returned", 2, 2)]).state).toBe("returned");
    // 順序が入れ替わって渡されても、作成時刻の新しいほうが最新
    expect(confirmationState(plan("active", 2), [conf("returned", 2, 2), conf("approved", 2, 1)]).state).toBe("returned");
  });

  it("確認済みで自己確認のときは「確認済み（自己確認）」と併記する。前の版への確認・差し戻しには併記しない", () => {
    const r = confirmationState(plan("active", 2), [conf("approved", 2, 1, true)]);
    expect(r.state).toBe("approved");
    expect(r.selfConfirmation).toBe(true);
    expect(r.label).toBe("確認済み（自己確認）");
    expect(confirmationState(plan("active", 3), [conf("approved", 2, 1, true)]).label).toBe("前の版への確認（再確認が必要）");
    expect(confirmationState(plan("active", 2), [conf("returned", 2, 1, true)]).label).toBe("差し戻し");
    expect(confirmationState(plan("active", 2), [conf("approved", 2, 1, false)]).label).toBe("確認済み");
  });

  it("訂正の後に「確認済み」とは出ない", () => {
    const r = confirmationState(plan("active", 3), [conf("approved", 2, 1)]);
    expect(r.label).not.toBe("確認済み");
    expect(r.label).not.toContain("確認済み（");
  });
});

describe("staleSources（出典・確認日が古い項目＝90 日超）", () => {
  const snap = {
    datasets: [
      { id: "a", name: "新しい", verifiedAt: "2026-10-19" },
      { id: "b", name: "古い", verifiedAt: "2026-04-30" },
      { id: "c", name: "ちょうど 90 日", verifiedAt: "2026-07-23" },
    ],
    proceduresVerifiedAt: "2026-10-19",
  };
  it("90 日を超えたものだけを返す（90 日ちょうどは含めない）", () => {
    const r = staleSources(snap, new Date("2026-10-21T00:00:00Z"));
    expect(r.map((s) => s.id)).toEqual(["b"]);
    expect(r[0]!.ageDays).toBe(174);
    expect(staleSources(snap, new Date("2026-10-21T00:00:00Z")).find((s) => s.id === "c")).toBeUndefined();
    expect(staleSources(snap, new Date("2026-10-22T00:00:00Z")).map((s) => s.id)).toEqual(["b", "c"]);
  });
  it("手続きデータの確認日も対象。確認日を読めないものは古い扱い", () => {
    expect(staleSources({ datasets: [], proceduresVerifiedAt: "2026-01-01" }, new Date("2026-10-21T00:00:00Z")).map((s) => s.id)).toEqual(["procedures"]);
    const r = staleSources({ datasets: [{ id: "x", name: "不明", verifiedAt: "?" }], proceduresVerifiedAt: "2026-10-19" }, new Date("2026-10-21T00:00:00Z"));
    expect(r).toEqual([{ id: "x", name: "不明", verifiedAt: "?", ageDays: null }]);
  });
});

describe("specificFlightTypesFromFlags（設計 G：飛行記録への引き継ぎ）", () => {
  it("設計 G の対応表どおりに写し、SPECIFIC_FLIGHT_TYPES の順に並べる", () => {
    expect(FLAG_TO_SPECIFIC_FLIGHT_TYPE).toEqual({
      airspace_airport: "airport_vicinity",
      airspace_150m: "above_150m",
      airspace_did: "did",
      airspace_emergency: "emergency_airspace",
      method_night: "night",
      method_bvlos: "bvlos",
      method_30m: "within_30m",
      method_event: "event",
      method_dangerous: "dangerous_goods",
      method_drop: "dropping",
    });
    expect(specificFlightTypesFromFlags(["method_drop", "airspace_did", "method_night", "airspace_airport", "airspace_150m"])).toEqual([
      "airport_vicinity",
      "above_150m",
      "did",
      "night",
      "dropping",
    ]);
    expect(specificFlightTypesFromFlags([])).toEqual([]);
    expect(specificFlightTypesFromFlags(["unknown", "airspace_did", "airspace_did"])).toEqual(["did"]);
  });
});

// ---- Sprint 12d：許可・承認の登録の照合の適用（設計 D） ---------------------------

const BASIS: PermitBasisEntry = {
  registrationId: "11111111-1111-4111-8111-111111111111",
  versionNo: 2,
  versionHash: "b".repeat(64),
  permitNumber: "P-001",
  coverage: "blanket",
  kinds: ["did", "night"],
  applied: true,
  validFrom: "2026-10-01",
  validTo: "2027-09-30",
  window: { from: "2027-01-14", to: "2027-01-14" },
};
const APPLIED: PermitApplication = { grantedValues: ["mlit:did", "mlit:night"], basis: [BASIS] };

describe("buildJudgementInput：登録の照合の適用（Sprint 12d 設計 D）", () => {
  it("手入力の DIPS の値（mlit・mlit:*）は判定に使わない。同意・通報・公園・文化庁は従来どおり", () => {
    const i = buildJudgementInput(
      { ...PLAN, pilotPermits: ["mlit", "mlit:did", "mlit:night", "park_manager", "facility_manager", "pref_pubsafety_notice", "bunkacho_or_kyoiku"] },
      { maxTakeoffWeightKg: 1 },
    );
    expect(i.pilotPermits).toEqual(["bunkacho_or_kyoiku", "facility_manager", "park_manager", "pref_pubsafety_notice"]);
    expect(isDipsPermitValue("mlit:150m")).toBe(true);
    expect(isDipsPermitValue("facility_manager")).toBe(false);
  });

  it("適用した DIPS の値だけが足される（並べ替え・重複なし）。適用した登録の根拠が permitBasis に入る", () => {
    const i = buildJudgementInput({ ...PLAN, pilotPermits: ["park_manager", "mlit:night"] }, { maxTakeoffWeightKg: 1 }, APPLIED);
    expect(i.pilotPermits).toEqual(["mlit:did", "mlit:night", "park_manager"]);
    expect(i.permitBasis).toEqual([BASIS]);
    const r = toDiagnosisRunInput(i);
    expect(r.pilotPermits).toEqual(["mlit:did", "mlit:night", "park_manager"]);
    // 判定の入力（runDiagnosis）には根拠を渡さない
    expect(Object.keys(r)).not.toContain("permitBasis");
  });

  it("適用がない（permitBasis が空・指定なし）入力は、12c までと canonical JSON で一致する（キーを足さない）", () => {
    const legacy = {
      lat: 35.434238,
      lng: 133.380508,
      droneWeightG: 900,
      flags: ["method_night"],
      plannedDate: "2027-01-14",
      pilotPermits: ["park_manager"],
      purpose: "emergency",
      accessControl: true,
    };
    const f = { ...PLAN, flags: ["method_night"], pilotPermits: ["park_manager"], judgementPurpose: "emergency", accessControl: true };
    const a = buildJudgementInput(f, { maxTakeoffWeightKg: 0.9 });
    const b = buildJudgementInput(f, { maxTakeoffWeightKg: 0.9 }, EMPTY_PERMIT_APPLICATION);
    expect(canonicalJson(a)).toBe(canonicalJson(legacy));
    expect(canonicalJson(b)).toBe(canonicalJson(legacy));
    expect("permitBasis" in a).toBe(false);
    // 根拠が空でも grantedValues だけがあるという状態は作らない（applied の登録は必ず根拠を持つ）。キーは basis が空でないときだけ
    expect("permitBasis" in buildJudgementInput(f, { maxTakeoffWeightKg: 0.9 }, { grantedValues: [], basis: [] })).toBe(false);
  });

  it("permitPartEquals：pilotPermits・permitBasis だけを比べる（保存時の新しいスナップショットの要否）", () => {
    const a = buildJudgementInput(PLAN, { maxTakeoffWeightKg: 1 }, APPLIED);
    expect(permitPartEquals(a, JSON.parse(JSON.stringify(a)))).toBe(true);
    expect(permitPartEquals(a, buildJudgementInput(PLAN, { maxTakeoffWeightKg: 5 }, APPLIED))).toBe(true);
    expect(permitPartEquals(a, buildJudgementInput(PLAN, { maxTakeoffWeightKg: 1 }))).toBe(false);
    expect(permitPartEquals(a, buildJudgementInput(PLAN, { maxTakeoffWeightKg: 1 }, { ...APPLIED, basis: [{ ...BASIS, versionNo: 3 }] }))).toBe(false);
    expect(permitPartEquals(buildJudgementInput(PLAN, { maxTakeoffWeightKg: 1 }), { lat: 1 })).toBe(true);
  });
});

describe("snapshotFreshness：permits_changed（Sprint 12d 契約 9）", () => {
  const now: SnapshotFreshnessInput["now"] = {
    engineVersion: "e1",
    datasetVerifiedAt: () => "2026-10-18",
    proceduresRevision: 3,
    proceduresVerifiedAt: "2026-10-19",
  };
  const mk = (permits: PermitApplication) => ({
    input: buildJudgementInput(PLAN, { maxTakeoffWeightKg: 0.9 }, permits),
    engineVersion: "e1",
    datasets: [{ id: "x", verifiedAt: "2026-10-18" }],
    proceduresRevision: 3,
    proceduresVerifiedAt: "2026-10-19",
  });
  const run = (snapshotPermits: PermitApplication, currentPermits: PermitApplication, plan: PlanJudgementFields = PLAN) =>
    snapshotFreshness({ snapshot: mk(snapshotPermits), plan, aircraft: { maxTakeoffWeightKg: 0.9 }, permits: currentPermits, now });

  it("登録の訂正・失効・新規・取消で照合の結果が変わるときだけ permits_changed。同じなら新しい", () => {
    expect(run(APPLIED, APPLIED)).toEqual({ stale: false, reasons: [] });
    expect(run(EMPTY_PERMIT_APPLICATION, EMPTY_PERMIT_APPLICATION)).toEqual({ stale: false, reasons: [] });
    // 登録の訂正（版が上がる）
    expect(run(APPLIED, { ...APPLIED, basis: [{ ...BASIS, versionNo: 3, versionHash: "c".repeat(64) }] })).toEqual({ stale: true, reasons: ["permits_changed"] });
    // 失効・取消で適用がなくなる／新規登録で適用が増える
    expect(run(APPLIED, EMPTY_PERMIT_APPLICATION).reasons).toEqual(["permits_changed"]);
    expect(run(EMPTY_PERMIT_APPLICATION, APPLIED).reasons).toEqual(["permits_changed"]);
    // 種類だけが変わる
    expect(run(APPLIED, { grantedValues: ["mlit:did"], basis: [{ ...BASIS, kinds: ["did"] }] }).reasons).toEqual(["permits_changed"]);
  });

  it("無関係な登録の変更では変わらない（適用に関わらない登録は入力に入らない）", () => {
    // 現在の照合の結果が変わらなければ（適用する登録が同じ版）、他の登録を何件変えても新しい
    expect(run(APPLIED, { grantedValues: [...APPLIED.grantedValues], basis: [{ ...BASIS }] }).stale).toBe(false);
  });

  it("入力の変更は従来どおり input_changed。入力と許可の両方が変わっても input_changed（permits_changed にしない）", () => {
    expect(run(APPLIED, APPLIED, { ...PLAN, latitude: 35.5 }).reasons).toEqual(["input_changed"]);
    expect(run(APPLIED, EMPTY_PERMIT_APPLICATION, { ...PLAN, latitude: 35.5 }).reasons).toEqual(["input_changed"]);
  });

  it("12c までの計画の DIPS の手入力値は、判定に使わなくなるため permits_changed になる", () => {
    const legacy = {
      input: buildJudgementInput({ ...PLAN, pilotPermits: [] }, { maxTakeoffWeightKg: 0.9 }),
      engineVersion: "e1",
      datasets: [],
      proceduresRevision: 3,
      proceduresVerifiedAt: "2026-10-19",
    };
    const legacyInput = { ...legacy.input, pilotPermits: ["mlit:night"] };
    const r = snapshotFreshness({ snapshot: { ...legacy, input: legacyInput }, plan: { ...PLAN, pilotPermits: ["mlit:night"] }, aircraft: { maxTakeoffWeightKg: 0.9 }, now });
    expect(r).toEqual({ stale: true, reasons: ["permits_changed"] });
  });
});
