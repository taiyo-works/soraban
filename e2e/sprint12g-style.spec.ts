import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "./field-checks";

// スタイル案の見本（/ops/design?view=style）の E2E。静的なページ（認証・DB・外部通信なし）。
// DESIGN_CATALOG=1 のサーバー（2 台目）だけで表示する。1 台目（フラグなし）は 404。既存の見本・実画面は変わらない。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;
const STYLE = `${CATALOG}/ops/design?view=style`;

const accentOf = (page: Page): Promise<string> => page.getByTestId("style-trial").evaluate((el) => getComputedStyle(el).getPropertyValue("--s-accent").trim().toLowerCase());

test.describe("スタイル案の見本", () => {
  test("1. 無効のサーバーでは 404。有効のサーバーでは表示され、外部通信・API 呼び出しがない", async ({ page }) => {
    expect((await page.goto(`${MAIN}/ops/design?view=style`))?.status()).toBe(404);
    const origins = new Set<string>();
    const api: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      origins.add(u.origin);
      if (u.pathname.startsWith("/api/")) api.push(u.pathname);
    });
    const res = await page.goto(STYLE);
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.getByTestId("style-trial")).toBeVisible();
    await expect(page.getByTestId("style-notice")).toContainText("すべて見本データ");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByTestId("ops-header")).toHaveCount(0);
    expect(api).toEqual([]);
    expect([...origins]).toEqual([new URL(CATALOG).origin]);
  });

  test("2. パレット 1〜6 の切り替え：アクセントの色が変わる。不明な値は 1 に戻る", async ({ page }) => {
    const seen = new Set<string>();
    for (const p of [1, 2, 3, 4, 5, 6]) {
      await page.goto(`${STYLE}&palette=${p}`);
      await expect(page.getByTestId("style-trial")).toHaveAttribute("data-set", `${p}-light`);
      seen.add(await accentOf(page));
    }
    expect(seen.size).toBe(6);
    await page.goto(`${STYLE}&palette=9`);
    expect(await accentOf(page)).toBe("#1c4276");
  });

  test("3. 角は直角（丸いのはラジオ・件数だけ）。ぼかし・グラデーションがない", async ({ page }) => {
    await page.goto(STYLE);
    const all = await page.locator(".sty *").evaluateAll((els) =>
      els.map((e) => ({ cls: e.getAttribute("class") ?? "", r: getComputedStyle(e).borderTopLeftRadius, bf: getComputedStyle(e).backdropFilter, bi: getComputedStyle(e).backgroundImage })),
    );
    const rounded = all.filter((x) => x.r !== "0px");
    expect(rounded.filter((x) => !/sty-count/.test(x.cls) && x.cls !== "").map((x) => x.cls)).toEqual([]);
    expect(all.every((x) => x.bf === "none" && !x.bi.includes("gradient"))).toBe(true);
    expect(await page.locator("input[type=radio]").first().evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe("50%");
  });

  test("4. 明・暗・現場：セットが切り替わり、現場は凹凸を消して文字が大きくなる", async ({ page }) => {
    const note = (): Promise<string> => page.locator(".sty-note").first().evaluate((e) => getComputedStyle(e).fontSize);
    const root = page.getByTestId("style-trial");
    await page.goto(STYLE);
    await expect(root).toHaveAttribute("data-set", "1-light");
    expect(await note()).toBe("12px");
    await page.goto(`${STYLE}&theme=dark`);
    await expect(root).toHaveAttribute("data-set", "1-dark");
    await page.goto(`${STYLE}&field=1`);
    await expect(root).toHaveAttribute("data-set", "1-light-field");
    expect(await note()).toBe("14px");
    expect(await page.locator(".sty-card").first().evaluate((e) => getComputedStyle(e).boxShadow)).toBe("none");
  });

  test("5. 6 つ並べる：6 つの縮小表示が出て、横にあふれない。画面の切り替えもできる", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${STYLE}&layout=all`);
    await expect(page.locator(".sty-compare-cell")).toHaveCount(6);
    await expectNoHorizontalScroll(page, "6 つ並べる");
    await page.locator(".sty-screen-pick").getByRole("link", { name: "ホーム", exact: true }).click();
    await expect(page).toHaveURL(/screen=home/);
    await expect(page.locator(".sty-home")).toHaveCount(6);
  });

  for (const w of [375, 768, 1280]) {
    test(`6. ${w}px：横にあふれず、押せる部品は 44px 以上（現場は 56px 以上）`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      for (const q of ["", "&field=1&palette=6", "&theme=dark&palette=3"]) {
        await page.goto(STYLE + q);
        await expectNoHorizontalScroll(page, `${w}px ${q}`);
        const min = q.includes("field") ? 56 : 44;
        const small = await page.locator(".sty-page a, .sty-page button").evaluateAll(
          (els, m) =>
            els
              .filter((e) => {
                const b = e.getBoundingClientRect();
                return b.width > 0 && !e.closest(".sty-skip") && !e.classList.contains("sty-switch") && (b.height < m - 0.5 || b.width < m - 0.5);
              })
              .map((e) => `${e.getAttribute("class")}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
          min,
        );
        expect(small, q).toEqual([]);
      }
    });
  }

  test("7. 既定の見本（/ops/design）は変わらない：部品の節があり、スタイルの見本ではない", async ({ page }) => {
    await page.goto(`${CATALOG}/ops/design`);
    await expect(page.getByTestId("design-catalog")).toHaveAttribute("data-hydrated", "1");
    await expect(page.getByTestId("style-trial")).toHaveCount(0);
    await expect(page.locator("section#tokens")).toBeVisible();
    await page.goto(`${CATALOG}/ops/design?view=menu`);
    await expect(page.getByTestId("menu-trial")).toBeVisible();
  });

  test("8. 実画面（/）は、スタイルの見本の影響を受けない（.sty がなく、紙・インクのまま）", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${MAIN}/`);
    await expect(page.locator(".sty")).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(245, 242, 234)");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--s-app"))).toBe("");
  });

  test("9. キーボードで移動でき、フォーカスの輪が見える", async ({ page }) => {
    await page.goto(STYLE);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
    expect(await focused.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("solid");
  });
});
