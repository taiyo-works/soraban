import { expect, request as pwRequest, test, type Locator, type Page } from "@playwright/test";
import { waitForSettledStyles } from "../field-checks";

// Sprint 16-N2（N-3）：公開の `/` と運航管理 `/ops` の一貫性。同じ役割の部品（地・本文・主ボタン・副ボタン・入力欄・判定の札・フォーカスの輪）の
// 計算されたスタイルが一致する。現場（…/field）は、色以外の形（角丸・太さ・字形）が同じで、寸法と線の太さだけ大きい（値は 7:1 のために色も濃くなる）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する（同じサーバーが `/` も配る。署名前の `/` は公開の画面）。
const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
let planId = "";

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  expect(r.status()).toBe(200);
  const a = await ctx.post("/api/ops/aircraft", {
    data: { registrationMark: `JUN2${stamp}`, modelName: "一貫性試験機", manufacturer: "DJI", serialNumber: `SN-N2${stamp}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(a.status(), await a.text()).toBe(201);
  const aircraftId = ((await a.json()) as { id: string }).id;
  const p = await ctx.post("/api/ops/pilots", { data: { fullName: `一貫 操縦${stamp}`, hasLicense: false } });
  expect(p.status(), await p.text()).toBe(201);
  const pilotId = ((await p.json()) as { id: string }).id;
  const pl = await ctx.post("/api/ops/plans", {
    data: { title: `N2 ${stamp}`, aircraftId, pilotId, plannedStartAt: "2027-01-05T13:00", durationMinutes: 60, purpose: "一貫性の確認", placeName: "試験地点", latitude: 35.38, longitude: 133.35, flags: ["method_night"] },
  });
  expect(pl.status(), await pl.text()).toBe(201);
  planId = ((await pl.json()) as { id: string }).id;
  await ctx.dispose();
});

const signIn = async (page: Page): Promise<void> => {
  const r = await page.request.post("/api/test-auth/sign-in", { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  expect(r.status()).toBe(200);
};

type Style = Readonly<Record<string, string>>;
const read = (loc: Locator, props: readonly string[]): Promise<Style> =>
  loc.evaluate((el, ps) => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]));
  }, props as string[]);

/** 地図の読み込みなど外部の取得は止める（成否で絵・時間が揺れないように）。 */
const blockExternal = async (page: Page): Promise<void> => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
};

/** 何も指定しない段落（本文の基本）を main に足して、その計算されたスタイルを読む（画面ごとの補足・注記の役割と混ざらないように）。 */
const probeParagraph = async (page: Page): Promise<Style> =>
  page.locator("main").first().evaluate((main, ps) => {
    const p = document.createElement("p");
    p.textContent = "本文の段落";
    main.appendChild(p);
    const cs = getComputedStyle(p);
    const out = Object.fromEntries(ps.map((k) => [k, cs.getPropertyValue(k)]));
    p.remove();
    return out;
  }, TEXT_PROPS as unknown as string[]);

const BUTTON_PROPS = ["background-color", "color", "border-top-color", "border-top-width", "border-top-style", "border-radius", "font-size", "font-weight", "min-height", "box-shadow"] as const;
const FOCUS_PROPS = ["outline-width", "outline-style", "outline-color", "outline-offset"] as const;
const TEXT_PROPS = ["color", "font-size", "line-height", "font-weight"] as const;
const INPUT_PROPS = ["background-color", "color", "border-top-color", "border-top-width", "border-top-style", "border-radius", "font-size", "min-height"] as const;
const TAG_SHAPE_PROPS = ["border-radius", "font-size", "font-weight", "padding-top", "padding-left", "display"] as const;
const TAG_COLOR_PROPS = ["background-color", "color", "border-top-color", "border-top-width"] as const;

type Sample = {
  readonly body: Style;
  readonly para: Style;
  readonly primary: Style;
  readonly primaryFocus: Style;
  readonly secondary: Style;
  readonly input: Style;
  readonly tags: Readonly<Record<string, { shape: Style; color: Style }>>;
};

const tagsOf = async (page: Page): Promise<Sample["tags"]> => {
  const out: Record<string, { shape: Style; color: Style }> = {};
  const all = page.locator("[data-verdict-key].sb-vtag:visible");
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const t = all.nth(i);
    const key = (await t.getAttribute("data-verdict-key"))!;
    if (!(key in out)) out[key] = { shape: await read(t, TAG_SHAPE_PROPS), color: await read(t, TAG_COLOR_PROPS) };
  }
  return out;
};

test.describe("N-3 `/` と `/ops` の一貫性", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("同じ役割の部品（地・本文・主ボタン・副ボタン・入力欄・判定の札・フォーカスの輪）の計算されたスタイルが `/` と `/ops` で一致する", async ({ page }) => {
    await blockExternal(page);
    // 公開の `/`
    await page.goto("/");
    await expect(page.getByTestId("verdict-conclusion")).toBeVisible({ timeout: 60_000 });
    await waitForSettledStyles(page);
    const pubPrimary = page.locator('main button[data-variant="primary"]').first();
    await pubPrimary.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const pub: Sample = {
      body: await read(page.locator("body"), ["background-color", "color"]),
      para: await probeParagraph(page),
      primary: await read(pubPrimary, BUTTON_PROPS),
      primaryFocus: await read(pubPrimary, FOCUS_PROPS),
      secondary: await read(page.getByTestId("current-location-button"), BUTTON_PROPS),
      input: await read(page.locator("#address-input"), INPUT_PROPS),
      tags: await tagsOf(page),
    };

    // 運航管理：ホーム（主ボタン・副ボタン・本文）、機体の新規（入力欄）、判定の画面（判定の札）
    await signIn(page);
    await page.goto("/ops");
    await expect(page.getByTestId("today-heading")).toBeVisible();
    await waitForSettledStyles(page);
    const opsPrimary = page.locator('main [data-variant="primary"]:visible').first();
    await opsPrimary.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const home: Omit<Sample, "secondary" | "input" | "tags"> = {
      body: await read(page.locator("body"), ["background-color", "color"]),
      para: await probeParagraph(page),
      primary: await read(opsPrimary, BUTTON_PROPS),
      primaryFocus: await read(opsPrimary, FOCUS_PROPS),
    };
    await page.goto("/ops/aircraft/new");
    await waitForSettledStyles(page);
    const input = await read(page.locator("main input.sb-input:visible").first(), INPUT_PROPS);
    // 副ボタン：利用者メニューの「ログアウト」（共通のボタン .opx-btn の副。16-N2 で旧い部品から替えた）
    await page.goto("/ops");
    await page.getByTestId("user-menu-button").first().click();
    const secondary = await read(page.getByTestId("signout"), BUTTON_PROPS);
    await page.goto(`/ops/plans/${planId}/judgement`);
    await expect(page.getByTestId("verdict-conclusion")).toBeVisible();
    await waitForSettledStyles(page);
    const ops: Sample = { ...home, secondary, input, tags: await tagsOf(page) };
    expect(Object.keys(pub.tags).length, "`/` に判定の札がある").toBeGreaterThan(0);
    expect(Object.keys(ops.tags).length, "`/ops/.../judgement` に判定の札がある").toBeGreaterThan(0);

    // 役割ごとに、`/` と `/ops` の計算されたスタイルが同じ（ソフトな検査：1 つ崩れても残りも確かめる）
    expect.soft(ops.body, "地").toEqual(pub.body);
    expect.soft(ops.para, "本文").toEqual(pub.para);
    expect.soft(ops.primary, "主ボタン").toEqual(pub.primary);
    expect.soft(ops.secondary, "副ボタン").toEqual(pub.secondary);
    expect.soft(ops.input, "入力欄").toEqual(pub.input);
    const shapes = (x: Sample): string[] => [...new Set(Object.values(x.tags).map((t) => JSON.stringify(t.shape)))];
    expect.soft(shapes(pub), "判定の札の形（`/`。段によらず同じ）").toHaveLength(1);
    expect.soft(shapes(ops), "判定の札の形（/ops。`/` と同じ）").toEqual(shapes(pub));
    // 重ならない計画では比較が 0 回になり、色の差を見逃す。比べる段（needs）を名指しで固定し、重なる段が 1 以上あることを確かめる（16-N2 レビュー R-1）
    const overlap = Object.keys(pub.tags).filter((k) => k in ops.tags);
    expect(overlap.length, `判定の札の色：\`/\` と \`/ops\` で重なる段（${overlap.join("・") || "なし"}）が 1 以上`).toBeGreaterThanOrEqual(1);
    expect(overlap, "判定の札の色：比べる段 needs が両方にある").toContain("needs");
    for (const key of overlap) expect.soft(ops.tags[key]!.color, `判定の札の色（段 ${key}）`).toEqual(pub.tags[key]!.color);
    expect.soft(pub.primaryFocus["outline-style"], "フォーカスの輪（`/`）は実線").toBe("solid");
    expect.soft(ops.primaryFocus, "フォーカスの輪").toEqual(pub.primaryFocus);
  });
});

test.describe("N-3 現場は色以外の形が同じで、寸法と線の太さだけ大きい", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("主ボタン：角丸・太さ・字形が通常と同じ。高さと文字は通常以上（64 以上）", async ({ page }) => {
    await blockExternal(page);
    await signIn(page);
    await page.clock.setFixedTime(new Date("2027-01-05T11:56:00+09:00"));
    await page.goto("/ops");
    await waitForSettledStyles(page);
    const normal = await read(page.locator('main [data-variant="primary"]:visible').first(), BUTTON_PROPS);
    await page.goto(`/ops/plans/${planId}/field`);
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await waitForSettledStyles(page);
    const field = await read(page.locator('[data-variant="primary"]:visible').first(), BUTTON_PROPS);
    expect(field["border-radius"]).toBe(normal["border-radius"]);
    expect(field["font-weight"]).toBe(normal["font-weight"]);
    expect(field["box-shadow"]).toBe("none");
    expect(parseFloat(field["min-height"]!)).toBeGreaterThanOrEqual(64);
    expect(parseFloat(field["font-size"]!)).toBeGreaterThanOrEqual(parseFloat(normal["font-size"]!));
    expect(parseFloat(field["border-top-width"]!)).toBeGreaterThanOrEqual(parseFloat(normal["border-top-width"]!));
    expect(field["color"]).toBe(normal["color"]);
  });
});
