import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expectStep, fillStep, tapNext } from "./plan-wizard";

// Sprint 16-N2（N2-3）撮影：旧い層の撤去の前後で、同じ画面を同じ条件で撮り、差を比べる。通常の実行では動かない
// （環境変数 N2_SHOTS_DIR を与えたときだけ。例：N2_SHOTS_DIR=docs/evaluations/screenshots/sprint-16N2/before）。
// 出す画面：公開の `/`、ホーム、計画作成の ①〜⑤・保存後の計画の画面、点検の入力、日誌、現場（離陸前）、利用者メニュー、ログアウトの確認。
// 375×812 と 1280×800、ページ全体。サーバーの時計は OPS_TEST_NOW（JST 2027-01-05 12:00）。ブラウザの時計は page.clock で固定する。
const OUT = process.env.N2_SHOTS_DIR ?? "";
const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
// 計算されたスタイルの一覧（要素ごと）も書き出す（N2_STYLES_DIR。撮影の絵と別に、画素に出ない差も比べるため。コミットしない）。
const STYLES = process.env.N2_STYLES_DIR ?? "";
const PROPS = [
  "color", "background-color", "background-image", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-bottom-style",
  "outline-color", "outline-width", "outline-style", "outline-offset", "box-shadow", "border-radius", "opacity", "color-scheme",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-decoration-line", "text-wrap-mode", "text-wrap-style",
  "word-break", "line-break", "overflow-wrap", "font-feature-settings", "font-variant-numeric", "text-rendering", "-webkit-font-smoothing",
  "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "width", "height", "min-height", "display", "position", "gap", "transition-duration", "animation-name", "animation-duration", "text-transform", "fill", "stroke",
] as const;
const SIZES = [
  { w: 375, h: 812 },
  { w: 1280, h: 800 },
] as const;

test.skip(!OUT, "N2_SHOTS_DIR を与えたときだけ撮影する");
test.describe.configure({ mode: "serial" });

const stamp = "N2SHOT";
let planId = "";
let aircraftId = "";
let pilotId = "";

test.beforeAll(async () => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  expect(r.status()).toBe(200);
  const a = await ctx.post("/api/ops/aircraft", {
    data: { registrationMark: `JU${stamp}`, modelName: "撮影用機", manufacturer: "DJI", serialNumber: `SN-${stamp}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(a.status(), await a.text()).toBe(201);
  aircraftId = ((await a.json()) as { id: string }).id;
  const p = await ctx.post("/api/ops/pilots", { data: { fullName: `撮影 操縦${stamp}`, hasLicense: false } });
  expect(p.status(), await p.text()).toBe(201);
  pilotId = ((await p.json()) as { id: string }).id;
  const pl = await ctx.post("/api/ops/plans", {
    data: { title: `撮影 ${stamp}`, aircraftId, pilotId, plannedStartAt: "2027-01-05T13:00", durationMinutes: 60, purpose: "撮影の空撮", placeName: "撮影地点", latitude: 35.434238, longitude: 133.380508, flags: [] },
  });
  expect(pl.status(), await pl.text()).toBe(201);
  planId = ((await pl.json()) as { id: string }).id;
  await ctx.dispose();
});

const signIn = async (page: Page): Promise<void> => {
  const r = await page.request.post("/api/test-auth/sign-in", { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  expect(r.status()).toBe(200);
};
const settle = async (page: Page): Promise<void> => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(400);
};
const dumpStyles = async (page: Page, name: string): Promise<void> => {
  if (!STYLES) return;
  mkdirSync(STYLES, { recursive: true });
  const rows = await page.evaluate((props) => {
    const out: string[] = [];
    const walk = (el: Element, path: string): void => {
      const cs = getComputedStyle(el);
      const id = el.getAttribute("data-testid");
      const here = `${path}>${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}`;
      out.push(`${here} ${props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";")}`);
      let i = 0;
      for (const c of Array.from(el.children)) walk(c, `${here}#${i++}`);
    };
    walk(document.body, "");
    return out;
  }, PROPS as unknown as string[]);
  writeFileSync(path.join(STYLES, `${name}-${page.viewportSize()!.width}.txt`), rows.join("\n"));
};
const shot = async (page: Page, name: string): Promise<void> => {
  await settle(page);
  await dumpStyles(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}-${page.viewportSize()!.width}.png`), fullPage: true, animations: "disabled", caret: "hide" });
};

for (const size of SIZES) {
  test.describe(`${size.w}×${size.h}`, () => {
    test.use({ viewport: { width: size.w, height: size.h } });
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date("2027-01-05T11:56:00+09:00"));
      // 外部の地図タイルは取りに行かない（取得の成否で絵が揺れないように）
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    });

    test("公開の /", async ({ page }) => {
      await page.goto("/");
      await shot(page, "pub-top");
    });

    test("ホーム・計画の一覧・日誌・点検の入力・登録・このアプリについて", async ({ page }) => {
      await signIn(page);
      for (const [name, url] of [
        ["ops-home", "/ops"],
        ["ops-plans", "/ops/plans"],
        ["ops-journal", "/ops/journal"],
        ["ops-inspections", "/ops/inspections"],
        ["ops-inspection-new", "/ops/inspections/new"],
        ["ops-flights", "/ops/flights"],
        ["ops-more", "/ops/more"],
        ["ops-about", "/ops/about"],
        ["ops-aircraft", "/ops/aircraft"],
        ["ops-incidents", "/ops/incidents"],
      ] as const) {
        await page.goto(url);
        await shot(page, name);
      }
    });

    test("計画作成 ①〜⑤ と、保存後の計画の画面・判定・現場", async ({ page }) => {
      await signIn(page);
      await page.goto("/ops/plans/new");
      await expectStep(page, 1);
      await shot(page, "wiz-1");
      await fillStep(page, 1, { placeName: "撮影地点", lat: "35.434238", lng: "133.380508", radius: "200" });
      await tapNext(page);
      await shot(page, "wiz-2");
      await fillStep(page, 2, { date: "2027-01-05", time: "13:00", duration: "60" });
      await tapNext(page);
      await shot(page, "wiz-3");
      await fillStep(page, 3, { title: "撮影の計画", purpose: "撮影の空撮" });
      await tapNext(page);
      await shot(page, "wiz-4");
      await fillStep(page, 4, { aircraftId, pilotId });
      await tapNext(page);
      await shot(page, "wiz-5");

      await page.goto(`/ops/plans/${planId}`);
      await shot(page, "plan-main");
      await page.goto(`/ops/plans/${planId}/judgement`);
      await shot(page, "plan-judgement");
      await page.goto(`/ops/plans/${planId}/field`);
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      await shot(page, "field-before");
    });

    test("利用者メニューとログアウトの確認", async ({ page }) => {
      await signIn(page);
      await page.goto("/ops");
      await settle(page);
      const btn = page.getByTestId("user-menu-button").first();
      if (await btn.isVisible()) {
        await btn.click();
        await expect(page.getByTestId("user-menu")).toBeVisible();
        await shot(page, "user-menu");
        const info = page.getByRole("button", { name: "説明：役割でできること" });
        await info.click();
        await expect(page.getByTestId("user-menu").getByRole("note")).toBeVisible();
        await shot(page, "user-menu-info");
        await info.click();
        const signout = page.getByTestId("signout");
        if (await signout.isVisible()) {
          // 送信待ちが無いので確認は出ず、そのままログアウトされる。ボタンの見た目だけを撮る
          await signout.scrollIntoViewIfNeeded();
          await shot(page, "user-menu-signout");
        }
      }
    });
  });
}
