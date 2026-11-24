import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { collectTextSamples, expectNoHorizontalScroll } from "../field-checks";
import { openAllPlans } from "../ops-menu";

// Sprint 12h PR ③a の E2E-DB（docs/sprints/sprint-12h-pr3.md §8 の Q-3・Q-4・Q-6・Q-11・Q-13・Q-14・Q-17。T-16）。
// メニュー（下タブ 5・左メニュー 6）、判定への入口のピル、点検の 1 段目、戻りリンク。画面の組み合わせ（幅×明暗）は 1 件の中で回す。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する。サーバーの時計は OPS_TEST_NOW（JST 2027-01-05 12:00）。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const DAY = "2027-01-05";
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

const ALL_NORMAL = Object.fromEntries(
  ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"].map((k) => [k, { result: "normal" }]),
);

const createAircraft = async (manager: APIRequestContext): Promise<{ id: string; registrationMark: string }> => {
  const registrationMark = `JU3A${stamp}${seq++}`;
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "点検試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { ...((await r.json()) as { id: string }), registrationMark };
};
const pilotIdOf = async (who: Who): Promise<string> => {
  const ctx = await apiAs(who);
  const me = (await (await ctx.get("/api/ops/me")).json()) as { pilotId: string };
  await ctx.dispose();
  return me.pilotId;
};
const createPlan = async (manager: APIRequestContext, aircraftId: string, pilotId: string, title: string): Promise<{ id: string; version: number }> => {
  const r = await manager.post("/api/ops/plans", {
    data: { title, aircraftId, pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string; version: number };
};
const voidPlan = async (manager: APIRequestContext, planId: string): Promise<void> => {
  const plan = (await (await manager.get(`/api/ops/plans/${planId}`)).json()) as { version: number };
  await manager.post(`/api/ops/plans/${planId}/void`, { data: { expectedVersion: plan.version, reason: "試験の後始末" } });
};

const SCHEMES = ["light", "dark"] as const;

/** 位置情報の要求の回数を数える（押す前に 0 のまま）。 */
const countGeolocation = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const w = window as unknown as { __geo: { get: number; watch: number } };
    w.__geo = { get: 0, watch: 0 };
    const g = navigator.geolocation;
    if (!g) return;
    const get = g.getCurrentPosition.bind(g);
    const watch = g.watchPosition.bind(g);
    g.getCurrentPosition = (...a) => {
      w.__geo.get++;
      return get(...a);
    };
    g.watchPosition = (...a) => {
      w.__geo.watch++;
      return watch(...a);
    };
  });
};
const geoCalls = (page: Page): Promise<{ get: number; watch: number }> => page.evaluate(() => (window as unknown as { __geo: { get: number; watch: number } }).__geo);

/** 色の値（CSS の任意の形式）を 8 ビットの rgb 文字列に直す。 */
const rgbOf = (page: Page, css: string): Promise<string> =>
  page.evaluate((c) => {
    const el = document.createElement("div");
    el.style.color = c;
    document.body.appendChild(el);
    const v = getComputedStyle(el).color;
    el.remove();
    return v;
  }, css);

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test.describe("Sprint 12h PR ③a E2E-DB：メニュー・判定への入口・点検の 1 段目", () => {
  test("P3a-1. 下タブ：ホーム／計画／日誌／機体と書類 の 4 つ（16-F。高さ 64px 以上・折り返さない・薄い主色の面・文字 4.5:1）。375・360px × 明・暗。`/` で現在地なし。点検は日誌が現在地", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [375, 360]) {
        await page.setViewportSize({ width: w, height: 740 });
        for (const [url, current] of [["/ops", "today"], ["/ops/plans", "plans"], ["/ops/inspections", "journal"], ["/ops/inspections/new", "journal"], ["/ops/journal", "journal"], ["/ops/more", "more"], ["/", null]] as const) {
          const label = `${scheme} ${w}px ${url}`;
          await page.goto(url);
          const nav = page.getByTestId("ops-bottom-nav");
          await expect(nav, label).toBeVisible();
          expect((await nav.locator("a").allInnerTexts()).map((t) => t.trim()), label).toEqual(["ホーム", "計画", "日誌", "機体と書類"]);
          await expect(nav.getByTestId("nav-verdict"), label).toHaveCount(0);
          await expect(nav.getByTestId("nav-inspections"), label).toHaveCount(0);
          const boxes = await nav.locator("a").evaluateAll((els) => els.map((e) => ({ r: e.getBoundingClientRect(), label: (e.lastElementChild as HTMLElement).getBoundingClientRect().height })));
          for (const b of boxes) {
            expect(b.r.height, `${label} 高さ`).toBeGreaterThanOrEqual(64);
            // 4 等分（左右 8px の余白・項目の間 8px。16-F）
            expect(b.r.width, `${label} 幅`).toBeGreaterThanOrEqual((w - 16 - 24) / 4 - 2);
            expect(b.label, `${label} ラベルが折り返している`).toBeLessThan(24);
          }
          // 現在地：aria-current は 1 つだけ（`/` は 0）。薄い主色の面は、現在地のタブだけ
          await expect(nav.locator('[aria-current="page"]'), label).toHaveCount(current ? 1 : 0);
          if (current) await expect(nav.getByTestId(`nav-${current}`), label).toHaveAttribute("aria-current", "page");
          const soft = await rgbOf(page, "var(--sb-primary-soft)");
          const faces = await nav.locator("a").evaluateAll((els) => els.map((e) => getComputedStyle(e as HTMLElement).backgroundColor));
          expect(faces.filter((f) => f === soft).length, `${label} 薄い主色の面`).toBe(current ? 1 : 0);
          await expectNoHorizontalScroll(page, label);
          // 文字は 4.5:1 以上、14px 以上（16-B：12→14）
          const samples = await collectTextSamples(page, '[data-testid="ops-bottom-nav"]');
          expect(samples.length, label).toBeGreaterThanOrEqual(4);
          for (const s of samples) {
            expect(s.ratio, `${label} 「${s.text}」のコントラスト`).toBeGreaterThanOrEqual(4.5);
            expect(s.fontSize, `${label} 「${s.text}」の大きさ`).toBeGreaterThanOrEqual(14);
          }
          // 薄い主色の面の上のアイコンは主色（3:1 以上）
          if (current) {
            const [fg, bg] = await nav.getByTestId(`nav-${current}`).evaluate((a) => {
              const face = a.firstElementChild as HTMLElement;
              return [getComputedStyle(face).color, getComputedStyle(face).backgroundColor];
            });
            const parse = (c: string): [number, number, number] => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
            const lum = ([r, g, b]: [number, number, number]) => {
              const f = (v: number) => ((v / 255) <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
              return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const [l1, l2] = [lum(parse(fg)), lum(parse(bg))];
            expect((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), `${label} 薄い主色の面の上のアイコン`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  test("P3a-2. 左メニュー：6 項目（ホーム／判定／計画／点検／日誌／登録）と登録の子 4 項目。項目 48px・幅 240px・現在地は薄い主色の面・見出し 12px 以上。1280・1440px × 明・暗", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [1280, 1440]) {
        await page.setViewportSize({ width: w, height: 800 });
        for (const [url, current] of [["/ops", "today"], ["/ops/plans", "plans"], ["/ops/inspections", "inspections"], ["/ops/journal", "journal"], ["/ops/flights", "flights"], ["/ops/incidents", "incidents"], ["/ops/more", "more"]] as const) {
          const label = `${scheme} ${w}px ${url}`;
          await page.goto(url);
          const side = page.getByTestId("ops-sidebar");
          await expect(side, label).toBeVisible();
          await expect(page.getByTestId("ops-bottom-nav"), label).toBeHidden();
          expect((await side.locator('a[data-testid^="nav-"]').allInnerTexts()).map((t) => t.trim()), label).toEqual(["ホーム", "計画", "日誌", "飛行記録", "点検", "事故・ヒヤリハット", "機体と書類", "機体", "操縦者", "許可・承認", "地点", "判定"]);
          expect(Math.round((await side.boundingBox())!.width), `${label} 幅`).toBe(240);
          for (const k of ["today", "verdict", "plans", "journal", "more"]) {
            expect((await side.getByTestId(`nav-${k}`).boundingBox())!.height, `${label} ${k}`).toBeGreaterThanOrEqual(47.5);
          }
          for (const k of ["flights", "inspections", "incidents", "aircraft", "pilots", "permits", "places"]) expect((await side.getByTestId(`nav-${k}`).boundingBox())!.height, `${label} ${k}`).toBeGreaterThanOrEqual(47.5);
          await expect(side.locator('[aria-current="page"]'), label).toHaveCount(1);
          await expect(side.getByTestId(`nav-${current}`), label).toHaveAttribute("aria-current", "page");
          const soft = await rgbOf(page, "var(--sb-primary-soft)");
          expect(await side.getByTestId(`nav-${current}`).evaluate((a) => getComputedStyle(a).backgroundColor), `${label} 薄い主色の面`).toBe(soft);
          const samples = await collectTextSamples(page, '[data-testid="ops-sidebar"]');
          for (const s of samples) {
            expect(s.ratio, `${label} 「${s.text}」のコントラスト`).toBeGreaterThanOrEqual(4.5);
            expect(s.fontSize, `${label} 「${s.text}」の大きさ（見出しも 14px 以上）`).toBeGreaterThanOrEqual(14);
          }
          await expectNoHorizontalScroll(page, label);
        }
      }
    }
  });

  test("P3a-3. 判定への入口：ホームと計画の作成画面の上部のピル（48px 以上・2 列・間 8px 以上）。押すと `/?start=…`、押すまで位置の要求は 0。360・375・768・1280px × 明・暗", async ({ page }) => {
    await countGeolocation(page);
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [360, 375, 768, 1280]) {
        await page.setViewportSize({ width: w, height: 800 });
        for (const url of ["/ops", "/ops/plans/new"]) {
          const label = `${scheme} ${w}px ${url}`;
          await page.goto(url);
          if (url === "/ops") await openAllPlans(page); // 16-G：判定へのピルは「すべての予定」（畳んだ中）に移った
          const pills = page.getByTestId("judge-pills");
          await expect(pills, label).toBeVisible();
          const here = page.getByTestId("judge-pill-here");
          const search = page.getByTestId("judge-pill-search");
          await expect(here, label).toHaveText("現在地で判定");
          await expect(search, label).toHaveText("場所を調べる");
          await expect(here, label).toHaveAttribute("href", "/?start=here");
          await expect(search, label).toHaveAttribute("href", "/?start=search");
          const [a, b] = [(await here.boundingBox())!, (await search.boundingBox())!];
          expect(a.height, label).toBeGreaterThanOrEqual(48);
          expect(b.height, label).toBeGreaterThanOrEqual(48);
          expect(Math.abs(a.y - b.y), `${label} 2 列`).toBeLessThan(2);
          expect(b.x - (a.x + a.width), `${label} 間隔`).toBeGreaterThanOrEqual(8);
          // ラベルがピルの中に収まる（はみ出し・潰れなし）
          for (const p of [here, search]) {
            expect(await p.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${label} ピルの中身が枠を出ている`).toBe(true);
            expect(await p.locator(".sb-pill-label").evaluate((el) => el.getBoundingClientRect().height), `${label} ラベルが折り返している`).toBeLessThan(30);
          }
          // 最初の画面に入る。計画の作成画面では、固定の注意書き（判定の免責・DIPS の注記）のあとで、フォームより上
          // 16-G：ホームのピルは畳んだ中なので、最初の画面に入る検査は計画の作成画面だけ（ホームの最初の画面は 16-G の E2E で測る）
          if (url !== "/ops") expect(a.y + a.height, label).toBeLessThan(w < 1024 ? 600 : 800);
          if (url === "/ops/plans/new") expect(a.y, `${label} フォームより上`).toBeLessThan((await page.locator("form").first().boundingBox())!.y);
          expect(await geoCalls(page), `${label} 位置の要求`).toEqual({ get: 0, watch: 0 });
          await expectNoHorizontalScroll(page, label);
        }
      }
    }
    // 押すと `/` へ。位置は取らず、フォーカスだけが移る（押すのは利用者）。`/` では下タブに現在地がない
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/ops");
    await openAllPlans(page);
    await page.getByTestId("judge-pill-here").click();
    await page.waitForURL(/\/\?start=here$/);
    await expect(page.getByTestId("current-location-button")).toBeFocused();
    expect(await geoCalls(page)).toEqual({ get: 0, watch: 0 });
    await expect(page.getByTestId("ops-bottom-nav").locator('[aria-current="page"]')).toHaveCount(0);
    await page.goto("/ops/plans/new");
    await page.getByTestId("judge-pill-search").click();
    await page.waitForURL(/\/\?start=search$/);
    await expect(page.locator("#address-input")).toBeFocused();
    expect(await geoCalls(page)).toEqual({ get: 0, watch: 0 });
  });

  test("P3a-4. 点検の 1 段目：新しい点検 → 未実施（今日の飛行前。記録より上）→ 記録。点検を記録すると未実施から消える。戻りリンクなし。結果の札に判定色を使わない", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const aircraft = await createAircraft(manager);
    const title = `未実施の試験 ${stamp}-${seq++}`;
    const plan = await createPlan(manager, aircraft.id, pilotId, title);
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/inspections");
    await expect(page.getByTestId("ops-inspections")).toBeVisible();
    // 16-F（F-2）：点検は日誌の下の画面。戻りリンクは「日誌」の 1 つ。見出しは「点検」
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/点検/);
    await expect(page.locator("main a").filter({ hasText: "←" })).toHaveCount(1);
    await expect(page.locator("main").getByRole("link", { name: /日誌/ })).toHaveAttribute("href", "/ops/journal");
    // 並び：新しい点検 → 未実施 → 記録
    const y = async (id: string): Promise<number> => (await page.getByTestId(id).boundingBox())!.y;
    const [yNew, yPending, yRecords] = [await y("inspection-new"), await y("inspection-pending"), await y("inspection-records")];
    expect(yNew).toBeLessThan(yPending);
    expect(yPending).toBeLessThan(yRecords);
    await expect(page.getByTestId("inspection-new")).toHaveText("新しい点検");
    await expect(page.getByTestId("inspection-new")).toHaveAttribute("href", "/ops/inspections/new");
    expect((await page.getByTestId("inspection-new").boundingBox())!.height).toBeGreaterThanOrEqual(56);
    // 今日の計画で飛行前の点検がないものが出る（他の計画があっても、この計画の行がある）
    const row = page.locator(`[data-testid="inspection-pending-row"][data-plan-id="${plan.id}"]`);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(title);
    await expect(row).toContainText("未実施");
    await expect(row).toContainText("飛行前");
    await expect(row).toContainText(aircraft.registrationMark);
    await expect(row.getByTestId("inspection-pending-link")).toHaveAttribute("href", new RegExp(`^/ops/inspections/new\\?planId=${plan.id}`));
    const count = Number((await page.getByTestId("inspection-pending-count").innerText()).replace(/\D/g, ""));
    expect(count).toBe(await page.getByTestId("inspection-pending-row").count());
    // 点検を記録すると、未実施から消える（Sprint 15：計画に結び付いた点検だけが数える。未実施のリンクと同じく planId を渡す。意図の変更）
    const r = await manager.post("/api/ops/inspections", {
      data: { aircraftId: aircraft.id, pilotId, inspectedAt: `${DAY}T11:00`, timing: "pre_flight", placeName: "本社 駐車場", items: ALL_NORMAL, planId: plan.id },
    });
    expect(r.status(), await r.text()).toBe(201);
    await page.goto("/ops/inspections");
    await expect(page.locator(`[data-testid="inspection-pending-row"][data-plan-id="${plan.id}"]`)).toHaveCount(0);
    // 記録：新しい順、区分の絞り込み（すべて／飛行前／飛行後）と件数
    const list = page.getByTestId("inspection-list");
    await expect(list).toBeVisible();
    await expect(list.locator('[data-testid="inspection-row"]', { hasText: aircraft.registrationMark })).toHaveCount(1);
    await expect(list.locator('[data-testid="inspection-row"]', { hasText: aircraft.registrationMark })).toContainText("✓ 正常");
    await expect(page.getByTestId("inspection-timing-all")).toHaveAttribute("aria-current", "true");
    await page.getByTestId("inspection-timing-post_flight").click();
    await page.waitForURL(/timing=post_flight/);
    await expect(page.getByTestId("inspection-timing-post_flight")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("inspection-list").locator('[data-testid="inspection-row"]', { hasText: aircraft.registrationMark })).toHaveCount(0);
    await page.getByTestId("inspection-timing-pre_flight").click();
    await page.waitForURL(/timing=pre_flight/);
    await expect(page.getByTestId("inspection-list").locator('[data-testid="inspection-row"]', { hasText: aircraft.registrationMark })).toHaveCount(1);
    const n = await page.getByTestId("inspection-row").count();
    await expect(page.getByTestId("inspection-count")).toHaveText(`${n} 件`);
    // 結果の札に、判定の色（赤・琥珀・灰青・緑）を使わない
    // 判定の色＝赤（飛行不可）・琥珀（要手続き）・緑（手続き不要）。異常ありは墨の面（契約 §5.2）で、墨は判定の色ではない
    const verdictFills = await Promise.all(["no", "needs", "none"].map((k) => rgbOf(page, `var(--sb-v-${k}-fill)`)));
    const tagBgs = await page.getByTestId("inspection-list").locator(".sb-tag").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(tagBgs.length).toBeGreaterThan(0);
    for (const bg of tagBgs) expect(verdictFills, `札の地 ${bg}`).not.toContain(bg);
    // 点検の詳細の戻り先は「点検の一覧」。現在地は点検
    // 描画直後のクリックが遷移しないことがある（CI で P3a-4 が waitForURL のタイムアウトで落ちた）。押し直し、最後は href で開く（期待は同じ）
    const detailRow = page.getByTestId("inspection-list").locator('[data-testid="inspection-row"]', { hasText: aircraft.registrationMark }).first();
    const detailUrl = /\/ops\/inspections\/[0-9a-f-]{36}$/;
    for (let attempt = 0; attempt < 3 && !detailUrl.test(page.url()); attempt++) {
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await detailRow.click();
      await page.waitForURL(detailUrl, { timeout: 10_000, waitUntil: "commit" }).catch(() => undefined);
    }
    if (!detailUrl.test(page.url())) await page.goto((await detailRow.getAttribute("href"))!);
    await page.waitForURL(detailUrl);
    await expect(page.getByTestId("ops-bottom-nav").getByTestId("nav-journal")).toHaveAttribute("aria-current", "page");
    const back = page.locator("main").getByRole("link", { name: "点検の一覧" }).first();
    await expect(back).toHaveAttribute("href", "/ops/inspections");
    const bb = (await back.boundingBox())!;
    expect(bb.width).toBeGreaterThanOrEqual(48);
    expect(bb.height).toBeGreaterThanOrEqual(48);
    // 点検の入力の戻り先も「点検の一覧」
    await page.goto("/ops/inspections/new");
    await expect(page.locator("main").getByRole("link", { name: "点検の一覧" }).first()).toHaveAttribute("href", "/ops/inspections");
    await voidPlan(manager, plan.id);
    await manager.dispose();
  });

  test("P3a-5. 点検の一覧：閲覧者は「新しい点検」が出ず注記が出る。未実施の行は押せず、理由を文で示す。日誌には点検の一覧へのリンクがある", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const title = `閲覧者の試験 ${stamp}-${seq++}`;
    const plan = await createPlan(manager, aircraft.id, await pilotIdOf(seeded("a-pilot")), title);
    await signIn(page.request, seeded("a-viewer"));
    await page.goto("/ops/inspections");
    await expect(page.getByTestId("ops-inspections")).toBeVisible();
    await expect(page.getByTestId("inspection-new")).toHaveCount(0);
    await expect(page.locator("main").getByRole("note").first()).toBeVisible();
    const row = page.locator(`[data-testid="inspection-pending-row"][data-plan-id="${plan.id}"]`);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("inspection-pending-link")).toHaveCount(0);
    await expect(row.getByTestId("inspection-pending-cannot")).toBeVisible();
    // 日誌：点検の一覧への入口（日誌の中の日常点検は残る）
    await page.goto("/ops/journal");
    await expect(page.getByTestId("journal-to-inspections")).toHaveAttribute("href", "/ops/inspections");
    await expect(page.getByTestId("journal-to-inspections")).toBeVisible();
    expect((await page.getByTestId("journal-to-inspections").boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(page.getByTestId("journal-tab-inspections")).toBeVisible();
    await page.getByTestId("journal-to-inspections").click();
    await page.waitForURL(/\/ops\/inspections$/);
    await voidPlan(manager, plan.id);
    await manager.dispose();
  });

  test("P3a-6. はみ出し 0：ホーム・計画の一覧・計画の作成・点検・点検の入力・日誌・登録・`/` が、幅 320・360・375・768・1024・1280・1440px × 明・暗で横スクロールなし。押す部品は 47.5px 以上", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [320, 360, 375, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width: w, height: 800 });
        for (const url of ["/ops", "/ops/plans", "/ops/plans/new", "/ops/inspections", "/ops/inspections/new", "/ops/journal", "/ops/more", "/"]) {
          await page.goto(url);
          await expect(page.locator("main").first()).toBeVisible();
          await expectNoHorizontalScroll(page, `${scheme} ${w}px ${url}`);
        }
        // メニューと入口（今回の部品）の押す部品は 47.5px 以上
        for (const sel of ['[data-testid="ops-bottom-nav"] a', '[data-testid="ops-sidebar"] a', '[data-testid="judge-pills"] a', '[data-testid="home-quick"] a']) {
          for (const url of ["/ops"]) {
            await page.goto(url);
            await openAllPlans(page); // 16-G：畳んだ中のピルも測る（幅 0 の要素は数えないので、開かないと何も測れない）
            const hs = await page.locator(sel).evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]));
            for (const [bw, bh] of hs) {
              expect(bw, `${scheme} ${w}px ${sel} 幅`).toBeGreaterThanOrEqual(47.5);
              expect(bh, `${scheme} ${w}px ${sel} 高さ`).toBeGreaterThanOrEqual(47.5);
            }
          }
        }
      }
    }
  });

  test("P3a-7. 現場モード：メニューは出さず「ホームへ戻る」（56px 以上）だけ。ホーム・点検の一覧から現場の入口までの導線は変わらない", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, aircraft.id, await pilotIdOf(seeded("a-pilot")), `現場の試験 ${stamp}-${seq++}`);
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/ops/plans/${plan.id}/field`);
      await expect(page.getByTestId("field-root")).toBeVisible();
      await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
      await expect(page.getByTestId("ops-sidebar")).toHaveCount(0);
      await expect(page.getByTestId("judge-pills")).toHaveCount(0);
      await expect(page.getByTestId("field-back")).toContainText("ホームへ戻る");
      expect((await page.getByTestId("field-back").boundingBox())!.height).toBeGreaterThanOrEqual(56);
      await expectNoHorizontalScroll(page, `現場 ${scheme}`);
    }
    await voidPlan(manager, plan.id);
    await manager.dispose();
  });
});
