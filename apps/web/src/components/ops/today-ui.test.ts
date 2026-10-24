import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEADLINE_GUIDE_DISCLAIMER, DEADLINE_PAST_GUIDE_MESSAGE } from "@soraban/dips";
import { NEXT_ACTIONS_INITIAL, splitDueLabel, TodayEmpty, TodayNextActions } from "./today-ui";
import type { TodayNextAction } from "@/server/ops/today-logic";

const empty = {
  message: "予定されている飛行計画はありません。",
  actions: [
    { label: "飛行計画を作る", href: "/ops/plans/new" },
    { label: "地点を判定する", href: "/" },
  ],
};

const action = (n: number, extra: Partial<TodayNextAction> = {}): TodayNextAction =>
  ({
    id: "report",
    label: `作業 ${n}`,
    reason: `理由 ${n}（期限 2027-01-20）`,
    href: `/ops/plans/p${n}`,
    tier: 3,
    dueLabel: null,
    canAct: true,
    startsInMinutes: 60,
    planId: `p${n}`,
    planTitle: `計画 ${n}`,
    ...extra,
  }) as TodayNextAction;

describe("ホームの部品（Sprint 12g-1b 差し戻し）", () => {
  it("M-3. 空の日：計画を作れない役割には「飛行計画を作る」を出さず、「地点を判定する」を主ボタンにする", () => {
    const can = renderToStaticMarkup(createElement(TodayEmpty, { empty, canPlan: true }));
    expect(can).toContain("飛行計画を作る");
    expect(can).toContain("地点を判定する");
    const cannot = renderToStaticMarkup(createElement(TodayEmpty, { empty, canPlan: false }));
    expect(cannot).not.toContain("飛行計画を作る");
    expect(cannot).toContain("地点を判定する");
    expect(cannot.match(/data-testid="today-empty-action"/g)).toHaveLength(1);
  });

  it("M-5. 期限の文：状態と社内の目安の注記を 2 行に分ける（文言は変えない）。注記で終わらない文はそのまま", () => {
    const due = `${DEADLINE_PAST_GUIDE_MESSAGE} ${DEADLINE_GUIDE_DISCLAIMER}`;
    expect(splitDueLabel(due)).toEqual({ head: DEADLINE_PAST_GUIDE_MESSAGE, note: DEADLINE_GUIDE_DISCLAIMER });
    expect(splitDueLabel("目安まであと 21 時間")).toEqual({ head: "目安まであと 21 時間", note: null });
    expect(splitDueLabel(DEADLINE_GUIDE_DISCLAIMER)).toEqual({ head: DEADLINE_GUIDE_DISCLAIMER, note: null });
  });

  it("M-2. 次にやること：3 件以下は開閉なし。4 件以上は最初の 3 件だけ見え、残りは「ほか N 件を見る」（aria-expanded=false・hidden）", () => {
    expect(NEXT_ACTIONS_INITIAL).toBe(3);
    const three = renderToStaticMarkup(createElement(TodayNextActions, { actions: [1, 2, 3].map((n) => action(n)), total: 3, today: "2027-01-05" }));
    expect(three).not.toContain("today-next-more-toggle");
    const six = renderToStaticMarkup(createElement(TodayNextActions, { actions: [1, 2, 3, 4, 5, 6].map((n) => action(n)), total: 6, today: "2027-01-05" }));
    expect(six.match(/data-testid="today-next-action"/g)).toHaveLength(6);
    expect(six).toContain('aria-expanded="false"');
    expect(six).toContain("ほか 3 件を見る");
    expect(six).toMatch(/<ul[^>]*hidden[^>]*data-testid="today-next-more-list"|<ul[^>]*data-testid="today-next-more-list"[^>]*hidden/);
    // 総数の表示は残る。日付は読みやすい形
    expect(six).toContain("6 件");
    expect(six).toContain("1/20（水）");
    expect(six).not.toContain("2027-01-20");
  });
});
