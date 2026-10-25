import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { collectTapTargets, expectNoHorizontalScroll } from "./field-checks";
import { Meter, type Measure } from "./judge-measure";

// UX 段階 3 の E2E：判定画面の案（/ops/design?view=judge）。
// - 見本は DESIGN_CATALOG=1 のサーバー（フィクスチャ用の 2 台目）でだけ表示する静的なページ。認証・DB・外部通信を使わない。
// - 現状の判定画面（/）は、同じサーバーで開き、同じ台本・同じ数え方で測る（既存の画面は変えていない）。
// - UX_COUNTS_FILE を指定すると、数えた結果を 1 行 1 件の JSON で書き出す（docs/design/ux-judge-compare.md の元の数字）。
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;
const PROD_LIKE = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const GEO = { latitude: 35.4400123, longitude: 133.3500456, accuracy: 30 };

type Variant = "sheet" | "tabs" | "fold" | "three";
const prefix = (v: Variant): "sp" | "pc" => (v === "three" ? "pc" : "sp");

const openSample = async (page: Page, v: Variant, query = ""): Promise<void> => {
  const sp = v === "three" ? "sheet" : v;
  await page.goto(`${CATALOG}/ops/design?view=judge&sp=${sp}&pc=three${query}`);
  await expect(page.getByTestId("design-catalog")).toHaveAttribute("data-hydrated", "1");
  await expect(page.getByTestId("judge-trial")).toBeVisible();
  await expect(page.getByTestId(`${prefix(v)}-frame`)).toBeVisible();
};

const summaryOf = (page: Page, v: Variant): Locator => page.getByTestId(v === "three" ? "pc-conclusion" : "sp-summary");

test.describe("判定画面の見本（見本の動作）", () => {
  test("1. DESIGN_CATALOG が無効のサーバーでは 404。有効のとき表示され、見本データの表示と noindex がある。外部通信がない", async ({ page }) => {
    const off = await page.request.get(`${PROD_LIKE}/ops/design?view=judge`);
    expect(off.status()).toBe(404);
    const external: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url());
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await openSample(page, "sheet");
    await expect(page.getByTestId("judge-sample-pill")).toContainText("見本データ");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(external, "外部への通信").toEqual([]);
  });

  test("2. シート案：地図が土台で、結果は 1 行の要約から始まる。ハンドルで 1 行→半分→全体→1 行。矢印キー・Esc でも動く", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSample(page, "sheet");
    const frame = page.getByTestId("sp-frame");
    const handle = page.getByTestId("sp-handle");
    await expect(frame).toHaveAttribute("data-stage", "peek");
    await expect(page.getByTestId("sp-summary")).toBeVisible();
    await expect(page.getByTestId("sp-map")).toBeVisible();
    // 免責の語（参考情報）は 1 行の要約にも常にある
    await expect(page.getByTestId("sp-summary")).toContainText("参考情報");
    await handle.click();
    await expect(frame).toHaveAttribute("data-stage", "half");
    await handle.click();
    await expect(frame).toHaveAttribute("data-stage", "full");
    await handle.click();
    await expect(frame).toHaveAttribute("data-stage", "peek");
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await expect(frame).toHaveAttribute("data-stage", "half");
    await page.keyboard.press("ArrowUp");
    await expect(frame).toHaveAttribute("data-stage", "full");
    await page.keyboard.press("Escape");
    await expect(frame).toHaveAttribute("data-stage", "peek");
    await handle.focus();
    await page.keyboard.press("Enter");
    await expect(frame).toHaveAttribute("data-stage", "half");
    await page.keyboard.press("ArrowDown");
    await expect(frame).toHaveAttribute("data-stage", "peek");
  });

  test("3. シートはドラッグでも上がる。1 行のあいだ詳細はキーボードで届かない（inert）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSample(page, "sheet");
    await expect(page.getByTestId("sp-sheet-body")).toHaveAttribute("inert", "");
    const box = (await page.getByTestId("sp-handle").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId("sp-frame")).toHaveAttribute("data-stage", "half");
    await expect(page.getByTestId("sp-sheet-body")).not.toHaveAttribute("inert", "");
  });

  test("4. prefers-reduced-motion では、シートの高さと地図の動きに移り変わりがない", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 375, height: 812 });
    await openSample(page, "sheet");
    const prop = await page.getByTestId("sp-sheet").evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(prop).toBe("none");
  });

  for (const v of ["sheet", "tabs", "fold", "three"] as const) {
    test(`5. ${v}：住所・現在地で判定が変わる。精度 30 m は確認なし`, async ({ page }) => {
      await page.setViewportSize(v === "three" ? { width: 1280, height: 800 } : { width: 375, height: 812 });
      await openSample(page, v);
      const t = prefix(v);
      const summary = summaryOf(page, v);
      await expect(summary).toContainText("加茂町（見本）");
      if (v === "tabs") await page.getByTestId("sp-tab-input").click();
      await page.getByTestId(`${t}-address`).fill("鳥取県米子市試験町一丁目3番7号");
      await page.getByTestId(`${t}-search`).click();
      await expect(summary).toContainText("試験町一丁目（見本）");
      // 現在地（精度 30 m）：確認なしで判定。DID の外なので「手続き不要」に変わる
      await page.getByTestId(`${t}-geo`).click();
      await expect(summary).toContainText("現在地（精度 約 30 m）");
      await expect(page.getByTestId(`${t}-geo-confirm`)).toHaveCount(0);
    });
  }

  test("6. 精度 150 m：現在地は確認が 1 回入り、取消すと地点も結果も変わらない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSample(page, "fold");
    // 精度の切り替えは見本の下にある
    await page.getByTestId("ctl-acc").getByRole("radio", { name: "150m" }).click();
    await page.getByTestId("sp-geo").click();
    await expect(page.getByTestId("sp-geo-confirm")).toContainText("約 150 m");
    await expect(page.getByTestId("sp-summary")).toContainText("加茂町（見本）");
    await page.getByTestId("sp-geo-confirm-no").click();
    await expect(page.getByTestId("sp-geo-confirm")).toHaveCount(0);
    await expect(page.getByTestId("sp-summary")).toContainText("加茂町（見本）");
    await page.getByTestId("sp-geo").click();
    await page.getByTestId("sp-geo-confirm-yes").click();
    await expect(page.getByTestId("sp-summary")).toContainText("現在地（精度 約 150 m）");
  });

  for (const v of ["sheet", "tabs", "fold", "three"] as const) {
    test(`7. ${v}：層の切り替えは地図だけを変え、結果は変わらない。層は航空法／小型無人機等飛行禁止法／その他／そらばん追加の順`, async ({ page }) => {
      await page.setViewportSize(v === "three" ? { width: 1280, height: 800 } : { width: 375, height: 812 });
      await openSample(page, v);
      const t = prefix(v);
      const before = await summaryOf(page, v).innerText();
      if (v !== "three") await page.getByTestId(`${t}-layers-open`).click();
      const groups = await page.locator(`[data-testid="${t}-layer-list"] [data-group]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
      expect(groups).toEqual(["aviation", "drone-law", "other", "soraban"]);
      await page.getByTestId(`${t}-layer-did`).click();
      await expect(page.getByTestId(`${t}-map`)).toHaveAttribute("data-hidden-layers", "did");
      await expect(page.getByTestId(`${t}-map`).locator('[data-layer="did"]')).toHaveCount(0);
      expect(await summaryOf(page, v).innerText()).toBe(before);
      await page.getByTestId(`${t}-layer-did`).click();
      await expect(page.getByTestId(`${t}-map`)).toHaveAttribute("data-hidden-layers", "");
    });
  }

  test("8. PC 1280×800：入力・地図・結果と地図の下の層の切り替えが、スクロールなしで同時に見える", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSample(page, "three");
    const vh = 800;
    for (const id of ["pc-address", "pc-geo", "pc-map", "pc-conclusion", "pc-layer-did", "pc-layer-park"]) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.y, `${id} の上端`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `${id} の下端`).toBeLessThanOrEqual(vh + 0.5);
    }
    // 層の切り替えは地図の下にある
    const map = (await page.getByTestId("pc-map").boundingBox())!;
    const chip = (await page.getByTestId("pc-layer-did").boundingBox())!;
    expect(chip.y).toBeGreaterThanOrEqual(map.y + map.height - 0.5);
    // 地図の幅（左右のペインを除く）
    expect(map.width).toBeGreaterThan(560);
  });

  test("9. 幅 375・768・1280：横スクロールがない。押す部品は 44px 以上（現場モードは 56px 以上）", async ({ page }) => {
    for (const [width, height] of [
      [375, 812],
      [768, 1024],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const v of ["sheet", "tabs", "fold"] as const) {
        for (const field of [false, true]) {
          await openSample(page, v, field ? "&field=1" : "");
          await expectNoHorizontalScroll(page, `${v} ${width}px 現場=${field}`);
          const min = field ? 56 : 44;
          const targets = await collectTapTargets(page, '[data-testid="sp-frame"]');
          const short = targets.filter((x) => x.height < min - 0.5 && x.testId !== "sp-handle").map((x) => `${x.testId ?? x.text} ${x.height.toFixed(1)}`);
          expect(short, `${v} ${width}px 現場=${field} 高さが足りない部品`).toEqual([]);
        }
      }
    }
  });

  test("10. タブ案：矢印キーで入力・地図・結果が移り、結果の帯を押すと結果が開く。入力で判定すると地図に戻る", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSample(page, "tabs");
    await expect(page.getByTestId("sp-frame")).toHaveAttribute("data-leaf", "map");
    await page.getByTestId("sp-tab-map").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("sp-frame")).toHaveAttribute("data-leaf", "result");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("sp-frame")).toHaveAttribute("data-leaf", "input");
    await page.getByTestId("sp-search").click();
    await expect(page.getByTestId("sp-frame")).toHaveAttribute("data-leaf", "map");
    await page.getByTestId("sp-band").click();
    await expect(page.getByTestId("sp-frame")).toHaveAttribute("data-leaf", "result");
  });

  test("11. 暗い配色でも同じ構成で表示される（375 と 1280）", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    for (const [width, height, v] of [
      [375, 812, "sheet"],
      [1280, 800, "three"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await openSample(page, v);
      await expect(summaryOf(page, v)).toBeVisible();
      await expectNoHorizontalScroll(page, `暗 ${width}px`);
    }
  });
});

// ── 台本ごとの操作数（現状の `/` と、案ごと） ───────────────────────────────────────
const ADDRESS = "鳥取県米子市試験町一丁目3番7号";

const currentContext = async (browser: import("@playwright/test").Browser, width: number, height: number): Promise<BrowserContext> => {
  const ctx = await browser.newContext({ viewport: { width, height }, geolocation: GEO, permissions: ["geolocation"] });
  await ctx.route("**/cyberjapandata.gsi.go.jp/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  return ctx;
};

const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

test.describe("台本ごとの操作数：現状の判定画面（/）", () => {
  for (const [width, height] of [
    [375, 812],
    [1280, 800],
  ] as const) {
    const vp = `${width}x${height}`;
    test.describe(vp, () => {
      test(`現状 ${vp}：ページの高さ・①住所 ②現在地 ③詳細 ④層`, async ({ browser }) => {
        const ctx = await currentContext(browser, width, height);
        const page = await ctx.newPage();
        await Meter.install(page);
        const open = async (): Promise<void> => {
          const first = waitDiagnose(page);
          await page.goto(`${CATALOG}/`);
          await first;
          await expect(page.getByTestId("regulation-map")).toHaveAttribute("data-center-lat", /\d/);
          await expect(page.locator(".maplibregl-canvas")).toBeVisible();
          await page.waitForTimeout(500);
        };
        const map = page.getByTestId("regulation-map");
        const answer = page.getByTestId("verdict-conclusion");
        const results: Measure[] = [];

        await open();
        const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        console.log(`現状 ${vp}: ページ全体の高さ ${docHeight}px（画面の ${(docHeight / height).toFixed(1)} 倍）`);

        // ① 地点を住所で入れて判定する
        let m = new Meter(page);
        const done1 = waitDiagnose(page);
        await m.fill(page.getByPlaceholder(/米子市加茂町1丁目1番地/), ADDRESS);
        await m.click(page.getByRole("button", { name: "住所で位置決定" }));
        await done1;
        await page.waitForTimeout(300);
        results.push(await m.finish("current", vp, "1-address", map, answer, 120));

        // ② 現在地で判定する（位置情報はモック）
        await open();
        m = new Meter(page);
        await m.click(page.getByTestId("current-location-button"));
        await expect(page.getByTestId("current-location-candidate")).toBeVisible();
        const done2 = waitDiagnose(page);
        await m.click(page.getByTestId("current-location-candidate").getByRole("button", { name: "この地点で判定" }));
        await done2;
        await page.waitForTimeout(300);
        results.push(await m.finish("current", vp, "2-geo", map, answer, 120));

        // ③ 結果の詳細（DID の判定の根拠）を確かめる
        await open();
        m = new Meter(page);
        results.push(await m.finish("current", vp, "3-detail", map, page.getByTestId("regulation-card-aviation-law-did"), 300));

        // ④ 層（DID）を切り替えて、地図を見る
        await open();
        m = new Meter(page);
        await m.click(page.getByLabel(/DID（航空法/));
        await expect(map).toHaveAttribute("data-hidden-layers", "did");
        results.push(await m.finish("current", vp, "4-layer", map, answer, 120, false));

        console.log(JSON.stringify(results));
        await ctx.close();
      });
    });
  }
});

const sampleContext = async (browser: import("@playwright/test").Browser, width: number, height: number): Promise<BrowserContext> =>
  browser.newContext({ viewport: { width, height } });

test.describe("台本ごとの操作数：案", () => {
  for (const v of ["sheet", "tabs", "fold", "three"] as const) {
    const [width, height] = v === "three" ? [1280, 800] : [375, 812];
    const vp = `${width}x${height}`;
    test(`${v} ${vp}：①住所 ②現在地 ③詳細 ④層`, async ({ browser }) => {
      const ctx = await sampleContext(browser, width, height);
      const page = await ctx.newPage();
      await Meter.install(page);
      const t = prefix(v);
      const map = page.getByTestId(`${t}-map`);
      const answer = (): Locator => summaryOf(page, v);
      const results: Measure[] = [];

      // ① 地点を住所で入れて判定する
      await openSample(page, v);
      let m = new Meter(page);
      if (v === "tabs") await m.click(page.getByTestId("sp-tab-input"));
      await m.fill(page.getByTestId(`${t}-address`), ADDRESS);
      await m.click(page.getByTestId(`${t}-search`));
      await expect(answer()).toContainText("試験町一丁目");
      results.push(await m.finish(v, vp, "1-address", map, answer()));
      expect(m.taps).toBe(v === "tabs" ? 3 : 2);

      // ② 現在地で判定する
      await openSample(page, v);
      m = new Meter(page);
      await m.click(page.getByTestId(`${t}-geo`));
      await expect(answer()).toContainText("現在地（精度 約 30 m）");
      results.push(await m.finish(v, vp, "2-geo", map, answer()));
      expect(m.taps).toBe(1);

      // ③ 結果の詳細（DID の判定の根拠）を確かめる
      await openSample(page, v);
      m = new Meter(page);
      if (v === "sheet") await m.click(page.getByTestId("sp-handle"));
      if (v === "tabs") await m.click(page.getByTestId("sp-tab-result"));
      await m.click(page.getByTestId(`${t}-row-did-toggle`));
      const basis = page.getByTestId(`${t}-row-did-basis`);
      await expect(basis).toBeVisible();
      results.push(await m.finish(v, vp, "3-detail", map, basis, 60));

      // ④ 層（DID）を切り替えて、地図を見る
      await openSample(page, v);
      m = new Meter(page);
      if (v !== "three") await m.click(page.getByTestId(`${t}-layers-open`));
      await m.click(page.getByTestId(`${t}-layer-did`));
      await expect(map).toHaveAttribute("data-hidden-layers", "did");
      results.push(await m.finish(v, vp, "4-layer", map, answer(), 80, false));

      console.log(JSON.stringify(results));
      await ctx.close();
    });
  }
});
