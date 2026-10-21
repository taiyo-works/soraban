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
