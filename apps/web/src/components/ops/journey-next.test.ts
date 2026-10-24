import { describe, expect, it } from "vitest";
import { JOURNEY_STAGES, journeyStages, type JourneyInput } from "@/server/ops/journey-logic";
import type { TodayNextAction } from "@/server/ops/today-logic";
import { journeyNext, STAGE_OF_ACTION } from "./journey-next";

const base: JourneyInput = {
  hasSnapshot: true,
  judgementStale: false,
  planState: "draft",
  reportStatus: "no_record",
  inspectionDone: false,
  hasLandedFlight: false,
  inFlight: false,
  journalPending: false,
  hasFlightRecord: false,
};
const act = (id: string, planId: string): TodayNextAction => ({ id, label: id, reason: "", href: "/x", tier: 3, dueLabel: null, canAct: true, startsInMinutes: 0, planId, planTitle: "t" }) as unknown as TodayNextAction;

describe("行程の「次」の段と作業（ホームの次の飛行）", () => {
  it("対応づけの先は、行程の 7 段のどれか", () => {
    for (const stage of Object.values(STAGE_OF_ACTION)) expect(JOURNEY_STAGES).toContain(stage);
  });

  it("下書きの計画：次の段は「計画」。同じ計画の「確認を依頼する」を選ぶ（急ぐ順で先にある別の段の作業は選ばない）", () => {
    const stages = journeyStages(base);
    const n = journeyNext(stages, [act("report", "p1"), act("request_confirmation", "p2"), act("request_confirmation", "p1")], "p1");
    expect(n.stage?.id).toBe("plan");
    expect(n.action?.id).toBe("request_confirmation");
    expect(n.action?.planId).toBe("p1");
  });

  it("次の段に当たる作業がなければ、段だけ返す。すべて済なら null", () => {
    const stages = journeyStages(base);
    expect(journeyNext(stages, [act("report", "p1")], "p1")).toEqual({ stage: expect.objectContaining({ id: "plan" }), action: null });
    const allDone = journeyStages({ ...base, planState: "approved", reportStatus: "reported", inspectionDone: true, hasLandedFlight: true, hasFlightRecord: true });
    expect(journeyNext(allDone, [act("write_journal", "p1")], "p1")).toEqual({ stage: null, action: null });
  });
});
