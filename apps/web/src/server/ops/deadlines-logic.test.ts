// 近づく期限（ホーム。Sprint 12g-1b §5）。60 日の境界・期限切れ・失効の除外・期限なし（NULL）・件数の上限。
import { describe, expect, it } from "vitest";
import { deadlines, DEADLINE_LIMIT, DEADLINE_WINDOW_DAYS, leftLabelOf, PERMIT_OVERDUE_SHOW_DAYS, type DeadlinePermitInput, type DeadlinePilotInput } from "./deadlines-logic";
import { addDays } from "./today-logic";

const TODAY = "2027-01-05";
const pilot = (id: string, daysFromToday: number | null, o: Partial<DeadlinePilotInput> = {}): DeadlinePilotInput => ({
  id,
  name: `操縦者${id}`,
  licenseExpiresOn: daysFromToday === null ? null : addDays(TODAY, daysFromToday),
  voided: false,
  ...o,
});
const permit = (id: string, daysFromToday: number, o: Partial<DeadlinePermitInput> = {}): DeadlinePermitInput => ({
  id,
  permitNumber: `許可${id}`,
  coverage: "blanket",
  validTo: addDays(TODAY, daysFromToday),
  revokedOn: null,
  status: "active",
  voided: false,
  ...o,
});
const run = (pilots: DeadlinePilotInput[], permits: DeadlinePermitInput[] = [], extra: { windowDays?: number; limit?: number } = {}) =>
  deadlines({ today: TODAY, pilots, permits, ...extra });

describe("近づく期限", () => {
  it("窓は 60 日、上限は 5 件（12c の「技能証明を更新する」の 60 日と揃える）", () => {
    expect(DEADLINE_WINDOW_DAYS).toBe(60);
    expect(DEADLINE_LIMIT).toBe(5);
  });

  it("60 日の境界：60 日後は出す、61 日後は出さない", () => {
    expect(run([pilot("a", 60), pilot("b", 61)]).map((d) => d.id)).toEqual(["a"]);
    expect(run([], [permit("a", 60), permit("b", 61)]).map((d) => d.id)).toEqual(["a"]);
  });

  it("期限日の当日は「今日まで」（まだ有効）。過ぎたものは先頭に並び、「N 日過ぎ」", () => {
    const r = run([pilot("today", 0), pilot("late", -3), pilot("soon", 10)]);
    expect(r.map((d) => [d.id, d.daysLeft, d.leftLabel, d.overdue])).toEqual([
      ["late", -3, "3 日過ぎ", true],
      ["today", 0, "今日まで", false],
      ["soon", 10, "あと 10 日", false],
    ]);
    expect(leftLabelOf(1)).toBe("あと 1 日");
  });

  it("期限が未入力（NULL）の技能証明と、取消済みの操縦者は出さない", () => {
    expect(run([pilot("none", null), pilot("v", 5, { voided: true }), pilot("ok", 5)]).map((d) => d.id)).toEqual(["ok"]);
  });

  it("失効・取消済みの許可・承認は出さない。失効日が期限より前なら、失効日の前日を最終日にする（満了前に失効した登録は status が revoked で除外）", () => {
    const r = run([], [permit("revoked", 5, { status: "revoked", revokedOn: addDays(TODAY, 2) }), permit("voided", 5, { voided: true }), permit("ok", 5)]);
    expect(r.map((d) => d.id)).toEqual(["ok"]);
    // 将来の失効日が入っている有効な登録：最終日は失効日の前日
    const cut = run([], [permit("cut", 40, { revokedOn: addDays(TODAY, 20) })]);
    expect(cut[0]).toMatchObject({ date: addDays(TODAY, 19), daysLeft: 19 });
  });

  it("期限を過ぎた許可・承認は、過ぎてから 30 日までを出す（古い登録が先頭を占めない）", () => {
    const r = run([], [permit("old", -(PERMIT_OVERDUE_SHOW_DAYS + 1)), permit("edge", -PERMIT_OVERDUE_SHOW_DAYS)]);
    expect(r.map((d) => d.id)).toEqual(["edge"]);
  });

  it("技能証明の状態の語は既存の licenseRenewalStatus に合わせる（更新の申請期間・期限を過ぎた・期限切れ）。許可・承認は null", () => {
    const r = run([pilot("window", 50), pilot("deadline", 20), pilot("expired", -1)], [permit("p", 10)]);
    const by = Object.fromEntries(r.map((d) => [d.id, d.licenseStatus]));
    expect(by).toEqual({ window: "renewal_window", deadline: "past_deadline", expired: "expired", p: null });
  });

  it("件数の上限：近い順に 5 件。期限切れが先頭", () => {
    const pilots = [pilot("a", 1), pilot("b", 2), pilot("c", 3), pilot("d", 4), pilot("e", 5), pilot("f", 6), pilot("x", -2)];
    const r = run(pilots);
    expect(r).toHaveLength(5);
    expect(r.map((d) => d.id)).toEqual(["x", "a", "b", "c", "d"]);
    expect(run(pilots, [], { limit: 2 })).toHaveLength(2);
  });

  it("窓と件数は引数（12f が再利用する）", () => {
    expect(run([pilot("a", 100)], [], { windowDays: 120 }).map((d) => d.id)).toEqual(["a"]);
  });

  it("技能証明書の番号を出力に含めない。許可・承認は番号（利用者が登録した値）を対象にする", () => {
    const r = run([pilot("a", 5)], [permit("p", 5)]);
    expect(JSON.stringify(r)).not.toMatch(/license_?number|licenseNumber/i);
    expect(r.find((d) => d.kind === "permit")?.subject).toBe("許可p");
    expect(r.find((d) => d.kind === "license")?.href).toBe("/ops/pilots/a");
    expect(r.find((d) => d.kind === "permit")?.href).toBe("/ops/permits/p");
  });
});
