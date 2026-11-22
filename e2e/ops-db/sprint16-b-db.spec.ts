import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectFontSize, expectNoHorizontalScroll, expectTextZoom } from "../field-checks";

// Sprint 16-B の E2E-DB：文字の下限 14px・本文 16px・rem 化の確かめ（契約 B-1〜B-5、共通条件 K-2・K-4・K-5）。
// 対象：運航管理のホーム・計画の一覧・計画の作成・点検（一覧と入力）・日誌・飛行記録の入力・登録、現場の 1 画面。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する。
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
const SCREENS = [
  { name: "ホーム", path: "/ops", ready: "today-heading", field: false, zoom: true },
  { name: "計画の一覧", path: "/ops/plans", ready: "plan-count", field: false, zoom: true },
  { name: "計画の作成", path: "/ops/plans/new", ready: "main h1", field: false, zoom: false },
  { name: "点検の一覧", path: "/ops/inspections", ready: "main h1", field: false, zoom: true },
  { name: "点検の入力", path: "/ops/inspections/new", ready: "main h1", field: false, zoom: false },
  { name: "日誌", path: "/ops/journal", ready: "main h1", field: false, zoom: true },
  { name: "飛行記録の入力", path: "/ops/flights/new", ready: "main h1", field: false, zoom: false },
  { name: "登録", path: "/ops/more", ready: "main h1", field: false, zoom: false },
  { name: "現場", path: "/ops/plans/{planId}/field", ready: "field-root", field: true, zoom: false },
] as const;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  const me = (await (await pilot.get("/api/ops/me")).json()) as { pilotId: string };
  const mark = `JU16B${stamp}`.slice(0, 20);
  const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "文字の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(ac.status(), await ac.text()).toBe(201);
  const aircraftId = ((await ac.json()) as { id: string }).id;
  const plan = await manager.post("/api/ops/plans", { data: { title: `文字の確認 ${stamp}`, aircraftId, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
  expect(plan.status(), await plan.text()).toBe(201);
  planId = ((await plan.json()) as { id: string }).id;
  await pilot.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T12:00`, kind: "takeoff" } });
  await manager.dispose();
  await pilot.dispose();
});

const open = async (page: Page, s: (typeof SCREENS)[number]): Promise<void> => {
  await page.goto(s.path.replace("{planId}", planId));
  if (s.ready.startsWith("main ")) await expect(page.locator(s.ready).first(), s.name).toBeVisible();
  else await expect(page.getByTestId(s.ready).first(), s.name).toBeVisible();
  if (s.field) await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
};

test.describe("Sprint 16-B E2E-DB：文字の下限（14px）・本文 16px・rem 化・200%・320 幅", () => {
  test("B-1/K-2. 文字はすべて 14px 以上（375・390・1280 幅）。入力欄の値は 16px 以上（現場は 18px 以上）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const w of [375, 390, 1280]) {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 });
      for (const s of SCREENS) {
        await open(page, s);
        await expectFontSize(page, "body", 14, `${s.name} ${w}px`);
        const fields = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea"))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
            })
            .map((el) => ({ id: el.getAttribute("data-testid") ?? el.tagName.toLowerCase(), size: parseFloat(getComputedStyle(el).fontSize) })),
        );
        const min = s.field ? 18 : 16;
        expect(fields.filter((f) => f.size < min).map((f) => `${f.id} ${f.size}px`), `${s.name} ${w}px：${min}px 未満の入力欄`).toEqual([]);
      }
    }
  });

  test("B-4/K-5. 文字 200%（390・430 幅）：ホーム・計画の一覧・点検の一覧・日誌で、横スクロールなし・文字の切れ 0・文字が 2 倍になる・主ボタンに届き下部ナビに隠れない", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const s of SCREENS.filter((x) => x.zoom)) {
      await open(page, s);
      await expectTextZoom(page, s.name);
    }
  });

  test("B-4/K-4. 320 幅で横スクロールがない（全画面）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.setViewportSize({ width: 320, height: 640 });
    for (const s of SCREENS) {
      await open(page, s);
      await expectNoHorizontalScroll(page, `${s.name} 320px`);
    }
  });

  test("B-2. 文字の大きさのトークンは rem：運航管理の画面でも本文 16px・補足 14px（現場は本文 18px）。200% で 2 倍", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const s of [SCREENS[0]!, SCREENS[8]!]) {
      await open(page, s);
      const probe = (): Promise<{ body: number; note: number; rawBody: string }> =>
        page.evaluate(() => {
          const px = (v: string): number => {
            const el = document.createElement("span");
            el.style.fontSize = `var(${v})`;
            document.body.appendChild(el);
            const n = parseFloat(getComputedStyle(el).fontSize);
            el.remove();
            return n;
          };
          return { body: px("--sb-fs-body"), note: px("--sb-fs-note"), rawBody: getComputedStyle(document.documentElement).getPropertyValue("--sb-fs-body").trim() };
        });
      const base = await probe();
      expect(base.rawBody, `${s.name}: --sb-fs-body は rem`).toMatch(/rem$/);
      expect(base.note, `${s.name}: 補足`).toBe(14);
      expect(base.body, `${s.name}: 本文`).toBe(s.field ? 18 : 16);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const zoomed = await probe();
      expect(zoomed.body, `${s.name}: 200% で本文が 2 倍`).toBe(base.body * 2);
      expect(zoomed.note, `${s.name}: 200% で補足が 2 倍`).toBe(base.note * 2);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
  });
});
