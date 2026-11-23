import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectFields, expectNoHorizontalScroll, expectTextZoom, waitForSettledStyles } from "../field-checks";
import { gotoPlan, openReportFolds } from "./plan-screen";

// Sprint 16-D の E2E-DB：部品 2 の実画面（契約 D-1・D-2・D-4、K-15）。見本の上の検査は e2e/sprint16-d.spec.ts。
// 入力欄：運航管理の全部の入力フォーム（登録・計画・点検・飛行記録・許可・事故・通報）で、見えるラベルが入力欄の上にある・高さ 52 以上・角丸 12・エラーの関連付け。
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
let aircraftId = "";
let flightId = "";
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  const me = (await (await pilot.get("/api/ops/me")).json()) as { pilotId: string };
  const mark = `JU16D${stamp}`.slice(0, 20);
  const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "部品の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(ac.status(), await ac.text()).toBe(201);
  aircraftId = ((await ac.json()) as { id: string }).id;
  const plan = await manager.post("/api/ops/plans", { data: { title: `入力欄の確認 ${stamp}`, aircraftId, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
  expect(plan.status(), await plan.text()).toBe(201);
  planId = ((await plan.json()) as { id: string }).id;
  // 同じ操縦者の飛行記録は時間帯が重ならないようにする（繰り返し実行で 409 overlap にならないよう、日を乱数で選ぶ）
  const fday = new Date(Date.UTC(2026, 0, 1) + (Number.parseInt(randomUUID().slice(0, 6), 16) % 330) * 86_400_000).toISOString().slice(0, 10);
  const fl = await manager.post("/api/ops/flights", { data: { aircraftId, pilotId: me.pilotId, purpose: "空撮", takeoffPlace: "米子市日吉津 本社", landingPlace: "米子市日吉津 本社", safetyIssue: false, takeoffAt: `${fday}T09:00`, landingAt: `${fday}T09:25` } });
  expect(fl.status(), await fl.text()).toBe(201);
  flightId = ((await fl.json()) as { id: string }).id;
  await pilot.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T12:00`, kind: "takeoff" } });
  await manager.dispose();
  await pilot.dispose();
});

const FORMS = [
  { name: "計画の作成", path: "/ops/plans/new" },
  { name: "点検の入力", path: "/ops/inspections/new" },
  { name: "飛行記録の入力", path: "/ops/flights/new" },
  { name: "機体の登録", path: "/ops/aircraft/new" },
  { name: "操縦者の登録", path: "/ops/pilots/new" },
  { name: "場所の登録", path: "/ops/places/new" },
  { name: "許可・承認の登録", path: "/ops/permits/new" },
  { name: "事故・重大インシデントの記録", path: "/ops/incidents/new" },
  { name: "飛行記録の一覧（絞り込み）", path: "/ops/flights" },
  { name: "利用者", path: "/ops/members" },
  { name: "計画の訂正", path: "/ops/plans/{planId}/edit" },
  { name: "通報の作業台", path: "/ops/plans/{planId}/report", plan: true, folds: true },
  { name: "計画の概要", path: "/ops/plans/{planId}/overview", plan: true },
] as const;

test.describe("D-1 実画面：全入力欄に見えるラベル（上）・高さ 52 以上・角丸 12", () => {
  for (const f of FORMS) {
    test(`${f.name}（390 幅）`, async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      const url = f.path.replace("{planId}", planId);
      if ("plan" in f) await gotoPlan(page, url);
      else await page.goto(url);
      if ("folds" in f) await openReportFolds(page);
      await expect(page.locator("main h1").first()).toBeVisible();
      await waitForSettledStyles(page);
      await expectFields(page, "main", f.name, { minCount: 1 });
      await expectNoHorizontalScroll(page, f.name);
    });
  }
});

const errorHostOf = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[aria-invalid="true"]'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        // フォーカス中の入力欄は主色の枠が優先（D-1）。色を測るのはフォーカスのない入力欄
        const focused = document.activeElement === el;
        const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        const t = ids.map((id) => document.getElementById(id)).find((x) => x && (x.textContent ?? "").trim().length > 0 && x.classList.contains("sb-field-error"));
        return { name: el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.tagName, role: t?.getAttribute("role") ?? null, svg: t?.querySelectorAll("svg").length ?? 0, text: (t?.textContent ?? "").trim().slice(0, 30), bc: focused ? "rgb(180, 35, 24)" : getComputedStyle(el).borderTopColor, below: !!t && t.getBoundingClientRect().top >= el.getBoundingClientRect().top };
      }),
  );

test.describe("D-1 実画面：エラーは縁が危険の印の色・下に記号付きの 1 行・aria-describedby で結ぶ・role は alert にしない", () => {
  test("機体の登録：必須が空のまま保存すると、項目ごとのエラーが出る", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/aircraft/new");
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.locator("main form button[type=submit]").first().click();
    await expect(page.locator('main [aria-invalid="true"]').first()).toBeVisible();
    await waitForSettledStyles(page);
    const hosts = await errorHostOf(page);
    expect(hosts.length).toBeGreaterThanOrEqual(2);
    for (const h of hosts) {
      expect(h.role, h.name).toBeNull();
      expect(h.svg, h.name).toBe(1);
      expect(h.text.length, h.name).toBeGreaterThan(0);
      expect(h.bc, h.name).toBe("rgb(180, 35, 24)");
      expect(h.below, h.name).toBe(true);
    }
    const r = await expectFields(page, "main", "機体の登録（エラー）");
    expect(r.invalid).toBeGreaterThanOrEqual(2);
    // 送信の結果は 1 つのまとまった alert（FormError）か、項目ごとのエラーだけ。項目ごとのエラーは alert を重ねない
    expect(await page.locator("main .sb-field-error[role=alert]").count()).toBe(0);
  });

  test("許可・承認の登録：必須が空のまま保存すると、項目ごとのエラーが出る", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/permits/new");
    await expect(page.getByTestId("permit-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("permit-submit").click();
    await expect(page.locator('main [aria-invalid="true"]').first()).toBeVisible();
    await waitForSettledStyles(page);
    const r = await expectFields(page, "main", "許可・承認の登録（エラー）");
    expect(r.invalid).toBeGreaterThanOrEqual(1);
    expect(await page.locator("main .sb-field-error[role=alert]").count()).toBe(0);
  });

  test("点検の入力：異常にして備考なしで保存すると、その項目の備考に誤りが示される", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto(`/ops/inspections/new?aircraftId=${aircraftId}`);
    const form = page.getByRole("form", { name: "日常点検の入力" });
    await expect(form).toBeVisible();
    await form.getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
    await page.getByRole("button", { name: "すべて正常" }).click();
    await page.getByRole("radiogroup", { name: "フレームの結果" }).getByRole("radio", { name: "異常" }).check();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const frame = page.getByTestId("inspection-item-frame");
    await expect(frame.locator(".sb-field-error")).toContainText("備考を入力してください");
    await expect(frame.getByLabel("フレームの備考")).toHaveAttribute("aria-invalid", "true");
    await waitForSettledStyles(page);
    const r = await expectFields(page, "main", "点検の入力（エラー）");
    expect(r.invalid).toBeGreaterThanOrEqual(1);
    expect(await frame.locator(".sb-field-error[role=alert]").count()).toBe(0);
  });
});

test.describe("D-2 実画面：チェック行は 72 以上・32 の丸・済みは「済」", () => {
  test("許可・承認の登録（opx-check-row）：72 以上・丸 32・チェックすると行末に「済」", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/permits/new");
    await expect(page.getByTestId("permit-form")).toBeVisible();
    const input = page.getByTestId("permit-requires-observer");
    const row = page.locator("label.opx-check-row", { has: input });
    await row.scrollIntoViewIfNeeded();
    const geo = await row.evaluate((el) => {
      const i = el.querySelector("input")!;
      return { h: el.getBoundingClientRect().height, iw: i.getBoundingClientRect().width, ih: i.getBoundingClientRect().height, ir: parseFloat(getComputedStyle(i).borderTopLeftRadius), after: getComputedStyle(el, "::after").content };
    });
    expect(geo.h).toBeGreaterThanOrEqual(71.5);
    expect([geo.iw, geo.ih]).toEqual([32, 32]);
    expect(geo.ir).toBeGreaterThanOrEqual(16);
    expect(geo.after).toMatch(/^(none|normal)$/);
    await row.click();
    await expect(input).toBeChecked();
    await waitForSettledStyles(page);
    const on = await row.evaluate((el) => ({ after: getComputedStyle(el, "::after").content, bg: getComputedStyle(el.querySelector("input")!).backgroundColor }));
    expect(on.after).toContain("済");
    expect(on.bg).toBe("rgb(31, 95, 224)");
  });

  test("計画の訂正・通報（チェックの丸が 32）：ラベル付きのチェックはすべて 32 の丸", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto(`/ops/plans/${planId}/edit`);
    await expect(page.locator("main h1").first()).toBeVisible();
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"].sb-check'))
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)]),
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const sz of sizes) expect(sz).toEqual([32, 32]);
  });
});

test.describe("D-4 実画面：運航管理の読み込み中は静止したスケルトン", () => {
  test("ops の枠の読み込み中の表示は、aria-busy と「読み込み中」を持つ静止した帯（動きなし）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    const res = await page.request.get("/ops/plans");
    const html = await res.text();
    expect(html).toContain('data-testid="ops-loading-content"');
    expect(html).toMatch(/data-testid="ops-loading-content"[^>]*>|aria-busy="true"[^>]*data-testid="ops-loading-content"/);
    const block = html.slice(html.indexOf("ops-loading-content") - 200, html.indexOf("ops-loading-content") + 600);
    expect(block).toContain('aria-busy="true"');
    expect(block).toContain("読み込み中");
    expect(block).not.toContain("animate");
  });
});

test.describe("追加 1：文字 200%（390・430）の入れ物の切れ（16-D で対象に足した画面）", () => {
  const SCREENS = [
    { name: "飛行記録の詳細", path: () => `/ops/flights/${flightId}` },
    { name: "計画の主画面", path: () => `/ops/plans/${planId}`, plan: true },
    { name: "機体の登録", path: () => "/ops/aircraft/new" },
    { name: "許可・承認の登録", path: () => "/ops/permits/new" },
    { name: "場所の登録", path: () => "/ops/places/new" },
    { name: "操縦者の登録", path: () => "/ops/pilots/new" },
    { name: "事故・重大インシデントの記録", path: () => "/ops/incidents/new" },
    { name: "飛行記録の一覧（絞り込み）", path: () => "/ops/flights" },
    { name: "利用者", path: () => "/ops/members" },
  ] as const;
  for (const sc of SCREENS) {
    test(sc.name, async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      if ("plan" in sc) await gotoPlan(page, sc.path());
      else await page.goto(sc.path());
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectTextZoom(page, sc.name);
    });
  }
});

// D-1（全入力欄の条件）：項目エラーは、エラーの id が入力欄（単独の入力・チェック・ラジオのまとまり・fieldset）の aria-describedby に入っている。role は alert でない。
const expectErrorsLinked = async (page: Page, label: string, minErrors = 1): Promise<void> => {
  const r = await page.evaluate(() => {
    const errs = Array.from(document.querySelectorAll<HTMLElement>("main .sb-field-error")).filter((e) => e.getBoundingClientRect().width > 0 && (e.textContent ?? "").trim().length > 0);
    return errs.map((e) => ({
      id: e.id,
      text: (e.textContent ?? "").trim().slice(0, 24),
      role: e.getAttribute("role"),
      inAlert: !!e.closest('[role="alert"]'),
      svg: e.querySelectorAll("svg").length,
      linked: e.id !== "" && Array.from(document.querySelectorAll("[aria-describedby]")).some((h) => (h.getAttribute("aria-describedby") ?? "").split(/\s+/).includes(e.id)),
    }));
  });
  expect(r.length, `${label}: 項目エラーが出ていない`).toBeGreaterThanOrEqual(minErrors);
  for (const e of r) {
    expect(e.id, `${label}「${e.text}」: id がない`).not.toBe("");
    expect(e.linked, `${label}「${e.text}」: aria-describedby で結ばれていない`).toBe(true);
    expect(e.role, `${label}「${e.text}」`).toBeNull();
    expect(e.inAlert, `${label}「${e.text}」: alert の中`).toBe(false);
    expect(e.svg, `${label}「${e.text}」: 記号がない`).toBe(1);
  }
};

test.describe("D-1 項目エラーの関連付け（共通の FieldError に寄せた ad hoc の項目エラー）", () => {
  test("事故・ヒヤリハットの記録：区分・類型・ある/ない/わからないのエラーが fieldset に結ばれる", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/incidents/new");
    await expect(page.getByTestId("incident-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("incident-submit").click();
    await expect(page.locator("main .sb-field-error").first()).toBeVisible();
    await expectErrorsLinked(page, "事故の記録", 3);
    await expect(page.getByTestId("incident-event-types-error")).toBeVisible();
  });

  test("許可・承認の登録：種類・場所のエラーが fieldset に結ばれる", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/permits/new");
    await expect(page.getByTestId("permit-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("permit-submit").click();
    await expect(page.locator("main .sb-field-error").first()).toBeVisible();
    await expectErrorsLinked(page, "許可の登録", 2);
  });

  test("通報の作業台：控えの記録の確認チェックのエラーがチェックに結ばれる", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    // 控えの記録の入力は、確認を依頼した（有効な）計画にだけ出る。別の計画を作って依頼する（時間帯が重ならない日を選ぶ）
    const pilot = await pwRequest.newContext({ baseURL: BASE });
    await signIn(pilot, seeded("a-pilot"));
    const pilotId = ((await (await pilot.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await pilot.dispose();
    const day = new Date(Date.UTC(2026, 6, 1) + (Number.parseInt(randomUUID().slice(0, 6), 16) % 150) * 86_400_000).toISOString().slice(0, 10);
    const created = await page.request.post("/api/ops/plans", { data: { title: `控えの確認 ${stamp}`, aircraftId, pilotId, plannedStartAt: `${day}T10:00`, durationMinutes: 30, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
    expect(created.status(), await created.text()).toBe(201);
    const plan = (await created.json()) as { id: string; version: number };
    const req = await page.request.post(`/api/ops/plans/${plan.id}/request-confirmation`, { data: { expectedVersion: plan.version } });
    expect(req.status(), await req.text()).toBe(200);
    await gotoPlan(page, `/ops/plans/${plan.id}/report`);
    await openReportFolds(page);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("record-submit").click();
    await expect(page.getByTestId("report-record-form").locator(".sb-field-error").first()).toBeVisible();
    await expectErrorsLinked(page, "通報の控えの記録", 2);
    const described = await page.getByTestId("record-confirm-done").getAttribute("aria-describedby");
    expect(described).toContain("record-err-confirmedDipsDone");
  });

  test("計画の作成：飛行の方法・同意のまとまりのエラーが fieldset に結ばれる（保存できない入力）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/plans/new");
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.locator("main form button[type=submit]").first().click();
    await expect(page.locator("main [aria-invalid=true]").first()).toBeVisible();
    await expectErrorsLinked(page, "計画の作成", 1);
  });
});
