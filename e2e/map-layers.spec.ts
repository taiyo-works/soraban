import { expect, test, type Page } from "@playwright/test";

// 地図の規制レイヤー（DID など）が、地図のタイル読み込み中でも取りこぼされないことを確かめる。
//   - isStyleLoaded() は背景タイルの読み込み中に false になる。その間の「チェックの切替」「DID の都道府県の切替」が
//     地図に反映されない不具合（load は一度しか発火しないため再試行されない）の回帰試験。
// 国土地理院のタイルは、外部に依存しないよう小さな画像を遅延つきで返す（遅延で読み込み中の時間を確実に作る）。

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const stubTiles = async (page: Page, delayMs: number): Promise<void> => {
  await page.route("**/cyberjapandata.gsi.go.jp/**", async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
};

const map = (page: Page) => page.getByTestId("regulation-map");

test.describe("地図の規制レイヤー", () => {
  test("タイルの読み込み中にチェックを切り替えても、地図に反映される", async ({ page }) => {
    await stubTiles(page, 1500);
    await page.goto("/");
    // 初回の DID が地図に入った＝地図の load 後。
    await expect(map(page)).toHaveAttribute("data-did-pref", "31", { timeout: 60_000 });
    await map(page).scrollIntoViewIfNeeded();
    const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
    // 地図をドラッグして新しいタイルの読み込みを始める（遅延があるので、しばらく読み込み中になる）。
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 300, box.y + box.height / 2 - 120, { steps: 8 });
    await page.mouse.up();

    const did = page.getByLabel(/DID（航空法/);
    await did.uncheck();
    await expect(map(page)).toHaveAttribute("data-hidden-layers", "did", { timeout: 15_000 });
    await did.check();
    await expect(map(page)).toHaveAttribute("data-hidden-layers", "", { timeout: 15_000 });
  });

  test("判定で島根県に移ったら、DID も島根県のものに切り替わる", async ({ page }) => {
    await stubTiles(page, 300);
    await page.goto("/");
    await expect(map(page)).toHaveAttribute("data-did-pref", "31", { timeout: 60_000 });
    await page.getByRole("button", { name: /松江城/ }).first().click();
    await expect(map(page)).toHaveAttribute("data-did-pref", "32", { timeout: 30_000 });
  });
});

test.describe("飛行禁止法 対象施設レイヤーの塗り分け", () => {
  test("凡例に『敷地・区域』『周辺地域』『要確認帯』の文字ラベルが 3 つあり、未収録の施設が書かれている", async ({ page }) => {
    await stubTiles(page, 100);
    await page.goto("/");
    const group = page.locator("label", { hasText: "小型無人機等飛行禁止法 対象施設" });
    await expect(group).toBeVisible();
    const zones = group.getByTestId("legend-zones").locator("li");
    await expect(zones).toHaveCount(3);
    await expect(zones.nth(0)).toContainText("敷地・区域");
    await expect(zones.nth(0)).toContainText("レッドゾーン");
    await expect(zones.nth(1)).toContainText("周辺地域");
    await expect(zones.nth(1)).toContainText("イエローゾーン");
    await expect(zones.nth(1)).toContainText("原則飛行禁止");
    await expect(zones.nth(2)).toContainText("要確認帯");
    await expect(zones.nth(2)).toContainText("法定の範囲ではありません");
    await expect(group).toContainText("指定を確認できた施設のうち地図に収録できたのは6件");
    await expect(group).toContainText("情報本部 美保通信所は位置を確認できず未収録");
  });

  test("地図には要確認帯（灰の点線）のレイヤーが赤・黄と別に載り、チェックで一括して切り替わる", async ({ page }) => {
    await stubTiles(page, 100);
    await page.goto("/");
    await expect(map(page)).toHaveAttribute("data-did-pref", "31", { timeout: 60_000 });
    const layers = (await map(page).getAttribute("data-base-layers"))!.split(",");
    expect(layers).toEqual(
      expect.arrayContaining([
        "base-check-outline",
        "base-yellow-fill",
        "base-yellow-outline",
        "base-red-fill",
        "base-red-outline-approx",
      ]),
    );
    expect(new Set(layers).size).toBe(layers.length);

    const base = page.locator("label", { hasText: "小型無人機等飛行禁止法 対象施設" }).getByRole("checkbox");
    await base.uncheck();
    await expect(map(page)).toHaveAttribute("data-hidden-layers", "base", { timeout: 15_000 });
    await base.check();
    await expect(map(page)).toHaveAttribute("data-hidden-layers", "", { timeout: 15_000 });
  });
});
