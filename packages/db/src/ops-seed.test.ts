import { describe, expect, it } from "vitest";
import { assertLocalTarget } from "./ops-seed";

describe("テスト用の初期データの接続先の制限", () => {
  it("localhost・127.0.0.1 だけを許す", () => {
    expect(assertLocalTarget("postgresql://postgres:pw@localhost:5432/x")).toContain("localhost");
    expect(assertLocalTarget("postgresql://postgres:pw@127.0.0.1/x")).toContain("127.0.0.1");
    expect(() => assertLocalTarget("postgresql://o:pw@ep-cool-1234.ap-southeast-1.aws.neon.tech/neondb")).toThrow(/localhost/);
    expect(() => assertLocalTarget("postgresql://o:pw@localhost.evil.example/x")).toThrow();
    expect(() => assertLocalTarget(undefined)).toThrow();
    expect(() => assertLocalTarget("postgresql://o:pw@localhost/x?host=db.example.com")).toThrow();
  });
});

describe("テスト用の初期データの内容（Sprint 12a）", () => {
  it("組織 A のよく使う地点は本社の住所と座標。重量の分かる機体がある", async () => {
    const { OPS_TEST_AIRCRAFT, OPS_TEST_PLACE } = await import("./ops-seed");
    expect(OPS_TEST_PLACE).toEqual({
      name: "フューチャーテック株式会社 本社",
      addressText: "鳥取県西伯郡日吉津村日吉津45番地3",
      latitude: 35.434238,
      longitude: 133.380508,
    });
    expect(OPS_TEST_AIRCRAFT.weighted).toBe("JUSEEDA0900");
  });
});

describe("テスト用の初期データの内容（Sprint 12d）", () => {
  it("組織 A の許可・承認の登録の番号が 6 件ある（包括・個別・期限切れ・失効・空港等周辺・場所が文章のみ）", async () => {
    const { OPS_TEST_PERMITS } = await import("./ops-seed");
    expect(Object.keys(OPS_TEST_PERMITS)).toEqual(["blanket", "individual", "expired", "revoked", "airport", "textOnly"]);
    expect(new Set(Object.values(OPS_TEST_PERMITS)).size).toBe(6);
  });
});

describe("テスト用の初期データの内容（Sprint 12e）", () => {
  it("事故・ヒヤリハットの要約が 8 件（組織 A の 7 件と組織 B の 1 件。簡易記録は要約を持たない）。指紋は類型を並べ替える", async () => {
    const { OPS_TEST_INCIDENTS, incidentFactsFingerprint } = await import("./ops-seed");
    expect(Object.keys(OPS_TEST_INCIDENTS)).toEqual([
      "accidentNoReport",
      "nearMissDone",
      "quickPending",
      "reported",
      "changedAfterReport",
      "voided",
      "journalLinked",
      "orgB",
    ]);
    expect(OPS_TEST_INCIDENTS.quickPending).toBeNull();
    const a = incidentFactsFingerprint({ kind: "accident", event_types: ["a", "b"], people_injury: "yes", injured_count: 1 });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(incidentFactsFingerprint({ kind: "accident", event_types: ["b", "a"], people_injury: "yes", injured_count: 1 })).toBe(a);
  });
});
