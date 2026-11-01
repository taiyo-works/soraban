import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { gotoPlan } from "./plan-screen";

// Sprint 17-2 の E2E-DB（長さ L・主画面 J・通報の作業台 S-4）。元は 17-1 の E2E-DB（docs/sprints/sprint-17.md §10 の S-1〜S-3・S-5・S-6・J-1〜J-4 の構造の部分）。
// 画面の分離：通報の主画面（/ops/plans/[id]）・通報の作業台（/report）・計画（/overview）・日誌（/journal）・判定（/judgement）。
// 長さ（L）・通報の主画面の作り込み（plan-primary-action ほか）は 17-2。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する。
// サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定している。

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
const noBrowserCache = (page: Page) => page.route("**/_next/**", (route) => route.continue());

const NIGHT_SPOT = { lat: 35.44, lng: 133.35 };
type PlanJson = { id: string; version: number; currentSnapshotId: string; nextActions: { id: string; href: string }[] };

const FORBIDDEN = ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて", "問題なし", "大丈夫"];

const tapAndWait = async (page: Page, link: Locator, url: RegExp): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await link.click();
    try {
      await page.waitForURL(url, { timeout: 10_000, waitUntil: "commit" });
      return;
    } catch {
      // 押し直す
    }
  }
  await page.goto((await link.getAttribute("href"))!);
  await page.waitForURL(url);
};

/** 対象の要素の上端がビューポートの中にある（スクロールされている）。URL や要素の存在だけでは足りない。 */
const expectInViewport = async (page: Page, id: string, label: string) => {
  const el = page.locator(`#${id}:visible`).first();
  await expect(el, `${label}: #${id} が表示される`).toBeVisible();
  const vh = page.viewportSize()!.height;
  await expect
    .poll(
      async () => {
        const box = await el.boundingBox();
        return box !== null && box.y >= 0 && box.y < vh - 48;
      },
      { message: `${label}: #${id} がビューポートの中にある`, timeout: 15_000 },
    )
    .toBe(true);
};


const SIZES = [
  { name: "375x812", width: 375, height: 812, firstScreen: 748, main: 2600, report: 9500, judgement: 4600, overview: 3000, journal: 1400 },
  { name: "1280x800", width: 1280, height: 800, firstScreen: 800, main: 1800, report: 7000, judgement: 3300, overview: 2200, journal: 1100 },
] as const;

const height = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 17-2 E2E-DB：通報の主画面と作業台", () => {
  let manager: APIRequestContext;
  let aircraftId = "";
  let pilotId = "";

  const createPlan = async (extra: object = {}): Promise<PlanJson> => {
    const r = await manager.post("/api/ops/plans", {
      data: {
        title: `S172 ${stamp}-${seq++}`,
        aircraftId,
        pilotId,
        plannedStartAt: "2027-01-10T10:00",
        durationMinutes: 30,
        purpose: "空撮",
        placeName: "試験地点",
        latitude: NIGHT_SPOT.lat,
        longitude: NIGHT_SPOT.lng,
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
  const recordApi = async (p: PlanJson, kind: "new" | "cancel" | "change", number: string, base?: string) => {
    const cur = await getPlan(p.id);
    const r = await manager.post(`/api/ops/plans/${p.id}/reports`, {
      data: {
        kind,
        ...(base ? { baseReportId: base } : {}),
        expectedPlanVersion: cur.version,
        manual: { reportedAt: "2027-01-05T11:00", dipsNumber: number, confirmedDipsDone: true, confirmedMatchesLatest: true },
      },
    });
    expect(r.status(), await r.text()).toBeLessThan(300);
  };
  const voidPlan = async (p: PlanJson) => {
    const v = await getPlan(p.id);
    expect((await manager.post(`/api/ops/plans/${p.id}/void`, { data: { expectedVersion: v.version, reason: "中止" } })).status()).toBe(200);
  };

  type States = Record<"draft" | "pending" | "reported" | "change" | "voidedNone" | "voidedRecorded", PlanJson>;
  let plans: States;

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    const mark = `JUS172${stamp}`;
    const r = await manager.post("/api/ops/aircraft", {
      data: { registrationMark: mark, modelName: "S172 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    expect(r.status(), await r.text()).toBe(201);
    aircraftId = ((await r.json()) as { id: string }).id;
    const me = await apiAs(seeded("a-pilot"));
    pilotId = ((await (await me.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await me.dispose();
    const draft = await createPlan();
    const pending = await activate(await createPlan());
    const reported = await activate(await createPlan());
    await recordApi(reported, "new", "FP-S172-0001");
    const change = await activate(await createPlan());
    await recordApi(change, "new", "FP-S172-0002");
    const cur = await getPlan(change.id);
    const patched = await manager.patch(`/api/ops/plans/${change.id}`, { data: { expectedVersion: cur.version, reason: "時刻の変更", plannedStartAt: "2027-01-10T13:00", durationMinutes: 45 } });
    expect(patched.status(), await patched.text()).toBe(200);
    const voidedNone = await createPlan();
    await voidPlan(voidedNone);
    const voidedRecorded = await activate(await createPlan());
    await recordApi(voidedRecorded, "new", "FP-S172-0003");
    await voidPlan(voidedRecorded);
    plans = { draft, pending, reported, change, voidedNone, voidedRecorded };
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const login = async (page: Page) => {
    await noBrowserCache(page);
    await signIn(page.request, seeded("a-manager"));
  };

  const expectLabel: Record<keyof States, string> = {
    draft: "確認を依頼する",
    pending: "通報の内容を見る・通報する",
    reported: "通報の結果を見る",
    change: "変更の通報を準備する",
    voidedNone: "計画の内容を見る",
    voidedRecorded: "取消の結果を記録する",
  };
  for (const size of SIZES) {
    for (const key of ["draft", "pending", "reported", "change", "voidedNone", "voidedRecorded"] as const) {
      test(`L-1・L-2・J-1・J-4・主操作（${size.name}・${key}）：主画面の長さ・最初の画面・判定の 1 行・禁止語`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await login(page);
        const p = plans[key];
        await gotoPlan(page, `/ops/plans/${p.id}`);
        await expect(page.getByTestId("plan-report-card")).toBeVisible();
        const h = await height(page);
        console.log(`[長さ] 主画面 ${size.name} ${key}: ${h}px`);
        expect(h, `${key}: 主画面の長さ`).toBeLessThanOrEqual(size.main);
        // L-2：スクロールなしで、タイトル・タブ・状況・主操作が入る
        for (const id of ["plan-title-heading", "plan-tabs", "plan-report-label", "plan-primary-action"]) {
          const box = await page.getByTestId(id).first().boundingBox();
          expect(box, `${key} ${id}`).not.toBeNull();
          expect(box!.y + box!.height, `${key} ${id} の下端`).toBeLessThanOrEqual(size.firstScreen);
        }
        const primary = page.getByTestId("plan-primary-action");
        await expect(primary).toHaveCount(1);
        await expect(primary).toHaveText(expectLabel[key]);
        expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(48);
        // J-1・J-4：判定の 1 行は「判定（補助）：」で始まる。禁止語が無い
        const line = (await page.getByTestId("plan-judge-line").innerText()).replace(/\s+/g, "");
        expect(line.startsWith("判定（補助）："), `${key}: ${line}`).toBe(true);
        const text = await page.locator("main").first().innerText();
        for (const w of FORBIDDEN) expect(text, `${key}: 「${w}」`).not.toContain(w);
        expect(text, `${key}: OK`).not.toMatch(/\bOK\b/);
        const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(sw.sw).toBeLessThanOrEqual(sw.cw);
        await expect(page.getByTestId("plan-judge-link")).toHaveAttribute("href", `/ops/plans/${p.id}/judgement`);
        await expect(page.getByTestId("plan-confirm-link")).toHaveAttribute("href", `/ops/plans/${p.id}/overview#sec-confirm`);
      });
    }
  }

  test("中止した計画：記録が無ければ事実だけ（「通報：要」と出さない）。記録があれば取消の記録へ", async ({ page }) => {
    await login(page);
    await gotoPlan(page, `/ops/plans/${plans.voidedNone.id}`);
    await expect(page.getByTestId("plan-report-label")).toHaveText("中止（通報の記録はありません）");
    const text = await page.locator("main").first().innerText();
    expect(text).not.toContain("通報：要");
    for (const w of FORBIDDEN) expect(text).not.toContain(w);
    await expect(page.getByTestId("plan-steps")).toHaveCount(0);
    await gotoPlan(page, `/ops/plans/${plans.voidedRecorded.id}`);
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "cancel_needed");
    await expect(page.getByTestId("plan-report-status-label")).toContainText("DIPS で通報を取り消し");
    await expect(page.getByTestId("plan-primary-action")).toHaveAttribute("href", `/ops/plans/${plans.voidedRecorded.id}/report?kind=cancel#record`);
  });

  test("L-6・手順（plan-steps）：主画面から通報の内容・結果の記録・判定・確認へ、1 回の押下で移る", async ({ page }) => {
    await login(page);
    const base = `/ops/plans/${plans.pending.id}`;
    const hops: [string, RegExp][] = [
      ["plan-primary-action", /\/report$/],
      ["plan-report-link", /\/report$/],
      ["plan-step-1", /\/report#inputs$/],
      ["plan-step-2", /\/report#items$/],
      ["plan-step-3", /\/report#record$/],
      ["plan-judge-link", /\/judgement$/],
      ["plan-confirm-link", /\/overview#sec-confirm$/],
    ];
    for (const [id, url] of hops) {
      await gotoPlan(page, base);
      await expect(page.getByTestId("plan-steps")).toBeVisible();
      await tapAndWait(page, page.getByTestId(id), url);
    }
  });

  for (const size of SIZES) {
    test(`L-3・L-5・S-4（${size.name}）：通報の作業台の長さ・手順バー・項目の行の高さ・記録へ 1 回で移る`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await login(page);
      await page.goto(`/ops/plans/${plans.pending.id}/report`);
      await expect(page.getByTestId("report-screen")).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const h = await height(page);
      console.log(`[長さ] 作業台 ${size.name}: ${h}px`);
      expect(h).toBeLessThanOrEqual(size.report);
      // スクロールなしで、固定の文言（短い版）・手順バー・種別タブ
      for (const id of ["report-notice-short", "report-stepper", "report-kind-tabs"]) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, id).not.toBeNull();
        expect(box!.y + box!.height, `${id} の下端`).toBeLessThanOrEqual(size.firstScreen);
      }
      // S-4：DOM の順
      const order = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s);
        const ids = ['[data-testid="report-notice"]', '[data-testid="report-stepper"]', "#status", '[data-testid="report-kind-tabs"]', "#inputs", "#items", "#record", "#history", "#audit"];
        const els = ids.map(q);
        return els.map((e, i) => (e === null ? -1 : i === 0 ? 0 : (els[i - 1]!.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0)));
      });
      expect(order.slice(1).every((v) => v === 1), JSON.stringify(order)).toBe(true);
      // L-5：項目の行の平均の高さ・コピーの押す面
      if (size.width === 375) {
        const rows = await page.locator('li[data-testid^="report-item-"][data-status]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        const avg = rows.reduce((a, b) => a + b, 0) / rows.length;
        console.log(`[長さ] 項目の行 ${rows.length} 件の平均 ${avg.toFixed(1)}px`);
        expect(rows.length).toBeGreaterThan(20);
        expect(avg).toBeLessThanOrEqual(76);
      }
      const copies = await page.locator('[data-testid^="report-copy-"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(copies.length).toBeGreaterThan(0);
      for (const c of copies) expect(c).toBeGreaterThanOrEqual(44);
      // 手順バーの「結果を記録する」→ #record
      await page.getByTestId("report-step-record").click();
      await expect.poll(() => page.evaluate(() => location.hash)).toBe("#record");
      await expectInViewport(page, "record", "手順バー");
      // 履歴・監査は畳んでも DOM にある
      await expect(page.getByTestId("report-audit-details")).toHaveCount(1);
    });
  }

  test("履歴：最新の有効な通報は常に見え、古い版は 1 回で開く", async ({ page }) => {
    await login(page);
    await page.goto(`/ops/plans/${plans.reported.id}/report`);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await expect(page.getByTestId("report-row-effective").first()).toBeVisible();
    await expect(page.getByTestId("report-status-details")).toHaveCount(1);
  });

  for (const size of SIZES) {
    test(`L-4（${size.name}）：判定・計画・日誌の長さ`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await login(page);
      const base = `/ops/plans/${plans.pending.id}`;
      for (const [path, limit, name] of [["/judgement", size.judgement, "判定"], ["/overview", size.overview, "計画"], ["/journal", size.journal, "日誌"]] as const) {
        await gotoPlan(page, `${base}${path}`);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const h = await height(page);
        console.log(`[長さ] ${name} ${size.name}: ${h}px`);
        expect(h, name).toBeLessThanOrEqual(limit);
      }
    });
  }
});
