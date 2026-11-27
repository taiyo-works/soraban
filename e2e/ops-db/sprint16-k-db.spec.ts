import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { collectTapTargets, collectTextSamples, expectContrast, expectFontSize, expectNoHorizontalScroll, expectTapTargets, relativeLuminance, waitForSettledStyles } from "../field-checks";

// Sprint 16-K の E2E-DB（契約 K2-1・K2-3・K2-4。K2-2・K2-5 は 12c・12e・14・15 の既存の E2E が期待値を変えずに通ることで確かめる）。
//   K2-1  現場と圏外の画面 4 つ（今日・現場・点検・日誌）と PWA の新しい版の知らせが新しい部品・現場の値で描かれる（旧い class 0、現場モードの印、56px・18px・7:1）。
//   K2-3  320・375 幅で、先読みの「古い可能性」が出ても状態の帯は 100px 以下。説明は帯の下の field-status-prefetch-stale-help。
//   K2-4  主ボタン（data-variant="primary"）は 1 つの状態に 1 つ（離陸前＝離陸、飛行中＝着陸、着陸後＝離陸。日誌へのリンクは副。§17-20）。現場の動きは 0。日差しの模擬で文字 4.5 以上。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start（本番のビルド）に対して実行する。Service Worker はこの仕様書だけ許可する（sprint15-db と同じ）。
// サーバーの時計は OPS_TEST_NOW（JST 2027-01-05 12:00）。ブラウザの時計は page.clock で合わせる。
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

const createAircraft = async (manager: APIRequestContext): Promise<{ id: string; registrationMark: string }> => {
  const registrationMark = `JUK16${stamp}${seq++}`;
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "現場試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { ...((await r.json()) as { id: string }), registrationMark };
};
const createPilot = async (manager: APIRequestContext): Promise<{ id: string }> => {
  const r = await manager.post("/api/ops/pilots", { data: { fullName: `現場 試験${stamp}${seq++}`, hasLicense: false } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
};
const createPlan = async (ctx: APIRequestContext, aircraftId: string, pilotId: string): Promise<{ id: string; title: string }> => {
  const title = `K16 ${stamp}-${seq++}`;
  const r = await ctx.post("/api/ops/plans", {
    data: { title, aircraftId, pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "現場の空撮", placeName: "試験地点", latitude: HQ.lat, longitude: HQ.lng, flags: [] },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { ...((await r.json()) as { id: string }), title };
};
const openField = async (page: Page, planId: string): Promise<void> => {
  await page.goto(`/ops/plans/${planId}/field`);
  await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
};
const waitSw = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 });
};
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
const prepare = async (page: Page) => {
  const manager = await apiAs(seeded("a-manager"));
  await signIn(page.request, seeded("a-manager"));
  const aircraft = await createAircraft(manager);
  const pilot = await createPilot(manager);
  const plan = await createPlan(manager, aircraft.id, pilot.id);
  return { manager, aircraft, pilot, plan };
};

/** 日差しの模擬（旧 16 の式。g = 0.10）：文字の比が min 以上であること（無効のボタンは除く）。 */
const expectSunlight = async (page: Page, root: string, min: number, label: string): Promise<void> => {
  const G = 0.1;
  const samples = (await collectTextSamples(page, root)).filter((s) => !s.disabled);
  expect(samples.length, `${label}: 文字の標本がない`).toBeGreaterThan(0);
  const bad = samples
    .map((s) => {
      const a = relativeLuminance(s.fg);
      const b = relativeLuminance(s.bg);
      return { s, r: (Math.max(a, b) + 0.05 + G) / (Math.min(a, b) + 0.05 + G) };
    })
    .filter((x) => x.r < min)
    .map((x) => `${x.s.testId ?? x.s.tag}「${x.s.text}」 ${x.r.toFixed(2)}`);
  expect(bad, `${label}: 日差しの模擬で ${min} 未満の文字`).toEqual([]);
};

/** 見えている主ボタン（data-variant="primary"）の data-testid と、data-variant の無い主色の面（選択中の面を除く）の数。 */
const primaryState = async (page: Page, root: string): Promise<{ ids: string[]; stray: number }> =>
  page.evaluate((sel) => {
    const rootEl = document.querySelector(sel);
    const vis = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const ids = Array.from((rootEl ?? document).querySelectorAll('[data-variant="primary"]')).filter(vis).map((e) => e.getAttribute("data-testid") ?? e.tagName.toLowerCase());
    const stray = Array.from((rootEl ?? document).querySelectorAll(".opx-btn-primary:not([data-variant]):not(.opx-btn-flat)")).filter(vis).length;
    return { ids, stray };
  }, root);

/** 現場の動きが 0：遷移・アニメーションの時間が 0、無限のアニメーション 0、操作の後に進行中のアニメーション 0。 */
const expectNoMotion = async (page: Page, root: string, label: string): Promise<void> => {
  await waitForSettledStyles(page);
  const r = await page.evaluate((sel) => {
    const rootEl = document.querySelector(sel);
    const bad: string[] = [];
    const dur = (s: string): number => Math.max(0, ...s.split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) / 1000 : parseFloat(x) || 0)));
    for (const el of Array.from(rootEl?.querySelectorAll<HTMLElement>("*") ?? [])) {
      const cs = getComputedStyle(el);
      if (dur(cs.transitionDuration) > 0 || dur(cs.animationDuration) > 0) bad.push(`${el.getAttribute("data-testid") ?? el.tagName.toLowerCase()} 遷移 ${cs.transitionDuration} / 動き ${cs.animationDuration}`);
      if (cs.animationName !== "none" && cs.animationIterationCount === "infinite") bad.push(`無限の動き ${el.tagName.toLowerCase()}`);
    }
    return { bad: bad.slice(0, 10), running: document.getAnimations().length, mode: document.documentElement.getAttribute("data-mode") };
  }, root);
  expect(r.bad, `${label}: 動きの時間が 0 でない要素`).toEqual([]);
  expect(r.running, `${label}: 進行中のアニメーション`).toBe(0);
};

const LEGACY_SELECTOR =
  '[class*="rounded-sharp"], [class*="bg-paper"], [class*="border-brand"], [class*="text-brand"], [class*="signal-"], [class*="ink-soft"], [class*="ink-mute"], [class*="ring-brand"], [class*="border-rule"], .font-mono';
const expectNoLegacy = async (page: Page, root: string, label: string): Promise<void> => {
  expect(await page.locator(`${root} :is(${LEGACY_SELECTOR})`).count(), `${label}: 旧い名前の class`).toBe(0);
  expect(await page.locator(`${root}:is(${LEGACY_SELECTOR})`).count(), `${label}: 旧い名前の class（根）`).toBe(0);
};
const expectFieldMode = async (page: Page, label: string): Promise<void> => {
  await expect(page.locator("html"), `${label}: 現場モードの印`).toHaveAttribute("data-mode", "field");
};
/** 現場の画面の基準（12c 契約 15）。離陸・着陸は 80、押す部品 56、間 12、本文 18、7:1、日差しで 4.5。 */
const expectFieldStandards = async (page: Page, root: string, label: string, big?: string): Promise<void> => {
  await expectFieldMode(page, label);
  await expectTapTargets(page, root, label, big ? { bigTestId: big } : {});
  await expectFontSize(page, root, 18, label);
  await expectContrast(page, root, 7, label);
  await expectSunlight(page, root, 4.5, label);
  await expectNoHorizontalScroll(page, label);
  await expectNoLegacy(page, root, label);
  await expectNoMotion(page, root, label);
};
const expectOnePrimary = async (page: Page, root: string, id: string, label: string): Promise<void> => {
  const p = await primaryState(page, root);
  expect(p.ids, `${label}: 見えている主ボタン`).toEqual([id]);
  expect(p.stray, `${label}: data-variant の無い主ボタン`).toBe(0);
};

/** 主ボタンが 0（画面に主の操作がない）。 */
const expectNoPrimary = async (page: Page, root: string, label: string): Promise<void> => {
  const p = await primaryState(page, root);
  expect(p.ids, `${label}: 見えている主ボタン`).toEqual([]);
  expect(p.stray, `${label}: data-variant の無い主ボタン`).toBe(0);
};

test.use({ serviceWorkers: "allow", timezoneId: "America/Los_Angeles" });
test.describe.configure({ mode: "serial" });

for (const vp of [
  { name: "320×740", width: 320, height: 740 },
  { name: "375×812", width: 375, height: 812 },
]) {
  test.describe(`K2-3 状態の帯 ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true });

    test(`先読みの「古い可能性」が出ても、帯は 100px 以下（圏外・接続あり）。説明は帯の下の field-status-prefetch-stale-help`, async ({ page, context }) => {
      const { manager, plan } = await prepare(page);
      await page.clock.setFixedTime(at("11:56:00"));
      await openField(page, plan.id);
      await waitSw(page);
      await waitBundle(page, plan.id);
      const band = page.getByTestId("field-status-band");
      // 新しい先読み：古い注記も説明も出ない
      await expect(page.getByTestId("field-status-prefetch")).toContainText("先読みの最終更新");
      await expect(page.getByTestId("field-status-prefetch-stale")).toHaveCount(0);
      await expect(page.getByTestId("field-status-prefetch-stale-help")).toHaveCount(0);
      // 13 時間後（基準 12 時間を超える）に圏外で開く
      await setOnline(page, context, false);
      await page.clock.setFixedTime(new Date(at("12:00:00").getTime() + 13 * 3600_000));
      await page.reload();
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      const stale = page.getByTestId("field-status-prefetch-stale");
      await expect(stale).toBeVisible();
      // 帯の中は短い印と文字だけ（K-7：記号＋文字）。説明は帯の外
      await expect(stale).toHaveText("！古い可能性");
      await expect(band.getByTestId("field-status-prefetch-stale")).toHaveCount(1);
      await expect(band.getByTestId("field-status-prefetch-stale-help")).toHaveCount(0);
      const help = page.getByTestId("field-status-prefetch-stale-help");
      await expect(help).toBeVisible();
      await expect(help).toContainText("電波のある場所で開き直してください");
      await waitForSettledStyles(page);
      const bb = (await band.boundingBox())!;
      // 帯は sticky なので、説明の位置は文書の上端からの距離で比べる（スクロール位置に左右されない）
      const helpTop = await help.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
      test.info().annotations.push({ type: "band-height", description: `${vp.name} 圏外・古い可能性: ${bb.height.toFixed(2)}px` });
      expect(bb.height, `${vp.name} 状態の帯の高さ（古い可能性が出た状態・圏外）`).toBeLessThanOrEqual(100);
      expect(bb.height, "既存の基準（< 140）").toBeLessThan(140);
      expect(helpTop, "説明は帯の下").toBeGreaterThanOrEqual(bb.height - 0.5);
      // 帯の文字は 18px 以上、4 つの項目が帯の外にはみ出さない
      for (const id of ["field-status-connection", "field-status-unsent", "field-status-saved", "field-status-prefetch"]) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.x, id).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width, id).toBeLessThanOrEqual(vp.width + 0.5);
        expect(b.y + b.height, id).toBeLessThanOrEqual(bb.y + bb.height + 0.5);
      }
      await expectNoHorizontalScroll(page, `${vp.name} 古い可能性`);
      await expectFontSize(page, '[data-testid="field-root"]', 18, `${vp.name} 古い可能性`);
      await expectContrast(page, '[data-testid="field-root"]', 7, `${vp.name} 古い可能性`);
      // 接続あり（先読みは古いまま、通信が戻った直後）でも帯は 100px 以下
      await setOnline(page, context, true);
      await expect(page.getByTestId("field-status-connection")).toContainText("接続あり");
      await expect.poll(async () => (await band.boundingBox())!.height, { timeout: 10_000 }).toBeLessThanOrEqual(100);
      test.info().annotations.push({ type: "band-height", description: `${vp.name} 接続あり・古い可能性: ${(await band.boundingBox())!.height.toFixed(2)}px` });
      await manager.dispose();
    });
  });
}

test.describe("K2-1・K2-2・K2-4 現場と圏外の画面 375×812", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("離陸前・飛行中・着陸後と、圏外の点検・日誌・今日が、現場の値・新しい部品・主ボタン 1 つで描かれる", async ({ page, context }) => {
    const { manager, plan } = await prepare(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await waitSw(page);
    await waitBundle(page, plan.id);
    await setOnline(page, context, false);
    await page.reload();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    const FIELD = '[data-testid="field-root"]';

    // 離陸前：主ボタンは「離陸」の 1 つ（確認・保存・リンクは副）
    await expectOnePrimary(page, FIELD, "field-flight-button", "離陸前（圏外）");
    await expect(page.getByTestId("field-flight-button")).toHaveText("離陸");
    await expectFieldStandards(page, FIELD, "離陸前（圏外）", "field-flight-button");
    const takeoff = (await page.getByTestId("field-flight-button").boundingBox())!;
    expect(takeoff.height, "離陸のボタンの高さ").toBeGreaterThanOrEqual(80);

    // 圏外の日常点検（飛行前）：現場の値・主ボタンは保存の 1 つ
    await page.getByTestId("field-inspection-link").click();
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    const OFF = '[data-testid="offline-root"]';
    await expectOnePrimary(page, OFF, "offline-inspection-save", "圏外の点検");
    await expectFieldStandards(page, OFF, "圏外の点検");
    await page.getByTestId("offline-inspection-battery-abnormal").click();
    await expectOnePrimary(page, OFF, "offline-inspection-save", "圏外の点検（異常を選んだ後）");
    await expect(page.getByTestId("offline-inspection-note-battery")).toBeVisible();
    await expectFieldStandards(page, OFF, "圏外の点検（異常を選んだ後）");
    await page.getByTestId("offline-inspection-all-normal").click();
    await page.getByTestId("offline-inspection-save").click();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();

    // 飛行中：主ボタンは「着陸」の 1 つ
    const btn = page.getByTestId("field-flight-button");
    await btn.click();
    await expect(btn).toHaveText("着陸");
    await expectOnePrimary(page, FIELD, "field-flight-button", "飛行中");
    await expectFieldStandards(page, FIELD, "飛行中", "field-flight-button");
    // 着陸後（日誌が未記入）：主ボタンは「離陸」の 1 つ（§17-20。日誌へのリンクは副。並びは日誌が先）
    await page.clock.setFixedTime(at("11:58:05"));
    await page.waitForTimeout(1600);
    await btn.click();
    await expect(btn).toHaveText("離陸");
    await expect(page.getByTestId("field-journal-link")).toBeVisible();
    await expectOnePrimary(page, FIELD, "field-flight-button", "着陸後（日誌が未記入）");
    await expect(btn).toHaveAttribute("data-variant", "primary");
    await expect(page.getByTestId("field-journal-link")).not.toHaveAttribute("data-variant", "primary");
    await expectFieldStandards(page, FIELD, "着陸後（日誌が未記入）", "field-flight-button");

    // 圏外の日誌
    await page.getByTestId("field-journal-link").click();
    await expect(page.getByTestId("offline-journal-times")).toHaveText("11:56 → 11:58");
    await expectOnePrimary(page, OFF, "offline-journal-save", "圏外の日誌");
    await expectFieldStandards(page, OFF, "圏外の日誌");
    await page.getByTestId("offline-journal-safety-yes").click();
    await expect(page.getByTestId("offline-journal-safety-detail")).toBeVisible();
    await expectOnePrimary(page, OFF, "offline-journal-save", "圏外の日誌（あり）");
    await expectFieldStandards(page, OFF, "圏外の日誌（あり）");
    await page.getByTestId("offline-journal-safety-no").click();
    await page.getByTestId("offline-journal-save").click();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(page.getByTestId("field-flight-row")).toHaveAttribute("data-phase", "journaled");
    // 日誌まで済んだ後：主ボタンは「離陸」の 1 つ（次の飛行）
    await expectOnePrimary(page, FIELD, "field-flight-button", "日誌の後");
    await expectFieldStandards(page, FIELD, "日誌の後", "field-flight-button");

    // 圏外の「今日」（先読み済みの計画の一覧）と、行えない画面、保存されていない計画
    await page.goto("/ops");
    await expect(page.getByTestId("offline-today-plan").first()).toBeVisible();
    await expectNoPrimary(page, OFF, "圏外の今日");
    await expectFieldStandards(page, OFF, "圏外の今日");
    await page.goto("/ops/plans/new");
    await expect(page.getByTestId("offline-unavailable")).toBeVisible();
    await expectNoPrimary(page, OFF, "圏外では行えない画面");
    await expectFieldStandards(page, OFF, "圏外では行えない画面");
    await page.goto(`/ops/plans/00000000-0000-4000-8000-000000000000/field`);
    await expect(page.getByTestId("offline-not-saved")).toBeVisible();
    await expectNoPrimary(page, OFF, "保存されていない計画");
    await expectFieldStandards(page, OFF, "保存されていない計画");

    expect(pageErrors, "圏外の枠の水和の誤り").toEqual([]);
    await setOnline(page, context, true);
    await manager.dispose();
  });

  test("K2-1：新しい版の知らせ（pwa-update）は新しい部品で、主ボタンを足さない。押す部品は 48px 以上", async ({ page }) => {
    await prepare(page);
    await page.goto("/ops");
    await expect(page.getByTestId("today-heading")).toBeVisible();
    const before = (await primaryState(page, "body")).ids;
    expect(before.length, "ホームの主ボタン").toBe(1);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("soraban:new-version", { detail: { build: "x" } })));
    const box = page.getByTestId("pwa-update");
    await expect(box).toBeVisible();
    await waitForSettledStyles(page);
    expect(await box.getAttribute("class")).toContain("opx-box");
    expect(await page.getByTestId("pwa-update-button").getAttribute("class")).toContain("opx-btn");
    expect(await page.getByTestId("pwa-update-button").getAttribute("data-variant")).toBeNull();
    expect((await primaryState(page, "body")).ids, "知らせが出ても主ボタンは増えない").toEqual(before);
    const tap = (await collectTapTargets(page, '[data-testid="pwa-update"]'))[0]!;
    expect(tap.height).toBeGreaterThanOrEqual(48);
    await expect(page.getByTestId("pwa-update")).toContainText("新しい版があります");
    expect(await page.locator(`[data-testid="pwa-update"], [data-testid="pwa-update"] *`).evaluateAll((els, sel) => els.filter((e) => e.matches(sel)).length, LEGACY_SELECTOR)).toBe(0);
  });
});


// ---- fix1：主ボタンの数え方（N-6）と、帯・警告・説明の並び（R-1）・読み上げの結び付き（N-1） ----------------------------------
const postFieldEvent = async (ctx: APIRequestContext, planId: string, body: Record<string, unknown>, hm: string): Promise<void> => {
  const r = await ctx.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T${hm}`, ...body } });
  expect(r.status(), await r.text()).toBe(201);
};
const landTwice = async (manager: APIRequestContext, planId: string): Promise<void> => {
  await postFieldEvent(manager, planId, { kind: "takeoff" }, "11:55");
  await postFieldEvent(manager, planId, { kind: "landing" }, "11:56");
  await postFieldEvent(manager, planId, { kind: "takeoff" }, "11:57");
  await postFieldEvent(manager, planId, { kind: "landing" }, "11:58");
};

test.describe("fix1 N-6 主ボタンの数え方 375×812", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
  const FIELD = '[data-testid="field-root"]';

  test("着陸後で日誌が未記入の飛行が 2 件以上：主ボタンは離陸の 1 つ、日誌へのリンクは副", async ({ page }) => {
    const { manager, plan } = await prepare(page);
    await landTwice(manager, plan.id);
    await openField(page, plan.id);
    await expect(page.getByTestId("field-journal-link")).toHaveCount(2);
    await expect(page.getByTestId("field-flight-button")).toHaveText("離陸");
    await expectOnePrimary(page, FIELD, "field-flight-button", "日誌未記入 2 件");
    await expect(page.locator('[data-testid="field-journal-link"][data-variant="primary"]')).toHaveCount(0);
    await manager.dispose();
  });

  test("日誌を書けない人（閲覧者）が、着陸した飛行のある計画を開く：主ボタンは 1 つ以下で、日誌へのリンクは主にならない", async ({ page }) => {
    const { manager, plan } = await prepare(page);
    await landTwice(manager, plan.id);
    await signIn(page.request, seeded("a-viewer"));
    await openField(page, plan.id);
    await expect(page.getByTestId("field-journal-none")).toBeVisible();
    await expect(page.getByTestId("field-journal-link")).toHaveCount(0);
    const p = await primaryState(page, FIELD);
    expect(p.ids.length, "見えている主ボタン").toBeLessThanOrEqual(1);
    expect(p.ids.filter((x) => x === "field-journal-link")).toEqual([]);
    expect(p.stray).toBe(0);
    await manager.dispose();
  });

  test("計画の中止後（着陸した飛行あり・日誌未記入）：主ボタンは離陸の 1 つ（押せない）", async ({ page }) => {
    const { manager, plan } = await prepare(page);
    await landTwice(manager, plan.id);
    const v = (await (await manager.get(`/api/ops/plans/${plan.id}`)).json()) as { version: number };
    expect((await manager.post(`/api/ops/plans/${plan.id}/void`, { data: { expectedVersion: v.version, reason: "試験" } })).status()).toBe(200);
    await openField(page, plan.id);
    await expect(page.getByTestId("field-cancelled")).toBeVisible();
    await expect(page.getByTestId("field-flight-button")).toBeDisabled();
    await expectOnePrimary(page, FIELD, "field-flight-button", "中止後");
    await expect(page.locator('[data-testid="field-journal-link"][data-variant="primary"]')).toHaveCount(0);
    await manager.dispose();
  });
});

test.describe("fix1 R-1・N-1 警告と説明の並び 375×812", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("緊急用務空域が指定されていて先読みが古い：並びは 帯 → 警告 → 説明 → header。説明は古い可能性の印と aria-describedby で結ぶ", async ({ page, context }) => {
    const { manager, plan } = await prepare(page);
    await postFieldEvent(manager, plan.id, { kind: "check", item: "emergency_airspace", result: "designated", source: "mlit-emergency-airspace-qa" }, "11:55");
    await page.clock.setFixedTime(at("11:56:00"));
    await openField(page, plan.id);
    await waitSw(page);
    await waitBundle(page, plan.id);
    await setOnline(page, context, false);
    await page.clock.setFixedTime(new Date(at("12:00:00").getTime() + 13 * 3600_000));
    await page.reload();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    const warn = page.getByTestId("field-emergency-warning");
    const help = page.getByTestId("field-status-prefetch-stale-help");
    await expect(warn).toBeVisible();
    await expect(help).toBeVisible();
    await waitForSettledStyles(page);
    // 帯は sticky なので、文書の上端からの距離（top・bottom）で並びを比べる
    const docBox = (id: string) => page.getByTestId(id).evaluate((e) => ({ top: e.getBoundingClientRect().top + window.scrollY, bottom: e.getBoundingClientRect().bottom + window.scrollY }));
    const bandH = (await page.getByTestId("field-status-band").boundingBox())!.height;
    const w = await docBox("field-emergency-warning");
    const h = await docBox("field-status-prefetch-stale-help");
    const head = await docBox("field-plan-title");
    expect(w.top, "警告は帯の下").toBeGreaterThanOrEqual(bandH - 0.5);
    expect(h.top, "説明は警告より下").toBeGreaterThanOrEqual(w.bottom - 0.5);
    expect(head.top, "header は説明より下").toBeGreaterThanOrEqual(h.bottom - 0.5);
    await expect(page.getByTestId("field-status-prefetch-stale")).toHaveAttribute("aria-describedby", "field-status-prefetch-stale-help");
    await expect(help).toHaveAttribute("id", "field-status-prefetch-stale-help");
    await expect(help).toHaveAttribute("role", "status");
    await setOnline(page, context, true);
    await manager.dispose();
  });
});

// 16-K 差し戻し 1（fix designer）R-1：文字 200%（html の文字の大きさ）で、帯の「先読みの最終更新 日時」が横スクロール・日時の切れを起こさない。
// 帯が古い状態（圏外・13 時間後）と新しい状態（接続あり）の両方で測る。固定（sticky）は、等倍で sticky、文字 200% で static（意見 8）。
// （16-N3 N3-2 で、320 も文書の scrollWidth を確かめる。以前は 320 の既存の幅 368px が残っていたため除外していた。）
type ZoomProbe = { sw: number; cw: number; bandH: number; bandSw: number; bandCw: number; bandPos: string; overflow: string[]; wide: string[]; dateRects: number; dateText: string };
const probeZoomBand = async (page: Page, width: number): Promise<ZoomProbe> => {
  const orig = page.viewportSize()!;
  await page.setViewportSize({ width, height: orig.height });
  await waitForSettledStyles(page);
  try {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    return await page.evaluate(() => {
      const de = document.documentElement;
      const band = document.querySelector<HTMLElement>('[data-testid="field-status-band"]')!;
      const overflow: string[] = [];
      for (const el of Array.from(band.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > de.clientWidth + 0.5 || r.left < -0.5)) overflow.push(`${el.getAttribute("data-testid") ?? el.tagName.toLowerCase()} ${r.left.toFixed(1)}〜${r.right.toFixed(1)}（画面 ${de.clientWidth}）`);
      }
      const wide: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > de.clientWidth + 0.5) wide.push(`${el.getAttribute("data-testid") ?? el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} →${r.right.toFixed(0)}`);
      }
      const date = (document.querySelector<HTMLElement>('[data-testid="field-status-prefetch"] > span > span:last-child') ?? document.querySelector<HTMLElement>('[data-testid="field-status-prefetch"] > span'))!;
      return {
        sw: de.scrollWidth,
        cw: de.clientWidth,
        bandH: band.getBoundingClientRect().height,
        bandSw: band.scrollWidth,
        bandCw: band.clientWidth,
        bandPos: getComputedStyle(band).position,
        overflow,
        wide: wide.slice(0, 8),
        dateRects: date.getClientRects().length,
        dateText: date.textContent ?? "",
      };
    });
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.setViewportSize(orig);
  }
};

for (const w of [320, 375, 390, 430]) {
  test.describe(`fix R-1 文字 200% の帯 ${w}`, () => {
    test.use({ viewport: { width: w, height: 800 }, hasTouch: true });

    test(`帯が新しい（接続あり）・古い（圏外）・古いまま接続あり、のどれでも、帯の中身がはみ出さず、日時は割れない（文字 200%・${w}px）。固定は等倍 sticky・200% static`, async ({ page, context }) => {
      const { manager, plan } = await prepare(page);
      await page.clock.setFixedTime(at("11:56:00"));
      await openField(page, plan.id);
      await waitSw(page);
      await waitBundle(page, plan.id);
      const check = async (state: string): Promise<void> => {
        const band = page.getByTestId("field-status-band");
        // 等倍：sticky、帯は 100px 以下（320・375）
        await waitForSettledStyles(page);
        expect(await band.evaluate((e) => getComputedStyle(e).position), `${w} ${state} 等倍の帯`).toBe("sticky");
        if (w <= 375) expect((await band.boundingBox())!.height, `${w} ${state} 等倍の帯の高さ`).toBeLessThanOrEqual(100);
        const z = await probeZoomBand(page, w);
        test.info().annotations.push({ type: "zoom200", description: `${w} ${state}: 帯 ${z.bandH.toFixed(1)}px・文書 scrollWidth ${z.sw}/${z.cw}・帯 ${z.bandSw}/${z.bandCw}・日時 ${z.dateText}（${z.dateRects} 片）・position ${z.bandPos}` });
        expect(z.overflow, `${w} ${state} 文字 200%：帯の中で画面からはみ出す要素`).toEqual([]);
        expect(z.bandSw, `${w} ${state} 文字 200%：帯の横スクロール`).toBeLessThanOrEqual(z.bandCw);
        expect(z.dateRects, `${w} ${state} 文字 200%：日時（${z.dateText}）は途中で割れない`).toBe(1);
        expect(z.bandPos, `${w} ${state} 文字 200%：帯の固定を外す（意見 8）`).toBe("static");
        // 16-N3 N3-2：320 も含めて文書の横スクロール 0（以前は 320 を除外していた。見出し・「ホームへ戻る」・状態の語が 368px まで出ていた）
        expect(z.sw, `${w} ${state} 文字 200%：現場の横スクロール（画面より右にはみ出す要素 ${z.wide.join(" / ")}）`).toBeLessThanOrEqual(z.cw);
      };
      await expect(page.getByTestId("field-status-prefetch-stale")).toHaveCount(0);
      await check("新しい先読み・接続あり");
      await setOnline(page, context, false);
      await page.clock.setFixedTime(new Date(at("12:00:00").getTime() + 13 * 3600_000));
      await page.reload();
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      await expect(page.getByTestId("field-status-prefetch-stale")).toBeVisible();
      await check("古い先読み・圏外");
      await setOnline(page, context, true);
      await expect(page.getByTestId("field-status-connection")).toContainText("接続あり");
      await check("古い先読み・接続あり");
      await manager.dispose();
    });
  });
}
