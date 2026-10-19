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
