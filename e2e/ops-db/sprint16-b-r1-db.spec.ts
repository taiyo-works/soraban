import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectFontSize, expectTextZoom } from "../field-checks";
import { gotoPlan, openPlanFolds, openReportFolds } from "./plan-screen";

// Sprint 16-B 差し戻し 1 の E2E-DB（契約 R1-3〜R1-5）：本文 16px・行の高さ 1.7、補足 14px・1.5（data-note）と、文字 200% の 11 画面。
// 元の e2e/ops-db/sprint16-b-db.spec.ts は serial（1 件の失敗で後続が飛ぶ）なので、落ちてよい新しい検査は別のファイルにして、互いに独立にした。
// 工程①（検査の追加）の時点では、新しい検査が落ちてよい。落ちた一覧が designer の作業の一覧になる。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
const DAY = "2027-01-05";

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};

let planId = "";
type Screen = { readonly name: string; readonly path: string; readonly ready: string; readonly field: boolean; readonly plan?: true; readonly report?: true; readonly zoom: boolean };
// R1-4 の 13 画面（sprint16-b-db の 9 画面に、計画の主画面・計画の概要・判定・通報の作業台を足したもの）。zoom は R1-5 の 11 画面のうち運航管理の 10 画面。
const SCREENS: readonly Screen[] = [
  { name: "ホーム", path: "/ops", ready: "today-heading", field: false, zoom: true },
  { name: "計画の一覧", path: "/ops/plans", ready: "plan-count", field: false, zoom: true },
  { name: "計画の作成", path: "/ops/plans/new", ready: "main h1", field: false, zoom: true },
  { name: "点検の一覧", path: "/ops/inspections", ready: "main h1", field: false, zoom: true },
  { name: "点検の入力", path: "/ops/inspections/new", ready: "main h1", field: false, zoom: true },
  { name: "日誌", path: "/ops/journal", ready: "main h1", field: false, zoom: true },
  { name: "飛行記録の入力", path: "/ops/flights/new", ready: "main h1", field: false, zoom: true },
  { name: "登録", path: "/ops/more", ready: "main h1", field: false, zoom: false },
  { name: "現場", path: "/ops/plans/{planId}/field", ready: "field-root", field: true, zoom: false },
  { name: "計画の主画面", path: "/ops/plans/{planId}", ready: "plan-tabs", field: false, plan: true, zoom: false },
  { name: "計画の概要", path: "/ops/plans/{planId}/overview", ready: "plan-tabs", field: false, plan: true, zoom: true },
  { name: "判定", path: "/ops/plans/{planId}/judgement", ready: "plan-tabs", field: false, plan: true, zoom: true },
  { name: "通報の作業台", path: "/ops/plans/{planId}/report", ready: "report-screen", field: false, report: true, zoom: true },
];

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  const me = (await (await pilot.get("/api/ops/me")).json()) as { pilotId: string };
  const mark = `JU16R${stamp}`.slice(0, 20);
  const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "文字の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(ac.status(), await ac.text()).toBe(201);
  const aircraftId = ((await ac.json()) as { id: string }).id;
  const plan = await manager.post("/api/ops/plans", { data: { title: `本文の確認 ${stamp}`, aircraftId, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
  expect(plan.status(), await plan.text()).toBe(201);
  planId = ((await plan.json()) as { id: string }).id;
  await pilot.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T12:00`, kind: "takeoff" } });
  await manager.dispose();
  await pilot.dispose();
});

/** 画面を開く。計画の画面は gotoPlan（Suspense のストリーミングが終わるまで待つ。runbook）。 */
const open = async (page: Page, s: Screen): Promise<void> => {
  const url = s.path.replace("{planId}", planId);
  if (s.plan) {
    await gotoPlan(page, url);
    return;
  }
  await page.goto(url);
  if (s.ready.startsWith("main ")) await expect(page.locator(s.ready).first(), s.name).toBeVisible();
  else await expect(page.getByTestId(s.ready).first(), s.name).toBeVisible();
  if (s.field) await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
  if (s.report) await openReportFolds(page);
};

test.describe("Sprint 16-B 差し戻し 1 E2E-DB：本文 16px・行の高さ 1.7、補足 14px・1.5（data-note）", () => {
  for (const s of SCREENS) {
    for (const w of [375, 390, 1280]) {
      test(`R1-3/R1-4. ${s.name} ${w}px：印のない p・li・dd は ${s.field ? 18 : 16}px・1.7 以上、data-note は 14px・1.5 以上。data-note の置き場所が正しい`, async ({ page }) => {
        await signIn(page.request, seeded("a-manager"));
        await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 });
        await open(page, s);
        // 畳んだ中身（計画の画面）は、既定の見え方の検査のあと、開いた状態でも検査する
        await expectFontSize(page, "body", 14, `${s.name} ${w}px`, { body: s.field ? 18 : 16 });
        if (s.plan) {
          await openPlanFolds(page);
          await expectFontSize(page, "body", 14, `${s.name}（畳みを開いた状態）${w}px`, { body: 16 });
        }
      });
    }
  }
});

test.describe("Sprint 16-B 差し戻し 1 E2E-DB：文字 200%（R1-5。運航管理の追加分）", () => {
  // 11 画面のうち、sprint16-b-db の B-4 にない 6 画面（計画の作成・点検の入力・飛行記録の入力・判定・通報の作業台・計画の概要）。
  // ホーム・計画の一覧・点検の一覧・日誌は sprint16-b-db の B-4、`/` は sprint16-b の B-4。
  const ADDED = ["計画の作成", "点検の入力", "飛行記録の入力", "判定", "通報の作業台", "計画の概要"];
  for (const name of ADDED) {
    test(`R1-5/K-5. ${name}：文字 200%（390・430 幅）で、横スクロールなし・文字の切れ 0・文字が 2 倍になる・主ボタンに届き下部ナビに隠れない`, async ({ page }) => {
      const s = SCREENS.find((x) => x.name === name)!;
      expect(s.zoom, `${name} は R1-5 の対象`).toBe(true);
      await signIn(page.request, seeded("a-manager"));
      await open(page, s);
      await expectTextZoom(page, s.name);
    });
  }

  test("R1-5. 通報の作業台：目的の選択肢（report-input-purpose-*）が見える状態で 200% を測る", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await open(page, SCREENS.find((x) => x.name === "通報の作業台")!);
    const boxes = page.locator('[data-testid^="report-input-purpose-"]');
    await expect(boxes.first(), "目的の選択肢が画面にある").toBeAttached();
    expect(await boxes.count(), "目的の選択肢の数").toBeGreaterThan(5);
    await boxes.first().scrollIntoViewIfNeeded();
    await expectTextZoom(page, "通報の作業台（目的の選択肢を含む）");
  });
});
