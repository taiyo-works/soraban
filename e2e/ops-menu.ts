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
