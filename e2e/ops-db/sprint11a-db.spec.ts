import { expect, test, type Page } from "@playwright/test";

// Sprint 11a の E2E-DB（契約 22）：技能証明の有効期限の注意表示。
// playwright.ops.config.ts（DB・AUTH_PROVIDER=test・OPS_ENABLED=1）で実行する。テスト用の初期データ（a-manager）を前提にする。
// 新しい個人情報の項目は足さない（既存の任意項目「技能証明の有効期限」だけを使う）。

const pad = (n: number) => String(n).padStart(2, "0");
/** 日本時間の今日から months か月後の日付（YYYY-MM-DD）。 */
const jstPlusMonths = (months: number): string => {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(y, m, Math.min(jst.getUTCDate(), last)));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const signInManager = async (page: Page): Promise<void> => {
  const r = await page.request.post("/api/test-auth/sign-in", {
    data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" },
  });
  expect(r.status()).toBe(200);
};

test.describe.configure({ mode: "serial" });

test.describe("Sprint 11a E2E-DB：技能証明の有効期限の注意", () => {
  test("22. 有効期限が 3 か月後の操縦者は一覧と詳細に「更新の申請期間」が出て、未入力の操縦者には出ない", async ({
    page,
  }) => {
    await signInManager(page);
    const stamp = Date.now().toString(36).toUpperCase();
    const soonName = `期限 近太郎${stamp}`;
    const noneName = `期限 未入力${stamp}`;
    const create = async (data: Record<string, unknown>) => {
      const r = await page.request.post("/api/ops/pilots", { data });
      expect(r.status()).toBe(201);
      return (await r.json()) as { id: string };
    };
    const soon = await create({
      fullName: soonName,
      hasLicense: true,
      licenseClass: "second",
      licenseNumber: `S11A-${stamp}`.slice(0, 30),
      licenseExpiresOn: jstPlusMonths(3),
    });
    const none = await create({ fullName: noneName, hasLicense: false });

    await page.goto("/ops/pilots");
    const soonRow = page.getByTestId("pilot-list").locator("li", { hasText: soonName });
    await expect(soonRow.getByTestId("license-renewal-status")).toContainText("更新の申請期間");
    const noneRow = page.getByTestId("pilot-list").locator("li", { hasText: noneName });
    await expect(noneRow).toBeVisible();
    await expect(noneRow.getByTestId("license-renewal-status")).toHaveCount(0);

    await page.goto(`/ops/pilots/${soon.id}`);
    await expect(page.getByTestId("pilot-detail").getByTestId("license-renewal-status")).toContainText("更新の申請期間");
    await expect(page.getByRole("link", { name: /更新の手続き/ })).toHaveAttribute(
      "href",
      "https://www.mlit.go.jp/koku/level4/license/",
    );

    await page.goto(`/ops/pilots/${none.id}`);
    await expect(page.getByTestId("pilot-detail")).toBeVisible();
    await expect(page.getByTestId("license-renewal-status")).toHaveCount(0);
  });
});
