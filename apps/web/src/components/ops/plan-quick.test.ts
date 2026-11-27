import { describe, expect, it } from "vitest";
import { QUICK_DURATIONS, QUICK_FIRST_SLOT, QUICK_SLOT_COUNT, quickDates, quickStartSlots } from "./plan-quick";

// 2027-01-05 12:10 JST（= 03:10 UTC）
const NOON = new Date("2027-01-05T03:10:00Z");

describe("クイック選択の純関数（16-H2 H2-1）", () => {
  it("今日・明日は日本時間の日付（UTC の日付ではない）", () => {
    expect(quickDates(NOON)).toEqual({ today: "2027-01-05", tomorrow: "2027-01-06" });
    // 2027-01-05 23:50 JST（= 14:50 UTC）。UTC では同じ日だが、日本時間の明日は 06 日
    expect(quickDates(new Date("2027-01-05T14:50:00Z"))).toEqual({ today: "2027-01-05", tomorrow: "2027-01-06" });
    // 2027-01-05 00:10 JST（= 前日 15:10 UTC）
    expect(quickDates(new Date("2027-01-04T15:10:00Z"))).toEqual({ today: "2027-01-05", tomorrow: "2027-01-06" });
  });
  it("今日：今の次の 30 分から、30 分刻みで 12 個", () => {
    const s = quickStartSlots(true, NOON);
    expect(s[0]).toBe("12:30");
    expect(s).toHaveLength(QUICK_SLOT_COUNT);
    expect(s.at(-1)).toBe("18:00");
  });
  it("今日：ちょうど 30 分の時刻は、その次の 30 分から（過去の時刻を出さない）", () => {
    expect(quickStartSlots(true, new Date("2027-01-05T03:30:00Z"))[0]).toBe("13:00");
    expect(quickStartSlots(true, new Date("2027-01-05T03:00:00Z"))[0]).toBe("12:30");
  });
  it("今日：夜遅いと 23:30 まで（日付をまたがない）", () => {
    const s = quickStartSlots(true, new Date("2027-01-05T13:40:00Z")); // 22:40 JST
    expect(s).toEqual(["23:00", "23:30"]);
    expect(quickStartSlots(true, new Date("2027-01-05T14:40:00Z"))).toEqual([]); // 23:40 JST
  });
  it("今日以外：08:00 から 12 個（13:30 まで）", () => {
    const s = quickStartSlots(false, NOON);
    expect(s[0]).toBe(QUICK_FIRST_SLOT);
    expect(s.at(-1)).toBe("13:30");
    expect(s).toHaveLength(QUICK_SLOT_COUNT);
    for (const hm of s) expect(hm).toMatch(/^\d{2}:(00|30)$/);
  });
  it("飛行時間は 15・30・60・90 分", () => {
    expect([...QUICK_DURATIONS]).toEqual([15, 30, 60, 90]);
  });
});
