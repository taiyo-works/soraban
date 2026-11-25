import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { measureTextZoom, waitForSettledStyles } from "../field-checks";

// Sprint 16-I の E2E-DB（契約 I-1〜I-4。I-5 は既存の点検の E2E が期待値を変えずに通ることで確かめる）。
// 点検の入力（系統の群・チェック行・完了数/総数・未完了へ移る保存）と一覧（カード・状態ラベル）。360 幅と文字 200% の横スクロール 0。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する。サーバーの時計は OPS_TEST_NOW（JST 2027-01-05 12:00）。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const DAY = "2027-01-05";
const at = (hms: string) => new Date(`${DAY}T${hms}+09:00`);
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};

const KEYS = ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"] as const;
const GROUPS = {
  body: ["general", "propeller", "frame"],
  link: ["communication", "autopilot", "controller"],
  power: ["propulsion", "power", "battery"],
} as const;
const LABEL: Record<(typeof KEYS)[number], string> = {
  general: "機体全般",
  propeller: "プロペラ",
  frame: "フレーム",
  communication: "通信系統",
  propulsion: "推進系統",
  power: "電源系統",
  autopilot: "自動制御系統",
  controller: "操縦装置",
  battery: "バッテリー・燃料",
};

let manager: APIRequestContext;
let aircraftId = "";
let mark = "";
let managerPilotId = "";
let pilotId = "";

test.beforeAll(async () => {
  manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  mark = `JU16I${stamp}${seq++}`.slice(0, 20);
  const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "点検の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(ac.status(), await ac.text()).toBe(201);
  aircraftId = ((await ac.json()) as { id: string }).id;
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  pilotId = ((await (await pilot.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
  await pilot.dispose();
  managerPilotId = ((await (await manager.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
});
test.afterAll(async () => {
  await manager.dispose();
});

const form = (page: Page) => page.getByRole("form", { name: "日常点検の入力" });
const group = (page: Page, key: keyof typeof GROUPS) => page.getByTestId(`inspection-group-${key}`);
const item = (page: Page, key: (typeof KEYS)[number]) => page.getByTestId(`inspection-item-${key}`);
const pick = async (page: Page, key: (typeof KEYS)[number], r: "正常" | "異常") =>
  page.getByRole("radiogroup", { name: `${LABEL[key]}の結果` }).getByRole("radio", { name: r }).check();
const openNew = async (page: Page, query = `aircraftId=${aircraftId}`) => {
  await page.goto(`/ops/inspections/new?${query}`);
  await expect(form(page)).toBeVisible();
  await expect(item(page, "general")).toBeVisible();
};

test.describe("16-I 点検の入力", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("I-1. 9 項目が 3 つの系統の群に 1 回ずつ入り、群の見出しに「完了数/総数」。チェック行は 72 以上、結果の選択は 56 以上、記入済みは「済」", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await openNew(page);
    // 群は 3 つ。9 項目がちょうど 1 回ずつ、決めた群に入る
    await expect(page.locator('[data-testid^="inspection-group-"]:not([data-testid$="-count"])')).toHaveCount(3);
    for (const [g, keys] of Object.entries(GROUPS) as [keyof typeof GROUPS, readonly (typeof KEYS)[number][]][]) {
      await expect(group(page, g).locator('[data-testid^="inspection-item-"]')).toHaveCount(3);
      for (const k of keys) await expect(group(page, g).getByTestId(`inspection-item-${k}`)).toHaveCount(1);
      await expect(page.getByTestId(`inspection-group-${g}-count`)).toHaveText("0/3");
      await expect(group(page, g)).toHaveAttribute("open", "");
    }
    await expect(page.locator('[data-testid^="inspection-item-"]')).toHaveCount(9);
    // 項目の名前は変えていない
    for (const k of KEYS) await expect(item(page, k)).toContainText(LABEL[k]);
    // 寸法：行 72 以上、結果の選択（ラベル）56 以上、丸 32
    for (const k of KEYS) {
      const row = await item(page, k).boundingBox();
      expect(row!.height, `${k} の行`).toBeGreaterThanOrEqual(72);
      for (const r of ["正常", "異常"] as const) {
        const lab = page.getByRole("radiogroup", { name: `${LABEL[k]}の結果` }).locator("label", { hasText: r });
        expect((await lab.boundingBox())!.height, `${k} ${r}`).toBeGreaterThanOrEqual(56);
      }
    }
    const radioSize = await item(page, "general").locator("input[type=radio]").first().evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]);
    expect(radioSize).toEqual([32, 32]);
    // 未記入は文字で示し、選ぶと「済」（正常）・「異常」（記号と文字）。完了数が増える
    await expect(page.getByTestId("inspection-mark-general")).toHaveText("未記入");
    await pick(page, "general", "正常");
    await expect(page.getByTestId("inspection-mark-general")).toHaveText("済");
    await expect(page.getByTestId("inspection-mark-general").locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("inspection-group-body-count")).toHaveText("1/3");
    await pick(page, "propeller", "異常");
    await expect(page.getByTestId("inspection-mark-propeller")).toHaveText("異常");
    await expect(page.getByTestId("inspection-mark-propeller").locator("svg")).toHaveCount(1);
    // 異常も「記入済み」に数える（備考の必須はサーバーの規則のまま）
    await expect(page.getByTestId("inspection-group-body-count")).toHaveText("2/3");
    await expect(page.getByTestId("inspection-progress")).toContainText("記入済み 2/9");
    // 「すべて正常」で全部が済になり、各群が 3/3
    await page.getByRole("button", { name: "すべて正常" }).click();
    for (const g of Object.keys(GROUPS)) await expect(page.getByTestId(`inspection-group-${g}-count`)).toHaveText("3/3");
    // 群は折りたためる（見出しを押す）。畳んでも数は変わらない
    await group(page, "link").locator("> summary").click();
    await expect(group(page, "link")).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("inspection-group-link-count")).toHaveText("3/3");
    await expect(item(page, "communication")).toBeHidden();
    await group(page, "link").locator("> summary").click();
    await expect(item(page, "communication")).toBeVisible();
    // 既存の識別子の読み上げ名（ラジオ群の名前）は変わらない
    await expect(page.getByRole("radiogroup", { name: "フレームの結果" })).toHaveCount(1);
  });

  test("I-1. 補足は 14px、本文は 16px 以上（補足は data-note）。端末に新しく保存しない（下書きの鍵は今のまま）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await openNew(page);
    await waitForSettledStyles(page);
    const sizes = await page.evaluate(() => {
      const px = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : -1);
      const f = document.querySelector('form[aria-label="日常点検の入力"]')!;
      return {
        sub: px(document.querySelector("main h1")?.parentElement?.querySelector("p[data-note]") ?? null),
        step: px(f.querySelector('p[data-note][data-testid="inspection-progress"]')),
        missing: px(f.querySelector('[data-testid="inspection-missing-count"]')),
        mark: px(f.querySelector('[data-testid="inspection-mark-general"]')),
        itemName: px(f.querySelector('[data-testid="inspection-item-general"] .font-bold')),
        groupTitle: px(f.querySelector(".sb-chk-title")),
      };
    });
    expect(sizes.sub).toBe(14);
    expect(sizes.step).toBe(14);
    expect(sizes.missing).toBe(14);
    expect(sizes.mark).toBe(14);
    expect(sizes.itemName).toBeGreaterThanOrEqual(16);
    expect(sizes.groupTitle).toBeGreaterThanOrEqual(16);
    // 端末の保存：触れる前後で、鍵は下書き 1 つだけ（未記入の案内などの状態は保存しない）
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await pick(page, "general", "正常");
    const keys = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    for (const k of keys.local) expect(k, "下書き以外の鍵").toMatch(/^soraban:ops-draft:inspection:/);
    expect(keys.session).toEqual([]);
    const draft = await page.evaluate(() => Object.entries(localStorage).map(([, v]) => v).join("\n"));
    expect(draft).not.toContain("showMissing");
    expect(draft).not.toContain("未記入");
  });

  test("I-2. 未完了でも保存は押せ、「未記入 n 項目」を文字で出す。押すと送らずに、畳んだ最初の未完了の群を開き、そこへスクロールしてフォーカスを移す", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await openNew(page);
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/ops/inspections")) posts.push(r.url());
    });
    const save = page.getByRole("button", { name: "保存", exact: true });
    await expect(save).toBeEnabled();
    await expect(page.getByTestId("inspection-missing-count")).toHaveText("未記入 9 項目");
    await form(page).getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
    // 最初の群と 2 番目の群を畳んでから押す：最初の未完了の群（機体）が開き、その最初の項目にフォーカスが移る
    await group(page, "body").locator("> summary").click();
    await group(page, "link").locator("> summary").click();
    await expect(group(page, "body")).not.toHaveAttribute("open", "");
    await save.click();
    await expect(group(page, "body")).toHaveAttribute("open", "");
    await expect(group(page, "link")).not.toHaveAttribute("open", "");
    await expect(page.getByRole("radiogroup", { name: "機体全般の結果" })).toBeFocused();
    await expect(item(page, "general")).toContainText("正常か異常かを選んでください");
    await expect(page.getByRole("radiogroup", { name: "機体全般の結果" })).toHaveAttribute("aria-invalid", "true");
    const inView = async (testId: string) =>
      page.getByTestId(testId).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      });
    expect(await inView("inspection-item-general")).toBe(true);
    expect(posts, "送っていない").toEqual([]);
    expect(page.url()).toContain("/ops/inspections/new");
    // 機体の群を埋めて畳むと、次は通信・制御の群（表示の順で最初の未記入＝通信系統）が開く
    for (const k of GROUPS.body) await pick(page, k, "正常");
    await expect(page.getByTestId("inspection-missing-count")).toHaveText("未記入 6 項目");
    await expect(item(page, "general")).not.toContainText("正常か異常かを選んでください");
    await group(page, "body").locator("> summary").click();
    await save.click();
    await expect(group(page, "link")).toHaveAttribute("open", "");
    await expect(page.getByRole("radiogroup", { name: "通信系統の結果" })).toBeFocused();
    expect(await inView("inspection-item-communication")).toBe(true);
    // 群の中の 1 つだけ埋めると、同じ群の次の未記入へ（表示の順）。動力・電源の群は畳んだままでも、最後に開く
    await pick(page, "communication", "正常");
    await pick(page, "autopilot", "正常");
    await pick(page, "controller", "正常");
    await group(page, "power").locator("> summary").click();
    await expect(group(page, "power")).not.toHaveAttribute("open", "");
    await save.click();
    await expect(group(page, "power")).toHaveAttribute("open", "");
    await expect(page.getByRole("radiogroup", { name: "推進系統の結果" })).toBeFocused();
    expect(posts, "まだ送っていない").toEqual([]);
    // 全部埋まると、今の API で保存できる（サーバーの規則は変えない）
    await expect(page.getByTestId("inspection-missing-count")).toHaveText("未記入 3 項目");
    await pick(page, "propulsion", "正常");
    await pick(page, "power", "正常");
    await pick(page, "battery", "正常");
    await expect(page.getByTestId("inspection-missing-count")).toHaveText("9 項目すべて記入済み");
    await save.click();
    await expect(page).toHaveURL(/\/ops\/inspections\/[0-9a-f-]{36}$/);
    expect(posts).toHaveLength(1);
  });

  test("I-2. 異常で備考なしの保存は、今のサーバーの検証の誤りが、畳んだ群の中でも開いて示される", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await openNew(page);
    await form(page).getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
    await page.getByRole("button", { name: "すべて正常" }).click();
    await pick(page, "controller", "異常");
    await group(page, "link").locator("> summary").click();
    await expect(group(page, "link")).not.toHaveAttribute("open", "");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(group(page, "link")).toHaveAttribute("open", "");
    await expect(item(page, "controller").locator(".sb-field-error")).toContainText("備考を入力してください");
    await expect(item(page, "controller").getByLabel("操縦装置の備考")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/ops\/inspections\/new/);
  });

  test("I-3. 日誌から移ったとき、離陸より後の実施日時の注記は、実施日時の欄のすぐ下にあり、375×812 の最初の画面に全体が入る", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.clock.setFixedTime(at("11:30:00"));
    await openNew(page, `aircraftId=${aircraftId}&takeoffAt=${DAY}T11:00`);
    const note = page.getByTestId("inspection-after-takeoff");
    await expect(note).toBeVisible();
    await expect(note).toContainText("離陸（11:00）より後");
    await expect(note).toContainText("飛行前点検として扱いません");
    await waitForSettledStyles(page);
    const dt = (await page.getByTestId("inspected").boundingBox())!;
    const n = (await note.boundingBox())!;
    // すぐ下：実施日時の欄の下端と注記の上端の間が 24px 以内で、注記は欄の後ろ
    expect(n.y, "注記は実施日時の欄の下").toBeGreaterThanOrEqual(dt.y + dt.height - 1);
    expect(n.y - (dt.y + dt.height), "実施日時の欄と注記の間").toBeLessThanOrEqual(24);
    // 区分の選択は注記より後
    const timing = (await page.getByRole("radio", { name: "飛行前", exact: true }).first().boundingBox())!;
    expect(timing.y).toBeGreaterThan(n.y);
    // 最初の画面（スクロールなし）に注記の全体が入る
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);
    expect(n.y + n.height, `注記の下端 ${n.y + n.height} は 812 以内`).toBeLessThanOrEqual(812);
    // 実施日時を離陸より前に直すと注記は消える（今までと同じ）
    await form(page).getByLabel("実施時刻", { exact: true }).fill("10:50");
    await expect(note).toHaveCount(0);
  });
});

test.describe("16-I 横スクロール 0（360 幅・文字 200%）", () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  test("360 幅：点検の入力（「異常」の行と備考を開いた状態を含む）と点検の一覧は横スクロール 0。文字 200% でも 0 で、文字の切れ 0", async ({ page }) => {
    // 一覧に出る記録を作る
    await signIn(page.request, seeded("a-manager"));
    const r = await manager.post("/api/ops/inspections", {
      data: { aircraftId, pilotId, inspectedAt: `${DAY}T09:00`, timing: "pre_flight", placeName: "本社 駐車場", items: { ...Object.fromEntries(KEYS.map((k) => [k, { result: "normal" }])), frame: { result: "abnormal", note: "塗装のはがれを確認し、処置した" } } },
    });
    expect(r.status(), await r.text()).toBe(201);

    const noScroll = async (label: string) => {
      const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
      expect(m.s, `${label} の横スクロール（${m.s} > ${m.c}）`).toBeLessThanOrEqual(m.c);
    };
    await openNew(page);
    await page.getByRole("button", { name: "すべて正常" }).click();
    await pick(page, "frame", "異常");
    await pick(page, "battery", "異常");
    await item(page, "frame").getByLabel("フレームの備考").fill("塗装のはがれを確認し、処置した長い備考の文章を入れて幅を確かめる");
    await waitForSettledStyles(page);
    await noScroll("点検の入力 360・100%");
    const z = await measureTextZoom(page, 360);
    expect(z.scrollWidth, `点検の入力 360・200%（${z.scrollWidth} > ${z.clientWidth}）`).toBeLessThanOrEqual(z.clientWidth);
    expect(z.clipped, "文字の切れ").toEqual([]);
    expect(z.clippedContainers, "入れ物の切れ").toEqual([]);
    expect(z.unscaled, "200% で大きくならない文字").toEqual([]);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });

    await page.goto("/ops/inspections");
    await expect(page.getByTestId("inspection-list")).toBeVisible();
    await noScroll("点検の一覧 360・100%");
    const zl = await measureTextZoom(page, 360);
    expect(zl.scrollWidth, `点検の一覧 360・200%（${zl.scrollWidth} > ${zl.clientWidth}）`).toBeLessThanOrEqual(zl.clientWidth);
    expect(zl.clipped, "一覧の文字の切れ").toEqual([]);
    expect(zl.clippedContainers, "一覧の入れ物の切れ").toEqual([]);
  });
});

test.describe("16-I 点検の一覧", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("I-4. 一覧のカード（72 以上・全体が押せる・見出し→主情報→補足）と状態ラベル（点検済み＝安全、異常あり＝危険）。主ボタンは「点検を記録」1 つ", async ({ page }) => {
    const normalMark = `JU16IN${stamp}${seq++}`.slice(0, 20);
    const abnormalMark = `JU16IA${stamp}${seq++}`.slice(0, 20);
    const mk = async (registrationMark: string) => {
      const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark, modelName: "点検の試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
      expect(ac.status(), await ac.text()).toBe(201);
      return ((await ac.json()) as { id: string }).id;
    };
    const normalAc = await mk(normalMark);
    const abnormalAc = await mk(abnormalMark);
    const ok = await manager.post("/api/ops/inspections", { data: { aircraftId: normalAc, pilotId, inspectedAt: `${DAY}T08:00`, timing: "pre_flight", placeName: "本社", items: Object.fromEntries(KEYS.map((k) => [k, { result: "normal" }])) } });
    expect(ok.status(), await ok.text()).toBe(201);
    const bad = await manager.post("/api/ops/inspections", { data: { aircraftId: abnormalAc, pilotId, inspectedAt: `${DAY}T08:10`, timing: "post_flight", placeName: "本社", items: { ...Object.fromEntries(KEYS.map((k) => [k, { result: "normal" }])), propeller: { result: "abnormal", note: "欠け" } } } });
    expect(bad.status(), await bad.text()).toBe(201);
    // 今日の飛行前の点検がない計画（未実施のカード）
    const plan = await manager.post("/api/ops/plans", { data: { title: `未実施のカード ${stamp}`, aircraftId, pilotId: managerPilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
    expect(plan.status(), await plan.text()).toBe(201);

    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/inspections");
    await expect(page.getByTestId("inspection-list")).toBeVisible();
    await waitForSettledStyles(page);

    // 主ボタンは「点検を記録」の 1 つ（見える主ボタンの数）
    const primaries = await page.locator("main .sb-pill-primary").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => (e.textContent ?? "").trim()));
    expect(primaries).toEqual(["点検を記録"]);
    await expect(page.getByTestId("inspection-new")).toHaveAttribute("href", "/ops/inspections/new");
    expect((await page.getByTestId("inspection-new").boundingBox())!.height).toBeGreaterThanOrEqual(56);

    const rowOf = (m: string) => page.locator('[data-testid="inspection-row"]', { hasText: m });
    // 点検済み＝安全、異常あり＝危険（記号と文字。色だけに頼らない）
    const okRow = rowOf(normalMark);
    await expect(okRow).toHaveCount(1);
    await expect(okRow.locator('[data-tone="safe"]')).toHaveText("点検済み");
    await expect(okRow.locator('[data-tone="safe"] svg')).toHaveCount(1);
    await expect(okRow.locator('[data-tone="danger"]')).toHaveCount(0);
    const badRow = rowOf(abnormalMark);
    await expect(badRow).toHaveCount(1);
    await expect(badRow.locator('[data-tone="danger"]')).toHaveText("異常あり");
    await expect(badRow.locator('[data-tone="danger"] svg')).toHaveCount(1);
    await expect(badRow.locator('[data-tone="safe"]')).toHaveCount(0);
    await expect(badRow).toContainText("飛行後");
    // 一覧のカード：全体が押せる 1 つのリンク・高さ 72 以上・カードの部品（面・角丸）・右端の矢印・中は 3 段
    for (const row of [okRow, badRow]) {
      expect(await row.evaluate((e) => e.tagName)).toBe("A");
      expect(await row.getAttribute("href")).toMatch(/^\/ops\/inspections\/[0-9a-f-]{36}$/);
      const g = await row.evaluate((e) => {
        const cs = getComputedStyle(e);
        const text = e.querySelector(".sb-card-list-text")!;
        return { h: e.getBoundingClientRect().height, radius: parseFloat(cs.borderTopLeftRadius), classes: e.className, tiers: text.children.length, arrow: e.querySelectorAll("svg.sb-card-list-arrow").length };
      });
      expect(g.h).toBeGreaterThanOrEqual(72);
      expect(g.radius).toBeGreaterThanOrEqual(16);
      expect(g.classes).toContain("sb-card-list");
      expect(g.tiers).toBe(3);
      expect(g.arrow).toBe(1);
    }
    // 押すと詳細へ
    await Promise.all([page.waitForURL(/\/ops\/inspections\/[0-9a-f-]{36}$/), okRow.click()]);
    await page.goBack();

    // 未実施のカード：状態ラベル「未実施」・カード全体が点検の入力へのリンク
    const pending = page.locator('[data-testid="inspection-pending-row"]', { hasText: `未実施のカード ${stamp}` });
    await expect(pending).toHaveCount(1);
    await expect(pending.locator('[data-tone="info"]')).toHaveText("未実施");
    const link = pending.getByTestId("inspection-pending-link");
    expect(await link.evaluate((e) => e.tagName)).toBe("A");
    await expect(link).toHaveAttribute("href", /^\/ops\/inspections\/new\?planId=/);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(72);
    // 補足は 14px（data-note）、主情報は 16px 以上
    const sizes = await okRow.evaluate((e) => ({ note: parseFloat(getComputedStyle(e.querySelector("[data-note]")!).fontSize), main: parseFloat(getComputedStyle(e.querySelector(".font-bold")!).fontSize) }));
    expect(sizes.note).toBe(14);
    expect(sizes.main).toBeGreaterThanOrEqual(16);
  });
});
