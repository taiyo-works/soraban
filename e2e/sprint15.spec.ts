import { expect, test } from "@playwright/test";

// Sprint 15 契約 A-2（OPS_ENABLED が無効の環境）：/ops は従来どおり 404、Service Worker・マニフェストも 404 で、公開の / に
// Service Worker が登録されず、マニフェストも付かない。公開の / の既存の検査（LCP・11b・判定）は各仕様書がそのまま確かめる。
test.use({ serviceWorkers: "allow" });

test("A-2：運航管理が無効なら /ops・/ops/sw.js・/ops/manifest.webmanifest・圏外用の枠は 404。/ に Service Worker を登録しない", async ({ page, request }) => {
  for (const p of ["/ops", "/ops/sw.js", "/ops/manifest.webmanifest", "/ops/offline/field", "/api/ops/field-bundle"]) {
    expect((await request.get(p)).status(), p).toBe(404);
  }
  await page.goto("/");
  await page.waitForLoadState("load");
  await page.waitForTimeout(1000);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});
