// 行程の 1 行の導出（Sprint 12g-1b A8）。段ごとの規則を、入力の全組合せで確かめる。
import { describe, expect, it } from "vitest";
import { journeyDone, journeyStages, JOURNEY_STAGES, type JourneyInput } from "./journey-logic";
import type { PlanState } from "./plan-logic";

const BASE: JourneyInput = {
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
const make = (o: Partial<JourneyInput>): JourneyInput => ({ ...BASE, ...o });
const states = (o: Partial<JourneyInput>) => journeyStages(make(o)).map((s) => s.state);

describe("段の規則（導出）", () => {
  it("判定：スナップショットがあり、古くなければ済", () => {
    expect(journeyDone(make({})).judge).toBe(true);
    expect(journeyDone(make({ judgementStale: true })).judge).toBe(false);
    expect(journeyDone(make({ hasSnapshot: false })).judge).toBe(false);
  });

  it("計画：下書きでなければ済。確認：確認済みだけ済（前の版への確認・差し戻し・確認待ちは未）", () => {
    const plan: [PlanState, boolean, boolean][] = [
      ["draft", false, false],
      ["pending", true, false],
      ["approved", true, true],
      ["approved_stale", true, false],
      ["returned", true, false],
      ["returned_stale", true, false],
      ["voided", true, false],
    ];
    for (const [state, planDone, confirmDone] of plan) {
      const d = journeyDone(make({ planState: state }));
      expect([state, d.plan, d.confirm], state).toEqual([state, planDone, confirmDone]);
    }
  });

  it("通報：記録があるとき（通報済み）だけ済。要でも推奨でも、記録が無ければ済にしない", () => {
    for (const code of ["no_record", "change_review", "cancel_needed", "cancelled", "unknown", "failed", "sending", "not_applicable_model"] as const) {
      expect(journeyDone(make({ reportStatus: code })).report, code).toBe(false);
    }
    expect(journeyDone(make({ reportStatus: "reported" })).report).toBe(true);
  });

  it("通報の対象外（模型航空機）は「対象外」で、「次」にならない。ほかの未了の段が「次」になる", () => {
    const s = journeyStages(make({ planState: "approved", reportStatus: "not_applicable_model" }));
    expect(s.find((x) => x.id === "report")).toMatchObject({ state: "skip", stateLabel: "対象外" });
    expect(s.find((x) => x.id === "inspection")?.state).toBe("next");
  });

  it("点検：当日の飛行前の日常点検があるとき済（先の日の計画では未）", () => {
    expect(journeyDone(make({ inspectionDone: true })).inspection).toBe(true);
    expect(journeyDone(make({})).inspection).toBe(false);
  });

  it("飛行：着陸まで記録した飛行があり、飛行中でなければ済。飛行中は未。手で入力した飛行記録があれば済", () => {
    expect(journeyDone(make({ hasLandedFlight: true })).flight).toBe(true);
    expect(journeyDone(make({ hasLandedFlight: true, inFlight: true })).flight).toBe(false);
    expect(journeyDone(make({ inFlight: true })).flight).toBe(false);
    expect(journeyDone(make({ hasFlightRecord: true })).flight).toBe(true);
    expect(journeyDone(make({})).flight).toBe(false);
  });

  it("日誌：飛んだあと、日誌待ちが無ければ済。日誌待ち・飛んでいないときは未", () => {
    expect(journeyDone(make({ hasLandedFlight: true })).journal).toBe(true);
    expect(journeyDone(make({ hasLandedFlight: true, journalPending: true })).journal).toBe(false);
    expect(journeyDone(make({ hasFlightRecord: true })).journal).toBe(true);
    expect(journeyDone(make({})).journal).toBe(false);
    expect(journeyDone(make({ journalPending: true })).journal).toBe(false);
  });
});

describe("7 段の状態", () => {
  it("段は 判定→計画→確認→通報→点検→飛行→日誌 の順で 7 つ。文字はすべて入る", () => {
    const s = journeyStages(BASE);
    expect(JOURNEY_STAGES).toHaveLength(7);
    expect(s.map((x) => x.label)).toEqual(["判定", "計画", "確認", "通報", "点検", "飛行", "日誌"]);
    for (const x of s) expect(x.stateLabel).toMatch(/^(済|次|未|対象外)$/);
  });

  it("終わっていない最初の段だけが「次」。それより先は「未」。済の段の先にも「次」は 1 つだけ", () => {
    expect(states({})).toEqual(["done", "next", "todo", "todo", "todo", "todo", "todo"]);
    expect(states({ planState: "pending" })).toEqual(["done", "done", "next", "todo", "todo", "todo", "todo"]);
    expect(states({ planState: "approved", reportStatus: "reported" })).toEqual(["done", "done", "done", "done", "next", "todo", "todo"]);
    expect(states({ planState: "approved", reportStatus: "reported", inspectionDone: true, inFlight: true })).toEqual(["done", "done", "done", "done", "done", "next", "todo"]);
  });

  it("すべて終わると「次」は無い", () => {
    const s = states({ planState: "approved", reportStatus: "reported", inspectionDone: true, hasLandedFlight: true });
    expect(s).toEqual(["done", "done", "done", "done", "done", "done", "done"]);
  });

  it("全組合せ：「次」は多くても 1 つ。済の段の後ろに済でない段が来ても、「次」はその最初の段", () => {
    const bools = [false, true];
    const planStates: PlanState[] = ["draft", "pending", "approved", "returned"];
    const reports = ["no_record", "reported", "not_applicable_model"] as const;
    let count = 0;
    for (const hasSnapshot of bools)
      for (const judgementStale of bools)
        for (const planState of planStates)
          for (const reportStatus of reports)
            for (const inspectionDone of bools)
              for (const hasLandedFlight of bools)
                for (const inFlight of bools)
                  for (const journalPending of bools)
                    for (const hasFlightRecord of bools) {
                      const input = make({ hasSnapshot, judgementStale, planState, reportStatus, inspectionDone, hasLandedFlight, inFlight, journalPending, hasFlightRecord });
                      const s = journeyStages(input);
                      const done = journeyDone(input);
                      count++;
                      expect(s.filter((x) => x.state === "next").length).toBeLessThanOrEqual(1);
                      const firstOpen = s.find((x) => !done[x.id] && x.state !== "skip");
                      for (const x of s) {
                        if (done[x.id]) expect(x.state).toBe("done");
                        else if (x.state !== "skip") expect(x.state).toBe(x === firstOpen ? "next" : "todo");
                      }
                      // 「通報不要」と読める言葉は作らない
                      for (const x of s) expect(`${x.label}${x.stateLabel}`).not.toMatch(/不要|必要はありません/);
                    }
    expect(count).toBe(2 * 2 * 4 * 3 * 2 * 2 * 2 * 2 * 2);
  });
});
