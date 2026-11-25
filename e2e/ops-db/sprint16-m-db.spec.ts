import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { gotoPlanOpen } from "./plan-screen";

// Sprint 16-M 修正 1 の E2E-DB（レビュー N-2、§17 の 25）。
//   スナップショットの画面（過去の判定）は、結論のカードに状態の帯を付けない（判定不能と同じ灰）。
//   同じ判定をいまの判定の画面（/judgement）で見ると帯が付く。5 段の札・data-testid は変わらない。
const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const DAY = "2027-01-05";
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

type Who = { authUserId: string; email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const apiAs = async (who: Who): Promise<APIRequestContext> => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
  return ctx;
};

test.describe("Sprint 16-M 修正 1：過去の判定に帯を付けない（N-2）", () => {
  test("N-2. スナップショットの画面の結論のカードは帯なし。いまの判定の画面は帯あり。札の data-testid は同じ", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const mark = `JUS16M${stamp}${seq++}`;
    const ar = await manager.post("/api/ops/aircraft", {
      data: { registrationMark: mark, modelName: "帯試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    expect(ar.status(), await ar.text()).toBe(201);
    const aircraft = (await ar.json()) as { id: string };
    const pilotCtx = await apiAs(seeded("a-pilot"));
    const me = (await (await pilotCtx.get("/api/ops/me")).json()) as { pilotId: string };
    await pilotCtx.dispose();
    const pr = await manager.post("/api/ops/plans", {
      data: {
        title: `帯 ${stamp}-${seq++}`, aircraftId: aircraft.id, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60,
        purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: ["method_night"],
      },
    });
    expect(pr.status(), await pr.text()).toBe(201);
    const plan = (await pr.json()) as { id: string; currentSnapshotId: string };

    await page.request.post("/api/test-auth/sign-in", { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
    await page.clock.setFixedTime(new Date(`${DAY}T12:00:10+09:00`));

    // いまの判定の画面：帯あり
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);
    const now = page.getByTestId("verdict-conclusion");
    await expect(now).toHaveClass(/sb-card-state/);
    await expect(now).toHaveAttribute("data-state", /^(safe|warn|danger|info)$/);

    // 過去の判定（スナップショット）：帯なし。5 段の札と語は変わらない
    await page.goto(`/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`);
    const past = page.getByTestId("verdict-conclusion");
    await expect(past).toBeVisible();
    await expect(past).not.toHaveClass(/sb-card-state/);
    await expect(past).not.toHaveAttribute("data-state", /.+/);
    await expect(past.getByTestId("verdict-level")).toBeVisible();
    const band = await past.evaluate((e) => getComputedStyle(e, "::before").content);
    expect(band === "none" || band === "normal").toBe(true);
    await manager.dispose();
  });
});
