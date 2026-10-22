import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectContrast, expectNoHorizontalScroll, expectTapTargets } from "./field-checks";

// Sprint 12g 段階 1a の E2E：デザイン見本（/ops/design）と、既存の画面が変わらないこと。
// - 見本は DESIGN_CATALOG=1 のサーバー（フィクスチャ用の 2 台目。playwright.config.ts が環境変数を与える）でだけ表示する。
//   既定のサーバー（DESIGN_CATALOG なし）は 404。認証・DB・外部通信を使わない静的なページ。
// - 待つ対象のレスポンスは無い（静的）。waitForResponse は使わない（C10）。固定の待ち時間も使わない。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

const open = async (page: Page, query = ""): Promise<void> => {
  await page.goto(`${CATALOG}/ops/design${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("design-catalog")).toBeVisible();
  // wait for the client to take over (hydration) before interacting
  await expect(page.getByTestId("design-catalog")).toHaveAttribute("data-hydrated", "1");
};
const root = (page: Page): Locator => page.getByTestId("design-catalog");
const accentOf = (page: Page): Promise<string> =>
  root(page).evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim().toLowerCase());
const screenTab = (page: Page, name: string): Locator => page.getByTestId("ctl-screen").getByRole("tab", { name });

test.describe("A. 表示と 404（契約 1a-6・1a-7）", () => {
  test("1. 無効（DESIGN_CATALOG が 1 でない）のサーバーでは 404。画面の中身を返さない", async ({ page }) => {
    const res = await page.goto(`${MAIN}/ops/design`);
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("design-catalog")).toHaveCount(0);
    expect(await page.content()).not.toContain("デザイン見本");
    // sub-paths follow the normal ops gate (404 while ops is off)
    expect((await page.goto(`${MAIN}/ops/design/x`))?.status()).toBe(404);
  });

  test("2. 有効のとき表示される。noindex。外部通信・API 呼び出しがない。運航管理の枠・ヘッダーが付かない", async ({ page }) => {
    const origins = new Set<string>();
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      origins.add(u.origin);
      if (u.pathname.startsWith("/api/")) apiCalls.push(u.pathname);
    });
    const res = await page.goto(`${CATALOG}/ops/design`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.locator("meta[name=robots]").first()).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { level: 1, name: "デザイン見本" })).toBeVisible();
    await expect(page.getByTestId("catalog-notice")).toContainText("すべて見本データ");
    await expect(page.getByTestId("ops-header")).toHaveCount(0);
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(page.locator(".max-w-4xl")).toHaveCount(0);
    expect(apiCalls).toEqual([]);
    expect([...origins]).toEqual([new URL(CATALOG).origin]);
  });

  test("3. 見出しが 1 つ・節の目次と 4 つの節・6 つの画面の見本がある", async ({ page }) => {
    await open(page);
    await expect(page.locator("h1")).toHaveCount(1);
    for (const id of ["tokens", "icons", "parts", "screens"]) await expect(page.locator(`section#${id}`)).toBeVisible();
    await expect(page.getByTestId("ctl-screen").getByRole("tab")).toHaveCount(6);
    expect(await page.getByTestId("icon-grid").locator("li").count()).toBeGreaterThanOrEqual(32);
  });
});

test.describe("B. 横スクロールなし（C3）", () => {
  for (const width of [375, 768, 1280]) {
    test(`4. 幅 ${width}px：明・暗 × 配色案 1〜3 × 通常・現場 で、ページ全体と 6 つの画面の見本に横スクロールがない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        for (const palette of ["1", "2", "3"]) {
          await open(page, `theme=${theme}&palette=${palette}`);
          await expectNoHorizontalScroll(page, `${width}px ${theme} 案${palette}`);
        }
      }
      for (const field of [false, true]) {
        for (const id of ["今日", "一覧", "フォーム", "ワークスペース", "現場モード", "凡例"]) {
          await open(page, field ? "field=1&theme=dark" : "theme=light");
          await screenTab(page, id).click();
          await expectNoHorizontalScroll(page, `${width}px ${id}${field ? "（現場・暗）" : ""}`);
        }
      }
      // compact density and the form with errors shown
      await open(page, "density=compact&screen=form");
      await page.getByRole("button", { name: "エラー表示を切り替え" }).click();
      await expectNoHorizontalScroll(page, `${width}px フォーム（エラー）`);
    });
  }
});

test.describe("C. トークンと切り替え（1a-1・1a-2・1a-6）", () => {
  test("5. 配色案（1〜3）・テーマ（明・暗）・現場モードの切り替えが色に効く。URL に反映される", async ({ page }) => {
    await open(page, "theme=light");
    expect(await accentOf(page)).toBe("#0a5fd0");
    await page.getByTestId("ctl-palette").getByRole("radio", { name: /案 2/ }).click();
    expect(await accentOf(page)).toBe("#1f4a99");
    await page.getByTestId("ctl-palette").getByRole("radio", { name: /案 3/ }).click();
    expect(await accentOf(page)).toBe("#0b6f6a");
    await expect(root(page)).toHaveAttribute("data-palette", "3");
    await page.getByTestId("ctl-theme").getByRole("radio", { name: "暗" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await accentOf(page)).toBe("#5fc7ba");
    await page.getByTestId("ctl-theme").getByRole("radio", { name: "自動" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await page.getByTestId("ctl-theme").getByRole("radio", { name: "明" }).click();
    await page.getByTestId("ctl-field").click();
    await expect(root(page)).toHaveClass(/\bfield\b/);
    expect(await accentOf(page)).toBe("#1f4a99"); // field mode: fixed deep indigo, whichever palette
    await expect.poll(() => page.url()).toContain("palette=3");
    expect(page.url()).toContain("field=1");
    expect(page.url()).toContain("theme=light");
    //密度
    await page.getByTestId("ctl-density").getByRole("radio", { name: "コンパクト" }).click();
    await expect(root(page)).toHaveAttribute("data-density", "compact");
  });

  test("6. 実測のコントラスト表示に「不足」がない（明・暗 × 配色案 × 現場）", async ({ page }) => {
    for (const theme of ["light", "dark"]) {
      for (const palette of ["1", "2", "3"]) {
        for (const field of ["", "&field=1"]) {
          await open(page, `theme=${theme}&palette=${palette}${field}`);
          const out = page.getByTestId("contrast-readout");
          await expect(out.locator("li")).toHaveCount(9);
          await expect(out).not.toContainText("不足");
          await expect(out).not.toContainText("—");
        }
      }
    }
  });

  test("7. OS の暗い配色の設定に自動で従い、「明」を選ぶと明るくなる", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    expect(await accentOf(page)).toBe("#6aa8ff");
    await page.getByTestId("ctl-theme").getByRole("radio", { name: "明" }).click();
    expect(await accentOf(page)).toBe("#0a5fd0");
  });

  test("8. prefers-reduced-motion では動き（骨組みの明滅・ダイアログの出入り）が止まる", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const skeleton = page.locator(".ds-skeleton").first();
    await expect(skeleton).toBeAttached();
    expect(await skeleton.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.getByTestId("open-dialog").click();
    const panel = page.locator("dialog[open] .ds-dialog-panel");
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // and with motion allowed the same elements do animate
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await skeleton.evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");
  });
});

test.describe("D. 部品の操作：キーボード・フォーカス（C5）", () => {
  test("9. ダイアログ：開くとフォーカスが中に入り、Tab は中で循環し、Esc で閉じて、開いたボタンへ戻る", async ({ page }) => {
    await open(page);
    const opener = page.getByTestId("open-dialog");
    await opener.focus();
    await page.keyboard.press("Enter");
    const dlg = page.locator("dialog[open]");
    await expect(dlg).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]"))).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")), `Tab ${i + 1}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("10. ボトムシート・ドロワー・理由つきの確認：閉じるボタンで閉じ、フォーカスが戻る。理由が空なら取消できない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    for (const id of ["open-sheet", "open-drawer"]) {
      const b = page.getByTestId(id);
      await b.click();
      const dlg = page.locator("dialog[open]");
      await expect(dlg).toBeVisible();
      // at < 768px the panel is a bottom sheet: it touches the bottom edge
      // (poll: the panel slides in over 240ms)
      await expect
        .poll(async () => {
          const box = await dlg.locator(".ds-dialog-panel").boundingBox();
          return Math.round((box?.y ?? 0) + (box?.height ?? 0));
        })
        .toBe(800);
      await dlg.getByRole("button", { name: "閉じる" }).first().click();
      await expect(dlg).toHaveCount(0);
      await expect(b).toBeFocused();
    }
    await page.getByTestId("open-reason").click();
    const dlg = page.locator("dialog[open]");
    const confirm = dlg.getByRole("button", { name: "取り消す" });
    await expect(confirm).toBeDisabled();
    await dlg.getByRole("textbox").fill("入力の誤りのため");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByTestId("reason-result")).toContainText("入力の誤りのため");
    await expect(page.getByTestId("toast").first()).toContainText("取り消しました");
  });

  test("11. 幅 1280px のダイアログは中央、ドロワーは右端", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await page.getByTestId("open-dialog").click();
    const d = await page.locator("dialog[open] .ds-dialog-panel").boundingBox();
    expect(Math.abs((d?.x ?? 0) + (d?.width ?? 0) / 2 - 640)).toBeLessThan(2);
    await page.keyboard.press("Escape");
    await page.getByTestId("open-drawer").click();
    const r = await page.locator("dialog[open] .ds-dialog-panel").boundingBox();
    expect(Math.round((r?.x ?? 0) + (r?.width ?? 0))).toBe(1280);
    expect(r?.width ?? 0).toBeLessThanOrEqual(420);
    expect(r?.width ?? 0).toBeGreaterThanOrEqual(360);
  });

  test("12. タブとセグメント：矢印キーで移動し、選択が変わる（roving tabindex）", async ({ page }) => {
    await open(page);
    const tabs = page.getByRole("tablist", { name: "タブの見本" });
    await tabs.getByRole("tab", { name: "概要" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: /履歴/ })).toHaveAttribute("aria-selected", "true");
    await expect(tabs.getByRole("tab", { name: /履歴/ })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: /履歴/ })).toBeVisible();
    await page.keyboard.press("End");
    await expect(tabs.getByRole("tab", { name: "設定" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.getByRole("tab", { name: "概要" })).toHaveAttribute("aria-selected", "true");
    const seg = page.getByRole("radiogroup", { name: "表示の切り替え" });
    await seg.getByRole("radio", { name: "一覧" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(seg.getByRole("radio", { name: "地図" })).toHaveAttribute("aria-checked", "true");
  });

  test("13. ⓘ：クリックで開き、Esc で閉じる。ホバーとフォーカスでも見える。タッチ（タップ）でも開く", async ({ page, browser }) => {
    await open(page);
    const btn = page.getByTestId("demo-info");
    const note = btn.locator("xpath=following-sibling::*[@role='note']");
    await expect(note).toBeHidden();
    await btn.click();
    await expect(note).toBeVisible();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(note).toBeHidden();
    await page.mouse.move(0, 0);
    await btn.hover();
    await expect(note).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(note).toBeHidden();
    await btn.evaluate((el) => (el as HTMLElement).blur());
    await btn.focus();
    await expect(note).toBeVisible();
    // the tap area is 44px
    const box = await btn.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    // touch
    const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 800 } });
    const tp = await ctx.newPage();
    await open(tp);
    const tbtn = tp.getByTestId("demo-info");
    await tbtn.scrollIntoViewIfNeeded();
    await tbtn.tap();
    await expect(tbtn.locator("xpath=following-sibling::*[@role='note']")).toBeVisible();
    // the panel stays inside the viewport (16px gutter)
    const nb = await tbtn.locator("xpath=following-sibling::*[@role='note']").boundingBox();
    expect(nb?.x ?? -1).toBeGreaterThanOrEqual(15);
    expect((nb?.x ?? 0) + (nb?.width ?? 0)).toBeLessThanOrEqual(360);
    await ctx.close();
  });

  test("14. コマンドパレット：Ctrl+K で開き、入力で絞り込み、矢印・Enter で実行（テーマが変わる）、Esc で閉じる。入力欄・現場モードでは開かない", async ({ page }) => {
    await open(page, "theme=light");
    await page.keyboard.press("Control+k");
    const dlg = page.getByTestId("command-palette");
    await expect(dlg).toBeVisible();
    const input = dlg.getByRole("combobox");
    await expect(input).toBeFocused();
    await input.fill("テーマ");
    await expect(dlg.getByRole("option")).toHaveCount(3);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(dlg.getByRole("option").nth(2)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(dlg).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // empty result
    await page.keyboard.press("Control+k");
    await dlg.getByRole("combobox").fill("存在しない語");
    await expect(dlg).toContainText("見つかりません");
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    // not from inside a text field
    await screenTab(page, "フォーム").click();
    await page.locator("#f-name").focus();
    await page.keyboard.press("Control+k");
    await expect(dlg).toBeHidden();
    // not in field mode
    await page.getByTestId("ctl-field").click();
    await page.locator("body").click({ position: { x: 4, y: 300 } });
    await page.keyboard.press("Control+k");
    await expect(dlg).toBeHidden();
  });

  test("15. 「?」でショートカット一覧が開く（Esc で閉じる）。入力欄の中では開かない", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    const sheet = page.getByTestId("shortcut-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("入力のペインを開閉");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await screenTab(page, "フォーム").click();
    await page.locator("#f-name").focus();
    await page.keyboard.press("?");
    await expect(sheet).toBeHidden();
  });

  test("16. コンテキストメニュー：「…」・右クリック・Shift+F10 で開き、矢印で移動し、Esc で閉じてフォーカスが戻る。選ぶとトーストが出て、4 秒ほどで消える", async ({ page }) => {
    await open(page);
    const wrap = page.getByTestId("demo-context");
    const btn = wrap.getByRole("button", { name: "行の操作" });
    await btn.click();
    const menu = page.getByRole("menu", { name: "行の操作" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(btn).toBeFocused();
    await wrap.click({ button: "right" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "リンクをコピー" }).click();
    const toast = page.getByTestId("toast").first();
    await expect(toast).toContainText("コピーしました");
    await expect(page.getByTestId("toast-region")).toHaveAttribute("aria-live", "polite");
    await expect(page.getByTestId("toast")).toHaveCount(0, { timeout: 10_000 });
    await btn.focus();
    await page.keyboard.press("Shift+F10");
    await expect(menu).toBeVisible();
  });

  test("17. 押下の見た目とフォーカスのリング：キーボードでフォーカスすると 2px のリングが出る", async ({ page }) => {
    await open(page);
    await page.getByTestId("open-toast").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const ring = await page.getByTestId("open-toast").evaluate((el) => {
      const cs = getComputedStyle(el);
      return { w: cs.outlineWidth, style: cs.outlineStyle };
    });
    expect(ring).toEqual({ w: "2px", style: "solid" });
  });
});

test.describe("E. 一覧・フィルター・表（1a-5）", () => {
  test("18. 並べ替え：見出しのボタンで aria-sort が変わり、行の並びが変わる。<768px では見出しが隠れ、積み重ねになり、並べ替えは選択欄", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "screen=list");
    const table = page.getByRole("table", { name: /飛行計画の一覧/ });
    const firstRowText = async (): Promise<string> => ((await table.locator("tbody tr").first().locator("td").first().innerText()) ?? "").trim();
    await expect(table.getByRole("columnheader", { name: /日付/ })).toHaveAttribute("aria-sort", "ascending");
    expect(await firstRowText()).toBe("見本の地点 D の撮影");
    await table.getByRole("button", { name: /日付/ }).click();
    await expect(table.getByRole("columnheader", { name: /日付/ })).toHaveAttribute("aria-sort", "descending");
    expect(await firstRowText()).toBe("見本の地点 G の点検");
    await table.getByRole("button", { name: /計画名/ }).click();
    await expect(table.getByRole("columnheader", { name: /計画名/ })).toHaveAttribute("aria-sort", "ascending");
    await expect(table.getByRole("columnheader", { name: /日付/ })).toHaveAttribute("aria-sort", "none");
    // sortable columns only
    await expect(table.getByRole("columnheader", { name: "機体" })).not.toHaveAttribute("aria-sort", /.+/);
    // stacked below 768
    await page.setViewportSize({ width: 375, height: 900 });
    const row = table.locator("tbody tr").first();
    expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe("block");
    expect(await table.locator("thead").evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    await expect(page.getByLabel("並べ替え", { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "積み重ねの一覧");
    const label = await row.locator("td").nth(1).evaluate((el) => getComputedStyle(el, "::before").content);
    expect(label).toContain("日付");
  });

  test("19. 行全体がリンク：行の右端（リンクの文字の外）を押しても遷移する（ハッシュ）。プレビューのボタンは別の動き", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "screen=list");
    const row = page.getByTestId("sample-row-p4");
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    // a point on the right of the row, away from the title text and from the preview button
    await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) - 130, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await expect.poll(() => page.url()).toContain("#plan-p4");
    // the preview button opens the inspector (>= 1280px) and does not navigate
    await page.getByTestId("sample-preview-p2").click();
    await expect(page.getByTestId("sample-inspector")).toBeVisible();
    await expect(page.getByTestId("sample-inspector")).toContainText("見本の地点 B の点検");
    expect(page.url()).toContain("#plan-p4");
    await page.getByTestId("sample-inspector").getByRole("button", { name: "プレビューを閉じる" }).click();
    await expect(page.getByTestId("sample-inspector")).toHaveCount(0);
  });

  test("20. 幅 768px 未満ではインスペクタがドロワー（シート）で開く", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await open(page, "screen=list");
    await page.getByTestId("sample-preview-p1").click();
    const dlg = page.locator("dialog[open]");
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText("見本の地点 A の撮影");
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  });

  test("21. フィルターバー：絞り込みで件数が変わり、チップで外せ、「すべて解除」で戻る。結果がなければ空の状態", async ({ page }) => {
    await open(page, "screen=list");
    const count = page.getByTestId("filter-count");
    await expect(count).toHaveText("8 件");
    await page.getByLabel("状態で絞り込み").selectOption("done");
    await expect(count).toHaveText("2 件");
    await expect(page.getByRole("button", { name: /状態「完了」の絞り込みを外す/ })).toBeVisible();
    await page.getByRole("searchbox", { name: "計画名・操縦者で絞り込み" }).fill("地点 F");
    await expect(count).toHaveText("1 件");
    await page.getByRole("searchbox", { name: "計画名・操縦者で絞り込み" }).fill("存在しない");
    await expect(count).toHaveText("0 件");
    await expect(page.getByText("条件に合う計画がありません")).toBeVisible();
    await page.getByRole("button", { name: "すべて解除" }).click();
    await expect(count).toHaveText("8 件");
    await expect(page.getByRole("button", { name: "すべて解除" })).toHaveCount(0);
  });

  test("22. 密度：コンパクトで行が低くなる（標準 44px／コンパクト 36px）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "screen=list");
    const h1 = (await page.getByTestId("sample-row-p1").boundingBox())?.height ?? 0;
    expect(h1).toBeGreaterThanOrEqual(44);
    await page.getByTestId("ctl-density").getByRole("radio", { name: "コンパクト" }).click();
    const h2 = (await page.getByTestId("sample-row-p1").boundingBox())?.height ?? 0;
    expect(h2).toBeLessThan(h1);
    expect(h2).toBeGreaterThanOrEqual(36);
    expect(h2).toBeLessThanOrEqual(40);
  });

  test("23. 固定の注意書きは、折りたたみ・ホバーに入れず、見出しの直下に常に見える", async ({ page }) => {
    await open(page, "screen=list");
    const notice = page.getByTestId("sample-notice");
    await expect(notice).toBeVisible();
    expect(await notice.evaluate((el) => el.closest("details, [hidden]") === null)).toBe(true);
    // directly under the page header: the notice comes before the filter bar in the DOM
    const before = await page.evaluate(() => {
      const n = document.querySelector('[data-testid="sample-notice"]')!;
      const f = document.querySelector('[data-testid="filter-count"]')!;
      return !!(n.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(before).toBe(true);
  });
});

test.describe("F. フォーム（1a-5・1a-6）", () => {
  test("24. エラー表示：要約（role=alert）と、入力のすぐ下のメッセージ。トグル・保存（読み込み中）が動く", async ({ page }) => {
    await open(page, "screen=form");
    await page.getByRole("button", { name: "エラー表示を切り替え" }).click();
    await expect(page.getByTestId("sample-form").getByRole("alert")).toContainText("入力を確かめてください");
    await expect(page.locator("#f-address-error")).toContainText("住所を入力してください");
    await expect(page.locator("#f-address")).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "エラー表示を切り替え" }).click();
    const sw = page.getByRole("switch", { name: "変更を通知する" });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("未保存の変更があります")).toBeVisible();
    const save = page.getByTestId("sample-form").getByRole("button", { name: "保存", exact: true });
    await save.click();
    await expect(save).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("toast").first()).toContainText("保存しました");
    await expect(page.getByText("変更はありません")).toBeVisible();
  });
});

test.describe("G. ワークスペース（1a-5・1a-6：phase-atlas の作法）", () => {
  test("25. 幅 1280px：左右のペイン・地図。端のトグルと [ ] キーで開閉し、入力した値は保たれ、地図の最大化もできる", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "screen=workspace");
    const left = page.getByTestId("workspace-input");
    const right = page.getByTestId("workspace-result");
    const map = page.getByTestId("workspace-map");
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    await expect(map).toBeVisible();
    // the bottom sheet chrome is not shown at this width
    await expect(page.getByTestId("workspace-tabs")).toBeHidden();
    await expect(page.getByTestId("workspace-handle")).toBeHidden();
    const widthOf = async (l: Locator): Promise<number> => (await l.boundingBox())?.width ?? 0;
    expect(await widthOf(left)).toBeGreaterThan(300);
    await page.locator("#ws-address").fill("見本市 見本町 1-2-3");
    const toggle = page.getByTestId("workspace-toggle-left");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => widthOf(left)).toBeLessThan(2);
    const mapWide = await widthOf(map);
    await page.keyboard.press("[");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => widthOf(left)).toBeGreaterThan(300);
    expect(await widthOf(map)).toBeLessThan(mapWide);
    await expect(page.locator("#ws-address")).toHaveValue("見本市 見本町 1-2-3");
    await page.keyboard.press("]");
    await expect(page.getByTestId("workspace-toggle-right")).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => widthOf(right)).toBeLessThan(2);
    // collapsed panes are not focusable
    await expect(right).toHaveAttribute("inert", "");
    await page.keyboard.press("]");
    await expect.poll(() => widthOf(right)).toBeGreaterThan(300);
    // maximize
    await page.getByTestId("workspace-maximize").click();
    await expect.poll(() => widthOf(left)).toBeLessThan(2);
    await expect.poll(() => widthOf(right)).toBeLessThan(2);
    await page.getByTestId("workspace-maximize").click();
    await expect.poll(() => widthOf(left)).toBeGreaterThan(300);
    await expect(page.locator("#ws-address")).toHaveValue("見本市 見本町 1-2-3");
    // keys are ignored while typing in a field
    await page.locator("#ws-address").focus();
    await page.keyboard.type("[");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("26. 幅 375px：地図が主役。下タブで入力・結果を開き、ボトムシートは 3 段階（最小・半分・全体）。結論は全段階で見える", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "screen=workspace");
    const frame = page.getByTestId("sample-workspace-frame");
    const sheet = page.getByTestId("workspace-sheet");
    const peek = page.getByTestId("workspace-peek");
    const tabs = page.getByTestId("workspace-tabs");
    await frame.scrollIntoViewIfNeeded();
    await expect(tabs).toBeVisible();
    await expect(frame).toHaveAttribute("data-sheet-stage", "peek");
    await expect(peek).toContainText("要手続き");
    const frameBox = (await frame.boundingBox())!;
    const peekH = (await sheet.boundingBox())!.height;
    expect(peekH).toBeLessThan(110);
    // the map stays operable at peek: the point at the middle of the map is the map, not the sheet
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid]')?.getAttribute("data-testid"), [frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height * 0.3]);
    expect(hit).toBe("workspace-map");
    // open the input tab → half
    await tabs.getByRole("tab", { name: "入力" }).click();
    await expect(frame).toHaveAttribute("data-sheet-stage", "half");
    await expect(page.getByTestId("workspace-input")).toBeVisible();
    await expect(page.getByTestId("workspace-result")).toBeHidden();
    await expect(peek).toBeVisible();
    await page.locator("#ws-address").fill("見本市");
    // handle: tap cycles half → full → peek
    const handle = page.getByTestId("workspace-handle");
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await expect(frame).toHaveAttribute("data-sheet-stage", "full");
    await expect(peek).toBeVisible();
    const fullH = (await sheet.boundingBox())!.height;
    expect(fullH).toBeGreaterThan(frameBox.height * 0.8);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(frame).toHaveAttribute("data-sheet-stage", "peek");
    // switching tabs keeps what was typed and the other panel is still in the DOM
    await tabs.getByRole("tab", { name: "結果" }).click();
    await expect(page.getByTestId("workspace-result")).toBeVisible();
    await expect(page.getByTestId("workspace-input")).toBeHidden();
    await expect(page.getByTestId("workspace-input")).toBeAttached();
    await tabs.getByRole("tab", { name: "入力" }).click();
    await expect(page.locator("#ws-address")).toHaveValue("見本市");
    // the map tab collapses the sheet to peek
    await tabs.getByRole("tab", { name: "地図" }).click();
    await expect(frame).toHaveAttribute("data-sheet-stage", "peek");
    // conclusion changes with the sample verdict and stays in the peek line
    await tabs.getByRole("tab", { name: "結果" }).click();
    await page.getByLabel("結論の見本を切り替え").first().selectOption("no_fly");
    await expect(peek).toContainText("飛行不可");
    await expectNoHorizontalScroll(page, "ワークスペース 375");
  });

  test("27. 幅 768px も 1024px 未満：ボトムシートと下タブ。1024px でペインに切り替わる", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await open(page, "screen=workspace");
    await expect(page.getByTestId("workspace-tabs")).toBeVisible();
    await expect(page.getByTestId("workspace-toggle-left")).toBeHidden();
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(page.getByTestId("workspace-tabs")).toBeHidden();
    await expect(page.getByTestId("workspace-toggle-left")).toBeVisible();
  });
});

test.describe("H. アイコン案・線画（追加の要望 2026-10-22）", () => {
  test("28. アプリのアイコン案 3 案が、原画・明・暗の背景・29/60/180px で並ぶ。原画は正方形", async ({ page }) => {
    await open(page);
    for (const id of ["top-view", "sweep", "orbit"]) {
      const card = page.getByTestId(`appicon-${id}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      const raw = (await page.getByTestId(`appicon-${id}-raw`).boundingBox())!;
      expect(raw.width).toBe(raw.height);
      for (const bg of ["light", "dark"]) {
        for (const s of [180, 60, 29]) {
          const el = page.getByTestId(`appicon-${id}-${bg}-${s}`).locator("svg");
          const b = (await el.boundingBox())!;
          expect([Math.round(b.width), Math.round(b.height)]).toEqual([s, s]);
        }
      }
    }
    // the proposals follow the chosen palette (the placeholder blue is the accent)
    const fillOf = (): Promise<string> => page.getByTestId("appicon-top-view-raw").locator("rect").first().evaluate((el) => getComputedStyle(el).fill);
    const p1 = await fillOf();
    await page.getByTestId("ctl-palette").getByRole("radio", { name: /案 3/ }).click();
    expect(await fillOf()).not.toBe(p1);
  });

  test("29. ドローンの線画：線 1.75px・currentColor。拡大・縮小しても太さが変わらない", async ({ page }) => {
    await open(page);
    const arts = page.locator("svg[viewBox='0 0 200 140']");
    expect(await arts.count()).toBeGreaterThanOrEqual(3);
    const widths = await arts.evaluateAll((els) => els.map((el) => ({ w: el.getBoundingClientRect().width, sw: getComputedStyle(el.querySelector("path")!).strokeWidth, ve: getComputedStyle(el.querySelector("path")!).vectorEffect })));
    expect(new Set(widths.map((x) => x.w)).size).toBeGreaterThan(1);
    for (const x of widths) {
      expect(x.sw).toBe("1.75px");
      expect(x.ve).toBe("non-scaling-stroke");
    }
  });
});

test.describe("I. 現場モードの基準（C4・C6）：7:1・56px・大きな文字", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`30. 現場モードの画面（${scheme}）：本文・状態の語・主ボタンが 7:1 以上、押す部品が 56px 以上、本文 18px 以上、状態の語 20px 以上で太い`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, `screen=field&theme=${scheme}`);
      const sel = '[data-testid="sample-field"]';
      await expectContrast(page, sel, 7, `現場モード ${scheme}`);
      await expectTapTargets(page, sel, `現場モード ${scheme}`);
      const sizes = await page.locator(`${sel} ul[aria-label="項目の状態"] li`).evaluateAll((lis) =>
        lis.map((li) => {
          const name = li.children[1] as HTMLElement;
          const state = li.children[2] as HTMLElement;
          return { name: parseFloat(getComputedStyle(name).fontSize), state: parseFloat(getComputedStyle(state).fontSize), weight: parseInt(getComputedStyle(state).fontWeight, 10) };
        }),
      );
      for (const s of sizes) {
        expect(s.name).toBeGreaterThanOrEqual(18);
        expect(s.state).toBeGreaterThanOrEqual(20);
        expect(s.weight).toBeGreaterThanOrEqual(600);
      }
      // no translucency in field mode
      const filter = await page.locator(sel).evaluate((el) => getComputedStyle(el).backdropFilter);
      expect(filter).toBe("none");
      // the one primary action
      const primary = page.getByTestId("sample-field-primary");
      expect((await primary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
      await primary.click();
      await expect(page.getByText("1 件 送信待ち")).toBeVisible();
    });
  }

  test("31. 通常モードのコントラスト：4.5:1 以上（明・暗 × 配色案 1〜3。無効の部品を除く）", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const palette of ["1", "2", "3"]) {
        await open(page, `theme=${theme}&palette=${palette}&screen=legend`);
        await expectContrast(page, '[data-testid="sample-legend"]', 4.5, `凡例 ${theme} 案${palette}`);
        await screenTab(page, "今日").click();
        await expectContrast(page, '[data-testid="sample-today"]', 4.5, `今日 ${theme} 案${palette}`);
      }
    }
  });

  test("32. 通常モードの押す部品は 44px 以上（標準の密度）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "screen=list");
    const targets = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="sample-list"] button, [data-testid="sample-list"] [role="tab"], [data-testid="sample-list"] select'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.height < 43.5 || r.width < 43.5) out.push(`${el.textContent?.trim() || el.getAttribute("aria-label")} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
      }
      return out;
    });
    expect(targets).toEqual([]);
  });
});

test.describe("J. 既存の画面の見た目が変わらない（1a-8）", () => {
  test("33. 判定画面（/）は、新しいトークンを使わず、紙・インク・藍のまま（.ds・色の宣言・Web フォントが変わらない）", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${MAIN}/`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".ds")).toHaveCount(0);
    const v = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const rs = getComputedStyle(document.documentElement);
      return {
        bg: cs.backgroundColor,
        fg: cs.color,
        grid: cs.backgroundImage.includes("linear-gradient"),
        family: cs.fontFamily,
        scheme: rs.colorScheme,
        paper: rs.getPropertyValue("--color-paper").trim().toLowerCase(),
        radius: rs.getPropertyValue("--radius-sharp").trim(),
      };
    });
    expect(v.bg).toBe("rgb(245, 242, 234)");
    expect(v.fg).toBe("rgb(14, 20, 33)");
    expect(v.grid).toBe(true);
    expect(v.family).toMatch(/IBM[ _]Plex[ _]Sans[ _]JP/);
    expect(v.scheme).toBe("normal");
    expect(v.paper).toBe("#f5f2ea");
    expect(v.radius).toBe("2px");
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(dark).toBe("rgb(12, 19, 32)");
  });

  test("34. 見本の設定（data-theme）は、見本を離れても残らない（/ を開き直すと付かない）", async ({ page }) => {
    await open(page, "theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.goto(`${MAIN}/`);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  });
});

test.describe("K. Codex レビューの指摘（最大化中のトグル・color-scheme・画面下端の浮きもの）", () => {
  test("35. 地図の最大化中に端のトグル・[ ] キーを押すと、最大化を戻して要求したペインを開く（効かないままにならない）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "screen=workspace");
    const left = page.getByTestId("workspace-input");
    const right = page.getByTestId("workspace-result");
    const maximize = page.getByTestId("workspace-maximize");
    const widthOf = async (l: Locator): Promise<number> => (await l.boundingBox())?.width ?? 0;
    await maximize.click();
    await expect(maximize).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => widthOf(left)).toBeLessThan(2);
    // the edge toggle says "open" and works: it ends the maximized state and shows the left pane
    const toggleLeft = page.getByTestId("workspace-toggle-left");
    await expect(toggleLeft).toHaveAttribute("aria-expanded", "false");
    await toggleLeft.click();
    await expect(maximize).toHaveAttribute("aria-pressed", "false");
    await expect(toggleLeft).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => widthOf(left)).toBeGreaterThan(300);
    await expect.poll(() => widthOf(right)).toBeGreaterThan(300);
    // the same with the "]" key, when the right pane had been closed before maximizing
    await page.keyboard.press("]");
    await expect.poll(() => widthOf(right)).toBeLessThan(2);
    await maximize.click();
    await expect(maximize).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("]");
    await expect(maximize).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => widthOf(right)).toBeGreaterThan(300);
    await expect.poll(() => widthOf(left)).toBeGreaterThan(300);
    // a pane closed before maximizing and not asked for stays closed
    await page.keyboard.press("[");
    await expect.poll(() => widthOf(left)).toBeLessThan(2);
    await maximize.click();
    await page.getByTestId("workspace-toggle-right").click();
    await expect(maximize).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => widthOf(right)).toBeGreaterThan(300);
    expect(await widthOf(left)).toBeLessThan(2);
  });

  test("36. 強制したテーマでは color-scheme が単一の値（ブラウザ描画の部品も同じ配色）。自動のときは light dark", async ({ page }) => {
    const schemeOf = (sel: string): Promise<string> => page.locator(sel).first().evaluate((el) => getComputedStyle(el).colorScheme);
    for (const os of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: os });
      await open(page, "theme=light");
      expect(await schemeOf("html")).toBe("light");
      expect(await schemeOf("[data-testid=design-catalog]")).toBe("light");
      expect(await schemeOf("[data-testid=design-catalog] select")).toBe("light");
      await open(page, "theme=dark");
      expect(await schemeOf("html")).toBe("dark");
      expect(await schemeOf("[data-testid=design-catalog]")).toBe("dark");
      expect(await schemeOf("[data-testid=design-catalog] select")).toBe("dark");
      await open(page);
      expect(await schemeOf("[data-testid=design-catalog]")).toBe("light dark");
    }
    // field mode follows the theme as well (it has a light and a dark set)
    await page.emulateMedia({ colorScheme: "light" });
    await open(page, "theme=dark&field=1");
    expect(await schemeOf(".field")).toBe("dark");
  });

  test("37. 画面の下端近く（375×667）で開いたコンテキストメニューとⓘは、全項目・全文が画面内に収まる", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await open(page);
    const vh = 667;
    const lowerTo = async (testId: string, bottomGap: number): Promise<void> => {
      await page.getByTestId(testId).evaluate((el, gap) => {
        el.scrollIntoView({ block: "center" });
        window.scrollBy(0, el.getBoundingClientRect().bottom - (window.innerHeight - gap));
      }, bottomGap);
    };
    const inside = async (l: Locator, label: string): Promise<void> => {
      const b = await l.boundingBox();
      expect(b, label).not.toBeNull();
      expect(b!.y, `${label} top`).toBeGreaterThanOrEqual(0);
      expect(b!.y + b!.height, `${label} bottom`).toBeLessThanOrEqual(vh);
    };
    // "..." button near the bottom edge
    await lowerTo("demo-context", 4);
    const wrap = page.getByTestId("demo-context");
    await wrap.getByRole("button", { name: "行の操作" }).click();
    const menu = page.getByRole("menu", { name: "行の操作" });
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitem");
    const n = await items.count();
    expect(n).toBeGreaterThan(1);
    await inside(menu, "menu (button)");
    for (let i = 0; i < n; i++) await inside(items.nth(i), `item ${i} (button)`);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    // a right click at the bottom edge of the viewport
    await lowerTo("demo-context", 4);
    // wait until the scroll has settled (two equal readings in a row), then press inside the wrapper's last 2px of height
    let last = Number.NaN;
    await expect
      .poll(async () => {
        const y = (await wrap.boundingBox())?.y ?? Number.NaN;
        const settled = y === last;
        last = y;
        return settled;
      })
      .toBe(true);
    const box = (await wrap.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
    await page.mouse.click(box.x + 20, box.y + box.height - 2, { button: "right" });
    await expect(menu).toBeVisible();
    await inside(menu, "menu (right click)");
    for (let i = 0; i < n; i++) await inside(items.nth(i), `item ${i} (right click)`);
    // the last item can be chosen
    await items.nth(n - 1).click();
    await expect(menu).toBeHidden();
    // (i) near the bottom edge opens upward and stays inside the viewport
    await lowerTo("demo-info", 4);
    await page.getByTestId("demo-info").click();
    const note = page.getByRole("note").filter({ hasText: "ボタンを押すか" });
    await expect(note).toBeVisible();
    await inside(note, "info panel");
    const nb = (await note.boundingBox())!;
    expect(nb.x).toBeGreaterThanOrEqual(0);
    expect(nb.x + nb.width).toBeLessThanOrEqual(375);
  });
});
