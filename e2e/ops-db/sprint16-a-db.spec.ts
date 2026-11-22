import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { expectColorsInTokenSet } from "../color-set";
import { collectTextSamples, expectNoHorizontalScroll } from "../field-checks";

// Sprint 16-A の E2E-DB：トークンを空色の主色・新しい地に替えたことの確かめ（契約 A-7、共通条件 K-3・K-13・K-14。K-15 は、この PR の差分に端末ストレージの呼び出しが無いことを git diff の走査で確かめる）。
// 対象：運航管理のホーム・計画の一覧・点検（一覧と入力）・日誌・登録、現場の 1 画面。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する。
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
  { name: "ホーム", path: "/ops", ready: "today-heading", field: false },
  { name: "計画の一覧", path: "/ops/plans", ready: "plan-count", field: false },
  { name: "点検の一覧", path: "/ops/inspections", ready: "main h1", field: false },
  { name: "点検の入力", path: "/ops/inspections/new", ready: "main h1", field: false },
  { name: "日誌", path: "/ops/journal", ready: "main h1", field: false },
  { name: "登録", path: "/ops/more", ready: "main h1", field: false },
  { name: "現場", path: "/ops/plans/{planId}/field", ready: "field-root", field: true },
] as const;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  const me = (await (await pilot.get("/api/ops/me")).json()) as { pilotId: string };
  const mark = `JU16A${stamp}`.slice(0, 20);
  const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "色の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(ac.status(), await ac.text()).toBe(201);
  const aircraftId = ((await ac.json()) as { id: string }).id;
  const plan = await manager.post("/api/ops/plans", { data: { title: `色の確認 ${stamp}`, aircraftId, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
  expect(plan.status(), await plan.text()).toBe(201);
  planId = ((await plan.json()) as { id: string }).id;
  await pilot.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T12:00`, kind: "takeoff" } });
  await manager.dispose();
  await pilot.dispose();
});

const open = async (page: import("@playwright/test").Page, s: (typeof SCREENS)[number]): Promise<void> => {
  await page.goto(s.path.replace("{planId}", planId));
  if (s.ready.startsWith("main ")) await expect(page.locator(s.ready).first(), s.name).toBeVisible();
  else await expect(page.getByTestId(s.ready).first(), s.name).toBeVisible();
  if (s.field) await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
};

test.describe("Sprint 16-A E2E-DB：新しいトークン（主色・地）が運航管理の画面に効いている", () => {
  test("K-13. 要素の色がトークンの集合に入る（橙・旧い藍が無い）。現場は現場の値で", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const s of SCREENS) {
      await open(page, s);
      await expectColorsInTokenSet(page, "body", s.name);
    }
  });

  test("K-3. 文字は 4.5:1 以上（現場は 7:1 以上）。横スクロールなし。地は #F6F7F9", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const s of SCREENS) {
      await open(page, s);
      const min = s.field ? 7 : 4.5;
      const samples = await collectTextSamples(page, "body");
      expect(samples.length, s.name).toBeGreaterThan(0);
      const bad = samples.filter((t) => !t.disabled && !/^0\d$/.test(t.text) && t.ratio < min).map((t) => `${t.testId ?? t.tag}「${t.text}」 ${t.ratio.toFixed(2)}:1`);
      expect(bad, `${s.name}: 比が ${min} 未満`).toEqual([]);
      await expectNoHorizontalScroll(page, s.name);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), `${s.name}: 地`).toBe("rgb(246, 247, 249)");
    }
  });

  test("K-14. OS が暗でも明で描かれる。主ボタンの面は主色（現場は濃い主色）で、白い文字の比が 4.5 以上（現場 7）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.emulateMedia({ colorScheme: "dark" });
    for (const s of SCREENS) {
      await open(page, s);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), `${s.name}: 地`).toBe("rgb(246, 247, 249)");
      // 無効から有効へ変わる間は背景が遷移する。落ち着いてから確かめる
      const faces = () => page.locator(".opx-btn-primary, .sb-pill-primary").evaluateAll((els) => els.filter((e) => !e.matches(":disabled") && e.getAttribute("aria-disabled") !== "true").map((e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color })));
      const want = s.field ? "rgb(24, 72, 176)" : "rgb(31, 95, 224)";
      await expect.poll(async () => (await faces()).every((f) => f.bg === want && f.fg === "rgb(255, 255, 255)"), { timeout: 10_000, message: `${s.name}: 主ボタンの面は ${want}、文字は白` }).toBe(true);
    }
  });
});
