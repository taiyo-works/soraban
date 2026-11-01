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

/** gotoPlan のあと、畳んだ中身（PLAN_FOLDS）を読む・押す検査のために明示的に開く。既定の見え方を試験する検査は gotoPlan を使う。 */
export const gotoPlanOpen = async (page: Page, url: string): Promise<void> => {
  await gotoPlan(page, url);
  await openPlanFolds(page);
};

/**
 * Sprint 17-2：計画の画面は、長さを詰めるため一部を折りたたんでいる（次にやることの「ほか N 件」・手続きの記録・判定の記録・
 * 許可番号の形式・中止のフォーム）。既存の検査は折りたたまれた中の部品を読む・押すので、開く操作をここで行う（期待値は変えない）。
 * gotoPlan は開かない（既定の見え方を試験する）。畳んだ中身を読む検査は gotoPlanOpen を使う。
 */
export const PLAN_FOLDS = ["next-actions-more", "plan-procedures-details", "plan-judgement-details", "plan-permit-format-details", "plan-void-details", "plan-stale-sources-details"] as const;
export const openFolds = async (page: Page, testIds: readonly string[]): Promise<void> => {
  await page.evaluate((ids) => {
    for (const id of ids) for (const el of document.querySelectorAll(`details[data-testid="${id}"]`)) (el as HTMLDetailsElement).open = true;
  }, testIds);
};
export const openPlanFolds = (page: Page): Promise<void> => openFolds(page, PLAN_FOLDS);


/** 通報の作業台（/report）の折りたたみ（状況の詳細・固定の文言の全文・過去の記録・監査・項目の対応表）を開く。 */
export const REPORT_FOLDS = ["report-status-details", "report-history-older", "report-audit-details", "report-map-details", "report-row-details"] as const;
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
    await gotoPlanOpen(page, `/ops/plans/${planId}${s}`);
    await expectNoForbiddenTextContent(page, s === "" ? "通報の主画面" : s);
    await check(s === "" ? "通報の主画面" : s);
  }
  await gotoPlanOpen(page, back);
};

/** 表示中のタブ。クライアント遷移の後は前の画面の plan-tabs が display:none で残る（支援技術には出ない）ので、strict な getByTestId の代わりに使う。 */
export const planTabs = (page: Page) => page.locator('[data-testid="plan-tabs"]:visible');
export const planTab = (page: Page, key: string) => page.locator(`[data-testid="plan-tab-${key}"]:visible`);

/** 禁止語の走査は、畳んだ中（display:none・閉じた details）も含む textContent でも行う（innerText は畳みの中を読まない）。 */
export const FORBIDDEN_WORDS = ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて", "問題なし", "大丈夫", "完璧", "代行", "保証", "必ず", "代理"];
export const expectNoForbiddenTextContent = async (page: Page, label: string): Promise<void> => {
  const text = await page.locator("main").first().evaluate((el) => el.textContent ?? "");
  for (const w of FORBIDDEN_WORDS) expect(text, `${label}: textContent に「${w}」`).not.toContain(w);
  expect(text, `${label}: textContent に OK`).not.toMatch(/\bOK\b/);
};
