import { expect, test, type Page } from "@playwright/test";
import { contrastRatio, relativeLuminance } from "./field-checks";

// Sprint 12c（OPS_ENABLED が無効の側）の E2E。DB なし・OPS_ENABLED なし（通常の E2E の設定）。
// - 「日誌」「その他」「現場モード」の画面と「今日」「現場」の API は 404（画面・API とも）。
// - `/` に下メニューも「今日」の帯もなく、運航管理に関する追加の要求（/ops・/api/ops への通信）もコンソールのエラーも出ない。
// - 色の比の補助関数（WCAG の式）が既知の値を返す。
// 運航管理が有効な側（今日・下メニュー・日誌・その他・現場モード・送信待ち・見た目の基準）は e2e/ops-db/sprint12c-db.spec.ts。

const PLAN = "00000000-0000-4000-8000-000000000000";
const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

test.describe("Sprint 12c：運航管理が無効のとき", () => {
  test("`/ops/journal`・`/ops/more`・`/ops/plans/[id]/field` と `/api/ops/today`・現場の API は 404", async ({ page, request }) => {
    for (const p of ["/ops/journal", "/ops/more", `/ops/plans/${PLAN}/field`]) {
      const ui = await page.goto(p);
      expect(ui?.status(), p).toBe(404);
    }
    for (const p of ["/api/ops/today", `/api/ops/plans/${PLAN}/field`, `/api/ops/plans/${PLAN}/field-events`]) {
      expect((await request.get(p)).status(), `GET ${p}`).toBe(404);
    }
    expect((await request.post(`/api/ops/plans/${PLAN}/field-events`, { data: {} })).status()).toBe(404);
  });

  test("`/` に下メニューも「今日」の帯もなく、追加の要求もコンソールのエラーもない", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    const check = waitCheck(page);
    const diag = waitDiagnose(page);
    await page.goto("/");
    await Promise.all([check, diag]);
    await expect(page.getByTestId("verdict-level")).toBeVisible();
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(page.getByTestId("home-today-band")).toHaveCount(0);
    await expect(page.getByTestId("home-ops-link")).toHaveCount(0);
    expect(requested.filter((p) => p.startsWith("/ops") || p.startsWith("/api/ops") || p.startsWith("/api/auth"))).toEqual([]);
    expect(failed.filter((f) => !f.includes("favicon"))).toEqual([]);
    expect(consoleErrors.filter((t) => !/cyberjapandata\.gsi\.go\.jp|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(t))).toEqual([]);
  });
});

test.describe("色の比の補助関数（WCAG 2.x の式）", () => {
  test("白と黒は 21:1、同じ色は 1:1、既知の組み合わせの値が合う", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 3);
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 3);
    expect(contrastRatio([119, 119, 119], [119, 119, 119])).toBeCloseTo(1, 5);
    // #767676 と白は WCAG の 4.5:1 の境（約 4.54）
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeGreaterThan(4.5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeLessThan(4.6);
  });
});
