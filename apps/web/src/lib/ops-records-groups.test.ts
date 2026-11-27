import { describe, expect, it } from "vitest";
import { INSPECTION_GROUPS, INSPECTION_ITEMS } from "./ops-records";

// Sprint 16-I：点検の 9 項目は、系統の群のどれかにちょうど 1 回入る。項目の名前・キーは変えない（様式2 の 9 項目）。
describe("点検の群（INSPECTION_GROUPS）", () => {
  it("9 項目がどの群にもちょうど 1 回ずつ入る", () => {
    const all = INSPECTION_GROUPS.flatMap((g) => [...g.items]);
    expect(all).toHaveLength(INSPECTION_ITEMS.length);
    expect(new Set(all).size).toBe(INSPECTION_ITEMS.length);
    expect([...all].sort()).toEqual(INSPECTION_ITEMS.map((i) => i.key).sort());
  });
  it("群は 3 つで、識別子は重ならない", () => {
    expect(INSPECTION_GROUPS.map((g) => g.key)).toEqual(["body", "link", "power"]);
    expect(INSPECTION_GROUPS.map((g) => g.label)).toEqual(["機体", "通信・制御", "動力・電源"]);
  });
  it("項目の名前は様式2 のまま", () => {
    expect(INSPECTION_ITEMS.map((i) => i.label)).toEqual(["機体全般", "プロペラ", "フレーム", "通信系統", "推進系統", "電源系統", "自動制御系統", "操縦装置", "バッテリー・燃料"]);
  });
});
