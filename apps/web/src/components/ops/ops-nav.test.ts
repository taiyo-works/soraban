import { describe, expect, it } from "vitest";
import { currentNavKey, NAV_ITEMS, navHiddenOn } from "./ops-nav";

const PLAN = "00000000-0000-4000-8000-000000000001";

describe("下メニュー（Sprint 12c 設計 I）", () => {
  it("5 項目：今日／判定／計画／日誌／その他。行き先が決まっている", () => {
    expect(NAV_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ["今日", "/ops"],
      ["判定", "/"],
      ["計画", "/ops/plans"],
      ["日誌", "/ops/journal"],
      ["その他", "/ops/more"],
    ]);
  });

  it("現場モード・サインイン・アクセス権なしでは出さない", () => {
    expect(navHiddenOn(`/ops/plans/${PLAN}/field`)).toBe(true);
    expect(navHiddenOn(`/ops/plans/${PLAN}/field/`)).toBe(true);
    expect(navHiddenOn("/ops/sign-in")).toBe(true);
    expect(navHiddenOn("/ops/no-access")).toBe(true);
    for (const p of ["/", "/ops", "/ops/plans", `/ops/plans/${PLAN}`, `/ops/plans/${PLAN}/report`, "/ops/journal", "/ops/more", "/ops/flights/new"]) {
      expect(navHiddenOn(p), p).toBe(false);
    }
  });

  it("現在地：日誌は飛行記録・日常点検・日誌、計画は /ops/plans*、その他は機体・操縦者・地点・利用者も含む", () => {
    const cases: [string, string | null][] = [
      ["/", "verdict"],
      ["/ops", "today"],
      ["/ops/plans", "plans"],
      [`/ops/plans/${PLAN}`, "plans"],
      [`/ops/plans/${PLAN}/report`, "plans"],
      ["/ops/plans/new", "plans"],
      ["/ops/journal", "journal"],
      ["/ops/flights", "journal"],
      ["/ops/flights/new", "journal"],
      [`/ops/flights/${PLAN}`, "journal"],
      ["/ops/inspections", "journal"],
      ["/ops/inspections/new", "journal"],
      ["/ops/more", "more"],
      ["/ops/aircraft", "more"],
      ["/ops/pilots/new", "more"],
      ["/ops/places", "more"],
      ["/ops/permits", "more"],
      ["/ops/permits/new", "more"],
      ["/ops/members", "more"],
      ["/somewhere-else", null],
    ];
    for (const [p, key] of cases) expect(currentNavKey(p), p).toBe(key);
  });

  it("Sprint 12e：現場の簡易記録では出さない。事故・ヒヤリハットの画面は「その他」が現在地", () => {
    expect(navHiddenOn(`/ops/plans/${PLAN}/field/incident`)).toBe(true);
    expect(navHiddenOn(`/ops/plans/${PLAN}/field/incident/`)).toBe(true);
    expect(navHiddenOn(`/ops/plans/${PLAN}/field/other`)).toBe(false);
    for (const p of ["/ops/incidents", "/ops/incidents/new", `/ops/incidents/${PLAN}`]) {
      expect(navHiddenOn(p), p).toBe(false);
      expect(currentNavKey(p), p).toBe("more");
    }
  });
});
