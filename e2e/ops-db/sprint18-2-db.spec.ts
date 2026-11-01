import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { gotoPlanOpen } from "./plan-screen";

// Sprint 18-2 の E2E-DB（docs/sprints/sprint-18.md §7.2 の 2-1・2-7・2-8・2-9・2-10）。
// 申請支援のフラグ APPLICATION_SUPPORT_ENABLED は playwright.ops.config.ts が "" で動かす（無効）。フラグ有効の振る舞いは DB テストが守る。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する。サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

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

/** 美保基地の周辺（飛行禁止法の同意・通報の手続きが出る）。 */
const MIHO = { lat: 35.4936, lng: 133.2361 };
type PlanJson = { id: string; version: number; currentSnapshotId: string; nextActions: { id: string; href: string; label: string }[] };

// 契約 2-10：運航管理の画面の本文に出してはいけない語（申請の記録・申請支援・更新の申請）。
const BANNED = ["許可・承認を申請する", "申請済み", "申請の準備", "申請支援", "更新の申請"];
const OLD_OFFICIAL = "申請・通報は DIPS 2.0 などの公式の手続きで行ってください";
const NEW_OFFICIAL = "許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 で行います";

const mainText = (page: Page): Promise<string> => page.locator("main").first().evaluate((el) => el.textContent ?? "");

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 18-2 E2E-DB：運航管理の「申請」に見える機能・文言", () => {
  let manager: APIRequestContext;
  let aircraftId = "";
  let pilotId = "";

  const createPlan = async (extra: object = {}): Promise<PlanJson> => {
    const r = await manager.post("/api/ops/plans", {
      data: {
        title: `S18-2 ${stamp}-${seq++}`,
        aircraftId,
        pilotId,
        plannedStartAt: "2027-02-10T10:00",
        durationMinutes: 30,
        purpose: "空撮",
        placeName: "試験地点",
        latitude: MIHO.lat,
        longitude: MIHO.lng,
        radiusM: 200,
        maxAltitudeM: 100,
        flags: ["method_night"],
        ...extra,
      },
    });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()) as PlanJson;
  };
  const getPlan = async (id: string): Promise<PlanJson> => (await (await manager.get(`/api/ops/plans/${id}`)).json()) as PlanJson;
  const activate = async (p: PlanJson): Promise<PlanJson> => {
    const r = await manager.post(`/api/ops/plans/${p.id}/request-confirmation`, { data: { expectedVersion: p.version } });
    expect(r.status(), await r.text()).toBe(200);
    return getPlan(p.id);
  };

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    const mark = `JUS182${stamp}`;
    const r = await manager.post("/api/ops/aircraft", {
      data: { registrationMark: mark, modelName: "S18-2 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    expect(r.status(), await r.text()).toBe(201);
    aircraftId = ((await r.json()) as { id: string }).id;
    const me = await apiAs(seeded("a-pilot"));
    pilotId = ((await (await me.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await me.dispose();
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  test("2-1・2-8：許可・承認と飛行禁止法の手続きがある計画で、許可・承認の記録のフォームは無く、飛行禁止法の記録は今までどおり。説明文が新しい文", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    const plan = await activate(await createPlan());
    // 判定に許可・承認の手続きがある → apply_permit は出ず、register_permit が出る
    expect(plan.nextActions.map((a) => a.id)).toEqual(expect.arrayContaining(["register_permit", "notify_police"]));
    expect(plan.nextActions.map((a) => a.id)).not.toContain("apply_permit");
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/overview`);
    await expect(page.getByTestId("procedure-form-dips_permit")).toHaveCount(0);
    await expect(page.getByTestId("procedure-dips_permit")).toHaveCount(0);
    await expect(page.getByTestId("procedure-small_drone_law")).toBeVisible();
    await expect(page.getByTestId("procedure-form-small_drone_law")).toBeVisible();
    const text = await mainText(page);
    expect(text).toContain("小型無人機等飛行禁止法の同意・通報を、済んだら記録します。記録は利用者の申告です。");
    expect(text).not.toContain("許可・承認の申請と、小型無人機等飛行禁止法");
    // 飛行禁止法の記録は記録できる
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("procedure-done-at-small_drone_law-date").fill("2027-01-05");
    await page.getByTestId("procedure-done-at-small_drone_law-time").fill("09:00");
    await page.getByTestId("procedure-check-small_drone_law-facilityConsentObtained").check();
    await page.getByTestId("procedure-check-small_drone_law-policeNoticeDone").check();
    await page.getByTestId("procedure-submit-small_drone_law").click();
    await expect(page.getByTestId("procedure-small_drone_law")).toHaveAttribute("data-status", "done");
    // 許可・承認の手続きだけがある計画（美保基地の外）でも、記録の対象は無く、procedure-none の文が新しい文
    const nightOnly = await activate(await createPlan({ latitude: 35.44, longitude: 133.35 }));
    await gotoPlanOpen(page, `/ops/plans/${nightOnly.id}/overview`);
    await expect(page.getByTestId("procedure-none")).toHaveText("この計画の判定には、記録する手続き（小型無人機等飛行禁止法の同意・通報）はありません。");
    await expect(page.getByTestId("procedure-form-dips_permit")).toHaveCount(0);
  });

  test("2-7・2-9：証跡 ID の見出しは「飛行の方法を含む判定の証跡 ID」（値と data-testid は同じ）。公式の手続きの文は 1 つの新しい文", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    const plan = await activate(await createPlan());
    const base = `/ops/plans/${plan.id}`;
    // 判定（/judgement）と判定の根拠（/snapshots/[sid]）と履歴（/snapshots）
    await gotoPlanOpen(page, `${base}/judgement`);
    const evidence = (await page.getByTestId("plan-diagnosis-evidence").innerText()).trim();
    expect(evidence).toMatch(/^ev_/);
    await expect(page.locator("main").first()).toContainText("飛行の方法を含む判定の証跡 ID");
    await page.goto(`${base}/snapshots/${plan.currentSnapshotId}`);
    await expect(page.getByTestId("basis-diagnosis-evidence")).toHaveText(evidence);
    await expect(page.locator("main").first()).toContainText("飛行の方法を含む判定の証跡 ID");
    await page.goto(`${base}/snapshots`);
    await expect(page.locator("main").first()).toContainText(`方法を含む判定 ${evidence}`);
    // 公式の手続きの文：ホームと計画の主画面（today-disclaimer・plan-disclaimer）、計画の新規
    await page.goto("/ops");
    await expect(page.getByTestId("today-disclaimer")).toContainText(NEW_OFFICIAL);
    await expect(page.getByTestId("today-disclaimer")).not.toContainText(OLD_OFFICIAL);
    await gotoPlanOpen(page, base);
    await expect(page.getByTestId("plan-disclaimer")).toContainText(NEW_OFFICIAL);
    await page.goto("/ops/plans/new");
    await expect(page.locator("main").first()).toContainText(NEW_OFFICIAL);
    // 判定の画面の注記
    await gotoPlanOpen(page, `${base}/judgement`);
    await expect(page.getByTestId("plan-permit-applied-note")).toContainText("許可・承認は、利用者本人が DIPS 2.0 で取得します。取得した許可・承認を登録し、計画の許可番号の欄に番号を入れると、範囲に収まるときだけ判定が変わります。");
    await expect(page.getByTestId("plan-permit-applied-note")).not.toContainText("申請済み");
  });

  test("2-10：運航管理の主要画面の main の本文に、申請の記録・申請支援・更新の申請の語が無い。古い公式の手続きの文も無い", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    const plan = await activate(await createPlan());
    const base = `/ops/plans/${plan.id}`;
    const urls = [
      "/ops",
      "/ops/plans",
      "/ops/plans/new",
      base,
      `${base}/overview`,
      `${base}/report`,
      `${base}/judgement`,
      `${base}/journal`,
      `${base}/snapshots`,
      `${base}/snapshots/${plan.currentSnapshotId}`,
      `${base}/edit`,
      "/ops/inspections",
      "/ops/flights",
      "/ops/journal",
      "/ops/incidents",
      "/ops/aircraft",
      "/ops/pilots",
      "/ops/permits",
      "/ops/places",
      "/ops/members",
      "/ops/more",
    ];
    for (const url of urls) {
      await page.goto(url);
      if (url.startsWith(`${base}`) && !url.includes("/snapshots") && !url.endsWith("/edit")) await gotoPlanOpen(page, url);
      const text = await mainText(page);
      expect(text.length, `${url}: 本文がある`).toBeGreaterThan(0);
      for (const w of BANNED) expect(text, `${url}: 「${w}」`).not.toContain(w);
      expect(text, `${url}: 古い公式の手続きの文`).not.toContain(OLD_OFFICIAL);
    }
  });
});
