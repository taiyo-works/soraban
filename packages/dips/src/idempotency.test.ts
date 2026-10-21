// Sprint 12b 契約 3・6：冪等性キー、指紋の差分。
import { describe, expect, it } from "vitest";
import { computeFingerprint, computeIdempotencyKey, diffFingerprintParts, FINGERPRINT_VERSION, fingerprintPartsOf, normalizeFlags } from "./fingerprint";
import { sha256Hex } from "./sha256";
import { prepareReport } from "./prepare";
import { basePlan, ORG_ID, PLAN_ID } from "./test-fixtures";

const FP = prepareReport(basePlan(), "new").fingerprint;
const key = (over: Partial<Parameters<typeof computeIdempotencyKey>[0]> = {}) =>
  computeIdempotencyKey({ orgId: ORG_ID, planId: PLAN_ID, kind: "new", fingerprint: FP, basis: 0, ...over });

describe("冪等性キー", () => {
  it("同じ入力で一致する（画面の再読み込み・二度押しでも同じ）。64 桁の 16 進", () => {
    expect(key()).toBe(key());
    expect(key()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("組織・計画・種別・指紋・基準（世代／元の通報）で変わる", () => {
    const base = key();
    const others = [
      key({ orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      key({ planId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
      key({ kind: "change", basis: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
      key({ kind: "cancel", basis: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
      key({ fingerprint: prepareReport(basePlan({ durationMinutes: 90 }), "new").fingerprint }),
      key({ basis: 1 }),
    ];
    for (const o of others) expect(o).not.toBe(base);
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
  });

  it("完了した取消のあとの新規は世代が増えて別のキーになる", () => {
    expect(key({ basis: 0 })).not.toBe(key({ basis: 1 }));
    expect(key({ basis: 1 })).toBe(key({ basis: 1 }));
  });

  it("変更と取消は、元の通報の ID が違えば別のキー", () => {
    const a = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const b = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    expect(key({ kind: "change", basis: a })).not.toBe(key({ kind: "change", basis: b }));
    expect(key({ kind: "cancel", basis: a })).not.toBe(key({ kind: "change", basis: a }));
  });

  it("UUID の大文字・小文字に依らない", () => {
    expect(key({ planId: PLAN_ID.toUpperCase() })).toBe(key());
  });
});

describe("指紋の差分（変更点の表示）", () => {
  const a = prepareReport(basePlan(), "new").fingerprintParts;
  it("変わった項目だけを、項目名つきで返す（例：予定開始 14:00 → 15:00）", () => {
    const b = prepareReport(basePlan({ startAt: "2027-01-14T10:00", radiusM: null }), "new").fingerprintParts;
    const d = diffFingerprintParts(a, b);
    expect(d.map((x) => x.key)).toEqual(["startAt", "radiusM"]);
    expect(d[0]).toEqual({ key: "startAt", label: "予定開始", before: "2027-01-14 09:00", after: "2027-01-14 10:00" });
    expect(d[1]).toMatchObject({ label: "範囲の半径", before: "100 m", after: "未入力" });
  });

  it("フラグの表示名を差し込める。変わらなければ空", () => {
    const b = prepareReport(basePlan({ snapshot: { ...basePlan().snapshot, flags: ["method_night", "airspace_did"] } }), "new").fingerprintParts;
    const d = diffFingerprintParts(a, b, { flagLabel: (f) => `<${f}>` });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ key: "flags", before: "<method_night>", after: "<airspace_did>・<method_night>" });
    expect(diffFingerprintParts(a, a)).toEqual([]);
  });

  it("操縦者の変更は ID を見せない", () => {
    const b = prepareReport(basePlan({ pilotId: "88888888-8888-4888-8888-888888888888" }), "new").fingerprintParts;
    const d = diffFingerprintParts(a, b);
    expect(d).toEqual([{ key: "pilotId", label: "操縦者", before: "（変更前の操縦者）", after: "（変更後の操縦者）" }]);
  });

  it("normalizeFlags は固定の順で重複を除く", () => {
    expect(normalizeFlags(["method_drop", "airspace_emergency", "x_unknown", "method_drop", "airspace_did"])).toEqual([
      "airspace_emergency",
      "airspace_did",
      "method_drop",
      "x_unknown",
    ]);
  });
});

describe("指紋と許可・承認の登録（Sprint 12d の指摘）", () => {
  const reg = { registrationId: "11111111-1111-4111-8111-111111111111", versionNo: 1, issuedOn: "2026-10-01", validFrom: "2026-10-05", validTo: "2027-10-04" };
  const fp = (permitRegistration: typeof reg | null | undefined) => prepareReport(basePlan({ permitRegistration: permitRegistration as never }), "new").fingerprint;

  it("登録が適用されない通報の指紋は従来と一致する（FINGERPRINT_VERSION は同じ。登録の項目を持たない）", () => {
    const p = fingerprintPartsOf({ ...basePlan(), permitRegistration: null });
    expect(p).not.toHaveProperty("permit");
    const legacy = sha256Hex(
      JSON.stringify([FINGERPRINT_VERSION, p.startAt, p.durationMinutes, p.lat, p.lng, p.radiusM, p.maxAltitudeM, p.aircraftId, p.pilotId, normalizeFlags(p.flags)]),
    );
    expect(FINGERPRINT_VERSION).toBe("soraban-report-fp-v1");
    expect(computeFingerprint(p)).toBe(legacy);
    expect(fp(null)).toBe(legacy);
    expect(fp(undefined)).toBe(legacy);
  });

  it("登録があるときは指紋が変わり、登録の ID・版・発行日・期間のどれが変わっても変わる", () => {
    const base = fp(reg);
    expect(base).not.toBe(fp(null));
    expect(base).toBe(fp({ ...reg }));
    expect(base).toBe(fp({ ...reg, registrationId: reg.registrationId.toUpperCase() }));
    const others = [
      fp({ ...reg, registrationId: "22222222-2222-4222-8222-222222222222" }),
      fp({ ...reg, versionNo: 2 }),
      fp({ ...reg, issuedOn: "2026-10-02" }),
      fp({ ...reg, validFrom: "2026-10-06" }),
      fp({ ...reg, validTo: "2027-10-05" }),
    ];
    for (const o of others) expect(o).not.toBe(base);
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
  });

  it("差分に「許可・承認の登録」が出る。登録の無い通報（従来の保存値）との比較でも落ちない", () => {
    const none = prepareReport(basePlan(), "new").fingerprintParts;
    const one = prepareReport(basePlan({ permitRegistration: reg as never }), "new").fingerprintParts;
    const v2 = prepareReport(basePlan({ permitRegistration: { ...reg, versionNo: 2 } as never }), "new").fingerprintParts;
    expect(diffFingerprintParts(none, none)).toEqual([]);
    expect(diffFingerprintParts(one, one)).toEqual([]);
    expect(diffFingerprintParts(none, one).map((c) => c.key)).toEqual(["permit"]);
    expect(diffFingerprintParts(none, one)[0]).toMatchObject({ label: "許可・承認の登録", before: "なし" });
    expect(diffFingerprintParts(one, none)[0]!.after).toBe("なし");
    const d = diffFingerprintParts(one, v2);
    expect(d.map((c) => c.key)).toEqual(["permit"]);
    expect(d[0]!.before).toContain("版 1");
    expect(d[0]!.after).toContain("版 2");
    // jsonb はキーの順を変えて返す：同じ値なら差分なし
    const reordered = { ...one, permit: { versionNo: 1, validTo: one.permit!.validTo, validFrom: one.permit!.validFrom, registrationId: one.permit!.registrationId, issuedOn: one.permit!.issuedOn } };
    expect(diffFingerprintParts(reordered, one)).toEqual([]);
    // DB の jsonb に permit が無い（従来の保存値）
    const { permit: _p, ...legacy } = none as Record<string, unknown>;
    expect(diffFingerprintParts(legacy as never, none)).toEqual([]);
  });
});
