// Sprint 12c 契約 6：todayModel と次にやることの拡張（単体）。境界（予定終了の 60 分後、食い違いの 3 日間、技能証明の 60 日前・期限切れ）を含む。
import { NEXT_ACTION_LABEL } from "@soraban/dips";
import { jstDate } from "@/lib/ops-time";
import { describe, expect, it } from "vitest";
import { fieldState, type FieldEventLite, type FieldState } from "./field-logic";
import { compareNextActions } from "./report-logic";
import {
  addDays,
  daysBetween,
  fieldNextActions,
  licenseNextActions,
  mismatchNextActions,
  rankNextActions,
  todayModel,
  type TodayNextAction,
  type TodayPlanLite,
} from "./today-logic";

const jst = (s: string): Date => new Date(`${s}:00+09:00`);
const NOW = jst("2027-01-05T12:00");
const TODAY = "2027-01-05";

const plan = (id: string, start: string, over: Partial<TodayPlanLite> = {}, duration = 60): TodayPlanLite => ({
  id,
  plannedStartAt: jst(start),
  durationMinutes: duration,
  plannedDate: start.slice(0, 10),
  voided: false,
  isSelf: false,
  inFlight: false,
  ...over,
});
const model = (plans: TodayPlanLite[], role: "manager" | "pilot" | "viewer" = "manager", now = NOW) =>
  todayModel({ now, today: jstDate(now), role, plans });

describe("addDays・daysBetween", () => {
  it("暦の日で数える（月・年・うるう年をまたぐ）", () => {
    expect(addDays("2027-01-05", 7)).toBe("2027-01-12");
    expect(addDays("2027-01-30", 3)).toBe("2027-02-02");
    expect(addDays("2027-12-30", 3)).toBe("2028-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2027-01-05", "2027-03-06")).toBe(60);
    expect(daysBetween("2027-01-05", "2027-01-04")).toBe(-1);
  });
});

describe("todayModel", () => {
  it("計画が無ければ空", () => {
    expect(model([])).toEqual({ today: TODAY, card: null, rest: [] });
  });

  it("今日の計画のうち、予定の終了が現在より後で最も早いものがカード。残りの今日の計画は予定開始の順", () => {
    const a = plan("a", "2027-01-05T09:00"); // 終了 10:00（済み）
    const b = plan("b", "2027-01-05T16:00");
    const c = plan("c", "2027-01-05T12:30");
    const m = model([a, b, c]);
    expect(m.card).toEqual({ planId: "c", reason: "today" });
    expect(m.rest).toEqual(["a", "b"]);
  });

  it("予定終了がちょうど現在の計画は終了済み（現在より後でない）", () => {
    const m = model([plan("a", "2027-01-05T11:00"), plan("b", "2027-01-05T15:00")]);
    expect(m.card?.planId).toBe("b");
  });

  it("飛行中の離陸がある計画が最優先（今日でなくても、中止していても）", () => {
    const m = model([plan("a", "2027-01-05T12:30"), plan("old", "2027-01-03T09:00", { inFlight: true, voided: true })]);
    expect(m.card).toEqual({ planId: "old", reason: "in_flight" });
    expect(m.rest).toEqual(["a"]);
  });

  it("今日の計画が無ければ、これから最も近い計画。中止した計画は対象外", () => {
    const m = model([plan("x", "2027-01-08T09:00"), plan("y", "2027-01-06T09:00"), plan("v", "2027-01-05T18:00", { voided: true }), plan("p", "2027-01-04T09:00")]);
    expect(m.card).toEqual({ planId: "y", reason: "next" });
    expect(m.rest).toEqual([]);
  });

  it("今日の計画がすべて終わっていて、これからの計画があれば、これからの計画をカードにする。終わった今日の計画は残りに出る", () => {
    const m = model([plan("done", "2027-01-05T09:00"), plan("tomorrow", "2027-01-06T09:00")]);
    expect(m.card).toEqual({ planId: "tomorrow", reason: "next" });
    expect(m.rest).toEqual(["done"]);
  });

  it("今日の計画がすべて終わっていて次も無ければ空（今日の計画は残りに出る）", () => {
    const m = model([plan("done", "2027-01-05T09:00")]);
    expect(m.card).toBeNull();
    expect(m.rest).toEqual(["done"]);
  });

  it("操縦者役割には、自分が操縦者の飛行を先に出す（運航管理者・閲覧者は予定の順）", () => {
    const other = plan("other", "2027-01-05T12:10");
    const mine = plan("mine", "2027-01-05T15:00", { isSelf: true });
    expect(model([other, mine], "pilot").card?.planId).toBe("mine");
    expect(model([other, mine], "pilot").rest).toEqual(["other"]);
    expect(model([other, mine], "manager").card?.planId).toBe("other");
    expect(model([other, mine], "viewer").card?.planId).toBe("other");
    // 自分の飛行が無ければ、全員の計画から選ぶ
    expect(model([other], "pilot").card?.planId).toBe("other");
    // 飛行中も自分を先に
    const a = plan("a", "2027-01-05T10:00", { inFlight: true });
    const b = plan("b", "2027-01-05T11:00", { inFlight: true, isSelf: true });
    expect(model([a, b], "pilot").card?.planId).toBe("b");
    // 残りの順：自分の飛行が先
    const r = model([plan("c", "2027-01-05T13:00"), plan("d", "2027-01-05T14:00", { isSelf: true }), plan("e", "2027-01-05T12:30", { isSelf: true })], "pilot");
    expect(r.card?.planId).toBe("e");
    expect(r.rest).toEqual(["d", "c"]);
  });

  it("日付は JST の予定開始の日付で決まる（UTC の日付ではない）", () => {
    // 2027-01-05 00:30 JST は UTC では 01-04。plannedDate は JST の 01-05
    const m = model([plan("early", "2027-01-05T00:30")], "manager", jst("2027-01-05T00:10"));
    expect(m.card).toEqual({ planId: "early", reason: "today" });
  });
});

describe("fieldNextActions", () => {
  const state = (events: Partial<FieldEventLite>[] = [], over: { inspection?: boolean; flightRecords?: { id: string; voided: boolean }[] } = {}): FieldState => {
    let i = 0;
    const evs = events.map(
      (e): FieldEventLite => {
        i += 1;
        return {
          id: `e${i}`,
          clientEventId: `c${i}`,
          kind: "check",
          item: null,
          result: null,
          source: null,
          targetEventId: null,
          flightRecordId: null,
          inspectionId: null,
          reportId: null,
          occurredAt: NOW.toISOString(),
          recordedKey: `k${String(i).padStart(3, "0")}`,
          queued: false,
          gaps: null,
          ...e,
        };
      },
    );
    return fieldState({
      events: evs,
      inspections: over.inspection ? [{ id: "i1", inspectedAt: NOW.toISOString(), date: TODAY, timing: "pre_flight", hasAbnormal: false }] : [],
      flightRecords: over.flightRecords ?? [],
      day: TODAY,
    });
  };
  const input = (s: FieldState, over: Partial<Parameters<typeof fieldNextActions>[0]> = {}): Parameters<typeof fieldNextActions>[0] => ({
    planId: "p1",
    planTitle: "計画",
    plannedStartAt: jst("2027-01-05T13:00"),
    durationMinutes: 60,
    plannedDate: TODAY,
    voided: false,
    now: NOW,
    today: TODAY,
    state: s,
    hasFlightRecord: false,
    can: { record: true, inspect: true, journal: true },
    ...over,
  });
  const ids = (list: TodayNextAction[]) => list.map((a) => a.id);

  it("飛行当日で点検も緊急用務空域の確認も無ければ、日常点検と緊急用務空域の確認が出る（tier 3）", () => {
    const list = fieldNextActions(input(state()));
    expect(ids(list)).toEqual(["do_inspection", "check_emergency_airspace"]);
    for (const a of list) expect(a.tier).toBe(3);
    expect(list[0]!.label).toBe(NEXT_ACTION_LABEL.do_inspection);
    expect(list[0]!.href).toBe("/ops/inspections/new?planId=p1&returnTo=%2Fops%2Fplans%2Fp1%2Ffield%23preflight");
    expect(list[1]!.href).toBe("/ops/plans/p1/field#preflight");
    expect(list[0]!.startsInMinutes).toBe(60);
  });

  it("記録を足すだけで出入りする（点検・確認の行）。取り消せば戻る", () => {
    const withInspection = fieldNextActions(input(state([], { inspection: true })));
    expect(ids(withInspection)).toEqual(["check_emergency_airspace"]);
    const both = fieldNextActions(input(state([{ kind: "check", item: "emergency_airspace", result: "not_designated" }], { inspection: true })));
    expect(both).toEqual([]);
    const undone = fieldNextActions(input(state([{ kind: "check", item: "emergency_airspace", result: "not_designated" }, { kind: "undo", targetEventId: "e1" }], { inspection: true })));
    expect(ids(undone)).toEqual(["check_emergency_airspace"]);
  });

  it("飛行当日でない計画には日常点検・緊急用務空域の項目を出さない。中止した計画にも出さない", () => {
    expect(fieldNextActions(input(state(), { plannedDate: "2027-01-06" }))).toEqual([]);
    expect(fieldNextActions(input(state(), { voided: true }))).toEqual([]);
  });

  it("飛行中の離陸があれば着陸を記録する（tier 1）。中止した計画でも出す", () => {
    const s = state([{ kind: "takeoff" }], { inspection: true });
    const list = fieldNextActions(input(s));
    expect(list.find((a) => a.id === "record_landing")).toMatchObject({ tier: 1, href: "/ops/plans/p1/field#flight", canAct: true });
    expect(ids(fieldNextActions(input(s, { voided: true })))).toEqual(["record_landing"]);
  });

  it("着陸済みで日誌待ちなら日誌を記入する（離陸の ID つきの入力へ）。日誌済みなら出ない。飛行記録の取消で戻る", () => {
    const events: Partial<FieldEventLite>[] = [
      { kind: "takeoff" },
      { kind: "landing", targetEventId: "e1" },
    ];
    const pending = fieldNextActions(input(state(events, { inspection: true })));
    expect(pending.find((a) => a.id === "write_journal")).toMatchObject({ tier: 3, href: "/ops/flights/new?planId=p1&takeoffEventId=e1" });
    const journaled = [...events, { kind: "journal_linked", targetEventId: "e1", flightRecordId: "r1" } as Partial<FieldEventLite>];
    expect(ids(fieldNextActions(input(state(journaled, { inspection: true, flightRecords: [{ id: "r1", voided: false }] }))))).not.toContain("write_journal");
    expect(ids(fieldNextActions(input(state(journaled, { inspection: true, flightRecords: [{ id: "r1", voided: true }] }))))).toContain("write_journal");
    // 中止した計画でも日誌待ちは出る
    // Sprint 14（意図の変更）：着陸のあと飛行後点検が未了なら do_post_inspection も出る（日誌待ちと並ぶ）
    expect(ids(fieldNextActions(input(state(events), { voided: true })))).toEqual(["do_post_inspection", "write_journal"]);
  });

  it("Sprint 14：着陸のあと飛行後点検が未了なら「飛行後点検をする」（現場画面の飛行後点検へ）。済めば消える", () => {
    const events: Partial<FieldEventLite>[] = [{ kind: "takeoff" }, { kind: "landing", targetEventId: "e1" }];
    const a = fieldNextActions(input(state(events, { inspection: true }))).find((x) => x.id === "do_post_inspection");
    expect(a).toMatchObject({ tier: 3, href: "/ops/plans/p1/field#post" });
    // 飛行中は出ない
    expect(ids(fieldNextActions(input(state([{ kind: "takeoff" }], { inspection: true }))))).not.toContain("do_post_inspection");
  });

  it("予定終了から 60 分を過ぎても、飛行記録も離陸の行も無ければ日誌を記入する（境界：ちょうど 60 分後から）", () => {
    // 予定 13:00〜14:00。60 分後は 15:00
    const at = (hm: string) => fieldNextActions(input(state([], { inspection: true }), { now: jst(`2027-01-05T${hm}`), today: TODAY }));
    const has = (hm: string) => ids(at(hm)).includes("write_journal");
    expect(has("14:59")).toBe(false);
    expect(has("15:00")).toBe(true);
    expect(has("15:01")).toBe(true);
    const w = at("15:30").find((a) => a.id === "write_journal")!;
    expect(w.reason).toContain("計画を中止");
    expect(w.href).toBe("/ops/flights/new?planId=p1");
  });

  it("飛行記録がある・離陸の行がある・中止した計画には、飛ばなかった場合の日誌の項目を出さない。取り消した離陸は数えない", () => {
    const late = { now: jst("2027-01-05T16:00") };
    expect(ids(fieldNextActions(input(state([], { inspection: true }), { ...late, hasFlightRecord: true })))).not.toContain("write_journal");
    expect(ids(fieldNextActions(input(state([{ kind: "takeoff" }, { kind: "check", item: "emergency_airspace", result: "done" }], { inspection: true }), late)))).not.toContain("write_journal");
    expect(ids(fieldNextActions(input(state([], { inspection: true }), { ...late, voided: true })))).toEqual([]);
    const undone = state([{ kind: "takeoff" }, { kind: "undo", targetEventId: "e1" }], { inspection: true });
    expect(ids(fieldNextActions(input(undone, late)))).toContain("write_journal");
  });

  it("canAct：操作できない役割・他人の計画は false（リンクにしない）", () => {
    const list = fieldNextActions(input(state(), { can: { record: false, inspect: false, journal: false } }));
    expect(list.map((a) => a.canAct)).toEqual([false, false]);
  });
});

describe("mismatchNextActions（直近 3 日間だけ）", () => {
  const m = (takeoffAt: Date, mismatches = 1) => ({
    flightId: "f1",
    planId: "p1",
    planTitle: "計画",
    takeoffAt,
    now: NOW,
    mismatches: Array.from({ length: mismatches }, () => ({
      code: "report_missing" as const,
      label: "特定飛行ですが、離陸の時点で DIPS の通報の記録がありません。",
      earlyMinutes: 0,
      lateMinutes: 0,
    })),
  });
  it("食い違いが 1 件以上あれば、その飛行記録への項目を出す（tier 4）", () => {
    const [a] = mismatchNextActions([m(jst("2027-01-05T10:00"))]);
    expect(a).toMatchObject({ id: "review_journal_mismatch", tier: 4, href: "/ops/flights/f1", canAct: true, planId: "p1" });
    expect(a!.label).toBe("日誌の食い違いを確認する");
    expect(mismatchNextActions([m(jst("2027-01-05T10:00"), 0)])).toEqual([]);
  });
  it("境界：離陸から 3 日（72 時間）ちょうどまで出る。それより前は出ない", () => {
    expect(mismatchNextActions([m(new Date(NOW.getTime() - 72 * 3600_000))])).toHaveLength(1);
    expect(mismatchNextActions([m(new Date(NOW.getTime() - 72 * 3600_000 - 60_000))])).toHaveLength(0);
  });
});

describe("licenseNextActions（60 日前から・期限切れは tier 3）", () => {
  const l = (expiresOn: string | null) => licenseNextActions([{ pilotId: "pi1", pilotName: "操縦 一郎", expiresOn, today: TODAY, startsInMinutes: 30, canAct: true }]);
  it("期限が未入力なら出さない", () => {
    expect(l(null)).toEqual([]);
  });
  it("境界：60 日後（2027-03-06）は出る（tier 5）。61 日後は出ない", () => {
    expect(l("2027-03-06")).toHaveLength(1);
    expect(l("2027-03-06")[0]).toMatchObject({ id: "renew_license", tier: 5, href: "/ops/pilots/pi1" });
    expect(l("2027-03-07")).toEqual([]);
  });
  it("期限日の当日はまだ有効（tier 5）。翌日から期限切れ（tier 3）", () => {
    expect(l("2027-01-05")[0]!.tier).toBe(5);
    expect(l("2027-01-04")[0]!.tier).toBe(3);
    expect(l("2027-01-04")[0]!.reason).toContain("切れています");
    expect(l("2027-01-06")[0]!.reason).toContain("まで 1 日");
  });
  it("canAct は渡した値", () => {
    expect(licenseNextActions([{ pilotId: "p", pilotName: "x", expiresOn: "2027-01-10", today: TODAY, startsInMinutes: 0, canAct: false }])[0]!.canAct).toBe(false);
  });
});

describe("rankNextActions（複数の計画をまたぐ並び）", () => {
  const a = (id: TodayNextAction["id"], tier: TodayNextAction["tier"], startsInMinutes: number, planId = "p"): TodayNextAction => ({
    id,
    label: NEXT_ACTION_LABEL[id],
    reason: "",
    href: "/x",
    tier,
    dueLabel: null,
    canAct: true,
    startsInMinutes,
    planId,
    planTitle: null,
  });
  it("tier の順、同じなら飛行開始までの時間が短い順。上位 8 件に絞る", () => {
    const list = [a("do_inspection", 3, 600, "x"), a("record_landing", 1, 9999, "y"), a("write_journal", 3, 60, "z"), a("review_journal_mismatch", 4, -100), a("renew_license", 5, 0)];
    expect(rankNextActions(list).map((x) => x.id)).toEqual(["record_landing", "write_journal", "do_inspection", "review_journal_mismatch", "renew_license"]);
    const many = Array.from({ length: 12 }, (_, i) => a("do_inspection", 3, i, `p${i}`));
    expect(rankNextActions(many)).toHaveLength(8);
    expect(rankNextActions(many, 3).map((x) => x.startsInMinutes)).toEqual([0, 1, 2]);
    expect([...list].sort(compareNextActions)[0]!.id).toBe("record_landing");
  });
});

describe("次にやることの表示名（新しい項目）", () => {
  it("動詞で始まる 1 行（動詞で終わる）で、禁止語を含まない", () => {
    for (const id of ["record_landing", "do_inspection", "check_emergency_airspace", "write_journal", "review_journal_mismatch", "renew_license"] as const) {
      const label = NEXT_ACTION_LABEL[id];
      expect(label).not.toContain("\n");
      expect(label).toMatch(/する$/);
    }
    expect(NEXT_ACTION_LABEL.record_landing).toBe("着陸を記録する");
    expect(NEXT_ACTION_LABEL.do_inspection).toBe("日常点検をする");
    expect(NEXT_ACTION_LABEL.check_emergency_airspace).toBe("緊急用務空域を確認する");
    expect(NEXT_ACTION_LABEL.write_journal).toBe("日誌を記入する");
    expect(NEXT_ACTION_LABEL.review_journal_mismatch).toBe("日誌の食い違いを確認する");
    expect(NEXT_ACTION_LABEL.renew_license).toBe("技能証明を更新する");
  });
});
