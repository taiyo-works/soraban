// Sprint 15（再評価）：日誌の入力から日常点検の入力へのリンク。計画から作る日誌（計画の機体）では planId と、日誌へ戻る returnTo を付ける。
import { describe, expect, it } from "vitest";
import { inspectionNewFromJournalHref, type FlightFromPlan } from "./records-client";

const plan = { planId: "p1", aircraftId: "a1" } as FlightFromPlan;

describe("inspectionNewFromJournalHref", () => {
  it("計画から作る日誌では planId と returnTo（日誌の入力）を付ける", () => {
    const h = inspectionNewFromJournalHref("a1", plan, { takeoffEventId: "t1" } as never);
    expect(h).toBe(`/ops/inspections/new?aircraftId=a1&planId=p1&returnTo=${encodeURIComponent("/ops/flights/new?planId=p1&takeoffEventId=t1")}`);
  });
  it("計画を経ない日誌・計画と違う機体では、従来どおり計画を付けない", () => {
    expect(inspectionNewFromJournalHref("a1")).toBe("/ops/inspections/new?aircraftId=a1");
    expect(inspectionNewFromJournalHref("a2", plan)).toBe("/ops/inspections/new?aircraftId=a2");
  });
});
