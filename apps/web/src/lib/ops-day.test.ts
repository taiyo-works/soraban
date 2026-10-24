import { describe, expect, it } from "vitest";
import { formatDay, formatDaysIn } from "./ops-day";

describe("ops-day：日付の読みやすい表示", () => {
  it("同じ年は年を付けず、月日と曜日だけ（ゼロ埋めしない）", () => {
    expect(formatDay("2027-01-05", "2027-01-05")).toBe("1/5（火）");
    expect(formatDay("2027-02-10", "2027-01-05")).toBe("2/10（水）");
    expect(formatDay("2027-12-31", "2027-01-05")).toBe("12/31（金）");
  });
  it("年をまたぐときだけ年を付ける", () => {
    expect(formatDay("2028-01-05", "2027-12-20")).toBe("2028/1/5（水）");
    expect(formatDay("2026-12-30", "2027-01-05")).toBe("2026/12/30（水）");
  });
  it("存在しない日付・形式違いはそのまま返す（壊さない）", () => {
    expect(formatDay("2027-02-30", "2027-01-05")).toBe("2027-02-30");
    expect(formatDay("明日", "2027-01-05")).toBe("明日");
  });
  it("文の中の日付だけを置き換える", () => {
    expect(formatDaysIn("有効期限は 2027-01-20 です。2027-02-05 まで。", "2027-01-05")).toBe("有効期限は 1/20（水） です。2/5（金） まで。");
    expect(formatDaysIn("日付なし", "2027-01-05")).toBe("日付なし");
  });
});
