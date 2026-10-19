import { expect, test } from "@playwright/test";

// Sprint 11 契約 21：利用者機能が既定で無効（OPS_ENABLED なし・DB なし）のサーバーでは、飛行記録・日常点検の画面・API がすべて 404。
test.describe("Sprint 11: 利用者機能が無効のとき", () => {
  test("飛行記録・日常点検の画面と API はすべて 404", async ({ request }) => {
    for (const path of [
      "/ops/flights",
      "/ops/flights/new",
      "/ops/flights/00000000-0000-4000-8000-000000000000",
      "/ops/inspections",
      "/ops/inspections/new",
    ]) {
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status(), path).toBe(404);
    }
    for (const path of ["/api/ops/flights", "/api/ops/inspections", "/api/ops/flights/00000000-0000-4000-8000-000000000000/versions"]) {
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status(), path).toBe(404);
    }
    expect((await request.post("/api/ops/flights", { data: {} })).status()).toBe(404);
    expect((await request.post("/api/ops/inspections", { data: {} })).status()).toBe(404);
    expect((await request.delete("/api/ops/flights/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  });
});
