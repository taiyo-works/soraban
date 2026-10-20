import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// Sprint 11a 契約 20：申請支援の証跡 ID は制度データの revision（2）で変わる。理由が revision
// （と、緊急用務空域ではカテゴリーの変更）だけであることを、変更前（origin/main cb0275b）に同じ入力・同じ時刻で
// 求めた値とともに確かめる。地点判定の証跡 ID は sprint10a.test.ts の期待値のまま。
import {
  buildDiagnosisEvidencePayload,
  deriveDiagnosis,
  ENGINE_VERSION,
  PREVIOUS_ENGINE_VERSIONS,
  PROCEDURES_REVISION,
  PROCEDURES_VERIFIED_AT,
  type SpecificFlightFlag,
} from "@soraban/regulations";

describe("Sprint 11a：申請支援の証跡 ID と制度データの revision", () => {
  // Sprint 11d で ENGINE_VERSION を 0.4.0 に上げた。以下の期待値は 0.3.0 の文字列を渡したペイロードで保つ。
  it("ENGINE_VERSION は 0.4.0（Sprint 11d）。0.3.0 は過去の版", () => {
    expect(ENGINE_VERSION).toMatch(/^soraban-0\.4\.0-verdict-/);
    expect(PREVIOUS_ENGINE_VERSIONS).toContain("soraban-0.3.0-regulations-2026-07");
  });

  // 申請支援の証跡 ID。変更前（origin/main cb0275b）の値は、同じ入力・同じ時刻で変更前のコードから求めた値。
  const sha16 = (s: string) => `ev_${createHash("sha256").update(s).digest("hex").slice(0, 16)}`;
  const base = {
    engineVersion: "soraban-0.3.0-regulations-2026-07",
    lat: 35.4936,
    lng: 133.2361,
    checkedAt: "2026-10-19T00:00:00.000Z",
    regulationIds: ["aviation-law-airport", "aviation-law-did"],
    datasets: [{ id: "did-r2", verifiedAt: "2026-10-19" }],
    droneWeightG: 900,
  };
  const payloadFor = (flags: SpecificFlightFlag[]) => {
    const d = deriveDiagnosis({ flags, droneWeightG: 900, didStatus: "not_applicable" });
    return buildDiagnosisEvidencePayload({
      ...base,
      flags,
      category: d.category,
      procedureIds: d.procedures.map((p) => p.id),
      didStatus: d.didStatus,
    });
  };

  it("20. PROCEDURES_REVISION は 2 で、ペイロードに \"rev\":2 が入り、rev だけ違うペイロードは異なる", () => {
    expect(PROCEDURES_REVISION).toBe(2);
    const p = payloadFor(["method_night"]);
    expect(p).toContain('"rev":2');
    expect(p.replace('"rev":2', '"rev":3')).not.toBe(p);
    expect(sha16(p.replace('"rev":2', '"rev":3'))).not.toBe(sha16(p));
  });

  it("20. 夜間・目視外：証跡 ID は変わり、理由は revision だけ（確認日は同じ 2026-10-19）", () => {
    const BEFORE = "ev_e687e97d892a9853"; // origin/main cb0275b
    const AFTER = "ev_1c0832bf40496260"; // 本スプリント（制度データ revision 2）
    const p = payloadFor(["method_night", "method_bvlos"]);
    expect(PROCEDURES_VERIFIED_AT).toBe("2026-10-19T00:00:00+09:00");
    expect(sha16(p)).toBe(AFTER);
    expect(AFTER).not.toBe(BEFORE);
    // rev を除いたペイロードは変更前の証跡 ID と一致する（ほかの入力・確認日は変わっていない）
    expect(sha16(p.replace(',"rev":2', ""))).toBe(BEFORE);
  });

  it("20. 緊急用務空域：カテゴリーが II_A から emergency_no_fly に変わり、証跡 ID も変わる", () => {
    const BEFORE = "ev_3ad16b0d5ef51d89"; // origin/main cb0275b（カテゴリー II_A）
    const AFTER = "ev_6746c66ca4dfbb1a"; // 本スプリント（emergency_no_fly、revision 2）
    const p = payloadFor(["airspace_emergency"]);
    expect(p).toContain('"cat":"emergency_no_fly"');
    expect(sha16(p)).toBe(AFTER);
    expect(AFTER).not.toBe(BEFORE);
    // カテゴリーを旧値に戻し rev を除くと変更前と一致する（手続き ID の組は変わっていない）
    expect(sha16(p.replace(',"rev":2', "").replace('"cat":"emergency_no_fly"', '"cat":"II_A"'))).toBe(BEFORE);
  });
});
