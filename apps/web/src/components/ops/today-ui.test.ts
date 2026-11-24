import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEADLINE_GUIDE_DISCLAIMER, DEADLINE_PAST_GUIDE_MESSAGE } from "@soraban/dips";
import { HomePrimary, NEXT_ACTIONS_INITIAL, splitDueLabel, TodayEmpty, TodayNextActions } from "./today-ui";
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
  it("M-3（16-G HM-4 で改訂）. 空の日：計画を作れる役割は、アイコン・一文・主ボタン「計画を作る」だけ。作れない役割には「計画を作る」を出さず、「地点を判定する」を主ボタンにする", () => {
    const can = renderToStaticMarkup(createElement(TodayEmpty, { empty, canPlan: true }));
    expect(can).toContain("計画を作る");
    expect(can).not.toContain("地点を判定する");
    expect(can).toContain("<svg");
    expect(can.match(/data-testid="today-empty-action"/g)).toHaveLength(1);
    expect(can.match(/data-variant="primary"/g)).toHaveLength(1);
    const cannot = renderToStaticMarkup(createElement(TodayEmpty, { empty, canPlan: false }));
    expect(cannot).not.toContain("計画を作る");
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

describe("ホームの主ボタン（16-G 差し戻し 1）", () => {
  const html = (a: TodayNextAction | null, cardPlanId: string | undefined) =>
    renderToStaticMarkup(createElement(HomePrimary, { action: a, canPlan: true, ...(cardPlanId !== undefined ? { cardPlanId } : {}) }));

  it("準備カードの計画の行動のときは、計画名の添え書きを出さない", () => {
    const h = html(action(1), "p1");
    expect(h).toContain("作業 1");
    expect(h).toContain('data-testid="home-primary"');
    expect(h).not.toContain("home-primary-plan");
  });
  it("別の計画の行動のときは、主ボタンの下に対象の計画名を 1 行添える（home-primary-plan）", () => {
    const h = html(action(2), "p1");
    expect(h).toContain('data-testid="home-primary-plan"');
    expect(h).toContain("計画 2");
    expect(h.indexOf("home-primary-plan")).toBeGreaterThan(h.indexOf('data-testid="home-primary"'));
  });
  it("計画に結び付かない行動（技能証明など）には添えない。行動が無ければ「新しい計画」", () => {
    expect(html(action(3, { planId: null, planTitle: null }), "p1")).not.toContain("home-primary-plan");
    const h = html(null, "p1");
    expect(h).toContain("新しい計画");
    expect(h).not.toContain("home-primary-plan");
  });
});
