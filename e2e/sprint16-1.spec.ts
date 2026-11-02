import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "./field-checks";

// Sprint 16-1 の E2E（DB なし）：白基調のトークン、作り直した見本（/ops/design）、`/` の挿絵、常に明るい表示、橙の主ボタンの墨の縁。
// 見本は DESIGN_CATALOG=1 の 2 台目だけが表示する（1 台目は 404）。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

const WHITE = "rgb(255, 255, 255)";
const INK = "rgb(38, 37, 35)";
const ORANGE = "rgb(248, 155, 72)";

const open = async (page: Page, query = ""): Promise<void> => {
  await page.goto(`${CATALOG}/ops/design${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("design-catalog")).toBeVisible();
};

test.describe("A. 見本の表示と 404（R-5）", () => {
  test("1. フラグ無効のサーバーでは 404。配下の別のパスも 404", async ({ page }) => {
    expect((await page.goto(`${MAIN}/ops/design`))?.status()).toBe(404);
    expect((await page.goto(`${MAIN}/ops/design?mode=field`))?.status()).toBe(404);
    expect((await page.goto(`${CATALOG}/ops/design/x`))?.status()).toBe(404);
    await page.goto(`${MAIN}/ops/design`);
    await expect(page.getByTestId("design-catalog")).toHaveCount(0);
  });

  test("2. 有効のサーバーでは 200・noindex。見出しは 1 つ。外部通信・API 呼び出しがない。運航管理の枠が付かない。旧い見本の部品が無い", async ({ page }) => {
    const origins = new Set<string>();
    const api: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      origins.add(u.origin);
      if (u.pathname.startsWith("/api/")) api.push(u.pathname);
    });
    const res = await page.goto(`${CATALOG}/ops/design`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.getByTestId("design-catalog")).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    for (const id of ["cat-grounds", "cat-buttons", "cat-forms", "cat-verdict", "cat-orange", "cat-band-section", "cat-art-section"]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    for (const id of ["ops-header", "ops-bottom-nav", "ops-sidebar", "ops-root", "style-trial", "ctl-screen"]) await expect(page.getByTestId(id), id).toHaveCount(0);
    expect(api).toEqual([]);
    expect([...origins]).toEqual([new URL(CATALOG).origin]);
    // ?view=style など旧い見本の設定は無視される（見本は 1 つだけ）
    await page.goto(`${CATALOG}/ops/design?view=style&palette=3`);
    await expect(page.getByTestId("design-catalog")).toBeVisible();
    await expect(page.getByTestId("style-trial")).toHaveCount(0);
  });

  test("3. 判定の 5 段が形と言葉を持つ（色だけで区別しない）", async ({ page }) => {
    await open(page);
    for (const level of ["no_fly", "needs_procedure", "procedure_done", "no_procedure", "unknown"]) {
      const tag = page.getByTestId(`cat-verdict-${level}`);
      await expect(tag).toBeVisible();
      expect((await tag.innerText()).trim().length, level).toBeGreaterThan(0);
      await expect(tag.locator("svg")).toHaveCount(1);
    }
  });
});

test.describe("B. 白基調（H-1・H-2・U-4）", () => {
  for (const width of [375, 1280]) {
    test(`4. 幅 ${width}px：見本のページの地は白、面はごく薄いグレー、くぼみは一段濃いグレー。横スクロールなし。影なし`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      const v = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        html: getComputedStyle(document.documentElement).backgroundColor,
        grounds: ["base", "surface", "sunken"].map((g) => getComputedStyle(document.querySelector(`[data-ground="${g}"]`)!).backgroundColor),
        shadows: [...document.querySelectorAll<HTMLElement>('[data-testid="design-catalog"] *')].map((e) => getComputedStyle(e).boxShadow).filter((s) => s !== "none" && !s.includes("inset")),
      }));
      expect(v.body).toBe(WHITE);
      expect(v.html).toBe(WHITE);
      expect(v.grounds).toEqual([WHITE, "rgb(246, 247, 247)", "rgb(238, 240, 240)"]);
      expect(v.shadows, "影").toEqual([]);
      await expectNoHorizontalScroll(page, `見本 ${width}`);
    });
  }

  test("5. `/`：ページの地は白（帯の交互のベージュ・オフホワイトが無い）。見出しの背後の大きな数字が無い。ブロックは罫で分け、影が無い", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${MAIN}/`);
    await expect(page.getByTestId("hero-art")).toBeVisible();
    const v = await page.evaluate(() => {
      const bands = [...document.querySelectorAll<HTMLElement>(".sb-band")].map((e) => getComputedStyle(e).backgroundColor);
      const blocks = [...document.querySelectorAll<HTMLElement>(".sb-block")].map((e) => ({ shadow: getComputedStyle(e).boxShadow, border: getComputedStyle(e).borderTopWidth }));
      return { body: getComputedStyle(document.body).backgroundColor, bands, blocks, nums: document.querySelectorAll(".sb-sec-num").length };
    });
    expect(v.body).toBe(WHITE);
    expect(v.bands.length).toBeGreaterThan(1);
    for (const b of v.bands) expect(b).toBe(WHITE);
    expect(v.nums).toBe(0);
    for (const b of v.blocks) {
      expect(b.shadow).toBe("none");
      expect(b.border).toBe("1px");
    }
  });
});

test.describe("C. 橙の主ボタンの墨の縁（H-3・C-4）", () => {
  test("6. 見本（通常）：主ボタンは橙の面＋墨の縁 1px。副ボタンの縁は墨ではない橙でもない。橙の文字が無い", async ({ page }) => {
    await open(page);
    for (const id of ["cat-primary", "cat-opx-primary"]) {
      const s = await page.getByTestId(id).evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, bw: c.borderTopWidth, bs: c.borderTopStyle, bc: c.borderTopColor, color: c.color };
      });
      expect(s.bg, id).toBe(ORANGE);
      expect(s.bc, id).toBe(INK);
      expect(s.bs, id).toBe("solid");
      expect(s.bw, id).toBe("1px");
      expect(s.color, id).toBe(INK);
    }
    const orangeText = await page.evaluate((o) => [...document.querySelectorAll<HTMLElement>('[data-testid="design-catalog"] *')].filter((e) => e.childNodes.length > 0 && [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "") && getComputedStyle(e).color === o).length, ORANGE);
    expect(orangeText, "橙の文字").toBe(0);
  });

  test("7. 見本（現場）：主ボタン 64px 以上・縁 1.5px・影なし・動き 0。色は通常と同じ", async ({ page }) => {
    await open(page, "mode=field");
    await expect(page.locator("html")).toHaveAttribute("data-mode", "field");
    const s = await page.getByTestId("cat-opx-primary").evaluate((el) => {
      const c = getComputedStyle(el);
      return { h: el.getBoundingClientRect().height, bw: parseFloat(c.borderTopWidth), token: getComputedStyle(document.documentElement).getPropertyValue("--sb-rule-w").trim(), bc: c.borderTopColor, shadow: c.boxShadow, td: c.transitionDuration };
    });
    expect(s.h).toBeGreaterThanOrEqual(63.5);
    // 縁の太さは --sb-rule-w（現場で 1.5px）。Chromium は等倍の画面で枠線の太さを 1px 単位に丸めるので、トークンの値と 1px 以上で確かめる
    expect(s.token).toBe("1.5px");
    expect(s.bw).toBeGreaterThanOrEqual(1);
    expect(s.bc).toBe(INK);
    expect(s.shadow).toBe("none");
    expect(s.td.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  });

  test("8. `/` の主ボタン（.sb-pill-primary）にも墨の縁がある", async ({ page }) => {
    await page.goto(`${MAIN}/`);
    const n = await page.locator(".sb-pill-primary").count();
    expect(n).toBeGreaterThan(0);
    const bs = await page.locator(".sb-pill-primary").evaluateAll((els) => els.map((el) => ({ c: getComputedStyle(el).borderTopColor, w: getComputedStyle(el).borderTopWidth, bg: getComputedStyle(el).backgroundColor })));
    for (const b of bs) {
      if (b.bg === ORANGE) {
        expect(b.c).toBe(INK);
        expect(b.w).toBe("1px");
      }
    }
  });
});

test.describe("D. 常に明るい表示（D-1・D-2）", () => {
  test("9. OS が暗でも `/` と見本は明で描かれる（body が白、color-scheme が light）", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    for (const url of [`${MAIN}/`, `${CATALOG}/ops/design`, `${CATALOG}/ops/design?mode=field`]) {
      await page.goto(url);
      await expect(page.locator("body")).toBeVisible();
      const v = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color, scheme: getComputedStyle(document.documentElement).colorScheme, ink: getComputedStyle(document.documentElement).getPropertyValue("--sb-ink").trim() }));
      expect(v.bg, url).toBe(WHITE);
      expect(v.fg, url).toBe(INK);
      expect(v.ink, url).toBe("#262523");
      expect(v.scheme, url).toMatch(/^light/);
    }
  });

  test("10. 強制の暗（?theme=dark）は見本だけで効く（休眠の値の確認）。見本を離れて `/` を開くと付かない", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await open(page, "theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(27, 26, 24)");
    await page.goto(`${CATALOG}/`);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(WHITE);
  });

  test("11. 日差しの模擬（?veil=1）：白い膜が画面を覆い、押す操作を妨げない（pointer-events: none）", async ({ page }) => {
    await open(page, "veil=1");
    const v = await page.getByTestId("cat-veil").evaluate((el) => {
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, pe: c.pointerEvents, pos: c.position, w: el.getBoundingClientRect().width, vw: window.innerWidth };
    });
    expect(v.bg).toBe("rgba(255, 255, 255, 0.35)");
    expect(v.pe).toBe("none");
    expect(v.pos).toBe("fixed");
    expect(v.w).toBe(v.vw);
    await page.getByTestId("cat-opx-secondary").click();
    await open(page);
    await expect(page.getByTestId("cat-veil")).toHaveCount(0);
  });
});

test.describe("E. `/` の挿絵（Q2：線画）", () => {
  for (const [name, width] of [["スマホ", 375], ["PC", 1280]] as const) {
    test(`12. ${name}：挿絵に塗りの色（ティール・水色・グラデーション）が無い。塗りは橙の日の出と、白（背後の線を隠すだけ）だけ。高さは変えない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`${MAIN}/`);
      const art = page.getByTestId("hero-art");
      await expect(art).toBeVisible();
      const v = await art.evaluate((root) => {
        const vis = [...root.querySelectorAll<SVGElement>("svg")].filter((s) => (s as unknown as HTMLElement).getBoundingClientRect().width > 0);
        const fills = new Set<string>();
        for (const svg of vis) for (const e of svg.querySelectorAll("path, circle, ellipse, rect")) { const f = getComputedStyle(e).fill; if (f && f !== "none") fills.add(f); }
        return { fills: [...fills], gradients: root.querySelectorAll("linearGradient, radialGradient").length };
      });
      expect(v.gradients).toBe(0);
      for (const f of v.fills) expect(["rgb(248, 155, 72)", WHITE, "rgb(38, 37, 35)"], `塗り ${f}`).toContain(f);
      expect(v.fills).toContain("rgb(248, 155, 72)");
    });
  }
});
