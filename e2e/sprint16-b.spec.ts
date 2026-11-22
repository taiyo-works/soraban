import { expect, test, type Page } from "@playwright/test";
import { collectTextSamples, expectFontSize, expectNoHorizontalScroll, expectTextZoom } from "./field-checks";

// Sprint 16-B の E2E（DB なし）：文字の下限 14px・本文 16px・rem 化の確かめ（契約 B-1〜B-4、共通条件 K-2・K-4・K-5）。
// 対象：公開の `/`、見本 `/ops/design`（通常・現場）。運航管理の画面は e2e/ops-db/sprint16-b-db.spec.ts。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

const SCREENS = [
  { name: "/（公開の判定画面）", url: `${MAIN}/`, ready: '[data-testid="hero-art"]', field: false },
  { name: "/ops/design（通常）", url: `${CATALOG}/ops/design`, ready: '[data-testid="design-catalog"]', field: false },
  { name: "/ops/design（現場）", url: `${CATALOG}/ops/design?mode=field`, ready: '[data-testid="design-catalog"]', field: true },
] as const;

const open = async (page: Page, s: (typeof SCREENS)[number], width: number, height = 844): Promise<void> => {
  await page.setViewportSize({ width, height });
  await page.goto(s.url);
  await expect(page.locator(s.ready)).toBeVisible();
};

test.describe("16-B 公開側：文字の下限・rem 化・200%・320 幅", () => {
  for (const s of SCREENS) {
    for (const w of [375, 390, 1280]) {
      test(`B-1/K-2. ${s.name} ${w}px：画面の文字はすべて 14px 以上。入力欄の値は 16px 以上（現場は 18px 以上）`, async ({ page }) => {
        await open(page, s, w, w >= 1024 ? 800 : 844);
        await expectFontSize(page, "body", 14, `${s.name} ${w}px`);
        const fields = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea"))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
            })
            .map((el) => ({ id: el.getAttribute("data-testid") ?? el.tagName.toLowerCase(), size: parseFloat(getComputedStyle(el).fontSize) })),
        );
        const min = s.field ? 18 : 16;
        expect(fields.filter((f) => f.size < min).map((f) => `${f.id} ${f.size}px`), `${s.name} ${w}px：${min}px 未満の入力欄`).toEqual([]);
      });
    }

    test(`B-2. ${s.name}：文字の大きさのトークンは rem（本文 ${s.field ? "18" : "16"}px・補足 14px）。html を 200% にすると本文もその分大きくなる`, async ({ page }) => {
      await open(page, s, 390);
      const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const probe = (v: string): number => {
          const el = document.createElement("span");
          el.style.fontSize = `var(${v})`;
          document.body.appendChild(el);
          const px = parseFloat(getComputedStyle(el).fontSize);
          el.remove();
          return px;
        };
        return { body: probe("--sb-fs-body"), note: probe("--sb-fs-note"), rawBody: cs.getPropertyValue("--sb-fs-body").trim(), rawNote: cs.getPropertyValue("--sb-fs-note").trim() };
      });
      expect(tokens.body).toBe(s.field ? 18 : 16);
      expect(tokens.note).toBe(14);
      expect(tokens.rawBody, "--sb-fs-body は rem").toMatch(/rem$/);
      expect(tokens.rawNote, "--sb-fs-note は rem").toMatch(/rem$/);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const zoomed = await page.evaluate(() => {
        const el = document.createElement("span");
        el.style.fontSize = "var(--sb-fs-body)";
        document.body.appendChild(el);
        const px = parseFloat(getComputedStyle(el).fontSize);
        el.remove();
        return px;
      });
      expect(zoomed, "200% で本文の大きさが 2 倍").toBe(tokens.body * 2);
    });

    test(`K-4. ${s.name}：320 幅で横スクロールがない`, async ({ page }) => {
      await open(page, s, 320, 640);
      await expectNoHorizontalScroll(page, `${s.name} 320px`);
    });
  }

  test("B-4/K-5. `/`：文字 200%（390・430 幅）で、横スクロールなし・文字の切れ 0・文字が 2 倍になる・主ボタンに届く", async ({ page }) => {
    await open(page, SCREENS[0], 390);
    await expectTextZoom(page, "/");
  });

  test("K-5 の検査自体が働く：px 固定の文字と、overflow:hidden の固定の高さは検出される", async ({ page }) => {
    await open(page, SCREENS[0], 390);
    await page.evaluate(() => {
      const a = document.createElement("p");
      a.id = "probe-px";
      a.textContent = "px 固定の文字";
      a.style.fontSize = "16px";
      const b = document.createElement("div");
      b.id = "probe-clip";
      b.textContent = "切れる文字 切れる文字 切れる文字 切れる文字 切れる文字 切れる文字 切れる文字 切れる文字";
      b.style.cssText = "height:20px;overflow:hidden;width:200px";
      const main = document.querySelector("main") ?? document.body;
      main.prepend(a, b);
    });
    let failed = "";
    try {
      await expectTextZoom(page, "検出の確認", [390]);
    } catch (e) {
      failed = String((e as Error).message);
    }
    expect(failed, "px 固定か切れのどちらかを検出して失敗する").toMatch(/200% にしても大きくならない文字|文字の切れ/);
  });

  test("B-4. 文字の大きさの標本が十分ある（検査が空でない）", async ({ page }) => {
    await open(page, SCREENS[0], 390);
    expect((await collectTextSamples(page, "body")).length).toBeGreaterThan(20);
  });
});
