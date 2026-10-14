import { expect, test, type Page } from "@playwright/test";

// 画面幅 sm 以上ではプリセットがグリッド側に表示される（モバイル用の横スクロール側は hidden）。
const preset = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).first();

const night = (page: Page) => page.getByRole("checkbox", { name: "夜間飛行", exact: true });

const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

test("地点切替 → 条件変更 → 履歴復元 → PDF 出力（空域フラグの持ち越し・無限ループなし）", async ({
  page,
}) => {
  let diagnoseCalls = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/diagnose")) diagnoseCalls += 1;
  });

  await page.goto("/");
  await expect(page.getByTestId("history-item").first()).toBeVisible();

  // 1) 空港プリセット → 空港等周辺がユーザー指定（curated）としてチェックされる
  let diag = waitDiagnose(page);
  await preset(page, "米子鬼太郎空港").click();
  await diag;
  const airport = page.getByTestId("airspace-airspace_airport").locator("input");
  await expect(airport).toBeChecked();
  // 自動検出（空港 red）がある地点でも、診断 → state 更新 → 再診断 のループが起きない
  {
    const n = diagnoseCalls;
    await page.waitForTimeout(3_000);
    expect(diagnoseCalls - n).toBeLessThanOrEqual(1);
  }

  // 2) 別地点（米子市役所）へ切替 → 前地点の空域フラグを持ち越さない
  diag = waitDiagnose(page);
  await preset(page, "米子市役所").click();
  await diag;
  await expect(airport).not.toBeChecked();
  await expect(page.getByTestId("airspace-airspace_did").locator("input")).toBeChecked();

  // 3) 条件変更（夜間飛行）
  diag = waitDiagnose(page);
  await night(page).check();
  await diag;

  // 無限ループしていないこと：アイドル中に /api/diagnose が増え続けない
  const before = diagnoseCalls;
  await page.waitForTimeout(3_000);
  expect(diagnoseCalls - before).toBeLessThanOrEqual(1);

  // 4) 別地点へ移動し、夜間飛行を外す
  diag = waitDiagnose(page);
  await preset(page, "出雲大社").click();
  await diag;
  diag = waitDiagnose(page);
  await night(page).uncheck();
  await diag;
  await expect(night(page)).not.toBeChecked();

  // 5) 履歴から米子市役所＋夜間飛行の実行を復元
  const item = page.getByTestId("history-item").filter({ hasText: "方法×1" }).first();
  await expect(item).toBeVisible();
  diag = waitDiagnose(page);
  await item.locator("button").first().click();
  await diag;
  await expect(night(page)).toBeChecked();
  await expect(airport).not.toBeChecked();

  // 6) PDF 出力
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /PDF 出力/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^soraban-.+\.pdf$/);
});
