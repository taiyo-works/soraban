// 飛行範囲と通報の指紋（Sprint 19-1b B1-6）。円 1 つ・点だけの計画の指紋は 19-1b の前と同じ値（固定の期待値）。
import { describe, expect, it } from "vitest";
import { computeFingerprint, fingerprintAreasOf, fingerprintOf, fingerprintPartsOf, diffFingerprintParts } from "./fingerprint";
import type { FingerprintArea } from "./types";

const base = {
  startAt: "2026-11-02T10:00",
  durationMinutes: 30,
  latitude: 35.428,
  longitude: 133.331,
  radiusM: 150 as number | null,
  maxAltitudeM: 100,
  aircraftId: "AAAAAAAA-0000-4000-8000-000000000001",
  pilotId: "bbbbbbbb-0000-4000-8000-000000000002",
  snapshot: { flags: ["method_night", "airspace_did"] },
};

const tri = (dx = 0): FingerprintArea => ({
  kind: "polygon",
  vertices: [
    [133.33, 35.42],
    [133.34 + dx, 35.42],
    [133.335, 35.43],
  ],
});
const circle: FingerprintArea = { kind: "circle", center: [133.331, 35.428], radiusM: 150 };

describe("指紋と飛行範囲", () => {
  it("円 1 つ・点だけの計画の指紋は 19-1b の前と同じ値（固定）", () => {
    expect(fingerprintOf(base)).toBe("ca153eae6f08aacdbbbacbfd724f433276b61ef903b48f3fa0afc1f2559afe56");
    expect(fingerprintOf({ ...base, radiusM: null })).toBe("9a69c7724400a7c56ac3546904e02421e99f12a6ba1d9e8228673943303fa1b1");
    // 範囲が円 1 つ（areas を渡しても）なら指紋に入らない
    expect(fingerprintOf({ ...base, areas: [circle] })).toBe("ca153eae6f08aacdbbbacbfd724f433276b61ef903b48f3fa0afc1f2559afe56");
    expect(fingerprintOf({ ...base, areas: null })).toBe("ca153eae6f08aacdbbbacbfd724f433276b61ef903b48f3fa0afc1f2559afe56");
    expect(fingerprintOf({ ...base, areas: [] })).toBe("ca153eae6f08aacdbbbacbfd724f433276b61ef903b48f3fa0afc1f2559afe56");
    expect(fingerprintPartsOf({ ...base, areas: [circle] })).not.toHaveProperty("areas");
  });

  it("多角形の計画は、頂点を 1 つ動かすと指紋が変わる", () => {
    const a = fingerprintOf({ ...base, areas: [tri()] });
    expect(a).not.toBe(fingerprintOf(base));
    expect(fingerprintOf({ ...base, areas: [tri()] })).toBe(a);
    expect(fingerprintOf({ ...base, areas: [tri(0.000001)] })).not.toBe(a);
  });

  it("範囲が 2 つのとき（円と円でも）指紋が変わる。順を変えても変わる", () => {
    const c2: FingerprintArea = { kind: "circle", center: [133.4, 35.4], radiusM: 50 };
    const two = fingerprintOf({ ...base, areas: [circle, c2] });
    expect(two).not.toBe(fingerprintOf(base));
    expect(fingerprintOf({ ...base, areas: [c2, circle] })).not.toBe(two);
  });

  it("座標は小数 6 桁に丸めて入る（丸め前でも同じ）", () => {
    const rough: FingerprintArea = { kind: "polygon", vertices: [[133.33, 35.42], [133.34, 35.42], [133.335000000001, 35.43]] };
    expect(fingerprintOf({ ...base, areas: [rough] })).toBe(fingerprintOf({ ...base, areas: [tri()] }));
  });

  it("許可の登録があっても、範囲の無い指紋は従来どおりで、範囲を足すと変わる", () => {
    const permit = { registrationId: "R", versionNo: 1, issuedOn: "2026-01-01", validFrom: "2026-01-01", validTo: "2027-01-01" };
    const without = fingerprintOf({ ...base, permitRegistration: permit });
    const withArea = fingerprintOf({ ...base, permitRegistration: permit, areas: [tri()] });
    expect(withArea).not.toBe(without);
  });

  it("fingerprintAreasOf は円 1 つ・無しで undefined、多角形または 2 件以上で返す", () => {
    expect(fingerprintAreasOf(undefined)).toBeUndefined();
    expect(fingerprintAreasOf([circle])).toBeUndefined();
    expect(fingerprintAreasOf([tri()])).toHaveLength(1);
    expect(fingerprintAreasOf([circle, circle])).toHaveLength(2);
  });

  it("変更点の表示に飛行範囲が出る", () => {
    const before = fingerprintPartsOf(base);
    const after = fingerprintPartsOf({ ...base, areas: [tri()] });
    const d = diffFingerprintParts(before, after);
    expect(d.map((x) => x.key)).toContain("areas");
    expect(d.find((x) => x.key === "areas")?.after).toBe("1 件（多角形 1・円 0）");
    // 頂点だけ動いたとき
    const moved = diffFingerprintParts(after, fingerprintPartsOf({ ...base, areas: [tri(0.000001)] }));
    expect(moved.find((x) => x.key === "areas")?.after).toBe("1 件（多角形 1・円 0）・頂点の位置が変わりました");
    // 範囲なしの表示
    expect(diffFingerprintParts(after, before).find((x) => x.key === "areas")?.after).toBe("円・点（範囲の指定なし）");
    expect(computeFingerprint(after)).not.toBe(computeFingerprint(before));
  });
});
