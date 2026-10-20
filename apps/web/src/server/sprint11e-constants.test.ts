// Sprint 11e 契約 9・10（単体）：模型航空機の文言・参照先・確認日は model-aircraft.ts 1 か所。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MODEL_AIRCRAFT_DEADLINE_LABEL,
  MODEL_AIRCRAFT_REFERENCES,
  MODEL_AIRCRAFT_RULES_CHECKED_AT,
  MODEL_AIRCRAFT_WEIGHT_NOTE,
  MODEL_AIRCRAFT_WEIGHT_TAG,
} from "@soraban/regulations";

const src = readFileSync(new URL("../../../../packages/regulations/src/model-aircraft.ts", import.meta.url), "utf8");

describe("model-aircraft.ts", () => {
  it("確認日と「※要確認：一次資料未取得」のコメントがある", () => {
    expect(MODEL_AIRCRAFT_RULES_CHECKED_AT).toBe("2026-10-20");
    expect(src).toContain("※要確認：一次資料未取得");
  });
  it("参照先 9 件の URL が入っている（Sprint 11f で航空法施行規則を分け、Sprint 11g で国交省の 3 ページを足した）", () => {
    expect(MODEL_AIRCRAFT_REFERENCES.map((r) => r.url)).toEqual([
      "https://laws.e-gov.go.jp/law/327AC0000000231",
      "https://laws.e-gov.go.jp/law/327M50000800056",
      "https://www.mlit.go.jp/koku/koku_tk1_000048.html",
      "https://www.mlit.go.jp/common/001708524.pdf",
      "https://www.mlit.go.jp/common/002010809.pdf",
      "https://www.npa.go.jp/bureau/security/kogatamujinki/index.html",
      "https://www.mlit.go.jp/koku/koku_fr10_000040.html",
      "https://www.mlit.go.jp/koku/content/001407133.pdf",
      "https://www.mlit.go.jp/koku/koku_fr10_000042.html",
    ]);
  });
  it("期限は日付を作らない文言。緩和を示す言葉を使わない", () => {
    expect(MODEL_AIRCRAFT_DEADLINE_LABEL).toBe("事前に（参照先で確認）");
    const all = `${MODEL_AIRCRAFT_WEIGHT_NOTE}${MODEL_AIRCRAFT_WEIGHT_TAG}`;
    expect(all).not.toMatch(/100g 未満の例外|手続き不要/);
  });
});
