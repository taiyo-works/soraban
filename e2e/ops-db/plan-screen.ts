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
  await openPlanFolds(page);
};

/**
 * Sprint 17-2：計画の画面は、長さを詰めるため一部を折りたたんでいる（次にやることの「ほか N 件」・手続きの記録・判定の記録・
 * 許可番号の形式・中止のフォーム）。既存の検査は折りたたまれた中の部品を読む・押すので、開く操作をここで行う（期待値は変えない）。
 * 折りたたみを試験する検査（sprint17-2-db.spec.ts）は gotoPlan の代わりに gotoPlanFolded を使う。
 */
export const PLAN_FOLDS = ["next-actions-more", "plan-procedures-details", "plan-judgement-details", "plan-permit-format-details", "plan-void-details", "plan-stale-sources-details"] as const;
export const openFolds = async (page: Page, testIds: readonly string[]): Promise<void> => {
  await page.evaluate((ids) => {
    for (const id of ids) for (const el of document.querySelectorAll(`details[data-testid="${id}"]`)) (el as HTMLDetailsElement).open = true;
  }, testIds);
};
export const openPlanFolds = (page: Page): Promise<void> => openFolds(page, PLAN_FOLDS);

/** 折りたたんだままで開く（折りたたみそのものを試験する検査用）。 */
export const gotoPlanFolded = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await expectPlanScreenReady(page);
};

/** 通報の作業台（/report）の折りたたみ（状況の詳細・固定の文言の全文・過去の記録・監査・項目の対応表）を開く。 */
export const REPORT_FOLDS = ["report-status-details", "report-history-older", "report-audit-details", "report-map-details"] as const;
export const openReportFolds = (page: Page): Promise<void> => openFolds(page, REPORT_FOLDS);

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
