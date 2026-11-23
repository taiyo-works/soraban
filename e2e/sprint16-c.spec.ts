import { expect, test, type Page } from "@playwright/test";
import { expectTextZoom, waitForSettledStyles } from "./field-checks";

// Sprint 16-C の E2E（DB なし）：部品 1（ボタン 5 種・カード 3 種・状態ラベル）。契約 C-1・C-3・C-4・C-6、K-7・K-8。
// 見本（/ops/design）は DESIGN_CATALOG=1 の 2 台目だけが表示する。`/` は 1 台目。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

const WHITE = "rgb(255, 255, 255)";
const SUNKEN = "rgb(238, 241, 245)";
const INK = "rgb(20, 24, 31)";
const PRIMARY = "rgb(31, 95, 224)";
const PRIMARY_PRESS = "rgb(28, 86, 207)";
const FIELD_PRIMARY = "rgb(24, 72, 176)";
const EDGE = "rgb(107, 117, 134)";
const INK_DISABLED = "rgb(138, 147, 161)";
const DANGER_TEXT = "rgb(138, 26, 18)";
const SURFACE = WHITE;

const open = async (page: Page, query = ""): Promise<void> => {
  await page.goto(`${CATALOG}/ops/design${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("design-catalog")).toBeVisible();
  await waitForSettledStyles(page);
};

type BtnStyle = { bg: string; color: string; h: number; radius: string; fw: string; fs: string; bw: string; bs: string; bc: string };
const btnStyle = (page: Page, id: string): Promise<BtnStyle> =>
  page.getByTestId(id).evaluate((el) => {
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, color: c.color, h: el.getBoundingClientRect().height, radius: c.borderTopLeftRadius, fw: c.fontWeight, fs: c.fontSize, bw: c.borderTopWidth, bs: c.borderTopStyle, bc: c.borderTopColor };
  });

for (const [prefix, label] of [["cat-", "`/` 系（.sb-pill）"], ["cat-opx-", "`/ops` 系（.opx-btn）"]] as const) {
  test.describe(`C-1 ボタン 5 種：${label}`, () => {
    test(`通常：主・副・文字・危険・無効の計算されたスタイル（${prefix}）`, async ({ page }) => {
      await open(page);
      const primary = await btnStyle(page, `${prefix}primary`);
      expect(primary.bg).toBe(PRIMARY);
      expect(primary.color).toBe(WHITE);
      expect(primary.h).toBeGreaterThanOrEqual(55.5);
      expect(primary.radius).toBe("12px");
      expect(primary.fw).toBe("600");

      const secondary = await btnStyle(page, `${prefix}secondary`);
      expect(secondary.bg).toBe(SUNKEN);
      expect(secondary.color).toBe(INK);
      expect(secondary.bc).toBe(EDGE);
      expect(secondary.bw).toBe("1px");
      expect(secondary.bs).toBe("solid");
      expect(secondary.h).toBeGreaterThanOrEqual(47.5);
      expect(secondary.radius).toBe("12px");

      const text = await btnStyle(page, `${prefix}text`);
      expect(text.bg).toBe("rgba(0, 0, 0, 0)");
      expect(text.color).toBe(PRIMARY);
      expect(text.h).toBeGreaterThanOrEqual(47.5);
      expect(text.h).toBeLessThan(56);

      const danger = await btnStyle(page, `${prefix}danger`);
      expect(danger.bg).toBe(SUNKEN);
      expect(danger.color).toBe(DANGER_TEXT);
      expect(danger.bc).toBe(EDGE);
      expect(danger.h).toBeGreaterThanOrEqual(47.5);

      const disabled = await btnStyle(page, `${prefix}disabled`);
      expect(disabled.bg).toBe(SUNKEN);
      expect(disabled.color).toBe(INK_DISABLED);
      expect(disabled.bs).toBe("dashed"); // 色だけに頼らない
      expect(disabled.h).toBeGreaterThanOrEqual(47.5);
      await expect(page.getByTestId(`${prefix}disabled`)).toBeDisabled();
    });

    test(`無効の理由：ボタンの下に 1 行（${prefix}disabled-reason）。aria-describedby で結ぶ。補足の文字 14px 以上`, async ({ page }) => {
      await open(page);
      const reason = page.getByTestId(`${prefix}disabled-reason`);
      await expect(reason).toBeVisible();
      expect((await reason.textContent())?.trim().length).toBeGreaterThan(0);
      const geo = await page.evaluate((p) => {
        const b = document.querySelector<HTMLElement>(`[data-testid="${p}disabled"]`)!;
        const r = document.querySelector<HTMLElement>(`[data-testid="${p}disabled-reason"]`)!;
        return { describedby: b.getAttribute("aria-describedby"), rid: r.id, bBottom: b.getBoundingClientRect().bottom, rTop: r.getBoundingClientRect().top, fs: parseFloat(getComputedStyle(r).fontSize) };
      }, prefix);
      expect(geo.describedby).toBe(geo.rid);
      expect(geo.rTop).toBeGreaterThanOrEqual(geo.bBottom - 1);
      expect(geo.fs).toBeGreaterThanOrEqual(14);
    });

    test(`押下：主ボタンは --sb-primary-press に濃くなり scale(.98)、120ms（${prefix}primary）`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 2600 }); // 見本は縦に長いので、全体が画面に入る高さにする
      await open(page);
      const btn = page.getByTestId(`${prefix}primary`);
      const dur = await btn.evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(dur).toBe("0.18s, 0.12s"); // 背景 180ms・押下の縮み 120ms（--sb-dur-press）
      await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const box = (await btn.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect.poll(() => btn.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(PRIMARY_PRESS);
      await expect.poll(() => btn.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(0\.98, 0, 0, 0\.98, /);
      await page.mouse.up();
      await page.mouse.move(0, 0);
    });

    test(`現場：主ボタン 64px 以上・濃い主色。副・文字・危険・無効は 56px 以上（${prefix}）`, async ({ page }) => {
      await open(page, "mode=field");
      const primary = await btnStyle(page, `${prefix}primary`);
      expect(primary.bg).toBe(FIELD_PRIMARY);
      expect(primary.h).toBeGreaterThanOrEqual(63.5);
      for (const k of ["secondary", "text", "danger", "disabled"]) expect((await btnStyle(page, `${prefix}${k}`)).h, k).toBeGreaterThanOrEqual(55.5);
    });
  });
}

test.describe("C-2 `/` と `/ops` の主ボタンは同じ計算スタイル（見本の上で比べる。実画面の比較は sprint16-c-db）", () => {
  test("面・文字・高さ・角丸・太さ・縁が一致する。丸と矢印の疑似要素・子要素がない", async ({ page }) => {
    await open(page);
    const a = await btnStyle(page, "cat-primary");
    const b = await btnStyle(page, "cat-opx-primary");
    expect(a).toEqual(b);
    for (const id of ["cat-primary", "cat-opx-primary"]) {
      const deco = await page.getByTestId(id).evaluate((el) => ({ before: getComputedStyle(el, "::before").content, after: getComputedStyle(el, "::after").content, svgs: el.querySelectorAll("svg").length, arrow: el.querySelectorAll(".sb-pill-arrow").length }));
      expect(deco.before, id).toMatch(/^(none|normal)$/);
      expect(deco.after, id).toMatch(/^(none|normal)$/);
      expect(deco.svgs, id).toBe(0);
      expect(deco.arrow, id).toBe(0);
    }
  });
});

test.describe("C-3 カード 3 種", () => {
  test("通常：白い面・角丸 16・1px の罫（inset）・内側 16。影なし", async ({ page }) => {
    await open(page);
    const s = await page.getByTestId("cat-card").evaluate((el) => {
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, r: c.borderTopLeftRadius, pad: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft], shadow: c.boxShadow };
    });
    expect(s.bg).toBe(SURFACE);
    expect(s.r).toBe("16px");
    expect(s.pad).toEqual(["16px", "16px", "16px", "16px"]);
    expect(s.shadow).toBe("rgb(225, 229, 235) 0px 0px 0px 1px inset");
  });

  test("一覧：最小の高さ 72・カード全体がリンク・中は見出し→主情報→補足の 3 段まで", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2600 });
    await open(page);
    const card = page.getByTestId("cat-card-list");
    const s = await card.evaluate((el) => ({ tag: el.tagName, h: el.getBoundingClientRect().height, minH: getComputedStyle(el).minHeight, children: el.children.length, href: el.getAttribute("href") }));
    expect(s.tag).toBe("A");
    expect(s.href).toBeTruthy();
    expect(s.h).toBeGreaterThanOrEqual(72);
    expect(s.minH).toBe("72px");
    expect(s.children).toBeLessThanOrEqual(3);
    // カードのどこを押しても押せる（四隅の内側の点が、そのリンクを指す）
    await card.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    const box = (await card.boundingBox())!;
    for (const [dx, dy] of [[8, 8], [box.width - 8, 8], [8, box.height - 8], [box.width - 8, box.height - 8]] as const) {
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="cat-card-list"]') !== null, [box.x + dx, box.y + dy] as const);
      expect(hit).toBe(true);
    }
  });

  test("判定・状態：状態の面＋左端 6px の状態の印の色の帯。帯は角丸に沿って切る", async ({ page }) => {
    await open(page);
    const s = await page.getByTestId("cat-card-state").evaluate((el) => {
      const c = getComputedStyle(el);
      const b = getComputedStyle(el, "::before");
      return { bg: c.backgroundColor, overflow: c.overflow, r: c.borderTopLeftRadius, bw: b.width, bbg: b.backgroundColor, bpos: b.position, bleft: b.left };
    });
    expect(s.bg).toBe("rgb(253, 241, 220)"); // --sb-st-warn-face
    expect(s.bbg).toBe("rgb(154, 91, 0)"); // --sb-st-warn-mark
    expect(s.bw).toBe("6px");
    expect(s.bpos).toBe("absolute");
    expect(s.bleft).toBe("0px");
    expect(s.overflow).toBe("hidden"); // 帯が角丸に沿って切れる
    expect(s.r).toBe("16px");
  });
});

test.describe("C-4 状態ラベル（K-7：記号＋文字）", () => {
  const TONES = [
    ["info", "待機中", "rgb(234, 238, 243)", "rgb(63, 75, 94)"],
    ["flying", "飛行中", "rgb(225, 242, 248)", "rgb(8, 80, 106)"],
    ["safe", "飛行済", "rgb(230, 244, 236)", "rgb(14, 90, 53)"],
    ["danger", "中止", "rgb(253, 232, 230)", "rgb(138, 26, 18)"],
  ] as const;

  for (const [tone, word, face, text] of TONES) {
    test(`${word}（${tone}）：高さ 28 以上・左右 10・角丸 999・14px/600・先頭に 8px の丸（aria-hidden）と文字。丸と文字の縦の中心が ±1px`, async ({ page }) => {
      await open(page);
      const r = await page.getByTestId(`cat-state-${tone}`).evaluate((el) => {
        const c = getComputedStyle(el);
        const dot = el.querySelector<HTMLElement>(".sb-state-dot")!;
        const label = el.lastElementChild as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(label);
        const tr = range.getBoundingClientRect();
        const dr = dot.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        return {
          h: er.height, padL: c.paddingLeft, padR: c.paddingRight, radius: parseFloat(c.borderTopLeftRadius), fs: c.fontSize, fw: c.fontWeight, bg: c.backgroundColor, color: c.color,
          dotW: dr.width, dotH: dr.height, dotHidden: dot.getAttribute("aria-hidden"), dotBg: getComputedStyle(dot).backgroundColor, dotFirst: el.firstElementChild === dot,
          text: (label.textContent ?? "").trim(), dy: Math.abs((dr.top + dr.height / 2) - (tr.top + tr.height / 2)), dyBox: Math.abs((dr.top + dr.height / 2) - (er.top + er.height / 2)),
        };
      });
      expect(r.h).toBeGreaterThanOrEqual(27.5);
      expect(r.padL).toBe("10px");
      expect(r.padR).toBe("10px");
      expect(r.radius).toBeGreaterThanOrEqual(999);
      expect(r.fs).toBe("14px");
      expect(r.fw).toBe("600");
      expect(r.bg).toBe(face);
      expect(r.color).toBe(text);
      expect(r.dotW).toBe(8);
      expect(r.dotH).toBe(8);
      expect(r.dotHidden).toBe("true");
      expect(r.dotFirst).toBe(true);
      expect(r.text).toBe(word);
      expect(r.dy, "丸と文字の縦の中心（許容 ±1px）").toBeLessThanOrEqual(1);
      expect(r.dyBox, "丸と枠の縦の中心").toBeLessThanOrEqual(1);
    });
  }

  test("押せるラベル：見た目は 28px のまま、当たり判定は 48px 以上（上下の 20px 外でも押せる）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2600 });
    await open(page);
    const link = page.getByTestId("cat-state-link");
    await link.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    const box = (await link.boundingBox())!;
    expect(box.height).toBeLessThan(40);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (const dy of [-22, 22]) {
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y) === document.querySelector('[data-testid="cat-state-link"]') || document.querySelector('[data-testid="cat-state-link"]')!.contains(document.elementFromPoint(x, y)), [cx, cy + dy] as const);
      expect(hit, `中心から ${dy}px`).toBe(true);
    }
  });

  test("色なし（グレースケール）でも 4 つは文字で区別できる：各ラベルは空でない文字を持ち、4 つとも文字が違う", async ({ page }) => {
    await open(page);
    const words = await page.locator(".sb-state").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    expect(words.length).toBeGreaterThanOrEqual(4);
    for (const w of words) expect(w.length).toBeGreaterThan(0);
    expect(new Set(words.slice(0, 4)).size).toBe(4);
  });
});

test.describe("C-6 / K-8 主ボタンは 1 画面に 1 つ", () => {
  test("`/`（初期の状態）：見えている data-variant=\"primary\" は 1 つ（375・390・1280）", async ({ page }) => {
    for (const w of [375, 390, 1280]) {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 });
      await page.goto(`${MAIN}/`);
      await page.locator(".sb-pill-primary").first().waitFor();
      const n = await page.locator('[data-variant="primary"]:visible').count();
      expect(n, `${w}px`).toBe(1);
      // data-variant を持たない主ボタン（クラスだけ）は無い
      const stray = await page.locator(".sb-pill-primary:not([data-variant])").count();
      expect(stray).toBe(0);
    }
  });

  test("`/`：文字 200% でも主ボタンに届き、横スクロール・文字の切れがない（未ログイン）", async ({ page }) => {
    await page.goto(`${MAIN}/`);
    await page.locator(".sb-pill-primary").first().waitFor();
    await expectTextZoom(page, "/（16-C）");
  });
});
