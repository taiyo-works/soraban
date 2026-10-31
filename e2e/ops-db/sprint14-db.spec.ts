import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { expandNextActions } from "../ops-menu";
import { expectContrast, expectFontSize, expectNoHorizontalScroll, expectTapTargets } from "../field-checks";

// Sprint 14 の E2E-DB（契約 D-1〜D-12）。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する
// （pnpm test:e2e:ops）。サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定。ブラウザの時計は page.clock で合わせる。
// 画面は 375×812（タッチ）と 1280×800 で確かめる。DIPS へは何も送らない。
// 注意：この仕様書は、ブラウザを使えない環境（Playwright の Chromium を入手できない環境）で書いたため、書いた時点では実行していない。
// 「実行した」とは言わない。実行できる環境で最初に通すこと。
// 識別子の一覧（Sprint 14）：field-docs-*（書類・手続き）、field-restriction-*（飛行自粛要請）、field-site-*（現場状況）、
// field-post-*（飛行後点検）、field-next-flight、field-round-label。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
type Who = { readonly authUserId: string; readonly email: string };
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

const DAY = "2027-01-05";
const NOW_JST = `${DAY}T12:00`;
const HQ = { lat: 35.434238, lng: 133.380508 };
const at = (hms: string) => new Date(`${DAY}T${hms}+09:00`);
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;
const ALL_NORMAL = Object.fromEntries(
  ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"].map((k) => [k, { result: "normal" }]),
);

const createAircraft = async (manager: APIRequestContext): Promise<{ id: string; registrationMark: string }> => {
  const registrationMark = `JUS14${stamp}${seq++}`;
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
const createPlan = async (ctx: APIRequestContext, aircraftId: string, pilotId: string): Promise<{ id: string }> => {
  const r = await ctx.post("/api/ops/plans", {
    data: { title: `S14 ${stamp}-${seq++}`, aircraftId, pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: HQ.lat, longitude: HQ.lng, flags: [] },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
};
const postEvent = (ctx: APIRequestContext, planId: string, body: Record<string, unknown>) =>
  ctx.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: NOW_JST, ...body } });
const createInspection = async (ctx: APIRequestContext, aircraftId: string, pilotId: string, inspectedAt: string, timing: "pre_flight" | "post_flight", extra: Record<string, unknown> = {}) => {
  const r = await ctx.post("/api/ops/inspections", { data: { aircraftId, pilotId, inspectedAt, timing, placeName: "本社 駐車場", items: ALL_NORMAL, ...extra } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
};
type FieldView = {
  docs: { key: string; status: string; effective: string; statusLabel: string }[];
  round: { number: number; restriction: { url: string | null }; site: { done: boolean } };
  postPendingCount: number;
  flights: { takeoffEventId: string; landingEventId: string | null; gaps: { item: string }[] }[];
};
const getField = async (ctx: APIRequestContext, planId: string): Promise<FieldView> => {
  const r = await ctx.get(`/api/ops/plans/${planId}/field`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as FieldView;
};
const settle = async (manager: APIRequestContext, planId: string): Promise<void> => {
  const v = await getField(manager, planId);
  for (const f of v.flights) if (f.landingEventId) await postEvent(manager, planId, { kind: "undo", targetEventId: f.landingEventId });
  for (const f of v.flights) await postEvent(manager, planId, { kind: "undo", targetEventId: f.takeoffEventId });
  const plan = (await (await manager.get(`/api/ops/plans/${planId}`)).json()) as { version: number };
  await manager.post(`/api/ops/plans/${planId}/void`, { data: { expectedVersion: plan.version, reason: "試験の後始末" } });
};
const openField = async (page: Page, planId: string): Promise<void> => {
  await page.goto(`/ops/plans/${planId}/field`);
  await expect(page.getByTestId("field-root")).toBeVisible();
  await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
};
/** リンクを押して URL の遷移まで確かめる（12a・12b の作法。取りこぼしたら押し直し、最後は href へ直接移る）。 */
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
  await page.goto((await link.getAttribute("href"))!);
  await page.waitForURL(url);
};
/** 過去の時刻の事実を送信待ちの経路（queued: true。72 時間まで）で記録する。サーバーの固定時計（JST 12:00）より未来にしない。 */
const postPast = (ctx: APIRequestContext, planId: string, hm: string, body: Record<string, unknown>) =>
  postEvent(ctx, planId, { occurredAt: `${DAY}T${hm}`, queued: true, ...body });
const DOC_KEYS = ["permit", "registration", "remote_id", "license", "report", "manual"] as const;
const STATE_WORDS = /確認済み|要確認|満たさない/;

test.describe.configure({ mode: "serial" });

for (const vp of [
  { name: "375×812", width: 375, height: 812 },
  { name: "1280×800", width: 1280, height: 800 },
]) {
  test.describe(`Sprint 14 現場画面 ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width < 600, timezoneId: "America/Los_Angeles" });

    test("D-1〜D-3・D-5・D-6：書類・手続き 6 項目の状態（文字と形）、根拠、1 タップの確認と取り消し、空域、現場状況の入力", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      await signIn(page.request, seeded("a-manager"));
      await page.clock.setFixedTime(at("12:00:10"));
      const aircraft = await createAircraft(manager);
      const pilotId = await pilotIdOf(seeded("a-pilot"));
      const plan = await createPlan(manager, aircraft.id, pilotId);
      await openField(page, plan.id);

      // D-1：6 項目が一覧で出て、各項目に状態の文字がある
      await expect(page.getByTestId("field-docs")).toBeVisible();
      for (const k of DOC_KEYS) {
        await expect(page.getByTestId(`field-docs-item-${k}`)).toBeVisible();
        await expect(page.getByTestId(`field-docs-state-${k}`)).toHaveText(STATE_WORDS);
      }
      // リモートID・飛行マニュアルは常に要確認（確認済み・該当なしにならない）
      await expect(page.getByTestId("field-docs-state-remote_id")).toContainText("要確認");
      await expect(page.getByTestId("field-docs-state-manual")).toContainText("要確認");
      // 登録記号：機体台帳から確認済み。根拠に記号と「有効期限は人が確認」
      await expect(page.getByTestId("field-docs-state-registration")).toContainText("確認済み");
      await expect(page.getByTestId("field-docs-basis-registration")).toContainText(aircraft.registrationMark);
      await expect(page.getByTestId("field-docs-notes-registration")).toContainText("登録の有効期限は人が確認");
      // 通報不要と読める語を出さない
      const text = await page.locator("body").innerText();
      for (const w of ["通報不要", "手続き不要", "該当なし", "代行", "代理"]) expect(text, w).not.toContain(w);

      // D-2：登録の画面へ移り、現場画面へ戻れる
      // 機体・操縦者・許可・通報の各登録の画面へ移り、「現場モードへ戻る」で現場画面に戻れる
      for (const [key, re] of [
        ["registration", new RegExp(`/ops/aircraft/${aircraft.id}`)],
        ["license", /\/ops\/pilots\//],
        ["permit", /\/ops\/permits\?/],
        ["report", new RegExp(`/ops/plans/${plan.id}/report`)],
      ] as const) {
        await tapAndWait(page, page.getByTestId(`field-docs-link-${key}`), re);
        const back = page.getByRole("link", { name: /現場モードへ戻る/ }).first();
        await expect(back).toBeVisible();
        await tapAndWait(page, back, new RegExp(`/ops/plans/${plan.id}/field`));
        await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      }

      // D-3：要確認の項目だけに「確認した」。押すと確認済み（人が確認）になり、取り消せる
      await expect(page.getByTestId("field-docs-confirm-registration")).toHaveCount(0);
      await page.getByTestId("field-docs-confirm-remote_id").click();
      await expect(page.getByTestId("field-docs-state-remote_id")).toContainText("確認済み（人が確認）");
      await page.getByTestId("field-docs-undo-remote_id").click();
      await expect(page.getByTestId("field-docs-state-remote_id")).toContainText("要確認");

      // D-5：飛行自粛要請は確認先が未確認（URL を創作しない：リンクなし）。緊急用務空域は確認元の注記つき
      await expect(page.getByTestId("field-restriction-note")).toContainText("確認先は未確認");
      await expect(page.getByTestId("field-restriction-link")).toHaveCount(0);
      await expect(page.getByTestId("field-emergency-note")).toContainText("確認元");
      // 緊急用務空域の公表ページへのリンク（既存の参照先の URL だけ）
      await expect(page.getByTestId("field-emergency-link").first()).toHaveAttribute("href", /^https:\/\/www\.mlit\.go\.jp\//);
      await page.getByTestId("field-restriction-submit").click();
      await expect(page.getByTestId("field-restriction-state")).toContainText("済");
      await page.getByTestId("field-restriction-undo").click();
      await expect(page.getByTestId("field-restriction-state")).toContainText("未");

      // D-6：現場状況。4 つの選択がそろうまで記録できない。数値は未入力でも記録できる。「いる」を選ぶと備考が必須
      await expect(page.getByTestId("field-site-submit")).toBeDisabled();
      for (const [f, v] of [["third_party", "none"], ["other_aircraft", "none"], ["rain", "none"], ["visibility", "good"]] as const) {
        await page.getByTestId(`field-site-${f}-${v}`).click();
      }
      await expect(page.getByTestId("field-site-submit")).toBeEnabled();
      await page.getByTestId("field-site-third_party-present").click();
      await expect(page.getByTestId("field-site-note-required")).toBeVisible();
      await expect(page.getByTestId("field-site-submit")).toBeDisabled();
      await page.getByTestId("field-site-third_party-none").click();
      await page.getByTestId("field-site-submit").click();
      await expect(page.getByTestId("field-site-state")).toContainText("済");
      await page.getByTestId("field-site-undo").click();
      await expect(page.getByTestId("field-site-state")).toContainText("未");

      // D-12：押す部品の寸法・文字の大きさ・コントラスト・横スクロールなし（既存の検査を新しい部品にも）
      await expectTapTargets(page, '[data-testid="field-root"]', `Sprint 14 ${vp.name}`, { bigTestId: "field-flight-button" });
      await expectFontSize(page, '[data-testid="field-root"]', 16, `Sprint 14 ${vp.name}`);
      await expectContrast(page, '[data-testid="field-root"]', 4.5, `Sprint 14 ${vp.name}`);
      await expectNoHorizontalScroll(page, `Sprint 14 ${vp.name}`);
      await settle(manager, plan.id);
    });

    test("D-7〜D-10：着陸 → 飛行後点検（後回しは未了のまま）→ 次の飛行（ラウンドごとの項目は未了、計画ごとは持ち越し）→ 2 回目の離着陸。未了のまま離陸しました", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      await signIn(page.request, seeded("a-manager"));
      await page.clock.setFixedTime(at("11:59:30"));
      const aircraft = await createAircraft(manager);
      const pilotId = await pilotIdOf(seeded("a-pilot"));
      const plan = await createPlan(manager, aircraft.id, pilotId);
      // サーバーの固定時計は JST 12:00。事実の時刻はそれより前（送信待ちの経路）にする
      await createInspection(manager, aircraft.id, pilotId, `${DAY}T11:00`, "pre_flight");
      await postPast(manager, plan.id, "11:05", { kind: "check", item: "docs_confirm", docKey: "remote_id" });
      await postPast(manager, plan.id, "11:20", { kind: "takeoff" });
      await postPast(manager, plan.id, "11:40", { kind: "landing" });
      await openField(page, plan.id);

      // D-10：未了があっても離陸は記録されている。「未了のまま離陸しました」
      await expect(page.getByTestId("field-flight-gaps-notice").first()).toContainText("未了のまま離陸しました");

      // D-7：着陸のあとに飛行後点検の手順。押すと日常点検の入力（飛行後）へ移る。後回しにすると未了として残る
      await expect(page.getByTestId("field-post-row")).toHaveCount(1);
      await expect(page.getByTestId("field-post-state")).toContainText("未");
      await expect(page.getByTestId("field-post-link")).toHaveAttribute("href", /timing=post_flight/);
      await page.getByTestId("field-post-later").click();
      await expect(page.getByTestId("field-post-pending")).toBeVisible();
      // ユーザー決定：飛行後点検は「今日」の次にやることに常に出る（シード済みの組織で上位 8 件が埋まっていても、枠の外で残る）
      const today = (await (await manager.get("/api/ops/today")).json()) as { nextActions: { id: string; planId: string | null }[] };
      expect(today.nextActions.some((a) => a.id === "do_post_inspection" && a.planId === plan.id)).toBe(true);
      await page.goto("/ops");
      await expandNextActions(page);
      await expect(page.locator(`[data-testid="today-next-action"][data-action-id="do_post_inspection"][data-plan-id="${plan.id}"]`)).toBeVisible();

      // 飛行後点検を保存して戻ると完了になる（保存は API で代用。入力画面への遷移は上の href で確かめた）
      // Sprint 15（R-1）：飛行後点検は計画に結び付けた点検だけを数える。入力画面（現場から開いたとき）と同じく planId を送る
      await createInspection(manager, aircraft.id, pilotId, `${DAY}T11:45`, "post_flight", { planId: plan.id });
      await openField(page, plan.id);
      await expect(page.getByTestId("field-post-state")).toContainText("済");

      // D-8：次の飛行を始める。ラウンドごとの項目は未了、計画ごとの項目は持ち越し
      await tapAndWait(page, page.getByTestId("field-next-flight"), /#preflight$/);
      await expect(page.getByTestId("field-round-label")).toContainText("2 回目の飛行");
      await expect(page.getByTestId("field-item-state-inspection")).toContainText("未");
      await expect(page.getByTestId("field-item-state-emergency_airspace")).toContainText("未");
      await expect(page.getByTestId("field-restriction-state")).toContainText("未");
      await expect(page.getByTestId("field-site-state")).toContainText("未");
      await expect(page.getByTestId("field-docs-state-remote_id")).toContainText("確認済み（人が確認）");

      // D-9：2 回目の確認 → 離陸 → 着陸
      await createInspection(manager, aircraft.id, pilotId, `${DAY}T11:50`, "pre_flight");
      await postPast(manager, plan.id, "11:51", { kind: "check", item: "emergency_airspace", result: "not_designated", source: "mlit-emergency-airspace-qa" });
      await postPast(manager, plan.id, "11:52", { kind: "check", item: "flight_restriction" });
      await postPast(manager, plan.id, "11:53", {
        kind: "check",
        item: "site_conditions",
        site: { thirdParty: "none", otherAircraft: "none", rain: "none", visibility: "good", windMs: null, tempC: null },
      });
      await postPast(manager, plan.id, "11:55", { kind: "takeoff" });
      await postPast(manager, plan.id, "11:58", { kind: "landing" });
      await openField(page, plan.id);
      await expect(page.getByTestId("field-flight-row")).toHaveCount(2);
      const v = await getField(manager, plan.id);
      // 2 回目の離陸の gaps にはラウンドごとの項目が出ず、持ち越した人の確認も出ない
      expect(v.flights[1]!.gaps.map((g) => g.item)).not.toContain("flight_restriction");
      expect(v.flights[1]!.gaps.map((g) => g.item)).not.toContain("docs_remote_id");
      // 日誌への引き継ぎ：着陸でラウンドが閉じても、その飛行の飛行前の点検が日誌の入力に入る
      await page.goto(`/ops/flights/new?planId=${plan.id}&takeoffEventId=${v.flights[0]!.takeoffEventId}`);
      await expect(page.getByTestId("inspection-select")).not.toHaveValue("");
      await settle(manager, plan.id);
    });

    test("D-4：登録を変えると（技能証明の期限を過去に）開き直したとき満たさないに変わり、確認ボタンが無く登録を直す導線が出る。変更前の離陸の gaps は書き換わらない", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      await signIn(page.request, seeded("a-manager"));
      await page.clock.setFixedTime(at("11:59:30"));
      const aircraft = await createAircraft(manager);
      const lic = await manager.post("/api/ops/pilots", {
        data: { fullName: `期限 試験${stamp}${seq++}`, hasLicense: true, licenseClass: "second", licenseNumber: `S14-${stamp}${seq}`.slice(0, 30), licenseExpiresOn: "2028-12-31" },
      });
      expect(lic.status(), await lic.text()).toBe(201);
      const pilot = (await lic.json()) as { id: string; version: number };
      const plan = await createPlan(manager, aircraft.id, pilot.id);
      await openField(page, plan.id);
      await expect(page.getByTestId("field-docs-state-license")).toContainText("確認済み");
      await postPast(manager, plan.id, "11:20", { kind: "takeoff" });
      const before = (await getField(manager, plan.id)).flights[0]!.gaps.map((g) => g.item);
      const upd = await manager.patch(`/api/ops/pilots/${pilot.id}`, { data: { expectedVersion: pilot.version, reason: "期限切れの試験", licenseExpiresOn: "2026-12-31" } });
      expect(upd.status(), await upd.text()).toBe(200);
      await openField(page, plan.id);
      await expect(page.getByTestId("field-docs-state-license")).toContainText("満たさない");
      await expect(page.getByTestId("field-docs-confirm-license")).toHaveCount(0);
      await expect(page.getByTestId("field-docs-fix-license")).toBeVisible();
      expect((await getField(manager, plan.id)).flights[0]!.gaps.map((g) => g.item)).toEqual(before);
      await settle(manager, plan.id);
    });

    test("ユーザー決定：日誌済みの飛行のラウンドに属する確認は取り消せない（409 round_journaled）。計画ごとの確認は取り消せる", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      await signIn(page.request, seeded("a-manager"));
      await page.clock.setFixedTime(at("11:59:30"));
      const aircraft = await createAircraft(manager);
      // 飛行記録は操縦者の時間帯の重なりを拒むため（overlap）、画面の幅ごとに別の操縦者を作る
      const pr = await manager.post("/api/ops/pilots", { data: { fullName: `日誌 試験${stamp}${seq++}`, hasLicense: false } });
      expect(pr.status(), await pr.text()).toBe(201);
      const pilotId = ((await pr.json()) as { id: string }).id;
      const plan = await createPlan(manager, aircraft.id, pilotId);
      const rs = (await (await postPast(manager, plan.id, "11:01", { kind: "check", item: "flight_restriction" })).json()) as { id: string };
      const cr = (await (await postPast(manager, plan.id, "11:02", { kind: "check", item: "carry" })).json()) as { id: string };
      const tk = (await (await postPast(manager, plan.id, "11:10", { kind: "takeoff" })).json()) as { id: string };
      await postPast(manager, plan.id, "11:30", { kind: "landing" });
      const f = await manager.post("/api/ops/flights", {
        data: {
          aircraftId: aircraft.id,
          pilotId,
          purpose: "空撮",
          takeoffPlace: "米子市日吉津 本社",
          landingPlace: "米子市日吉津 本社",
          safetyIssue: false,
          takeoffAt: `${DAY}T11:10`,
          landingAt: `${DAY}T11:30`,
          flightPlanId: plan.id,
          takeoffEventId: tk.id,
        },
      });
      expect(f.status(), await f.text()).toBe(201);
      const r = await postEvent(manager, plan.id, { kind: "undo", targetEventId: rs.id });
      expect(r.status()).toBe(409);
      expect(((await r.json()) as { error: string }).error).toBe("round_journaled");
      // 画面にも、日誌済みのラウンドの確認を取り消すボタンは出ない（いまのラウンドは次の飛行）
      await openField(page, plan.id);
      await expect(page.getByTestId("field-restriction-undo")).toHaveCount(0);
      await expect(page.getByTestId("field-restriction-state")).toContainText("未");
      // 計画ごとの確認（携行品）は取り消せる
      expect((await postEvent(manager, plan.id, { kind: "undo", targetEventId: cr.id })).status()).toBe(201);
      const plan2 = (await (await manager.get(`/api/ops/plans/${plan.id}`)).json()) as { version: number };
      await manager.post(`/api/ops/plans/${plan.id}/void`, { data: { expectedVersion: plan2.version, reason: "試験の後始末" } });
    });

    test("D-11：通信できない状態で、既に開いている画面から確認を押すと送信待ちに入り、戻ると二重なく送られる", async ({ page, context }) => {
      const manager = await apiAs(seeded("a-manager"));
      await signIn(page.request, seeded("a-manager"));
      await page.clock.setFixedTime(at("12:00:10"));
      const aircraft = await createAircraft(manager);
      const pilotId = await pilotIdOf(seeded("a-pilot"));
      const plan = await createPlan(manager, aircraft.id, pilotId);
      await openField(page, plan.id);
      await context.setOffline(true);
      await page.getByTestId("field-docs-confirm-manual").click();
      await page.getByTestId("field-restriction-submit").click();
      await expect(page.getByTestId("field-unsent")).toContainText("未送信 2 件");
      await expect(page.getByTestId("field-docs-state-manual")).toContainText("確認済み（人が確認）");
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.getByTestId("field-unsent")).toContainText("送信済み");
      const v = await getField(manager, plan.id);
      expect(v.docs.find((d) => d.key === "manual")?.effective).toBe("confirmed_human");
      const ev = (await (await manager.get(`/api/ops/plans/${plan.id}/field-events`)).json()) as { events: { item: string | null; kind: string }[] };
      expect(ev.events.filter((e) => e.item === "docs_confirm")).toHaveLength(1);
      expect(ev.events.filter((e) => e.item === "flight_restriction")).toHaveLength(1);

      // 離陸・着陸も、通信できない間は送信待ちに入り、戻ると 1 回ずつ送られる
      const btn = page.getByTestId("field-flight-button");
      await context.setOffline(true);
      await btn.click();
      await expect(btn).toHaveText("着陸");
      await page.clock.setFixedTime(at("12:02:05"));
      await page.waitForTimeout(1600);
      await btn.click();
      await expect(btn).toHaveText("離陸");
      await expect(page.getByTestId("field-unsent")).toContainText("未送信 2 件");
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.getByTestId("field-unsent")).toContainText("送信済み");
      const after = (await (await manager.get(`/api/ops/plans/${plan.id}/field-events`)).json()) as { events: { kind: string }[] };
      expect(after.events.filter((e) => e.kind === "takeoff")).toHaveLength(1);
      expect(after.events.filter((e) => e.kind === "landing")).toHaveLength(1);
      await settle(manager, plan.id);
    });
  });
}
