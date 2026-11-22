import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "./field-checks";

// Sprint 16-1 の E2E（DB なし）：トークン、作り直した見本（/ops/design）、`/` の挿絵、常に明るい表示、主ボタン。Sprint 16-A で、橙・白基調の期待値を主色（空色）・地 #F6F7F9 の値に置き換えた（同じ意図。docs/evaluations/sprint-16-test-changes.md）。
// 見本は DESIGN_CATALOG=1 の 2 台目だけが表示する（1 台目は 404）。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

const WHITE = "rgb(255, 255, 255)";
const BASE = "rgb(246, 247, 249)"; // --sb-base（ページの地）
const SUNKEN = "rgb(238, 241, 245)"; // --sb-sunken
const INK = "rgb(20, 24, 31)";
const PRIMARY = "rgb(31, 95, 224)"; // --sb-primary（明）
const FIELD_PRIMARY = "rgb(24, 72, 176)"; // --sb-primary（現場）
const RULE = "rgb(225, 229, 235)"; // --sb-rule（明）

const rgbOf = (c: string): [number, number, number] => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
const lumOf = (c: string): number => {
  const [r, g, b] = rgbOf(c).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratioOf = (a: string, b: string): number => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

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

test.describe("B. 地・面・くぼみ（H-1・H-2・U-4。16-A：地 #F6F7F9・面 白）", () => {
  for (const width of [375, 1280]) {
    test(`4. 幅 ${width}px：見本のページの地は #F6F7F9、面は白、くぼみは一段濃いグレー。横スクロールなし。影なし`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      const v = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        html: getComputedStyle(document.documentElement).backgroundColor,
        grounds: ["base", "surface", "sunken"].map((g) => getComputedStyle(document.querySelector(`[data-ground="${g}"]`)!).backgroundColor),
        shadows: [...document.querySelectorAll<HTMLElement>('[data-testid="design-catalog"] *')].map((e) => getComputedStyle(e).boxShadow).filter((s) => s !== "none" && !s.includes("inset")),
      }));
      expect(v.body).toBe(BASE);
      expect(v.html).toBe(BASE);
      expect(v.grounds).toEqual([BASE, WHITE, SUNKEN]);
      expect(v.shadows, "影").toEqual([]);
      await expectNoHorizontalScroll(page, `見本 ${width}`);
    });
  }

  test("5. `/`：ページの地は #F6F7F9（帯の交互のベージュ・オフホワイトが無い）。見出しの背後の大きな数字が無い。ブロックは罫（内側の 1px の輪）で分け、外へ広がる影が無い", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${MAIN}/`);
    await expect(page.getByTestId("hero-art")).toBeVisible();
    const v = await page.evaluate(() => {
      const bands = [...document.querySelectorAll<HTMLElement>(".sb-band")].map((e) => getComputedStyle(e).backgroundColor);
      const blocks = [...document.querySelectorAll<HTMLElement>(".sb-block")].map((e) => ({ shadow: getComputedStyle(e).boxShadow }));
      return { body: getComputedStyle(document.body).backgroundColor, bands, blocks, nums: document.querySelectorAll(".sb-sec-num").length };
    });
    expect(v.body).toBe(BASE);
    expect(v.bands.length).toBeGreaterThan(1);
    for (const b of v.bands) expect(b).toBe(BASE);
    expect(v.nums).toBe(0);
    // 罫は内側の 1px の輪（inset。レイアウトの寸法を変えない）。外へ広がる影は無い
    expect(v.blocks.length).toBeGreaterThan(0);
    for (const b of v.blocks) expect(b.shadow).toBe(`${RULE} 0px 0px 0px 1px inset`);
  });
});

test.describe("C. 主ボタンは主色の面（H-3・C-4。16-A：墨の縁は不要で、面と地の比 3 以上）", () => {
  test("6. 見本（通常）：主ボタンは主色の面＋白の文字。面と地の比は 3 以上。橙系の文字・面が無い", async ({ page }) => {
    await open(page);
    for (const id of ["cat-primary", "cat-opx-primary"]) {
      const s = await page.getByTestId(id).evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, bw: c.borderTopWidth, bs: c.borderTopStyle, bc: c.borderTopColor, color: c.color };
      });
      expect(s.bg, id).toBe(PRIMARY);
      expect(s.color, id).toBe(WHITE);
      // 縁は面と同じ色（縁の検査は「面と地の比 3 以上」に置き換えた）
      expect(s.bc, id).toBe(PRIMARY);
      expect(s.bs, id).toBe("solid");
      expect(ratioOf(s.bg, BASE), `${id}: 面と地の比`).toBeGreaterThanOrEqual(3);
      expect(ratioOf(s.color, s.bg), `${id}: 文字と面の比`).toBeGreaterThanOrEqual(4.5);
    }
    // 橙系（色相 20〜50°・彩度 0.5 以上）の文字・面・縁は見本に無い。状態「注意」（琥珀の印・面）は別に許す
    const orangeish = await page.evaluate(() => {
      const hs = (c: string): [number, number] => {
        const m = (c.match(/[\d.]+/g) ?? []).map(Number);
        if (m.length < 3 || (m.length > 3 && m[3] === 0)) return [0, 0];
        const [r, g, b] = [m[0]! / 255, m[1]! / 255, m[2]! / 255];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (!d) return [0, 0];
        const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [(h * 60 + 360) % 360, d / mx];
      };
      const warn = ["--sb-st-warn-mark", "--sb-st-warn-text", "--sb-st-warn-face", "--sb-v-needs-fill", "--sb-v-needs-fg"].map((v) => { const p = document.createElement("div"); p.style.color = `var(${v})`; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
      let n = 0;
      for (const e of document.querySelectorAll<HTMLElement>('[data-testid="design-catalog"] *')) {
        const c = getComputedStyle(e);
        for (const col of [c.color, c.backgroundColor, c.borderTopColor]) {
          const [h, sat] = hs(col);
          if (h >= 20 && h <= 50 && sat >= 0.5 && !warn.includes(col)) n++;
        }
      }
      return n;
    });
    expect(orangeish, "橙系の色").toBe(0);
  });

  test("7. 見本（現場）：主ボタン 64px 以上・縁 1.5px・影なし・動き 0。面は現場の濃い主色", async ({ page }) => {
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
    expect(s.bc).toBe(FIELD_PRIMARY);
    expect(s.shadow).toBe("none");
    expect(s.td.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  });

  test("7b. 見本（現場）：判定の札は状態の語 20px 以上・56px 以上、本文 18px、押す部品 56px 以上", async ({ page }) => {
    await open(page, "mode=field");
    const v = await page.evaluate(() => ({
      body: parseFloat(getComputedStyle(document.querySelector('[data-testid="design-catalog"]')!).fontSize),
      tags: [...document.querySelectorAll<HTMLElement>('[data-testid^="cat-verdict-"]')].map((e) => ({ fs: parseFloat(getComputedStyle(e).fontSize), h: e.getBoundingClientRect().height })),
      btns: [...document.querySelectorAll<HTMLElement>('[data-testid="cat-buttons"] button')].map((e) => ({ fs: parseFloat(getComputedStyle(e).fontSize), h: e.getBoundingClientRect().height })),
    }));
    expect(v.body).toBeGreaterThanOrEqual(18);
    for (const t of v.tags) { expect(t.fs).toBeGreaterThanOrEqual(20); expect(t.h).toBeGreaterThanOrEqual(55.5); }
    for (const b of v.btns) { expect(b.fs).toBeGreaterThanOrEqual(18); expect(b.h).toBeGreaterThanOrEqual(55.5); }
    await expect(page.getByTestId("cat-field-note")).toBeVisible();
  });

  test("8. `/` の主ボタン（.sb-pill-primary）も主色の面＋白の文字で、面と地の比が 3 以上", async ({ page }) => {
    await page.goto(`${MAIN}/`);
    await page.locator(".sb-pill-primary:not(:disabled)").first().waitFor();
    const n = await page.locator(".sb-pill-primary").count();
    expect(n).toBeGreaterThan(0);
    // 無効から有効へ変わる間は背景が遷移する（--sb-dur）。落ち着いてから、無効でない主ボタンをすべて確かめる
    const read = () => page.locator(".sb-pill-primary").evaluateAll((els) => els.filter((el) => !el.matches(":disabled") && el.getAttribute("aria-disabled") !== "true").map((el) => ({ c: getComputedStyle(el).borderTopColor, color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor })));
    await expect.poll(async () => (await read()).every((b) => b.bg === PRIMARY && b.color === WHITE && b.c === PRIMARY), { timeout: 10_000 }).toBe(true);
    const bs = await read();
    expect(bs.length).toBeGreaterThan(0);
    for (const b of bs) expect(ratioOf(b.bg, BASE)).toBeGreaterThanOrEqual(3);
  });
});

test.describe("D. 常に明るい表示（D-1・D-2）", () => {
  test("9. OS が暗でも `/` と見本は明で描かれる（body が #F6F7F9、color-scheme が light）", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    for (const url of [`${MAIN}/`, `${CATALOG}/ops/design`, `${CATALOG}/ops/design?mode=field`]) {
      await page.goto(url);
      await expect(page.locator("body")).toBeVisible();
      const v = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color, scheme: getComputedStyle(document.documentElement).colorScheme, ink: getComputedStyle(document.documentElement).getPropertyValue("--sb-ink").trim() }));
      expect(v.bg, url).toBe(BASE);
      expect(v.fg, url).toBe(INK);
      expect(v.ink.toUpperCase(), url).toBe("#14181F");
      expect(v.scheme, url).toMatch(/^light/);
    }
  });

  test("10. 強制の暗（?theme=dark）は見本だけで効く（休眠の値の確認）。見本を離れて `/` を開くと付かない", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await open(page, "theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(14, 17, 22)");
    await page.goto(`${CATALOG}/`);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(BASE);
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
    test(`12. ${name}：挿絵に塗りの色（ティール・水色・グラデーション）が無い。塗りは墨と、白（背後の線を隠すだけ）だけ。橙は無い。高さは変えない`, async ({ page }) => {
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
      for (const f of v.fills) expect([WHITE, INK], `塗り ${f}`).toContain(f);
      expect(v.fills).toContain(INK);
      expect(v.fills).toContain(WHITE);
    });
  }
});
