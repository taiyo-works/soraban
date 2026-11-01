import { expect, type Page } from "@playwright/test";

/**
 * 計画の画面（主画面・/overview・/judgement・/journal）を開き、本文が表示されるまで待つ。
 * これらは Suspense でストリーミングされ、描画の直後は本文が `div#S:n[hidden]`（display:none）の中にある。
 * その間は toContainText / toHaveCount(0) が通ってしまい、boundingBox() は null になる。可視のタブが出てから先へ進む。
 * クライアント遷移の後は前の画面の DOM が非表示で残るため、`:visible` で選ぶ。
 */
export const gotoPlan = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await expectPlanScreenReady(page);
};

export const expectPlanScreenReady = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-testid="plan-tabs"]:visible').first()).toBeVisible();
};

const ALL_PLAN_SCREENS = ["", "/overview", "/judgement", "/journal"] as const;

/**
 * 「無いはずの語が無い」のような検査を、元の計画の詳細にあった内容の移動先すべて（主画面・/overview・/judgement・/journal）で回す。
 * Sprint 17-1 で画面を分けたため、1 画面だけの検査では範囲が狭まる。終わったら元の URL に戻る。
 */
export const onAllPlanScreens = async (page: Page, planId: string, check: (label: string) => Promise<void>): Promise<void> => {
  const back = page.url();
  for (const s of ALL_PLAN_SCREENS) {
    await gotoPlan(page, `/ops/plans/${planId}${s}`);
    await check(s === "" ? "通報の主画面" : s);
  }
  await gotoPlan(page, back);
};

/** 表示中のタブ。クライアント遷移の後は前の画面の plan-tabs が display:none で残る（支援技術には出ない）ので、strict な getByTestId の代わりに使う。 */
export const planTabs = (page: Page) => page.locator('[data-testid="plan-tabs"]:visible');
export const planTab = (page: Page, key: string) => page.locator(`[data-testid="plan-tab-${key}"]:visible`);
