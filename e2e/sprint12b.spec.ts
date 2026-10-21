import { expect, test, type Page } from "@playwright/test";

// Sprint 12b 契約 14・20（OPS_ENABLED が無効の側）の E2E。DB なし・OPS_ENABLED なし・DIPS_REPORT_ADAPTER なし（通常の E2E の設定）。
// - `/ops/plans/[id]/report`・`/api/ops/plans/[id]/reports` などの通報の画面・API は 404。DIPS への通信も、通報に関する追加の要求も出ない。
// - `/` は 12a のまま（運航管理のリンクも、通報に関する表示もない）。
// 運航管理が有効な側（通報の画面・手動と模擬の記録・次にやること・手続きの記録）は e2e/ops-db/sprint12b-db.spec.ts。

const PLAN = "00000000-0000-4000-8000-000000000000";
const REPORT = "11111111-1111-4111-8111-111111111111";

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

test.describe("Sprint 12b：運航管理が無効のとき", () => {
  test("通報の画面と API は 404（画面・API とも）。通報の要求は DIPS にも他にも出ない", async ({ page, request }) => {
    const ui = await page.goto(`/ops/plans/${PLAN}/report`);
    expect(ui?.status()).toBe(404);
    expect((await request.get(`/ops/plans/${PLAN}/report?kind=cancel`)).status()).toBe(404);

    for (const p of [
      `/api/ops/plans/${PLAN}/report`,
      `/api/ops/plans/${PLAN}/reports`,
      `/api/ops/plans/${PLAN}/reports/${REPORT}`,
      `/api/ops/plans/${PLAN}/reports/${REPORT}/versions`,
      `/api/ops/plans/${PLAN}/procedure-records`,
    ]) {
      expect((await request.get(p)).status(), `GET ${p}`).toBe(404);
    }
    for (const p of [
      `/api/ops/plans/${PLAN}/report`,
      `/api/ops/plans/${PLAN}/reports`,
      `/api/ops/plans/${PLAN}/reports/audit`,
      `/api/ops/plans/${PLAN}/reports/${REPORT}/retract`,
      `/api/ops/plans/${PLAN}/reports/${REPORT}/resolve`,
      `/api/ops/plans/${PLAN}/reports/${REPORT}/retry`,
      `/api/ops/plans/${PLAN}/procedure-records`,
    ]) {
      expect((await request.post(p, { data: {} })).status(), `POST ${p}`).toBe(404);
    }
    expect((await request.patch(`/api/ops/plans/${PLAN}/reports/${REPORT}`, { data: {} })).status()).toBe(404);
  });

  test("`/` は 12a のまま：運航管理のリンクも通報に関する表示もなく、通報・DIPS への追加の要求も出ない", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(`${new URL(r.url()).host}${new URL(r.url()).pathname}`));
    const check = waitCheck(page);
    const diag = waitDiagnose(page);
    await page.goto("/");
    await Promise.all([check, diag]);
    await expect(page.getByTestId("verdict-level")).toBeVisible();
    await expect(page.getByTestId("create-plan-from-verdict")).toHaveCount(0);
    await expect(page.getByTestId("home-ops-link")).toHaveCount(0);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/通報の記録|次にやること|手続きの記録/);
    expect(text).not.toMatch(/特許|出願/);
    expect(requested.filter((p) => /\/ops|\/api\/ops|dips|mlit\.go\.jp/i.test(p))).toEqual([]);
  });
});
