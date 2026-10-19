import { expect, test, type Locator, type Page } from "@playwright/test";

// Sprint 11b 契約（docs/sprints/sprint-11b.md）の E2E。トップの見出しの線画（一般化したクアッドコプターの平面図）。
// 本番相当サーバー（baseURL）だけを使う。契約 8・9・12・13 は grep と単体テストで確かめる（E2E の対象外）。

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

/** ページを開き、初回の自動判定（地点判定・申請支援診断）が終わるのを待つ。 */
const openReady = async (page: Page): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto("/");
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
};

const hero = (page: Page): Locator => page.locator("header", { has: page.locator("h1") });
const art = (page: Page): Locator => page.getByTestId("hero-line-art");

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const noHorizontalScroll = async (page: Page): Promise<void> => {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw, "横スクロール").toBeLessThanOrEqual(cw);
};

test.describe("A. 表示と配置", () => {
  test("1. 幅 1280px で見出しの中に線画（svg 1 つ）が出て、右端がビューポート内で、左の列と重ならない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openReady(page);
    const a = hero(page).getByTestId("hero-line-art");
    await expect(a).toBeVisible();
    await expect(a.locator("svg")).toHaveCount(1);
    const box = await a.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
    const others: Array<[string, Locator]> = [
      ["h1", hero(page).locator("h1")],
      ["site-lead", page.getByTestId("site-lead")],
      ["site-ops-note", page.getByTestId("site-ops-note")],
      ["site-facts", page.getByTestId("site-facts")],
      ["site-disclaimer", page.getByTestId("site-disclaimer")],
    ];
    for (const [name, loc] of others) {
      const b = await loc.boundingBox();
      expect(b, name).not.toBeNull();
      expect(overlaps(box!, b!), `線画と ${name} が重なる`).toBe(false);
    }
  });

  test("2. 幅 1024px で出て、1023px・768px・375px では出ない。375px で免責が初期表示に入り、横スクロールがない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/");
    await expect(art(page)).toBeVisible();
    await noHorizontalScroll(page);

    for (const width of [1023, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(art(page), `幅 ${width}px`).toBeHidden();
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(art(page)).toBeHidden();
    await expect(page.getByTestId("site-disclaimer")).toBeInViewport();
    const box = await page.getByTestId("site-disclaimer").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(812);
    await noHorizontalScroll(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(art(page)).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("3. 幅 1280px で初回の判定までに見出し内のレイアウトのずれが 0 で、LCP の要素が線画でない", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      const w = window as unknown as { __shifts: Array<{ value: number; nodes: Array<Node | null> }>; __lcp: Array<Element | null> };
      w.__shifts = [];
      w.__lcp = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<{
          value: number;
          sources?: Array<{ node: Node | null }>;
        }>) {
          w.__shifts.push({ value: e.value, nodes: (e.sources ?? []).map((s) => s.node) });
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<{ element: Element | null }>) w.__lcp.push(e.element);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await openReady(page);
    const result = await page.evaluate(() => {
      const w = window as unknown as { __shifts: Array<{ value: number; nodes: Array<Node | null> }>; __lcp: Array<Element | null> };
      const header = Array.from(document.querySelectorAll("header")).find((h) => h.querySelector("h1"));
      const artEl = document.querySelector('[data-testid="hero-line-art"]');
      let headerShift = 0;
      for (const s of w.__shifts) {
        if (s.nodes.some((n) => n && header?.contains(n))) headerShift += s.value;
      }
      const last = w.__lcp.at(-1) ?? null;
      return {
        headerShift,
        lcpInArt: !!(last && artEl?.contains(last)),
        lcpTag: last?.tagName ?? null,
      };
    });
    expect(result.headerShift, "見出し内の layout-shift の合計").toBe(0);
    expect(result.lcpInArt, `LCP の要素（${result.lcpTag}）が線画の中`).toBe(false);
  });
});

test.describe("B. 装飾としての扱い", () => {
  test("4. 線画と svg に aria-hidden、svg に focusable=false。見出しに role=img と img がない", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(art(page)).toHaveAttribute("aria-hidden", "true");
    const svg = art(page).locator("svg");
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    await expect(svg).toHaveAttribute("focusable", "false");
    await expect(hero(page).locator('[role="img"]')).toHaveCount(0);
    await expect(hero(page).locator("img")).toHaveCount(0);
  });

  test("5. 線画が文字を持たない（textContent が空、text・title・desc がない）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const text = await art(page).evaluate((el) => (el.textContent ?? "").replace(/\s+/g, ""));
    expect(text).toBe("");
    for (const tag of ["text", "title", "desc"]) {
      await expect(art(page).locator(`svg ${tag}`), tag).toHaveCount(0);
    }
  });
});

/** 線画の線の見かけの色（祖先の不透明度で紙の色に重ねた色）と紙の色のコントラスト比などを返す。 */
const measureArt = (page: Page) =>
  art(page)
    .locator("svg")
    .evaluate((svg) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      const toRgb = (c: string): [number, number, number, number] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const cs = getComputedStyle(svg);
      let opacity = 1;
      for (let el: Element | null = svg; el; el = el.parentElement) {
        opacity *= Number(getComputedStyle(el).opacity);
      }
      const paperStr = getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim();
      const paper = toRgb(paperStr);
      const line = toRgb(cs.color);
      const a = opacity * line[3];
      const mixed = [0, 1, 2].map((i) => line[i] * a + paper[i] * (1 - a));
      const l1 = lum(mixed);
      const l2 = lum(paper);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const strokes = Array.from(svg.querySelectorAll("[stroke]"))
        .concat([svg])
        .map((el) => el.getAttribute("stroke"))
        .filter((s): s is string => s !== null);
      return {
        filter: cs.filter,
        blend: cs.mixBlendMode,
        color: cs.color,
        ratio,
        strokes,
      };
    });

test.describe("C. 色とダークモード", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`6. ${scheme}：filter・mix-blend-mode なし、stroke は currentColor、コントラスト比 1.8 以上 4.5 未満`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");
      await expect(art(page)).toBeVisible();
      const m = await measureArt(page);
      expect(m.filter).toBe("none");
      expect(m.blend).toBe("normal");
      expect(m.strokes.length).toBeGreaterThan(0);
      for (const s of m.strokes) expect(["currentColor", "none"]).toContain(s);
      expect(m.ratio, `コントラスト比 ${m.ratio.toFixed(2)}`).toBeGreaterThanOrEqual(1.8);
      expect(m.ratio, `コントラスト比 ${m.ratio.toFixed(2)}`).toBeLessThan(4.5);
    });
  }

  test("7. ライトとダークで svg の算出 color が異なる", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const light = (await measureArt(page)).color;
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = (await measureArt(page)).color;
    expect(light).not.toBe(dark);
  });
});
