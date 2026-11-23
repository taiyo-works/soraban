import { expect, test, type Page } from "@playwright/test";
import { expectFields, expectTextZoom, measureTextZoom, openDetails, waitForSettledStyles } from "./field-checks";

// Sprint 16-D の E2E（DB なし）：部品 2（入力欄・チェック行・ボトムシート・スケルトン・空の状態・通信エラー）。契約 D-1〜D-5、K-6・K-7・K-15、追加 1（文字 200% の入れ物の切れ）。
// 見本（/ops/design）は DESIGN_CATALOG=1 の 2 台目だけが表示する。実画面の入力欄・チェック行は sprint16-d-db。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

const SUNKEN = "rgb(238, 241, 245)";
const SURFACE = "rgb(255, 255, 255)";
const EDGE = "rgb(107, 117, 134)";
const PRIMARY = "rgb(31, 95, 224)";
const FIELD_PRIMARY = "rgb(24, 72, 176)";
const DANGER_MARK = "rgb(180, 35, 24)";
const DANGER_TEXT = "rgb(138, 26, 18)";

const open = async (page: Page, query = ""): Promise<void> => {
  await page.goto(`${CATALOG}/ops/design${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("design-catalog")).toBeVisible();
  await waitForSettledStyles(page);
};

const storageKeys = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    return JSON.stringify({ l: Object.keys(localStorage).sort(), s: Object.keys(sessionStorage).sort(), d: dbs.map((d) => d.name).sort(), c: await caches.keys() });
  });

test.describe("D-1 入力欄", () => {
  test("通常：高さ 52 以上・角丸 12・面 sunken・縁 edge の 1px・ラベルは入力欄の上に見える", async ({ page }) => {
    await open(page);
    const s = await page.getByTestId("cat-input").evaluate((el) => {
      const c = getComputedStyle(el);
      return { h: el.getBoundingClientRect().height, r: c.borderTopLeftRadius, bg: c.backgroundColor, bw: c.borderTopWidth, bs: c.borderTopStyle, bc: c.borderTopColor, fs: parseFloat(c.fontSize) };
    });
    expect(s.h).toBeGreaterThanOrEqual(51.5);
    expect(s.r).toBe("12px");
    expect(s.bg).toBe(SUNKEN);
    expect([s.bw, s.bs, s.bc]).toEqual(["1px", "solid", EDGE]);
    expect(s.fs).toBeGreaterThanOrEqual(16);
    const r = await expectFields(page, '[data-testid="cat-inputs"]', "見本の入力欄", { minCount: 3 });
    expect(r.invalid).toBeGreaterThanOrEqual(1);
  });

  test("フォーカス：主色の 2px の枠（縁 1px＋内側 1px）。キーボードのフォーカスの輪（3px）も残る", async ({ page }) => {
    await open(page);
    const input = page.getByTestId("cat-input");
    await input.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    await waitForSettledStyles(page);
    const s = await input.evaluate((el) => {
      const c = getComputedStyle(el);
      return { bc: c.borderTopColor, bw: c.borderTopWidth, shadow: c.boxShadow, outline: c.outlineStyle, ow: parseFloat(c.outlineWidth) };
    });
    expect(s.bc).toBe(PRIMARY);
    expect(s.bw).toBe("1px");
    expect(s.shadow).toBe(`${PRIMARY} 0px 0px 0px 1px inset`);
    expect(s.outline).toBe("solid"); // Q-22：キーボードのフォーカスの輪は弱めない
    expect(s.ow).toBeGreaterThanOrEqual(3);
  });

  test("ラベル：<label for> で入力欄に結ぶ。クリックでフォーカスが入る。プレースホルダーはラベルの代わりではない", async ({ page }) => {
    await open(page);
    const label = page.locator('label[for="cat-input"]');
    await expect(label).toBeVisible();
    await expect(label).toHaveText("機体の名前");
    await label.click();
    await expect(page.getByTestId("cat-input")).toBeFocused();
    expect(await page.getByTestId("cat-input").getAttribute("placeholder")).not.toBe(await label.textContent());
  });

  test("エラー：縁が危険の印の色。下に記号（SVG）付きの 1 行。aria-describedby で結ぶ。role は alert にしない。入力すると消える", async ({ page }) => {
    await open(page);
    const input = page.getByTestId("cat-f-check");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await page.getByTestId("cat-f-check-submit").click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    const err = page.getByTestId("cat-f-check-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("入力してください");
    const info = await input.evaluate((el) => {
      const c = getComputedStyle(el);
      const target = document.getElementById(el.getAttribute("aria-describedby")!.split(" ")[0]!)!;
      const tc = getComputedStyle(target);
      return { bc: c.borderTopColor, describedBy: el.getAttribute("aria-describedby"), tid: target.id, role: target.getAttribute("role"), svg: target.querySelectorAll("svg").length, svgHidden: target.querySelector("svg")?.getAttribute("aria-hidden"), color: tc.color, fs: parseFloat(tc.fontSize), top: target.getBoundingClientRect().top, inputBottom: el.getBoundingClientRect().bottom };
    });
    expect(info.bc).toBe(DANGER_MARK);
    expect(info.describedBy).toContain("cat-f-check-error");
    expect(info.tid).toBe("cat-f-check-error");
    expect(info.role).toBeNull();
    expect(info.svg).toBe(1);
    expect(info.svgHidden).toBe("true");
    expect(info.color).toBe(DANGER_TEXT);
    expect(info.fs).toBeGreaterThanOrEqual(14);
    expect(info.top).toBeGreaterThanOrEqual(info.inputBottom - 1);
    await expectFields(page, '[data-testid="cat-inputs"]', "エラーを出した入力欄", { minCount: 3 });
    await input.fill("試験機");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(err).toHaveCount(0);
  });

  test("現場：高さ 56 以上", async ({ page }) => {
    await open(page, "mode=field");
    const h = await page.getByTestId("cat-input").evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(55.5);
    await expectFields(page, '[data-testid="cat-inputs"]', "現場の見本の入力欄", { field: true, minCount: 3 });
  });
});

test.describe("D-2 チェック行", () => {
  test("行の高さ 72 以上・32 の丸いチェック・行全体が <label>・クリックで切り替わる。群の見出しに完了数/総数", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 2600 });
    await open(page);
    const row = page.getByTestId("cat-chk-row-1");
    const s = await row.evaluate((el) => {
      const input = el.querySelector("input")!;
      const ic = getComputedStyle(input);
      return { tag: el.tagName, h: el.getBoundingClientRect().height, iw: input.getBoundingClientRect().width, ih: input.getBoundingClientRect().height, ir: parseFloat(ic.borderTopLeftRadius), hasInput: el.contains(input) };
    });
    expect(s.tag).toBe("LABEL");
    expect(s.hasInput).toBe(true);
    expect(s.h).toBeGreaterThanOrEqual(71.5);
    expect([s.iw, s.ih]).toEqual([32, 32]);
    expect(s.ir).toBeGreaterThanOrEqual(16);
    const count = page.getByTestId("cat-chk-group-count");
    await expect(count).toHaveText(/^1\/4/);
    // 行の文字の上をクリックしても切り替わる（行全体が押せる）
    await row.getByText("プロペラが固定されている").click();
    await expect(page.getByTestId("cat-chk-1")).toBeChecked();
    await expect(count).toHaveText(/^2\/4/);
    // 四隅の内側も同じ行を指す
    const box = (await row.boundingBox())!;
    for (const [dx, dy] of [[6, 6], [box.width - 6, 6], [6, box.height - 6], [box.width - 6, box.height - 6]] as const) {
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="cat-chk-row-1"]') !== null, [box.x + dx, box.y + dy] as const);
      expect(hit).toBe(true);
    }
  });

  test("K-7 チェック済みは記号（塗りの丸）と文字「済」。未チェックには「済」が出ない", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 2600 });
    await open(page);
    const state = (i: number) =>
      page.getByTestId(`cat-chk-row-${i}`).evaluate((el) => {
        const input = el.querySelector("input")!;
        const done = el.querySelector<HTMLElement>(".sb-chk-done")!;
        const mark = getComputedStyle(input, "::after");
        return { checked: input.checked, bg: getComputedStyle(input).backgroundColor, doneShown: getComputedStyle(done).display !== "none" && done.getBoundingClientRect().width > 0, doneText: done.textContent, markContent: mark.content, markBorder: mark.borderBottomWidth };
      });
    const on = await state(0);
    expect(on.checked).toBe(true);
    expect(on.bg).toBe(PRIMARY);
    expect(on.doneShown).toBe(true);
    expect(on.doneText).toBe("済");
    expect(on.markBorder).toBe("3px");
    const off = await state(2);
    expect(off.checked).toBe(false);
    expect(off.bg).toBe(SURFACE);
    expect(off.doneShown).toBe(false);
    // 色なし（グレースケール）でも、済みの行は「済」の文字と、中のチェックの形で分かる
    await page.getByTestId("cat-chk-row-2").click();
    const after = await state(2);
    expect(after.doneShown).toBe(true);
  });

  test("群：折りたためる（summary を Enter で開閉）。畳んでも完了数/総数は見出しに残る", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 2600 });
    await open(page);
    const group = page.getByTestId("cat-chk-group");
    await expect(group).toHaveAttribute("open", "");
    const summary = group.locator("> summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(group).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("cat-chk-row-0")).toBeHidden();
    await expect(page.getByTestId("cat-chk-group-count")).toHaveText(/^1\/4/);
    const h = await summary.evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(47.5);
    await page.keyboard.press("Enter");
    await expect(group).toHaveAttribute("open", "");
  });

  test("現場：行は 72 以上のまま・済みの色は濃い主色", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 2600 });
    await open(page, "mode=field");
    const s = await page.getByTestId("cat-chk-row-0").evaluate((el) => ({ h: el.getBoundingClientRect().height, bg: getComputedStyle(el.querySelector("input")!).backgroundColor }));
    expect(s.h).toBeGreaterThanOrEqual(71.5);
    expect(s.bg).toBe(FIELD_PRIMARY);
  });
});

test.describe("D-3 ボトムシート", () => {
  const sheetState = (page: Page) =>
    page.getByTestId("sheet").evaluate((el) => {
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { stage: el.getAttribute("data-stage"), h: r.height, vh: window.innerHeight, radiusTop: c.borderTopLeftRadius, modal: el.getAttribute("aria-modal"), role: el.getAttribute("role"), labelled: el.getAttribute("aria-labelledby"), shadow: c.boxShadow, bg: c.backgroundColor };
    });

  test("キーボードだけで：開く→見出しにフォーカス→段を変える→閉じる→元にフォーカスが戻る。3 段の高さ・暗幕・角丸・つまみ", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const opener = page.getByTestId("cat-sheet-open");
    await opener.scrollIntoViewIfNeeded();
    await opener.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("sheet");
    await expect(sheet).toBeVisible();
    await waitForSettledStyles(page);
    // 開くと見出しにフォーカス
    await expect(page.getByTestId("sheet-title")).toBeFocused();
    const labelled = await sheet.getAttribute("aria-labelledby");
    expect(await page.getByTestId("sheet-title").getAttribute("id")).toBe(labelled);
    // 中間：50%・暗幕あり・aria-modal
    let st = await sheetState(page);
    expect(st.stage).toBe("half");
    expect(Math.abs(st.h - st.vh * 0.5)).toBeLessThanOrEqual(1.5);
    expect(st.radiusTop).toBe("20px");
    expect(st.modal).toBe("true");
    expect(st.role).toBe("dialog");
    expect(st.bg).toBe(SURFACE);
    await expect(page.getByTestId("sheet-scrim")).toBeVisible();
    expect(await page.getByTestId("sheet-scrim").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(20, 24, 31, 0.45)");
    const handle = await sheet.locator(".sb-sheet-handle").evaluate((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, hidden: el.getAttribute("aria-hidden") }));
    expect(handle).toEqual({ w: 36, h: 4, hidden: "true" });
    // 「閉じる」は 48px 以上
    const close = await page.getByTestId("sheet-close").boundingBox();
    expect(close!.height).toBeGreaterThanOrEqual(47.5);
    expect(close!.width).toBeGreaterThanOrEqual(47.5);
    // 中間：Tab を何回押しても、フォーカスはシートの外へ出ない（閉じ込め）
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="sheet"]')), `Tab ${i + 1} 回目`).toBe(true);
    }
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="sheet"]')), `Shift+Tab ${i + 1} 回目`).toBe(true);
    }
    // 広げる（キーボード）→ 全面 90%
    await page.getByTestId("sheet-expand").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await sheetState(page)).stage).toBe("full");
    await waitForSettledStyles(page);
    st = await sheetState(page);
    expect(Math.abs(st.h - st.vh * 0.9)).toBeLessThanOrEqual(1.5);
    await expect(page.getByTestId("sheet-expand")).toHaveCount(0); // 端の段では押せないボタンを置かない
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="sheet"]')), "広げるが消えてもフォーカスはシートの中").toBe(true);
    // 縮める → 中間 → ピーク
    await page.getByTestId("sheet-shrink").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await sheetState(page)).stage).toBe("half");
    await page.getByTestId("sheet-shrink").focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await sheetState(page)).stage).toBe("peek");
    await waitForSettledStyles(page);
    st = await sheetState(page);
    expect(Math.round(st.h)).toBe(120);
    expect(st.modal).toBe("false");
    await expect(page.getByTestId("sheet-scrim")).toHaveCount(0); // 暗幕は中間以上だけ
    // Esc で閉じる→開いた元にフォーカスが戻る
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("「閉じる」ボタンと暗幕のクリックでも閉じ、そのつど元にフォーカスが戻る。ピークは暗幕なしで地の画面を操作できる", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const opener = page.getByTestId("cat-sheet-open");
    await opener.scrollIntoViewIfNeeded();
    await opener.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByTestId("sheet-scrim").click({ position: { x: 20, y: 20 } });
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    await expect(opener).toBeFocused();
    // ピークで開く：暗幕なし。シートの外のボタンを押せる
    const peekOpener = page.getByTestId("cat-sheet-open-peek");
    await peekOpener.click();
    await expect(page.getByTestId("sheet")).toHaveAttribute("data-stage", "peek");
    await expect(page.getByTestId("sheet-scrim")).toHaveCount(0);
    await page.getByTestId("cat-f-check-submit").scrollIntoViewIfNeeded();
    const box = (await page.getByTestId("cat-f-check-submit").boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="cat-f-check-submit"]') !== null, [box.x + box.width / 2, box.y + box.height / 2] as const);
    // シートの下に隠れていなければ押せる（隠れる位置のときは画面の上へ動かして確かめる）
    if (!hit) await page.evaluate(() => window.scrollBy(0, 400));
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet")).toHaveCount(0);
  });

  test("動き：通常は --sb-dur-sheet（280ms）。現場と「動きを減らす」では 0（操作の後の getAnimations() が空）", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByTestId("cat-sheet-open").scrollIntoViewIfNeeded();
    await page.getByTestId("cat-sheet-open").click();
    const normal = await page.getByTestId("sheet").evaluate((el) => ({ t: getComputedStyle(el).transitionDuration, a: getComputedStyle(el).animationDuration }));
    expect(normal).toEqual({ t: "0.28s", a: "0.28s" });
    await page.getByTestId("sheet-close").click();

    await open(page, "mode=field");
    await page.getByTestId("cat-sheet-open").scrollIntoViewIfNeeded();
    await page.getByTestId("cat-sheet-open").click();
    await page.getByTestId("sheet-expand").click();
    expect(await page.evaluate(() => document.getAnimations().map((a) => `${a.constructor.name}:${(a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName}`)), "現場").toEqual([]);
    expect(await page.getByTestId("sheet").evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await page.getByTestId("cat-sheet-open").scrollIntoViewIfNeeded();
    await page.getByTestId("cat-sheet-open").click();
    await page.getByTestId("sheet-expand").click();
    // 動きを減らす：時間のトークンは 0。全体の規則（0.01ms）で残る一瞬の遷移は、すぐ終わって getAnimations() が空になる
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sb-dur-sheet").trim())).toMatch(/^0(ms|s)$/);
    await expect.poll(() => page.evaluate(() => document.getAnimations().length), { message: "動きを減らす", timeout: 2000 }).toBe(0);
    expect(parseFloat(await page.getByTestId("sheet").evaluate((el) => getComputedStyle(el).animationDuration))).toBeLessThanOrEqual(0.0001);
  });

  test("文字 200%（390・430）：シートを中間で開いても、横スクロール・文字の切れ・入れ物の切れがない（暗幕の下の主ボタンは対象外）", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByTestId("cat-sheet-open").scrollIntoViewIfNeeded();
    await page.getByTestId("cat-sheet-open").click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    for (const w of [390, 430]) {
      const r = await measureTextZoom(page, w);
      const l = `シートを開いた状態 200%・${w}px`;
      expect(r.scrollWidth, `${l}: 横スクロール`).toBeLessThanOrEqual(r.clientWidth);
      expect(r.clipped, `${l}: 文字の切れ`).toEqual([]);
      expect(r.clippedContainers, `${l}: 入れ物の切れ`).toEqual([]);
      expect(r.unscaled, `${l}: 200% にならない文字`).toEqual([]);
    }
  });
});

test.describe("D-4 スケルトン", () => {
  test("カードの形の静止した帯（sunken）。帯は aria-hidden・親に aria-busy と「読み込み中」。動きなし", async ({ page }) => {
    await open(page);
    const s = await page.getByTestId("cat-skeleton").evaluate((el) => {
      const bands = Array.from(el.querySelectorAll<HTMLElement>(".sb-skel"));
      return {
        busy: el.getAttribute("aria-busy"),
        text: (el.textContent ?? "").trim(),
        srText: el.querySelector(".sb-sr")?.textContent,
        bands: bands.length,
        hidden: bands.every((b) => b.getAttribute("aria-hidden") === "true"),
        bg: bands.map((b) => getComputedStyle(b).backgroundColor),
        anim: bands.map((b) => getComputedStyle(b).animationName),
        cardRadius: getComputedStyle(el).borderTopLeftRadius,
      };
    });
    expect(s.busy).toBe("true");
    expect(s.srText).toBe("読み込み中");
    expect(s.text).toBe("読み込み中");
    expect(s.bands).toBeGreaterThanOrEqual(3);
    expect(s.hidden).toBe(true);
    expect(new Set(s.bg)).toEqual(new Set([SUNKEN]));
    expect(new Set(s.anim)).toEqual(new Set(["none"]));
    expect(s.cardRadius).toBe("16px");
  });

  test("K-6：見本の中に、animation-iteration-count が infinite の要素・動いているアニメーションがない", async ({ page }) => {
    await open(page);
    const infinite = await page.evaluate(() => Array.from(document.querySelectorAll("*")).filter((el) => getComputedStyle(el).animationIterationCount.split(", ").includes("infinite")).length);
    expect(infinite).toBe(0);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length)).toBe(0);
  });
});

test.describe("D-5 空の状態と通信エラー", () => {
  test("空の状態：アイコン（装飾）・一文・主ボタン 1 つだけ", async ({ page }) => {
    await open(page);
    const s = await page.getByTestId("cat-empty").evaluate((el) => ({
      icon: el.querySelectorAll('svg[aria-hidden="true"]').length,
      p: el.querySelectorAll("p").length,
      buttons: el.querySelectorAll("button, a").length,
      primary: el.querySelectorAll('[data-variant="primary"]').length,
      text: el.querySelector("p")?.textContent ?? "",
    }));
    expect(s).toMatchObject({ icon: 1, p: 1, buttons: 1, primary: 1 });
    expect(s.text.length).toBeGreaterThan(0);
    await page.getByTestId("cat-empty").getByRole("button").click();
    await expect(page.getByTestId("cat-states-result")).toContainText("見本");
  });

  test("通信エラー：該当のカードの中に一文と「再読み込み」。画面全体を止めない（ほかの部品は操作できる）。role は付けない", async ({ page }) => {
    await open(page);
    const card = page.getByTestId("cat-error");
    const s = await card.evaluate((el) => ({ isCard: el.classList.contains("sb-card"), role: el.getAttribute("role"), mark: el.querySelectorAll("svg").length, buttons: Array.from(el.querySelectorAll("button")).map((b) => b.textContent?.trim()), h: el.getBoundingClientRect().height, vh: window.innerHeight }));
    expect(s.isCard).toBe(true);
    expect(s.role).toBeNull();
    expect(s.mark).toBe(1);
    expect(s.buttons).toEqual(["再読み込み"]);
    expect(s.h).toBeLessThan(s.vh);
    await card.getByRole("button", { name: "再読み込み" }).click();
    await expect(page.getByTestId("cat-states-result")).toHaveText("再読み込みしました（見本）");
    // 画面全体は止まっていない：ほかの入力欄に入力できる
    await page.getByTestId("cat-input").fill("確認");
    await expect(page.getByTestId("cat-input")).toHaveValue("確認");
  });
});

test.describe("K-15 端末データ・K-5 入れ物の切れ（追加 1）", () => {
  test("見本の操作（入力・チェック・シート・再読み込み）の前後で、端末のストレージの鍵が増えない", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 2600 });
    await open(page);
    const before = await storageKeys(page);
    await page.getByTestId("cat-f-check").fill("試験機");
    await page.getByTestId("cat-f-check-submit").click();
    await page.getByTestId("cat-chk-row-3").click();
    await page.getByTestId("cat-sheet-open").click();
    await page.getByTestId("sheet-expand").click();
    await page.locator("#cat-sheet-field").fill("メモ");
    await page.keyboard.press("Escape");
    await page.getByTestId("cat-error").getByRole("button").click();
    expect(await storageKeys(page)).toBe(before);
  });

  test("見本全体：文字 200%（390・430）で、横スクロール・文字の切れ・入れ物の切れがない", async ({ page }) => {
    await open(page);
    await expectTextZoom(page, "見本（/ops/design）");
  });

  test("入れ物の切れの検査が働く：子だけを持つ入れ物（直接の文字なし）が横に切れていると失敗し、除外の要素なら通る", async ({ page }) => {
    await open(page);
    const inject = (extra: string) =>
      page.evaluate((cls) => {
        document.getElementById("clip-probe")?.remove();
        const box = document.createElement("nav");
        box.id = "clip-probe";
        box.className = cls;
        box.style.cssText = "overflow:hidden;width:100px;display:block";
        const child = document.createElement("div");
        child.style.cssText = "width:400px;height:20px";
        const inner = document.createElement("span");
        inner.textContent = "長い中身";
        child.appendChild(inner);
        box.appendChild(child);
        document.querySelector('[data-testid="design-catalog"]')!.appendChild(box);
      }, extra);
    await inject("");
    await expect(expectTextZoom(page, "入れ物の切れの陰性対照", [390])).rejects.toThrow(/入れ物の切れ/);
    await inject("sb-hero");
    await expectTextZoom(page, "除外（挿絵）", [390]);
  });
});

test.describe("D-1 実画面（公開の `/`）", () => {
  for (const w of [375, 390, 1280]) {
    test(`全入力欄に見えるラベル（上）・高さ 52 以上・角丸 12（${w}px。畳んだ項目を開いた状態）`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 });
      await page.goto(`${MAIN}/`);
      await page.locator(".sb-pill-primary").first().waitFor();
      for (const d of await page.locator("main details").all()) await openDetails(d).catch(() => undefined);
      await waitForSettledStyles(page);
      await expectFields(page, "main", `/ ${w}px`, { minCount: 3 });
    });
  }
});
