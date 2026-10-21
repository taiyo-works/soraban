// Sprint 12d 契約 5（単体）：許可・承認の登録の照合（matchPlanPermits。規則 R1〜R9）、番号の分割と正規化、有効性。
// 時計・DB・ネットワークに触れない純粋関数。境界（有効期間の開始日・最終日、日またぎ、失効日の前日・当日、円の包含の境界、
// 未入力、高度・重量のちょうど境界）と、安全の性質（grantedValues は DIPS の 8 種だけ。airport は判定に使う値を生まない）を確かめる。
import { offsetMeters } from "@soraban/geo";
import { DIPS_PERMIT_KINDS, dipsPermitValue } from "@soraban/regulations";
import { describe, expect, it } from "vitest";
import {
  addDays,
  checkRegistration,
  EMPTY_PERMIT_MATCH,
  effectiveLastDate,
  flightWindow,
  matchPlanPermits,
  normalizePermitNumber,
  PERMIT_KIND_LABEL,
  PERMIT_REASON_LABEL,
  permitValidity,
  relevantDipsKinds,
  splitPermitNumbers,
  summarizePermitMatch,
  type PermitReason,
  type PermitRegistration,
  type PlanPermitInput,
} from "./permit-logic";

const HERE = { lat: 35.434238, lng: 133.380508 };
const AIRCRAFT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AIRCRAFT2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const PILOT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PILOT2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";

const PLAN: PlanPermitInput = {
  startAt: "2027-01-14T10:00",
  durationMinutes: 60,
  lat: HERE.lat,
  lng: HERE.lng,
  radiusM: 100,
  maxAltitudeM: 100,
  flags: [],
  accessControl: true,
  observer: true,
  aircraftId: AIRCRAFT,
  aircraftWeightG: 900,
  pilotId: PILOT,
  permitNumbers: "P-001",
};

const REG: PermitRegistration = {
  id: "11111111-1111-4111-8111-111111111111",
  versionNo: 1,
  versionHash: "a".repeat(64),
  permitNumber: "P-001",
  permitNumberKey: "P-001",
  coverage: "blanket",
  kinds: ["did"],
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

const reg = (over: Partial<PermitRegistration> = {}): PermitRegistration => ({ ...REG, ...over });
const plan = (over: Partial<PlanPermitInput> = {}): PlanPermitInput => ({ ...PLAN, ...over });
const reasonsOf = (r: PermitRegistration, p: PlanPermitInput = PLAN): PermitReason[] =>
  checkRegistration(r, p, flightWindow(p.startAt, p.durationMinutes));
const only = (r: PermitRegistration, p: PlanPermitInput = PLAN) => matchPlanPermits(p, [r]).numbers[0]!;

describe("番号の正規化と分割", () => {
  it("normalizePermitNumber：NFKC・空白をすべて除く・英字を大文字に", () => {
    expect(normalizePermitNumber("ａｂｃ－１２３")).toBe("ABC-123");
    expect(normalizePermitNumber(" abc 123 ")).toBe("ABC123");
    expect(normalizePermitNumber("abc　123")).toBe("ABC123");
    expect(normalizePermitNumber("Ｒ８－ＤＩＰＳ")).toBe("R8-DIPS");
    expect(normalizePermitNumber("\t\n")).toBe("");
    expect(normalizePermitNumber("許可 第１号")).toBe("許可第1号");
  });

  it("splitPermitNumbers：区切り（, ， 、 ; ； 改行）で分け、空の項を捨て、鍵の重複は最初だけ残す", () => {
    expect(splitPermitNumbers("A-1, B-2，C-3、D-4;E-5；F-6\nG-7\r\nH-8").map((t) => t.key)).toEqual(["A-1", "B-2", "C-3", "D-4", "E-5", "F-6", "G-7", "H-8"]);
    expect(splitPermitNumbers("a-1, A-1 ,ａ－１")).toEqual([{ text: "a-1", key: "A-1" }]);
    expect(splitPermitNumbers(",, ;; \n")).toEqual([]);
    expect(splitPermitNumbers("")).toEqual([]);
    expect(splitPermitNumbers(null)).toEqual([]);
    expect(splitPermitNumbers("  X 1  ")).toEqual([{ text: "X 1", key: "X1" }]);
  });
});

describe("飛行の窓と日付", () => {
  it("窓：開始 = 予定開始、最終分 = 予定開始 + (所要時間 − 1) 分。日またぎは最終日が翌日", () => {
    expect(flightWindow("2027-01-14T10:00", 60)).toEqual({ from: "2027-01-14", to: "2027-01-14" });
    expect(flightWindow("2027-01-14T23:00", 60)).toEqual({ from: "2027-01-14", to: "2027-01-14" });
    expect(flightWindow("2027-01-14T23:00", 61)).toEqual({ from: "2027-01-14", to: "2027-01-15" });
    expect(flightWindow("2027-01-14T23:59", 2)).toEqual({ from: "2027-01-14", to: "2027-01-15" });
    expect(flightWindow("2027-12-31T23:30", 1440)).toEqual({ from: "2027-12-31", to: "2028-01-01" });
    expect(flightWindow("2027-01-14T00:00", 1440)).toEqual({ from: "2027-01-14", to: "2027-01-14" });
    expect(flightWindow("bad", 60)).toBeNull();
    expect(flightWindow("2027-01-14T10:00", 0)).toBeNull();
  });

  it("addDays・有効な最終日 = min(valid_to, revoked_on の前日)", () => {
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(effectiveLastDate({ validTo: "2027-09-30", revokedOn: null })).toBe("2027-09-30");
    expect(effectiveLastDate({ validTo: "2027-09-30", revokedOn: "2027-01-10" })).toBe("2027-01-09");
    expect(effectiveLastDate({ validTo: "2027-01-05", revokedOn: "2027-01-10" })).toBe("2027-01-05");
    expect(effectiveLastDate({ validTo: "2027-01-05", revokedOn: "2027-01-06" })).toBe("2027-01-05");
    expect(effectiveLastDate({ validTo: "2027-01-05", revokedOn: "2027-01-05" })).toBe("2027-01-04");
  });
});

describe("R1 取消", () => {
  it("取消した登録は未登録として扱う（理由 voided）。取消でない同じ番号の登録があればそちらを使う", () => {
    const n = only(reg({ voided: true }));
    expect(n.status).toBe("unregistered");
    expect(n.reasons).toEqual(["voided"]);
    expect(n.registration).toBeNull();
    const both = matchPlanPermits(PLAN, [reg({ voided: true, id: "9".repeat(8) + "-9999-4999-8999-999999999999" }), reg()]);
    expect(both.numbers[0]!.status).toBe("applied");
    expect(both.numbers[0]!.registration!.id).toBe(REG.id);
    expect(both.grantedValues).toEqual(["mlit:did"]);
  });
});

describe("R2 期間（開始日・最終日の両方が収まる）", () => {
  it("有効期間の開始日・最終日のちょうどは収まる。前日・翌日は収まらない", () => {
    const r = reg({ validFrom: "2027-01-14", validTo: "2027-01-14" });
    expect(reasonsOf(r)).toEqual([]);
    expect(reasonsOf(r, plan({ startAt: "2027-01-13T23:00", durationMinutes: 30 }))).toEqual(["not_started"]);
    expect(reasonsOf(r, plan({ startAt: "2027-01-15T00:00", durationMinutes: 30 }))).toEqual(["expired"]);
  });

  it("日またぎの飛行：最終日が期間の終わりの翌日なら収まらない（expired）", () => {
    const r = reg({ validFrom: "2027-01-01", validTo: "2027-01-14" });
    expect(reasonsOf(r, plan({ startAt: "2027-01-14T23:00", durationMinutes: 60 }))).toEqual([]);
    expect(reasonsOf(r, plan({ startAt: "2027-01-14T23:00", durationMinutes: 61 }))).toEqual(["expired"]);
    const early = reg({ validFrom: "2027-01-15", validTo: "2027-12-31" });
    expect(reasonsOf(early, plan({ startAt: "2027-01-14T23:30", durationMinutes: 60 }))).toEqual(["not_started"]);
  });

  it("失効日の前日までは有効、失効日当日は使えない（理由 revoked）。失効日が期間の満了より後なら expired", () => {
    const r = reg({ status: "revoked", revokedOn: "2027-01-14" });
    expect(reasonsOf(r, plan({ startAt: "2027-01-13T10:00" }))).toEqual([]);
    expect(reasonsOf(r, plan({ startAt: "2027-01-14T10:00" }))).toEqual(["revoked"]);
    expect(reasonsOf(r, plan({ startAt: "2027-01-13T23:30", durationMinutes: 60 }))).toEqual(["revoked"]);
    const late = reg({ status: "revoked", revokedOn: "2027-06-01", validTo: "2027-01-10" });
    expect(reasonsOf(late, plan({ startAt: "2027-01-14T10:00" }))).toEqual(["expired"]);
    // 失効した登録でも、失効日より前の飛行には適用できる
    expect(only(r, plan({ startAt: "2027-01-13T10:00" })).status).toBe("applied");
  });

  it("開始前と期限切れの両方を満たさないときは両方の理由を返す", () => {
    const r = reg({ validFrom: "2027-01-14", validTo: "2027-01-14" });
    expect(reasonsOf(r, plan({ startAt: "2027-01-13T23:00", durationMinutes: 1560 }))).toEqual(["not_started", "expired"]);
  });
});

describe("R3 場所", () => {
  it("全国は収まる。文章のみは照合できない（place_not_checkable）", () => {
    expect(reasonsOf(reg())).toEqual([]);
    expect(reasonsOf(reg({ placeScope: { type: "text", text: "県内" } }))).toEqual(["place_not_checkable"]);
    expect(only(reg({ placeScope: { type: "text", text: "" } })).status).toBe("not_applied");
  });

  it("円：計画の円が完全に含まれる。中心距離（整数に切り上げ）+ 計画の半径 ≤ 円の半径", () => {
    const circle = (radiusM: number, c = HERE) => reg({ placeScope: { type: "circles", circles: [{ ...c, radiusM }] } });
    // 距離 0：計画の半径 100 と円の半径 100 はちょうど境界で収まる。99 は収まらない
    expect(reasonsOf(circle(100))).toEqual([]);
    expect(reasonsOf(circle(99))).toEqual(["place_out_of_scope"]);
    // 中心が 500m ずれる（切り上げで 500 か 501）：半径 600 なら収まり、半径 100 の計画で 599 は収まらない
    const c500 = offsetMeters(HERE, 500, 0);
    const d = Math.ceil(Math.hypot(500, 0));
    expect(reasonsOf(circle(d + 100, c500))).toEqual([]);
    expect(reasonsOf(circle(d + 99, c500))).toEqual(["place_out_of_scope"]);
    // 円の外に完全に出ている
    expect(reasonsOf(circle(1000, offsetMeters(HERE, 5000, 0)))).toEqual(["place_out_of_scope"]);
  });

  it("円は複数のうちいずれか 1 つに完全に含まれればよい（複数の円にまたがる合算はしない）", () => {
    const r = reg({
      placeScope: {
        type: "circles",
        circles: [
          { ...offsetMeters(HERE, 3000, 0), radiusM: 500 },
          { ...HERE, radiusM: 150 },
        ],
      },
    });
    expect(reasonsOf(r)).toEqual([]);
    expect(reasonsOf(r, plan({ radiusM: 151 }))).toEqual(["place_out_of_scope"]);
  });

  it("計画の半径が未入力なら含まれるかを確かめられない（place_extent_unknown）", () => {
    const r = reg({ placeScope: { type: "circles", circles: [{ ...HERE, radiusM: 100000 }] } });
    expect(reasonsOf(r, plan({ radiusM: null }))).toEqual(["place_extent_unknown"]);
    expect(only(r, plan({ radiusM: null })).status).toBe("not_applied");
    // 全国は半径が未入力でも収まる
    expect(reasonsOf(reg(), plan({ radiusM: null }))).toEqual([]);
  });
});

describe("R4・R5 機体・操縦者", () => {
  it("any は収まる。listed は含まれるときだけ収まる", () => {
    expect(reasonsOf(reg({ aircraftScope: { type: "listed", ids: [AIRCRAFT, AIRCRAFT2] } }))).toEqual([]);
    expect(reasonsOf(reg({ aircraftScope: { type: "listed", ids: [AIRCRAFT2] } }))).toEqual(["aircraft_out_of_scope"]);
    expect(reasonsOf(reg({ pilotScope: { type: "listed", ids: [PILOT] } }))).toEqual([]);
    expect(reasonsOf(reg({ pilotScope: { type: "listed", ids: [PILOT2] } }))).toEqual(["pilot_out_of_scope"]);
  });
});

describe("R6 高度・R7 重量", () => {
  it("高度：条件以下は収まる（ちょうど境界を含む）。超過・未入力は収まらない", () => {
    const r = reg({ maxAltitudeM: 100 });
    expect(reasonsOf(r, plan({ maxAltitudeM: 100 }))).toEqual([]);
    expect(reasonsOf(r, plan({ maxAltitudeM: 99 }))).toEqual([]);
    expect(reasonsOf(r, plan({ maxAltitudeM: 101 }))).toEqual(["altitude_over_limit"]);
    expect(reasonsOf(r, plan({ maxAltitudeM: null }))).toEqual(["altitude_unknown"]);
    expect(reasonsOf(reg({ maxAltitudeM: 0 }), plan({ maxAltitudeM: 0 }))).toEqual([]);
    // 条件がなければ未入力でも収まる
    expect(reasonsOf(reg(), plan({ maxAltitudeM: null }))).toEqual([]);
  });

  it("重量：g に直して比べる。ちょうど境界は収まる。超過・不明は収まらない", () => {
    const r = reg({ maxWeightKg: 0.9 });
    expect(reasonsOf(r, plan({ aircraftWeightG: 900 }))).toEqual([]);
    expect(reasonsOf(r, plan({ aircraftWeightG: 901 }))).toEqual(["weight_over_limit"]);
    expect(reasonsOf(r, plan({ aircraftWeightG: null }))).toEqual(["weight_unknown"]);
    expect(reasonsOf(reg({ maxWeightKg: 25 }), plan({ aircraftWeightG: 25_000 }))).toEqual([]);
    expect(reasonsOf(reg({ maxWeightKg: 25 }), plan({ aircraftWeightG: 25_001 }))).toEqual(["weight_over_limit"]);
    expect(reasonsOf(reg({ maxWeightKg: 0.29 }), plan({ aircraftWeightG: 290 }))).toEqual([]);
    expect(reasonsOf(reg(), plan({ aircraftWeightG: null }))).toEqual([]);
  });
});

describe("R8 補助者・R9 立入管理措置", () => {
  it("補助者：登録の種類に bvlos を含み、計画が method_bvlos を選んでいるときだけ求める。「あり」でなければ収まらない", () => {
    const r = reg({ kinds: ["bvlos"], requiresObserver: true });
    const bvlos = plan({ flags: ["method_bvlos"] });
    expect(reasonsOf(r, { ...bvlos, observer: true })).toEqual([]);
    expect(reasonsOf(r, { ...bvlos, observer: false })).toEqual(["observer_required"]);
    expect(reasonsOf(r, { ...bvlos, observer: null })).toEqual(["observer_required"]);
    // method_bvlos を選んでいない計画・bvlos を含まない登録では求めない
    expect(reasonsOf(r, plan({ flags: [], observer: null }))).toEqual([]);
    expect(reasonsOf(reg({ kinds: ["night"], requiresObserver: true }), { ...bvlos, observer: null })).toEqual([]);
  });

  it("立入管理措置が条件のとき：「あり」でなければ（未選択・なしを含め）収まらない", () => {
    const r = reg({ requiresAccessControl: true });
    expect(reasonsOf(r, plan({ accessControl: true }))).toEqual([]);
    expect(reasonsOf(r, plan({ accessControl: false }))).toEqual(["access_control_required"]);
    expect(reasonsOf(r, plan({ accessControl: null }))).toEqual(["access_control_required"]);
    expect(reasonsOf(reg(), plan({ accessControl: null }))).toEqual([]);
  });

  it("満たさない規則はすべて返す（途中で止めない）", () => {
    const r = reg({
      validTo: "2026-12-31",
      placeScope: { type: "text", text: "x" },
      aircraftScope: { type: "listed", ids: [AIRCRAFT2] },
      pilotScope: { type: "listed", ids: [PILOT2] },
      maxAltitudeM: 10,
      maxWeightKg: 0.1,
      kinds: ["bvlos"],
      requiresObserver: true,
      requiresAccessControl: true,
    });
    expect(reasonsOf(r, plan({ flags: ["method_bvlos"], observer: false, accessControl: false }))).toEqual([
      "expired",
      "place_not_checkable",
      "aircraft_out_of_scope",
      "pilot_out_of_scope",
      "altitude_over_limit",
      "weight_over_limit",
      "observer_required",
      "access_control_required",
    ]);
  });
});

describe("関係する種類と状態", () => {
  it("did は常に関係する。フラグ・最大高度 150m 以上（airspace_150m）で種類が増える", () => {
    expect(relevantDipsKinds([])).toEqual(["did"]);
    expect(relevantDipsKinds(["method_night", "airspace_150m"])).toEqual(["did", "150m", "night"]);
    expect(relevantDipsKinds(["method_bvlos", "method_30m", "method_event", "method_dangerous", "method_drop"])).toEqual([
      "did",
      "bvlos",
      "30m",
      "event",
      "dangerous",
      "drop",
    ]);
    // 判定が導出する空域・緊急用務空域は種類を増やさない
    expect(relevantDipsKinds(["airspace_airport", "airspace_emergency", "airspace_did"])).toEqual(["did"]);
  });

  it("applied：範囲に収まり、関係する種類を含む。grantedValues は関係する DIPS の種類だけ", () => {
    const m = matchPlanPermits(plan({ flags: ["method_night"] }), [reg({ kinds: ["did", "night", "bvlos"] })]);
    expect(m.numbers[0]!.status).toBe("applied");
    expect(m.numbers[0]!.relevantKinds).toEqual(["did", "night"]);
    expect(m.grantedValues).toEqual(["mlit:did", "mlit:night"]);
  });

  it("not_relevant：範囲に収まるが、関係する種類を含まない（夜間だけの登録で、夜間でない計画）。何も足さない", () => {
    const m = matchPlanPermits(PLAN, [reg({ kinds: ["night"] })]);
    expect(m.numbers[0]!.status).toBe("not_relevant");
    expect(m.grantedValues).toEqual([]);
    expect(m.basis).toEqual([]);
  });

  it("reference：airport だけの登録は範囲に収まっても判定に使う値を生まない。根拠には applied: false で残る", () => {
    const airport = reg({
      coverage: "individual",
      kinds: ["airport"],
      airportNames: ["テスト空港"],
      placeScope: { type: "circles", circles: [{ ...HERE, radiusM: 3000 }] },
    });
    const m = matchPlanPermits(plan({ flags: ["airspace_150m", "method_night"] }), [airport]);
    expect(m.numbers[0]!.status).toBe("reference");
    expect(m.numbers[0]!.relevantKinds).toEqual(["airport"]);
    expect(m.grantedValues).toEqual([]);
    expect(m.basis).toHaveLength(1);
    expect(m.basis[0]).toMatchObject({ applied: false, kinds: ["airport"], permitNumber: "P-001", coverage: "individual" });
    // 範囲外の空港の登録は適用しない（参考にもならない）
    const far = reg({ ...airport, placeScope: { type: "circles", circles: [{ ...offsetMeters(HERE, 9000, 0), radiusM: 1000 }] } });
    expect(only(far).status).toBe("not_applied");
  });

  it("DIPS と airport の両方を含む登録：DIPS の種類は適用し、airport は値を生まない", () => {
    const both = reg({
      coverage: "individual",
      kinds: ["did", "airport"],
      airportNames: ["A"],
      placeScope: { type: "circles", circles: [{ ...HERE, radiusM: 3000 }] },
    });
    const m = matchPlanPermits(PLAN, [both]);
    expect(m.numbers[0]!.status).toBe("applied");
    expect(m.grantedValues).toEqual(["mlit:did"]);
    expect(m.basis[0]).toMatchObject({ applied: true, kinds: ["did", "airport"] });
  });

  it("unregistered：登録にない番号。判定に使わない", () => {
    const m = matchPlanPermits(plan({ permitNumbers: "NOPE-9" }), [reg()]);
    expect(m.numbers).toHaveLength(1);
    expect(m.numbers[0]).toMatchObject({ status: "unregistered", reasons: [], registration: null });
    expect(m.grantedValues).toEqual([]);
  });

  it("not_applied は何も足さない。許可番号がない・計画の予定開始が読めない計画は何も適用しない", () => {
    expect(matchPlanPermits(plan({ permitNumbers: null }), [reg()])).toMatchObject({ numbers: [], grantedValues: [], basis: [] });
    const bad = matchPlanPermits(plan({ startAt: "garbage" }), [reg()]);
    expect(bad.window).toBeNull();
    expect(bad.numbers[0]!.status).toBe("not_applied");
    expect(bad.grantedValues).toEqual([]);
    expect(bad.candidates).toEqual([]);
  });
});

describe("番号の結びつき・根拠の順序・候補", () => {
  const regs = [
    reg({ id: "1".repeat(8) + "-1111-4111-8111-111111111111", permitNumber: "B-2", permitNumberKey: "B-2", validTo: "2027-06-30", kinds: ["did"] }),
    reg({ id: "2".repeat(8) + "-2222-4222-8222-222222222222", permitNumber: "A-1", permitNumberKey: "A-1", validTo: "2027-09-30", kinds: ["did"] }),
    reg({ id: "3".repeat(8) + "-3333-4333-8333-333333333333", permitNumber: "C-3", permitNumberKey: "C-3", validTo: "2027-06-30", kinds: ["night"] }),
    reg({ id: "4".repeat(8) + "-4444-4444-8444-444444444444", permitNumber: "D-4", permitNumberKey: "D-4", validTo: "2027-09-30", kinds: ["did"], voided: true }),
  ];

  it("全角・小文字・空白の違いで結びつく。欄の順に numbers を返す。根拠は有効な最終日の遅い順、同じなら番号の昇順", () => {
    const m = matchPlanPermits(plan({ permitNumbers: "ｂ－２ ,  a-1，C-3, X-9" }), regs);
    expect(m.numbers.map((n) => [n.numberKey, n.status])).toEqual([
      ["B-2", "applied"],
      ["A-1", "applied"],
      ["C-3", "not_relevant"],
      ["X-9", "unregistered"],
    ]);
    expect(m.basis.map((b) => b.permitNumber)).toEqual(["A-1", "B-2"]);
    expect(m.basis[0]).toMatchObject({ registrationId: regs[1]!.id, versionNo: 1, versionHash: "a".repeat(64), validFrom: "2026-10-01", validTo: "2027-09-30", window: { from: "2027-01-14", to: "2027-01-14" } });
  });

  it("候補：番号が欄にない登録のうち、applied と同じ判定になるもの（取消・関係なし・範囲外は出さない）。判定には使わない", () => {
    const m = matchPlanPermits(plan({ permitNumbers: "B-2" }), regs);
    expect(m.candidates.map((c) => c.registration.permitNumber)).toEqual(["A-1"]);
    expect(m.grantedValues).toEqual(["mlit:did"]);
    expect(m.basis.map((b) => b.permitNumber)).toEqual(["B-2"]);
    // 夜間の計画なら夜間の登録も候補になる
    const night = matchPlanPermits(plan({ permitNumbers: "", flags: ["method_night"] }), regs);
    expect(night.candidates.map((c) => c.registration.permitNumber)).toEqual(["A-1", "B-2", "C-3"]);
    expect(night.grantedValues).toEqual([]);
  });

  it("決定的：同じ入力から同じ出力（登録の並びに依らない）", () => {
    const p = plan({ permitNumbers: "A-1, B-2, C-3" });
    const a = JSON.stringify(matchPlanPermits(p, regs));
    const b = JSON.stringify(matchPlanPermits(p, [...regs].reverse()));
    expect(a).toBe(b);
    expect(JSON.stringify(matchPlanPermits(p, regs))).toBe(a);
  });
});

describe("安全の性質：grantedValues は DIPS の 8 種の mlit:<種類> だけ", () => {
  it("あらゆる種類・フラグの組み合わせで、同意・通報・公園・文化庁の値や airport を含まない", () => {
    const allKinds = [...DIPS_PERMIT_KINDS, "airport"] as const;
    const everything = reg({
      coverage: "individual",
      kinds: [...allKinds],
      airportNames: ["A"],
      placeScope: { type: "circles", circles: [{ ...HERE, radiusM: 5000 }] },
    });
    const allFlags = ["airspace_150m", "method_night", "method_bvlos", "method_30m", "method_event", "method_dangerous", "method_drop", "airspace_emergency", "airspace_airport"];
    const m = matchPlanPermits(plan({ flags: allFlags }), [everything]);
    const valid = new Set(DIPS_PERMIT_KINDS.map(dipsPermitValue));
    expect(m.grantedValues.length).toBeGreaterThan(0);
    for (const v of m.grantedValues) expect(valid.has(v), v).toBe(true);
    expect(m.grantedValues).toEqual([...m.grantedValues].sort());
    for (const bad of ["facility_manager", "pref_pubsafety_notice", "park_manager", "bunkacho_or_kyoiku", "mlit", "mlit:airport", "airport"]) {
      expect(m.grantedValues).not.toContain(bad);
    }
  });

  it("確認できないものは、範囲内の他の条件がそろっていても適用しない（半径・高度・重量の未入力、文章のみ、未登録）", () => {
    const cases: [PermitRegistration, Partial<PlanPermitInput>][] = [
      [reg({ placeScope: { type: "circles", circles: [{ ...HERE, radiusM: 50000 }] } }), { radiusM: null }],
      [reg({ maxAltitudeM: 150 }), { maxAltitudeM: null }],
      [reg({ maxWeightKg: 25 }), { aircraftWeightG: null }],
      [reg({ placeScope: { type: "text", text: "県内" } }), {}],
      [reg({ voided: true }), {}],
      [reg({ permitNumberKey: "OTHER" }), {}],
      [reg({ validTo: "2026-12-31" }), {}],
      [reg({ validFrom: "2027-02-01" }), {}],
      [reg({ status: "revoked", revokedOn: "2027-01-14" }), {}],
    ];
    for (const [r, over] of cases) {
      const m = matchPlanPermits(plan(over), [r]);
      expect(m.grantedValues, JSON.stringify(r)).toEqual([]);
      expect(m.basis, JSON.stringify(r)).toEqual([]);
    }
  });
});

describe("登録の有効性（一覧用。今日の日付で求める）", () => {
  const base = { validFrom: "2027-01-10", validTo: "2027-03-31", status: "active" as const, voided: false };
  it("開始前・有効・期限間近（満了まで 30 日以内）・期限切れ・失効・取消", () => {
    expect(permitValidity(base, "2027-01-09")).toBe("upcoming");
    expect(permitValidity(base, "2027-01-10")).toBe("valid");
    expect(permitValidity(base, "2027-02-28")).toBe("valid"); // 満了まで 31 日
    expect(permitValidity(base, "2027-02-27")).toBe("valid"); // 32 日
    expect(permitValidity(base, "2027-03-01")).toBe("expiring"); // 30 日
    expect(permitValidity(base, "2027-03-31")).toBe("expiring"); // 当日（満了日は有効）
    expect(permitValidity(base, "2027-04-01")).toBe("expired");
    expect(permitValidity({ ...base, status: "revoked" }, "2027-02-01")).toBe("revoked");
    expect(permitValidity({ ...base, voided: true, status: "revoked" }, "2027-02-01")).toBe("voided");
  });
});

describe("文言の定数と要約", () => {
  it("理由コードごとの文があり、禁止語・飛べると読める語を含まない", () => {
    const re = /通報不要|通報は不要|通報の必要はありません|通報しなくて|飛べる|許可済みで飛行可能|飛行可能/;
    for (const text of [...Object.values(PERMIT_REASON_LABEL), ...Object.values(PERMIT_KIND_LABEL)]) expect(text).not.toMatch(re);
    expect(Object.keys(PERMIT_REASON_LABEL)).toHaveLength(15);
  });

  it("summarizePermitMatch：番号ごとの状態・理由・登録の版。適用した登録に条件の文章を添える", () => {
    const m = matchPlanPermits(plan({ permitNumbers: "P-001, Z-9" }), [reg({ conditionsText: "飛行マニュアルに従う" })]);
    const s = summarizePermitMatch(m);
    expect(s.appliedCount).toBe(1);
    expect(s.unregisteredCount).toBe(1);
    expect(s.grantedValues).toEqual(["mlit:did"]);
    expect(s.numbers[0]).toMatchObject({ status: "applied", versionNo: 1, conditionsText: "飛行マニュアルに従う", validTo: "2027-09-30" });
    expect(s.numbers[0]!.scopeNotes.length).toBe(1); // 機体・操縦者を限定しない旨
    expect(s.note).toContain("許可書で確認してください");
    expect(summarizePermitMatch(EMPTY_PERMIT_MATCH)).toMatchObject({ numbers: [], appliedCount: 0 });
  });
});
