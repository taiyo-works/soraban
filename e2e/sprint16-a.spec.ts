import { expect, test } from "@playwright/test";
import { expectColorsInTokenSet } from "./color-set";
import { collectTextSamples, expectNoHorizontalScroll } from "./field-checks";

// Sprint 16-A の E2E（DB なし）：トークンを空色の主色・新しい地に替えたことの確かめ（契約 A-7、共通条件 K-3・K-13・K-14）。
// 対象：公開の `/`、見本 `/ops/design`（通常・現場・日差しの模擬ではなく強制の暗＝休眠の値も）。運航管理の画面は e2e/ops-db/sprint16-a-db.spec.ts。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

// 地図の凡例・地点の印は、地図の固定色（regulation-map-colors.ts）を使う（契約：地図と挿絵の中）
const MAP_LEGEND = ['[data-testid="map-pick-hint"]', '[data-testid="layer-list"]', '[data-testid="legend-zones"]'];

const SCREENS = [
  { name: "/（公開の判定画面）", url: `${MAIN}/`, ready: '[data-testid="hero-art"]', field: false },
  { name: "/ops/design（通常）", url: `${CATALOG}/ops/design`, ready: '[data-testid="design-catalog"]', field: false },
  { name: "/ops/design（現場）", url: `${CATALOG}/ops/design?mode=field`, ready: '[data-testid="design-catalog"]', field: true },
] as const;

test.describe("16-A 公開側：K-3・K-13・K-14", () => {
  for (const s of SCREENS) {
    test(`A-7/K-13. ${s.name}：要素の色（文字・背景・縁・輪・下線・塗り・線・影）がトークンの集合に入る（橙・旧い藍が無い）`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(s.url);
      await expect(page.locator(s.ready)).toBeVisible();
      await expectColorsInTokenSet(page, "body", s.name, MAP_LEGEND);
    });

    test(`A-7/K-3. ${s.name}：文字は ${s.field ? "7" : "4.5"}:1 以上（無効の部品を除く）。横スクロールなし`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(s.url);
      await expect(page.locator(s.ready)).toBeVisible();
      const min = s.field ? 7 : 4.5;
      const samples = await collectTextSamples(page, "body");
      expect(samples.length, s.name).toBeGreaterThan(0);
      const bad = samples.filter((t) => !t.disabled && t.ratio < min).map((t) => `${t.testId ?? t.tag}「${t.text}」 ${t.ratio.toFixed(2)}:1`);
      expect(bad, `${s.name}: 比が ${min} 未満`).toEqual([]);
      await expectNoHorizontalScroll(page, s.name);
    });
  }

  test("K-14. OS が暗でも、`/` と見本は明で描かれる（地 #F6F7F9・文字 #14181F）。強制の暗は見本の ?theme=dark だけ", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    for (const url of [`${MAIN}/`, `${CATALOG}/ops/design`]) {
      await page.goto(url);
      await expect(page.locator("body")).toBeVisible();
      const v = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color, theme: document.documentElement.getAttribute("data-theme") }));
      expect(v.bg, url).toBe("rgb(246, 247, 249)");
      expect(v.fg, url).toBe("rgb(20, 24, 31)");
      expect(v.theme, url).toBeNull();
    }
  });

  test("休眠の暗（見本の ?theme=dark）：文字は 4.5:1 以上で、色は暗のトークンの集合に入る", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${CATALOG}/ops/design?theme=dark`);
    await expect(page.getByTestId("design-catalog")).toBeVisible();
    await expectColorsInTokenSet(page, "body", "見本（暗）");
    const samples = await collectTextSamples(page, "body");
    const bad = samples.filter((t) => !t.disabled && t.ratio < 4.5).map((t) => `${t.testId ?? t.tag}「${t.text}」 ${t.ratio.toFixed(2)}:1`);
    expect(bad).toEqual([]);
  });
});
