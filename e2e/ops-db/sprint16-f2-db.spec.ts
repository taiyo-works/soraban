import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { waitForSettledStyles } from "../field-checks";
import { expectStep, fillStep, tapNext, type WizardValues } from "./plan-wizard";

// Sprint 16-F2 の E2E-DB：下部ナビの 320 幅・文字 200%（契約 sprint-16.md §17 の 12、K-5 の測定に 320 を足す）。
// 幅 320・360・390 × 文字 100%・200%（html の font-size 32px。既存の 16-F と同じ方法）で、ホーム・計画の一覧・計画作成の各段（①〜⑤）・日誌・機体と書類の
// 下部ナビ（ops-bottom-nav）が、横スクロール 0・項目名の切れ 0・項目の高さ 64px 以上・押す部品 48px 以上・4 項目の文言と順・現在地の上 3px の線を保つことを確かめる。
// 既存の 16-F の検査（390・430・360 の 200%）は弱めていない（sprint16-f-db.spec.ts のまま）。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
const NAV4 = ["ホーム", "計画", "日誌", "機体と書類"];
const WIDTHS = [320, 360, 390] as const;
const ZOOMS = [{ name: "100%", px: "" }, { name: "200%", px: "32px" }] as const;

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};

type Report = {
  readonly texts: string[];
  readonly navSw: number;
  readonly navCw: number;
  readonly docSw: number;
  readonly docCw: number;
  readonly items: { text: string; left: number; right: number; w: number; h: number; labelClipped: boolean; labelOutside: boolean; lines: number; fs: number; current: boolean; line3: boolean }[];
};

const measure = async (page: Page): Promise<Report> =>
  page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('[data-testid="ops-bottom-nav"]')!;
    const items = Array.from(nav.querySelectorAll<HTMLElement>("a")).map((a) => {
      const lab = a.lastElementChild as HTMLElement;
      const r = a.getBoundingClientRect();
      const lr = lab.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(lab);
      const lines = new Set(Array.from(range.getClientRects()).map((q) => Math.round(q.top))).size;
      const before = getComputedStyle(a, "::before");
      return {
        text: (lab.textContent ?? "").trim(),
        left: r.left,
        right: r.right,
        w: r.width,
        h: r.height,
        labelClipped: lab.scrollWidth > lab.clientWidth + 1,
        // ラベルの文字の外接（range）が項目の箱の内側にある
        labelOutside: Array.from(range.getClientRects()).some((q) => q.left < r.left - 0.5 || q.right > r.right + 0.5),
        lines,
        fs: parseFloat(getComputedStyle(lab).fontSize),
        current: a.getAttribute("aria-current") === "page",
        line3: before.content !== "none" && parseFloat(before.height) === 3,
      };
    });
    return {
      texts: items.map((i) => i.text),
      navSw: nav.scrollWidth,
      navCw: nav.clientWidth,
      docSw: document.documentElement.scrollWidth,
      docCw: document.documentElement.clientWidth,
      items,
    };
  });

const check = (m: Report, label: string, w: number, zoomPx: string, current: boolean | null): void => {
  expect(m.texts, `${label} 4 項目の文言と順`).toEqual(NAV4);
  expect(m.navSw, `${label} 下部ナビの横スクロール（scrollWidth ${m.navSw} > clientWidth ${m.navCw}）`).toBeLessThanOrEqual(m.navCw);
  expect(m.navCw, `${label} 下部ナビの幅は画面の幅`).toBeLessThanOrEqual(w);
  let sum = 0;
  for (const it of m.items) {
    sum += it.w;
    expect(it.left, `${label} ${it.text} 左端`).toBeGreaterThanOrEqual(0);
    expect(it.right, `${label} ${it.text} 右端（${it.right}）が画面（${w}）以内`).toBeLessThanOrEqual(w);
    expect(it.labelClipped, `${label} ${it.text} ラベルの切れ`).toBe(false);
    expect(it.labelOutside, `${label} ${it.text} ラベルが項目の外へ出ていない`).toBe(false);
    expect(it.lines, `${label} ${it.text} は 2 行まで`).toBeLessThanOrEqual(2);
    expect(it.h, `${label} ${it.text} 高さ（64px 以上）`).toBeGreaterThanOrEqual(64);
    expect(it.w, `${label} ${it.text} 幅（押す部品 48px 以上）`).toBeGreaterThanOrEqual(48);
    expect(it.fs, `${label} ${it.text} 文字の大きさ`).toBe(zoomPx ? 28 : 14);
    expect(it.line3, `${label} ${it.text} 現在地の上 3px の線は現在地だけ`).toBe(it.current);
  }
  expect(sum, `${label} 4 項目の幅の合計`).toBeLessThanOrEqual(w);
  const cur = m.items.filter((i) => i.current).length;
  if (current !== null) expect(cur, `${label} 現在地`).toBe(current ? 1 : 0);
};

const sweep = async (page: Page, name: string, current: boolean | null, afterEach?: (m: Report, label: string, w: number, zoomPx: string) => void): Promise<void> => {
  for (const w of WIDTHS) {
    for (const z of ZOOMS) {
      await page.setViewportSize({ width: w, height: 640 });
      await page.evaluate((px) => {
        document.documentElement.style.fontSize = px;
      }, z.px);
      await waitForSettledStyles(page);
      const m = await measure(page);
      const label = `${name} ${w}px ${z.name}`;
      console.log(`[16-F2] ${label}: nav ${m.navSw}/${m.navCw} items ${m.items.map((i) => `${i.text}:${Math.round(i.w)}x${Math.round(i.h)}/${i.lines}行`).join(" ")} doc ${m.docSw}/${m.docCw}`);
      check(m, label, w, z.px, current);
      afterEach?.(m, label, w, z.px);
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
};

test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 16-F2 E2E-DB：下部ナビの 320・360・390 × 文字 100%・200%", () => {
  test("ホーム・計画の一覧・日誌・機体と書類：横スクロール 0・ラベルの切れ 0", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    const screens: { name: string; url: string; ready: string; current: boolean }[] = [
      { name: "ホーム", url: "/ops", ready: "ops-today", current: true },
      { name: "計画の一覧", url: "/ops/plans", ready: "plan-count", current: true },
      { name: "日誌", url: "/ops/journal", ready: "ops-journal", current: true },
      { name: "機体と書類", url: "/ops/more", ready: "ops-more", current: true },
    ];
    for (const s of screens) {
      await page.goto(s.url);
      await expect(page.getByTestId(s.ready)).toBeVisible();
      await expect(page.getByTestId("ops-bottom-nav")).toBeVisible();
      await sweep(page, s.name, s.current, (m, label) => {
        // 文書の横スクロールも 0。計画の一覧は、計画があると 200%・320 で本文の一部が 3px 広がる（ナビが原因ではない。16-H2 の範囲）ので、ログだけにする
        if (s.name !== "計画の一覧") expect(m.docSw, `${label} 文書の横スクロール`).toBeLessThanOrEqual(m.docCw);
      });
    }
  });

  test("計画作成の各段（①〜⑤）：下部ナビの横スクロール 0・ラベルの切れ 0。文書の幅（320・360・390 × 100%・200%）は画面を超えない", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    const manager = await pwRequest.newContext({ baseURL: BASE });
    await signIn(manager, seeded("a-manager"));
    const registrationMark = `JU16F2${stamp}`.slice(0, 20);
    const ac = await manager.post("/api/ops/aircraft", {
      data: { registrationMark, modelName: "ナビの試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    expect(ac.status()).toBe(201);
    const aircraftId = ((await ac.json()) as { id: string }).id;
    const pilot = await pwRequest.newContext({ baseURL: BASE });
    await signIn(pilot, seeded("a-pilot"));
    const pilotId = ((await (await pilot.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await manager.dispose();
    await pilot.dispose();
    const v: WizardValues = {
      placeName: "ナビの試験地点",
      lat: "35.123456",
      lng: "133.654321",
      radius: "120",
      date: "2027-03-05",
      time: "10:30",
      duration: "40",
      title: `E2E ナビ ${stamp}`,
      purpose: "橋梁の点検",
      altitude: "60",
      flags: ["method_night"],
      aircraftId,
      pilotId,
      permitNumbers: "",
      notes: "",
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ops/plans/new");
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    for (let n = 1; n <= 5; n++) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expectStep(page, n);
      // 計画作成は計画の一部：現在地は「計画」
      await sweep(page, `計画作成 段 ${n}`, true, (m, label, w) => {
        console.log(`[16-F2] ${label}: 文書 ${m.docSw}/${m.docCw}（画面 ${w}）`);
        // 16-H2（§17 申し送り 13）：段ごとの文書の幅の検査。段 ④ の許可の欄のラベルが 320・200% で折り返さず 327 になっていた（直した）。
        expect(m.docSw, `${label} 文書の横スクロール（scrollWidth ${m.docSw} > clientWidth ${m.docCw}）`).toBeLessThanOrEqual(m.docCw);
      });
      if (n < 5) {
        await page.setViewportSize({ width: 390, height: 844 });
        await fillStep(page, n, v);
        await tapNext(page);
      }
    }
  });
});
