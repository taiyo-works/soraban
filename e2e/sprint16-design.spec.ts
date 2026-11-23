import { expect, test, type Page } from "@playwright/test";
import { FORBIDDEN_ALL_WORDS, LIMITED_WORDS } from "../apps/web/src/lib/wording-policy";
import { expectColorsInTokenSet } from "./color-set";
import { collectTapTargets, collectTextSamples, expectNoHorizontalScroll, expectTextZoom, waitForSettledStyles } from "./field-checks";

// Sprint 16-E の E2E（DB なし）：旧 `sprint16-1.spec.ts` の検査（1〜12）を移し（15 件→同数）、新しい見本の節・並べ見本・下部ナビ・準備カードの検査（N-1〜）を足した。対応表は docs/evaluations/sprint-16-test-changes.md の 16-E 節。
// 旧：Sprint 16-1 の E2E。トークン、作り直した見本（/ops/design）、`/` の挿絵、常に明るい表示、主ボタン。Sprint 16-A で、橙・白基調の期待値を主色（空色）・地 #F6F7F9 の値に置き換えた（同じ意図。docs/evaluations/sprint-16-test-changes.md）。
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
    for (const id of ["cat-grounds", "cat-type", "cat-primary-use", "cat-status", "cat-buttons", "cat-cards", "cat-state-labels", "cat-forms", "cat-verdict", "cat-logo", "cat-order", "cat-bottomnav-sec", "cat-prep", "cat-band-section", "cat-art-section"]) {
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
        shadows: [...document.querySelectorAll<HTMLElement>('[data-testid="design-catalog"] *')].filter((e) => !e.hasAttribute("data-float")).map((e) => getComputedStyle(e).boxShadow).filter((s) => s !== "none" && !s.includes("inset")),
        // 浮くもの（16-E で足した下部ナビの見本だけ）の影は、トークン --sb-shadow-float の値と同じ
        floats: [...document.querySelectorAll<HTMLElement>("[data-float]")].map((e) => [e.getAttribute("data-testid"), getComputedStyle(e).boxShadow] as const),
        floatToken: (() => { const p = document.createElement("div"); p.style.boxShadow = "var(--sb-shadow-float)"; document.body.appendChild(p); const v = getComputedStyle(p).boxShadow; p.remove(); return v; })(),
      }));
      expect(v.body).toBe(BASE);
      expect(v.html).toBe(BASE);
      expect(v.grounds).toEqual([BASE, WHITE, SUNKEN]);
      expect(v.shadows, "影").toEqual([]);
      expect(v.floats.map(([id]) => id), "浮くものの例外は下部ナビの見本だけ").toEqual(["cat-bottomnav"]);
      for (const [id, sh] of v.floats) expect(sh, id ?? "").toBe(v.floatToken);
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

// ───────────────────────── 16-E で足した検査（N-1〜） ─────────────────────────
const openAt = async (page: Page, width: number, query = ""): Promise<void> => {
  await page.setViewportSize({ width, height: 900 });
  await open(page, query);
  await waitForSettledStyles(page);
};

test.describe("N. 16-E の新しい節", () => {
  test("N-1. 契約の節がそろい、契約の順に並ぶ（E-1）。節ごとに見出し h2 がある", async ({ page }) => {
    await open(page);
    const order = ["cat-grounds", "cat-type", "cat-primary-use", "cat-status", "cat-buttons", "cat-cards", "cat-state-labels", "cat-inputs-section", "cat-checks-section", "cat-sheet-section", "cat-skeleton-section", "cat-states-section", "cat-verdict", "cat-logo", "cat-order", "cat-bottomnav-sec", "cat-prep"];
    const idx = await page.evaluate((ids) => {
      const all = [...document.querySelectorAll("section[data-testid]")].map((e) => e.getAttribute("data-testid"));
      return ids.map((id) => all.indexOf(id));
    }, order);
    expect(idx.every((i) => i >= 0), `節が無い: ${order.filter((_, i) => idx[i]! < 0)}`).toBe(true);
    // 契約の並び（判定の 5 段は、状態 5 種の後ろならどこでもよい）
    const fixed = order.filter((id) => id !== "cat-verdict");
    const pos = fixed.map((id) => idx[order.indexOf(id)]!);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    for (const id of order) await expect(page.getByTestId(id).locator("h2").first(), id).toBeVisible();
  });

  test("N-2. 状態 5 種＋未確認：記号（SVG）と空でない文字を持ち、面の色が互いに違う（色だけに頼らない）", async ({ page }) => {
    await open(page);
    const v = await page.evaluate(() =>
      ["safe", "warn", "danger", "info", "flying", "unknown"].map((k) => {
        const el = document.querySelector(`[data-testid="cat-status-${k}"]`)!;
        return { k, svg: el.querySelectorAll("svg[aria-hidden='true']").length, word: (el.querySelector(".sbx-status-word")?.textContent ?? "").trim(), bg: getComputedStyle(el).backgroundColor, dashed: getComputedStyle(el).borderTopStyle };
      }),
    );
    for (const s of v) { expect(s.svg, s.k).toBeGreaterThanOrEqual(1); expect(s.word.length, s.k).toBeGreaterThan(0); }
    expect(v.find((s) => s.k === "unknown")?.dashed).toBe("dashed");
    expect(v.find((s) => s.k === "unknown")?.word).toBe("未確認");
    expect(new Set(v.filter((s) => s.k !== "unknown").map((s) => s.bg)).size).toBe(5);
  });

  test("N-3. 文字の段：題 24px・節 18px・カード 16px/600・本文 16px・補足 14px・数値 28px（桁をそろえる）。通常は rem で拡大する", async ({ page }) => {
    await open(page);
    const read = (id: string) => page.getByTestId(id).evaluate((el) => { const c = getComputedStyle(el); return { fs: parseFloat(c.fontSize), fw: c.fontWeight, lh: parseFloat(c.lineHeight) / parseFloat(c.fontSize), tn: c.fontVariantNumeric }; });
    expect(await read("cat-type-title")).toMatchObject({ fs: 24, fw: "700" });
    expect(await read("cat-type-section")).toMatchObject({ fs: 18, fw: "700" });
    expect(await read("cat-type-card")).toMatchObject({ fs: 16, fw: "600" });
    const body = await read("cat-type-body");
    expect(body.fs).toBe(16);
    expect(body.lh).toBeGreaterThanOrEqual(1.69);
    expect(await read("cat-type-note")).toMatchObject({ fs: 14, fw: "500" });
    const num = await read("cat-type-number");
    expect(num.fs).toBe(28);
    expect(num.tn).toContain("tabular-nums");
  });

  test("N-4. 主色の節：面・押下・薄い面・輪の 4 つ。面は主色、薄い面は --sb-primary-soft、輪は 3px", async ({ page }) => {
    await open(page);
    const v = await page.evaluate(() => {
      const bg = (id: string) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!).backgroundColor;
      const ring = getComputedStyle(document.querySelector('[data-testid="cat-prim-focus"]')!);
      return { face: bg("cat-prim-face"), press: bg("cat-prim-press"), soft: bg("cat-prim-soft"), ow: ring.outlineWidth, oc: ring.outlineColor };
    });
    expect(v.face).toBe(PRIMARY);
    expect(v.press).toBe("rgb(28, 86, 207)");
    expect(v.soft).toBe("rgb(232, 240, 253)");
    expect(v.ow).toBe("3px");
    expect(v.oc).toBe(PRIMARY);
  });

  test("N-5. 並べ見本：ロゴ・点の形・矢印は「現行」と「案」が 1 つずつ。ロゴの丸は主色の面（現行）と墨の面（案）", async ({ page }) => {
    await open(page);
    for (const [group, current, cand] of [["cat-logo", "cat-logo-primary", "cat-logo-ink"], ["cat-state-labels", "cat-dot-same", "cat-dot-shapes"], ["cat-cards", "cat-arrow-none", "cat-arrow-with"]] as const) {
      await expect(page.getByTestId(group).getByTestId(`${current}-tag`), current).toHaveText("現行");
      await expect(page.getByTestId(group).getByTestId(`${cand}-tag`), cand).toHaveText("案");
    }
    const bg = (id: string) => page.getByTestId(id).locator(".sb-brand-mark").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg("cat-logo-primary")).toBe(PRIMARY);
    expect(await bg("cat-logo-ink")).toBe(INK);
    // 実画面の `.sb-brand-mark` は変えていない（`/` の丸は主色のまま）
    await page.goto(`${MAIN}/`);
    expect(await page.locator(".sb-brand-mark").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(PRIMARY);
  });

  test("N-6. 点の形：現行は 4 状態とも同じ丸（8px）、案は状態ごとに形が違う（SVG の中身が全部違う）。どちらも文字を持つ", async ({ page }) => {
    await open(page);
    const v = await page.evaluate(() => {
      const same = ["info", "flying", "safe", "danger"].map((t) => { const l = document.querySelector(`[data-testid="cat-dot-same-${t}"]`)!; const d = l.querySelector(".sb-state-dot") as HTMLElement; return { w: d.getBoundingClientRect().width, br: getComputedStyle(d).borderTopLeftRadius, text: (l.textContent ?? "").trim() }; });
      const shapes = ["info", "flying", "safe", "warn", "danger"].map((t) => { const l = document.querySelector(`[data-testid="cat-dot-shapes-${t}"]`)!; return { d: l.querySelector("svg")!.innerHTML, text: (l.textContent ?? "").trim() }; });
      return { same, shapes };
    });
    for (const s of v.same) { expect(s.w).toBe(8); expect(s.text.length).toBeGreaterThan(0); }
    expect(new Set(v.shapes.map((s) => s.d)).size).toBe(5);
    for (const s of v.shapes) expect(s.text.length).toBeGreaterThan(0);
  });

  test("N-7. 一覧のカードの矢印：なし（現行）とあり（案）はどちらも全体が押せて高さ 72 以上。ありは矢印が装飾（aria-hidden）", async ({ page }) => {
    await open(page);
    for (const id of ["cat-arrow-none-card", "cat-arrow-with-card"]) {
      const h = await page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().height);
      expect(h, id).toBeGreaterThanOrEqual(71.5);
    }
    expect(await page.getByTestId("cat-arrow-none-card").locator("svg").count()).toBe(0);
    const arrow = page.getByTestId("cat-arrow-with-card").locator("svg");
    await expect(arrow).toHaveCount(1);
    await expect(arrow).toHaveAttribute("aria-hidden", "true");
  });

  test("N-8. 計画作成の段の順：この計画の順は 6 段（場所→日時→飛行の方法と目的→操縦者・機体・許可→内容の確認→判定と通報の準備）。方針書の順と並べ、進捗の帯は progressbar", async ({ page }) => {
    await open(page);
    const names = (id: string) => page.getByTestId(id).locator("li strong").allTextContents();
    expect(await names("cat-order-adopted-list")).toEqual(["場所", "日時", "飛行の方法と目的", "操縦者・機体・許可", "内容の確認（保存）", "判定と通報の準備"]);
    expect((await names("cat-order-direction-list")).length).toBe(6);
    const pb = page.getByTestId("cat-progress");
    await expect(pb).toHaveAttribute("role", "progressbar");
    await expect(pb).toHaveAttribute("aria-valuenow", "2");
    await expect(pb).toHaveAttribute("aria-valuetext", "2/6 日時");
    expect(await pb.evaluate((el) => el.getBoundingClientRect().height)).toBe(4);
  });

  test("N-9. チェック（32px の丸）とラジオ（24px の輪）：寸法・選択の動作・選択の印（点）・異常の色", async ({ page }) => {
    await open(page);
    const size = (id: string) => page.getByTestId(id).evaluate((el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
    expect(await size("cat-check-off")).toEqual([32, 32]);
    expect(await size("cat-radio-off")).toEqual([24, 24]);
    const radioBorder = (id: string) => page.getByTestId(id).evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(await radioBorder("cat-radio-on")).toBe(PRIMARY);
    await page.getByTestId("cat-radio-no").click();
    await expect(page.getByTestId("cat-radio-no")).toBeChecked();
    await expect(page.getByTestId("cat-radio-on")).not.toBeChecked();
    expect(await radioBorder("cat-radio-no")).toBe("rgb(180, 35, 24)");
    // 行全体が押せる（文字を押しても選べる）
    await page.getByText("未選択", { exact: true }).click();
    await expect(page.getByTestId("cat-radio-off")).toBeChecked();
    await expect(page.getByTestId("cat-radio-disabled")).toBeDisabled();
    // 行は 48px 以上（現場 64）
    for (const id of ["cat-radio-off", "cat-check-off"]) expect(await page.getByTestId(id).evaluate((el) => el.closest("label")!.getBoundingClientRect().height), id).toBeGreaterThanOrEqual(47.5);
    // チェックのグループにはラベル（legend）、ラジオにも同じ
    await expect(page.getByTestId("cat-radio-set").locator("legend")).toContainText("ラジオ");
    await expect(page.getByTestId("cat-check-set").locator("legend")).toContainText("チェック");
  });

  test("N-10. 入力欄：通常・フォーカス・エラー・無効の 4 状態がそろう（無効は押せない・フォーカスの輪は 3px）", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("cat-f-disabled")).toBeDisabled();
    expect(await page.getByTestId("cat-f-focus").evaluate((el) => [getComputedStyle(el).outlineWidth, getComputedStyle(el).outlineColor])).toEqual(["3px", PRIMARY]);
    await expect(page.getByTestId("cat-f-error")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("cat-input")).toBeEnabled();
    for (const id of ["cat-input", "cat-f-focus", "cat-f-error", "cat-f-disabled"]) await expect(page.locator(`label[for="${id}"]`), id).toBeVisible();
  });

  test("N-11. 下部ナビの見本：4 項目（ホーム・計画・日誌・機体と書類）。高さ 64 以上・文字 14 以上・現在地は 1 つだけ（aria-current・主色・薄い主色の面）。折り返さない", async ({ page }) => {
    await openAt(page, 390);
    const nav = page.getByTestId("cat-bottomnav");
    expect(await nav.locator("a").allTextContents()).toEqual(["ホーム", "計画", "日誌", "機体と書類"]);
    const v = await nav.locator("a").evaluateAll((els) => els.map((a) => { const c = getComputedStyle(a); const lab = a.querySelector("span")!; return { h: a.getBoundingClientRect().height, fs: parseFloat(c.fontSize), cur: a.getAttribute("aria-current"), bg: c.backgroundColor, color: c.color, icon: a.querySelectorAll("svg[aria-hidden='true']").length, lines: Math.round(lab.getBoundingClientRect().height / parseFloat(getComputedStyle(lab).lineHeight)) }; }));
    for (const a of v) { expect(a.h).toBeGreaterThanOrEqual(63.5); expect(a.fs).toBeGreaterThanOrEqual(14); expect(a.icon).toBe(1); expect(a.lines).toBe(1); }
    expect(v.filter((a) => a.cur === "page").length).toBe(1);
    const cur = v.find((a) => a.cur === "page")!;
    expect(cur.bg).toBe("rgb(232, 240, 253)");
    expect(cur.color).toBe(PRIMARY);
    expect(v.filter((a) => a.cur !== "page").every((a) => a.bg === "rgba(0, 0, 0, 0)")).toBe(true);
  });

  test("N-12. 下部ナビの見本（現場）：影なし・高さ 64 以上。`ops-bottom-nav`（実画面の識別子）は見本に出さない", async ({ page }) => {
    await openAt(page, 390, "mode=field");
    const s = await page.getByTestId("cat-bottomnav").evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, h: el.getBoundingClientRect().height }));
    expect(s.shadow).toBe("none");
    expect(s.h).toBeGreaterThanOrEqual(64);
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
  });

  test("N-13. 準備カード（§8）：行の状態 3＋3、カード 5 種（帯＝重い状態）、判定の総合の語 8 状態。読み上げの文は aria-label に 1 文", async ({ page }) => {
    await open(page);
    expect(await page.getByTestId("cat-prep-rows-report").locator(".sbx-prep-chip").allTextContents()).toEqual(["受付番号を記録済み", "DIPS に出す内容を確認する", "取り消し済み"]);
    expect(await page.getByTestId("cat-prep-rows-inspection").locator(".sbx-prep-chip").allTextContents()).toEqual(["記録済み", "未記録", "異常あり"]);
    const cards = await page.evaluate(() => ["danger", "warn", "unknown", "info", "safe"].map((k) => { const el = document.querySelector(`[data-testid="cat-prep-card-${k}"]`)!; return { k, tone: el.getAttribute("data-tone"), label: el.getAttribute("aria-label"), rows: el.querySelectorAll(".sbx-prep-row").length, h3: el.querySelector("h3")?.textContent, note: el.textContent?.includes("判定は参考情報です"), bg: getComputedStyle(el).backgroundColor }; }));
    for (const c of cards) { expect(c.tone).toBe(c.k); expect(c.rows).toBe(3); expect(c.h3).toBe("次の飛行の準備"); expect(c.note).toBe(true); expect(c.label).toMatch(/^次の飛行の準備。通報、.+。飛行前点検、.+。判定、.+。$/); }
    expect(new Set(cards.map((c) => c.bg)).size).toBe(5); // 5 種の帯の面がすべて違う（未確認は白の面）
    expect(cards.find((c) => c.k === "warn")!.label).toBe("次の飛行の準備。通報、受付番号を記録済み。飛行前点検、未記録。判定、未確認の項目が 2 件あります。");
    const texts = await page.getByTestId("cat-prep-verdicts").locator("li strong").allTextContents();
    expect(texts).toEqual([
      "飛行不可の項目があります（2 件）",
      "手続きが要る項目があります（1 件）",
      "未確認の項目があります（3 件）",
      "調べた項目は手続き済みです。条件を確認してください",
      "調べた項目では、手続きが要るものは見つかりませんでした",
      "未確認（判定の記録がありません）",
      "未確認（読み込めませんでした）",
      "古い判定：手続きが要る項目があります（1 件）",
    ]);
    // 各状態に記号と文字。再判定・再読み込みは副ボタン（主ボタンでない）
    const per = await page.getByTestId("cat-prep-verdicts").locator("li").evaluateAll((els) => els.map((e) => ({ svg: e.querySelectorAll("svg[aria-hidden='true']").length, text: (e.textContent ?? "").trim().length })));
    for (const p of per) { expect(p.svg).toBeGreaterThanOrEqual(1); expect(p.text).toBeGreaterThan(0); }
    await expect(page.getByTestId("cat-prep-rejudge")).toHaveText("再判定");
    await expect(page.getByTestId("cat-prep-reload")).toHaveText("再読み込み");
    expect(await page.getByTestId("cat-prep").locator('[data-variant="primary"]').count()).toBe(0);
    // 未確認の項目があるのに「手続き済み」「手続き不要」の語を総合にしない：未確認の 3 行は、その語を含まない
    for (const i of [2, 5, 6]) expect(texts[i]).not.toMatch(/手続き済み|手続きが要るものは見つかりません/);
  });

  test("N-14. K-8 主ボタンは 1 つの組に 1 つ。見えている主ボタンは 3 組の各 1 つだけ（準備カード・並べ見本・下部ナビに無い）", async ({ page }) => {
    await open(page);
    const v = await page.evaluate(() => {
      const prim = [...document.querySelectorAll<HTMLElement>('[data-variant="primary"]')].filter((e) => e.getClientRects().length > 0);
      const groups = [...document.querySelectorAll<HTMLElement>("[data-specimen-group]")].map((g) => ({ g: g.dataset["specimenGroup"], n: [...g.querySelectorAll('[data-variant="primary"]')].length }));
      return { total: prim.length, strays: prim.filter((e) => !e.closest("[data-specimen-group]")).length, groups };
    });
    expect(v.strays).toBe(0);
    expect(v.groups).toEqual([{ g: "pill", n: 1 }, { g: "opx", n: 1 }, { g: "empty", n: 1 }]);
    expect(v.total).toBe(3);
  });

  test("N-15. 禁止語：見本の文に、全面禁止語・限定語（申請・保証・必ず）・「問題なし」「飛行可」が無い", async ({ page }) => {
    await open(page);
    const text = await page.getByTestId("design-catalog").innerText();
    const hits = [...FORBIDDEN_ALL_WORDS, ...LIMITED_WORDS, "飛行可", "OK", "安全です", "問題"].filter((w) => text.includes(w));
    expect(hits).toEqual([]);
  });

  test("N-16. 押す部品は 48px 以上・隣と 8px 以上（K-1。390px）。ナビの見本・カード・ラベルのリンクを含む", async ({ page }) => {
    await openAt(page, 390);
    const t = await collectTapTargets(page, '[data-testid="design-catalog"]');
    expect(t.length).toBeGreaterThan(20);
    // 押せる状態ラベル（cat-state-link）は見た目の高さ 28 のまま、疑似要素で当たり判定を 48px に広げる（16-C。sprint16-c が elementFromPoint で確かめる）
    const short = t.filter((x) => x.testId !== "cat-state-link").filter((x) => x.height < 47.5 || x.width < 47.5).map((x) => `${x.testId ?? x.text} ${x.width.toFixed(0)}×${x.height.toFixed(0)}`);
    expect(short).toEqual([]);
    const tight: string[] = [];
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
      const a = t[i]!, b = t[j]!;
      const dx = Math.max(0, b.left - (a.left + a.width), a.left - (b.left + b.width));
      const dy = Math.max(0, b.top - (a.top + a.height), a.top - (b.top + b.height));
      const nested = (p: typeof a, q: typeof a) => p.left <= q.left + 0.5 && p.top <= q.top + 0.5 && p.left + p.width >= q.left + q.width - 0.5 && p.top + p.height >= q.top + q.height - 0.5;
      if (nested(a, b) || nested(b, a)) continue;
      if (Math.hypot(dx, dy) < 7.5) tight.push(`${a.testId ?? a.text} と ${b.testId ?? b.text}（${Math.hypot(dx, dy).toFixed(1)}px）`);
    }
    expect(tight).toEqual([]);
  });

  for (const field of [false, true]) {
    test(`N-17. K-3・K-13（${field ? "現場" : "通常"}）：新しい節の文字は ${field ? 7 : 4.5}:1 以上（無効を除く）、色はトークンの集合に入る`, async ({ page }) => {
      await openAt(page, 390, field ? "mode=field" : "");
      const sel = '[data-testid="cat-type"], [data-testid="cat-status"], [data-testid="cat-logo"], [data-testid="cat-order"], [data-testid="cat-bottomnav-sec"], [data-testid="cat-prep"]';
      for (const id of ["cat-type", "cat-status", "cat-logo", "cat-order", "cat-bottomnav-sec", "cat-prep", "cat-state-labels", "cat-checks-section"]) {
        const samples = await collectTextSamples(page, `[data-testid="${id}"]`);
        const bad = samples.filter((s) => !s.disabled && s.ratio < (field ? 7 : 4.5)).map((s) => `${s.testId ?? s.tag}「${s.text}」 ${s.ratio.toFixed(2)}`);
        expect(bad, id).toEqual([]);
        await expectColorsInTokenSet(page, `[data-testid="${id}"]`, id);
      }
      expect(sel.length).toBeGreaterThan(0);
    });
  }

  test("N-18. K-4：幅 320・360・375・390・430・768・1024・1280・1440 で横スクロールなし", async ({ page }) => {
    for (const w of [320, 360, 375, 390, 430, 768, 1024, 1280, 1440]) {
      await openAt(page, w);
      await expectNoHorizontalScroll(page, `見本 ${w}`);
    }
  });

  test("N-19. K-5：文字 200%（390・430）で、新しい節も横スクロール・文字の切れ・入れ物の切れがない（通常・現場）", async ({ page }) => {
    await open(page);
    await expectTextZoom(page, "見本（16-E の全節）");
    await open(page, "mode=field");
    await expectTextZoom(page, "見本・現場（16-E の全節）", [390]);
  });

  test("N-20. K-15：見本の新しい操作（ラジオ・チェック）の前後で、端末のストレージの鍵が増えない", async ({ page }) => {
    await open(page);
    const keys = () => page.evaluate(async () => JSON.stringify({ l: Object.keys(localStorage), s: Object.keys(sessionStorage), d: ((await indexedDB.databases?.()) ?? []).map((d) => d.name), c: await caches.keys() }));
    const before = await keys();
    await page.getByTestId("cat-radio-no").click();
    await page.getByTestId("cat-check-off").click();
    expect(await keys()).toBe(before);
  });

  test("N-21. K-6：見本の新しい部品に無限の動きがなく、現場では遷移 0。ナビ・ラベル・カードに animation がない", async ({ page }) => {
    await open(page, "mode=field");
    const v = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="cat-bottomnav"] *, [data-testid="cat-prep"] *, [data-testid="cat-logo"] *, [data-testid="cat-status"] *')].filter((e) => { const c = getComputedStyle(e); return c.animationIterationCount.split(", ").includes("infinite") || c.transitionDuration.split(", ").some((d) => parseFloat(d) > 0); }).length);
    expect(v).toBe(0);
  });
});
