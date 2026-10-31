import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { openUserMenu } from "../ops-menu";

// Sprint 15 の E2E-DB（契約 A〜F・追加 R-1・U-2）。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start（本番のビルド）に対して実行する
// （pnpm test:e2e:ops）。Service Worker は本番のビルドでだけ登録するので、next dev では確かめられない。
// この仕様書だけ Service Worker を許可する（playwright.ops.config.ts の既定は block）。圏外は context.setOffline(true) で作る。
// サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定。ブラウザの時計は page.clock でそれより前に合わせる。
// 識別子の一覧（Sprint 15）：pwa-*（PWA・先読み・新しい版）、offline-*（圏外用の枠）、field-status-*（状態の帯）、field-send-now、
// field-expiry-warning、field-auth-*、field-sent-warning(s)、field-device-storage、field-report-record-before-takeoff、signout-keep。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
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

const DAY = "2027-01-05";
const HQ = { lat: 35.434238, lng: 133.380508 };
const at = (hms: string) => new Date(`${DAY}T${hms}+09:00`);
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;
const ALL_NORMAL = Object.fromEntries(
  ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"].map((k) => [k, { result: "normal" }]),
);

const memberIdOf = async (ctx: APIRequestContext): Promise<string> => ((await (await ctx.get("/api/ops/me")).json()) as { member: { id: string } }).member.id;
const createAircraft = async (manager: APIRequestContext): Promise<{ id: string; registrationMark: string }> => {
  const registrationMark = `JUS15${stamp}${seq++}`;
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "圏外試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { ...((await r.json()) as { id: string }), registrationMark };
};
/** 飛行記録は操縦者・機体の時間帯の重なりを拒むため、試験ごとに操縦者を作る（利用者に結び付かない）。 */
const createPilot = async (manager: APIRequestContext, extra: Record<string, unknown> = {}): Promise<{ id: string; version: number }> => {
  const r = await manager.post("/api/ops/pilots", { data: { fullName: `圏外 試験${stamp}${seq++}`, hasLicense: false, ...extra } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string; version: number };
};
const createPlan = async (ctx: APIRequestContext, aircraftId: string, pilotId: string, extra: Record<string, unknown> = {}): Promise<{ id: string; title: string; version: number }> => {
  const title = `S15 ${stamp}-${seq++}`;
  const r = await ctx.post("/api/ops/plans", {
    data: { title, aircraftId, pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "圏外の空撮", placeName: "試験地点", latitude: HQ.lat, longitude: HQ.lng, flags: [], ...extra },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { ...((await r.json()) as { id: string; version: number }), title };
};
type FieldView = {
  docs: { key: string; status: string; effective: string; basis: string[]; notes: string[] }[];
  postPendingCount: number;
  flights: { takeoffEventId: string; landingEventId: string | null; gaps: { item: string }[]; post: { done: boolean }; phase: string; preInspectionId: string | null }[];
};
const getField = async (ctx: APIRequestContext, planId: string): Promise<FieldView> => {
  const r = await ctx.get(`/api/ops/plans/${planId}/field`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as FieldView;
};
type Ev = { kind: string; item: string | null; inspectionId: string | null; recordedAt: string; clientEventId: string };
const getEvents = async (ctx: APIRequestContext, planId: string): Promise<Ev[]> =>
  ((await (await ctx.get(`/api/ops/plans/${planId}/field-events`)).json()) as { events: Ev[] }).events;

const openField = async (page: Page, planId: string): Promise<void> => {
  await page.goto(`/ops/plans/${planId}/field`);
  await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
};
/** Service Worker がこの画面を受け持つまで待つ（受け持つ前の再読み込みは Service Worker を通らない）。 */
const waitSw = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 });
};
/** 端末の先読みの束（IndexedDB）のキー。 */
const bundleKeys = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const r = indexedDB.open("soraban-ops");
        r.onsuccess = () => {
          try {
            const q = r.result.transaction("field-bundles", "readonly").objectStore("field-bundles").getAllKeys();
            q.onsuccess = () => resolve(q.result.map(String));
            q.onerror = () => resolve([]);
          } catch {
            resolve([]);
          }
        };
        r.onerror = () => resolve([]);
      }),
  );
const waitBundle = async (page: Page, planId: string): Promise<void> => {
  await expect.poll(async () => (await bundleKeys(page)).some((k) => k.endsWith(`:${planId}`)), { timeout: 30_000 }).toBe(true);
};
const setOnline = async (page: Page, context: BrowserContext, online: boolean): Promise<void> => {
  await context.setOffline(!online);
  await page.evaluate((on) => window.dispatchEvent(new Event(on ? "online" : "offline")), online).catch(() => undefined);
};
const unsent = (page: Page) => page.getByTestId("field-status-unsent");
const prepare = async (page: Page, who = seeded("a-manager")) => {
  const manager = await apiAs(seeded("a-manager"));
  await signIn(page.request, who);
  const aircraft = await createAircraft(manager);
  const pilot = await createPilot(manager);
  return { manager, aircraft, pilot };
};

test.use({ serviceWorkers: "allow", timezoneId: "America/Los_Angeles" });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 15 A：インストールと配信", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("A-1：/ops でマニフェストが配信され、名称・アイコン（192・512）・display・開始 URL・theme_color が揃う", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/ops/manifest.webmanifest");
    // マニフェストはログインしていなくても取れる（ブラウザは Cookie なしで取得する）
    const anon = await pwRequest.newContext({ baseURL: BASE });
    const r = await anon.get(href!);
    expect(r.status()).toBe(200);
    const m = (await r.json()) as { name: string; short_name: string; display: string; start_url: string; theme_color: string; icons: { src: string; sizes: string }[] };
    expect(m.name).toContain("そらばん");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/ops");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    for (const size of ["192x192", "512x512"]) {
      const icon = m.icons.find((i) => i.sizes === size);
      expect(icon, size).toBeTruthy();
      const ir = await anon.get(icon!.src);
      expect(ir.status()).toBe(200);
      expect(ir.headers()["content-type"]).toContain("image/png");
    }
    expect(m.icons.some((i) => i.src === "/icon.svg")).toBe(true);
    // 公開の / にはマニフェストを付けない
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    await anon.dispose();
  });

  test("A-2・A-3：Service Worker は /ops にだけ効き、公開の / を受け持たない。キャッシュは許可リストだけ（/api・/ops/sign-in・画面の本体なし）", async ({ page, context }) => {
    // 新しい端末で / を開いても登録されない
    const fresh = await context.browser()!.newContext({ serviceWorkers: "allow" });
    const fp = await fresh.newPage();
    await fp.goto(`${BASE}/`);
    await fp.waitForLoadState("load");
    expect(await fp.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    await fresh.close();

    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id);
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await waitSw(page);
    const reg = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/ops"))?.scope ?? null);
    expect(reg).toBe(`${BASE}/ops`);
    // / は受け持たない（登録の scope に入らない）
    await page.goto("/");
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))?.scope ?? null)).toBeNull();
    // キャッシュの中身を列挙する
    await openField(page, plan.id);
    await expect
      .poll(async () => (await page.evaluate(async () => (await caches.keys()).length)) > 0, { timeout: 30_000 })
      .toBe(true);
    await page.request.get(`/api/ops/plans/${plan.id}/field`);
    await page.goto("/ops/journal");
    const urls = await page.evaluate(async () => {
      const out: string[] = [];
      for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(new URL(r.url).pathname);
      return out;
    });
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u, u).not.toMatch(/^\/api\//);
      expect(u, u).not.toMatch(/^\/ops\/sign-in/);
      expect(u, u).not.toMatch(/^\/ops\/(plans|journal|inspections|flights|more)/);
      expect(u, u).toMatch(/^\/(ops\/offline\/|_next\/static\/|fonts\/|pwa\/|icon\.svg|favicon\.ico)/);
    }
    for (const shell of ["field", "inspection", "journal", "today", "unavailable"]) expect(urls).toContain(`/ops/offline/${shell}`);
    // 枠に利用者のデータが入っていない（氏名・計画名・機体の記号）
    const shellText = await page.evaluate(async () => {
      let t = "";
      for (const n of await caches.keys()) {
        const c = await caches.open(n);
        for (const r of await c.keys()) if (new URL(r.url).pathname.startsWith("/ops/offline/")) t += await (await c.match(r))!.text();
      }
      return t;
    });
    expect(shellText).not.toContain(plan.title);
    expect(shellText).not.toContain(aircraft.registrationMark);
    expect(shellText).not.toContain("運航 管理子");
    await manager.dispose();
  });

  test("A-4：新しい版を配っても、入力中の現場画面は勝手に再読み込みされない。「更新する」を押したときだけ切り替わる", async ({ page }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id);
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await waitSw(page);
    await page.evaluate(() => ((window as unknown as { __s15marker: string }).__s15marker = "same-page"));
    await page.getByTestId("field-site-note").fill("入力中の備考");
    // 新しい版（別の版の Service Worker）を配る
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/ops/sw.js?v=e2e-next-version", { scope: "/ops", updateViaCache: "none" });
    });
    await expect(page.getByTestId("pwa-update")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __s15marker?: string }).__s15marker)).toBe("same-page");
    await expect(page.getByTestId("field-site-note")).toHaveValue("入力中の備考");
    // 利用者が押したときだけ切り替わり、再読み込みされる
    await page.getByTestId("pwa-update-button").click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __s15marker?: string }).__s15marker ?? null).catch(() => "navigating"), { timeout: 30_000 })
      .toBeNull();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).toContain("e2e-next-version");
    await manager.dispose();
  });
});

test.describe("Sprint 15 B：先読み", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("B-1・B-2：ホームを開くと、自分が操縦者の今日の計画の束が利用者ごとのキーで保存される。API は組織と利用者で絞る", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const pilotCtx = await apiAs(seeded("a-pilot"));
    const me = ((await (await pilotCtx.get("/api/ops/me")).json()) as { member: { id: string }; pilotId: string });
    const aircraft = await createAircraft(manager);
    const mine = await createPlan(manager, aircraft.id, me.pilotId, { plannedStartAt: `${DAY}T15:00` });
    const otherPilot = await createPilot(manager);
    const others = await createPlan(manager, aircraft.id, otherPilot.id, { plannedStartAt: `${DAY}T16:30` });
    await signIn(page.request, seeded("a-pilot"));
    await page.clock.setFixedTime(at("11:56:00"));
    await page.goto("/ops");
    await expect(page.getByTestId("pwa-prefetch-status")).toBeVisible();
    await expect.poll(async () => (await bundleKeys(page)).includes(`${me.member.id}:${mine.id}`)).toBe(true);
    expect((await bundleKeys(page)).some((k) => k.endsWith(`:${others.id}`))).toBe(false);
    expect((await bundleKeys(page)).every((k) => k.startsWith(`${me.member.id}:`))).toBe(true);
    // 束の中身：技能証明書の番号・座標・目的（自由記述）が入らない
    const all = JSON.stringify(await page.evaluate(() => new Promise((resolve) => {
      const r = indexedDB.open("soraban-ops");
      r.onsuccess = () => {
        const q = r.result.transaction("field-bundles", "readonly").objectStore("field-bundles").getAll();
        q.onsuccess = () => resolve(q.result);
      };
    })));
    for (const w of ["TEST-11112222", String(HQ.lat), String(HQ.lng), "圏外の空撮"]) expect(all, w).not.toContain(w);
    // B-2：他の組織の計画は 404、計画の操縦者でない操縦者は 403、未ログインは返さない（401）
    const bManager = await apiAs(seeded("b-manager"));
    expect((await bManager.get(`/api/ops/field-bundle?planId=${mine.id}`)).status()).toBe(404);
    const b = (await (await bManager.get("/api/ops/field-bundle")).json()) as { bundles: { planId: string }[] };
    expect(b.bundles.some((x) => x.planId === mine.id)).toBe(false);
    const pilot2 = await apiAs(seeded("a-pilot2"));
    expect((await pilot2.get(`/api/ops/field-bundle?planId=${mine.id}`)).status()).toBe(403);
    const anon = await pwRequest.newContext({ baseURL: BASE });
    expect((await anon.get("/api/ops/field-bundle")).status()).toBe(401);
    // G-2：中止した計画の束は、次にホームで取り直したときに端末から消える
    const fresh = (await (await manager.get(`/api/ops/plans/${mine.id}`)).json()) as { version: number };
    expect((await manager.post(`/api/ops/plans/${mine.id}/void`, { data: { expectedVersion: fresh.version, reason: "中止の試験" } })).status()).toBe(200);
    await page.goto("/ops");
    await expect(page.getByTestId("pwa-prefetch-status")).toBeVisible();
    await expect.poll(async () => (await bundleKeys(page)).includes(`${me.member.id}:${mine.id}`)).toBe(false);
    for (const c of [manager, pilotCtx, bManager, pilot2, anon]) await c.dispose();
  });

  test("B-3・B-4：先読みの最終更新が出て、古いと注記が出る。登録が変わったあとオンラインに戻ると判定が最新になる", async ({ page, context }) => {
    const { manager, aircraft } = await prepare(page);
    const lic = await createPilot(manager, { hasLicense: true, licenseClass: "second", licenseNumber: `S15-${stamp}${seq}`.slice(0, 30), licenseExpiresOn: "2028-12-31" });
    const plan = await createPlan(manager, aircraft.id, lic.id);
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await waitSw(page);
    await waitBundle(page, plan.id);
    await expect(page.getByTestId("field-status-prefetch")).toContainText("先読みの最終更新");
    await expect(page.getByTestId("field-status-prefetch-stale")).toHaveCount(0);
    await expect(page.getByTestId("field-docs-state-license")).toContainText("確認済み");
    // 登録を変える（技能証明の期限を過去に）。圏外の端末は先読みのまま
    const upd = await manager.patch(`/api/ops/pilots/${lic.id}`, { data: { expectedVersion: lic.version, reason: "期限切れの試験", licenseExpiresOn: "2026-12-31" } });
    expect(upd.status(), await upd.text()).toBe(200);
    await setOnline(page, context, false);
    await page.reload();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(page.getByTestId("field-docs-state-license")).toContainText("確認済み");
    // オンラインに戻ると、サーバーの判定（満たさない）に変わる
    await setOnline(page, context, true);
    await expect(page.getByTestId("field-docs-state-license")).toContainText("満たさない");
    await expect(page.getByTestId("field-status-connection")).toContainText("接続あり");
    // 13 時間後（基準 12 時間を超える）に圏外で開くと、古い注記が出る
    await setOnline(page, context, false);
    await page.clock.setFixedTime(new Date(at("12:00:00").getTime() + 13 * 3600_000));
    await page.reload();
    await expect(page.getByTestId("field-status-prefetch-stale")).toBeVisible();
    await setOnline(page, context, true);
    await manager.dispose();
  });
});

for (const vp of [
  { name: "375×812", width: 375, height: 812 },
  { name: "1280×800", width: 1280, height: 800 },
]) {
  test.describe(`Sprint 15 C・D・E：圏外で開いて記録し、戻ると順番に送られる ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width < 600 });

    test("C-1〜C-4・D-1〜D-3・E-1・E-3：再読み込みしても開き、確認・離着陸・点検・日誌を保存し、戻ると作った順に送られる", async ({ page, context }) => {
      const { manager, aircraft, pilot } = await prepare(page);
      const plan = await createPlan(manager, aircraft.id, pilot.id);
      const notSaved = await createPlan(manager, aircraft.id, pilot.id, { plannedStartAt: `${DAY}T17:00` });
      // 圏外用の枠を水和するときの誤り（React #418 など）が出ないこと
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      await page.clock.setFixedTime(at("11:56:00"));
      await openField(page, plan.id);
      await waitSw(page);
      await waitBundle(page, plan.id);

      // C-1：圏外にして再読み込みしても、計画の要約と手順が見える
      await setOnline(page, context, false);
      await page.reload();
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      await expect(page.getByTestId("field-plan-title")).toHaveText(plan.title);
      await expect(page.getByTestId("field-preflight")).toBeVisible();
      await expect(page.getByTestId("field-flight-button")).toBeVisible();
      // C-4：状態の帯（文字で）
      await expect(page.getByTestId("field-status-connection")).toContainText("接続なし");
      await expect(unsent(page)).toContainText("送信待ち 0 件");
      await expect(page.getByTestId("field-status-saved")).toContainText("最後に保存");
      await expect(page.getByTestId("field-status-prefetch")).toContainText("先読みの最終更新");
      const band = await page.getByTestId("field-status-band").boundingBox();
      expect(band!.height, "状態の帯の高さ").toBeLessThan(vp.width < 600 ? 140 : 80);

      // D-2：日常点検（飛行前）を圏外で入力して保存
      await page.getByTestId("field-inspection-link").click();
      await expect(page.getByTestId("offline-banner")).toBeVisible();
      await expect(page.getByTestId("offline-inspection-timing-pre_flight")).toHaveAttribute("aria-checked", "true");
      await page.getByTestId("offline-inspection-save").click();
      await expect(page.getByTestId("offline-inspection-error")).toContainText("9 項目");
      await page.getByTestId("offline-inspection-all-normal").click();
      await page.getByTestId("offline-inspection-save").click();
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      await expect(page.getByTestId("field-item-state-inspection")).toContainText("済");
      await expect(unsent(page)).toContainText("送信待ち 1 件");
      await expect(page.getByTestId("field-status-saved")).toContainText("11:56");

      // D-1：飛行前の確認（空域・現場状況・携行品・書類の人の確認）
      await page.getByTestId("field-em-source").selectOption({ index: 1 });
      await page.getByTestId("field-em-result-not_designated").click();
      await page.getByTestId("field-em-submit").click();
      await page.getByTestId("field-restriction-submit").click();
      for (const [f, v] of [["third_party", "none"], ["other_aircraft", "none"], ["rain", "none"], ["visibility", "good"]] as const) await page.getByTestId(`field-site-${f}-${v}`).click();
      await page.getByTestId("field-site-submit").click();
      await page.getByTestId("field-carry-submit").click();
      await page.getByTestId("field-docs-confirm-remote_id").click();
      await expect(page.getByTestId("field-docs-state-remote_id")).toContainText("確認済み（人が確認）");
      await expect(unsent(page)).toContainText("送信待ち 6 件");
      // 再読み込みしても、記録と状態が残る（圏外のまま）
      await page.reload();
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      await expect(unsent(page)).toContainText("送信待ち 6 件");
      await expect(page.getByTestId("field-site-state")).toContainText("済");

      // 離陸・着陸
      const btn = page.getByTestId("field-flight-button");
      await btn.click();
      await expect(btn).toHaveText("着陸");
      await page.clock.setFixedTime(at("11:58:05"));
      await page.waitForTimeout(1600);
      await btn.click();
      await expect(btn).toHaveText("離陸");

      // D-2：飛行後点検（異常の項目は備考が必須）
      await page.getByTestId("field-post-link").click();
      await expect(page.getByTestId("offline-inspection-timing-post_flight")).toHaveAttribute("aria-checked", "true");
      await page.getByTestId("offline-inspection-all-normal").click();
      await page.getByTestId("offline-inspection-battery-abnormal").click();
      await page.getByTestId("offline-inspection-save").click();
      await expect(page.getByTestId("offline-inspection-error")).toContainText("備考");
      await page.getByTestId("offline-inspection-note-battery").fill("端子の汚れ");
      await page.getByTestId("offline-inspection-save").click();
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      await expect(page.getByTestId("field-post-state")).toContainText("異常あり");

      // D-3：日誌（離着陸の時刻は現場の記録から）
      await page.getByTestId("field-journal-link").click();
      await expect(page.getByTestId("offline-journal-times")).toHaveText("11:56 → 11:58");
      await expect(page.getByTestId("offline-journal-inspection")).toContainText("あり（送信待ち）");
      await expect(page.getByTestId("offline-journal-warning-note")).toContainText("送信した後");
      await page.getByTestId("offline-journal-safety-no").click();
      await page.getByTestId("offline-journal-save").click();
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      await expect(page.getByTestId("field-flight-row")).toHaveAttribute("data-phase", "journaled");
      await expect(unsent(page)).toContainText("送信待ち 10 件");

      // D-5：端末の送信待ちに、氏名・計画名・目的・座標が入っていない（点検の異常の備考は送るまで残る）
      const stored = await page.evaluate(() => Object.entries(window.localStorage).filter(([k]) => k.startsWith("soraban:ops-draft:field-")).map(([, v]) => v).join(""));
      for (const w of [plan.title, "圏外の空撮", String(HQ.lat), "運航 管理子", aircraft.registrationMark, "試験地点"]) expect(stored, w).not.toContain(w);
      expect(stored).toContain("端子の汚れ");

      // C-3：圏外で計画の作成へ進むと、圏外であることと戻ってから行うことが出る
      await page.goto("/ops/plans/new");
      await expect(page.getByTestId("offline-unavailable")).toContainText("電波のある場所に戻ってから");
      // C-2：先読みしていない計画の現場画面
      await page.goto(`/ops/plans/${notSaved.id}/field`);
      await expect(page.getByTestId("offline-not-saved")).toHaveText("この計画は端末に保存されていません。電波のある場所で一度開いてください。");

      expect(pageErrors, "圏外の枠の水和の誤り").toEqual([]);
      // E-1：通信を戻すと、作った順に送られる
      await context.setOffline(false);
      await openField(page, plan.id);
      await expect(unsent(page)).toContainText("送信待ち 0 件", { timeout: 60_000 });
      await expect(page.getByTestId("field-status-connection")).toContainText("接続あり");
      // D-3：日誌のサーバーの確認事項は、送れたあとに出る（計画の時間帯の外）
      await expect(page.getByTestId("field-sent-warnings")).toContainText("計画の時間帯の外");
      const evs = await getEvents(manager, plan.id);
      const order = evs.map((e) => (e.kind === "check" ? `check:${e.item}` : e.kind));
      expect(order).toEqual([
        "check:inspection",
        "check:emergency_airspace",
        "check:flight_restriction",
        "check:site_conditions",
        "check:carry",
        "check:docs_confirm",
        "takeoff",
        "landing",
        "check:inspection",
        "journal_linked",
      ]);
      const v = await getField(manager, plan.id);
      expect(v.flights).toHaveLength(1);
      expect(v.flights[0]!.phase).toBe("journaled");
      // E-3：点検が先に送られ、離陸の未了事項に「日常点検（記録なし）」が出ない。日誌はサーバーの点検の ID を指す
      expect(v.flights[0]!.gaps.map((g) => g.item)).not.toContain("inspection");
      expect(v.flights[0]!.post.done).toBe(true);
      const insps = (await (await manager.get(`/api/ops/inspections?aircraftId=${aircraft.id}`)).json()) as { inspections: { id: string; timing: string; placeName: string }[] };
      expect(insps.inspections).toHaveLength(2);
      expect(insps.inspections.every((i) => i.placeName === "試験地点")).toBe(true);
      const pre = insps.inspections.find((i) => i.timing === "pre_flight")!;
      const flights = (await (await manager.get(`/api/ops/flights?aircraftId=${aircraft.id}`)).json()) as { flights: { id: string; dailyInspectionId: string | null; purpose: string; flightPlanId: string | null }[] };
      expect(flights.flights).toHaveLength(1);
      expect(flights.flights[0]!.dailyInspectionId).toBe(pre.id);
      expect(flights.flights[0]!.purpose).toBe("圏外の空撮");
      expect(flights.flights[0]!.flightPlanId).toBe(plan.id);
      // 送れたら、端末の自由記述は消える
      const left = await page.evaluate(() => Object.entries(window.localStorage).filter(([k]) => k.startsWith("soraban:ops-draft:field-")).map(([, v]) => v).join(""));
      expect(left).not.toContain("端子の汚れ");
      await manager.dispose();
    });
  });
}

test.describe("Sprint 15 D・E：送信待ちの規則", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("D-6：端末に保存できない環境では、メモリに保持して「電波が戻るまで画面を閉じないでください」を出す", async ({ page, context }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id);
    await page.clock.setFixedTime(at("11:56:00"));
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith("soraban:ops-draft:field-")) throw new DOMException("quota", "QuotaExceededError");
        return orig.call(this, k, v);
      };
    });
    await openField(page, plan.id);
    await setOnline(page, context, false);
    await page.getByTestId("field-carry-submit").click();
    await expect(page.getByTestId("field-outbox-unsaved")).toContainText("電波が戻って送信されるまで、この画面を閉じないでください");
    await setOnline(page, context, true);
    await expect(unsent(page)).toContainText("送信待ち 0 件");
    expect((await getEvents(manager, plan.id)).filter((e) => e.item === "carry")).toHaveLength(1);
    await manager.dispose();
  });

  test("E-2・E-5：送信の途中で再読み込みしても二重にならない。2 台の端末の記録は両方残り、同じ識別子の再送は 1 行", async ({ page, context, browser }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id);
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await setOnline(page, context, false);
    await page.getByTestId("field-carry-submit").click();
    await page.getByTestId("field-restriction-submit").click();
    await page.getByTestId("field-docs-confirm-manual").click();
    await expect(unsent(page)).toContainText("送信待ち 3 件");
    // 戻した直後（送信の途中）に再読み込みする
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.reload();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(unsent(page)).toContainText("送信待ち 0 件", { timeout: 60_000 });
    const ev = await getEvents(manager, plan.id);
    for (const item of ["carry", "flight_restriction", "docs_confirm"]) expect(ev.filter((e) => e.item === item), item).toHaveLength(1);
    // 2 台目の端末（別のブラウザの文脈）で同じ計画に記録する：識別子が違うので両方残る
    const second = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 375, height: 812 } });
    await signIn(second.request, seeded("a-manager"));
    const p2 = await second.newPage();
    await p2.clock.setFixedTime(at("11:57:00"));
    await openField(p2, plan.id);
    await page.getByTestId("field-em-source").selectOption({ index: 1 });
    await page.getByTestId("field-em-result-not_designated").click();
    await page.getByTestId("field-em-submit").click();
    await p2.getByTestId("field-em-source").selectOption({ index: 1 });
    await p2.getByTestId("field-em-result-not_designated").click();
    await p2.getByTestId("field-em-submit").click();
    await expect(unsent(page)).toContainText("送信待ち 0 件");
    await expect(unsent(p2)).toContainText("送信待ち 0 件");
    expect((await getEvents(manager, plan.id)).filter((e) => e.item === "emergency_airspace")).toHaveLength(2);
    // 同じ識別子の再送は 1 行（2 台目から、1 台目の識別子で送り直す）
    const first = (await getEvents(manager, plan.id)).find((e) => e.item === "carry")!;
    const again = await second.request.post(`/api/ops/plans/${plan.id}/field-events`, {
      data: { kind: "check", item: "carry", result: "done", clientEventId: first.clientEventId, occurredAt: `${DAY}T11:56`, queued: true },
    });
    expect([200, 409]).toContain(again.status());
    expect((await getEvents(manager, plan.id)).filter((e) => e.item === "carry")).toHaveLength(1);
    await second.close();
    await manager.dispose();
  });

  test("E-4・E-6・E-8：12c の形式の行が読めて送れる。72 時間を超えた点検は送らず理由つきで残り、後ろの行は止まらない。あと 12 時間以内に超える行は注意が出る", async ({ page, context }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id);
    const memberId = await memberIdOf(manager);
    const pilotId = pilot.id;
    // 端末に、古い点検（73 時間前）・12c の形式の確認・期限の近い確認（61 時間前。圏外の間は残る）を入れておく
    const key = `soraban:ops-draft:field-${plan.id}:${memberId}`;
    const old = {
      clientEventId: randomUUID(),
      kind: "inspection",
      occurredAt: "2027-01-02T11:00",
      status: "pending",
      attempts: 0,
      inspection: { timing: "pre_flight", aircraftId: aircraft.id, pilotId, items: ALL_NORMAL },
    };
    const legacy = { clientEventId: randomUUID(), kind: "check", item: "carry", result: "done", occurredAt: `${DAY}T11:55`, status: "pending", attempts: 2 };
    const soon = { clientEventId: randomUUID(), kind: "check", item: "flight_restriction", result: "done", occurredAt: "2027-01-02T23:30", status: "pending", attempts: 1 };
    await page.clock.setFixedTime(at("11:56:00"));
    // 先読みしてから圏外にし、端末に行を入れて開き直す（圏外の間は送られず、期限の注意が出る）
    await openField(page, plan.id);
    await waitSw(page);
    await waitBundle(page, plan.id);
    await setOnline(page, context, false);
    await page.evaluate(([k, v]) => window.localStorage.setItem(k as string, v as string), [key, JSON.stringify({ v: 1, entries: [soon, old, legacy] })]);
    await page.reload();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(unsent(page)).toContainText("送信待ち 3 件");
    await expect(page.getByTestId("field-expiry-warning")).toContainText("あと 11 時間");
    // 戻ると、期限切れの点検は送らずに理由つきで残り、後ろの行（12c の形式の確認）は送られる
    await setOnline(page, context, true);
    await expect(page.getByTestId("field-rejected-row")).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByTestId("field-rejected-reason")).toContainText("古すぎて送れません");
    await expect(page.getByTestId("field-rejected-after-entry")).toBeVisible();
    await expect(unsent(page)).toContainText("送信待ち 0 件");
    await expect(page.getByTestId("field-expiry-warning")).toHaveCount(0);
    const ev = await getEvents(manager, plan.id);
    expect(ev.filter((e) => e.item === "carry")).toHaveLength(1);
    expect(ev.filter((e) => e.item === "flight_restriction")).toHaveLength(1);
    await manager.dispose();
  });

  test("E-7：通信が戻っても認証が切れていれば送信待ちは消えず、再ログインの案内が出て、ログイン後に続きが送られる", async ({ page, context }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id);
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await setOnline(page, context, false);
    await page.getByTestId("field-carry-submit").click();
    await expect(unsent(page)).toContainText("送信待ち 1 件");
    await context.clearCookies();
    await setOnline(page, context, true);
    await expect(page.getByTestId("field-auth-required")).toBeVisible({ timeout: 30_000 });
    await expect(unsent(page)).toContainText("送信待ち 1 件");
    await signIn(page.request, seeded("a-manager"));
    await page.getByTestId("field-send-now").click();
    await expect(unsent(page)).toContainText("送信待ち 0 件");
    await expect(page.getByTestId("field-auth-required")).toHaveCount(0);
    expect((await getEvents(manager, plan.id)).filter((e) => e.item === "carry")).toHaveLength(1);
    await manager.dispose();
  });
});

test.describe("Sprint 15 F：端末と個人情報", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("F-1・F-3：未送信が無ければログアウトで先読みを消す。未送信があれば警告し、残して出られる。別の利用者のログインで前の利用者の分が消える", async ({ page }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id);
    const memberId = await memberIdOf(manager);
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await waitBundle(page, plan.id);
    // F-3：端末に保存されている内容の説明
    await page.getByTestId("field-device-storage").locator("summary").click();
    await expect(page.getByTestId("field-device-storage")).toContainText("先読み");
    await expect(page.getByTestId("field-device-storage")).toContainText("送信待ち");
    // 未送信なし → ログアウトで先読みが消える
    await page.goto("/ops/more");
    // ログアウトは右上の利用者メニューの中（水和の前の押下は効かないので、移るまで押し直す）
    await expect(async () => {
      await openUserMenu(page);
      await page.getByTestId("signout").click();
      await page.waitForURL(/\/ops\/sign-in/, { timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    await expect.poll(() => bundleKeys(page)).toEqual([]);
    // 未送信あり → 警告。「送信待ちを残してログアウト」：先読みは消え、送信待ちは残る
    await signIn(page.request, seeded("a-manager"));
    await openField(page, plan.id);
    await waitBundle(page, plan.id);
    await page.goto("/ops/more");
    const pending = { v: 1, entries: [{ clientEventId: randomUUID(), kind: "check", item: "carry", result: "done", occurredAt: `${DAY}T11:55`, status: "pending", attempts: 1 }] };
    await page.evaluate(([k, v]) => window.localStorage.setItem(k as string, v as string), [`soraban:ops-draft:field-${plan.id}:${memberId}`, JSON.stringify(pending)]);
    await expect(async () => {
      await openUserMenu(page);
      await page.getByTestId("signout").click();
      await expect(page.getByTestId("signout-warning")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await page.getByTestId("signout-keep").click();
    await page.waitForURL(/\/ops\/sign-in/);
    expect(await bundleKeys(page)).toEqual([]);
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys).toContain(`soraban:ops-draft:field-${plan.id}:${memberId}`);
    expect(keys).not.toContain("soraban:ops-current-member");
    // 別の利用者がログインすると、前の利用者の送信待ちが消える
    await signIn(page.request, seeded("a-pilot"));
    await page.goto("/ops");
    await expect(page.getByTestId("ops-today")).toBeVisible();
    await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k), `soraban:ops-draft:field-${plan.id}:${memberId}`)).toBeNull();
    await expect.poll(async () => (await bundleKeys(page)).some((k) => k.startsWith(`${memberId}:`))).toBe(false);
    await manager.dispose();
  });
});

test.describe("Sprint 15 F（再評価）：ログアウトせずに別の利用者がログインしたとき", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("F-1：ホーム以外の画面（計画の一覧）だけを開いてから圏外になっても、前の利用者の先読みの計画は出ない", async ({ page, context }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id);
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await waitSw(page);
    await waitBundle(page, plan.id);
    // ログアウトせずに、別の利用者（閲覧者）でログインし直す
    await context.clearCookies();
    await signIn(page.request, seeded("a-viewer"));
    const viewerId = await memberIdOf(page.request);
    await page.goto("/ops/plans");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("soraban:ops-current-member"))).toBe(viewerId);
    await expect.poll(async () => (await bundleKeys(page)).some((k) => k.endsWith(`:${plan.id}`))).toBe(false);
    await setOnline(page, context, false);
    await page.goto(`/ops/plans/${plan.id}/field`);
    await expect(page.getByTestId("offline-not-saved")).toBeVisible();
    await expect(page.getByText(plan.title)).toHaveCount(0);
    await setOnline(page, context, true);
    await manager.dispose();
  });
});

test.describe("Sprint 15 追加：R-1 飛行後点検の計画への結び付け・U-2 通報の表示", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("R-1：同じ機体・同じ日の 2 つの計画で、一方の計画の飛行後点検は他方を満たさない", async ({ page }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const p1 = await createPlan(manager, aircraft.id, pilot.id);
    const p2 = await createPlan(manager, aircraft.id, pilot.id, { plannedStartAt: `${DAY}T15:00` });
    const post = (planId: string, hm: string, body: Record<string, unknown>) =>
      manager.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T${hm}`, queued: true, ...body } });
    for (const p of [p1, p2]) {
      expect((await post(p.id, "11:00", { kind: "takeoff" })).status()).toBe(201);
      expect((await post(p.id, "11:10", { kind: "landing" })).status()).toBe(201);
    }
    // 計画 1 の現場画面から、飛行後点検（オンラインの入力画面）で保存する
    await page.clock.setFixedTime(at("11:30:00"));
    await openField(page, p1.id);
    await page.getByTestId("field-post-link").click();
    await page.waitForURL(/\/ops\/inspections\/new/);
    await page.getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
    await page.getByRole("button", { name: "すべて正常" }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForURL(new RegExp(`/ops/plans/${p1.id}/field`));
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(page.getByTestId("field-post-state")).toContainText("済");
    // 計画 2（同じ機体・同じ日）は満たされない
    await openField(page, p2.id);
    await expect(page.getByTestId("field-post-state")).toContainText("未");
    expect((await getField(manager, p1.id)).postPendingCount).toBe(0);
    expect((await getField(manager, p2.id)).postPendingCount).toBe(1);
    // 結び付きのない点検（API で planId なし）は、どちらの計画も満たさない
    const r = await manager.post("/api/ops/inspections", { data: { aircraftId: aircraft.id, pilotId: pilot.id, inspectedAt: `${DAY}T11:20`, timing: "post_flight", placeName: "本社", items: ALL_NORMAL } });
    expect(r.status()).toBe(201);
    expect((await getField(manager, p2.id)).postPendingCount).toBe(1);
    await manager.dispose();
  });

  test("BUG-1：計画の操縦者でない操縦者は、他人の計画に点検を結び付けられない（API・画面とも 403。飛行後点検は未のまま）", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aPilot = await apiAs(seeded("a-pilot"));
    const aPilotId = ((await (await aPilot.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    const other = await apiAs(seeded("a-pilot2"));
    const otherPilotId = ((await (await other.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, aircraft.id, aPilotId, { plannedStartAt: `${DAY}T15:30` });
    const post = (hm: string, body: Record<string, unknown>) =>
      aPilot.post(`/api/ops/plans/${plan.id}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T${hm}`, queued: true, ...body } });
    expect((await post("10:35", { kind: "takeoff" })).status()).toBe(201);
    expect((await post("10:45", { kind: "landing" })).status()).toBe(201);
    const r = await other.post("/api/ops/inspections", {
      data: { aircraftId: aircraft.id, pilotId: otherPilotId, inspectedAt: `${DAY}T10:55`, timing: "post_flight", placeName: "本社", items: ALL_NORMAL, planId: plan.id },
    });
    expect(r.status()).toBe(403);
    expect((await other.post(`/api/ops/plans/${plan.id}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T10:56`, queued: true, kind: "check", item: "carry", result: "done" } })).status()).toBe(403);
    expect((await getEvents(manager, plan.id)).filter((e) => e.item === "inspection")).toHaveLength(0);
    expect((await getField(manager, plan.id)).postPendingCount).toBe(1);
    // 画面（URL に他人の計画）から保存しても結び付かない（権限の誤りが出る）
    await signIn(page.request, seeded("a-pilot2"));
    await page.clock.setFixedTime(at("11:30:00"));
    await page.goto(`/ops/inspections/new?planId=${plan.id}&timing=post_flight`);
    await page.getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
    await page.getByRole("button", { name: "すべて正常" }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("権限").first()).toBeVisible();
    expect((await getField(manager, plan.id)).postPendingCount).toBe(1);
    // 計画の操縦者本人は結び付けられる
    const self = await aPilot.post("/api/ops/inspections", {
      data: { aircraftId: aircraft.id, pilotId: aPilotId, inspectedAt: `${DAY}T10:57`, timing: "post_flight", placeName: "本社", items: ALL_NORMAL, planId: plan.id },
    });
    expect(self.status(), await self.text()).toBe(201);
    expect((await getField(manager, plan.id)).postPendingCount).toBe(0);
    for (const c of [manager, aPilot, other]) await c.dispose();
  });

  test("追加の判断：飛行前点検も、同じ機体・同じ日の別の計画の点検や、結び付きのない点検では満たされない", async ({ page }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const p1 = await createPlan(manager, aircraft.id, pilot.id);
    const p2 = await createPlan(manager, aircraft.id, pilot.id, { plannedStartAt: `${DAY}T15:00` });
    const mk = (hm: string, extra: Record<string, unknown> = {}) =>
      manager.post("/api/ops/inspections", { data: { aircraftId: aircraft.id, pilotId: pilot.id, inspectedAt: `${DAY}T${hm}`, timing: "pre_flight", placeName: "本社", items: ALL_NORMAL, ...extra } });
    expect((await mk("10:00")).status()).toBe(201);
    await page.clock.setFixedTime(at("11:30:00"));
    await openField(page, p1.id);
    await expect(page.getByTestId("field-item-state-inspection")).toContainText("未");
    // 現場から点検へ移る導線は planId を渡す
    await expect(page.getByTestId("field-inspection-link")).toHaveAttribute("href", new RegExp(`planId=${p1.id}`));
    expect((await mk("10:05", { planId: p1.id })).status()).toBe(201);
    await openField(page, p1.id);
    await expect(page.getByTestId("field-item-state-inspection")).toContainText("済");
    await openField(page, p2.id);
    await expect(page.getByTestId("field-item-state-inspection")).toContainText("未");
    await manager.dispose();
  });

  test("U-2：通報の根拠に通報日時とそらばんへの記録の時刻が出る。記録が無い計画では、離陸の前に記録する案内が出る", async ({ page }) => {
    const { manager, aircraft, pilot } = await prepare(page);
    const plan = await createPlan(manager, aircraft.id, pilot.id, { flags: ["method_night"] });
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await expect(page.getByTestId("field-report-record-before-takeoff")).toContainText("離陸の前にそらばんへ記録してください");
    // 通報の記録は、確認を依頼した計画にだけできる（12b）
    const rq = await manager.post(`/api/ops/plans/${plan.id}/request-confirmation`, { data: { expectedVersion: plan.version } });
    expect(rq.status(), await rq.text()).toBe(200);
    const fresh = (await (await manager.get(`/api/ops/plans/${plan.id}`)).json()) as { version: number };
    const rr = await manager.post(`/api/ops/plans/${plan.id}/reports`, {
      data: {
        kind: "new",
        expectedPlanVersion: fresh.version,
        manual: { reportedAt: `${DAY}T11:00`, dipsNumber: "FP-S15-0001", confirmedDipsDone: true, confirmedMatchesLatest: true },
        inputs: { flightPurposes: [1], assistantsNumber: 1, plannedMaxTime: 30, flightSpeed: 10, onsiteControlL3: "1", onsiteControlL35: "0", onsiteControl2: "1", mooring: "0" },
      },
    });
    expect([200, 201], await rr.text()).toContain(rr.status());
    await openField(page, plan.id);
    await expect(page.getByTestId("field-report-record-before-takeoff")).toHaveCount(0);
    await expect(page.getByTestId("field-docs-basis-report")).toContainText("通報日時 2027-01-05 11:00");
    await expect(page.getByTestId("field-docs-basis-report")).toContainText("そらばんへの記録");
    // 記録の時刻を離陸より後にした状況（DB の所有者で created_at を動かせるときだけ。CI の db ジョブは DATABASE_URL_UNPOOLED を持つ）
    const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
    if (ownerUrl) {
      const { default: pg } = await import("pg");
      const c = new pg.Client({ connectionString: ownerUrl });
      await c.connect();
      try {
        await c.query("update flight_reports set created_at = $2 where plan_id = $1", [plan.id, at("12:30:00")]);
      } finally {
        await c.end();
      }
      const tk = await manager.post(`/api/ops/plans/${plan.id}/field-events`, { data: { kind: "takeoff", clientEventId: randomUUID(), occurredAt: `${DAY}T11:58`, queued: true } });
      expect(tk.status()).toBe(201);
      await openField(page, plan.id);
      await expect(page.getByTestId("field-docs-state-report")).toContainText("要確認");
      await expect(page.getByTestId("field-docs-basis-report")).toContainText("そらばんへの記録 2027-01-05 12:30");
      await expect(page.getByTestId("field-docs-notes-report")).toContainText("そらばんへの記録が離陸より後");
      // 判定（要確認）と、同じ画面の 12b の欄（DIPS で通報済み）は変えない
      await expect(page.getByTestId("field-report-status")).toContainText("通報済み");
    }
    await manager.dispose();
  });
});
