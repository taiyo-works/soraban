import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { VERDICT_HELP } from "../../packages/regulations/src/verdict";
import { gotoPlanOpen } from "./plan-screen";

// Sprint 16-N1（N1-2）の E2E-DB。判定の画面 /ops/plans/[id]/judgement と、過去の判定 /ops/plans/[id]/snapshots/[sid]。
//   判定不能を含む計画（DID の該当を確認できない地点。16-L の unknownPlan と同じ座標）：結論に「飛べ」・VERDICT_HELP の文が 0。
//   判定不能を含まない要手続きの計画（夜間飛行の松江の地点）：今の説明が出る。
const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;
const HELP = VERDICT_HELP.needs_procedure;

type Who = { authUserId: string; email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const apiAs = async (who: Who): Promise<APIRequestContext> => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
  return ctx;
};

type Plan = { id: string; currentSnapshotId: string };
let manager: APIRequestContext;
let unknownPlan: Plan;
let knownPlan: Plan;

test.beforeAll(async () => {
  manager = await apiAs(seeded("a-manager"));
  const mark = `JUN1${stamp}`;
  const a = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "N1 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(a.status(), await a.text()).toBe(201);
  const aircraft = (await a.json()) as { id: string };
  const me = await apiAs(seeded("a-pilot"));
  const pilotId = ((await (await me.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
  await me.dispose();
  const mkPlan = async (extra: object): Promise<Plan> => {
    const p = await manager.post("/api/ops/plans", {
      data: { title: `N1 ${stamp}-${seq++}`, aircraftId: aircraft.id, pilotId, plannedStartAt: "2027-01-10T10:00", durationMinutes: 30, purpose: "空撮", placeName: "試験地点", radiusM: 200, maxAltitudeM: 100, ...extra },
    });
    expect(p.status(), await p.text()).toBe(201);
    return (await p.json()) as Plan;
  };
  unknownPlan = await mkPlan({ latitude: 35.0, longitude: 133.0, flags: [] });
  knownPlan = await mkPlan({ latitude: 35.434238, longitude: 133.380508, flags: ["method_night"] });
});
test.afterAll(async () => {
  await manager.dispose();
});

const signInPage = async (page: import("@playwright/test").Page) => {
  const r = await page.request.post("/api/test-auth/sign-in", { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  expect(r.status()).toBe(200);
};

test.describe("16-N1 判定の画面と過去の判定の説明", () => {
  test("N1-2c. 判定不能を含む計画：/judgement とスナップショットの結論に「飛べ」と VERDICT_HELP の文が 0。判定不能の件数・総合は残る", async ({ page }) => {
    await signInPage(page);
    await gotoPlanOpen(page, `/ops/plans/${unknownPlan.id}/judgement`);
    await expect(page.getByTestId("judgement-total")).toHaveText(/^未確認の項目があります（\d+ 件）$/);
    await expect(page.getByTestId("verdict-unknown-count")).toBeVisible();
    const now = await page.getByTestId("verdict-conclusion").innerText();
    expect(now).not.toContain("飛べ");
    expect(now).not.toContain(HELP);

    await page.goto(`/ops/plans/${unknownPlan.id}/snapshots/${unknownPlan.currentSnapshotId}`);
    await expect(page.getByTestId("verdict-conclusion")).toBeVisible();
    await expect(page.getByTestId("verdict-unknown-count")).toBeVisible();
    const past = await page.getByTestId("verdict-conclusion").innerText();
    expect(past).not.toContain("飛べ");
    expect(past).not.toContain(HELP);
  });

  test("N1-2d. 判定不能を含まない要手続きの計画：/judgement とスナップショットで、今の説明が出る（変えていない）", async ({ page }) => {
    await signInPage(page);
    await gotoPlanOpen(page, `/ops/plans/${knownPlan.id}/judgement`);
    await expect(page.getByTestId("judgement-total")).toBeVisible();
    await expect(page.getByTestId("verdict-unknown-count")).toHaveCount(0);
    await expect(page.getByTestId("judgement-total")).toHaveAttribute("data-total-key", "needs_procedure");
    expect(await page.getByTestId("verdict-conclusion").innerText()).toContain(HELP);

    await page.goto(`/ops/plans/${knownPlan.id}/snapshots/${knownPlan.currentSnapshotId}`);
    await expect(page.getByTestId("verdict-conclusion")).toBeVisible();
    await expect(page.getByTestId("verdict-unknown-count")).toHaveCount(0);
    expect(await page.getByTestId("verdict-conclusion").innerText()).toContain(HELP);
  });
});
