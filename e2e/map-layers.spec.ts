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
