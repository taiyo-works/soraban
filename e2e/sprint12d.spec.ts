import { expect, test, type Page } from "@playwright/test";

// Sprint 12d（OPS_ENABLED が無効の側）の E2E。DB なし・OPS_ENABLED なし（通常の E2E の設定）。
// - `/ops/permits*` の画面と `/api/ops/permits*`・`/api/ops/plans/[id]/permits` の API は 404（画面・API とも）。
// - 判定画面 `/` は変わらない：DIPS の許可・承認を「持っている／いない」で入力でき、運航管理への通信もコンソールのエラーも出ない。
// 運航管理が有効な側（登録・照合・根拠の辿り）は e2e/ops-db/sprint12d-db.spec.ts（G2 が追加する）。

const ID = "00000000-0000-4000-8000-000000000000";
const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

test.describe("Sprint 12d：運航管理が無効のとき", () => {
  test("`/ops/permits*` の画面は 404", async ({ page }) => {
    for (const p of ["/ops/permits", "/ops/permits/new", `/ops/permits/${ID}`, `/ops/plans/${ID}/permits`]) {
      const ui = await page.goto(p);
      expect(ui?.status(), p).toBe(404);
    }
  });

  test("`/api/ops/permits*` と `/api/ops/plans/[id]/permits` は 404（読み取りも書き込みも）", async ({ request }) => {
    for (const p of ["/api/ops/permits", `/api/ops/permits/${ID}`, `/api/ops/permits/${ID}/versions`, `/api/ops/plans/${ID}/permits`]) {
      expect((await request.get(p)).status(), `GET ${p}`).toBe(404);
    }
    expect((await request.post("/api/ops/permits", { data: {} })).status()).toBe(404);
    expect((await request.patch(`/api/ops/permits/${ID}`, { data: {} })).status()).toBe(404);
    expect((await request.post(`/api/ops/permits/${ID}/revoke`, { data: {} })).status()).toBe(404);
    expect((await request.post(`/api/ops/permits/${ID}/void`, { data: {} })).status()).toBe(404);
    expect((await request.delete(`/api/ops/permits/${ID}`)).status()).toBe(404);
  });

  test("`/` は変わらない：DIPS の許可を持っている／いないで入力でき、範囲を照合していない旨の注記が出る。運航管理への通信はない", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    const check = waitCheck(page);
    const diag = waitDiagnose(page);
    await page.goto("/");
    await Promise.all([check, diag]);
    await expect(page.getByTestId("verdict-level")).toBeVisible();
    // 機体・運航条件（折りたたみ）を開くと、DIPS の許可・承認を種類ごとに「持っている」と入力できる（範囲は照合しない。12c までと同じ）
    const details = page.locator("details", { hasText: "機体・運航条件" });
    if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
    await expect(details.getByRole("checkbox", { name: "国交省 DIPS：DID 上空の飛行許可" })).toBeVisible();
    await expect(details.getByRole("checkbox", { name: "国交省 DIPS：夜間飛行の承認" })).toBeVisible();
    expect(requested.filter((p) => p.startsWith("/ops") || p.startsWith("/api/ops") || p.startsWith("/api/auth"))).toEqual([]);
    expect(consoleErrors.filter((t) => !/cyberjapandata\.gsi\.go\.jp|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(t))).toEqual([]);
  });
});
