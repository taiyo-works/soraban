import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./evidence";

// Sprint 12b は判定エンジンを変えない（契約 20）。版が変わったら意図した変更か確認する。
describe("判定エンジンの版", () => {
  it("ENGINE_VERSION は 0.4.0 のまま", () => {
    expect(ENGINE_VERSION).toBe("soraban-0.4.0-verdict-2026-10");
  });
});
