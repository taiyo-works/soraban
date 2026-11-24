import { expect, test } from "@playwright/test";

// Sprint 12g 段階 1a の E2E-DB：デザイン見本（/ops/design）は、運航管理の認証・DB・機能フラグに関わらず表示され（DESIGN_CATALOG=1 のとき）、
// 運航管理の既存の画面の見た目は変わらない。
// - 3300（AUTH_PROVIDER=test）と 3301（neon、localhost）は DESIGN_CATALOG=1。3302（模擬アダプターの 2 台目）は未設定 → 404。
// - 待つ対象のレスポンスは無い（画面の表示の確認だけ）。waitForResponse は使わない。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const NEON = `http://localhost:${process.env["E2E_OPS_NEON_PORT"] ?? 3301}`;
const NO_FLAG = `http://127.0.0.1:${process.env["E2E_OPS_MOCK_ADAPTER_PORT"] ?? 3302}`;

test.describe("Sprint 12g 1a E2E-DB：デザイン見本と運航管理の既存の画面", () => {
  test("1. 未ログインでも見本が表示される（サインイン画面に移らない）。運航管理の枠・ヘッダー・下メニューがなく、運航管理の API・認証を呼ばない", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (p.startsWith("/api/")) calls.push(p);
    });
    const res = await page.goto(`${BASE}/ops/design`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(`${BASE}/ops/design`);
    await expect(page.getByTestId("design-catalog")).toBeVisible();
    await expect(page.getByTestId("ops-header")).toHaveCount(0);
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(page.locator(".max-w-4xl")).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  test("2. Neon Auth の方式でも、未ログインで見本が表示される。ほかの /ops は従来どおりサインイン画面へ", async ({ page }) => {
    const res = await page.goto(`${NEON}/ops/design`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(`${NEON}/ops/design`);
    await expect(page.getByTestId("design-catalog")).toBeVisible();
    await page.goto(`${NEON}/ops/aircraft`);
    await expect(page).toHaveURL(/\/ops\/sign-in/);
  });

  test("3. DESIGN_CATALOG が 1 でないサーバーでは、運航管理が有効でも 404（画面もヘッダーも出さない）", async ({ page }) => {
    const res = await page.goto(`${NO_FLAG}/ops/design`);
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("design-catalog")).toHaveCount(0);
    await expect(page.getByTestId("ops-header")).toHaveCount(0);
  });

  test("4. ログイン済みの運航管理の画面は、v2 のトークン（.ds.ops-v2）で描かれ、PC は左メニューと右上の利用者メニュー、スマホは下の 5 タブ。公開の判定画面 `/` は .ds を使わない", async ({ page }) => {
    const r = await page.request.post(`${BASE}/api/test-auth/sign-in`, {
      data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" },
    });
    expect(r.status()).toBe(200);
    await page.emulateMedia({ colorScheme: "light" });
    for (const path of ["/ops", "/ops/more", "/ops/plans", "/ops/journal"]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${BASE}${path}`);
      await expect(page.getByTestId("ops-root")).toBeVisible();
      await expect(page.getByTestId("ops-sidebar")).toBeVisible();
      await expect(page.getByTestId("ops-header")).toBeVisible();
      await expect(page.getByTestId("ops-bottom-nav")).toBeHidden();
      await expect(page.locator(".ds").first()).toBeVisible();
      // 本文の列は最大 1024px（左メニューの右に 1 本）
      const box = await page.locator(".max-w-5xl").first().boundingBox();
      expect(Math.round(box?.width ?? 0), path).toBeLessThanOrEqual(1024);
      expect(Math.round(box?.width ?? 0), path).toBeGreaterThan(900);
      const v = await page.evaluate(() => {
        const b = getComputedStyle(document.body);
        const h = getComputedStyle(document.querySelector('[data-testid="ops-header"]')!);
        return { bg: b.backgroundColor, fg: b.color, headerBorder: h.borderBottomWidth, grid: b.backgroundImage };
      });
      // v2 のトークン（明）：地は --sb-base（#F6F7F9。Sprint 16-A で白から変更）、字は --sb-ink（墨 #14181F）。旧い紙の色・方眼は出ない
      expect(v.bg, path).toBe("rgb(246, 247, 249)");
      expect(v.fg, path).toBe("rgb(20, 24, 31)");
      expect(v.grid, path).toBe("none");
      expect(v.headerBorder, path).toBe("1px");
    }
    // 1024px 未満は下の 4 タブ（左メニューは出ない。16-F）
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/ops`);
    await expect(page.getByTestId("ops-bottom-nav")).toBeVisible();
    await expect(page.getByTestId("ops-bottom-nav").locator("a")).toHaveCount(4);
    // 4 つの順序と名前（Sprint 16-F：ホーム／計画／日誌／機体と書類。判定も点検も下タブにない）
    expect((await page.getByTestId("ops-bottom-nav").locator("a").allInnerTexts()).map((t) => t.trim())).toEqual(["ホーム", "計画", "日誌", "機体と書類"]);
    await expect(page.getByTestId("ops-sidebar")).toBeHidden();
    // 公開の判定画面 `/` は .ds を使わず、v2 のトークン（地は --sb-base＝#F6F7F9。Sprint 16-A で白から変更）で描く（下メニューの部品だけが自前の .ds を持つ）
    await page.goto(`${BASE}/`);
    await expect(page.getByTestId("site-ops-note")).toBeVisible();
    await expect(page.locator(".ds:not([data-testid='ops-bottom-nav'])")).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(246, 247, 249)");
    // while signed in, the catalog still has no ops chrome and does not look the user up
    await page.goto(`${BASE}/ops/design`);
    await expect(page.getByTestId("design-catalog")).toBeVisible();
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(page.getByTestId("ops-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("ops-header")).toHaveCount(0);
    await expect(page.getByTestId("ops-root")).toHaveCount(0);
    // and the body class that adds room for the bottom menu is not left behind
    await expect(page.locator("body.has-bottom-nav")).toHaveCount(0);
  });
});
