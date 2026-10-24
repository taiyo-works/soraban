import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { openUserMenu } from "../ops-menu";
import { collectTextSamples, expectContrast, expectFontSize, expectNoHorizontalScroll, expectTapTargets } from "../field-checks";

// Sprint 12c の E2E-DB（契約 7〜13・15・16 の画面・通しの部分）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1・逆ジオコーダの模擬サーバーを与えた next start に対して実行する。
// サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定している。ブラウザの時計は page.clock で合わせる
// （端末の時計から作る occurredAt が、サーバーの検査 ±5 分と合うように）。画面は幅 375px のタッチ端末で確かめる。
// 圏外は context.setOffline(true)、送信の失敗・応答の取りこぼしは page.route で作る。DIPS へは何も送らない。
// テスト用の初期データ：組織A の a-manager・a-pilot（操縦 一郎。技能証明書番号 TEST-11112222）・a-viewer、組織B の b-manager・b-pilot。
// 「今日」の一覧は上位 8 件だけなので、組織A の他の計画と混ざらないよう、「今日」の並びは組織B で確かめる。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });

const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", {
    data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId },
  });
  expect(r.status()).toBe(200);
};
const apiAs = async (who: Who | null): Promise<APIRequestContext> => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  if (who) await signIn(ctx, who);
  return ctx;
};

const FORBIDDEN_WORDS = ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて"];
const DISCLAIMER = "判定は入力された情報の範囲での目安です。";
const DAY = "2027-01-05";
const NOW_JST = `${DAY}T12:00`;
const NIGHT_SPOT = { lat: 35.44, lng: 133.35 };
const HQ = { lat: 35.434238, lng: 133.380508 };
/** 判定不能が無く特定飛行に当たらない地点（通報は推奨）。 */
const CLEAR_SPOT = { lat: 35.474926, lng: 134.222963 };

let seq = 0;
const stamp = Date.now().toString(36).toUpperCase();
const uniqueMark = () => `JUS12C${stamp}${seq++}`;
const at = (hms: string) => new Date(`${DAY}T${hms}+09:00`);

const ALL_NORMAL = Object.fromEntries(
  ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"].map((k) => [k, { result: "normal" }]),
);

const createAircraft = async (manager: APIRequestContext): Promise<{ id: string; registrationMark: string }> => {
  const registrationMark = uniqueMark();
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "現場試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { ...((await r.json()) as { id: string }), registrationMark };
};

const pilotIdOf = async (who: Who): Promise<string> => {
  const ctx = await apiAs(who);
  const me = (await (await ctx.get("/api/ops/me")).json()) as { pilotId: string };
  await ctx.dispose();
  return me.pilotId;
};

type PlanJson = { id: string; version: number; title: string; currentSnapshotId: string };

/** 今日 13:00〜14:00 の計画。night: true なら夜間飛行（通報の記録が要る）。 */
const planBody = (aircraftId: string, pilotId: string, extra: Record<string, unknown> = {}) => ({
  title: `現場 ${stamp}-${seq++}`,
  aircraftId,
  pilotId,
  plannedStartAt: `${DAY}T13:00`,
  durationMinutes: 60,
  purpose: "空撮",
  placeName: "試験地点",
  latitude: HQ.lat,
  longitude: HQ.lng,
  flags: [],
  ...extra,
});
const nightPlan = (aircraftId: string, pilotId: string, extra: Record<string, unknown> = {}) =>
  planBody(aircraftId, pilotId, { latitude: NIGHT_SPOT.lat, longitude: NIGHT_SPOT.lng, flags: ["method_night"], ...extra });

const createPlan = async (ctx: APIRequestContext, body: object): Promise<PlanJson> => {
  const r = await ctx.post("/api/ops/plans", { data: body });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as PlanJson;
};

type FieldView = {
  openFlightEventId: string | null;
  pendingJournalTakeoffEventIds: string[];
  items: { item: string; done: boolean; stateLabel: string; eventId: string | null; inspectionId: string | null }[];
  flights: { takeoffEventId: string; takeoffAt: string; landingAt: string | null; landingEventId: string | null; phase: string; gaps: { item: string }[] }[];
};
const getField = async (ctx: APIRequestContext, planId: string): Promise<FieldView> => {
  const r = await ctx.get(`/api/ops/plans/${planId}/field`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as FieldView;
};
type EventJson = { id: string; kind: string; item: string | null; result: string | null; targetEventId: string | null; occurredAt: string; queued: boolean; clientEventId: string };
const getEvents = async (ctx: APIRequestContext, planId: string): Promise<EventJson[]> => {
  const r = await ctx.get(`/api/ops/plans/${planId}/field-events`);
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { events: EventJson[] }).events;
};
const postEvent = (ctx: APIRequestContext, planId: string, body: Record<string, unknown>) =>
  ctx.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: NOW_JST, ...body } });

const createInspection = async (ctx: APIRequestContext, aircraftId: string, pilotId: string, inspectedAt = `${DAY}T11:00`): Promise<{ id: string }> => {
  const r = await ctx.post("/api/ops/inspections", {
    data: { aircraftId, pilotId, inspectedAt, timing: "pre_flight", placeName: "本社 駐車場", items: ALL_NORMAL },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
};

/** 後始末：離着陸を取り消して、計画を中止する（「今日」の一覧に残さない）。 */
const settle = async (manager: APIRequestContext, planId: string): Promise<void> => {
  const v = await getField(manager, planId);
  for (const f of v.flights) {
    if (f.landingEventId) await postEvent(manager, planId, { kind: "undo", targetEventId: f.landingEventId });
  }
  for (const f of v.flights) await postEvent(manager, planId, { kind: "undo", targetEventId: f.takeoffEventId });
  const plan = (await (await manager.get(`/api/ops/plans/${planId}`)).json()) as { version: number };
  await manager.post(`/api/ops/plans/${planId}/void`, { data: { expectedVersion: plan.version, reason: "試験の後始末" } });
};

const fixClock = (page: Page, hms: string) => page.clock.setFixedTime(at(hms));

/** リンクを押して、遷移（URL の変化）まで確かめる（12a・12b の tapAndWait と同じ作法）。応答の待ち受けは作らない。 */
const tapAndWait = async (page: Page, link: Locator, url: RegExp): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await link.click();
    try {
      await page.waitForURL(url, { timeout: 10_000, waitUntil: "commit" });
      return;
    } catch {
      // 押し直す
    }
  }
  const href = await link.getAttribute("href");
  await page.goto(href!);
  await page.waitForURL(url);
};

/** 現場モードを開き、描画と水和が済むのを待つ。 */
const openField = async (page: Page, planId: string): Promise<void> => {
  await page.goto(`/ops/plans/${planId}/field`);
  await expect(page.getByTestId("field-root")).toBeVisible();
  await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
};

const watchDialogs = (page: Page): string[] => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  return dialogs;
};

const bodyText = async (page: Page): Promise<string> => {
  await expect(page.locator("main").first()).toBeVisible();
  return page.locator("body").innerText();
};
const expectNoForbiddenWords = async (page: Page, label: string) => {
  const text = await bodyText(page);
  for (const w of FORBIDDEN_WORDS) expect(text, `${label}: 「${w}」が出ている`).not.toContain(w);
  expect(text, `${label}: 特許・出願の表示`).not.toMatch(/特許|出願/);
};

const unsentCount = async (page: Page): Promise<number> => Number(await page.getByTestId("field-unsent").getAttribute("data-count"));

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, timezoneId: "America/Los_Angeles" });

test.describe("Sprint 12c E2E-DB：ホーム・メニュー・日誌・登録", () => {
  test("7. /ops は「ホーム」：空の状態 → 大きなカード 1 枚と次にやること（急ぐ順）。飛行中・日誌待ち・点検なし・食い違いの各状況", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    await signIn(page.request, seeded("b-manager"));
    await fixClock(page, "12:00:10");

    // 今日の計画がまだない組織：何がないかと、次にできること。件数だけのタイルはない
    const first = (await (await bm.get("/api/ops/today")).json()) as { card: unknown; empty: { message: string } | null };
    await page.goto("/ops");
    await expect(page.getByTestId("ops-today")).toBeVisible();
    if (first.card === null) {
      await expect(page.getByTestId("today-empty")).toBeVisible();
      await expect(page.getByTestId("today-empty-message")).not.toHaveText("");
      await expect(page.getByTestId("today-empty-action")).toHaveCount(2);
      await expect(page.getByTestId("today-empty-action").first()).toHaveText("飛行計画を作る");
      await expect(page.getByTestId("today-card")).toHaveCount(0);
    }
    // 入力ボタンは残り、ログイン中の利用者と役割・ログアウトは右上の利用者メニュー（開いてから見える）にある
    await expect(page.getByTestId("ops-enter-plan")).toBeVisible();
    await expect(page.getByTestId("ops-enter-flight")).toBeVisible();
    await expect(page.getByTestId("ops-enter-inspection")).toBeVisible();
    await expect(page.getByTestId("today-heading")).toHaveText("ホーム");
    await expect(page.getByTestId("ops-me-name")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ログアウト" })).toHaveCount(0);
    await openUserMenu(page);
    await expect(page.getByTestId("ops-me-name")).toHaveText("組織B 管理者");
    await expect(page.getByTestId("ops-me-role")).toHaveText("役割：運航管理者");
    await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-menu")).toHaveCount(0);
    await expect(page.locator('main a[href="/ops/aircraft"]')).toHaveCount(0);

    // 今日の計画を作る → 大きなカード 1 枚
    const aircraft = await createAircraft(bm);
    const pilotId = await pilotIdOf(seeded("b-pilot"));
    const plan = await createPlan(bm, planBody(aircraft.id, pilotId, { title: `今日の計画 ${stamp}` }));
    await page.goto("/ops");
    const card = page.getByTestId("today-card");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-plan-id", plan.id);
    await expect(page.getByTestId("today-card-title")).toHaveText(plan.title);
    await expect(page.getByTestId("today-card-time")).toHaveText("13:00〜14:00");
    await expect(page.getByTestId("today-card-aircraft")).toContainText(aircraft.registrationMark);
    await expect(page.getByTestId("today-card-pilot")).toHaveText("組織B 操縦者");
    await expect(page.getByTestId("today-card-verdict")).not.toHaveText("");
    await expect(page.getByTestId("today-card-report")).not.toHaveText("");
    await expect(page.getByTestId("today-card-confirmation")).not.toHaveText("");
    const primary = page.getByTestId("today-card-primary");
    await expect(primary).toHaveText("現場モードを開く");
    await expect(primary).toHaveAttribute("href", `/ops/plans/${plan.id}/field`);
    expect(await bodyText(page)).toContain(DISCLAIMER);
    await expectNoForbiddenWords(page, "今日");
    await expectNoHorizontalScroll(page, "今日");

    // 次にやること：動詞で始まる 1 行。点検なし・緊急用務空域の確認なし（飛行当日）
    const mine = (id: string) => page.locator(`[data-testid="today-next-action"][data-plan-id="${plan.id}"][data-action-id="${id}"]`);
    await expect(mine("do_inspection")).toHaveCount(1);
    await expect(mine("check_emergency_airspace")).toHaveCount(1);
    const labels = await page.getByTestId("today-next-action-label").allInnerTexts();
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toMatch(/[をにへ]|する|確認|記入|更新|開|依頼|入力|記録/);
    // 押すとその作業の画面へ直接移る（緊急用務空域の確認 → 現場モードの飛行前）
    await tapAndWait(page, mine("check_emergency_airspace").getByTestId("today-next-action-link"), new RegExp(`/ops/plans/${plan.id}/field#preflight$`));
    await expect(page.getByTestId("field-root")).toBeVisible();

    // 飛行中：着陸を記録する（最優先）。カードは「飛行中」の札
    const takeoff = await postEvent(bm, plan.id, { kind: "takeoff" });
    expect(takeoff.status(), await takeoff.text()).toBe(201);
    const takeoffEv = (await takeoff.json()) as { id: string };
    await page.goto("/ops");
    await expect(page.getByTestId("today-card").getByTestId("today-badge")).toHaveAttribute("data-code", "in_flight");
    await expect(page.getByTestId("today-card-reason")).toHaveText("飛行中");
    await expect(page.getByTestId("today-next-action").first()).toHaveAttribute("data-action-id", "record_landing");
    await tapAndWait(page, mine("record_landing").getByTestId("today-next-action-link"), new RegExp(`/ops/plans/${plan.id}/field`));

    // 日誌待ち：日誌を記入する → 計画の内容と離着陸の時刻が入った日誌の入力
    await postEvent(bm, plan.id, { kind: "landing", occurredAt: `${DAY}T12:03`, targetEventId: takeoffEv.id });
    await page.goto("/ops");
    await expect(page.getByTestId("today-card").getByTestId("today-badge")).toHaveAttribute("data-code", "journal_pending");
    await expect(mine("write_journal")).toHaveCount(1);
    await tapAndWait(page, mine("write_journal").getByTestId("today-next-action-link"), new RegExp(`/ops/flights/new\\?planId=${plan.id}&takeoffEventId=${takeoffEv.id}`));

    // 食い違い：計画の時間帯の外で飛んだ日誌を保存すると、直近 3 日間は「日誌の食い違いを確認する」が出る
    const field = await getField(bm, plan.id);
    expect(field.pendingJournalTakeoffEventIds).toEqual([takeoffEv.id]);
    const flight = await bm.post("/api/ops/flights", {
      data: {
        aircraftId: aircraft.id,
        pilotId,
        flightPlanId: plan.id,
        takeoffEventId: takeoffEv.id,
        purpose: "空撮",
        takeoffPlace: "試験地点",
        landingPlace: "試験地点",
        safetyIssue: false,
        takeoffAt: `${DAY}T12:00`,
        landingAt: `${DAY}T12:03`,
      },
    });
    expect(flight.status(), await flight.text()).toBe(201);
    await page.goto("/ops");
    await expect(page.getByTestId("today-card").getByTestId("today-badge")).toHaveAttribute("data-code", "journaled");
    await expect(mine("write_journal")).toHaveCount(0);
    const mismatch = page.locator('[data-testid="today-next-action"][data-action-id="review_journal_mismatch"]');
    await expect(mismatch.first()).toBeVisible();
    await expectNoForbiddenWords(page, "今日（食い違い）");
    await bm.dispose();
  });

  test("8・16. メニュー：スマホ（1024px 未満）は下の 5 タブ、PC は左メニュー。5 項目の行き先と現在地、375px で折り返さない・高さ 56px 以上・末尾が隠れない。現場モード・サインインでは出ない", async ({ page, browser }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, planBody(aircraft.id, await pilotIdOf(seeded("a-pilot"))));
    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");

    await page.goto("/ops");
    const nav = page.getByTestId("ops-bottom-nav");
    await expect(nav).toBeVisible();
    // 1024px 未満では左メニューは出ない（DOM にはあっても見えない）
    await expect(page.getByTestId("ops-sidebar")).toBeHidden();
    const items = [
      ["today", "ホーム", "/ops"],
      ["verdict", "判定", "/"],
      ["plans", "計画", "/ops/plans"],
      ["journal", "日誌", "/ops/journal"],
      ["more", "登録", "/ops/more"],
    ] as const;
    for (const [key, label, href] of items) {
      const link = nav.getByTestId(`nav-${key}`);
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toContainText(label);
      const box = (await link.boundingBox())!;
      expect(box.height, `${label} の高さ`).toBeGreaterThanOrEqual(56);
      // ラベルが折り返さない（1 行の高さ）
      const labelBox = (await link.locator("span").last().boundingBox())!;
      expect(labelBox.height, `${label} のラベルが折り返している`).toBeLessThan(24);
    }
    // 古い名称は出ない
    await expect(nav).not.toContainText("今日");
    await expect(nav).not.toContainText("その他");
    const widths = await Promise.all(items.map(async ([key]) => (await nav.getByTestId(`nav-${key}`).boundingBox())!.width));
    for (const w of widths) expect(Math.abs(w - 375 / 5)).toBeLessThan(2);
    await expectNoHorizontalScroll(page, "下メニュー");
    // 現在地は 4 つの手がかり（aria-current・data-active・太字・面の塗り）とアイコンで示す
    const here = nav.getByTestId("nav-today");
    const other = nav.getByTestId("nav-plans");
    await expect(here).toHaveAttribute("aria-current", "page");
    await expect(here).toHaveAttribute("data-active", "true");
    await expect(other).not.toHaveAttribute("aria-current", "page");
    const look = (loc: Locator) => loc.evaluate((el) => ({ weight: Number(getComputedStyle(el).fontWeight), bg: getComputedStyle(el).backgroundColor, icon: el.querySelectorAll("svg").length }));
    const [hereLook, otherLook] = [await look(here), await look(other)];
    expect(hereLook.weight).toBeGreaterThanOrEqual(600);
    expect(otherLook.weight).toBeLessThan(600);
    expect(hereLook.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(hereLook.bg).not.toBe(otherLook.bg);
    expect(hereLook.icon).toBeGreaterThanOrEqual(1);
    // ハンバーガーは使わない（メニューを開く・閉じるボタンがない）
    await expect(page.getByRole("button", { name: /メニューを開く|ハンバーガー/ })).toHaveCount(0);
    // 上の薄いバー：画面名と利用者メニュー
    await expect(page.getByTestId("ops-header")).toBeVisible();
    await expect(page.getByTestId("ops-screen-name")).toHaveText("ホーム");

    // 現在地：日誌は /ops/flights*・/ops/inspections*・/ops/journal・/ops/incidents*、計画は /ops/plans*、登録は /ops/more ほか
    const current: [string, string][] = [
      ["/ops/plans", "plans"],
      [`/ops/plans/${plan.id}`, "plans"],
      ["/ops/flights", "journal"],
      ["/ops/flights/new", "journal"],
      ["/ops/inspections", "journal"],
      ["/ops/journal", "journal"],
      ["/ops/incidents", "journal"],
      ["/ops/incidents/new", "journal"],
      ["/ops/more", "more"],
      ["/ops/aircraft", "more"],
    ];
    for (const [url, key] of current) {
      await page.goto(url);
      await expect(nav.getByTestId(`nav-${key}`), url).toHaveAttribute("data-active", "true");
      await expect(nav.locator('[data-active="true"]'), url).toHaveCount(1);
    }

    // 末尾が隠れない：一番下までスクロールしたとき、本文の末尾が下メニューの上にある
    await page.goto("/ops/more");
    await expect(page.getByTestId("ops-more")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const mainBottom = await page.evaluate(() => document.querySelector("main")!.getBoundingClientRect().bottom);
    const navTop = (await nav.boundingBox())!.y;
    expect(mainBottom).toBeLessThanOrEqual(navTop + 0.5);

    // 押すと行き先へ移る
    await page.goto("/ops");
    await tapAndWait(page, nav.getByTestId("nav-plans"), /\/ops\/plans$/);
    await tapAndWait(page, nav.getByTestId("nav-journal"), /\/ops\/journal$/);
    await tapAndWait(page, nav.getByTestId("nav-more"), /\/ops\/more$/);
    await tapAndWait(page, nav.getByTestId("nav-today"), /\/ops$/);
    await tapAndWait(page, nav.getByTestId("nav-verdict"), new RegExp(`^${BASE.replace(/[.]/g, "\\.")}/$`));
    // Next のクライアント遷移は、前の画面を隠して残す（Activity）。同じ data-testid が重ならないよう、読み直してから確かめる
    await page.reload();

    // ログイン済みの `/`：下メニューと「ホーム」の帯と、ホームへのリンク。自動では転送されない
    await expect(nav).toBeVisible();
    await expect(nav.getByTestId("nav-verdict")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("home-today-band")).toBeVisible();
    await expect(page.getByTestId("home-ops-link")).toBeVisible();
    await expect(page.getByTestId("home-ops-link")).toContainText("ホームへ");
    await expect(page.getByTestId("home-today-band").getByTestId("today-next-action")).not.toHaveCount(0);
    expect(await page.getByTestId("home-today-band").getByTestId("today-next-action").count()).toBeLessThanOrEqual(3);
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe("/");

    // 現場モードでは、メニューも上のバー（利用者メニュー）も出さない
    await openField(page, plan.id);
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(page.getByTestId("ops-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("ops-header")).toHaveCount(0);
    await expect(page.getByTestId("user-menu-button")).toHaveCount(0);
    // 現場モードの退路は「ホームへ戻る」（押せる範囲 56px 以上）
    await expect(page.getByTestId("field-back")).toContainText("ホームへ戻る");
    expect((await page.getByTestId("field-back").boundingBox())!.height).toBeGreaterThanOrEqual(56);

    // 768px・900px（1024px 未満）でも同じ 5 つの行き先に移れる
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/ops");
    await expect(nav).toBeVisible();
    for (const [key, , href] of items) await expect(nav.getByTestId(`nav-${key}`)).toHaveAttribute("href", href);
    await tapAndWait(page, nav.getByTestId("nav-journal"), /\/ops\/journal$/);

    // PC（1280px）は左メニュー：上から ホーム／調べる＝判定／飛ばす＝計画・日誌／登録（機体・操縦者・許可・承認・地点）
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/ops");
    const side = page.getByTestId("ops-sidebar");
    await expect(side).toBeVisible();
    await expect(nav).toBeHidden();
    expect((await side.locator('a[data-testid^="nav-"]').allInnerTexts()).map((t) => t.trim())).toEqual(["ホーム", "判定", "計画", "日誌", "登録", "機体", "操縦者", "許可・承認", "地点"]);
    await expect(side).toContainText("調べる");
    await expect(side).toContainText("飛ばす");
    for (const [key, , href] of items) await expect(side.getByTestId(`nav-${key}`)).toHaveAttribute("href", href);
    for (const [key, href] of [["aircraft", "/ops/aircraft"], ["pilots", "/ops/pilots"], ["permits", "/ops/permits"], ["places", "/ops/places"]] as const) {
      await expect(side.getByTestId(`nav-${key}`)).toHaveAttribute("href", href);
    }
    for (const a of await side.locator('a[data-testid^="nav-"]').all()) expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // 現在地（子項目は子が現在地、親の「登録」は太字だけの祖先）
    await expect(side.getByTestId("nav-today")).toHaveAttribute("aria-current", "page");
    await page.goto("/ops/aircraft");
    await expect(side.getByTestId("nav-aircraft")).toHaveAttribute("data-active", "true");
    await expect(side.getByTestId("nav-aircraft")).toHaveAttribute("aria-current", "page");
    await expect(side.getByTestId("nav-more")).toHaveAttribute("data-active", "false");
    await expect(side.getByTestId("nav-more")).toHaveAttribute("data-ancestor", "true");
    await expect(side.locator('[data-active="true"]')).toHaveCount(1);
    await page.goto("/ops/incidents");
    await expect(side.getByTestId("nav-journal")).toHaveAttribute("data-active", "true");
    // 利用者メニューは PC でも右上にある
    await expect(page.getByTestId("user-menu-button")).toBeVisible();
    await page.goto("/ops");
    await tapAndWait(page, side.getByTestId("nav-journal"), /\/ops\/journal$/);
    await tapAndWait(page, side.getByTestId("nav-more"), /\/ops\/more$/);
    await tapAndWait(page, side.getByTestId("nav-pilots"), /\/ops\/pilots$/);

    // サインイン画面（未ログイン）には出ない
    const anon = await browser.newContext({ baseURL: BASE, viewport: { width: 375, height: 812 } });
    const ap = await anon.newPage();
    await ap.goto("/ops/sign-in");
    await expect(ap.locator("main").first()).toBeVisible();
    await expect(ap.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(ap.getByTestId("ops-sidebar")).toHaveCount(0);
    await expect(ap.getByTestId("user-menu-button")).toHaveCount(0);
    await anon.close();
    await settle(manager, plan.id);
    await manager.dispose();
  });

  test("16. ログインしていない `/` には下メニューも「ホーム」の帯もなく、運航管理への追加の通信もない", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    await page.goto("/");
    await expect(page.getByTestId("site-ops-note")).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    await expect(page.getByTestId("home-today-band")).toHaveCount(0);
    await expect(page.getByTestId("home-ops-link")).toHaveCount(0);
    expect(requested.filter((p) => p.startsWith("/ops") || p.startsWith("/api/ops"))).toEqual([]);
    await ctx.close();
  });

  test("9. 日誌の統合：/ops/journal の入口・切り替え・最近 14 日の合算の一覧（食い違いの札）と、/ops/more", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const selfPilot = await pilotIdOf(seeded("a-pilot"));
    const aircraft = await createAircraft(manager);
    const old = await createAircraft(manager);
    const plan = await createPlan(manager, nightPlan(aircraft.id, selfPilot));
    // 計画の時間帯の外（10:00〜10:30）で飛んだ飛行記録（夜間飛行で通報の記録なし）と、日常点検
    const flightRes = await manager.post("/api/ops/flights", {
      data: {
        aircraftId: aircraft.id,
        pilotId: selfPilot,
        flightPlanId: plan.id,
        purpose: "空撮",
        takeoffPlace: "試験地点",
        landingPlace: "試験地点",
        safetyIssue: false,
        takeoffAt: `${DAY}T10:00`,
        landingAt: `${DAY}T10:30`,
      },
    });
    expect(flightRes.status(), await flightRes.text()).toBe(201);
    const flightJson = (await flightRes.json()) as { id: string; warnings: string[]; mismatches: { code: string; label: string }[] };
    expect(flightJson.warnings).toEqual(expect.arrayContaining(["outside_plan_window", "report_missing"]));
    const insp = await createInspection(manager, aircraft.id, selfPilot, `${DAY}T09:30`);
    // 20 日前の飛行記録は最近 14 日の一覧に出ない（既存の一覧には出る）
    const oldRes = await manager.post("/api/ops/flights", {
      data: { aircraftId: old.id, pilotId: selfPilot, purpose: "空撮", takeoffPlace: "本社", landingPlace: "本社", safetyIssue: false, takeoffAt: "2026-12-16T10:00", landingAt: "2026-12-16T10:20" },
    });
    expect(oldRes.status(), await oldRes.text()).toBe(201);
    const oldFlight = (await oldRes.json()) as { id: string };

    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    await page.goto("/ops/journal");
    await expect(page.getByTestId("ops-journal")).toBeVisible();
    const newFlight = page.getByTestId("journal-new-flight");
    const newInspection = page.getByTestId("journal-new-inspection");
    for (const b of [newFlight, newInspection]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await expect(page.getByTestId("journal-range")).toContainText("2026-12-23");
    // 合算の一覧：飛行記録と日常点検が日付順に混ざり、食い違いの札が出る
    const flightRow = page.locator(`[data-testid="journal-row"][data-kind="flight"]:has(a[href="/ops/flights/${flightJson.id}"])`);
    await expect(flightRow).toHaveCount(1);
    await expect(flightRow.getByTestId("flight-mismatch")).toHaveCount(2);
    await expect(flightRow.locator('[data-code="outside_plan_window"]')).toContainText("計画の時間帯の外で飛行しています");
    await expect(flightRow.locator('[data-code="outside_plan_window"]')).toContainText("離陸が 180 分早い");
    await expect(flightRow.locator('[data-code="report_missing"]')).toContainText("離陸の時点で DIPS の通報の記録がありません");
    await expect(page.locator(`[data-testid="journal-row"][data-kind="inspection"]:has(a[href="/ops/inspections/${insp.id}"])`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="journal-row"]:has(a[href="/ops/flights/${oldFlight.id}"])`)).toHaveCount(0);
    await expectNoForbiddenWords(page, "日誌");
    await expectNoHorizontalScroll(page, "日誌");

    // 切り替え
    await tapAndWait(page, page.getByTestId("journal-tab-flights"), /tab=flights$/);
    await page.reload();
    await expect(page.locator('[data-testid="journal-row"][data-kind="inspection"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="journal-row"][data-kind="flight"]').first()).toBeVisible();
    await tapAndWait(page, page.getByTestId("journal-tab-inspections"), /tab=inspections$/);
    await page.reload();
    await expect(page.locator('[data-testid="journal-row"][data-kind="flight"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="journal-row"][data-kind="inspection"]').first()).toBeVisible();

    // 入口と既存の一覧・詳細（経路・data-testid・機能は変わらない）
    await page.goto("/ops/journal");
    await tapAndWait(page, page.getByTestId("journal-new-flight"), /\/ops\/flights\/new$/);
    await page.goto("/ops/journal");
    await tapAndWait(page, page.getByTestId("journal-new-inspection"), /\/ops\/inspections\/new$/);
    await page.goto("/ops/flights");
    await expect(page.getByTestId("flight-list")).toBeVisible();
    await expect(page.locator(`[data-testid="flight-list"] a[href="/ops/flights/${oldFlight.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="flight-list"] a[href="/ops/flights/${flightJson.id}"] [data-testid="flight-mismatch"]`)).toHaveCount(2);
    await page.goto("/ops/inspections");
    await expect(page.getByTestId("inspection-list")).toBeVisible();
    await page.goto(`/ops/flights/${flightJson.id}`);
    await expect(page.getByTestId("flight-detail")).toBeVisible();
    await expect(page.getByTestId("flight-mismatches").getByTestId("flight-mismatch")).toHaveCount(2);
    await expect(page.getByTestId("flight-plan-link")).toBeVisible();
    await expect(page.getByTestId("flight-basis-link")).toBeVisible();

    // 登録：機体・操縦者・許可・承認・よく使う地点（件数つき）、管理の下に利用者（運航管理者のみ）。ログアウトは利用者メニューにある
    await page.goto("/ops/more");
    await expect(page.getByTestId("ops-more")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^登録/);
    for (const k of ["aircraft", "pilots", "permits", "places", "members"]) await expect(page.getByTestId(`more-link-${k}`)).toBeVisible();
    await expect(page.getByTestId("more-link-incidents")).toHaveCount(0);
    await expect(page.getByTestId("more-admin").getByTestId("more-link-members")).toBeVisible();
    await expect(page.getByTestId("more-count-aircraft")).toContainText(/^\d+ 機$/);
    await expect(page.getByTestId("dips-note")).toContainText("未接続");
    await expect(page.getByTestId("dips-note").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("signout")).toHaveCount(0);
    await openUserMenu(page);
    await expect(page.getByTestId("signout")).toBeVisible();
    for (const b of await page.getByTestId("more-menu").locator("a").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await expect(page.getByTestId("more-link-members")).toBeVisible();
    expect((await page.getByTestId("more-link-members").boundingBox())!.height).toBeGreaterThanOrEqual(56);
    // 日誌の中に事故・ヒヤリハット（4 つ目の種類と、入力の入口）
    await page.goto("/ops/journal");
    await expect(page.getByTestId("journal-tab-incidents")).toHaveAttribute("href", "/ops/incidents");
    await expect(page.getByTestId("journal-new-incident")).toHaveAttribute("href", "/ops/incidents/new");
    expect((await page.getByTestId("journal-new-incident").boundingBox())!.height).toBeGreaterThanOrEqual(56);
    const pilotPage = await page.context().browser()!.newContext({ baseURL: BASE, viewport: { width: 375, height: 812 } });
    await signIn(pilotPage.request, seeded("a-pilot"));
    const pp = await pilotPage.newPage();
    await pp.goto("/ops/more");
    await expect(pp.getByTestId("more-link-pilots")).toBeVisible();
    await expect(pp.getByTestId("more-link-members")).toHaveCount(0);
    await pilotPage.close();
    await settle(manager, plan.id);
    await manager.dispose();
  });

  test("10. 飛行前：4 項目が 1 項目 1 行で「済（時刻）／未」。日常点検は実際の点検から導出し、入力して保存すると現場モードへ戻る。緊急用務空域は情報源と結果を選ぶまで記録できない", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const selfPilot = await pilotIdOf(seeded("a-pilot"));
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, nightPlan(aircraft.id, selfPilot));
    await signIn(page.request, seeded("a-pilot"));
    await fixClock(page, "12:00:10");
    const dialogs = watchDialogs(page);
    await openField(page, plan.id);

    // 4 項目、状態は文字で
    for (const item of ["inspection", "emergency_airspace", "report_recheck", "carry"]) {
      await expect(page.getByTestId(`field-item-${item}`)).toHaveCount(1);
      await expect(page.getByTestId(`field-item-state-${item}`)).toContainText("未");
    }
    await expect(page.locator('[data-testid^="field-item-state-"]')).toHaveCount(4);

    // 日常点検：点検なし → 「日常点検をする」から入力して保存すると現場モードへ戻る（機体・実施者は引き継がれる）
    const link = page.getByTestId("field-inspection-link");
    await expect(link).toHaveText("日常点検をする");
    await tapAndWait(page, link, /\/ops\/inspections\/new\?planId=/);
    const iform = page.getByRole("form", { name: "日常点検の入力" });
    await expect(iform.getByRole("combobox", { name: "機体", exact: true })).toHaveValue(aircraft.id);
    await expect(iform.getByRole("combobox", { name: "実施者", exact: true })).toHaveValue(selfPilot);
    await iform.getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
    await page.getByRole("button", { name: "すべて正常" }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/ops/plans/${plan.id}/field#preflight$`));
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(page.getByTestId("field-item-state-inspection")).toContainText("済");
    await expect(page.getByTestId("field-item-state-inspection")).toContainText("12:00");

    // 緊急用務空域：情報源と結果を選ぶまで記録できない（画面は押せず、API は 400）
    await expect(page.getByTestId("field-em-submit")).toBeDisabled();
    await expect(page.getByTestId("field-em-hint")).toBeVisible();
    const bad = await postEvent(await apiAs(seeded("a-pilot")), plan.id, { kind: "check", item: "emergency_airspace" });
    expect(bad.status()).toBe(400);
    await page.getByTestId("field-em-source").selectOption({ index: 1 });
    await expect(page.getByTestId("field-em-submit")).toBeDisabled();
    await page.getByTestId("field-em-result-designated").click();
    await expect(page.getByTestId("field-em-submit")).toBeEnabled();
    // 「指定されている」→ 最上位の警告が出て、記録は残る
    await page.getByTestId("field-em-submit").click();
    await expect(page.getByTestId("field-emergency-warning")).toContainText("緊急用務空域に指定されています");
    await expect(page.getByTestId("field-item-state-emergency_airspace")).toContainText("済");
    await expect(page.getByTestId("field-emergency-result")).toContainText("指定されている");
    await expect.poll(async () => (await getEvents(manager, plan.id)).filter((e) => e.kind === "check" && e.item === "emergency_airspace").length).toBe(1);
    // 取り消す（確認ダイアログは出ない）
    await page.getByTestId("field-item-undo-emergency_airspace").click();
    await expect(page.getByTestId("field-item-state-emergency_airspace")).toContainText("未");
    await expect(page.getByTestId("field-emergency-warning")).toHaveCount(0);
    // 指定されていない → 済
    await page.getByTestId("field-em-source").selectOption({ index: 1 });
    await page.getByTestId("field-em-result-not_designated").click();
    await page.getByTestId("field-em-submit").click();
    await expect(page.getByTestId("field-item-state-emergency_airspace")).toContainText("済");
    await expect(page.getByTestId("field-emergency-warning")).toHaveCount(0);

    // 通報済みの再確認：記録なし → 警告と「通報内容を開く」。手動の記録を足すと日時・番号を再掲し、「再確認した」で済になる
    await expect(page.getByTestId("field-report-warning")).toContainText("通報の記録がありません");
    await expect(page.getByTestId("field-report-open")).toHaveAttribute("href", `/ops/plans/${plan.id}/report`);
    await expect(page.getByTestId("field-recheck-submit")).toHaveCount(0);
    // 通報の記録は、確認を依頼した計画にだけできる
    const req = await manager.post(`/api/ops/plans/${plan.id}/request-confirmation`, { data: { expectedVersion: plan.version } });
    expect(req.status(), await req.text()).toBe(200);
    const active = (await (await manager.get(`/api/ops/plans/${plan.id}`)).json()) as PlanJson;
    const rep = await manager.post(`/api/ops/plans/${plan.id}/reports`, {
      data: {
        kind: "new",
        expectedPlanVersion: active.version,
        inputs: { flightSpeed: 40, assistantsNumber: 1 },
        manual: { reportedAt: "2027-01-05T11:30", dipsNumber: "FP-E2E-12C1", confirmedDipsDone: true, confirmedMatchesLatest: true },
      },
    });
    expect(rep.status(), await rep.text()).toBe(201);
    await openField(page, plan.id);
    await expect(page.getByTestId("field-report-status")).toContainText("DIPS で通報済み（利用者の申告・手動記録）");
    await expect(page.getByTestId("field-report-detail")).toContainText("FP-E2E-12C1");
    await expect(page.getByTestId("field-report-detail")).toContainText("手動（利用者の申告）");
    await expect(page.getByTestId("field-report-warning")).toHaveCount(0);
    await page.getByTestId("field-recheck-submit").click();
    await expect(page.getByTestId("field-item-state-report_recheck")).toContainText("済");

    // 携行品
    await expect(page.getByTestId("field-permits")).toBeVisible();
    await page.getByTestId("field-carry-submit").click();
    await expect(page.getByTestId("field-item-state-carry")).toContainText("済");
    await page.getByTestId("field-item-undo-carry").click();
    await expect(page.getByTestId("field-item-state-carry")).toContainText("未");

    // 4 項目すべて済みなら、離陸の予告に未了が出ない（携行品は取り消したので「携行品の確認」だけ）
    await expect(page.getByTestId("field-takeoff-preview")).toContainText("携行品の確認");
    expect(dialogs).toEqual([]);

    // 異常ありの点検：「異常あり」を目立たせ、飛行を止めて不具合を確認と案内する（止めはしない）
    const aircraft2 = await createAircraft(manager);
    const plan2 = await createPlan(manager, planBody(aircraft2.id, selfPilot, { latitude: CLEAR_SPOT.lat, longitude: CLEAR_SPOT.lng }));
    const abnormal = await manager.post("/api/ops/inspections", {
      data: {
        aircraftId: aircraft2.id,
        pilotId: selfPilot,
        inspectedAt: `${DAY}T11:30`,
        timing: "pre_flight",
        placeName: "本社 駐車場",
        items: { ...ALL_NORMAL, propeller: { result: "abnormal", note: "欠け" } },
      },
    });
    expect(abnormal.status(), await abnormal.text()).toBe(201);
    await openField(page, plan2.id);
    await expect(page.getByTestId("field-item-state-inspection")).toContainText("異常あり");
    await expect(page.getByTestId("field-inspection-abnormal")).toContainText("飛行を止めて不具合を確認してください");
    await expect(page.getByTestId("field-flight-button")).toBeEnabled();
    // 通報の記録を必須としない計画（推奨・対象外）：「通報不要」とは出ない
    await expect(page.getByTestId("field-report-not-required")).toContainText("通報の記録を必須としません");
    await expectNoForbiddenWords(page, "現場モード");

    // returnTo は同じオリジンの /ops/ 配下だけ。外のアドレスは使わず、保存後は点検の詳細へ
    await page.goto(`/ops/inspections/new?planId=${plan2.id}&returnTo=${encodeURIComponent("//evil.example/ops/x")}`);
    const f2 = page.getByRole("form", { name: "日常点検の入力" });
    await f2.getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
    await page.getByRole("button", { name: "すべて正常" }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page).toHaveURL(/\/ops\/inspections\/[0-9a-f-]{36}$/);

    await settle(manager, plan.id);
    await settle(manager, plan2.id);
    await manager.dispose();
  });

  test("11. 離着陸：大きなボタンは常に 1 つ。確認ダイアログなし、未了事項があっても記録され、取り消せる。二度押しは 1 行。経過時間。時間帯の外の知らせ。繰り返せる", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const selfPilot = await pilotIdOf(seeded("a-pilot"));
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, nightPlan(aircraft.id, selfPilot));
    await signIn(page.request, seeded("a-pilot"));
    await fixClock(page, "12:00:10");
    const dialogs = watchDialogs(page);
    await openField(page, plan.id);

    const btn = page.getByTestId("field-flight-button");
    await expect(btn).toHaveCount(1);
    await expect(btn).toHaveText("離陸");
    await expect(page.getByTestId("field-takeoff-preview")).toContainText("次の項目が未了です");
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(80);
    expect((await btn.boundingBox())!.width).toBeGreaterThanOrEqual(375 - 2 * 16 - 1);

    // 二度押し（1.5 秒以内）で行が 2 件にならない。直後に「離陸 12:00 を記録しました。次の項目が未了です：…」
    await btn.click();
    await btn.click();
    await expect(page.getByTestId("field-banner-text")).toContainText("離陸 12:00 を記録しました。次の項目が未了です：");
    await expect(page.getByTestId("field-banner-text")).toContainText("日常点検");
    await expect(btn).toHaveText("着陸");
    await expect(page.getByTestId("field-flight-button")).toHaveCount(1);
    await expect(page.getByTestId("field-elapsed")).toHaveText(/^\d:\d\d:\d\d$/);
    expect(await page.getByTestId("field-elapsed").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(48);
    await expect(page.getByTestId("field-unsent")).toHaveAttribute("data-count", "0");
    await page.waitForTimeout(1200);
    let events = await getEvents(manager, plan.id);
    expect(events.filter((e) => e.kind === "takeoff")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "landing")).toHaveLength(0);
    expect(events[0]!.queued).toBe(false);

    // 取り消す：帯の「取り消す」で戻る（ダイアログなし）
    await page.getByTestId("field-banner-undo").click();
    await expect(btn).toHaveText("離陸");
    await expect.poll(async () => (await getEvents(manager, plan.id)).filter((e) => e.kind === "undo").length).toBe(1);

    // もう一度離陸 → 12:03 に着陸（計画の時間帯の外）
    await page.waitForTimeout(1600);
    await btn.click();
    await expect(btn).toHaveText("着陸");
    await fixClock(page, "12:03:05");
    await page.waitForTimeout(1600);
    await btn.click();
    await expect(page.getByTestId("field-banner-text")).toContainText("着陸 12:03 を記録しました。");
    await expect(page.getByTestId("field-banner-text")).toContainText("計画の時間帯の外です。");
    await expect(btn).toHaveText("離陸");
    await expect(page.getByTestId("field-journal-link")).toHaveCount(1);

    // 離着陸を繰り返せる（2 回目）
    await page.waitForTimeout(1600);
    await btn.click();
    await expect(btn).toHaveText("着陸");
    await fixClock(page, "12:04:05");
    await page.waitForTimeout(1600);
    await btn.click();
    await expect(btn).toHaveText("離陸");
    await expect(page.getByTestId("field-flight-row")).toHaveCount(2);
    await expect(page.getByTestId("field-journal-link")).toHaveCount(2);
    await page.reload();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(page.getByTestId("field-flight-row")).toHaveCount(2);
    await expect(page.getByTestId("field-flight-row").first()).toHaveAttribute("data-phase", "journal_pending");
    await expect(page.getByTestId("field-flight-gaps").first()).toContainText("離陸時の未了");
    events = await getEvents(manager, plan.id);
    expect(events.filter((e) => e.kind === "takeoff")).toHaveLength(3);
    expect(events.filter((e) => e.kind === "landing")).toHaveLength(2);

    // 着陸の取り消し → 離陸の取り消しの順（着陸がある離陸は取り消せない）
    await expect(page.getByTestId("field-undo-landing").last()).toBeVisible();
    await page.getByTestId("field-undo-landing").last().click();
    await expect(page.getByTestId("field-flight-row").last()).toHaveAttribute("data-phase", "in_flight");
    await expect(btn).toHaveText("着陸");
    await expect(page.getByTestId("field-undo-takeoff")).toBeVisible();
    expect(dialogs).toEqual([]);
    await page.waitForTimeout(1200);

    // 中止した計画：新しい離陸はできず（理由を表示）、開いている離陸の着陸はできる
    const plan2 = await createPlan(manager, planBody(aircraft.id, selfPilot));
    const cancelOnly = await createPlan(manager, planBody(aircraft.id, selfPilot));
    const t = await postEvent(manager, plan2.id, { kind: "takeoff" });
    expect(t.status()).toBe(201);
    for (const id of [plan2.id, cancelOnly.id]) {
      const v = (await (await manager.get(`/api/ops/plans/${id}`)).json()) as { version: number };
      expect((await manager.post(`/api/ops/plans/${id}/void`, { data: { expectedVersion: v.version, reason: "試験" } })).status()).toBe(200);
    }
    await openField(page, cancelOnly.id);
    await expect(page.getByTestId("field-cancelled")).toBeVisible();
    await expect(page.getByTestId("field-flight-button")).toHaveCount(1);
    await expect(page.getByTestId("field-flight-button")).toBeDisabled();
    await expect(page.getByTestId("field-takeoff-blocked")).toContainText("新しい離陸は記録できません");
    await openField(page, plan2.id);
    await expect(page.getByTestId("field-flight-button")).toHaveText("着陸");
    await expect(page.getByTestId("field-flight-button")).toBeEnabled();
    await page.getByTestId("field-flight-button").click();
    await expect(page.getByTestId("field-banner-text")).toContainText("着陸");
    await expect.poll(async () => (await getEvents(manager, plan2.id)).filter((e) => e.kind === "landing").length).toBe(1);
    expect(dialogs).toEqual([]);

    await settle(manager, plan.id);
    await settle(manager, plan2.id);
    await manager.dispose();
  });

  test("12. 日誌：着陸後に「日誌を記入する」で実際の離着陸の時刻と飛行前の点検が入った入力が開き、保存すると日誌済み。食い違いは保存後に知らされ、札と未了事項の写しが出る", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const selfPilot = await pilotIdOf(seeded("a-pilot"));
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, nightPlan(aircraft.id, selfPilot));
    const insp = await createInspection(manager, aircraft.id, selfPilot);
    await signIn(page.request, seeded("a-pilot"));
    await fixClock(page, "12:00:10");
    await openField(page, plan.id);
    await expect(page.getByTestId("field-item-state-inspection")).toContainText("済");

    await page.getByTestId("field-flight-button").click();
    await expect(page.getByTestId("field-flight-button")).toHaveText("着陸");
    await fixClock(page, "12:03:05");
    await page.waitForTimeout(1600);
    await page.getByTestId("field-flight-button").click();
    await expect(page.getByTestId("field-journal-link")).toBeVisible();
    await expect(page.getByTestId("field-unsent")).toHaveAttribute("data-count", "0");

    const field = await getField(manager, plan.id);
    const takeoffId = field.flights[0]!.takeoffEventId;
    await tapAndWait(page, page.getByTestId("field-journal-link"), new RegExp(`/ops/flights/new\\?planId=${plan.id}&takeoffEventId=${takeoffId}$`));
    const form = page.getByRole("form", { name: "飛行記録の入力" });
    await expect(page.getByTestId("flight-from-field")).toBeVisible();
    // 実際の離着陸の時刻（計画の予定時刻 13:00〜14:00 は入らない）
    await expect(form.getByLabel("離陸日", { exact: true })).toHaveValue(DAY);
    await expect(form.getByLabel("離陸時刻", { exact: true })).toHaveValue("12:00");
    await expect(form.getByLabel("着陸時刻", { exact: true })).toHaveValue("12:03");
    // 計画の機体・操縦者・目的・場所・特定飛行の形態、飛行前の点検
    await expect(form.getByRole("combobox", { name: "機体", exact: true })).toHaveValue(aircraft.id);
    await expect(form.getByRole("combobox", { name: "操縦者", exact: true })).toHaveValue(selfPilot);
    await expect(form.getByLabel("飛行の目的")).toHaveValue("空撮");
    await expect(form.getByRole("textbox", { name: "離陸場所", exact: true })).toHaveValue("試験地点");
    await expect(page.getByTestId("inspection-select")).toHaveValue(insp.id);
    await expect(form.getByRole("checkbox", { name: /夜間飛行/ })).toBeChecked();
    // 「安全に影響のあった事項」を確かめて保存
    await form.getByRole("radio", { name: "なし" }).check();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page).toHaveURL(/\/ops\/flights\/[0-9a-f-]{36}$/);
    const flightId = page.url().split("/").pop()!;

    // 保存は成功し、食い違いが知らされる。詳細に札と未了事項の写し
    await expect(page.getByTestId("ops-change-notice")).toContainText("飛行記録を保存しました。");
    await expect(page.getByTestId("ops-change-notice")).toContainText("計画の時間帯の外で飛行しています");
    await expect(page.getByTestId("ops-change-notice")).toContainText("離陸の時点で DIPS の通報の記録がありません");
    await expect(page.getByTestId("flight-takeoff")).toHaveText("12:00");
    await expect(page.getByTestId("flight-landing")).toHaveText("12:03");
    await expect(page.getByTestId("flight-mismatches").getByTestId("flight-mismatch")).toHaveCount(2);
    await expect(page.getByTestId("flight-takeoff-gaps")).toBeVisible();
    await expect(page.getByTestId("flight-takeoff-gaps")).toContainText("通報");
    await expect(page.getByTestId("flight-takeoff-gaps")).not.toContainText("日常点検");
    // 計画 → スナップショット → 証跡 ID への辿りは変わらない
    await expect(page.getByTestId("flight-plan-link")).toHaveAttribute("href", `/ops/plans/${plan.id}`);
    await expect(page.getByTestId("flight-basis-link")).toHaveAttribute("href", `/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`);

    // 日誌済みになり、計画の画面に記録が並ぶ。現場モードに戻れる
    await tapAndWait(page, page.getByTestId("flight-field-link"), new RegExp(`/ops/plans/${plan.id}/field$`));
    await expect(page.getByTestId("field-flight-row")).toHaveAttribute("data-phase", "journaled");
    await expect(page.getByTestId("field-flight-record-link")).toHaveAttribute("href", `/ops/flights/${flightId}`);
    await expect(page.getByTestId("field-journal-link")).toHaveCount(0);
    await page.goto(`/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-flight-row")).toHaveCount(1);

    // 飛行記録を取り消すと、その飛行は日誌待ちに戻る
    const fl = (await (await manager.get(`/api/ops/flights/${flightId}`)).json()) as { version: number; takeoffEventId: string };
    expect(fl.takeoffEventId).toBe(takeoffId);
    expect((await manager.post(`/api/ops/flights/${flightId}/void`, { data: { expectedVersion: fl.version, reason: "試験" } })).status()).toBe(200);
    await openField(page, plan.id);
    await expect(page.getByTestId("field-flight-row")).toHaveAttribute("data-phase", "journal_pending");
    await expect(page.getByTestId("field-journal-link")).toHaveCount(1);
    await settle(manager, plan.id);
    await manager.dispose();
  });

  test("13. 端末の保存（送信待ち）：圏外でも押した結果が反映され、戻ると順番に二重なく送られる。応答を落としても 1 件。4xx は黙って捨てない。ログアウトは未送信を警告する", async ({ page, context }) => {
    const manager = await apiAs(seeded("a-manager"));
    const selfPilot = await pilotIdOf(seeded("a-pilot"));
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, planBody(aircraft.id, selfPilot));
    const me = (await (await (await apiAs(seeded("a-pilot"))).get("/api/ops/me")).json()) as { member: { id: string } };
    await signIn(page.request, seeded("a-pilot"));
    await fixClock(page, "12:00:10");
    const dialogs = watchDialogs(page);
    await openField(page, plan.id);
    const btn = page.getByTestId("field-flight-button");
    const storageKey = `soraban:ops-draft:field-${plan.id}:${me.member.id}`;

    // 圏外：押した結果は画面に反映され、未送信が増える。サーバーには届かない
    await context.setOffline(true);
    await btn.click();
    await expect(btn).toHaveText("着陸");
    await expect(page.getByTestId("field-banner-text")).toContainText("離陸 12:00 を記録しました。");
    await expect(page.getByTestId("field-unsent")).toContainText("未送信 1 件");
    await expect(page.getByTestId("field-elapsed")).toBeVisible();
    await fixClock(page, "12:02:05");
    await page.waitForTimeout(1600);
    await btn.click();
    await expect(btn).toHaveText("離陸");
    await expect(page.getByTestId("field-unsent")).toContainText("未送信 2 件");
    // 端末に残る内容：計画の ID・種別・時刻・識別子だけ（氏名・技能証明書番号・座標を含まない）
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), storageKey);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { entries: Record<string, unknown>[] };
    expect(parsed.entries.map((e) => e["kind"])).toEqual(["takeoff", "landing"]);
    for (const e of parsed.entries) {
      for (const k of Object.keys(e)) expect(["clientEventId", "kind", "occurredAt", "targetEventId", "targetClientEventId", "item", "result", "source", "status", "attempts", "rejection"]).toContain(k);
    }
    expect(stored).not.toMatch(/操縦|一郎|TEST-|現場 |35\.4|133\.3|latitude|longitude/);
    expect(parsed.entries[1]!["targetClientEventId"]).toBe(parsed.entries[0]!["clientEventId"]);

    // 送信が 503 の間は、順序を守って後ろも送らない（サーバーには何も届かない）
    await page.route("**/field-events", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 503, body: "{}" }) : route.continue()));
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(1200);
    expect(await getEvents(manager, plan.id)).toHaveLength(0);
    await expect(page.getByTestId("field-unsent")).toContainText("未送信 2 件");
    // 戻ると、離陸 → 着陸の順に送られる。二重にならない
    await page.unroute("**/field-events");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByTestId("field-unsent")).toContainText("送信済み");
    const sent = await getEvents(manager, plan.id);
    expect(sent.map((e) => e.kind)).toEqual(["takeoff", "landing"]);
    expect(sent[0]!.queued).toBe(true);
    expect(sent[1]!.targetEventId).toBe(sent[0]!.id);
    await page.reload();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(page.getByTestId("field-flight-row")).toHaveCount(1);
    expect(await getEvents(manager, plan.id)).toHaveLength(2);

    // 応答を落とした再送でも行は 1 件（サーバーには届いたが、端末は届いたと分からない）
    let dropped = false;
    await page.route("**/field-events", async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.waitForTimeout(1600);
    await btn.click();
    await expect(btn).toHaveText("着陸");
    await expect(page.getByTestId("field-unsent")).toContainText("未送信 1 件");
    // the label comes from the device's own state; the server has the row once the dropped-response POST is committed
    await expect.poll(async () => (await getEvents(manager, plan.id)).filter((e) => e.kind === "takeoff").length).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByTestId("field-unsent")).toContainText("送信済み");
    expect((await getEvents(manager, plan.id)).filter((e) => e.kind === "takeoff")).toHaveLength(2);
    await page.unroute("**/field-events");

    // 4xx（端末の時計のずれ）は黙って捨てず、理由と「あとから入力」を出す。後ろの行を止めない
    await page.waitForTimeout(1600);
    await fixClock(page, "11:30:00");
    await btn.click();
    await expect(page.getByTestId("field-rejected-row")).toHaveCount(1);
    await expect(page.getByTestId("field-rejected-reason")).toContainText("端末の時刻がずれています");
    await expect(page.getByTestId("field-rejected-row")).toHaveAttribute("data-code", "clock_skew");
    await expect(page.getByTestId("field-rejected-after-entry")).toHaveAttribute("href", new RegExp(`/ops/flights/new\\?planId=${plan.id}$`));
    await expect(btn).toHaveText("着陸");
    await fixClock(page, "12:03:30");
    await page.waitForTimeout(1600);
    await expect(page.getByTestId("field-rejected-row")).toHaveCount(1);
    await btn.click();
    await expect(btn).toHaveText("離陸");
    await expect(page.getByTestId("field-unsent")).toContainText("送信済み");
    await page.getByTestId("field-rejected-discard").click();
    await expect(page.getByTestId("field-rejected-row")).toHaveCount(0);
    expect((await getEvents(manager, plan.id)).filter((e) => e.kind === "landing")).toHaveLength(2);

    // ログアウトは未送信があると警告し、黙って消さない
    await page.waitForTimeout(1600);
    await context.setOffline(true);
    await btn.click();
    await expect(page.getByTestId("field-unsent")).toContainText("未送信 1 件");
    await context.setOffline(false);
    await page.route("**/field-events", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 503, body: "{}" }) : route.continue()));
    await page.goto("/ops/more");
    // ログアウトは右上の利用者メニューの中。a click before hydration does nothing (no handler yet), so press again until the warning shows; with an unsent item
    // the hydrated click only ever opens the warning (never signs out), so repeating it is safe
    await expect(async () => {
      await openUserMenu(page);
      await page.getByTestId("signout").click();
      await expect(page.getByTestId("signout-warning")).toContainText("未送信 1 件があります", { timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe("/ops/more");
    expect(await page.evaluate((k) => window.localStorage.getItem(k), storageKey)).not.toBeNull();
    await page.getByTestId("signout-cancel").click();
    await expect(page.getByTestId("signout-warning")).toHaveCount(0);
    // 送れないままでは、ログアウトしない（残す）
    await page.getByTestId("signout").click();
    await page.getByTestId("signout-send").click();
    await expect(page.getByTestId("signout-warning")).toContainText("送れませんでした");
    expect(new URL(page.url()).pathname).toBe("/ops/more");
    expect(await page.evaluate((k) => window.localStorage.getItem(k), storageKey)).not.toBeNull();
    // 送れるようになったら、送ってからログアウトする
    await page.unroute("**/field-events");
    await page.getByTestId("signout-send").click();
    await expect(page).toHaveURL(/\/ops\/sign-in$/);
    expect((await getEvents(manager, plan.id)).filter((e) => e.kind === "takeoff")).toHaveLength(3);
    const left = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("soraban:ops-draft:")));
    expect(left).toEqual([]);

    // 他の利用者の保存は消える（共用の端末）
    await signIn(page.request, seeded("a-pilot"));
    await page.goto("/ops/more");
    await page.evaluate(() => window.localStorage.setItem("soraban:ops-draft:field-00000000-0000-4000-8000-000000000000:other-member", "{}"));
    await page.goto("/ops");
    await expect(page.getByTestId("ops-today")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.endsWith(":other-member")))).toEqual([]);
    expect(dialogs).toEqual([]);
    await settle(manager, plan.id);
    await manager.dispose();
  });

  test("13b. 端末に送信待ちを保存できなくても、押した離陸は失われない：注記が出て、サーバーに 1 件だけ記録され、注記は消える", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const selfPilot = await pilotIdOf(seeded("a-pilot"));
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, planBody(aircraft.id, selfPilot));
    await signIn(page.request, seeded("a-pilot"));
    // 送信待ちの保存だけを失敗させる（容量超過・無効化の再現）
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (String(k).startsWith("soraban:ops-draft:field-")) throw new DOMException("quota", "QuotaExceededError");
        return orig.call(this, k, v);
      };
    });
    await fixClock(page, "12:00:10");
    await openField(page, plan.id);
    const btn = page.getByTestId("field-flight-button");
    await btn.click();
    // 送信は自動で成功するので、押した結果が出て、サーバーに 1 件だけ記録され、注記は最後に消える
    await expect(btn).toHaveText("着陸", { timeout: 15_000 });
    await expect(page.getByTestId("field-outbox-unsaved")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("field-unsent")).toContainText("送信済み");
    const events = await getEvents(manager, plan.id);
    expect(events.filter((e) => e.kind === "takeoff")).toHaveLength(1);
  });

  test("14. 画面の消灯の防止：飛行中だけ取得し、着陸で解放する。非対応の端末では注記だけ", async ({ page, browser }) => {
    const manager = await apiAs(seeded("a-manager"));
    const selfPilot = await pilotIdOf(seeded("a-pilot"));
    const aircraft = await createAircraft(manager);
    const plan = await createPlan(manager, planBody(aircraft.id, selfPilot));
    await signIn(page.request, seeded("a-pilot"));
    await fixClock(page, "12:00:10");
    await page.addInitScript(() => {
      const w = window as unknown as { __wl: { requested: number; released: number } };
      w.__wl = { requested: 0, released: 0 };
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: async () => {
            w.__wl.requested += 1;
            return { release: async () => { w.__wl.released += 1; }, addEventListener: () => undefined };
          },
        },
      });
    });
    await openField(page, plan.id);
    const counts = () => page.evaluate(() => (window as unknown as { __wl: { requested: number; released: number } }).__wl);
    expect(await counts()).toEqual({ requested: 0, released: 0 });
    await page.getByTestId("field-flight-button").click();
    await expect.poll(async () => (await counts()).requested).toBe(1);
    await expect(page.getByTestId("field-wake-note")).toHaveCount(0);
    await fixClock(page, "12:02:05");
    await page.waitForTimeout(1600);
    await page.getByTestId("field-flight-button").click();
    await expect.poll(async () => (await counts()).released).toBe(1);

    // 非対応の端末：何も壊れず、飛行中に控えめな注記だけを出す
    const ctx2 = await browser.newContext({ baseURL: BASE, viewport: { width: 375, height: 812 }, hasTouch: true });
    const p2 = await ctx2.newPage();
    await signIn(p2.request, seeded("a-pilot"));
    await p2.clock.setFixedTime(at("12:00:10"));
    await p2.addInitScript(() => Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined }));
    const plan2 = await createPlan(manager, planBody(aircraft.id, selfPilot));
    await openField(p2, plan2.id);
    await expect(p2.getByTestId("field-wake-note")).toHaveCount(0);
    await p2.getByTestId("field-flight-button").click();
    await expect(p2.getByTestId("field-wake-note")).toContainText("画面の消灯を防げません");
    await expect(p2.getByTestId("field-flight-button")).toHaveText("着陸");
    await ctx2.close();
    await settle(manager, plan.id);
    await settle(manager, plan2.id);
    await manager.dispose();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`15. 現場モードの見た目の基準（${scheme === "light" ? "明るい" : "暗い"}配色）：寸法・文字の大きさ・コントラスト 7:1・色だけで区別しない`, async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      const selfPilot = await pilotIdOf(seeded("a-pilot"));
      const aircraft = await createAircraft(manager);
      const plan = await createPlan(manager, nightPlan(aircraft.id, selfPilot));
      // 状態を作る：点検（異常あり）・緊急用務空域（指定されている）・通報の記録なし
      const abnormal = await manager.post("/api/ops/inspections", {
        data: { aircraftId: aircraft.id, pilotId: selfPilot, inspectedAt: `${DAY}T11:30`, timing: "pre_flight", placeName: "本社", items: { ...ALL_NORMAL, battery: { result: "abnormal", note: "膨らみ" } } },
      });
      expect(abnormal.status()).toBe(201);
      const em = await postEvent(manager, plan.id, { kind: "check", item: "emergency_airspace", result: "designated", source: "mlit-emergency-airspace-qa" });
      expect(em.status(), await em.text()).toBe(201);
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page.request, seeded("a-pilot"));
      await fixClock(page, "12:00:10");
      await openField(page, plan.id);

      const label = `現場モード（${scheme}）`;
      await expectNoHorizontalScroll(page, label);
      await expectTapTargets(page, '[data-testid="field-root"]', `${label} 離陸前`, { bigTestId: "field-flight-button" });
      await expectFontSize(page, '[data-testid="field-root"]', 18, `${label} 離陸前`);
      await expectContrast(page, '[data-testid="field-root"]', 7, `${label} 離陸前`);
      // 状態の語は 20px 以上
      const samples = await collectTextSamples(page, '[data-testid="field-root"]');
      const stateWords = samples.filter((s) => s.testId?.startsWith("field-item-state-"));
      expect(stateWords.length).toBeGreaterThan(0);
      for (const s of stateWords) expect(s.fontSize, `${s.testId} の文字`).toBeGreaterThanOrEqual(20);
      // 色だけで区別しない：状態の語に記号と文字がある
      await expect(page.getByTestId("field-item-state-inspection")).toContainText("！");
      await expect(page.getByTestId("field-item-state-inspection")).toContainText("異常あり");
      await expect(page.getByTestId("field-emergency-warning")).toContainText("！");
      await expect(page.getByTestId("field-emergency-result")).toContainText("指定されている");
      await expect(page.getByTestId("field-item-state-report_recheck")).toContainText("－");
      await expect(page.getByTestId("field-item-state-report_recheck")).toContainText("未");
      await expect(page.getByTestId("field-steps")).toContainText("▶");

      // 飛行中の表示（離陸したあと）
      await page.getByTestId("field-flight-button").click();
      await expect(page.getByTestId("field-flight-button")).toHaveText("着陸");
      await expect(page.getByTestId("field-in-flight")).toContainText("▶");
      await expect(page.getByTestId("field-in-flight")).toContainText("飛行中");
      await expectTapTargets(page, '[data-testid="field-root"]', `${label} 飛行中`, { bigTestId: "field-flight-button" });
      await expectFontSize(page, '[data-testid="field-root"]', 18, `${label} 飛行中`);
      await expectContrast(page, '[data-testid="field-root"]', 7, `${label} 飛行中`);
      const elapsed = samples.length > 0 ? await page.getByTestId("field-elapsed").evaluate((el) => parseFloat(getComputedStyle(el).fontSize)) : 0;
      expect(elapsed).toBeGreaterThanOrEqual(48);
      // ホバーだけに頼る操作がない（:hover の規則にだけ現れる操作がない）。ホバーで表示が出入りする要素は作っていない
      expect(await page.locator('[data-testid="field-root"] [class*="group-hover"], [data-testid="field-root"] [class*="hover:block"]').count()).toBe(0);
      await expectNoForbiddenWords(page, label);
      await fixClock(page, "12:01:05");
      await page.waitForTimeout(1600);
      await page.getByTestId("field-flight-button").click();
      await expect(page.getByTestId("field-journal-link")).toBeVisible();
      await expectTapTargets(page, '[data-testid="field-root"]', `${label} 着陸後`, { bigTestId: "field-flight-button" });
      await expectContrast(page, '[data-testid="field-root"]', 7, `${label} 着陸後`);
      await settle(manager, plan.id);
      await manager.dispose();
    });
  }
});
