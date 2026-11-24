import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTextZoom, waitForSettledStyles } from "../field-checks";

// Sprint 16-F の E2E-DB：画面の枠（下部ナビ 4 項目・PC の左メニュー・上の状態の層）。契約 F-1〜F-7、§7（互換）、K-5・K-7・K-8。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する（サーバーの時計は 2027-01-05 12:00 JST）。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
const DAY = "2027-01-05";

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

type TodayJson = { card: { planId: string } | null; rest: { planId: string }[]; upcoming: { planId: string }[] };
const clearPlans = async (ctx: APIRequestContext): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    const t = (await (await ctx.get("/api/ops/today")).json()) as TodayJson;
    const ids = [...(t.card ? [t.card.planId] : []), ...t.rest.map((r) => r.planId), ...t.upcoming.map((u) => u.planId)];
    if (ids.length === 0) return;
    for (const id of ids) {
      const plan = (await (await ctx.get(`/api/ops/plans/${id}`)).json()) as { version: number; voided: boolean };
      if (!plan.voided) await ctx.post(`/api/ops/plans/${id}/void`, { data: { expectedVersion: plan.version, reason: "試験の後始末" } });
    }
  }
};

let planId = "";
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  const me = (await (await pilot.get("/api/ops/me")).json()) as { pilotId: string };
  const mark = `JU16F${stamp}`.slice(0, 20);
  const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "枠の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(ac.status(), await ac.text()).toBe(201);
  const aircraftId = ((await ac.json()) as { id: string }).id;
  const plan = await manager.post("/api/ops/plans", { data: { title: `枠の確認 ${stamp}`, aircraftId, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
  expect(plan.status(), await plan.text()).toBe(201);
  planId = ((await plan.json()) as { id: string }).id;
  await pilot.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T12:00`, kind: "takeoff" } });
  await manager.dispose();
  await pilot.dispose();
});

/**
 * リンクを押し、遷移先の画面（done）が見えるまで確かめる。描画直後のクリックは、遷移しない・URL だけ変わって画面が替わらないことがある
 * （既存の tapAndWait と同じ事情。Next のクライアントルーターの揺れで、runbook の既知の不安定と同系統）ため、10 秒で見えなければ押し直す（最大 3 回）。
 * href で直接開く逃げ道は置かない：押して移れなければ失敗にする。押した回数は記録に残す。
 */
const tapUntil = async (page: Page, link: Locator, done: Locator, label: string): Promise<void> => {
  let taps = 0;
  for (; taps < 3; ) {
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    taps++;
    await link.click();
    if (await done.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) break;
  }
  console.log(`[押下] ${label}: 押した回数 ${taps}`);
  await expect(done, `${label}: 押して移れた（${taps} 回押した）`).toBeVisible();
};

const PRIMARY = '.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]';
const visiblePrimaries = (page: Page): Promise<string[]> =>
  page.evaluate((sel) =>
    Array.from(document.querySelectorAll<HTMLElement>(sel))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("dialog:not([open])");
      })
      .map((el) => el.getAttribute("data-testid") ?? el.textContent?.trim() ?? el.tagName),
  PRIMARY);

const NAV4 = ["ホーム", "計画", "日誌", "機体と書類"];

test.describe("F-1 下部ナビ（4 項目）：寸法・現在地・影", () => {
  test("375・390・430・360 で 4 つ（ホーム／計画／日誌／機体と書類）、高さ 64 以上・折り返さない・文字 14 以上・現在地は主色＋薄い主色の面＋aria-current・影は float＋上の 1px の線", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const w of [375, 390, 430, 360]) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const [url, current] of [["/ops", "today"], ["/ops/plans", "plans"], ["/ops/journal", "journal"], ["/ops/more", "more"], ["/ops/inspections", "journal"], ["/", null]] as const) {
        const label = `${w}px ${url}`;
        await page.goto(url);
        const nav = page.getByTestId("ops-bottom-nav");
        await expect(nav, label).toBeVisible();
        await waitForSettledStyles(page);
        expect((await nav.locator("a").allInnerTexts()).map((t) => t.trim()), label).toEqual(NAV4);
        for (const [key, href] of [["today", "/ops"], ["plans", "/ops/plans"], ["journal", "/ops/journal"], ["more", "/ops/more"]] as const) {
          await expect(nav.getByTestId(`nav-${key}`), label).toHaveAttribute("href", href);
        }
        await expect(nav.getByTestId("nav-inspections"), `${label} 点検は下部ナビにない`).toHaveCount(0);
        await expect(nav.getByTestId("nav-verdict"), `${label} 判定は下部ナビにない`).toHaveCount(0);
        const items = await nav.locator("a").evaluateAll((els) =>
          els.map((e) => {
            const cs = getComputedStyle(e);
            const lab = e.lastElementChild as HTMLElement;
            const r = e.getBoundingClientRect();
            const lr = lab.getBoundingClientRect();
            return { h: r.height, w: r.width, x: r.x, right: r.right, labelH: lr.height, labelFs: parseFloat(getComputedStyle(lab).fontSize), fs: parseFloat(cs.fontSize), svg: e.querySelectorAll("svg").length, text: lab.textContent ?? "", scrollOk: lab.scrollWidth <= lab.clientWidth + 1 };
          }),
        );
        for (const it of items) {
          expect(it.h, `${label} ${it.text} 高さ`).toBeGreaterThanOrEqual(64);
          expect(it.labelH, `${label} ${it.text} ラベルが折り返している`).toBeLessThan(24);
          expect(it.labelFs, `${label} ${it.text} 文字`).toBeGreaterThanOrEqual(14);
          expect(it.svg, `${label} ${it.text} アイコン`).toBe(1);
          expect(it.scrollOk, `${label} ${it.text} 切れ`).toBe(true);
          expect(it.right, `${label} ${it.text} 画面の外`).toBeLessThanOrEqual(w);
        }
        // 現在地：aria-current は 1 つだけ（`/` は 0）。太字・薄い主色の面・主色の文字（アイコンも currentColor）
        await expect(nav.locator('[aria-current="page"]'), label).toHaveCount(current ? 1 : 0);
        const soft = await page.evaluate(() => {
          const p = document.createElement("i");
          p.style.color = getComputedStyle(document.documentElement).getPropertyValue("--sb-primary-soft") || "#E8F0FD";
          document.body.append(p);
          const c = getComputedStyle(p).color;
          p.remove();
          return c;
        });
        const looks = await nav.locator("a").evaluateAll((els) => els.map((e) => ({ key: e.getAttribute("data-testid"), bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, weight: Number(getComputedStyle(e).fontWeight), current: e.getAttribute("aria-current") === "page" })));
        for (const l of looks) {
          if (l.current) {
            expect(l.bg, `${label} 現在地の面`).toBe(soft);
            expect(l.color, `${label} 現在地の文字（主色）`).toBe("rgb(31, 95, 224)");
            expect(l.weight, `${label} 現在地は太字`).toBeGreaterThanOrEqual(600);
          } else {
            expect(l.bg, `${label} 現在地でない面`).not.toBe(soft);
            expect(l.weight, `${label} 現在地でない太さ`).toBeLessThan(600);
          }
        }
        // 影は --sb-shadow-float、上に 1px の線（浮くものだけ。見本 cat-bottomnav-sec と同じ）
        const f = await page.evaluate(() => {
          const ul = document.querySelector<HTMLElement>('[data-testid="ops-bottom-nav"] ul')!;
          const probe = document.createElement("i");
          probe.style.boxShadow = "var(--sb-shadow-float)";
          document.querySelector('[data-testid="ops-bottom-nav"]')!.append(probe);
          const expected = getComputedStyle(probe).boxShadow;
          probe.remove();
          const cs = getComputedStyle(ul);
          return { shadow: cs.boxShadow, expected, top: cs.borderTopWidth, style: cs.borderTopStyle };
        });
        expect(f.shadow, `${label} 影`).toBe(f.expected);
        expect(f.shadow, `${label} 影は none でない`).not.toBe("none");
        expect(f.top, `${label} 上の線`).toBe("1px");
        expect(f.style).toBe("solid");
        await expectNoHorizontalScroll(page, label);
      }
    }
  });

  test("文字 200%（390・430・360）：「機体と書類」は省略せず、収まらないときだけ「機体と｜書類」で 2 行（横スクロール・切れ・隠れなし）。ふだんは 1 行", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/journal");
    await expect(page.getByTestId("ops-bottom-nav")).toBeVisible();
    for (const w of [390, 430, 360]) {
      await page.setViewportSize({ width: w, height: 844 });
      await waitForSettledStyles(page);
      const normal = await page.getByTestId("ops-bottom-nav").getByTestId("nav-more").evaluate((e) => (e.lastElementChild as HTMLElement).getBoundingClientRect().height);
      expect(normal, `${w}px 等倍は 1 行`).toBeLessThan(24);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      await waitForSettledStyles(page);
      const z = await page.getByTestId("ops-bottom-nav").locator("a").evaluateAll((els) =>
        els.map((e) => {
          const lab = e.lastElementChild as HTMLElement;
          const r = e.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(lab);
          const lines = new Set(Array.from(range.getClientRects()).map((q) => Math.round(q.top))).size;
          return { text: lab.textContent ?? "", lines, h: r.height, right: r.right, left: r.left, labRight: lab.getBoundingClientRect().right, labLeft: lab.getBoundingClientRect().left, labelOk: lab.scrollWidth <= lab.clientWidth + 1, fs: parseFloat(getComputedStyle(lab).fontSize) };
        }),
      );
      for (const it of z) {
        expect(it.text, `${w}px 200% 語を省かない`).toBeTruthy();
        expect(it.fs, `${w}px 200% ${it.text} 文字も 2 倍`).toBe(28);
        expect(it.lines, `${w}px 200% ${it.text} は 2 行まで`).toBeLessThanOrEqual(2);
        expect(it.labelOk, `${w}px 200% ${it.text} 切れ`).toBe(true);
        expect(it.left, `${w}px 200% ${it.text} 左`).toBeGreaterThanOrEqual(0);
        expect(it.right, `${w}px 200% ${it.text} 右`).toBeLessThanOrEqual(w);
        expect(it.labRight, `${w}px 200% ${it.text} ラベルの右端が項目の右端以下`).toBeLessThanOrEqual(it.right + 0.01);
        expect(it.labLeft, `${w}px 200% ${it.text} ラベルの左端が項目の左端以上`).toBeGreaterThanOrEqual(it.left - 0.01);
        expect(it.h, `${w}px 200% ${it.text} 高さ`).toBeGreaterThanOrEqual(64);
      }
      expect(z.map((i) => i.text)).toEqual(NAV4);
      // 折れる場所は「と」のあとだけ（語の途中で折らない）
      const more = await page.getByTestId("ops-bottom-nav").getByTestId("nav-more").evaluate((e) => {
        const lab = e.lastElementChild as HTMLElement;
        const t = lab.firstChild as Text;
        const tops: number[] = [];
        for (let i = 0; i < t.length; i++) {
          const r = document.createRange();
          r.setStart(t, i);
          r.setEnd(t, i + 1);
          tops.push(Math.round(r.getBoundingClientRect().top));
        }
        return { text: t.data, tops, wbr: lab.querySelectorAll("wbr").length };
      });
      expect(more.wbr).toBe(1);
      expect(more.text).toBe("機体と");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
    for (const [name, url, ready] of [["ホーム", "/ops", "ops-today"], ["日誌", "/ops/journal", "ops-journal"], ["機体と書類", "/ops/more", "ops-more"], ["計画", "/ops/plans", "plan-count"]] as const) {
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible();
      await expect(page.getByTestId("ops-bottom-nav")).toBeVisible();
      await waitForSettledStyles(page);
      await expectTextZoom(page, `下部ナビ ${name}`);
    }
  });

  test("R-3 幅 320px・等倍：「機体と書類」が 2 行になっても、下部ナビの高さと本文の末尾の余裕（下部ナビの上端まで 4px 以上）を測る", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.setViewportSize({ width: 320, height: 640 });
    for (const [url, ready] of [["/ops/more", "ops-more"], ["/ops/journal", "ops-journal"]] as const) {
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible();
      await expect(page.getByTestId("ops-bottom-nav")).toBeVisible();
      await waitForSettledStyles(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await waitForSettledStyles(page);
      const m = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>('[data-testid="ops-bottom-nav"]')!;
        const nb = nav.getBoundingClientRect();
        const more = nav.querySelector<HTMLElement>('[data-testid="nav-more"]')!.lastElementChild as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(more);
        const lines = new Set(Array.from(range.getClientRects()).map((q) => Math.round(q.top))).size;
        let bottom = 0;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") bottom = Math.max(bottom, r.bottom);
        }
        return { navH: nb.height, navTop: nb.top, contentBottom: bottom, lines, atEnd: Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) <= 1, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      console.log(`[R-3] 320px ${url}: 項目名 ${m.lines} 行、下部ナビ ${m.navH}px、本文の末尾 ${m.contentBottom}px、下部ナビの上端 ${m.navTop}px、余裕 ${m.navTop - m.contentBottom}px`);
      expect(m.atEnd, `${url} 末尾まで送った`).toBe(true);
      expect(m.navH, `${url} 下部ナビの高さ`).toBeGreaterThanOrEqual(64);
      expect(m.contentBottom, `${url} 本文の末尾（${m.contentBottom}）は下部ナビの上端（${m.navTop}）より 4px 以上上`).toBeLessThanOrEqual(m.navTop - 4);
      expect(m.sw, `${url} 横スクロールなし`).toBeLessThanOrEqual(m.cw);
    }
  });
});

test.describe("F-2・F-5 点検の現在地と互換", () => {
  test("点検の一覧は日誌が現在地、戻りリンク「日誌」（48px 以上）。新規・詳細でも現在地は日誌", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/inspections");
    await expect(page.getByTestId("ops-inspections")).toBeVisible();
    const nav = page.getByTestId("ops-bottom-nav");
    await expect(nav.getByTestId("nav-journal")).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    const back = page.locator("main").getByRole("link", { name: /日誌/ }).first();
    await expect(back).toHaveAttribute("href", "/ops/journal");
    const b = (await back.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(48);
    expect(b.width).toBeGreaterThanOrEqual(48);
    await page.goto("/ops/inspections/new");
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(nav.getByTestId("nav-journal")).toHaveAttribute("aria-current", "page");
  });

  test("F-5 既存の URL は直接開いて 200（リダイレクトなし）・見出し・現在地。?planId・timing・returnTo を保つ", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    const cases: { url: string; h1: RegExp; nav: string; testid?: string }[] = [
      { url: "/ops/inspections", h1: /^点検/, nav: "journal", testid: "ops-inspections" },
      { url: "/ops/inspections/new", h1: /点検/, nav: "journal" },
      { url: `/ops/inspections/new?planId=${planId}&timing=post_flight&returnTo=${encodeURIComponent(`/ops/plans/${planId}`)}`, h1: /点検/, nav: "journal" },
      { url: "/ops/journal?tab=inspections", h1: /^日誌/, nav: "journal", testid: "ops-journal" },
      { url: "/ops/journal", h1: /^日誌/, nav: "journal", testid: "ops-journal" },
      { url: "/ops/more", h1: /^機体と書類/, nav: "more", testid: "ops-more" },
      { url: "/ops/aircraft", h1: /機体/, nav: "more" },
      { url: "/ops/pilots", h1: /操縦者/, nav: "more" },
      { url: "/ops/permits", h1: /許可/, nav: "more" },
      { url: "/ops/places", h1: /地点/, nav: "more" },
      { url: "/ops/flights", h1: /飛行記録/, nav: "journal" },
      { url: "/ops/incidents", h1: /事故|ヒヤリ/, nav: "journal" },
    ];
    for (const c of cases) {
      const res = await page.goto(c.url);
      expect(res!.status(), c.url).toBe(200);
      expect(res!.request().redirectedFrom(), `${c.url} リダイレクトなし`).toBeNull();
      await expect(page.locator("main h1").first(), c.url).toHaveText(c.h1);
      if (c.testid) await expect(page.getByTestId(c.testid), c.url).toBeVisible();
      await expect(page.getByTestId("ops-bottom-nav").getByTestId(`nav-${c.nav}`), c.url).toHaveAttribute("aria-current", "page");
      expect(new URL(page.url()).pathname + new URL(page.url()).search, `${c.url} URL を変えない`).toBe(c.url);
    }
    // ?tab=inspections は日誌のタブが現在地
    await page.goto("/ops/journal?tab=inspections");
    await expect(page.getByTestId("journal-tab-inspections")).toHaveAttribute("aria-current", "page");
    // 計画のアンカー（旧い入口）：/ops/plans/<id> は開く（17-1 の plan-anchor-compat は既存の検査が見る）
    const res = await page.goto(`/ops/plans/${planId}`);
    expect(res!.status()).toBe(200);
    await expect(page.getByTestId("ops-bottom-nav").getByTestId("nav-plans")).toHaveAttribute("aria-current", "page");
  });
});

test.describe("F-3 左メニュー（1280）", () => {
  test("ホーム／計画／日誌（飛行記録・点検・事故・ヒヤリハット）／機体と書類（機体・操縦者・許可・承認・地点）、罫のあとに「調べる」＝判定。全役割で同じ（閲覧は全役割）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const who of ["a-manager", "a-pilot", "a-viewer"]) {
      await signIn(page.request, seeded(who));
      await page.goto("/ops");
      const side = page.getByTestId("ops-sidebar");
      await expect(side, who).toBeVisible();
      await expect(page.getByTestId("ops-bottom-nav"), who).toBeHidden();
      expect((await side.locator('a[data-testid^="nav-"]').allInnerTexts()).map((t) => t.trim()), who).toEqual([
        "ホーム", "計画", "日誌", "飛行記録", "点検", "事故・ヒヤリハット", "機体と書類", "機体", "操縦者", "許可・承認", "地点", "判定",
      ]);
      expect(await side.locator('a[data-testid^="nav-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid"))), who).toEqual([
        "nav-today", "nav-plans", "nav-journal", "nav-flights", "nav-inspections", "nav-incidents", "nav-more", "nav-aircraft", "nav-pilots", "nav-permits", "nav-places", "nav-verdict",
      ]);
      await expect(side.getByTestId("nav-inspections"), who).toHaveAttribute("href", "/ops/inspections");
      await expect(side.getByTestId("nav-verdict"), who).toHaveAttribute("href", "/");
      await expect(side).not.toContainText("飛ばす");
      await expect(side).toContainText("調べる");
      // 判定は区切り（罫）の下：罫の上端は機体と書類の子より下、判定は罫より下
      const [last, verdict, heading] = await Promise.all([side.getByTestId("nav-places").boundingBox(), side.getByTestId("nav-verdict").boundingBox(), side.getByText("調べる", { exact: true }).boundingBox()]);
      expect(heading!.y, who).toBeGreaterThan(last!.y + last!.height);
      expect(verdict!.y, who).toBeGreaterThan(heading!.y);
      const ruled = await side.getByTestId("nav-verdict").evaluate((e) => getComputedStyle(e.parentElement!.parentElement!).borderTopWidth);
      expect(ruled, `${who} 判定の群の上に罫`).toBe("1px");
      // 子はすべて 48px 以上
      for (const a of await side.locator('a[data-testid^="nav-"]').all()) expect((await a.boundingBox())!.height, who).toBeGreaterThanOrEqual(47.5);
    }
  });

  test("現在地：子が現在地のとき親は祖先（太字だけ）。日誌・機体と書類の画面そのものでは親が現在地。常に 1 つ", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page.request, seeded("a-manager"));
    const cases: [string, string, string | null][] = [
      ["/ops", "today", null],
      ["/ops/plans", "plans", null],
      ["/ops/journal", "journal", null],
      ["/ops/flights", "flights", "journal"],
      ["/ops/flights/new", "flights", "journal"],
      ["/ops/inspections", "inspections", "journal"],
      ["/ops/inspections/new", "inspections", "journal"],
      ["/ops/incidents", "incidents", "journal"],
      ["/ops/more", "more", null],
      ["/ops/aircraft", "aircraft", "more"],
      ["/ops/pilots", "pilots", "more"],
      ["/ops/permits", "permits", "more"],
      ["/ops/places", "places", "more"],
    ];
    for (const [url, here, parent] of cases) {
      await page.goto(url);
      const side = page.getByTestId("ops-sidebar");
      await expect(side, url).toBeVisible();
      await expect(side.locator('[aria-current="page"]'), url).toHaveCount(1);
      await expect(side.getByTestId(`nav-${here}`), url).toHaveAttribute("aria-current", "page");
      await expect(side.locator('[data-active="true"]'), url).toHaveCount(1);
      if (parent) {
        await expect(side.getByTestId(`nav-${parent}`), url).toHaveAttribute("data-ancestor", "true");
        await expect(side.getByTestId(`nav-${parent}`), url).toHaveAttribute("data-active", "false");
      } else {
        await expect(side.locator("[data-ancestor]"), url).toHaveCount(0);
      }
    }
  });

  test("1024 未満では左メニューは出ない（900）。現場・サインイン・権限なしでは下部ナビも左メニューも出ない", async ({ page, browser }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/ops");
    await expect(page.getByTestId("ops-bottom-nav")).toBeVisible();
    await expect(page.getByTestId("ops-sidebar")).toBeHidden();
    // 現場モード
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/ops/plans/${planId}/field`);
    await expect(page.getByTestId("field-root")).toBeVisible();
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(page.getByTestId("ops-sidebar")).toHaveCount(0);
    // 未サインイン
    const anon = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } });
    const ap = await anon.newPage();
    await ap.goto("/ops/sign-in");
    await expect(ap.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(ap.getByTestId("ops-sidebar")).toHaveCount(0);
    await ap.goto("/");
    await expect(ap.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await anon.close();
  });
});

test.describe("F-4 点検へ 1 回", () => {
  for (const [w, h] of [[375, 812], [390, 844]] as const) {
    test(`ホームの最初の画面（${w}×${h}、スクロールなし）に「飛行前点検」（ops-enter-inspection）が見える。押すと点検の入力へ 1 回`, async ({ page }) => {
      for (const who of ["a-manager", "b-manager"]) {
        if (who === "b-manager") {
          const api = await apiAs(seeded("b-manager"));
          try {
            await clearPlans(api);
          } finally {
            await api.dispose();
          }
        }
        await signIn(page.request, seeded(who));
        await page.setViewportSize({ width: w, height: h });
        await page.goto("/ops");
        await expect(page.getByTestId("ops-today")).toBeVisible();
        if (who === "a-manager") await expect(page.getByTestId("today-card")).toBeVisible();
        else await expect(page.getByTestId("today-empty")).toBeVisible();
        await waitForSettledStyles(page);
        const q = page.getByTestId("ops-enter-inspection");
        await expect(q, `${who} ${w}`).toBeVisible();
        await expect(q).toHaveText("飛行前点検");
        await expect(q).toHaveAttribute("href", "/ops/inspections/new");
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        const box = (await q.boundingBox())!;
        const navTop = (await page.getByTestId("ops-bottom-nav").boundingBox())!.y;
        expect(box.y, `${who} ${w} 上端`).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, `${who} ${w} 最初の画面（下部ナビの上）に全部入る`).toBeLessThanOrEqual(navTop);
        expect(box.height, `${who} ${w} 押せる高さ`).toBeGreaterThanOrEqual(48);
        // 主ボタンは 1 つ（クイック操作は副ボタン。K-8）
        const primaries = await visiblePrimaries(page);
        expect(primaries.length, `${who} ${w} 主ボタン ${primaries.join("・")}`).toBeLessThanOrEqual(1);
        await expect(q).not.toHaveAttribute("data-variant", "primary");
        // 同じ画面に同じ行き先のリンクを重ねない
        await expect(page.locator('main a[href="/ops/inspections/new"]')).toHaveCount(1);
        // 描画直後のクリックが遷移しないことがある（既存の tapAndWait と同じ作法）。押し直しは最大 3 回までで、
        // href で直接開く逃げ道は置かない（押して移れたことが検査）。押し直しの回数は記録に残す
        let taps = 0;
        let idle = 0;
        for (; taps < 3 && !/\/ops\/inspections\/new$/.test(page.url()); ) {
          if (await page.waitForLoadState("networkidle", { timeout: 5_000 }).then(() => true, () => false)) idle++;
          taps++;
          await q.click();
          await page.waitForURL(/\/ops\/inspections\/new$/, { timeout: 10_000, waitUntil: "commit" }).catch(() => undefined);
        }
        console.log(`[F-4 押下] ${who} ${w}: 押した回数 ${taps}、networkidle に達した回数 ${idle}`);
        expect(page.url(), `${who} ${w}: 押して点検の入力へ移れた（${taps} 回押した）`).toMatch(/\/ops\/inspections\/new$/);
        await page.waitForURL(/\/ops\/inspections\/new$/);
        await expect(page.locator("main h1").first()).toBeVisible();
      }
    });
  }

  test("閲覧者（記録を作れない役割）にはクイック操作を出さない。日誌のタブ journal-tab-inspections から点検の一覧へ 1 回、左メニューの日誌の子（nav-inspections）からも 1 回", async ({ page }) => {
    await signIn(page.request, seeded("a-viewer"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ops");
    await expect(page.getByTestId("ops-today")).toBeVisible();
    await expect(page.getByTestId("ops-enter-inspection")).toHaveCount(0);
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/journal");
    await expect(page.getByTestId("journal-tabs")).toBeVisible();
    const tab = page.getByTestId("journal-tab-inspections");
    await expect(tab).toHaveAttribute("href", "/ops/journal?tab=inspections");
    await tapUntil(page, tab, page.locator('[data-testid="journal-tab-inspections"][aria-current="page"]'), "日誌のタブ→点検");
    await page.waitForURL(/\/ops\/journal\?tab=inspections$/);
    // 一覧（点検の画面）へ
    await page.goto("/ops/journal");
    const link = page.getByTestId("journal-to-inspections");
    await expect(link).toHaveAttribute("href", "/ops/inspections");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/ops");
    await tapUntil(page, page.getByTestId("ops-sidebar").getByTestId("nav-inspections"), page.getByTestId("ops-inspections"), "左メニュー→点検");
    await page.waitForURL(/\/ops\/inspections$/);
  });
});

test.describe("F-6 上の状態の層", () => {
  test("1 段目の画面（ホーム・計画・日誌・機体と書類）は、題 24px と補足 1 行 14px。題の文字は変えない", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const w of [375, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      for (const [url, h1, sub] of [
        ["/ops", "ホーム", '[data-testid="today-date"]'],
        ["/ops/plans", "飛行計画", '[data-testid="plans-today"]'],
        ["/ops/journal", "日誌", "main h1 + span"],
        ["/ops/more", "機体と書類", "main h1 + span"],
      ] as const) {
        await page.goto(url);
        const title = page.locator("main h1").first();
        await expect(title, url).toHaveText(h1);
        await waitForSettledStyles(page);
        expect(await title.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)), `${w}px ${url} 題`).toBe(24);
        const s = page.locator(sub).first();
        await expect(s, `${w}px ${url} 補足`).toBeVisible();
        expect(await s.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)), `${w}px ${url} 補足`).toBe(14);
        // 題が補足より上（同じ行か上）
        const [tb, sb] = [(await title.boundingBox())!, (await s.boundingBox())!];
        expect(sb.y + sb.height, `${url} 補足が題の近く`).toBeLessThan(tb.y + tb.height + 40);
        await expectNoHorizontalScroll(page, `${w}px ${url}`);
      }
    }
  });

  for (const [w, h] of [[375, 812], [390, 844]] as const) {
    test(`主な操作は画面の下半分（${w}×${h}）：ホーム・計画の作成・点検の入力の主ボタンの上端は高さの 40% より下（最初の画面に入らないものは末尾）。主ボタンは 1 画面 1 つ`, async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      await page.setViewportSize({ width: w, height: h });
      for (const [name, url, ready] of [
        ["ホーム", "/ops", "today-card"],
        ["計画の作成", "/ops/plans/new", "main h1"],
        ["点検の入力", "/ops/inspections/new", "main h1"],
      ] as const) {
        await page.goto(url);
        if (ready.startsWith("main ")) await expect(page.locator(ready).first()).toBeVisible();
        else await expect(page.getByTestId(ready)).toBeVisible();
        await waitForSettledStyles(page);
        const primaries = await visiblePrimaries(page);
        // 点検の入力は、16-F より前から「すべて正常」（入力の補助）と「保存」の 2 つが主の見た目（K-8 の未了。16-F の範囲外として報告）。位置の検査は最後の主ボタン（保存）で行う
        if (name === "点検の入力") expect(primaries, `${name} 主ボタン`).toEqual(["すべて正常", "保存"]);
        else expect(primaries.length, `${name} 主ボタン ${primaries.join("・")}`).toBe(1);
        const top = await page.evaluate(
          (sel) => {
            const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => el.getBoundingClientRect().height > 0);
            return els.length ? els[els.length - 1]!.getBoundingClientRect().top + window.scrollY : -1;
          },
          PRIMARY,
        );
        expect(top, `${name} 主ボタンの上端 ${top} は ${h * 0.4} より下`).toBeGreaterThanOrEqual(h * 0.4);
        // 最初の画面に入らない主ボタンは、末尾（本文の最後の操作）に置く：主ボタンより下の操作の部品がない
        // ホームの主ボタン（次の飛行のカード）は末尾ではない：並びの組み替えは 16-G（HM-1・HM-2）。ここでは 40% より下だけを守る
        if (top > h && name !== "ホーム") {
          const after = await page.evaluate((sel) => {
            const list = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => el.getBoundingClientRect().height > 0);
            const p = list[list.length - 1]!;
            const pb = p.getBoundingClientRect().bottom;
            return Array.from(document.querySelectorAll<HTMLElement>("main a[href], main button:not([disabled])"))
              .filter((el) => el !== p && !p.contains(el) && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().top > pb)
              .map((el) => el.getAttribute("data-testid") ?? el.textContent?.trim().slice(0, 12) ?? "");
          }, PRIMARY);
          expect(after, `${name} 主ボタンの下に操作がある`).toEqual([]);
        }
      }
    });
  }

  test("主ボタンは 1 画面 1 つ（K-8）：ホーム（予定のない日を含む）・計画の一覧・日誌・点検の一覧・機体と書類", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const [name, url] of [["ホーム", "/ops"], ["計画の一覧", "/ops/plans"], ["日誌", "/ops/journal"], ["点検の一覧", "/ops/inspections"], ["機体と書類", "/ops/more"]] as const) {
      await page.goto(url);
      await expect(page.locator("main h1").first()).toBeVisible();
      await waitForSettledStyles(page);
      const primaries = await visiblePrimaries(page);
      expect(primaries.length, `${name} ${primaries.join("・")}`).toBeLessThanOrEqual(1);
    }
    await signIn(page.request, seeded("b-manager"));
    await clearPlans(page.request);
    await page.goto("/ops");
    await expect(page.getByTestId("today-empty")).toBeVisible();
    const empty = await visiblePrimaries(page);
    expect(empty.length, `予定のない日 ${empty.join("・")}`).toBeLessThanOrEqual(1);
  });
});
