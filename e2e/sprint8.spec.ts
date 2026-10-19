import { expect, test } from "@playwright/test";

// Sprint 8: DATABASE_URL 未設定の next start での DB 接続確認 API と、地点判定の縮退動作。
test.describe("Sprint 8: DB なしでの動作", () => {
  test("GET /api/health/db は 200・configured: false", async ({ request }) => {
    const res = await request.get("/api/health/db");
    expect(res.status()).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ configured: false, reachable: false, latencyMs: null });
  });

  test("POST /api/check は DB なしでも判定と証跡 ID を返す", async ({ request }) => {
    const res = await request.post("/api/check", { data: { lat: 35.428, lng: 133.331 } });
    expect(res.status()).toBe(200);
    const json = (await res.json()) as { evidenceId: string; regulations: unknown[] };
    expect(json.evidenceId).toMatch(/^ev_[0-9a-f]{16}$/);
    expect(json.regulations.length).toBeGreaterThan(0);
  });
});
