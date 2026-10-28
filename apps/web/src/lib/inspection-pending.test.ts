import { describe, expect, it } from "vitest";
import { pendingPreflightInspections } from "./inspection-pending";

// 点検の「未実施」の導出（Sprint 12h PR ③a、Q-22）。元になる do_inspection（今日の計画・飛行前の点検が無い）の導出は
// server/ops の単体試験（field-logic・today-logic。取消した点検・他の機体の点検・JST の日付の境界）が受け持つ。ここは、その結果の読み替えを確かめる。
type Src = Parameters<typeof pendingPreflightInspections>[0];

const action = (planId: string | null, over: Record<string, unknown> = {}) => ({
  id: "do_inspection" as const,
  label: "日常点検をする",
  reason: "飛行当日です。",
  href: `/ops/inspections/new?planId=${planId}`,
  tier: 3 as const,
  dueLabel: null,
  canAct: true,
  startsInMinutes: 60,
  planId,
  planTitle: `計画 ${planId}`,
  ...over,
});

const card = (planId: string, over: Record<string, unknown> = {}) => ({ planId, title: `計画 ${planId}`, timeLabel: "10:30〜11:15", registrationMark: "JU0123", ...over });
const row = (planId: string, over: Record<string, unknown> = {}) => ({ planId, title: `計画 ${planId}`, timeLabel: "13:00〜14:00", registrationMark: "JU0456", ...over });
const src = (o: { card?: unknown; rest?: unknown[]; nextActions?: unknown[] }): Src => ({ card: null, rest: [], nextActions: [], ...o }) as unknown as Src;

describe("点検の未実施（今日の飛行前だけ）", () => {
  it("do_inspection が無ければ 0 件（点検を記録すると、その計画は消える）", () => {
    expect(pendingPreflightInspections(src({ card: card("a"), nextActions: [] }))).toEqual([]);
    expect(pendingPreflightInspections(src({ card: card("a"), nextActions: [{ ...action("a"), id: "check_emergency_airspace" }, { ...action("a"), id: "write_journal" }] }))).toEqual([]);
  });

  it("do_inspection のある今日の計画を、名称・時刻・機体つきで出す", () => {
    const out = pendingPreflightInspections(src({ card: card("a"), nextActions: [action("a")] }));
    expect(out).toEqual([{ planId: "a", title: "計画 a", timeLabel: "10:30〜11:15", registrationMark: "JU0123", href: "/ops/inspections/new?planId=a", canAct: true }]);
  });

  it("今日の残りの計画（rest）の分も出す。予定の早い順（startsInMinutes）で並べる", () => {
    const out = pendingPreflightInspections(
      src({ card: card("a"), rest: [row("b"), row("c")], nextActions: [action("c", { startsInMinutes: 10 }), action("a", { startsInMinutes: 90 }), action("b", { startsInMinutes: 30 })] }),
    );
    expect(out.map((p) => p.planId)).toEqual(["c", "b", "a"]);
    expect(out.find((p) => p.planId === "b")?.registrationMark).toBe("JU0456");
  });

  it("同じ計画は 1 件。計画に結び付かない作業（planId なし）は出さない", () => {
    const out = pendingPreflightInspections(src({ card: card("a"), nextActions: [action("a"), action("a"), action(null)] }));
    expect(out.map((p) => p.planId)).toEqual(["a"]);
  });

  it("点検を入力できない役割には canAct を偽で返す（押せず、理由を文で示すため）", () => {
    const out = pendingPreflightInspections(src({ card: card("a"), nextActions: [action("a", { canAct: false })] }));
    expect(out[0]?.canAct).toBe(false);
  });

  it("計画の細目が card・rest に無くても、未実施を落とさない（名称は次にやることの計画名）", () => {
    const out = pendingPreflightInspections(src({ nextActions: [action("z")] }));
    expect(out).toEqual([{ planId: "z", title: "計画 z", timeLabel: "", registrationMark: "", href: "/ops/inspections/new?planId=z", canAct: true }]);
  });

  it("日付の境界：先の日の計画は do_inspection が付かないので、カードにあっても出さない", () => {
    // fieldNextActions は plannedDate === today のときだけ do_inspection を出す。先の日・飛行後の未実施は、この導出に入らない
    expect(pendingPreflightInspections(src({ card: card("future"), nextActions: [] }))).toEqual([]);
  });
});
