import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, waitForSettledStyles } from "../field-checks";
import { openAllPlans } from "../ops-menu";

// Sprint 16-G の E2E-DB：ホーム（準備カード・次の予定・期限・クイック操作 3・空の状態・畳んだ「すべての予定」）。契約 HM-1〜HM-5、K-8。
// サーバーの時計は OPS_TEST_NOW（JST 2027-01-05 12:00）。組織 B で確かめる（組織 A は他の試験の計画が多い）。
// HM-5 の「判定の行が取れない」経路は、今の API を変えずに E2E で作れないため、単体（prep-card-logic.test.ts・home-prep-card.test.ts）と、サーバー側の DB テスト（field.db.test.ts の HM-5）で確かめる。
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

const PRIMARY = '.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]';
const visiblePrimaries = (page: Page): Promise<string[]> =>
  page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("dialog:not([open])");
        })
        .map((el) => el.getAttribute("data-testid") ?? el.textContent?.trim() ?? el.tagName),
    PRIMARY,
  );

/** 要素 a が b より前（DOM の順）か。 */
const before = (page: Page, a: string, b: string): Promise<boolean> =>
  page.evaluate(
    ([x, y]) => {
      const ea = document.querySelector(`[data-testid="${x}"]`)!;
      const eb = document.querySelector(`[data-testid="${y}"]`)!;
      return Boolean(ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    [a, b],
  );

// 差し戻し 1：「安全」「OK」「申請」を足した（不変条件 3）。走査の範囲は、準備カード・次の予定・クイック操作・主ボタン。
// 判定の領域（data-wording-scope="judgement"）の語は今のまま出すので、この範囲には含めない（畳んだ中の今日のカードなどは対象外）。
const BANNED = ["飛行可", "問題なし", "通報不要", "完璧", "保証", "必ず", "代行", "代理", "安全", "OK", "申請"];
const SCAN_IDS = ["home-prep", "home-next", "home-quick", "home-primary"] as const;
const expectNoBannedWords = async (page: Page, what: string): Promise<void> => {
  for (const id of SCAN_IDS) {
    const el = page.getByTestId(id);
    if ((await el.count()) === 0) continue;
    // 判定の領域の中の語は走査しない（この 4 つの範囲に判定の領域が入っていないことも確かめる）
    expect(await el.locator('[data-wording-scope="judgement"]').count(), `${what}：${id} の中に判定の領域がない`).toBe(0);
    const text = await el.innerText();
    for (const w of BANNED) expect(text, `${what}：${id} に「${w}」`).not.toContain(w);
  }
};

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test.describe("Sprint 16-G E2E-DB：ホーム", () => {
  let planId = "";
  let planTitle = "";
  let pilotName = "";
  const placeName = `地点${stamp}`; // 最初の画面の高さの検査のため、日時と並べて 1 行に収まる長さ

  test.beforeAll(async () => {
    const bm = await apiAs(seeded("b-manager"));
    await clearPlans(bm);
    const mark = `JUG16${stamp}`.slice(0, 20);
    const ac = await bm.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "ホーム試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
    expect(ac.status(), await ac.text()).toBe(201);
    const aircraftId = ((await ac.json()) as { id: string }).id;
    const bp = await apiAs(seeded("b-pilot"));
    const me = (await (await bp.get("/api/ops/me")).json()) as { pilotId: string };
    await bp.dispose();
    planTitle = `ホームの確認 ${stamp}`;
    const plan = await bm.post("/api/ops/plans", {
      data: { title: planTitle, aircraftId, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName, latitude: 35.434238, longitude: 133.380508, flags: [] },
    });
    expect(plan.status(), await plan.text()).toBe(201);
    planId = ((await plan.json()) as { id: string }).id;
    const detail = (await (await bm.get(`/api/ops/plans/${planId}`)).json()) as { pilotName?: string };
    pilotName = detail.pilotName ?? "";
    await bm.dispose();
  });

  test.afterAll(async () => {
    const bm = await apiAs(seeded("b-manager"));
    await clearPlans(bm);
    await bm.dispose();
  });

  test("HM-1 DOM の順：題・準備カード・次の予定・主ボタン・（期限）・クイック操作・すべての予定。準備カードは 3 行と 1 文の読み上げ、判定は参考の注記つき", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("today-heading")).toHaveText("ホーム");
    await expect(page.getByTestId("home-prep")).toBeVisible();
    for (const [a, b] of [["today-heading", "home-prep"], ["home-prep", "home-next"], ["home-next", "home-primary"], ["home-primary", "home-quick"], ["home-quick", "home-all"]] as const) {
      expect(await before(page, a, b), `${a} は ${b} より前`).toBe(true);
    }
    // ①補足：日付と場所
    await expect(page.getByTestId("today-date")).toHaveText("1/5（火）");
    await expect(page.getByTestId("today-place")).toHaveText(placeName);
    // ②準備カード：見出し・日時と場所・3 行・注記
    await expect(page.getByTestId("home-prep-title")).toHaveText("次の飛行の準備");
    await expect(page.getByTestId("home-prep-when")).toContainText("1/5（火）");
    await expect(page.getByTestId("home-prep-when")).toContainText(placeName);
    await expect(page.getByTestId("home-prep-report-text")).toHaveText("DIPS に出す内容を確認する");
    await expect(page.getByTestId("home-prep-inspection-text")).toHaveText("未記録");
    await expect(page.getByTestId("home-prep-note")).toHaveText("判定は参考情報です");
    const j = (await page.getByTestId("home-prep-judgement-text").innerText()).trim();
    expect(j, "判定の行は §8.2 の語のどれか").toMatch(
      /^(古い判定：)?(飛行不可の項目があります（\d+ 件）|手続きが要る項目があります（\d+ 件）|未確認の項目があります（\d+ 件）|調べた項目は手続き済みです。条件を確認してください|調べた項目では、手続きが要るものは見つかりませんでした|未確認（判定の記録がありません）|未確認（読み込めませんでした）)$/,
    );
    // 判定不能がある文は、手続き済み・手続き不要の語にならない
    if (/未確認の項目/.test(j)) expect(j).not.toMatch(/手続き済み|見つかりませんでした/);
    // 読み上げは 1 文
    const label = (await page.getByTestId("home-prep").getAttribute("aria-label")) ?? "";
    expect(label).toMatch(/^次の飛行の準備。通報、DIPS に出す内容を確認する。飛行前点検、未記録。判定、.+。/);
    // 3 行の記号（形）は svg で、文字が状態を伝える
    for (const r of ["report", "inspection", "judgement"]) await expect(page.getByTestId(`home-prep-${r}`).locator("svg")).toHaveCount(1);
    // 禁止語（準備カード・次の予定・クイック操作・主ボタン）
    await expectNoBannedWords(page, "ホーム");
    // 帯の色：注意以上（通報が注意）なので data-state は warn か danger。unknown（灰）にはならない
    expect(["warn", "danger"]).toContain((await page.getByTestId("home-prep").getAttribute("data-tone")) ?? "");
    // ③次の予定：カード全体が計画の画面への入口（72px 以上）。状態ラベル・日時・場所
    const next = page.getByTestId("home-next-link");
    await expect(next).toHaveAttribute("href", `/ops/plans/${planId}`);
    await expect(page.getByTestId("home-next-title")).toHaveText(planTitle);
    await expect(page.getByTestId("home-next-place")).toHaveText(placeName);
    await expect(page.getByTestId("home-next-status")).toBeVisible();
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(72);
    expect(pilotName === "" || !(await page.getByTestId("home-prep").innerText()).includes(pilotName), "準備カードに氏名を載せない").toBe(true);
    await expectNoHorizontalScroll(page, "ホーム");
  });

  test("HM-2・K-8 主ボタンは 1 つ。準備カードの計画の押せる次の行動（無ければ「新しい計画」）で、行き先は一覧の同じ行と同じ", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("home-primary")).toBeVisible();
    await waitForSettledStyles(page);
    const primaries = await visiblePrimaries(page);
    expect(primaries, `見える主ボタン ${primaries.join("・")}`).toEqual(["home-primary"]);
    const t = (await (await page.request.get("/api/ops/today")).json()) as { card: { planId: string } | null; nextActions: { id: string; label: string; href: string; canAct: boolean; planId: string | null }[] };
    // 差し戻し 1：準備カードの計画の押せる行動だけ（別の計画の行動を主ボタンにしない）。無ければ「新しい計画」。計画名の添え書きは出さない
    const first = t.nextActions.find((a) => a.canAct && a.planId === t.card?.planId);
    await expect(page.getByTestId("home-primary-plan")).toHaveCount(0);
    if (first) {
      await expect(page.getByTestId("home-primary")).toHaveText(first.label);
      await expect(page.getByTestId("home-primary")).toHaveAttribute("href", first.href);
    } else {
      await expect(page.getByTestId("home-primary")).toHaveText("新しい計画");
    }
    expect((await page.getByTestId("home-primary").boundingBox())!.height).toBeGreaterThanOrEqual(56);
    // 畳んだ中を開いても、主ボタンは 1 つのまま（今日のカードの入口は副ボタン）
    await page.getByTestId("home-all-toggle").click();
    await expect(page.getByTestId("today-card")).toBeVisible();
    expect(await visiblePrimaries(page)).toEqual(["home-primary"]);
    await expect(page.getByTestId("today-card-primary")).not.toHaveAttribute("data-variant", "primary");
  });

  for (const [w, h] of [[375, 812], [390, 844]] as const) {
    test(`HM-3 ${w}×${h} の最初の画面（スクロールなし）に、準備カードの見出しと 1 行目・次の予定・クイック操作 3 つが入る。3 つは 1 行・48px 以上`, async ({ page }) => {
      await signIn(page.request, seeded("b-manager"));
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/ops");
      await expect(page.getByTestId("home-prep")).toBeVisible();
      await waitForSettledStyles(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const navTop = (await page.getByTestId("ops-bottom-nav").boundingBox())!.y;
      const inFirstScreen = async (id: string, what: string): Promise<void> => {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.y, `${what} 上端`).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height, `${what} が最初の画面（下部ナビの上 ${navTop}）に入る`).toBeLessThanOrEqual(navTop);
      };
      await inFirstScreen("home-prep-title", "準備カードの見出し");
      await inFirstScreen("home-prep-report", "準備カードの 1 行目");
      await inFirstScreen("home-next", "次の予定");
      await inFirstScreen("home-primary", "主ボタン");
      await inFirstScreen("home-quick", "クイック操作");
      const boxes = [] as { y: number; h: number; w: number }[];
      for (const id of ["ops-enter-inspection", "ops-enter-plan", "ops-enter-flight"]) {
        const b = (await page.getByTestId(id).boundingBox())!;
        boxes.push({ y: Math.round(b.y), h: b.height, w: b.width });
        expect(b.height, `${id} 高さ`).toBeGreaterThanOrEqual(48);
        expect(b.width, `${id} 幅`).toBeGreaterThanOrEqual(48);
      }
      expect(new Set(boxes.map((b) => b.y)).size, "3 つが 1 行に並ぶ").toBe(1);
      expect(Math.max(...boxes.map((b) => b.w)) - Math.min(...boxes.map((b) => b.w)), "幅は 3 等分").toBeLessThanOrEqual(1);
      await expect(page.getByTestId("ops-enter-inspection")).toHaveText("飛行前点検");
      await expect(page.getByTestId("ops-enter-plan")).toHaveText("新しい計画");
      await expect(page.getByTestId("ops-enter-flight")).toHaveText("飛行記録");
      await expect(page.getByTestId("ops-enter-inspection")).toHaveAttribute("href", "/ops/inspections/new");
      await expect(page.getByTestId("ops-enter-plan")).toHaveAttribute("href", "/ops/plans/new");
      await expect(page.getByTestId("ops-enter-flight")).toHaveAttribute("href", "/ops/flights/new");
      // クイック操作は副ボタン
      for (const id of ["ops-enter-inspection", "ops-enter-plan", "ops-enter-flight"]) await expect(page.getByTestId(id)).not.toHaveAttribute("data-variant", "primary");
    });
  }

  test("HM-1 畳み：判定のピル・今日のカード・次にやること・直近の飛行は「すべての予定」に畳まれ、開くと出る。ピルの行き先は変わらない", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("home-all")).toBeVisible();
    expect(await page.getByTestId("home-all").evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(page.getByTestId("judge-pills")).toBeHidden();
    await expect(page.getByTestId("today-card")).toBeHidden();
    await page.getByTestId("home-all-toggle").click();
    await expect(page.getByTestId("judge-pills")).toBeVisible();
    await expect(page.getByTestId("judge-pill-here")).toHaveAttribute("href", "/?start=here");
    await expect(page.getByTestId("judge-pill-search")).toHaveAttribute("href", "/?start=search");
    await expect(page.getByTestId("today-card")).toHaveAttribute("data-plan-id", planId);
    await expect(page.getByTestId("today-next-actions")).toBeVisible();
    await expect(page.getByTestId("home-upcoming")).toBeVisible();
    // 判定のピルは 48px 以上
    for (const id of ["judge-pill-here", "judge-pill-search"]) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(48);
  });

  test("端末データ：ホームを開いても、氏名・場所・計画名を localStorage・sessionStorage に残さない", async ({ page }) => {
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("home-prep")).toBeVisible();
    const dump = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    for (const v of [placeName, planTitle, pilotName].filter(Boolean)) expect(dump, v).not.toContain(v);
    expect(dump).not.toMatch(/35\.4342|133\.3805/);
  });

  test("HM-1 ④ 期限：60 日以内のものだけ。無ければ段を出さない（畳んだ中に無い旨の 1 行）。ある日は近い順に 1 件。残りは「すべての予定」の中", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    const existing = ((await (await bm.get("/api/ops/today")).json()) as { deadlines: { daysLeft: number }[] }).deadlines;
    expect(existing.every((d) => d.daysLeft <= 60)).toBe(true);
    if (existing.length === 0) {
      await expect(page.getByTestId("home-deadlines")).toHaveCount(0);
      await expect(page.getByTestId("home-deadlines-empty")).toHaveCount(1);
    }
    // 15・31・50・59 日後の技能証明（4 件）を足して、3 件目以降が畳まれることを確かめる
    const mk = async (name: string, expires: string) => {
      const r = await bm.post("/api/ops/pilots", { data: { fullName: name, hasLicense: true, licenseClass: "second", licenseNumber: `G16-${stamp}-${name.length}${expires}`.slice(0, 30), licenseExpiresOn: expires } });
      expect(r.status(), await r.text()).toBe(201);
    };
    await mk(`期限甲${stamp}`, "2027-01-20");
    await mk(`期限乙${stamp}`, "2027-02-05");
    await mk(`期限丙${stamp}`, "2027-02-24");
    await mk(`期限丁${stamp}`, "2027-03-05");
    await mk(`期限戊${stamp}`, "2027-03-20");
    await page.goto("/ops");
    const section = page.getByTestId("home-deadlines");
    await expect(section).toBeVisible();
    await expect(section.getByTestId("deadline-row")).not.toHaveCount(0);
    const all = ((await (await bm.get("/api/ops/today")).json()) as { deadlines: { daysLeft: number }[] }).deadlines;
    expect(all.every((d) => d.daysLeft <= 60), "60 日を超える期限は出ない").toBe(true);
    // 上段には近い 1 件だけ。残りは「すべての予定」の中（畳んだ中）にあり、件数は見出しの行に出る
    await expect(section.getByTestId("deadline-row")).toHaveCount(Math.min(1, all.length));
    if (all.length > 1) {
      await expect(page.getByTestId("home-deadlines-count")).toContainText(`ほか ${all.length - 1} 件`);
      await expect(page.getByTestId("home-deadlines-rest").getByTestId("deadline-row")).toHaveCount(all.length - 1);
      await expect(page.getByTestId("home-deadlines-rest")).toBeHidden();
      await openAllPlans(page);
      await expect(page.getByTestId("home-deadlines-rest")).toBeVisible();
    }
    expect(await before(page, "home-primary", "home-deadlines")).toBe(true);
    expect(await before(page, "home-deadlines", "home-quick")).toBe(true);
    await bm.dispose();
  });

  test("差し戻し 1：通報の行は、受付番号があるときだけ「受付番号を記録済み」（安全）。番号が表示されなかった記録は「記録あり（受付番号なし）」（注意・△）", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    await clearPlans(bm);
    const bp = await apiAs(seeded("b-pilot"));
    const me = (await (await bp.get("/api/ops/me")).json()) as { pilotId: string };
    await bp.dispose();
    await signIn(page.request, seeded("b-manager"));
    const variants = [
      { key: "num", manual: { dipsNumber: "FP-HOME-0001" }, text: "受付番号を記録済み", tone: "safe" },
      { key: "nonum", manual: { numberUnavailable: true, memo: "完了画面に番号が出なかった" }, text: "記録あり（受付番号なし）", tone: "warn" },
    ] as const;
    try {
      for (const [i, v] of variants.entries()) {
        const mark = `JUR${v.key}${stamp}`.slice(0, 20);
        const ac = await bm.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "通報の行の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
        expect(ac.status(), await ac.text()).toBe(201);
        const aircraftId = ((await ac.json()) as { id: string }).id;
        const pl = await bm.post("/api/ops/plans", {
          data: { title: `通報の行 ${v.key} ${stamp}`, aircraftId, pilotId: me.pilotId, plannedStartAt: `${DAY}T${13 + i}:00`, durationMinutes: 30, purpose: "空撮", placeName: `地点${v.key}${stamp}`, latitude: 35.434238, longitude: 133.380508, flags: ["method_night"] },
        });
        expect(pl.status(), await pl.text()).toBe(201);
        const id = ((await pl.json()) as { id: string }).id;
        const created = (await (await bm.get(`/api/ops/plans/${id}`)).json()) as { version: number };
        expect((await bm.post(`/api/ops/plans/${id}/request-confirmation`, { data: { expectedVersion: created.version } })).status()).toBe(200);
        const active = (await (await bm.get(`/api/ops/plans/${id}`)).json()) as { version: number };
        const rep = await bm.post(`/api/ops/plans/${id}/reports`, {
          data: { kind: "new", expectedPlanVersion: active.version, inputs: { flightSpeed: 40, assistantsNumber: 1 }, manual: { reportedAt: `${DAY}T11:30`, confirmedDipsDone: true, confirmedMatchesLatest: true, ...v.manual } },
        });
        expect(rep.status(), await rep.text()).toBeLessThan(300);
        await page.goto("/ops");
        await expect(page.getByTestId("home-prep")).toBeVisible();
        await expect(page.getByTestId("home-prep-report-text")).toHaveText(v.text);
        await expect(page.getByTestId("home-prep-report")).toHaveAttribute("data-tone", v.tone);
        const label = (await page.getByTestId("home-prep").getAttribute("aria-label")) ?? "";
        expect(label).toContain(`通報、${v.text}。`);
        if (v.key === "nonum") {
          await expect(page.getByTestId("home-prep-report-text")).not.toContainText("受付番号を記録済み");
          // 帯は注意以上（番号なしを良い側に見せない）
          expect(["warn", "danger"]).toContain((await page.getByTestId("home-prep").getAttribute("data-tone")) ?? "");
        }
        await expectNoBannedWords(page, `通報の行 ${v.key}`);
        await voidPlan(bm, id);
      }
    } finally {
      await clearPlans(bm);
      await bm.dispose();
    }
  });

  test("HM-4 空の状態（計画が 0 件）：アイコン・一文・主ボタン「計画を作る」だけ。準備カード・次の予定は出ない", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    await clearPlans(bm);
    await bm.dispose();
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    const empty = page.getByTestId("today-empty");
    await expect(empty).toBeVisible();
    await expect(page.getByTestId("home-prep")).toHaveCount(0);
    await expect(page.getByTestId("home-next")).toHaveCount(0);
    await expect(page.getByTestId("home-primary")).toHaveCount(0);
    await expect(empty.locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("today-empty-message")).not.toHaveText("");
    await expect(page.getByTestId("today-empty-action")).toHaveCount(1);
    await expect(page.getByTestId("today-empty-action")).toHaveText("計画を作る");
    await expect(page.getByTestId("today-empty-action")).toHaveAttribute("href", "/ops/plans/new");
    expect((await page.getByTestId("today-empty-action").boundingBox())!.height).toBeGreaterThanOrEqual(56);
    expect(await visiblePrimaries(page)).toEqual(["today-empty-action"]);
    // クイック操作 3 つは空の日にも出る（点検・記録へ 1 回）
    await expect(page.getByTestId("home-quick")).toBeVisible();
    await waitForSettledStyles(page);
    const navTop = (await page.getByTestId("ops-bottom-nav").boundingBox())!.y;
    const q = (await page.getByTestId("home-quick").boundingBox())!;
    expect(q.y + q.height).toBeLessThanOrEqual(navTop);
    await expectNoHorizontalScroll(page, "ホーム（計画なし）");
  });

  test("権限：閲覧者にはクイック操作と「新しい計画」を出さない。閲覧者の空の日の主ボタンは「地点を判定する」", async ({ page }) => {
    await signIn(page.request, seeded("a-viewer"));
    await page.goto("/ops");
    await expect(page.getByTestId("ops-today")).toBeVisible();
    await expect(page.getByTestId("home-quick")).toHaveCount(0);
    for (const id of ["ops-enter-inspection", "ops-enter-plan", "ops-enter-flight", "home-primary"]) await expect(page.getByTestId(id), id).toHaveCount(0);
    expect((await visiblePrimaries(page)).length).toBeLessThanOrEqual(1);
  });
});
