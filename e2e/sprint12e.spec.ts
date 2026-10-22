import { expect, test } from "@playwright/test";

// Sprint 12e（OPS_ENABLED が無効の側）の E2E。DB なし・OPS_ENABLED なし（通常の E2E の設定）。契約 17 の一部。
// - `/ops/incidents*`・`/ops/plans/[id]/field/incident` の画面と `/api/ops/incidents*`・計画・日誌に結び付いた記録の API は 404（画面・API とも）。
// 運航管理が有効な側（記録・報告の記録・現場の簡易記録・連携）は e2e/ops-db/sprint12e-db.spec.ts。

const ID = "00000000-0000-4000-8000-000000000000";

test.describe("Sprint 12e：運航管理が無効のとき", () => {
  test("`/ops/incidents*` と現場の簡易記録の画面は 404", async ({ page }) => {
    for (const p of ["/ops/incidents", "/ops/incidents/new", `/ops/incidents/${ID}`, `/ops/plans/${ID}/field/incident`]) {
      const ui = await page.goto(p);
      expect(ui?.status(), p).toBe(404);
    }
  });

  test("`/api/ops/incidents*` と `/api/ops/plans/[id]/incidents`・`/api/ops/flights/[id]/incidents` は 404（読み取りも書き込みも）", async ({ request }) => {
    for (const p of ["/api/ops/incidents", `/api/ops/incidents/${ID}`, `/api/ops/incidents/${ID}/versions`, `/api/ops/plans/${ID}/incidents`, `/api/ops/flights/${ID}/incidents`]) {
      expect((await request.get(p)).status(), `GET ${p}`).toBe(404);
    }
    expect((await request.post("/api/ops/incidents", { data: {} })).status()).toBe(404);
    expect((await request.patch(`/api/ops/incidents/${ID}`, { data: {} })).status()).toBe(404);
    expect((await request.post(`/api/ops/incidents/${ID}/void`, { data: {} })).status()).toBe(404);
    expect((await request.post(`/api/ops/incidents/${ID}/reports`, { data: {} })).status()).toBe(404);
  });
});
