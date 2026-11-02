import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { openReportFolds } from "./plan-screen";

// Sprint 19-1c の E2E-DB（C1-6）：通報の作業台の「API 形式（参考）」に多角形の GeoJSON が出る。範囲が 2 つ以上の計画は準備を止める。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start（手動アダプター）に対して実行する。DIPS へは何も送らない。
// ROUTE_GUIDE（手動の経路の案内）は変えない。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

const signIn = async (ctx: APIRequestContext, key: string): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  expect(r.status()).toBe(200);
};

const TRI = [
  [133.349, 35.439],
  [133.351, 35.439],
  [133.35, 35.441],
];

test.use({ viewport: { width: 375, height: 812 } });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 19-1c E2E-DB：多角形の通報の整形", () => {
  let manager: APIRequestContext;
  let aircraftId = "";
  let pilotId = "";

  test.beforeAll(async () => {
    manager = await pwRequest.newContext({ baseURL: BASE });
    await signIn(manager, "a-manager");
    const mark = `JUS19C${stamp}${seq++}`;
    const a = await manager.post("/api/ops/aircraft", {
      data: { registrationMark: mark, modelName: "通報試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    expect(a.status(), await a.text()).toBe(201);
    aircraftId = ((await a.json()) as { id: string }).id;
    const pilotCtx = await pwRequest.newContext({ baseURL: BASE });
    await signIn(pilotCtx, "a-pilot");
    pilotId = ((await (await pilotCtx.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await pilotCtx.dispose();
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const body = (areas: object[], title: string) => ({
    title: `${title} ${stamp}-${seq++}`,
    aircraftId,
    pilotId,
    plannedStartAt: "2027-01-10T10:00",
    durationMinutes: 30,
    purpose: "空撮",
    placeName: "試験地点",
    maxAltitudeM: 100,
    flags: ["method_night"],
    areas,
  });
  const create = async (b: object): Promise<{ id: string }> => {
    const r = await manager.post("/api/ops/plans", { data: b });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()) as { id: string };
  };
  const openReport = async (page: Page, planId: string) => {
    await page.route("**/_next/**", (route) => route.continue());
    await signIn(page.request, "a-manager");
    await page.goto(`/ops/plans/${planId}/report`);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await openReportFolds(page);
  };

  test("C1-6. 多角形 1 つ：作業台の経路は「多角形・頂点 3」で、API 形式（参考）に Polygon の GeoJSON（開いた環）。経路の案内は手動のまま", async ({ page }) => {
    const plan = await create(body([{ kind: "polygon", vertices: TRI }], "多角形の通報"));
    await openReport(page, plan.id);
    await expect(page.getByTestId("report-item-value-route")).toHaveText("多角形・頂点 3");
    await expect(page.getByTestId("report-route-guide")).toHaveText("経路は DIPS の地図で描いてください（コピーできません）。下の座標を目安にしてください。");
    await expect(page.getByTestId("report-copy-route")).toHaveCount(0);
    const text = (await page.getByTestId("report-route-geojson").textContent()) ?? "";
    const g = JSON.parse(text);
    expect(g.type).toBe("FeatureCollection");
    expect(g.features).toHaveLength(1);
    expect(g.features[0].properties).toEqual({});
    expect(g.features[0].geometry).toEqual({ type: "Polygon", coordinates: [TRI] });
    // 範囲の警告（複数・頂点数）は出ない
    await expect(page.getByTestId("report-item-warnings-route")).toHaveCount(0);
    const scroll = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(scroll.s).toBeLessThanOrEqual(scroll.c);
  });

  test("円 1 つ：従来どおり Circle（半径は properties）。出力は変わらない", async ({ page }) => {
    const plan = await create(body([{ kind: "circle", center: [133.35, 35.44], radiusM: 150 }], "円の通報"));
    await openReport(page, plan.id);
    const text = (await page.getByTestId("report-route-geojson").textContent()) ?? "";
    expect(text).toBe('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"radius":150},"geometry":{"type":"Circle","center":[133.35,35.44]}}]}');
  });

  test("範囲が 2 つ：通報の準備を止める（API は 409 route_multiple_areas）。1 つ目だけの GeoJSON を返さない", async () => {
    const plan = await create(
      body([{ kind: "polygon", vertices: TRI }, { kind: "circle", center: [133.352, 35.44], radiusM: 50 }], "複数の通報"),
    );
    const r = await manager.get(`/api/ops/plans/${plan.id}/report`);
    expect(r.status()).toBe(409);
    const text = await r.text();
    expect(text).toContain("route_multiple_areas");
    expect(text).toContain("DIPS に出す範囲は 1 つです");
    expect(text).not.toContain("Polygon");
    expect(text).not.toContain("FeatureCollection");
  });
});
