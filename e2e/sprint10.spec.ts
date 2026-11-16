import { expect, test } from "@playwright/test";

// Sprint 10 契約 2：利用者機能が既定で無効（OPS_ENABLED なし・DB なし）のサーバーでは、運航管理の画面・API がすべて 404。
// 判定画面には運航管理へのリンクを出さない。
test.describe("Sprint 10: 利用者機能が無効のとき", () => {
  test("運航管理の画面と API はすべて 404", async ({ request }) => {
    for (const path of ["/ops", "/ops/aircraft", "/ops/aircraft/new", "/ops/sign-in", "/ops/no-access", "/ops/members", "/ops/about"]) {
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status(), path).toBe(404);
    }
    for (const path of ["/api/ops/me", "/api/ops/aircraft", "/api/auth/get-session", "/api/auth/callback/google", "/api/auth/a/b/c"]) {
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status(), path).toBe(404);
    }
    const signIn = await request.post("/api/test-auth/sign-in", {
      data: { authUserId: "x", email: "x@example.test", emailVerified: true, name: "x" },
    });
    expect(signIn.status()).toBe(404);
    expect(signIn.headers()["set-cookie"]).toBeUndefined();
    expect((await request.post("/api/ops/aircraft", { data: {} })).status()).toBe(404);
    expect((await request.post("/api/auth/sign-in/social", { data: { provider: "google" } })).status()).toBe(404);
  });

  test("判定画面に運航管理へのリンクがない", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "そらばん" })).toBeVisible();
    await expect(page.locator('a[href^="/ops"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: /運航管理/ })).toHaveCount(0);
  });
});
