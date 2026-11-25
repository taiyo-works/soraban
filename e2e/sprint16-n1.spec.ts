import { expect, test, type Page } from "@playwright/test";
import { VERDICT_HELP } from "../packages/regulations/src/verdict";

// Sprint 16-N1（docs/sprints/sprint-16.md「16-N1」N1-2）の E2E。公開の `/` だけ。DB なし。
//   判定不能を含む地点では、結論のカードに「手続きを済ませれば飛べます。…」の説明を出さない（Q-L29）。
//   判定不能を含まない要手続きの地点では、今の説明が出る（変えていないことの確認）。
// 地点の選び方：sprint11d の 10 で、美保基地の周辺（境港市）は史跡が未収録で判定不能が出る（判定不能の件数の行が出る）。
//   QUIET（35.38, 133.35）はどの規制にも当たらず、夜間飛行を選ぶと判定不能 0 の要手続きになる（sprint11d の 9）。

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());
const settled = async (page: Page): Promise<void> => {
  await expect(page.getByTestId("verdict-summary")).not.toHaveAttribute("data-level", "pending");
};
const openReady = async (page: Page): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto("/");
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
  await settled(page);
};

const HELP = VERDICT_HELP.needs_procedure;

test.describe("16-N1 公開の / の結論の説明", () => {
  test("N1-2a. 判定不能を含む地点（美保基地の周辺）：結論に「飛べ」と VERDICT_HELP の文が 0。総合・判定不能の件数の行は残る", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page);
    const check = waitCheck(page);
    const diag = waitDiagnose(page);
    await page.getByRole("button", { name: /美保基地の周辺（境港市）/ }).filter({ visible: true }).first().click();
    await Promise.all([check, diag]);
    await settled(page);
    await expect(page.getByTestId("verdict-unknown-count")).toContainText(/判定不能 \d+ 件（データ未整備）/);
    await expect(page.getByTestId("judgement-total")).toHaveText(/^未確認の項目があります（\d+ 件）$/);
    const text = await page.getByTestId("verdict-conclusion").innerText();
    expect(text).not.toContain("飛べ");
    expect(text).not.toContain(HELP);
    expect(text).not.toContain("手続きを済ませれば");
  });

  test("N1-2b. 判定不能を含まない要手続きの地点（夜間飛行）：今の説明が出る", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page);
    await page.getByPlaceholder("35.4278", { exact: true }).fill("35.38");
    await page.getByPlaceholder("133.3314", { exact: true }).fill("133.35");
    let check = waitCheck(page);
    let diag = waitDiagnose(page);
    await page.getByRole("button", { name: /この地点を判定する/ }).click();
    await Promise.all([check, diag]);
    await settled(page);
    check = waitCheck(page);
    diag = waitDiagnose(page);
    await page
      .locator("fieldset", { hasText: "飛行の方法（選ぶと判定に反映します）" })
      .getByRole("checkbox", { name: "夜間飛行", exact: true })
      .check();
    await Promise.all([check, diag]);
    await settled(page);
    await expect(page.getByTestId("verdict-level")).toHaveText("要手続き");
    await expect(page.getByTestId("verdict-unknown-count")).toHaveCount(0);
    expect(await page.getByTestId("verdict-conclusion").innerText()).toContain(HELP);
  });
});
