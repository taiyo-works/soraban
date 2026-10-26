import { expect, test, type Locator, type Page } from "@playwright/test";

// Sprint 11b 契約（docs/sprints/sprint-11b.md）の、トップの見出しの絵（挿絵）の E2E。
// Sprint 12h PR ②（docs/sprints/sprint-12h-pr2.md §9.1）で、絵を Firefly の PNG（hero-drone.png。幅 1024px 以上だけ・img・alt 空）から、
// 独自のインライン SVG（丘・雲・日の出・ドローンの線画。全幅・スマホ 232px 以下／PC 320px 以下）に置き換えた。
// 維持した意図：装飾（aria-hidden・文字を足さない・読み上げない）、見出し内のレイアウトのずれ 0、LCP が絵でない、優先読み込みなし、
// 画像の要求 0、横スクロールなし、文字が読める（コントラスト）。変えたのは、作りの違いに依る検査（「1023px 以下は非表示」「svg がない」「alt 空の img」）だけで、
// 同じ意図（装飾・文字を足さない・ずれない）を新しい作りに合わせて置き換えた。本番相当サーバー（baseURL）だけを使う。

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
const art = (page: Page): Locator => page.getByTestId("hero-art");

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
  test("1. 幅 1280px で見出しの中に絵（装飾の SVG）が出て、右端がビューポート内で、高さは 320px 以下。本文の塊（site-*）と重ならない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openReady(page);
    const a = hero(page).getByTestId("hero-art");
    await expect(a).toBeVisible();
    const box = await a.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.height).toBeLessThanOrEqual(320);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
    // 見出し（h1）は絵の上（空の淡い色の上）に載せる。本文・会社概要・免責は絵の下で、重ならない
    const h1 = await hero(page).locator("h1").boundingBox();
    expect(h1).not.toBeNull();
    expect(overlaps(box!, h1!), "h1 は絵の上に載る").toBe(true);
    const others: Array<[string, Locator]> = [
      ["site-lead", page.getByTestId("site-lead")],
      ["site-ops-note", page.getByTestId("site-ops-note")],
      ["site-facts", page.getByTestId("site-facts")],
      ["site-disclaimer", page.getByTestId("site-disclaimer")],
    ];
    for (const [name, loc] of others) {
      const b = await loc.boundingBox();
      expect(b, name).not.toBeNull();
      expect(overlaps(box!, b!), `絵と ${name} が重なる`).toBe(false);
    }
    // 文字（h1）は丘にかからない：h1 の下端は、絵の高さの 62% より上（丘の稜線の最も高い所は 64% より下）
    expect(h1!.y + h1!.height - box!.y, "h1 の下端が丘にかかる").toBeLessThanOrEqual(box!.height * 0.62);
  });

  test("2. 全幅（375・768・1023・1024・1280・1440px）で出る。スマホの高さは 232px 以下。375px で免責が初期表示に入り、横スクロールがなく、画像を要求しない", async ({
    page,
  }) => {
    // 初回の判定が終わるまでに hero-drone の要求が 1 件も出ない（/hero-drone.png と /_next/image?url=%2Fhero-drone.png… の両方）。画像の要求そのものも 0
    const requested: string[] = [];
    const images: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("hero-drone")) requested.push(r.url());
      if (r.resourceType() === "image") images.push(r.url());
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    await expect(art(page)).toBeVisible();
    const m = await art(page).boundingBox();
    expect(m!.height).toBeLessThanOrEqual(232);
    await expect(page.getByTestId("site-disclaimer")).toBeInViewport();
    const box = await page.getByTestId("site-disclaimer").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(812);
    await noHorizontalScroll(page);
    expect(requested, "hero-drone の要求").toEqual([]);
    expect(images.filter((u) => !u.includes("cyberjapandata") && !u.includes("127.0.0.1:3199")), "画像の要求（地図タイルを除く）").toEqual([]);

    for (const [width, maxH] of [
      [768, 232],
      [1023, 232],
      [1024, 320],
      [1280, 320],
      [1440, 320],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await expect(art(page), `幅 ${width}px`).toBeVisible();
      const b = await art(page).boundingBox();
      expect(b!.height, `幅 ${width}px の高さ`).toBeLessThanOrEqual(maxH);
      await noHorizontalScroll(page);
    }
    expect(requested, "hero-drone の要求（全幅）").toEqual([]);
  });

  for (const [width, height] of [
    [375, 812],
    [1280, 800],
  ] as const) {
    test(`3. 幅 ${width}px で初回の判定までに見出し内のレイアウトのずれが 0、LCP が絵・結論カードでない、画像の優先読み込みがない`, async ({ page }) => {
      await page.setViewportSize({ width, height });
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
      await page.waitForTimeout(1500);
      const result = await page.evaluate(() => {
        const w = window as unknown as {
          __shifts: Array<{ value: number; nodes: Array<Node | null> }>;
          __lcp: Array<Element | null>;
        };
        const header = Array.from(document.querySelectorAll("header")).find((h) => h.querySelector("h1"));
        const artEl = document.querySelector('[data-testid="hero-art"]');
        const verdict = document.querySelector('[data-testid="verdict-conclusion"]');
        let headerShift = 0;
        for (const s of w.__shifts) {
          if (s.nodes.some((n) => n && header?.contains(n))) headerShift += s.value;
        }
        const last = w.__lcp.at(-1) ?? null;
        return {
          headerShift,
          lcpInArt: !!(last && artEl?.contains(last)),
          lcpInVerdict: !!(last && verdict?.contains(last)),
          lcpTag: last?.tagName ?? null,
          preloadedImages: document.querySelectorAll('link[rel="preload"][as="image"], img[fetchpriority="high"]').length,
        };
      });
      expect(result.headerShift, "見出し内の layout-shift の合計").toBe(0);
      expect(result.lcpInArt, `LCP の要素（${result.lcpTag}）が絵の中`).toBe(false);
      expect(result.lcpInVerdict, `LCP の要素（${result.lcpTag}）が結論カードの中`).toBe(false);
      expect(result.preloadedImages, "画像の優先読み込み").toBe(0);
    });
  }
});

test.describe("B. 装飾としての扱い", () => {
  test("4. 絵に aria-hidden。見出しに role=img・img がなく、`/` に h1 は 1 つ", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(art(page)).toHaveAttribute("aria-hidden", "true");
    await expect(hero(page).locator('[role="img"]')).toHaveCount(0);
    await expect(hero(page).locator("img")).toHaveCount(0);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("5. 絵が文字を足さない（textContent が空、svg の text 要素がない）。svg は装飾（aria-hidden）だけ", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const text = await art(page).evaluate((el) => (el.textContent ?? "").replace(/\s+/g, ""));
    expect(text).toBe("");
    await expect(art(page).locator("text")).toHaveCount(0);
    const svgs = await art(page).locator("svg").evaluateAll((els) => els.filter((e) => e.getAttribute("aria-hidden") !== "true" && !e.closest("svg[aria-hidden='true']")).length);
    expect(svgs, "aria-hidden でない svg").toBe(0);
  });
});

/** 見出し（h1）の文字色と、挿絵の空の色（淡い水色・暖色）のコントラスト比。色は --sb-art-*（挿絵専用）と --sb-ink から引く。 */
const measureHeroText = (page: Page) =>
  page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const toRgb = (c: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const ratio = (a: number[], b: number[]) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const root = getComputedStyle(document.documentElement);
    const sky = toRgb(root.getPropertyValue("--sb-art-sky").trim());
    const warm = toRgb(root.getPropertyValue("--sb-art-sky-warm").trim());
    const h1 = toRgb(getComputedStyle(document.querySelector("h1")!).color);
    const stop = document.querySelector('[data-testid="hero-art"] linearGradient stop');
    return {
      sky: sky.join(","),
      h1: h1.join(","),
      onSky: ratio(h1, sky),
      onWarm: ratio(h1, warm),
      skyLum: lum(sky),
      stopColor: stop ? getComputedStyle(stop).stopColor : null,
    };
  });

test.describe("C. 色とダークモード", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`6. ${scheme}：見出しの文字が挿絵の空の上で 4.5:1 以上。挿絵の色は --sb-art-* から来る`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");
      await expect(art(page)).toBeVisible();
      const m = await measureHeroText(page);
      expect(m.onSky, `${scheme} 空の淡い色の上 ${m.onSky.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      expect(m.onWarm, `${scheme} 空の暖色の上 ${m.onWarm.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      expect(m.stopColor, "空のグラデーションがトークンの色").not.toBeNull();
    });
  }

  test("7. ライトとダークで空の色が異なり、ダークの空は暗い（昼の景色が夜になる）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(art(page)).toBeVisible();
    const light = await measureHeroText(page);
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await measureHeroText(page);
    expect(light.sky).not.toBe(dark.sky);
    expect(dark.skyLum, "ダークの空の相対輝度").toBeLessThan(0.05);
    expect(light.skyLum, "ライトの空の相対輝度").toBeGreaterThan(0.7);
  });
});
