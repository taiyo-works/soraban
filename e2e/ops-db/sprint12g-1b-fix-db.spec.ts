import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "../field-checks";
import { expandNextActions, openUserMenu } from "../ops-menu";

// Sprint 12g-1b 段階 A の差し戻し（独立評価の指摘 I-2・I-3・M-1〜M-8・M-11）の E2E-DB。組織B で確かめる。
// サーバーの現在時刻は OPS_TEST_NOW（JST 2027-01-05 12:00）。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const DAY = "2027-01-05";
const stamp = Date.now().toString(36).toUpperCase();

type Who = { authUserId: string; email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};
const apiAs = async (who: Who): Promise<APIRequestContext> => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await signIn(ctx, who);
  return ctx;
};

type TodayJson = { card: { planId: string } | null; rest: { planId: string }[]; upcoming: { planId: string }[] };
const getToday = async (ctx: APIRequestContext): Promise<TodayJson> => (await (await ctx.get("/api/ops/today")).json()) as TodayJson;
const voidPlan = async (ctx: APIRequestContext, id: string): Promise<void> => {
  const plan = (await (await ctx.get(`/api/ops/plans/${id}`)).json()) as { version: number; voided: boolean };
  if (!plan.voided) await ctx.post(`/api/ops/plans/${id}/void`, { data: { expectedVersion: plan.version, reason: "試験の後始末" } });
};
const clearPlans = async (ctx: APIRequestContext): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    const t = await getToday(ctx);
    const ids = [...(t.card ? [t.card.planId] : []), ...t.rest.map((r) => r.planId), ...t.upcoming.map((u) => u.planId)];
    if (ids.length === 0) return;
    for (const id of ids) await voidPlan(ctx, id);
  }
};
/** 組織B に利用者を招く（役割だけ違う。操縦者の行には結び付けない）。ログインすると結び付く。 */
const inviteMember = async (bm: APIRequestContext, role: "viewer" | "pilot", key: string): Promise<Who> => {
  const who = seeded(`${key}-${stamp.toLowerCase()}`);
  const r = await bm.post("/api/ops/members", { data: { email: who.email, displayName: `${key} ${stamp}`, role } });
  expect(r.status(), await r.text()).toBe(201);
  return who;
};

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test.describe("Sprint 12g-1b A 差し戻し：利用者メニューのフォーカス・スキップリンク・題名・空の日・余白・次にやること・日付・戻りリンク", () => {
  test("I-2. 利用者メニュー：Escape で閉じるとトリガーへフォーカスが戻る。外を押して閉じたときは戻さない。名前は見える文字を含む", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/ops/more");
    const btn = page.getByTestId("user-menu-button");
    // 画面に見える名前（PC では利用者名）を、アクセシブルな名前が含む（WCAG 2.5.3）
    const visible = (await btn.innerText()).trim();
    expect(visible).toContain("組織B 管理者");
    expect(await btn.getAttribute("aria-label")).toContain(visible);
    // キーボードで開き、メニューの中（ログアウト）にフォーカスを置いて Escape
    await openUserMenu(page);
    await page.getByTestId("signout").focus();
    await expect(page.getByTestId("signout")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-menu")).toHaveCount(0);
    await expect(btn).toBeFocused();
    // ⓘの説明が開いているときの Escape は、説明だけを閉じる（メニューは開いたまま、2 回目で閉じる）
    await openUserMenu(page);
    await page.getByRole("button", { name: /説明：役割でできること/ }).focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-menu")).toHaveCount(0);
    await expect(btn).toBeFocused();
    // Enter で開く → Escape で閉じる → フォーカスはボタンのまま（BODY に落ちない）
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("user-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-menu")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
    await expect(btn).toBeFocused();
    // 外を押して閉じたとき：押した先に任せる（ボタンへ奪い返さない）
    await openUserMenu(page);
    await page.getByTestId("ops-more").click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId("user-menu")).toHaveCount(0);
    await expect(btn).not.toBeFocused();
    // スマホ幅（名前の文字は出ない）でも、名前が読み上げに入る
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await btn.getAttribute("aria-label")).toContain("組織B 管理者");
  });

  test("I-3. スキップリンク「本文へ移動」と Tab の順（スマホは 上バー → 本文 → 下タブ）。主要画面の題名", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    // 題名は画面ごと（テンプレート「○○ — そらばん」）
    for (const [path, name] of [["/ops", "ホーム"], ["/ops/plans", "計画"], ["/ops/journal", "日誌"], ["/ops/more", "登録"]] as const) {
      await page.goto(path);
      await expect(page).toHaveTitle(`${name} — そらばん`);
    }
    // スマホ：最初の Tab はスキップリンク（フォーカスが当たったときだけ見える）
    await page.goto("/ops/more");
    const skip = page.getByTestId("skip-to-main");
    await expect(skip).toHaveText("本文へ移動");
    await expect(skip).not.toBeInViewport();
    const order: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute("data-testid") ?? el?.id ?? el?.tagName ?? "";
      });
      order.push(id);
      if (id === "nav-more") break;
    }
    expect(order[0]).toBe("skip-to-main");
    await page.goto("/ops/more");
    await expect(page.getByTestId("ops-more")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    const box = (await skip.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    // 上バー（ホームへ戻るリンク・利用者メニュー）→ 本文 → 下タブの順
    const idx = (id: string) => order.indexOf(id);
    expect(idx("ops-brand-mark")).toBeGreaterThan(0);
    expect(idx("user-menu-button")).toBeGreaterThan(idx("ops-brand-mark"));
    expect(idx("more-link-aircraft")).toBeGreaterThan(idx("user-menu-button"));
    expect(idx("nav-today")).toBeGreaterThan(idx("more-link-aircraft"));
    expect(idx("nav-more")).toBeGreaterThan(idx("nav-today"));
    // Enter で本文へ移り、次の Tab は本文の最初の操作
    await skip.press("Enter");
    await expect(page.locator("#ops-main")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("more-link-aircraft")).toBeFocused();
    // PC：スキップリンクは左メニューより前。Enter で本文へ
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/ops/more");
    await expect(page.getByTestId("ops-more")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("skip-to-main")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("ops-logo")).toBeFocused();
    // 現場モードにはスキップリンクを出さない（メニューがない）
    await expect(page.getByTestId("ops-bottom-nav")).toBeHidden();
  });

  test("M-3. 予定のない日：計画を作れない役割（閲覧者・操縦者の行に結び付いていない操縦者）には「飛行計画を作る」を出さず、「地点を判定する」は残す", async ({ browser }) => {
    const bm = await apiAs(seeded("b-manager"));
    await clearPlans(bm);
    const viewer = await inviteMember(bm, "viewer", "閲覧");
    const loose = await inviteMember(bm, "pilot", "未結付");
    for (const who of [viewer, loose]) {
      const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 375, height: 812 } });
      await signIn(ctx.request, who);
      const page = await ctx.newPage();
      await page.goto("/ops");
      await expect(page.getByTestId("today-empty")).toBeVisible();
      await expect(page.getByTestId("today-empty-action")).toHaveCount(1);
      await expect(page.getByTestId("today-empty-action")).toHaveText("地点を判定する");
      await expect(page.getByRole("link", { name: "飛行計画を作る" })).toHaveCount(0);
      // 残った 1 つが主ボタン（56px 以上）
      expect((await page.getByTestId("today-empty-action").boundingBox())!.height).toBeGreaterThanOrEqual(56);
      await ctx.close();
    }
    // 運航管理者には両方が出る
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 375, height: 812 } });
    await signIn(ctx.request, seeded("b-manager"));
    const page = await ctx.newPage();
    await page.goto("/ops");
    await expect(page.getByTestId("today-empty-action")).toHaveText(["飛行計画を作る", "地点を判定する"]);
    await ctx.close();
    await bm.dispose();
  });

  test("M-8. 内容が短い画面でも、余計にスクロールしない（下タブの余白を二重に積まない）。長い画面は末尾が下タブに隠れない", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    await clearPlans(bm);
    const viewer = await inviteMember(bm, "viewer", "短い画面");
    await signIn(page.request, viewer);
    await page.goto("/ops/more");
    await expect(page.getByTestId("ops-more")).toBeVisible();
    const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight, bh: document.body.scrollHeight }));
    expect(m.sh, `scrollHeight ${m.sh} と画面の高さ ${m.ih}`).toBeLessThanOrEqual(m.ih + 1);
    // 長い画面：最後の要素の下に、下タブの高さ分の余白がある
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("today-disclaimer")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = (await page.getByTestId("today-disclaimer").boundingBox())!;
    const nav = (await page.getByTestId("ops-bottom-nav").boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(nav.y + 1);
    await bm.dispose();
  });

  test("M-1・M-2・M-4・M-5. 予定のある日：次にやることは最初 3 件＋「ほか N 件を見る」、日付は 1/5（火）、期限は 2 行、画面名は上バーと二重にならない", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    await clearPlans(bm);
    const mark = `JUFX${stamp}`;
    const ac = await bm.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "差し戻し試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
    expect(ac.status(), await ac.text()).toBe(201);
    const aircraftId = ((await ac.json()) as { id: string }).id;
    const bp = await apiAs(seeded("b-pilot"));
    const pilotId = ((await (await bp.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await bp.dispose();
    const mk = async (title: string, date: string, time: string) => {
      const r = await bm.post("/api/ops/plans", { data: { title, aircraftId, pilotId, plannedStartAt: `${date}T${time}`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
      expect(r.status(), await r.text()).toBe(201);
    };
    await mk(`差し戻し 今日 ${stamp}`, DAY, "13:00");
    await mk(`差し戻し 明後日 ${stamp}`, "2027-01-07", "09:00");

    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    // M-1：上バーは製品名と利用者メニュー。画面名「ホーム」は本文の h1 だけ
    await expect(page.getByTestId("ops-screen-name")).toHaveCount(0);
    expect((await page.getByTestId("ops-header").boundingBox())!.height).toBeLessThanOrEqual(48);
    await expect(page.getByTestId("ops-header")).not.toContainText("ホーム");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // M-4：日付（ISO でなく 1/5（火））。年は今日と同じなので付かない
    await expect(page.getByTestId("today-date")).toHaveText("1/5（火）");
    await expect(page.getByTestId("today-card-date")).toHaveText("1/5（火）");
    await expect(page.getByTestId("upcoming-row")).toContainText("1/7（木）");
    await expect(page.getByTestId("ops-today")).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    // M-2：最初は 3 件。残りは「ほか N 件を見る」（aria-expanded つき）
    const rows = page.getByTestId("today-next-action");
    const total = await rows.count();
    expect(total).toBeGreaterThan(3);
    await expect(rows.locator(":scope:visible")).toHaveCount(3);
    const toggle = page.getByTestId("today-next-more-toggle");
    await expect(toggle).toHaveText(`ほか ${total - 3} 件を見る`);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // 次にやることの総数の表示は残る
    // （見出しの数は、上位 8 件に収まらない分も含めた総数。行の数以上になる）
    const headline = Number(/(\d+) 件/.exec(await page.getByTestId("today-next-actions").locator("h2 + span").innerText())?.[1]);
    expect(headline).toBeGreaterThanOrEqual(total);
    // 最初の画面（スマホ）の下端までに、近づく期限の見出しが入る位置まで届く（長い一覧が期限を押し出さない）
    const deadlineTop = (await page.getByTestId("home-deadlines").boundingBox())!.y;
    const nextTop = (await page.getByTestId("today-next-actions").boundingBox())!.y;
    expect(deadlineTop - nextTop).toBeLessThan(900);
    // キーボードで開く（Enter）→ 全件が見える → もう一度で閉じる。フォーカスはボタンのまま
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(rows.locator(":scope:visible")).toHaveCount(total);
    await expect(toggle).toHaveText(`ほか ${total - 3} 件を閉じる`);
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(rows.locator(":scope:visible")).toHaveCount(3);
    await expandNextActions(page);
    // M-5：期限の文は 2 行（状態＋注記）に分かれ、札（期限超過など）で急ぎ度が分かる
    const due = page.getByTestId("today-next-action-due").first();
    await expect(due).toBeVisible();
    await expect(due.locator("span")).toHaveCount(2);
    await expect(due).toContainText("社内の目安であり、法定の期限ではありません。");
    await expect(page.getByTestId("today-next-action").first().locator("[data-meaning]")).toHaveCount(1);
    await expectNoHorizontalScroll(page, "ホーム（予定のある日）");
    // 右上：「飛行計画を作る」と「地点を判定する」（予定のある日だけ）
    await expect(page.getByTestId("ops-enter-plan")).toBeVisible();
    await expect(page.getByTestId("ops-enter-verdict")).toHaveAttribute("href", "/");
    await clearPlans(bm);
    await bm.dispose();
  });

  test("M-4. 年をまたぐ期限は年を付ける（過ぎた許可）。近づく期限の日付は 1/20（水）の形", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    const number = `GB-XY-${stamp}`;
    const r = await bm.post("/api/ops/permits", {
      data: { permitNumber: number, coverage: "blanket", kinds: ["night"], issuedOn: "2025-12-01", validFrom: "2025-12-01", validTo: "2026-12-20", placeScope: { type: "nationwide" }, aircraftScope: { type: "any" }, pilotScope: { type: "any" } },
    });
    expect([201, 400]).toContain(r.status());
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    const dl = page.getByTestId("home-deadlines");
    await expect(dl).toBeVisible();
    await expect(dl).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    for (const t of await dl.getByTestId("deadline-row").locator("time").allInnerTexts()) expect(t).toMatch(/^(\d{4}\/)?\d{1,2}\/\d{1,2}（[日月火水木金土]）$/);
    if (r.status() === 201) await expect(dl).toContainText("2026/12/20（日）");
    await bm.dispose();
  });

  test("M-11. 戻りリンクの押せる範囲は幅・高さとも 44px 以上（登録・日誌・一覧・詳細）", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    for (const [path, name] of [["/ops/aircraft", /登録/], ["/ops/pilots", /登録/], ["/ops/flights", /日誌/], ["/ops/incidents", /日誌/], ["/ops/inspections", /日誌/], ["/ops/permits", /登録/], ["/ops/places", /登録/], ["/ops/aircraft/new", /機体の一覧/], ["/ops/plans/new", /飛行計画の一覧/]] as const) {
      await page.goto(path);
      const link = page.getByRole("main").getByRole("link", { name }).first();
      await expect(link, path).toBeVisible();
      const b = (await link.boundingBox())!;
      expect(b.width, `${path} 戻りリンクの幅`).toBeGreaterThanOrEqual(44);
      expect(b.height, `${path} 戻りリンクの高さ`).toBeGreaterThanOrEqual(44);
    }
  });

  test("M-6・M-7. アイコン：判定と地点、操縦者と利用者が別の絵。登録の「DIPS 未接続」に鍵を使わない", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/ops/more");
    const iconOf = async (testId: string): Promise<string> => page.getByTestId(testId).locator("svg").first().evaluate((s) => s.innerHTML);
    expect(await iconOf("nav-verdict")).not.toBe(await iconOf("nav-places"));
    expect(await iconOf("nav-pilots")).not.toBe(await iconOf("more-link-members"));
    expect(await iconOf("user-menu-button")).not.toBe(await iconOf("nav-pilots"));
    // 鍵（lock）の図形（rect の角丸 3 と M8.5 10.5V8…）が dips-note にない。点線の輪（stroke-dasharray）だけ
    const svg = await page.getByTestId("dips-note").locator("svg").first().evaluate((s) => s.innerHTML);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).not.toContain("M8.5 10.5V8");
    await expectNoHorizontalScroll(page, "登録");
  });
});
