import { expect, type Page } from "@playwright/test";

// 利用者メニュー（右上。名前・役割・ログアウト）を開く。ハイドレーション前の押下は何も起こさないため、開くまで押し直す。
// すでに開いているときは押さない（開閉の切り替えを二重に押さない）。
export const openUserMenu = async (page: Page): Promise<void> => {
  const menu = page.getByTestId("user-menu");
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByTestId("user-menu-button").click();
    await expect(menu).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
};

// Sprint 16-G：ホームの判定へのピル・今日のカードの詳細・残りの予定・次にやること・直近の飛行は、下段の「すべての予定」に畳まれている。
// それらを読む・押す試験は、先にこれで開く（開いていれば押さない。開くまで押し直す）。
export const openAllPlans = async (page: Page): Promise<void> => {
  const toggle = page.getByTestId("home-all-toggle");
  const box = page.getByTestId("home-all");
  await expect(toggle).toBeVisible();
  await expect(async () => {
    if (!(await box.evaluate((el) => (el as HTMLDetailsElement).open))) await toggle.click();
    await expect.poll(() => box.evaluate((el) => (el as HTMLDetailsElement).open), { timeout: 2000 }).toBe(true);
  }).toPass({ timeout: 20_000 });
};

// ホームの「次にやること」は最初の 3 件だけが見える。残りを読む・押す試験は、先に「ほか N 件を見る」を開く（開いていれば何もしない）。
// 16-G：「次にやること」は「すべての予定」の中なので、先にそれを開く。
export const expandNextActions = async (page: Page): Promise<void> => {
  if ((await page.getByTestId("home-all").count()) > 0) await openAllPlans(page);
  const toggle = page.getByTestId("today-next-more-toggle");
  if ((await toggle.count()) === 0) return;
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
};
