import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";

// Sprint 11 の E2E-DB（契約 7・15〜20）。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与え、TZ=UTC で起動した next start に対して実行する。
// サーバーの現在時刻は OPS_TEST_NOW（playwright.ops.config.ts、JST 2027-01-05 12:00）に固定している（離陸が未来でないかの判定用）。
// 画面のテストは、ブラウザを timezoneId: 'America/Los_Angeles'・幅 375px にし、時計を page.clock で固定する
// （時刻の解釈が端末のタイムゾーンに依らないことを確かめるため）。
// テスト用の初期データ（packages/db/src/ops-seed.ts）：組織A の a-manager・a-pilot（操縦 一郎、TEST-11112222）・
// a-pilot2（操縦 二郎、TEST-33334444）・a-viewer・a-pilot-unlinked（操縦者の行なし）、組織B の b-manager・b-pilot・機体 JUORGB0001。
// 同じ DB で何度実行しても重ならないよう、API のテストの時刻は実行ごとに変わる過去の日に置く。

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

let seq = 0;
const uniqueMark = () => `JUS11${Date.now().toString(36).toUpperCase()}${seq++}`;

/** 実行ごとに変わる過去の日（2025-01-01〜2026-08 のどこか）から、2 時間ずつずらした時刻を返す。 */
const RUN_BASE = Date.UTC(2025, 0, 1) + Math.floor(Math.random() * 600) * 24 * 3600 * 1000;
let slotNo = 0;
const jst = (ms: number): string => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 16);
const slot = (minutes = 10): { takeoffAt: string; landingAt: string } => {
  const t = RUN_BASE + slotNo++ * 2 * 3600 * 1000;
  return { takeoffAt: jst(t), landingAt: jst(t + minutes * 60 * 1000) };
};

const AIRCRAFT = { modelName: "Mavic 3 Enterprise", manufacturer: "DJI", serialNumber: "SN-S11", typeCertified: false, initialFlightMinutes: 0 };
const ALL_NORMAL = Object.fromEntries(
  ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"].map((k) => [k, { result: "normal" }]),
);

const createAircraft = async (manager: APIRequestContext, extra: object = {}): Promise<{ id: string; version: number }> => {
  const r = await manager.post("/api/ops/aircraft", { data: { ...AIRCRAFT, registrationMark: uniqueMark(), ...extra } });
  expect(r.status()).toBe(201);
  return (await r.json()) as { id: string; version: number };
};

const flightBody = (aircraftId: string, pilotId: string, t: { takeoffAt: string; landingAt: string }, extra: object = {}) => ({
  aircraftId,
  pilotId,
  purpose: "空撮",
  takeoffPlace: "米子市日吉津 本社",
  landingPlace: "米子市日吉津 本社",
  safetyIssue: false,
  ...t,
  ...extra,
});

const inspectionBody = (aircraftId: string, pilotId: string, inspectedAt: string) => ({
  aircraftId,
  pilotId,
  inspectedAt,
  placeName: "本社 駐車場",
  items: ALL_NORMAL,
});

const pilotIdOf = async (who: Who): Promise<string> => {
  const ctx = await apiAs(who);
  const me = (await (await ctx.get("/api/ops/me")).json()) as { pilotId: string };
  await ctx.dispose();
  return me.pilotId;
};

const noHorizontalScroll = async (page: Page, label: string) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, label).toBeLessThanOrEqual(clientWidth);
};

/** 端末に残っている下書き（種類ごと、全利用者分）の中身をつないだ文字列。キーは soraban:ops-draft:<種類>:<利用者の ID>。 */
const draftText = (page: Page, kind: "flight" | "inspection"): Promise<string> =>
  page.evaluate(
    (k) =>
      Object.keys(window.localStorage)
        .filter((x) => x.startsWith(`soraban:ops-draft:${k}:`))
        .map((x) => window.localStorage.getItem(x) ?? "")
        .join("\n"),
    kind,
  );
const draftKeys = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("soraban:ops-draft:")));

const FIELD_DAY = "2027-01-05";
const at = (hhmmss: string) => new Date(`${FIELD_DAY}T${hhmmss}+09:00`);

test.describe.configure({ mode: "serial" });

test.describe("Sprint 11 E2E-DB：飛行記録・日常点検記録", () => {
  let selfPilot = "";
  let otherPilot = "";

  test.beforeAll(async () => {
    selfPilot = await pilotIdOf(seeded("a-pilot"));
    otherPilot = await pilotIdOf(seeded("a-pilot2"));
    // 同じ DB での再実行に備え、画面のテストで使う日（2027-01-05）の a-pilot・a-pilot2 の飛行記録を取り消しておく
    const manager = await apiAs(seeded("a-manager"));
    const list = (await (await manager.get(`/api/ops/flights?from=${FIELD_DAY}&to=${FIELD_DAY}`)).json()) as {
      flights: { id: string; version: number; pilotId: string }[];
    };
    for (const f of list.flights.filter((x) => x.pilotId === selfPilot || x.pilotId === otherPilot)) {
      await manager.post(`/api/ops/flights/${f.id}/void`, { data: { expectedVersion: f.version, reason: "E2E の再実行の準備" } });
    }
    await manager.dispose();
  });

  test("7. 機体は訂正で変えられない（400）。取消済み・抹消の機体への作成は 409。他の組織の ID は 404。別の機体の点検の紐付けは 400", async () => {
    const manager = await apiAs(seeded("a-manager"));
    const a = await createAircraft(manager);
    const b = await createAircraft(manager);
    const f = await manager.post("/api/ops/flights", { data: flightBody(a.id, otherPilot, slot()) });
    expect(f.status()).toBe(201);
    const flight = (await f.json()) as { id: string; version: number };
    const chg = await manager.patch(`/api/ops/flights/${flight.id}`, { data: { expectedVersion: 1, reason: "機体の誤り", aircraftId: b.id } });
    expect(chg.status()).toBe(400);
    expect(await chg.json()).toMatchObject({ codes: { aircraftId: "aircraft_immutable" } });

    const s = slot();
    const insp = await manager.post("/api/ops/inspections", { data: inspectionBody(a.id, otherPilot, s.takeoffAt) });
    expect(insp.status()).toBe(201);
    const inspection = (await insp.json()) as { id: string };
    const ichg = await manager.patch(`/api/ops/inspections/${inspection.id}`, { data: { expectedVersion: 1, reason: "機体の誤り", aircraftId: b.id } });
    expect(ichg.status()).toBe(400);
    expect(await ichg.json()).toMatchObject({ codes: { aircraftId: "aircraft_immutable" } });

    // 別の機体の日常点検を紐付けると 400
    const mismatch = await manager.post("/api/ops/flights", { data: flightBody(b.id, otherPilot, slot(), { dailyInspectionId: inspection.id }) });
    expect(mismatch.status()).toBe(400);
    expect(await mismatch.json()).toMatchObject({ codes: { dailyInspectionId: "inspection_mismatch" } });

    // 取消済み・抹消の機体への作成は 409
    const voided = await createAircraft(manager);
    expect((await manager.post(`/api/ops/aircraft/${voided.id}/void`, { data: { expectedVersion: 1, reason: "誤登録" } })).status()).toBe(200);
    const dereg = await createAircraft(manager);
    expect((await manager.patch(`/api/ops/aircraft/${dereg.id}`, { data: { expectedVersion: 1, reason: "抹消", status: "deregistered" } })).status()).toBe(200);
    for (const id of [voided.id, dereg.id]) {
      const r = await manager.post("/api/ops/flights", { data: flightBody(id, otherPilot, slot()) });
      expect(r.status()).toBe(409);
      expect(await r.json()).toMatchObject({ error: "aircraft_unavailable" });
      const ri = await manager.post("/api/ops/inspections", { data: inspectionBody(id, otherPilot, slot().takeoffAt) });
      expect(ri.status()).toBe(409);
    }

    // 他の組織の機体・操縦者の ID は 404
    const bm = await apiAs(seeded("b-manager"));
    const bAircraft = ((await (await bm.get("/api/ops/aircraft")).json()) as { aircraft: { id: string; registrationMark: string }[] }).aircraft.find(
      (x) => x.registrationMark === "JUORGB0001",
    )!;
    const bPilot = ((await (await bm.get("/api/ops/pilots")).json()) as { pilots: { id: string }[] }).pilots[0]!;
    expect((await manager.post("/api/ops/flights", { data: flightBody(bAircraft.id, otherPilot, slot()) })).status()).toBe(404);
    expect((await manager.post("/api/ops/flights", { data: flightBody(a.id, bPilot.id, slot()) })).status()).toBe(404);
    expect((await manager.post("/api/ops/inspections", { data: inspectionBody(bAircraft.id, otherPilot, slot().takeoffAt) })).status()).toBe(404);
    // 他の組織の記録は見えない
    expect((await bm.get(`/api/ops/flights/${flight.id}`)).status()).toBe(404);
    await bm.dispose();
    await manager.dispose();
  });

  test("15. 役割ごとの状態コード（作成・訂正・取消）。理由なしは 400、古い版は 409、DELETE は 405 で行が残る", async () => {
    const manager = await apiAs(seeded("a-manager"));
    const pilot = await apiAs(seeded("a-pilot"));
    const unlinked = await apiAs(seeded("a-pilot-unlinked"));
    const viewer = await apiAs(seeded("a-viewer"));
    const anon = await apiAs(null);
    const a = await createAircraft(manager);

    // 飛行記録の作成：運航管理者は誰の分も 201、操縦者は自分の分 201・他人の分 403、結び付いていない操縦者・閲覧者 403、未ログイン 401
    const byManager = await manager.post("/api/ops/flights", { data: flightBody(a.id, otherPilot, slot()) });
    expect(byManager.status()).toBe(201);
    const mFlight = (await byManager.json()) as { id: string; version: number };
    const bySelf = await pilot.post("/api/ops/flights", { data: flightBody(a.id, selfPilot, slot()) });
    expect(bySelf.status()).toBe(201);
    const sFlight = (await bySelf.json()) as { id: string; version: number };
    for (const [ctx, pid, status] of [
      [pilot, otherPilot, 403],
      [unlinked, otherPilot, 403],
      [viewer, otherPilot, 403],
      [anon, otherPilot, 401],
    ] as const) {
      expect((await ctx.post("/api/ops/flights", { data: flightBody(a.id, pid, slot()) })).status()).toBe(status);
    }
    // 訂正：操縦者は自分の分 200・他人の分 403、閲覧者 403、未ログイン 401、運航管理者 200
    expect((await pilot.patch(`/api/ops/flights/${sFlight.id}`, { data: { expectedVersion: 1, reason: "目的の訂正", purpose: "点検" } })).status()).toBe(200);
    expect((await pilot.patch(`/api/ops/flights/${mFlight.id}`, { data: { expectedVersion: 1, reason: "x", purpose: "x" } })).status()).toBe(403);
    expect((await viewer.patch(`/api/ops/flights/${mFlight.id}`, { data: { expectedVersion: 1, reason: "x", purpose: "x" } })).status()).toBe(403);
    expect((await anon.patch(`/api/ops/flights/${mFlight.id}`, { data: { expectedVersion: 1, reason: "x", purpose: "x" } })).status()).toBe(401);
    expect((await manager.patch(`/api/ops/flights/${sFlight.id}`, { data: { expectedVersion: 2, reason: "経由地の追記", waypoints: "役場" } })).status()).toBe(200);
    // 理由なしは 400、古い expectedVersion は 409
    const noReason = await manager.patch(`/api/ops/flights/${mFlight.id}`, { data: { expectedVersion: 1, purpose: "x" } });
    expect(noReason.status()).toBe(400);
    expect(await noReason.json()).toMatchObject({ error: "invalid_input", fields: { reason: expect.any(String) } });
    const stale = await manager.patch(`/api/ops/flights/${sFlight.id}`, { data: { expectedVersion: 1, reason: "古い版", purpose: "x" } });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "version_conflict" });
    // 取消：操縦者は自分の分でも 403、閲覧者 403、未ログイン 401、運航管理者 200。理由なしは 400
    expect((await pilot.post(`/api/ops/flights/${sFlight.id}/void`, { data: { expectedVersion: 3, reason: "x" } })).status()).toBe(403);
    expect((await viewer.post(`/api/ops/flights/${mFlight.id}/void`, { data: { expectedVersion: 1, reason: "x" } })).status()).toBe(403);
    expect((await anon.post(`/api/ops/flights/${mFlight.id}/void`, { data: { expectedVersion: 1, reason: "x" } })).status()).toBe(401);
    expect((await manager.post(`/api/ops/flights/${mFlight.id}/void`, { data: { expectedVersion: 1, reason: " " } })).status()).toBe(400);
    expect((await manager.post(`/api/ops/flights/${mFlight.id}/void`, { data: { expectedVersion: 1, reason: "誤入力" } })).status()).toBe(200);
    // DELETE は 405 で行が残る
    expect((await manager.delete(`/api/ops/flights/${sFlight.id}`)).status()).toBe(405);
    expect((await manager.get(`/api/ops/flights/${sFlight.id}`)).status()).toBe(200);
    const versions = (await (await manager.get(`/api/ops/flights/${mFlight.id}/versions`)).json()) as { versions: { op: string }[] };
    expect(versions.versions.map((v) => v.op)).toEqual(["create", "void"]);

    // 日常点検：同じ表
    const iByManager = await manager.post("/api/ops/inspections", { data: inspectionBody(a.id, otherPilot, slot().takeoffAt) });
    expect(iByManager.status()).toBe(201);
    const mInsp = (await iByManager.json()) as { id: string };
    const iBySelf = await pilot.post("/api/ops/inspections", { data: inspectionBody(a.id, selfPilot, slot().takeoffAt) });
    expect(iBySelf.status()).toBe(201);
    const sInsp = (await iBySelf.json()) as { id: string };
    for (const [ctx, status] of [
      [pilot, 403],
      [unlinked, 403],
      [viewer, 403],
      [anon, 401],
    ] as const) {
      expect((await ctx.post("/api/ops/inspections", { data: inspectionBody(a.id, otherPilot, slot().takeoffAt) })).status()).toBe(status);
    }
    expect((await pilot.patch(`/api/ops/inspections/${sInsp.id}`, { data: { expectedVersion: 1, reason: "特記事項", specialNotes: "異常なし" } })).status()).toBe(200);
    expect((await pilot.patch(`/api/ops/inspections/${mInsp.id}`, { data: { expectedVersion: 1, reason: "x", specialNotes: "x" } })).status()).toBe(403);
    expect((await viewer.patch(`/api/ops/inspections/${mInsp.id}`, { data: { expectedVersion: 1, reason: "x", specialNotes: "x" } })).status()).toBe(403);
    expect((await anon.patch(`/api/ops/inspections/${mInsp.id}`, { data: { expectedVersion: 1, reason: "x", specialNotes: "x" } })).status()).toBe(401);
    expect((await manager.patch(`/api/ops/inspections/${mInsp.id}`, { data: { expectedVersion: 1, specialNotes: "x" } })).status()).toBe(400);
    expect((await manager.patch(`/api/ops/inspections/${sInsp.id}`, { data: { expectedVersion: 1, reason: "古い版", specialNotes: "x" } })).status()).toBe(409);
    expect((await pilot.post(`/api/ops/inspections/${sInsp.id}/void`, { data: { expectedVersion: 2, reason: "x" } })).status()).toBe(403);
    expect((await viewer.post(`/api/ops/inspections/${mInsp.id}/void`, { data: { expectedVersion: 1, reason: "x" } })).status()).toBe(403);
    expect((await anon.post(`/api/ops/inspections/${mInsp.id}/void`, { data: { expectedVersion: 1, reason: "x" } })).status()).toBe(401);
    expect((await manager.post(`/api/ops/inspections/${mInsp.id}/void`, { data: { expectedVersion: 1 } })).status()).toBe(400);
    expect((await manager.post(`/api/ops/inspections/${mInsp.id}/void`, { data: { expectedVersion: 1, reason: "誤入力" } })).status()).toBe(200);
    expect((await manager.delete(`/api/ops/inspections/${sInsp.id}`)).status()).toBe(405);
    expect((await manager.get(`/api/ops/inspections/${sInsp.id}`)).status()).toBe(200);
    // 閲覧者は一覧と詳細を見られる
    expect((await viewer.get(`/api/ops/flights?aircraftId=${a.id}`)).status()).toBe(200);
    expect((await viewer.get(`/api/ops/inspections/${sInsp.id}`)).status()).toBe(200);

    for (const c of [manager, pilot, unlinked, viewer, anon]) await c.dispose();
  });

  test.describe("現場の画面（375px・America/Los_Angeles）", () => {
    test.use({ viewport: { width: 375, height: 812 }, timezoneId: "America/Los_Angeles" });

    test("16. 「離陸：今」「着陸：今」、再読み込みで下書きが残り、保存すると詳細に飛行年月日・時刻・飛行時間 0:01・総飛行時間が出て、下書きが消える", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      const aircraft = await createAircraft(manager);
      await manager.dispose();
      await signIn(page.request, seeded("a-pilot"));
      await page.clock.setFixedTime(at("09:30:40"));
      await page.goto("/ops/flights/new");
      const form = page.getByRole("form", { name: "飛行記録の入力" });
      await form.getByRole("combobox", { name: "機体", exact: true }).selectOption(aircraft.id);
      await form.getByRole("textbox", { name: "離陸場所", exact: true }).fill("米子市日吉津 本社");
      await page.getByRole("button", { name: "離陸：今" }).click();
      await expect(form.getByLabel("離陸時刻", { exact: true })).toHaveValue("09:30");
      await expect(form.getByLabel("離陸日", { exact: true })).toHaveValue(FIELD_DAY);

      // 再読み込みしても離陸時刻と入力済みの項目が残る
      await page.reload();
      await expect(form.getByLabel("離陸時刻", { exact: true })).toHaveValue("09:30");
      await expect(form.getByRole("textbox", { name: "離陸場所", exact: true })).toHaveValue("米子市日吉津 本社");
      await expect(form.getByRole("combobox", { name: "機体", exact: true })).toHaveValue(aircraft.id);

      await page.clock.setFixedTime(at("09:30:55"));
      await page.getByRole("button", { name: "着陸：今" }).click();
      await expect(form.getByLabel("着陸時刻", { exact: true })).toHaveValue("09:30");
      await expect(page.getByTestId("flight-minutes")).toHaveText("0:01");
      await expect(form.getByText("（1 分未満は切り上げ）")).toBeVisible();

      await form.getByRole("textbox", { name: "着陸場所", exact: true }).fill("米子市日吉津 本社");
      await form.getByLabel("飛行の目的").fill("空撮");
      // 読み上げ名は項目名だけで、案内は説明（aria-describedby）として読まれる
      await expect(form.getByRole("textbox", { name: "飛行の目的", exact: true })).toHaveAccessibleDescription(/例：空撮/);
      await form.getByRole("radio", { name: "なし" }).check();
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page).toHaveURL(/\/ops\/flights\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId("flight-date")).toHaveText(FIELD_DAY);
      await expect(page.getByTestId("flight-takeoff")).toHaveText("09:30");
      await expect(page.getByTestId("flight-landing")).toHaveText("09:30");
      await expect(page.getByTestId("flight-minutes-detail")).toHaveText("0:01");
      await expect(page.getByTestId("flight-total")).toHaveText("0:01");
      await expect(page.getByTestId("flight-pilot-name")).toHaveText("操縦 一郎");
      await expect(page.getByTestId("ops-change-notice")).toContainText("飛行記録を保存しました。");

      // 下書きが消えている（再度開くと空）
      await page.goto("/ops/flights/new");
      await expect(form.getByRole("textbox", { name: "離陸場所", exact: true })).toHaveValue("");
      await expect(form.getByLabel("離陸時刻", { exact: true })).toHaveValue("");
      expect(await draftText(page, "flight")).not.toContain("米子市日吉津");
    });

    test("17. 同じ clientRequestId の POST は 2 回目が 200 で同じ ID、記録は 1 件。保存の要求を遮断すると下書きが残り、再送ボタンで保存できる", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      const aircraft = await createAircraft(manager);
      const clientRequestId = crypto.randomUUID();
      const body = { ...flightBody(aircraft.id, otherPilot, slot()), clientRequestId };
      const first = await manager.post("/api/ops/flights", { data: body });
      expect(first.status()).toBe(201);
      const second = await manager.post("/api/ops/flights", { data: body });
      expect(second.status()).toBe(200);
      expect(((await second.json()) as { id: string }).id).toBe(((await first.json()) as { id: string }).id);
      const list = (await (await manager.get(`/api/ops/flights?aircraftId=${aircraft.id}`)).json()) as { flights: unknown[] };
      expect(list.flights).toHaveLength(1);

      // 画面：保存の要求をネットワークで遮断する
      await signIn(page.request, seeded("a-manager"));
      await page.goto("/ops/flights/new");
      const form = page.getByRole("form", { name: "飛行記録の入力" });
      const t = slot();
      await form.getByRole("combobox", { name: "機体", exact: true }).selectOption(aircraft.id);
      await form.getByRole("combobox", { name: "操縦者", exact: true }).selectOption(otherPilot);
      await form.getByRole("textbox", { name: "離陸場所", exact: true }).fill("現場A");
      await form.getByLabel("離陸日", { exact: true }).fill(t.takeoffAt.slice(0, 10));
      await form.getByLabel("離陸時刻", { exact: true }).fill(t.takeoffAt.slice(11));
      await form.getByLabel("着陸日", { exact: true }).fill(t.landingAt.slice(0, 10));
      await form.getByLabel("着陸時刻", { exact: true }).fill(t.landingAt.slice(11));
      await form.getByRole("textbox", { name: "着陸場所", exact: true }).fill("現場A");
      await form.getByLabel("飛行の目的").fill("インフラ点検");
      await form.getByRole("radio", { name: "なし" }).check();
      await page.route("**/api/ops/flights", (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(form.getByText(/保存できませんでした。通信が戻ったら/)).toBeVisible();
      await expect(page).toHaveURL(/\/ops\/flights\/new$/);
      const draft = await draftText(page, "flight");
      expect(draft).toContain("インフラ点検");
      // 通信が戻ったら再送する
      await page.unroute("**/api/ops/flights");
      await page.getByRole("button", { name: "再送する" }).click();
      await expect(page).toHaveURL(/\/ops\/flights\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId("flight-detail")).toContainText("インフラ点検");
      const after = (await (await manager.get(`/api/ops/flights?aircraftId=${aircraft.id}`)).json()) as { flights: unknown[] };
      expect(after.flights).toHaveLength(2);
      await manager.dispose();
    });

    test("18. 日常点検を「すべて正常」で保存し、進んだ飛行記録の入力画面に点検が候補として入る。当日の点検がない機体は警告が出るが保存できる。「異常」で備考なしはその項目に誤り", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      const withInspection = await createAircraft(manager);
      const withoutInspection = await createAircraft(manager);
      await manager.dispose();
      await signIn(page.request, seeded("a-pilot"));
      await page.clock.setFixedTime(at("08:00:10"));

      await page.goto(`/ops/inspections/new?aircraftId=${withInspection.id}`);
      const iform = page.getByRole("form", { name: "日常点検の入力" });
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("08:00");
      await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
      await iform.getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
      await page.getByRole("button", { name: "すべて正常" }).click();
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page).toHaveURL(/\/ops\/inspections\/[0-9a-f-]{36}$/);
      const inspectionId = page.url().split("/").pop()!;
      await expect(page.getByTestId("inspection-detail")).toContainText("本社 駐車場");
      await expect(page.getByTestId("inspection-result-battery")).toContainText("正常");

      await page.getByRole("link", { name: "この機体の飛行記録を入力" }).click();
      await expect(page).toHaveURL(/\/ops\/flights\/new\?/);
      const form = page.getByRole("form", { name: "飛行記録の入力" });
      await expect(form.getByRole("combobox", { name: "機体", exact: true })).toHaveValue(withInspection.id);
      await expect(page.getByTestId("inspection-select")).toHaveValue(inspectionId);
      await expect(page.getByTestId("record-warnings")).toHaveCount(0);

      // 当日の点検がない機体を選ぶと警告が出るが、保存はできる
      await form.getByRole("combobox", { name: "機体", exact: true }).selectOption(withoutInspection.id);
      await expect(page.getByTestId("record-warnings")).toContainText("飛行日の日常点検がありません");
      await form.getByRole("textbox", { name: "離陸場所", exact: true }).fill("本社");
      await page.getByRole("button", { name: "離陸：今" }).click();
      await page.clock.setFixedTime(at("08:12:30"));
      await page.getByRole("button", { name: "着陸：今" }).click();
      await expect(page.getByTestId("flight-minutes")).toHaveText("0:12");
      await form.getByRole("textbox", { name: "着陸場所", exact: true }).fill("本社");
      await form.getByLabel("飛行の目的").fill("試験飛行");
      await form.getByRole("radio", { name: "なし" }).check();
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page).toHaveURL(/\/ops\/flights\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId("ops-change-notice")).toContainText("飛行日の日常点検がありません");

      // 1 項目を「異常」にして備考なしで保存しようとすると、その項目に誤りが示される
      await page.goto(`/ops/inspections/new?aircraftId=${withInspection.id}`);
      await iform.getByRole("textbox", { name: "実施場所", exact: true }).fill("本社 駐車場");
      await page.getByRole("button", { name: "すべて正常" }).click();
      await page.getByRole("radiogroup", { name: "フレームの結果" }).getByRole("radio", { name: "異常" }).check();
      await page.getByRole("button", { name: "保存", exact: true }).click();
      const frame = page.getByTestId("inspection-item-frame");
      await expect(frame.getByRole("alert")).toContainText("備考を入力してください");
      await expect(frame.getByLabel("フレームの備考")).toHaveAttribute("aria-invalid", "true");
      await expect(page).toHaveURL(/\/ops\/inspections\/new/);
    });

    test("19. 375px で一覧・入力・詳細に横スクロールがなく、「離陸：今」「着陸：今」「保存」「すべて正常」の高さが 44px 以上", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      const aircraft = await createAircraft(manager);
      const created = (await (
        await manager.post("/api/ops/flights", {
          data: flightBody(aircraft.id, otherPilot, slot(), {
            waypoints: "日吉津村役場・米子港・皆生温泉の海岸沿いを経由して戻る長い経由地の記載",
            specificFlightTypes: ["did", "bvlos", "within_30m"],
            takeoffLat: 35.443211,
            takeoffLng: 133.381234,
            takeoffAccuracyM: 12,
            safetyIssue: true,
            safetyIssueDetail: "突風で一時的に姿勢が乱れたが、自動で回復した。",
            defects: [{ occurredOn: "2026-01-05", description: "プロペラの先端に欠け", confirmerName: "運航 管理子" }],
          }),
        })
      ).json()) as { id: string };
      await manager.dispose();
      await signIn(page.request, seeded("a-manager"));
      for (const path of ["/ops/flights", "/ops/flights/new", `/ops/flights/${created.id}`, "/ops/inspections/new", "/ops/inspections", "/ops"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).or(page.getByTestId("ops-me-name")).first()).toBeVisible();
        await noHorizontalScroll(page, path);
      }
      const minHeight = async (path: string, names: readonly string[]) => {
        await page.goto(path);
        for (const name of names) {
          const box = await page.getByRole("button", { name, exact: true }).boundingBox();
          expect(box, name).not.toBeNull();
          expect(box!.height, name).toBeGreaterThanOrEqual(44);
        }
      };
      await minHeight("/ops/flights/new", ["離陸：今", "着陸：今", "保存"]);
      await minHeight("/ops/inspections/new", ["すべて正常", "保存"]);
    });

    test("差し戻し 1・2：何も入力のない日常点検の下書きは、日をまたぐと今の分に入れ直して知らせる。手で入れた日時は残し「前回の入力のまま」と示す", async ({ page }) => {
      await signIn(page.request, seeded("a-pilot"));
      await page.clock.setFixedTime(new Date("2027-01-04T10:15:20+09:00"));
      await page.goto("/ops/inspections/new");
      const iform = page.getByRole("form", { name: "日常点検の入力" });
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("10:15");
      await expect.poll(() => draftText(page, "inspection")).toContain("10:15");

      // 何も入力しないまま、翌日 08:00 に開き直す：実施日時は今の分になり、入れ直したことを示す
      await page.clock.setFixedTime(new Date("2027-01-05T08:00:10+09:00"));
      await page.reload();
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("08:00");
      await expect(iform.getByLabel("実施日", { exact: true })).toHaveValue("2027-01-05");
      await expect(page.getByTestId("draft-refresh-note")).toHaveText("実施日時を今（2027-01-05 08:00）に入れ直しました。");
      await expect(page.getByTestId("draft-stale-note")).toHaveCount(0);

      // 手で入れた日時は勝手に変えず、日をまたいだら「前回の入力のまま」と目立たせる
      await iform.getByLabel("実施時刻", { exact: true }).fill("07:30");
      await expect.poll(() => draftText(page, "inspection")).toContain("07:30");
      await page.clock.setFixedTime(new Date("2027-01-06T09:00:10+09:00"));
      await page.reload();
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("07:30");
      await expect(iform.getByLabel("実施日", { exact: true })).toHaveValue("2027-01-05");
      await expect(page.getByTestId("draft-stale-note")).toContainText("実施日時が前回の入力（2027-01-05 07:30）のままです。");
      await expect(page.getByTestId("draft-refresh-note")).toHaveCount(0);
      await expect(page.getByTestId("inspected-stale")).toBeVisible();
      // 「今」を押すと今の分になり、注意は消える
      await page.getByRole("button", { name: "今", exact: true }).click();
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("09:00");
      await expect(page.getByTestId("draft-stale-note")).toHaveCount(0);

      // 飛行記録：前日に入れた離陸日時は残し、「前回の入力のまま」と示す
      await page.clock.setFixedTime(new Date("2027-01-04T15:00:00+09:00"));
      await page.goto("/ops/flights/new");
      const form = page.getByRole("form", { name: "飛行記録の入力" });
      await page.getByRole("button", { name: "離陸：今" }).click();
      await expect(form.getByLabel("離陸時刻", { exact: true })).toHaveValue("15:00");
      await expect.poll(() => draftText(page, "flight")).toContain("15:00");
      await page.clock.setFixedTime(new Date("2027-01-05T08:00:00+09:00"));
      await page.reload();
      await expect(form.getByLabel("離陸日", { exact: true })).toHaveValue("2027-01-04");
      await expect(page.getByTestId("draft-stale-note")).toContainText("離陸日時が前回の入力（2027-01-04 15:00）のままです。");
      await expect(page.getByTestId("takeoff-stale")).toBeVisible();
      await page.getByRole("button", { name: "下書きを消す" }).click();
    });

    test("差し戻し 2：9 項目を入れて保存に失敗した点検を翌日開き直すと、実施日時は保たれ「前回の入力のまま」と示す", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      const aircraft = await createAircraft(manager);
      await manager.dispose();
      await signIn(page.request, seeded("a-pilot"));
      await page.clock.setFixedTime(new Date("2027-01-04T17:50:05+09:00"));
      await page.goto("/ops/inspections/new");
      const iform = page.getByRole("form", { name: "日常点検の入力" });
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("17:50");
      await iform.getByRole("combobox", { name: "機体", exact: true }).selectOption(aircraft.id);
      await iform.getByRole("textbox", { name: /^実施場所(\s|$)/ }).fill("現場 B");
      await page.getByRole("button", { name: "すべて正常" }).click();
      await page.route("**/api/ops/inspections", (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect(iform.getByText(/保存できませんでした。通信が戻ったら/)).toBeVisible();
      await page.unroute("**/api/ops/inspections");

      await page.clock.setFixedTime(new Date("2027-01-05T08:10:00+09:00"));
      await page.reload();
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("17:50");
      await expect(iform.getByLabel("実施日", { exact: true })).toHaveValue("2027-01-04");
      await expect(iform.getByRole("textbox", { name: /^実施場所(\s|$)/ })).toHaveValue("現場 B");
      await expect(page.getByTestId("draft-stale-note")).toContainText("実施日時が前回の入力（2027-01-04 17:50）のままです。");
      await expect(page.getByTestId("draft-refresh-note")).toHaveCount(0);
      await expect(page.getByTestId("inspected-stale")).toBeVisible();
      await page.getByRole("button", { name: "下書きを消す" }).click();
    });

    test("差し戻し 2：「今」を押した後に再読み込みしても、実施日時は押したときのまま", async ({ page }) => {
      await signIn(page.request, seeded("a-pilot"));
      await page.clock.setFixedTime(new Date("2027-01-05T10:15:30+09:00"));
      await page.goto("/ops/inspections/new");
      const iform = page.getByRole("form", { name: "日常点検の入力" });
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("10:15");
      await page.getByRole("button", { name: "今", exact: true }).click();
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("10:15");
      await expect.poll(() => draftText(page, "inspection")).toContain('"timeTouched":true');
      await page.clock.setFixedTime(new Date("2027-01-05T10:40:00+09:00"));
      await page.reload();
      await expect(iform.getByLabel("実施時刻", { exact: true })).toHaveValue("10:15");
      await expect(iform.getByLabel("実施日", { exact: true })).toHaveValue("2027-01-05");
      await expect(page.getByTestId("draft-refresh-note")).toHaveCount(0);
      await expect(page.getByTestId("draft-stale-note")).toHaveCount(0);
      await page.getByRole("button", { name: "下書きを消す" }).click();
    });

    test("差し戻し 1：下書きは利用者ごと。別の利用者でログインすると前の人の下書きは読まれず、端末から消える", async ({ page }) => {
      await signIn(page.request, seeded("a-pilot"));
      await page.goto("/ops/flights/new");
      const form = page.getByRole("form", { name: "飛行記録の入力" });
      await form.getByRole("textbox", { name: /^離陸場所(\s|$)/ }).fill("前の人の現場");
      await form.getByLabel("飛行の目的").fill("前の人の目的");
      await expect.poll(() => draftText(page, "flight")).toContain("前の人の目的");
      const before = await draftKeys(page);
      expect(before).toHaveLength(1);

      // 同じ端末（同じブラウザ）で別の利用者がログインする（ログアウトせずにセッションが切れた想定）
      await signIn(page.request, seeded("a-manager"));
      await page.goto("/ops/flights/new");
      await expect(form.getByRole("textbox", { name: /^離陸場所(\s|$)/ })).toHaveValue("");
      await expect(form.getByLabel("飛行の目的")).toHaveValue("");
      await expect(page.getByTestId("draft-status")).not.toContainText("前回の入力の続き");
      await expect.poll(() => draftKeys(page)).not.toContain(before[0]);
      expect(await draftText(page, "flight")).not.toContain("前の人");
    });

    test("差し戻し 1：日常点検の候補を取得できないときは「点検がない」とは示さず、取得できないと示す", async ({ page }) => {
      const manager = await apiAs(seeded("a-manager"));
      const aircraft = await createAircraft(manager);
      await manager.dispose();
      await signIn(page.request, seeded("a-manager"));
      await page.route("**/api/ops/inspections?*", (route) => route.abort("internetdisconnected"));
      await page.goto("/ops/flights/new");
      const form = page.getByRole("form", { name: "飛行記録の入力" });
      await form.getByRole("combobox", { name: "機体", exact: true }).selectOption(aircraft.id);
      await expect(page.getByTestId("record-warnings")).toContainText("日常点検の候補を取得できません");
      await expect(page.getByTestId("record-warnings")).not.toContainText("飛行日の日常点検がありません");
      await page.unroute("**/api/ops/inspections?*");
    });

    test("差し戻し 1：「← 一覧」などのリンクの押せる範囲が高さ 44px 以上", async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      for (const [path, name] of [
        ["/ops/flights", "運航管理のトップ"],
        ["/ops/flights/new", "飛行記録の一覧"],
        ["/ops/inspections/new", "日常点検の一覧"],
      ] as const) {
        await page.goto(path);
        const box = await page.getByRole("link", { name, exact: false }).first().boundingBox();
        expect(box, `${path} ${name}`).not.toBeNull();
        expect(box!.height, `${path} ${name}`).toBeGreaterThanOrEqual(44);
      }
      const home = await page.getByRole("link", { name: "地点判定へ" }).boundingBox();
      expect(home!.height).toBeGreaterThanOrEqual(44);
      const logo = await page.getByRole("link", { name: /そらばん 運航管理/ }).boundingBox();
      expect(logo!.height).toBeGreaterThanOrEqual(44);
    });

    test("20（画面）. ログアウトで下書きが消える", async ({ page }) => {
      await signIn(page.request, seeded("a-pilot"));
      await page.goto("/ops/flights/new");
      const form = page.getByRole("form", { name: "飛行記録の入力" });
      await form.getByRole("textbox", { name: "離陸場所", exact: true }).fill("下書きの場所");
      await expect.poll(() => draftText(page, "flight")).toContain("下書きの場所");
      await page.goto(`/ops/inspections/new`);
      await page.getByRole("form", { name: "日常点検の入力" }).getByRole("textbox", { name: "実施場所", exact: true }).fill("点検の下書き");
      await expect.poll(() => draftText(page, "inspection")).toContain("点検の下書き");
      // Sprint 12c：メニューとログアウトは「その他」へ移した
      await page.goto("/ops/more");
      await page.getByRole("button", { name: "ログアウト" }).click();
      await expect(page).toHaveURL(/\/ops\/sign-in$/);
      const left = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("soraban:ops-draft:")));
      expect(left).toEqual([]);
    });
  });

  test("20. 飛行記録の一覧の応答では技能証明書番号の写しを末尾 4 桁以外伏せ、詳細では運航管理者と本人にだけ全桁", async () => {
    const manager = await apiAs(seeded("a-manager"));
    const pilot = await apiAs(seeded("a-pilot"));
    const pilot2 = await apiAs(seeded("a-pilot2"));
    const viewer = await apiAs(seeded("a-viewer"));
    const aircraft = await createAircraft(manager);
    const mine = (await (await pilot.post("/api/ops/flights", { data: flightBody(aircraft.id, selfPilot, slot()) })).json()) as { id: string };
    const others = (await (await pilot2.post("/api/ops/flights", { data: flightBody(aircraft.id, otherPilot, slot()) })).json()) as { id: string };

    for (const ctx of [manager, pilot, viewer]) {
      const text = await (await ctx.get(`/api/ops/flights?aircraftId=${aircraft.id}`)).text();
      expect(text).toContain("****2222");
      expect(text).toContain("****4444");
      expect(text).not.toContain("TEST-1111");
      expect(text).not.toContain("TEST-3333");
    }
    const detail = async (ctx: APIRequestContext, id: string) => {
      const r = await ctx.get(`/api/ops/flights/${id}`);
      expect(r.status()).toBe(200);
      const text = await r.text();
      return { text, json: JSON.parse(text) as { pilotLicenseNumber: string; pilotLicenseNumberMasked: boolean } };
    };
    expect((await detail(manager, mine.id)).json.pilotLicenseNumber).toBe("TEST-11112222");
    expect((await detail(manager, others.id)).json.pilotLicenseNumber).toBe("TEST-33334444");
    expect((await detail(pilot, mine.id)).json).toMatchObject({ pilotLicenseNumber: "TEST-11112222", pilotLicenseNumberMasked: false });
    const pOther = await detail(pilot, others.id);
    expect(pOther.json).toMatchObject({ pilotLicenseNumber: "****4444", pilotLicenseNumberMasked: true });
    expect(pOther.text).not.toContain("3333");
    for (const id of [mine.id, others.id]) {
      const v = await detail(viewer, id);
      expect(v.json.pilotLicenseNumberMasked).toBe(true);
      expect(v.text).not.toContain("TEST-");
    }
    // 版の一覧の応答にも番号・氏名・場所を含めない
    const vt = await (await viewer.get(`/api/ops/flights/${mine.id}/versions`)).text();
    expect(vt).not.toContain("1111");
    expect(vt).not.toContain("日吉津");
    for (const c of [manager, pilot, pilot2, viewer]) await c.dispose();
  });

  test("総飛行時間：既存 600 分の機体に記録を入れると、一覧・詳細・機体の詳細に累計が出る", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager, { initialFlightMinutes: 600 });
    const r1 = (await (await manager.post("/api/ops/flights", { data: flightBody(aircraft.id, otherPilot, slot(30)) })).json()) as {
      totalFlightMinutes: number;
    };
    const r2 = (await (await manager.post("/api/ops/flights", { data: flightBody(aircraft.id, otherPilot, slot(45)) })).json()) as {
      id: string;
      totalFlightMinutes: number;
    };
    expect([r1.totalFlightMinutes, r2.totalFlightMinutes]).toEqual([630, 675]);
    const ac = (await (await manager.get(`/api/ops/aircraft/${aircraft.id}`)).json()) as { totalFlightMinutes: number };
    expect(ac.totalFlightMinutes).toBe(675);
    await manager.dispose();
    await signIn(page.request, seeded("a-viewer"));
    await page.goto(`/ops/aircraft/${aircraft.id}`);
    await expect(page.getByTestId("aircraft-total")).toHaveText("11:15");
    await page.goto(`/ops/flights?aircraftId=${aircraft.id}`);
    await expect(page.getByTestId("flight-list").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("flight-list").getByRole("listitem").first()).toContainText("11:15");
    await page.goto(`/ops/flights/${r2.id}`);
    await expect(page.getByTestId("flight-total")).toHaveText("11:15");
  });
});
