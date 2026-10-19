import { expect, test, type Locator, type Page } from "@playwright/test";

// Sprint 11b 契約（docs/sprints/sprint-11b.md、2026-10-20 改訂）の E2E。トップの見出しの線画
// （ユーザーが Adobe Firefly で生成したドローンの線画 PNG、apps/web/public/hero-drone.png を next/image で表示）。
// 本番相当サーバー（baseURL）だけを使う。契約 8〜14 は grep・目視・単体テストで確かめる（E2E の対象外）。
// 「図の要素」は data-testid="hero-line-art-image" の要素。img（next/image）でも、別案の mask 方式の要素でも測れるようにする。

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

/** 図の要素（hero-line-art-image）。 */
const image = (page: Page): Locator => art(page).getByTestId("hero-line-art-image");

/** 図の要素が img なら、読み込みが終わるまで待つ。 */
const waitImageLoaded = async (page: Page): Promise<void> => {
  const img = image(page);
  const tag = await img.evaluate((el) => el.tagName);
  if (tag !== "IMG") return;
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))
    .toBe(true);
};

test.describe("A. 表示と配置", () => {
  test("1. 幅 1280px で見出しの中に線画（図の要素 1 つ、読み込み済み）が出て、右端がビューポート内で、左の列と重ならない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openReady(page);
    const a = hero(page).getByTestId("hero-line-art");
    await expect(a).toBeVisible();
    await expect(a.getByTestId("hero-line-art-image")).toHaveCount(1);
    await waitImageLoaded(page);
    const box = await a.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
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

  test("2. 幅 1024px で出て、1023px・768px・375px では出ない。375px で免責が初期表示に入り、横スクロールがなく、画像を要求しない", async ({
    page,
  }) => {
    // 幅 375px：初回の判定が終わるまでに hero-drone の要求が 1 件も出ない（/hero-drone.png と /_next/image?url=%2Fhero-drone.png… の両方）
    const requested: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("hero-drone")) requested.push(r.url());
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    await expect(art(page)).toBeHidden();
    await expect(page.getByTestId("site-disclaimer")).toBeInViewport();
    const box = await page.getByTestId("site-disclaimer").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(812);
    await noHorizontalScroll(page);
    expect(requested, "幅 375px での hero-drone の要求").toEqual([]);

    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/");
    await expect(art(page)).toBeVisible();
    await noHorizontalScroll(page);

    for (const width of [1023, 768, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
      await expect(art(page), `幅 ${width}px`).toBeHidden();
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(art(page)).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("3. 幅 1280px で初回の判定と図の読み込みまでに見出し内のレイアウトのずれが 0、LCP が線画でない、優先読み込みをしない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      const w = window as unknown as {
        __shifts: Array<{ value: number; nodes: Array<Node | null> }>;
        __lcp: Array<Element | null>;
      };
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
    await waitImageLoaded(page);
    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __shifts: Array<{ value: number; nodes: Array<Node | null> }>;
        __lcp: Array<Element | null>;
      };
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

    const img = image(page);
    if ((await img.evaluate((el) => el.tagName)) === "IMG") {
      expect(await img.getAttribute("fetchpriority")).not.toBe("high");
      await expect(img).toHaveAttribute("loading", "lazy");
    }
  });
});

test.describe("B. 装飾としての扱い", () => {
  test("4. 線画に aria-hidden、img の alt は空。見出しに role=img がなく、img は図の要素だけ", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(art(page)).toHaveAttribute("aria-hidden", "true");
    await expect(hero(page).locator('[role="img"]')).toHaveCount(0);
    const img = image(page);
    const isImg = (await img.evaluate((el) => el.tagName)) === "IMG";
    if (isImg) {
      await expect(img).toHaveAttribute("alt", "");
      await expect(hero(page).locator("img")).toHaveCount(1);
    } else {
      await expect(hero(page).locator("img")).toHaveCount(0);
    }
    // 線画の外（見出しの中）に img がない
    const outside = await hero(page).evaluate((h) => {
      const artEl = h.querySelector('[data-testid="hero-line-art"]');
      return Array.from(h.querySelectorAll("img")).filter((i) => !artEl?.contains(i)).length;
    });
    expect(outside, "線画の外の img").toBe(0);
  });

  test("5. 線画が文字を足さない（textContent が空、svg がない）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const text = await art(page).evaluate((el) => (el.textContent ?? "").replace(/\s+/g, ""));
    expect(text).toBe("");
    await expect(art(page).locator("svg")).toHaveCount(0);
  });
});

/**
 * 線の見かけの色（契約 6 の求め方）と、紙・本文（site-lead）とのコントラスト比を返す。
 * - img：元の線は黒。算出 filter に invert(1)／invert(100%) を含むときは白。
 * - mask 方式（img 以外）：算出 background-color。
 * これを図の要素から <html> までの算出 opacity の積（と色のアルファ）で --color-paper に重ねる。
 */
const measureArt = (page: Page) =>
  image(page).evaluate((el) => {
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
    const contrast = (a: number[], b: number[]) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const cs = getComputedStyle(el);
    const filter = cs.filter;
    let line: [number, number, number, number];
    if (el.tagName === "IMG") {
      const inverted = /invert\((1|100%)\)/.test(filter);
      line = inverted ? [255, 255, 255, 1] : [0, 0, 0, 1];
    } else {
      line = toRgb(cs.backgroundColor);
    }
    let opacity = 1;
    for (let e: Element | null = el; e; e = e.parentElement) {
      opacity *= Number(getComputedStyle(e).opacity);
    }
    const paperStr = getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim();
    const paper = toRgb(paperStr);
    const a = opacity * line[3];
    const mixed = [0, 1, 2].map((i) => line[i] * a + paper[i] * (1 - a));
    const lead = toRgb(getComputedStyle(document.querySelector('[data-testid="site-lead"]')!).color);
    return {
      filter,
      mixed: mixed.map((v) => Math.round(v)).join(","),
      ratio: contrast(mixed, paper),
      leadRatio: contrast(lead, paper),
      lineLum: lum(mixed),
      paperLum: lum(paper),
    };
  });

test.describe("C. 色とダークモード", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`6. ${scheme}：線の見かけの色と紙のコントラスト比が 1.8 以上 4.5 未満で、本文（site-lead）より小さい`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");
      await expect(art(page)).toBeVisible();
      const m = await measureArt(page);
      const label = `${scheme}：線 ${m.ratio.toFixed(2)}（rgb ${m.mixed}、filter ${m.filter}）／本文 ${m.leadRatio.toFixed(2)}`;
      expect(m.ratio, label).toBeGreaterThanOrEqual(1.8);
      expect(m.ratio, label).toBeLessThan(4.5);
      expect(m.ratio, label).toBeLessThan(m.leadRatio);
    });
  }

  test("7. ライトとダークで線の見かけの色が異なり、ダークでは紙より明るい線になる", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(art(page)).toBeVisible();
    const light = await measureArt(page);
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await measureArt(page);
    expect(light.mixed).not.toBe(dark.mixed);
    expect(dark.lineLum, "ダークの線の相対輝度が紙より高い").toBeGreaterThan(dark.paperLum);
  });
});
