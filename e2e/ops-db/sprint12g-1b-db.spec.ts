import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectNoHorizontalScroll } from "../field-checks";
import { openUserMenu } from "../ops-menu";

// Sprint 12g-1b 段階 A の E2E-DB：ホーム（次の飛行・行程・近づく期限・直近の飛行）、登録、日誌の事故・ヒヤリハット、利用者メニュー。
// サーバーの現在時刻は OPS_TEST_NOW（playwright.ops.config.ts、JST 2027-01-05 12:00）。組織B で確かめる（組織A は他の試験の計画が多い）。
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

type TodayJson = {
  card: { planId: string; journey: { id: string; state: string }[] } | null;
  rest: { planId: string }[];
  upcoming: { planId: string; title: string; daysLeft: number; journey: { id: string; state: string }[] }[];
  deadlines: { kind: string; subject: string; daysLeft: number; date: string }[];
  empty: unknown;
};
const getToday = async (ctx: APIRequestContext): Promise<TodayJson> => (await (await ctx.get("/api/ops/today")).json()) as TodayJson;
const voidPlan = async (ctx: APIRequestContext, id: string): Promise<void> => {
  const plan = (await (await ctx.get(`/api/ops/plans/${id}`)).json()) as { version: number; voided: boolean };
  if (!plan.voided) await ctx.post(`/api/ops/plans/${id}/void`, { data: { expectedVersion: plan.version, reason: "試験の後始末" } });
};
/** 組織B の今日・直近の計画を中止して、予定のない日にする。 */
const clearPlans = async (ctx: APIRequestContext): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    const t = await getToday(ctx);
    const ids = [...(t.card ? [t.card.planId] : []), ...t.rest.map((r) => r.planId), ...t.upcoming.map((u) => u.planId)];
    if (ids.length === 0) return;
    for (const id of ids) await voidPlan(ctx, id);
  }
};

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test.describe("Sprint 12g-1b A E2E-DB：ホーム・登録・日誌・利用者メニュー", () => {
  let pilotId = "";
  let farId = "";
  let permitId = "";
  const pilotName = `期限 太郎${stamp}`;
  const permitNumber = `GB-${stamp}`;

  test("A7. 予定のない日：何もない旨と次の一手が先頭、375×812 の最初の画面に期限の最初の行が入る（見本の S3＝0 回）", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    await clearPlans(bm);
    // 近づく期限：技能証明は 15 日後、許可・承認は 31 日後（今日は 2027-01-05）。61 日後の技能証明は出ない
    const mk = async (name: string, expires: string) => {
      const r = await bm.post("/api/ops/pilots", { data: { fullName: name, hasLicense: true, licenseClass: "second", licenseNumber: `G1B-${stamp}`.slice(0, 30), licenseExpiresOn: expires } });
      expect(r.status(), await r.text()).toBe(201);
      return ((await r.json()) as { id: string }).id;
    };
    pilotId = await mk(pilotName, "2027-01-20");
    farId = await mk(`期限 遠次郎${stamp}`, "2027-03-07");
    const permit = await bm.post("/api/ops/permits", {
      data: {
        permitNumber, coverage: "blanket", kinds: ["night"], issuedOn: "2026-01-01", validFrom: "2026-01-01", validTo: "2027-02-05",
        placeScope: { type: "nationwide" }, aircraftScope: { type: "any" }, pilotScope: { type: "any" },
      },
    });
    expect(permit.status(), await permit.text()).toBe(201);
    permitId = ((await permit.json()) as { id: string }).id;

    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("today-heading")).toHaveText("ホーム");
    // 日付は読みやすい形（M-4。年は今日と違うときだけ）。機械可読な値は time の dateTime に残す
    await expect(page.getByTestId("today-date")).toHaveText("1/5（火）");
    await expect(page.getByTestId("today-date").locator("time")).toHaveAttribute("datetime", DAY);
    await expect(page.getByTestId("today-card")).toHaveCount(0);
    await expect(page.getByTestId("today-empty")).toBeVisible();
    await expect(page.getByTestId("today-empty-message")).not.toHaveText("");
    await expect(page.getByTestId("today-empty-action")).toHaveCount(2);
    await expect(page.getByTestId("today-empty-action").first()).toHaveText("飛行計画を作る");
    // 同じ画面に「飛行計画を作る」は 1 つだけ（予定のない日はカードの中。右上には出さない）
    await expect(page.getByRole("link", { name: "飛行計画を作る" })).toHaveCount(1);
    await expect(page.getByTestId("ops-enter-plan")).toHaveCount(0);
    // 先頭：何もない旨と次の一手 → すぐ下に近づく期限
    const empty = (await page.getByTestId("today-empty").boundingBox())!;
    const dl = page.getByTestId("deadline-row");
    await expect(page.getByTestId("home-deadlines")).toBeVisible();
    const rows = await dl.all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const first = (await dl.first().boundingBox())!;
    expect(empty.y).toBeLessThan(first.y);
    // 最初の画面（高さ 812px から下の 5 タブの 60px を除いた範囲）に、期限の最初の行が全部入る。
    // Sprint 12h PR ③a：上部に判定のピル（見出し＋2 つのピル＋間隔）が入ったので、その高さの分だけ、枠を下げて測る。
    // ピルより下の配置が、これまでと同じ余裕（タブは 56 → 60px で 4px 厳しくなった）に収まることを確かめる
    const pillsBox = (await page.getByTestId("judge-pills").boundingBox())!;
    const pillsBlock = (await empty.y) - pillsBox.y; // ピルの区画の上端から、空のカードの上端まで（ピルの高さと間隔）
    expect(pillsBlock).toBeGreaterThan(48);
    expect(first.y + first.height - pillsBlock).toBeLessThanOrEqual(812 - 60);
    // 期限の並び：近い順。技能証明は氏名、許可・承認は番号。技能証明書の番号は出ない。機体の期限は出ない旨の 1 行
    await expect(dl.nth(0)).toContainText(pilotName);
    await expect(dl.nth(0)).toContainText("あと 15 日");
    await expect(dl.nth(0)).toContainText("技能証明");
    await expect(page.locator('[data-testid="deadline-row"][data-kind="permit"]')).toContainText(permitNumber);
    await expect(page.locator('[data-testid="deadline-row"][data-kind="permit"]')).toContainText("あと 31 日");
    await expect(page.getByTestId("home-deadlines")).not.toContainText(`期限 遠次郎${stamp}`);
    await expect(page.getByTestId("home-deadlines-note")).toHaveText("機体の期限は、記録する場所がまだないため出ません。");
    expect(await page.locator("body").innerText()).not.toContain(`G1B-${stamp}`);
    // 期限の行は押すと、操縦者・許可・承認の画面へ
    await expect(page.locator('[data-testid="deadline-link"]').first()).toHaveAttribute("href", `/ops/pilots/${pilotId}`);
    await expectNoHorizontalScroll(page, "ホーム（予定のない日）");
    // API：項目が増えるだけ（既存の項目は変わらない）
    const t = await getToday(bm);
    expect(t.deadlines.map((d) => [d.kind, d.daysLeft])).toEqual(expect.arrayContaining([["license", 15], ["permit", 31]]));
    expect(t.deadlines.some((d) => d.subject.includes("遠次郎"))).toBe(false);
    expect(t.empty).not.toBeNull();
    await bm.dispose();
  });

  test("A7・A8. 飛行がある日：次の飛行（主ボタン 1 つ）と行程の 7 段、直近の飛行にも行程。予定の窓は 7 日", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    const mark = `JUG1B${stamp}`;
    const ac = await bm.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "行程試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
    expect(ac.status(), await ac.text()).toBe(201);
    const aircraftId = ((await ac.json()) as { id: string }).id;
    const bp = await apiAs(seeded("b-pilot"));
    const pilot = { id: ((await (await bp.get("/api/ops/me")).json()) as { pilotId: string }).pilotId };
    await bp.dispose();
    const body = (title: string, date: string, time: string) => ({
      title, aircraftId, pilotId: pilot.id, plannedStartAt: `${date}T${time}`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点",
      latitude: 35.434238, longitude: 133.380508, flags: [],
    });
    const mkPlan = async (title: string, date: string, time: string) => {
      const r = await bm.post("/api/ops/plans", { data: body(title, date, time) });
      expect(r.status(), await r.text()).toBe(201);
      return (await r.json()) as { id: string };
    };
    const today = await mkPlan(`行程 今日 ${stamp}`, DAY, "13:00");
    const soon = await mkPlan(`行程 明後日 ${stamp}`, "2027-01-07", "09:00");
    await mkPlan(`行程 8 日後 ${stamp}`, "2027-01-13", "09:00");

    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    const card = page.getByTestId("today-card");
    await expect(card).toHaveAttribute("data-plan-id", today.id);
    // 予定のある日は、「飛行計画を作る」は右上の 1 つだけ（現場モードを開くが主ボタン）
    await expect(page.getByRole("link", { name: "飛行計画を作る" })).toHaveCount(1);
    await expect(page.getByTestId("ops-enter-plan")).toBeVisible();
    await expect(page.getByTestId("today-card-reason")).toHaveText("今日の飛行");
    // 主ボタンは 1 つ（カードの中）。高さ 56px 以上
    await expect(card.getByTestId("today-card-primary")).toHaveText("現場モードを開く");
    expect((await card.getByTestId("today-card-primary").boundingBox())!.height).toBeGreaterThanOrEqual(56);
    // 行程：判定→計画→確認→通報→点検→飛行→日誌。文字と済／次／未
    const stages = card.getByTestId("route").locator("li");
    await expect(stages).toHaveCount(7);
    const texts = (await stages.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    expect(texts.map((t) => t.split(" ")[0])).toEqual(["判定", "計画", "確認", "通報", "点検", "飛行", "日誌"]);
    expect(texts[0]).toBe("判定 済");
    // 確認はまだ（計画は下書きでなく保存済み）。「次」はちょうど 1 つ
    expect(texts.filter((t) => / 次$/.test(t))).toHaveLength(1);
    expect(texts.every((t) => / (済|次|未|対象外)$/.test(t))).toBe(true);
    expect(texts.join(" ")).not.toMatch(/不要/);
    // 行程の文字は 12px 以上、320px・375px で折り返さない
    for (const w of [375, 320]) {
      await page.setViewportSize({ width: w, height: 812 });
      const m = await card.getByTestId("route").evaluate((ol) =>
        Array.from(ol.querySelectorAll("li > span")).map((s) => ({ h: (s as HTMLElement).getBoundingClientRect().height, fs: parseFloat(getComputedStyle(s).fontSize), sw: (s as HTMLElement).scrollWidth, cw: (s as HTMLElement).clientWidth })),
      );
      for (const x of m) {
        expect(x.fs, `${w}px の文字の大きさ`).toBeGreaterThanOrEqual(12);
        expect(x.h, `${w}px で折り返し`).toBeLessThan(30);
        expect(x.sw, `${w}px ではみ出し`).toBeLessThanOrEqual(x.cw + 1);
      }
      await expectNoHorizontalScroll(page, `ホーム ${w}px`);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    // 直近の飛行：今日より先の 7 日以内の計画だけ（8 日後は出ない）。行程つき
    const up = page.locator('[data-testid="upcoming-row"]');
    await expect(up).toHaveCount(1);
    await expect(up).toHaveAttribute("data-plan-id", soon.id);
    await expect(up).toContainText("あと 2 日");
    await expect(up.getByTestId("route").locator("li")).toHaveCount(7);
    await expect(page.getByTestId("today-disclaimer")).toContainText("判定は入力された情報の範囲での目安です");
    // 次にやること：行は 56px 以上
    const action = page.getByTestId("today-next-action-link").first();
    await expect(action).toBeVisible();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    // 画面にある呼び名は 5 つ。古い呼び名は出ない
    const text = await page.locator("body").innerText();
    for (const w of ["運航管理のトップ", "地点判定へ", "今日へ戻る", "その他"]) expect(text, w).not.toContain(w);
    const t = await getToday(bm);
    expect(t.card?.journey.map((s) => s.id)).toEqual(["judge", "plan", "confirm", "report", "inspection", "flight", "journal"]);
    expect(t.upcoming).toHaveLength(1);
    for (const id of [today.id, soon.id, ...t.upcoming.map((u) => u.planId)]) await voidPlan(bm, id);
    await clearPlans(bm);
    await bm.dispose();
  });

  test("A4. 利用者メニュー：スマホは右上のアイコン、開くと名前・役割（ⓘに説明）・メールアドレス・ログアウト。Escape で閉じる。タップ領域 44px 以上", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops/more");
    const btn = page.getByTestId("user-menu-button");
    await expect(btn).toBeVisible();
    const box = (await btn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
    await expect(page.getByTestId("ops-me-name")).toHaveCount(0);
    await openUserMenu(page);
    await expect(page.getByTestId("ops-me-name")).toHaveText("組織B 管理者");
    await expect(page.getByTestId("ops-me-role")).toHaveText("役割：運航管理者");
    await expect(page.getByTestId("ops-me-email")).toHaveText("b-manager@example.test");
    // 役割の説明はⓘの中
    const info = page.getByRole("button", { name: /説明：役割でできること/ });
    await expect(info).toBeVisible();
    await expect(page.getByTestId("user-menu").getByText("利用者の招待・役割の変更・停止ができます", { exact: false })).toBeHidden();
    await info.click();
    await expect(page.getByTestId("user-menu").getByText("利用者の招待・役割の変更・停止ができます", { exact: false })).toBeVisible();
    await expect(page.getByTestId("signout")).toBeVisible();
    expect((await page.getByTestId("signout").boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expectNoHorizontalScroll(page, "利用者メニュー");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-menu")).toHaveCount(0);
    // 外を押しても閉じる
    await openUserMenu(page);
    await page.getByTestId("ops-more").click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId("user-menu")).toHaveCount(0);
  });

  test("A9・A10. 登録の画面（件数・管理・DIPS の未接続）と、日誌の中の事故・ヒヤリハット（閲覧者には入力の入口がない）", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 375, height: 812 } });
    await signIn(ctx.request, seeded("a-viewer"));
    const page: Page = await ctx.newPage();
    await page.goto("/ops/more");
    await expect(page.getByTestId("ops-more")).toBeVisible();
    for (const k of ["aircraft", "pilots", "permits", "places"]) await expect(page.getByTestId(`more-link-${k}`)).toBeVisible();
    await expect(page.getByTestId("more-link-members")).toHaveCount(0);
    await expect(page.getByTestId("more-admin")).toHaveCount(0);
    await expect(page.getByTestId("dips-note")).toContainText("未接続");
    await expect(page.getByTestId("dips-note")).not.toContainText("取り込");
    await page.goto("/ops/journal");
    await expect(page.getByTestId("journal-tab-incidents")).toBeVisible();
    await expect(page.getByTestId("journal-new-incident")).toHaveCount(0);
    await expect(page.getByTestId("journal-new-flight")).toHaveCount(0);
    await page.goto("/ops/incidents");
    await expect(page.getByTestId("incident-list-page")).toBeVisible();
    // 一覧の戻り先は日誌、機体・操縦者・許可・承認・地点の一覧の戻り先は機体と書類（16-F で表示名を「登録」から変更）、計画の一覧には戻りリンクがない
    await expect(page.getByTestId("incident-list-page").getByRole("link", { name: /日誌/ }).first()).toHaveAttribute("href", "/ops/journal");
    for (const p of ["/ops/aircraft", "/ops/pilots", "/ops/permits", "/ops/places"]) {
      await page.goto(p);
      const back = page.locator("main").getByRole("link", { name: /機体と書類/ }).first();
      await expect(back, p).toHaveAttribute("href", "/ops/more");
      expect((await back.boundingBox())!.height, p).toBeGreaterThanOrEqual(48);
    }
    // 点検の一覧は 16-F から日誌の下の画面：戻りリンク「日誌」（行き先 /ops/journal）。飛行記録の一覧の戻り先も日誌のまま。計画の一覧には戻りリンクを置かない
    await page.goto("/ops/flights");
    await expect(page.locator("main").getByRole("link", { name: /日誌/ }).first()).toHaveAttribute("href", "/ops/journal");
    await page.goto("/ops/inspections");
    await expect(page.getByTestId("ops-inspections")).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: /日誌/ }).first()).toHaveAttribute("href", "/ops/journal");
    await page.goto("/ops/plans");
    await expect(page.locator("main a").filter({ hasText: "←" })).toHaveCount(0);
    await ctx.close();
  });

  test("後始末：作った操縦者と許可・承認を取り消す", async () => {
    const bm = await apiAs(seeded("b-manager"));
    for (const id of [pilotId, farId]) {
      if (id) expect((await bm.post(`/api/ops/pilots/${id}/void`, { data: { expectedVersion: 1, reason: "試験の後始末" } })).status()).toBe(200);
    }
    if (permitId) expect((await bm.post(`/api/ops/permits/${permitId}/void`, { data: { expectedVersion: 1, reason: "試験の後始末" } })).status()).toBe(200);
    await bm.dispose();
  });
});
