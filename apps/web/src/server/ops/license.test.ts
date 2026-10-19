import { describe, expect, it } from "vitest";
import { licenseRenewalStatus, subtractCalendarMonths, todayJst } from "./license";

// Sprint 11a 契約 22：技能証明の有効期限の注意（月末の扱いを含む）。
describe("licenseRenewalStatus", () => {
  const EXP = "2027-03-31";
  it.each([
    ["2026-09-29", "none"],
    ["2026-09-30", "renewal_window"],
    ["2027-02-28", "renewal_window"],
    ["2027-03-01", "past_deadline"],
    ["2027-03-31", "past_deadline"],
    ["2027-04-01", "expired"],
  ] as const)("満了日 2027-03-31・今日 %s → %s", (today, expected) => {
    expect(licenseRenewalStatus(EXP, today)).toBe(expected);
  });

  it("期限が未入力なら none", () => {
    expect(licenseRenewalStatus(null, "2027-03-01")).toBe("none");
    expect(licenseRenewalStatus("", "2027-03-01")).toBe("none");
  });

  it("暦の月で数え、同じ日が無い月は月末にする", () => {
    expect(subtractCalendarMonths("2027-03-31", 6)).toBe("2026-09-30");
    expect(subtractCalendarMonths("2027-03-31", 1)).toBe("2027-02-28");
    expect(subtractCalendarMonths("2028-03-31", 1)).toBe("2028-02-29");
    expect(subtractCalendarMonths("2027-01-15", 1)).toBe("2026-12-15");
    expect(subtractCalendarMonths("2027-06-30", 6)).toBe("2026-12-30");
  });

  it("今日の日付は日本時間で数える", () => {
    expect(todayJst(new Date("2026-10-19T15:00:00.000Z"))).toBe("2026-10-20");
    expect(todayJst(new Date("2026-10-19T14:59:59.000Z"))).toBe("2026-10-19");
  });
});

describe("更新の文言（満了の 1 か月前までに更新の申請を済ませる）", () => {
  it("申請期限の言い方で揃える", async () => {
    const { LICENSE_RENEWAL_LABEL } = await import("./license");
    expect(LICENSE_RENEWAL_LABEL.past_deadline).toContain("更新の申請期限");
    expect(LICENSE_RENEWAL_LABEL.renewal_window).toContain("申請");
  });
});
