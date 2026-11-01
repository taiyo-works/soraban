import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { BOUNDARY_FULL, BOUNDARY_REGISTRATION } from "../../apps/web/src/lib/boundary";
import { DISCLAIMER_INSPECTION, DISCLAIMER_JUDGEMENT, DISCLAIMER_RECORD } from "../../apps/web/src/lib/disclaimers";
import { PROVIDER } from "../../apps/web/src/lib/provider-info";
import { openUserMenu } from "../ops-menu";

// Sprint 18-3 契約（docs/sprints/sprint-18.md §7.3）の E2E-DB：このアプリについて（3-5）、境界の 1 行（3-6）、点検の免責（3-7）、提供元の表記（3-2）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};
const apiAs = async (who: Who): Promise<APIRequestContext> => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await signIn(ctx, who);
  return ctx;
};
const noHorizontalScroll = async (page: Page, label: string): Promise<void> => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `${label}: 横スクロールがある`).toBeLessThanOrEqual(clientWidth);
};
const docHeight = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollHeight);

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test.describe("Sprint 18-3 E2E-DB：このアプリについて・境界の 1 行・点検の免責", () => {
  for (const who of ["a-manager", "a-pilot", "a-viewer"] as const) {
    test(`3-5・3-2：${who} が /ops/about を開ける。提供元の 6 項目・境界の全文・免責の 3 文が定数のとおり出る`, async ({ page }) => {
      await signIn(page.request, seeded(who));
      await page.goto("/ops/about");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("このアプリについて");
      await expect(page).toHaveTitle("このアプリについて — そらばん");
      const prov = page.getByTestId("about-provider");
      for (const v of [PROVIDER.name, PROVIDER.representative, `〒${PROVIDER.postalCode} ${PROVIDER.address}`, PROVIDER.phone, PROVIDER.email, PROVIDER.hours]) await expect(prov, v).toContainText(v);
      expect(await prov.locator("[data-testid^='provider-']").count()).toBe(6);
      // 電話・メールは 48px 以上の tel:・mailto: の行
      for (const [href, v] of [[`tel:${PROVIDER.phone}`, PROVIDER.phone], [`mailto:${PROVIDER.email}`, PROVIDER.email]] as const) {
        const link = prov.locator(`a[href="${href}"]`);
        await expect(link, v).toHaveText(v);
        expect((await link.boundingBox())!.height, v).toBeGreaterThanOrEqual(48);
      }
      // 本文は 16px 以上（不変条件 6）
      for (const id of ["about-provider", "about-boundary", "about-disclaimer-judgement", "about-disclaimer-inspection", "about-disclaimer-record"]) {
        const fs = await page.getByTestId(id).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(fs, id).toBeGreaterThanOrEqual(16);
      }
      await expect(page.getByTestId("about-boundary")).toHaveText(BOUNDARY_FULL);
      const d = page.getByTestId("about-disclaimer");
      await expect(page.getByTestId("about-disclaimer-judgement")).toHaveText(DISCLAIMER_JUDGEMENT);
      await expect(page.getByTestId("about-disclaimer-inspection")).toHaveText(DISCLAIMER_INSPECTION);
      await expect(page.getByTestId("about-disclaimer-record")).toHaveText(DISCLAIMER_RECORD);
      await expect(d).toBeVisible();
      await expect(page.getByTestId("about-version")).toContainText(/soraban-/);
      // ロゴ画像を使っていない（U2）。未確認の項目の語が無い
      expect(await page.locator("main img").count()).toBe(0);
      const main = await page.locator("main").first().innerText();
      for (const w of ["未定", "準備中", "TBD", "要記入", "ダミー", "法人番号", "適格請求書", "平日", "祝日"]) expect(main, w).not.toContain(w);
      await noHorizontalScroll(page, `/ops/about ${who}`);
      // 「登録」が現在地（メニューの親）
      await expect(page.locator('[data-testid="nav-more"]:visible')).toHaveAttribute("aria-current", "page");
    });
  }

  test("3-5：利用者メニューの「このアプリについて」（user-menu-about）と、登録の末尾の行（more-link-about）から 1 回の操作で移れる。押す部品は 48px 以上", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    // 利用者メニューから（ホーム → メニューを開く → 押す = 2 タップ）
    await page.goto("/ops");
    await openUserMenu(page);
    const menuLink = page.getByTestId("user-menu-about");
    await expect(menuLink).toBeVisible();
    expect((await menuLink.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await menuLink.click();
    await page.waitForURL(/\/ops\/about$/);
    await expect(page.getByTestId("about-provider")).toBeVisible();
    // 移動したらメニューは閉じている
    await expect(page.getByTestId("user-menu")).toHaveCount(0);
    // 登録のタブの末尾の行から
    await page.goto("/ops/more");
    const row = page.getByTestId("more-link-about");
    await expect(row).toBeVisible();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await row.click();
    await page.waitForURL(/\/ops\/about$/);
    await expect(page.getByTestId("about-boundary")).toBeVisible();
    // 戻りリンクは「登録」
    await page.getByRole("link", { name: /登録/ }).first().waitFor();
    // 現場モードにはメニューが出ない（入口を足していない）
    // 登録の画面の長さは、入口を足しても 17-2 の上限（登録は短い画面）に収まる
    await page.goto("/ops/more");
    expect(await docHeight(page)).toBeLessThan(1500);
  });

  test("3-6：boundary-registration が機体・操縦者の一覧と通報の作業台にある。通報の主画面（第一画面）には足さない", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const path of ["/ops/aircraft", "/ops/pilots"]) {
      await page.goto(path);
      await expect(page.getByTestId("boundary-registration")).toHaveText(BOUNDARY_REGISTRATION);
      await noHorizontalScroll(page, path);
    }
    const m = await apiAs(seeded("a-manager"));
    const mark = `JUS183B${stamp}`;
    const a = await m.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "S18-3 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
    expect(a.status(), await a.text()).toBe(201);
    const aircraftId = ((await a.json()) as { id: string }).id;
    const pilotId = ((await (await (await apiAs(seeded("a-pilot"))).get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    const p = await m.post("/api/ops/plans", {
      data: { title: `S18-3 ${stamp}`, aircraftId, pilotId, plannedStartAt: "2027-02-10T10:00", durationMinutes: 30, purpose: "空撮", placeName: "試験地点", latitude: 35.44, longitude: 133.35, radiusM: 200, maxAltitudeM: 100, flags: ["method_night"] },
    });
    expect(p.status(), await p.text()).toBe(201);
    const plan = (await p.json()) as { id: string };
    await page.goto(`/ops/plans/${plan.id}/report`);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await expect(page.getByTestId("boundary-registration")).toHaveText(BOUNDARY_REGISTRATION);
    // 主画面には足さない
    await page.goto(`/ops/plans/${plan.id}`);
    await expect(page.locator('[data-testid="plan-tabs"]:visible').first()).toBeVisible();
    await expect(page.getByTestId("boundary-registration")).toHaveCount(0);
    await m.dispose();
  });

  test("3-7：inspection-disclaimer が点検の入力の先頭にあり、文が DISCLAIMER_INSPECTION。操縦者でも出る", async ({ page }) => {
    for (const who of ["a-manager", "a-pilot"]) {
      await signIn(page.request, seeded(who));
      await page.goto("/ops/inspections/new");
      const d = page.getByTestId("inspection-disclaimer");
      await expect(d).toHaveText(DISCLAIMER_INSPECTION);
      // 入力の先頭：フォームより上にある
      const form = page.getByRole("form", { name: /点検/ }).first();
      await expect(form).toBeVisible();
      const dy = (await d.boundingBox())!.y;
      const fy = (await form.boundingBox())!.y;
      expect(dy, who).toBeLessThan(fy);
      // 第一画面（375×812）に入る
      expect(dy + (await d.boundingBox())!.height, who).toBeLessThan(812);
      await noHorizontalScroll(page, `/ops/inspections/new ${who}`);
    }
  });

  test("3-7：現場モードの点検の段（点検がまだのとき）にも inspection-disclaimer が出る。文は DISCLAIMER_INSPECTION", async ({ page }) => {
    const m = await apiAs(seeded("a-manager"));
    const mark = `JUS183F${stamp}`;
    const a = await m.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "S18-3 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
    expect(a.status(), await a.text()).toBe(201);
    const aircraftId = ((await a.json()) as { id: string }).id;
    const pilotId = ((await (await (await apiAs(seeded("a-pilot"))).get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    // サーバーの時計は JST 2027-01-05 12:00。当日の計画を確認依頼して現場モードを開く
    const p = await m.post("/api/ops/plans", {
      data: { title: `S18-3 現場 ${stamp}`, aircraftId, pilotId, plannedStartAt: "2027-01-05T14:00", durationMinutes: 30, purpose: "空撮", placeName: "試験地点", latitude: 35.44, longitude: 133.35, radiusM: 200, maxAltitudeM: 100, flags: ["method_night"] },
    });
    expect(p.status(), await p.text()).toBe(201);
    const plan = (await p.json()) as { id: string; version: number };
    const c = await m.post(`/api/ops/plans/${plan.id}/request-confirmation`, { data: { expectedVersion: plan.version } });
    expect(c.status(), await c.text()).toBe(200);
    await signIn(page.request, seeded("a-manager"));
    await page.goto(`/ops/plans/${plan.id}/field`);
    await expect(page.getByTestId("field-item-inspection")).toBeVisible();
    await expect(page.getByTestId("field-inspection-link")).toBeVisible();
    await expect(page.getByTestId("inspection-disclaimer")).toHaveText(DISCLAIMER_INSPECTION);
    await noHorizontalScroll(page, "現場");
    await m.dispose();
  });
});

