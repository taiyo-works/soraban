import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectTextZoom, waitForSettledStyles } from "../field-checks";

// Sprint 16-J の E2E-DB（契約 J-1・J-2。J-3 は既存の日誌・飛行記録の E2E が期待値を変えずに通ることで確かめる）。
// 日誌（/ops/journal）のタブ・飛行記録の一覧カード（離陸・着陸の時刻と飛行時間）と、飛行記録の入力（節の見出し・チェック行・主ボタン 1 つ）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する。サーバーの時計は OPS_TEST_NOW（JST 2027-01-05 12:00）。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const NOW_DAY = "2027-01-05";
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};

const ALL_NORMAL = Object.fromEntries(
  ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"].map((k) => [k, { result: "normal" }]),
);

let manager: APIRequestContext;
let pilotId = "";
const p2 = (n: number) => String(n).padStart(2, "0");

/** 他の仕様の飛行記録と時間が重ならないよう、最近 14 日の中の日と分を散らす（同じ操縦者の時間の重なりは 422）。 */
const slot = (minutes = 20): { day: string; takeoff: string; landing: string; takeoffAt: string; landingAt: string } => {
  const dayNo = 23 + Math.floor(Math.random() * 11); // 12-23 〜 01-02
  const day = dayNo <= 31 ? `2026-12-${p2(dayNo)}` : `2027-01-${p2(dayNo - 31)}`;
  const start = Math.floor(Math.random() * (1380 - minutes));
  const t = (m: number) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
  return { day, takeoff: t(start), landing: t(start + minutes), takeoffAt: `${day}T${t(start)}`, landingAt: `${day}T${t(start + minutes)}` };
};

const createAircraft = async (): Promise<{ id: string; mark: string }> => {
  const mark = `JU16J${stamp}${seq++}`.slice(0, 20);
  const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "日誌の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(ac.status(), await ac.text()).toBe(201);
  return { id: ((await ac.json()) as { id: string }).id, mark };
};
const createFlight = async (aircraftId: string, s = slot(), extra: Record<string, unknown> = {}): Promise<{ id: string; version: number; s: ReturnType<typeof slot> }> => {
  const r = await manager.post("/api/ops/flights", {
    data: { aircraftId, pilotId, purpose: "空撮", takeoffPlace: "試験地点", landingPlace: "試験地点", safetyIssue: false, takeoffAt: s.takeoffAt, landingAt: s.landingAt, ...extra },
  });
  expect(r.status(), await r.text()).toBe(201);
  const j = (await r.json()) as { id: string; version?: number };
  return { id: j.id, version: j.version ?? 1, s };
};
const createInspection = async (aircraftId: string, inspectedAt: string): Promise<{ id: string; version: number }> => {
  const r = await manager.post("/api/ops/inspections", { data: { aircraftId, pilotId, inspectedAt, timing: "pre_flight", placeName: "本社 駐車場", items: ALL_NORMAL } });
  expect(r.status(), await r.text()).toBe(201);
  const j = (await r.json()) as { id: string; version?: number };
  return { id: j.id, version: j.version ?? 1 };
};

test.beforeAll(async () => {
  manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  pilotId = ((await (await pilot.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
  await pilot.dispose();
});
test.afterAll(async () => {
  await manager.dispose();
});

const PRIMARY = '.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]';
const visiblePrimaries = (page: Page): Promise<string[]> =>
  page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden")
        .map((el) => (el.textContent ?? "").trim()),
    PRIMARY,
  );
const noHScroll = async (page: Page, label: string) => {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `${label}: 横スクロール`).toBeLessThanOrEqual(r.cw);
};
const rowOf = (page: Page, id: string, kind: "flight" | "inspection") =>
  page.locator(`[data-testid="journal-row"][data-kind="${kind}"]:has(a[href="/ops/${kind === "flight" ? "flights" : "inspections"}/${id}"])`);

test.describe("16-J 日誌（J-1）", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("J-1. タブ（すべて・飛行記録・日常点検・事故）は共通のチップ（48 以上）。選択中は aria-current=page。切り替えると一覧が変わる", async ({ page }) => {
    const a = await createAircraft();
    const f = await createFlight(a.id);
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/journal");
    await expect(page.getByTestId("journal-tabs")).toBeVisible();
    await waitForSettledStyles(page);
    const tabs = ["all", "flights", "inspections", "incidents"] as const;
    for (const k of tabs) {
      const t = page.getByTestId(`journal-tab-${k}`);
      await expect(t).toHaveClass(/\bsb-chip\b/);
      expect((await t.boundingBox())!.height, `${k} の高さ`).toBeGreaterThanOrEqual(48);
    }
    await expect(page.getByTestId("journal-tab-all")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("journal-tab-flights")).not.toHaveAttribute("aria-current", /.*/);
    // 選択中は縁と面で見分ける（旧い opx-seg ではない）
    expect(await page.locator(".opx-seg").count()).toBe(0);
    const [cur, other] = await Promise.all([
      page.getByTestId("journal-tab-all").evaluate((el) => ({ w: getComputedStyle(el).borderTopStyle, fw: getComputedStyle(el).fontWeight })),
      page.getByTestId("journal-tab-flights").evaluate((el) => ({ w: getComputedStyle(el).borderTopStyle, fw: getComputedStyle(el).fontWeight })),
    ]);
    expect(cur.w).toBe("solid");
    expect(other.w).toBe("dashed");
    expect(Number(cur.fw)).toBeGreaterThan(Number(other.fw));
    await page.goto("/ops/journal?tab=flights");
    await expect(page.getByTestId("journal-tab-flights")).toHaveAttribute("aria-current", "page");
    await expect(rowOf(page, f.id, "flight")).toHaveCount(1);
    await expect(page.locator('[data-testid="journal-row"][data-kind="inspection"]')).toHaveCount(0);
    await page.goto("/ops/journal?tab=inspections");
    await expect(page.getByTestId("journal-tab-inspections")).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-testid="journal-row"][data-kind="flight"]')).toHaveCount(0);
    await expect(page.getByTestId("journal-tab-incidents")).toHaveAttribute("href", "/ops/incidents");
  });

  test("J-1. 飛行記録のカード：離陸–着陸の時刻と飛行時間を数値の強調（tabular-nums・20px 以上・太字）で出す。カード全体が押せて 72 以上。主ボタンは 1 つ", async ({ page }) => {
    const a = await createAircraft();
    const s = slot(45);
    const f = await createFlight(a.id, s);
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/journal?tab=flights");
    const row = rowOf(page, f.id, "flight");
    await expect(row).toHaveCount(1);
    await waitForSettledStyles(page);
    const link = row.getByTestId("journal-row-link");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(72);
    // カード全体が 1 つのリンク（見出しの種別・日付・時刻・機体・操縦者が同じ a の中）
    await expect(link).toContainText(s.day);
    await expect(row.getByTestId("journal-row-takeoff-landing")).toHaveText(`離陸から着陸${s.takeoff}–${s.landing}`);
    await expect(row.getByTestId("journal-row-minutes")).toHaveText("0:45");
    await expect(link).toContainText(a.mark);
    for (const id of ["journal-row-takeoff-landing", "journal-row-minutes"] as const) {
      const st = await row.getByTestId(id).evaluate((el) => {
        const c = getComputedStyle(el);
        return { nums: c.fontVariantNumeric, size: parseFloat(c.fontSize), weight: Number(c.fontWeight) };
      });
      expect(st.nums, `${id} tabular-nums`).toContain("tabular-nums");
      expect(st.size, `${id} の文字`).toBeGreaterThanOrEqual(20);
      expect(st.weight, `${id} の太さ`).toBeGreaterThanOrEqual(700);
    }
    // 本文・補足は 14px 以上（本文 16px 以上）
    const small = await link.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*")).filter((e) => (e.textContent ?? "").trim() !== "" && e.children.length === 0 && parseFloat(getComputedStyle(e).fontSize) < 14).map((e) => e.textContent));
    expect(small, "14px 未満の文字").toEqual([]);
    // 主ボタンは「飛行記録を入力」の 1 つだけ
    expect(await visiblePrimaries(page)).toEqual(["飛行記録を入力"]);
    // 色だけに頼らない：禁止語・通報不要などの語が出ない
    const body = (await page.locator("main").innerText()).replace(/\s+/g, "");
    for (const w of ["完璧", "保証", "必ず", "代行", "代理", "通報不要", "問題なし", "飛行可", "安全", "OK"]) expect(body, w).not.toContain(w);
  });

  test("J-1. 取消済みは正常・完了と読める表示を出さない：飛行記録・点検とも「取消済み」だけ（情報の状態ラベル、破線の縁）", async ({ page }) => {
    const a = await createAircraft();
    const flight = await createFlight(a.id, slot(30));
    const insp = await createInspection(a.id, `${NOW_DAY}T09:30`);
    const okInsp = await createInspection(a.id, `${NOW_DAY}T10:30`);
    const v1 = await manager.post(`/api/ops/flights/${flight.id}/void`, { data: { expectedVersion: flight.version, reason: "試験の取消" } });
    expect(v1.status(), await v1.text()).toBe(200);
    const v2 = await manager.post(`/api/ops/inspections/${insp.id}/void`, { data: { expectedVersion: insp.version, reason: "試験の取消" } });
    expect(v2.status(), await v2.text()).toBe(200);
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/journal");
    await waitForSettledStyles(page);
    for (const [kind, id] of [["flight", flight.id], ["inspection", insp.id]] as const) {
      const row = rowOf(page, id, kind);
      await expect(row, kind).toHaveCount(1);
      await expect(row.locator("[data-tone]"), `${kind}: 状態ラベルは 1 つ`).toHaveCount(1);
      await expect(row.locator('[data-result="voided"] [data-tone="info"]')).toHaveText("取消済み");
      for (const tone of ["safe", "warn"]) await expect(row.locator(`[data-tone="${tone}"]`), `${kind} ${tone}`).toHaveCount(0);
      await expect(row).not.toContainText(/点検済み|異常なし|飛行済み|完了|正常/);
      expect(await row.getByTestId("journal-row-link").evaluate((el) => getComputedStyle(el).borderTopStyle), `${kind}: 破線の縁`).toBe("dashed");
    }
    // 取り消されていない点検は、これまでどおり「点検済み」（安全の印）
    await expect(rowOf(page, okInsp.id, "inspection").locator('[data-tone="safe"]')).toHaveText("点検済み");
    // 取り消されていない飛行記録には、完了・正常の状態ラベルを付けない（記録の事実だけ）
    const a2 = await createAircraft();
    const live = await createFlight(a2.id, slot(30));
    await page.goto("/ops/journal?tab=flights");
    await expect(rowOf(page, live.id, "flight").locator("[data-tone]")).toHaveCount(0);
    expect(await visiblePrimaries(page)).toEqual(["飛行記録を入力"]);
  });

  for (const w of [320, 360]) {
    test(`J-1. 日誌は ${w} 幅で横スクロールがなく、文字 200% でも切れない（飛行記録・点検のカードがある状態）`, async ({ page }) => {
      const a = await createAircraft();
      await createFlight(a.id, slot(30));
      await createInspection(a.id, `${NOW_DAY}T09:00`);
      await signIn(page.request, seeded("a-manager"));
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto("/ops/journal");
      await expect(page.getByTestId("journal-list")).toBeVisible();
      await waitForSettledStyles(page);
      await noHScroll(page, `日誌 ${w}`);
      await expectTextZoom(page, "日誌", [w]);
    });
  }
});

test.describe("16-J 飛行記録の入力（J-2）", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const form = (page: Page) => page.getByRole("form", { name: "飛行記録の入力" });

  test("J-2. 節は共通の節の見出し（5 つ）、特定飛行の形態はチェック行（72 以上）。主ボタンは「飛行記録を保存」の 1 つだけ", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/flights/new");
    await expect(form(page)).toBeVisible();
    await waitForSettledStyles(page);
    // 節の見出し：.sb-sec-head（左の線）。旧い fieldset の見出しではない。名前は section の名前になる
    const titles = ["機体・操縦者・日常点検", "離陸", "着陸", "飛行概要", "安全に影響のあった事項・不具合"];
    await expect(form(page).locator(".sb-sec-head h2")).toHaveText(titles);
    for (const t of titles) await expect(page.getByRole("region", { name: t, exact: true })).toHaveCount(1);
    expect(await form(page).locator("fieldset.opx-step").count()).toBe(0);
    // チェック行（CheckRow）：特定飛行の形態の全項目。行 72 以上・丸 32
    const rows = form(page).locator(".sb-chk");
    const n = await rows.count();
    expect(n).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < n; i++) expect((await rows.nth(i).boundingBox())!.height, `チェック行 ${i}`).toBeGreaterThanOrEqual(72);
    const cb = rows.first().locator("input[type=checkbox]");
    expect(await cb.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height])).toEqual([32, 32]);
    // 選ぶと「済」が出て、読み上げ名は項目名のまま
    const first = rows.first();
    const name = ((await first.locator(".sb-chk-text").textContent()) ?? "").trim();
    await expect(first.locator(".sb-chk-done")).toBeHidden();
    await form(page).getByRole("checkbox", { name, exact: true }).check();
    await expect(first.locator(".sb-chk-done")).toBeVisible();
    await expect(first.locator(".sb-chk-done")).toHaveText("済");
    // 主ボタン：見えている主は 1 つで、文字は「飛行記録を保存」。「今」・補助の操作は主ではない
    expect(await visiblePrimaries(page)).toEqual(["飛行記録を保存"]);
    await expect(page.getByRole("button", { name: "飛行記録を保存", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
    expect((await page.getByRole("button", { name: "飛行記録を保存", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(56);
    for (const b of ["離陸：今", "着陸：今", "現在地を入れる", "不具合を加える"]) {
      const btn = page.getByRole("button", { name: b }).first();
      if (await btn.count()) expect(await btn.evaluate((el) => el.matches('.opx-btn-primary, [data-variant="primary"]')), `${b} は主ではない`).toBe(false);
    }
  });

  test("J-2. 流れは変わらない：点検を結び付けて保存でき、POST に点検の ID が入る。保存後は詳細へ移り、下書きは消える。端末に残すのは今までの下書きの 1 つだけ", async ({ page }) => {
    const a = await createAircraft();
    const s = slot(25);
    const insp = await createInspection(a.id, `${s.day}T00:00`);
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/flights/new");
    const f = form(page);
    await expect(f).toBeVisible();
    await f.getByRole("combobox", { name: "機体", exact: true }).selectOption(a.id);
    await f.getByRole("combobox", { name: "操縦者", exact: true }).selectOption(pilotId);
    await f.getByRole("textbox", { name: "離陸場所", exact: true }).fill("日誌の試験場");
    await f.getByLabel("離陸日", { exact: true }).fill(s.day);
    await f.getByLabel("離陸時刻", { exact: true }).fill(s.takeoff);
    await f.getByLabel("着陸日", { exact: true }).fill(s.day);
    await f.getByLabel("着陸時刻", { exact: true }).fill(s.landing);
    await f.getByRole("textbox", { name: "着陸場所", exact: true }).fill("日誌の試験場");
    await f.getByLabel("飛行の目的").fill("空撮");
    await f.getByRole("radio", { name: "なし" }).check();
    await expect(page.getByTestId("flight-minutes")).toHaveText("0:25");
    await expect(page.getByTestId("inspection-select").locator(`option[value="${insp.id}"]`)).toHaveCount(1);
    await page.getByTestId("inspection-select").selectOption(insp.id);
    // 端末のデータ：新しい鍵を増やさない（下書きの鍵 1 つ。sessionStorage・IndexedDB・Cache は使わない）
    const store = await page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      idb: (await (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> }).databases?.().catch(() => []))?.map((d) => d.name) ?? [],
      caches: await caches.keys().catch(() => [] as string[]),
    }));
    expect(store.local.filter((k) => !k.startsWith("soraban:ops-draft:flight:")).filter((k) => k.includes("draft") || k.includes("flight")), "下書き以外の鍵").toEqual([]);
    expect(store.session).toEqual([]);
    const posted = page.waitForRequest((r) => r.url().endsWith("/api/ops/flights") && r.method() === "POST");
    await page.getByRole("button", { name: "飛行記録を保存", exact: true }).click();
    const body = (await posted).postDataJSON() as Record<string, unknown>;
    expect(body["dailyInspectionId"]).toBe(insp.id);
    expect(body["takeoffAt"]).toBe(s.takeoffAt);
    expect(body["landingAt"]).toBe(s.landingAt);
    await expect(page).toHaveURL(/\/ops\/flights\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("flight-minutes-detail")).toHaveText("0:25");
    await page.goto("/ops/flights/new");
    await expect(f.getByRole("textbox", { name: "離陸場所", exact: true })).toHaveValue("");
    // 日誌の一覧に、時刻と飛行時間つきで出る
    await page.goto("/ops/journal?tab=flights");
    const row = page.locator(`[data-testid="journal-row"][data-kind="flight"]:has-text("${a.mark}")`);
    await expect(row.getByTestId("journal-row-takeoff-landing")).toContainText(`${s.takeoff}–${s.landing}`);
    await expect(row.getByTestId("journal-row-minutes")).toHaveText("0:25");
  });

  test("J-2. 計画からの初期値と、日誌から点検への移動（takeoffAt 付き）は変わらない", async ({ page }) => {
    const a = await createAircraft();
    const plan = await manager.post("/api/ops/plans", {
      data: { title: `日誌の確認 ${stamp}${seq++}`, aircraftId: a.id, pilotId, plannedStartAt: `${NOW_DAY}T15:00`, durationMinutes: 60, purpose: "測量", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] },
    });
    expect(plan.status(), await plan.text()).toBe(201);
    const planId = ((await plan.json()) as { id: string }).id;
    await signIn(page.request, seeded("a-manager"));
    await page.goto(`/ops/flights/new?planId=${planId}`);
    const f = form(page);
    await expect(f).toBeVisible();
    await expect(page.getByTestId("flight-from-plan")).toBeVisible();
    await expect(f.getByRole("combobox", { name: "機体", exact: true })).toHaveValue(a.id);
    await expect(f.getByRole("combobox", { name: "操縦者", exact: true })).toHaveValue(pilotId);
    await expect(f.getByLabel("飛行の目的")).toHaveValue("測量");
    await expect(f.getByRole("textbox", { name: "離陸場所", exact: true })).toHaveValue("試験地点");
    // 計画の予定時刻は離着陸の時刻に入れない
    await expect(f.getByLabel("離陸時刻", { exact: true })).toHaveValue("");
    // 点検がない日：日誌から点検へ。離陸の日時を入れると takeoffAt が付き、計画の機体と同じなので planId・returnTo も付く
    const s = slot(20);
    await f.getByLabel("離陸日", { exact: true }).fill(s.day);
    await f.getByLabel("離陸時刻", { exact: true }).fill(s.takeoff);
    const link = page.getByTestId("journal-inspection-new");
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    expect(href).toContain(`/ops/inspections/new?aircraftId=${a.id}`);
    expect(href).toContain(`planId=${planId}`);
    expect(href).toContain(`takeoffAt=${encodeURIComponent(s.takeoffAt)}`);
    expect(href).toContain("returnTo=");
    expect(await visiblePrimaries(page)).toEqual(["飛行記録を保存"]);
  });

  for (const w of [320, 360]) {
    test(`J-2. 飛行記録の入力は ${w} 幅・文字 200% で横にはみ出さず、点検の入力の「区分」も 320 幅・200% で収まる（16-I の申し送り E-3）`, async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto("/ops/flights/new");
      await expect(form(page)).toBeVisible();
      await waitForSettledStyles(page);
      await noHScroll(page, `飛行記録の入力 ${w}`);
      await expectTextZoom(page, "飛行記録の入力", [w]);
      await page.goto("/ops/inspections/new");
      await expect(page.getByRole("form", { name: "日常点検の入力" })).toBeVisible();
      await waitForSettledStyles(page);
      await expectTextZoom(page, "点検の入力（区分）", [w]);
      // 区分のラジオのラベルが画面の幅を超えない（200%）
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      const over = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return Array.from(document.querySelectorAll<HTMLElement>('input[name="timing"]'))
          .map((i) => i.closest("label")!.getBoundingClientRect())
          .filter((r) => r.right > vw + 0.5 || r.left < -0.5)
          .map((r) => Math.round(r.right));
      });
      expect(over, "区分のラベルが横にはみ出す").toEqual([]);
    });
  }
});
