import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { expectNoForbiddenTextContent, gotoPlan, gotoPlanOpen } from "./plan-screen";

// Sprint 17-2 の E2E-DB（長さ L・主画面 J・通報の作業台 S-4）。元は 17-1 の E2E-DB（docs/sprints/sprint-17.md §10 の S-1〜S-3・S-5・S-6・J-1〜J-4 の構造の部分）。
// 画面の分離：通報の主画面（/ops/plans/[id]）・通報の作業台（/report）・計画（/overview）・日誌（/journal）・判定（/judgement）。
// 長さ（L）・通報の主画面の作り込み（plan-primary-action ほか）は 17-2。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する。
// サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定している。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const MOCK_BASE = `http://127.0.0.1:${process.env.E2E_OPS_MOCK_ADAPTER_PORT ?? 3302}`;
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

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
const noBrowserCache = (page: Page) => page.route("**/_next/**", (route) => route.continue());

const NIGHT_SPOT = { lat: 35.44, lng: 133.35 };
type PlanJson = { id: string; version: number; currentSnapshotId: string; nextActions: { id: string; href: string }[] };

const FORBIDDEN = ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて", "問題なし", "大丈夫"];

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

/** 対象の要素の上端がビューポートの中にある（スクロールされている）。URL や要素の存在だけでは足りない。 */
const expectInViewport = async (page: Page, id: string, label: string) => {
  const el = page.locator(`#${id}:visible`).first();
  await expect(el, `${label}: #${id} が表示される`).toBeVisible();
  const vh = page.viewportSize()!.height;
  await expect
    .poll(
      async () => {
        const box = await el.boundingBox();
        return box !== null && box.y >= 0 && box.y < vh - 48;
      },
      { message: `${label}: #${id} がビューポートの中にある`, timeout: 15_000 },
    )
    .toBe(true);
};


const SIZES = [
  { name: "375x812", width: 375, height: 812, firstScreen: 748, main: 2600, report: 10400, judgement: 4600, overview: 3000, journal: 1400 },
  { name: "1280x800", width: 1280, height: 800, firstScreen: 800, main: 1800, report: 7000, judgement: 3300, overview: 2200, journal: 1100 },
] as const;

const height = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 17-2 E2E-DB：通報の主画面と作業台", () => {
  let manager: APIRequestContext;
  let aircraftId = "";
  let pilotId = "";

  const createPlan = async (extra: object = {}): Promise<PlanJson> => {
    const r = await manager.post("/api/ops/plans", {
      data: {
        title: `S172 ${stamp}-${seq++}`,
        aircraftId,
        pilotId,
        plannedStartAt: "2027-01-10T10:00",
        durationMinutes: 30,
        purpose: "空撮",
        placeName: "試験地点",
        latitude: NIGHT_SPOT.lat,
        longitude: NIGHT_SPOT.lng,
        radiusM: 200,
        maxAltitudeM: 100,
        flags: ["method_night"],
        ...extra,
      },
    });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()) as PlanJson;
  };
  const getPlan = async (id: string): Promise<PlanJson> => (await (await manager.get(`/api/ops/plans/${id}`)).json()) as PlanJson;
  const activate = async (p: PlanJson): Promise<PlanJson> => {
    const r = await manager.post(`/api/ops/plans/${p.id}/request-confirmation`, { data: { expectedVersion: p.version } });
    expect(r.status(), await r.text()).toBe(200);
    return getPlan(p.id);
  };
  const recordApi = async (p: PlanJson, kind: "new" | "cancel" | "change", number: string, base?: string) => {
    const cur = await getPlan(p.id);
    const r = await manager.post(`/api/ops/plans/${p.id}/reports`, {
      data: {
        kind,
        ...(base ? { baseReportId: base } : {}),
        expectedPlanVersion: cur.version,
        manual: { reportedAt: "2027-01-05T11:00", dipsNumber: number, confirmedDipsDone: true, confirmedMatchesLatest: true },
      },
    });
    expect(r.status(), await r.text()).toBeLessThan(300);
  };
  const voidPlan = async (p: PlanJson) => {
    const v = await getPlan(p.id);
    expect((await manager.post(`/api/ops/plans/${p.id}/void`, { data: { expectedVersion: v.version, reason: "中止" } })).status()).toBe(200);
  };

  type States = Record<"draft" | "pending" | "reported" | "change" | "voidedNone" | "voidedRecorded", PlanJson>;
  let plans: States;

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    const mark = `JUS172${stamp}`;
    const r = await manager.post("/api/ops/aircraft", {
      data: { registrationMark: mark, modelName: "S172 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    expect(r.status(), await r.text()).toBe(201);
    aircraftId = ((await r.json()) as { id: string }).id;
    const me = await apiAs(seeded("a-pilot"));
    pilotId = ((await (await me.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await me.dispose();
    const draft = await createPlan();
    const pending = await activate(await createPlan());
    const reported = await activate(await createPlan());
    await recordApi(reported, "new", "FP-S172-0001");
    const change = await activate(await createPlan());
    await recordApi(change, "new", "FP-S172-0002");
    const cur = await getPlan(change.id);
    const patched = await manager.patch(`/api/ops/plans/${change.id}`, { data: { expectedVersion: cur.version, reason: "時刻の変更", plannedStartAt: "2027-01-10T13:00", durationMinutes: 45 } });
    expect(patched.status(), await patched.text()).toBe(200);
    const voidedNone = await createPlan();
    await voidPlan(voidedNone);
    const voidedRecorded = await activate(await createPlan());
    await recordApi(voidedRecorded, "new", "FP-S172-0003");
    await voidPlan(voidedRecorded);
    plans = { draft, pending, reported, change, voidedNone, voidedRecorded };
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const login = async (page: Page) => {
    await noBrowserCache(page);
    await signIn(page.request, seeded("a-manager"));
  };

  const expectLabel: Record<keyof States, string> = {
    draft: "確認を依頼する",
    pending: "通報の内容を見る・通報する",
    reported: "通報の結果を見る",
    change: "変更の通報を準備する",
    voidedNone: "計画の内容を見る",
    voidedRecorded: "取消の結果を記録する",
  };
  for (const size of SIZES) {
    for (const key of ["draft", "pending", "reported", "change", "voidedNone", "voidedRecorded"] as const) {
      test(`L-1・L-2・J-1・J-4・主操作（${size.name}・${key}）：主画面の長さ・最初の画面・判定の 1 行・禁止語`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await login(page);
        const p = plans[key];
        await gotoPlan(page, `/ops/plans/${p.id}`);
        await expect(page.getByTestId("plan-report-card")).toBeVisible();
        const h = await height(page);
        console.log(`[長さ] 主画面 ${size.name} ${key}: ${h}px`);
        expect(h, `${key}: 主画面の長さ`).toBeLessThanOrEqual(size.main);
        // L-2：スクロールなしで、タイトル・タブ・状況・主操作が入る
        // 契約どおり plan-report-status も（中止・記録なしでは状況の行を出さず、事実の 1 行 plan-report-label に代える）
        const firstScreenIds = ["plan-title-heading", "plan-tabs", "plan-report-label", "plan-primary-action", ...(key === "voidedNone" ? [] : ["plan-report-status"])];
        // 2026-11-23 ユーザーの決定（16-B 差し戻し 1）：中止済みかつ通報を記録済み（voidedRecorded）の 375 幅だけ 748→800 に一時的に緩める。
        // ほかの状態・幅は変えない。16-L の L-5 で 748 に戻す。
        const firstScreenLimit = key === "voidedRecorded" && size.width === 375 ? 800 : size.firstScreen;
        for (const id of firstScreenIds) {
          const box = await page.getByTestId(id).first().boundingBox();
          expect(box, `${key} ${id}`).not.toBeNull();
          expect(box!.y + box!.height, `${key} ${id} の下端`).toBeLessThanOrEqual(firstScreenLimit);
        }
        const primary = page.getByTestId("plan-primary-action");
        await expect(primary).toHaveCount(1);
        await expect(primary).toHaveText(expectLabel[key]);
        expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(48);
        // J-1・J-4：判定の 1 行は「判定（補助）：」で始まる。禁止語が無い
        const line = (await page.getByTestId("plan-judge-line").innerText()).replace(/\s+/g, "");
        expect(line.startsWith("判定（補助）："), `${key}: ${line}`).toBe(true);
        const text = await page.locator("main").first().innerText();
        for (const w of FORBIDDEN) expect(text, `${key}: 「${w}」`).not.toContain(w);
        expect(text, `${key}: OK`).not.toMatch(/\bOK\b/);
        await expectNoForbiddenTextContent(page, `${key} 主画面`);
        const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(sw.sw).toBeLessThanOrEqual(sw.cw);
        await expect(page.getByTestId("plan-judge-link")).toHaveAttribute("href", `/ops/plans/${p.id}/judgement`);
        await expect(page.getByTestId("plan-confirm-link")).toHaveAttribute("href", `/ops/plans/${p.id}/overview#sec-confirm`);
      });
    }
  }

  test("中止した計画：記録が無ければ事実だけ（「通報：要」と出さない）。記録があれば取消の記録へ", async ({ page }) => {
    await login(page);
    await gotoPlan(page, `/ops/plans/${plans.voidedNone.id}`);
    await expect(page.getByTestId("plan-report-label")).toHaveText("中止（通報の記録はありません）");
    const text = await page.locator("main").first().innerText();
    expect(text).not.toContain("通報：要");
    for (const w of FORBIDDEN) expect(text).not.toContain(w);
    await expect(page.getByTestId("plan-steps")).toHaveCount(0);
    await gotoPlan(page, `/ops/plans/${plans.voidedRecorded.id}`);
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "cancel_needed");
    await expect(page.getByTestId("plan-report-status-label")).toContainText("DIPS で通報を取り消し");
    await expect(page.getByTestId("plan-primary-action")).toHaveAttribute("href", `/ops/plans/${plans.voidedRecorded.id}/report?kind=cancel#record`);
  });

  test("L-6・手順（plan-steps）：主画面から通報の内容・結果の記録・判定・確認へ、1 回の押下で移る", async ({ page }) => {
    await login(page);
    const base = `/ops/plans/${plans.pending.id}`;
    const hops: [string, RegExp][] = [
      ["plan-primary-action", /\/report$/],
      ["plan-report-link", /\/report$/],
      ["plan-step-1", /\/report#inputs$/],
      ["plan-step-2", /\/report#items$/],
      ["plan-step-3", /\/report#record$/],
      ["plan-judge-link", /\/judgement$/],
      ["plan-confirm-link", /\/overview#sec-confirm$/],
    ];
    for (const [id, url] of hops) {
      await gotoPlan(page, base);
      await expect(page.getByTestId("plan-steps")).toBeVisible();
      await tapAndWait(page, page.getByTestId(id), url);
    }
  });

  for (const size of SIZES) {
    test(`L-3・L-5・S-4（${size.name}）：通報の作業台の長さ・手順バー・項目の行の高さ・記録へ 1 回で移る`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await login(page);
      await page.goto(`/ops/plans/${plans.pending.id}/report`);
      await expect(page.getByTestId("report-screen")).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const h = await height(page);
      console.log(`[長さ] 作業台 ${size.name}: ${h}px`);
      expect(h).toBeLessThanOrEqual(size.report);
      // スクロールなしで、固定の文言（短い版）・手順バー・種別タブ
      for (const id of ["report-notice-short", "report-stepper", "report-kind-tabs"]) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, id).not.toBeNull();
        expect(box!.y + box!.height, `${id} の下端`).toBeLessThanOrEqual(size.firstScreen);
      }
      // S-4：DOM の順
      const order = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s);
        const ids = ['[data-testid="report-notice"]', '[data-testid="report-stepper"]', "#status", '[data-testid="report-kind-tabs"]', "#inputs", "#items", "#record", "#history", "#audit"];
        const els = ids.map(q);
        return els.map((e, i) => (e === null ? -1 : i === 0 ? 0 : (els[i - 1]!.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0)));
      });
      expect(order.slice(1).every((v) => v === 1), JSON.stringify(order)).toBe(true);
      // L-5：項目の行の平均の高さ・コピーの押す面
      if (size.width === 375) {
        const rows = await page.locator('li[data-testid^="report-item-"][data-status]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        const avg = rows.reduce((a, b) => a + b, 0) / rows.length;
        console.log(`[長さ] 項目の行 ${rows.length} 件の平均 ${avg.toFixed(1)}px`);
        expect(rows.length).toBeGreaterThan(20);
        expect(avg).toBeLessThanOrEqual(76);
      }
      const copies = await page.locator('[data-testid^="report-copy-"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(copies.length).toBeGreaterThan(0);
      for (const c of copies) expect(c).toBeGreaterThanOrEqual(48);
      // 手順バーの「結果を記録する」→ #record
      await page.getByTestId("report-step-record").click();
      await expect.poll(() => page.evaluate(() => location.hash)).toBe("#record");
      await expectInViewport(page, "record", "手順バー");
      // 履歴・監査は畳んでも DOM にある
      await expect(page.getByTestId("report-audit-details")).toHaveCount(1);
    });
  }

  test("履歴：最新の有効な通報は常に見え、古い版は 1 回で開く", async ({ page }) => {
    await login(page);
    await page.goto(`/ops/plans/${plans.reported.id}/report`);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await expect(page.getByTestId("report-row-effective").first()).toBeVisible();
    await expect(page.getByTestId("report-status-details")).toHaveCount(1);
  });

  for (const size of SIZES) {
    test(`L-4（${size.name}）：判定・計画・日誌の長さ`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await login(page);
      const base = `/ops/plans/${plans.pending.id}`;
      for (const [path, limit, name] of [["/overview", size.overview, "計画"], ["/journal", size.journal, "日誌"]] as const) {
        await gotoPlan(page, `${base}${path}`);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        const h = await height(page);
        console.log(`[長さ] ${name} ${size.name}: ${h}px`);
        expect(h, name).toBeLessThanOrEqual(limit);
      }
      // 判定（16-H2 H2-5）：組織の許可・承認の登録の件数に依存しない測り方にする。
      // 判定の画面は、計画の日時・場所・機体・操縦者が範囲に収まる登録を「候補」として並べる（1 件あたり約 96px）。全体の実行が進むと
      // 組織の登録が増え、同じ計画でも候補が増えて長さが変わっていた（候補 10 件で 5,068px）。そこで (1) 登録のどれの有効期間にも入らない
      // 日付（2031-06-15）の計画で測り、候補を 0 件に固定する。(2) 候補が何件あっても、見えている候補は 3 件まで（残りは畳む）ことを、
      // 登録の件数が変わりうる計画（pending）で確かめる。
      const fixed = await activate(await createPlan({ plannedStartAt: "2031-06-15T10:00", title: `S172 len ${stamp}-${seq++}` }));
      await gotoPlan(page, `/ops/plans/${fixed.id}/judgement`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(page.getByTestId("plan-permit-candidate")).toHaveCount(0);
      const hj = await height(page);
      console.log(`[長さ] 判定（候補 0 件に固定）${size.name}: ${hj}px`);
      expect(hj, "判定").toBeLessThanOrEqual(size.judgement);
      await gotoPlan(page, `${base}/judgement`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const shown = await page.locator('[data-testid="plan-permit-candidate"]:visible').count();
      const all = await page.locator('[data-testid="plan-permit-candidate"]').count();
      console.log(`[長さ] 判定（登録の件数が変わりうる計画）${size.name}: ${await height(page)}px、候補 ${all} 件のうち見えるのは ${shown} 件`);
      expect(shown, "見えている候補は 3 件まで").toBeLessThanOrEqual(3);
      // 候補が 3 件見える計画も、同じ上限で測る（上限は上げない。超えたら値を報告して止まる）
      const hp = await height(page);
      console.log(`[長さ] 判定（候補 ${shown} 件が見える計画）${size.name}: ${hp}px`);
      expect(hp, `判定（候補 ${shown} 件が見える）`).toBeLessThanOrEqual(size.judgement);
    });
  }

  test("高-1：通報済みの計画を中止し、後の変更の行が失敗していても(取消は手動の記録で失敗しない)、主画面に「取消が必要です」と出て、主操作は取消の記録になる(模擬アダプター)", async ({ page }) => {
    await login(page);
    const mockApi = await pwRequest.newContext({ baseURL: MOCK_BASE });
    await signIn(mockApi, seeded("a-manager"));
    const mk = async (extra: object = {}) => {
      const r = await mockApi.post("/api/ops/plans", {
        data: { title: `S172M ${stamp}-${seq++}`, aircraftId, pilotId, plannedStartAt: "2027-01-12T10:00", durationMinutes: 30, purpose: "空撮", placeName: "試験地点", latitude: NIGHT_SPOT.lat, longitude: NIGHT_SPOT.lng, radiusM: 200, maxAltitudeM: 100, flags: ["method_night"], ...extra },
      });
      expect(r.status(), await r.text()).toBe(201);
      return (await r.json()) as PlanJson;
    };
    const plan = await mk();
    expect((await mockApi.post(`/api/ops/plans/${plan.id}/request-confirmation`, { data: { expectedVersion: plan.version } })).status()).toBe(200);
    const ver = async () => ((await (await mockApi.get(`/api/ops/plans/${plan.id}`)).json()) as PlanJson).version;
    const sent = await mockApi.post(`/api/ops/plans/${plan.id}/reports`, { data: { kind: "new", expectedPlanVersion: await ver(), confirmSend: true, mockScenario: "ok" } });
    expect(sent.status(), await sent.text()).toBeLessThan(300);
    const effId = ((await sent.json()) as { report: { id: string } }).report.id;
    const failedChange = await mockApi.post(`/api/ops/plans/${plan.id}/reports`, { data: { kind: "change", baseReportId: effId, expectedPlanVersion: await ver(), confirmSend: true, mockScenario: "rejected" } });
    expect(failedChange.status(), await failedChange.text()).toBeLessThan(300);
    expect((await mockApi.post(`/api/ops/plans/${plan.id}/void`, { data: { expectedVersion: await ver(), reason: "中止" } })).status()).toBe(200);
    await mockApi.dispose();
    await gotoPlan(page, `${MOCK_BASE}/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "failed");
    await expect(page.getByTestId("plan-cancel-needed")).toBeVisible();
    await expect(page.getByTestId("plan-cancel-needed")).toContainText("取消が必要です");
    const primary = page.getByTestId("plan-primary-action");
    await expect(primary).toHaveText("取消の結果を記録する");
    await expect(primary).toHaveAttribute("href", `/ops/plans/${plan.id}/report?kind=cancel#record`);
    const box = (await primary.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(812);
  });

  test("中-2・中-3：期限超過の警告は /report と主画面で開く操作なしに見える。状況の詳細はキーボードで開閉できる", async ({ page }) => {
    await login(page);
    const overdue = await activate(await createPlan({ plannedStartAt: "2027-01-05T10:00", title: `S172 期限 ${stamp}` }));
    await gotoPlan(page, `/ops/plans/${overdue.id}`);
    await expect(page.getByTestId("plan-report-deadline")).toHaveAttribute("data-state", "overdue_started");
    await expect(page.getByTestId("plan-report-deadline-message")).toBeVisible();
    await expect(page.getByTestId("plan-report-penalty")).toBeVisible();
    await page.goto(`/ops/plans/${overdue.id}/report`);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await expect(page.getByTestId("report-status-details")).toHaveAttribute("open", "");
    await expect(page.getByTestId("plan-report-deadline")).toBeVisible();
    await expect(page.getByTestId("plan-report-penalty")).toBeVisible();
    // 通常の計画では閉じている。summary にフォーカスして Enter で開閉できる
    await page.goto(`/ops/plans/${plans.pending.id}/report`);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const details = page.getByTestId("report-status-details");
    await expect(details).not.toHaveAttribute("open", "");
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(page.getByTestId("plan-report-status")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open", "");
  });

  test("低-5：変更点が多く、通報の記録・版が多い計画でも、主画面・計画・作業台の長さを測る(上限を超えたら報告)", async ({ page }) => {
    await login(page);
    const plan = await activate(await createPlan({ plannedStartAt: "2027-01-20T10:00", title: `S172 長い ${stamp}` }));
    await recordApi(plan, "new", "FP-S172-LONG");
    let cur = await getPlan(plan.id);
    const edits: object[] = [
      { plannedStartAt: "2027-01-20T11:00", durationMinutes: 40 },
      { maxAltitudeM: 80, radiusM: 150 },
      { purpose: "点検", placeName: "試験地点 2" },
      { plannedStartAt: "2027-01-20T12:00", durationMinutes: 50, maxAltitudeM: 60 },
    ];
    for (const e of edits) {
      const r = await manager.patch(`/api/ops/plans/${plan.id}`, { data: { expectedVersion: cur.version, reason: "訂正", ...e } });
      expect(r.status(), await r.text()).toBe(200);
      cur = await getPlan(plan.id);
    }
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await gotoPlan(page, `/ops/plans/${plan.id}`);
      await expect(page.getByTestId("plan-report-changes")).toBeVisible();
      const changes = await page.getByTestId("plan-report-change-row").count();
      const main = await height(page);
      await gotoPlan(page, `/ops/plans/${plan.id}/overview`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const overview = await height(page);
      await page.goto(`/ops/plans/${plan.id}/report`);
      await expect(page.getByTestId("report-screen")).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const report = await height(page);
      console.log(`[長さ・長い計画] ${size.name} 変更点 ${changes} 件: 主画面 ${main}px / 計画 ${overview}px / 作業台 ${report}px`);
      // 16-B 差し戻し 1 の R1-8（2026-11-22）：この検査の実測が上限を超えたものだけ上げた（計画 375：3,000→3,300、1280：2,200→2,400、作業台 375：10,400→11,500。
      // 作業台 1280 の 7,000 と主画面は超えていないので元のまま）。L-4 の計画の上限（SIZES.overview）は上げていない。16-L の L-5 で元に戻す。
      const longLimit = size.width === 375 ? { overview: 3300, report: 11500 } : { overview: 2400, report: size.report };
      expect(main, "主画面").toBeLessThanOrEqual(size.main);
      expect(overview, "計画").toBeLessThanOrEqual(longLimit.overview);
      expect(report, "作業台").toBeLessThanOrEqual(longLimit.report);
    }
  });

  test("R-1：主画面の手順 ①②③・通報の結果を見る を押すと、/report の目的の節が手順バーの下に見える位置まで移る。着いた節にフォーカス", async ({ page }) => {
    await login(page);
    const hops: [string, string, string][] = [
      [plans.pending.id, "plan-step-1", "inputs"],
      [plans.pending.id, "plan-step-2", "items"],
      [plans.pending.id, "plan-step-3", "record"],
      [plans.reported.id, "plan-primary-action", "history"],
    ];
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const [id, link, section] of hops) {
        await gotoPlan(page, `/ops/plans/${id}`);
        await tapAndWait(page, page.getByTestId(link), new RegExp(`/report#${section}$`));
        await expect(page.getByTestId("report-screen")).toBeVisible();
        const stepper = page.getByTestId("report-stepper");
        await expect
          .poll(
            async () => {
              const top = await page.evaluate((sid) => document.getElementById(sid)?.getBoundingClientRect().top ?? -1, section);
              const stepBottom = (await stepper.boundingBox())!.y + (await stepper.boundingBox())!.height;
              return top >= stepBottom - 1 && top < size.height - 48;
            },
            { message: `${size.name} ${link}: #${section} が手順バーの下にある`, timeout: 15_000 },
          )
          .toBe(true);
        await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? ""), { message: "着いた節にフォーカス" }).toBe(section);
        // 手順バーは画面の上に固定されたまま見えている(375 は y 0〜56、広い画面は上バーの下 56〜112)
        const sb = (await stepper.boundingBox())!;
        const maxY = size.width >= 1024 ? 112 : 56;
        expect(sb.y, `${size.name} ${link}: 手順バーが固定表示`).toBeGreaterThanOrEqual(0);
        expect(sb.y, `${size.name} ${link}: 手順バーが固定表示`).toBeLessThanOrEqual(maxY);
        expect(await page.evaluate(() => window.scrollY), "実際にスクロールした").toBeGreaterThan(0);
      }
    }
  });

  test("R-2・R-3：通報済み・取消済みの見出しは状況の言葉。中止・記録なしの /report は手順バーを出さず、事実の文言にする", async ({ page }) => {
    await login(page);
    await gotoPlan(page, `/ops/plans/${plans.reported.id}`);
    await expect(page.getByTestId("plan-report-label")).toContainText("通報済み");
    await expect(page.getByTestId("plan-report-label")).not.toContainText("通報：要");
    await gotoPlan(page, `/ops/plans/${plans.voidedRecorded.id}`);
    await expect(page.getByTestId("plan-report-label")).toHaveText("取消の結果を記録してください");
    await page.goto(`/ops/plans/${plans.voidedNone.id}/report`);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await expect(page.getByTestId("report-stepper")).toHaveCount(0);
    await expect(page.getByTestId("report-status-line")).toContainText("中止（通報の記録はありません）");
    await expect(page.getByTestId("report-status-line")).not.toContainText("通報：要");
    await expect(page.getByTestId("report-inputs")).toHaveCount(0);
    await expectNoForbiddenTextContent(page, "中止・記録なしの作業台");
    await page.goto(`/ops/plans/${plans.pending.id}/report`);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await expectNoForbiddenTextContent(page, "作業台");
  });

  test("L-3・L-4（実データ並み）：通報の記録・版 12・飛行記録 8 件の計画でも、件数で畳んで上限内(作業台は 10,200px まで)", async ({ page }) => {
    await login(page);
    const plan = await activate(await createPlan({ plannedStartAt: "2027-01-20T10:00", title: `S172 多い ${stamp}` }));
    await recordApi(plan, "new", "FP-S172-MANY");
    let cur = await getPlan(plan.id);
    for (let i = 0; i < 10; i++) {
      const r = await manager.patch(`/api/ops/plans/${plan.id}`, { data: { expectedVersion: cur.version, reason: `訂正 ${i}`, durationMinutes: 31 + i } });
      expect(r.status(), await r.text()).toBe(200);
      cur = await getPlan(plan.id);
    }
    // 飛行記録：他の検査の時間帯と重ならないよう、過去の日付をずらして作る（繰り返しの実行でも重ならない）
    const day0 = Math.floor(Math.random() * 400) * 8;
    for (let i = 0; i < 8; i++) {
      const d = new Date(Date.UTC(2010, 0, 1) + (day0 + i) * 86_400_000).toISOString().slice(0, 10);
      const f = await manager.post("/api/ops/flights", {
        data: { aircraftId, pilotId, flightPlanId: plan.id, purpose: "空撮", takeoffPlace: "試験地点", landingPlace: "試験地点", safetyIssue: false, takeoffAt: `${d}T09:00`, landingAt: `${d}T09:20` },
      });
      expect(f.status(), await f.text()).toBeLessThan(300);
    }
    // 16-B 差し戻し 1 の R1-8（2026-11-22）：実測が超えた計画・作業台（375）と計画（1280）だけ上げた（375：計画 3,000→3,200・作業台 10,400→11,400、1280：計画 2,200→2,400）。日誌と 1280 の作業台は元のまま。16-L の L-5 で戻す。
    const limits = { 375: { report: 11400, overview: 3200, journal: 1400 }, 1280: { report: 7000, overview: 2400, journal: 1100 } } as const;
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      const lim = limits[size.width];
      const out: Record<string, number> = {};
      for (const [name, path] of [["overview", "/overview"], ["journal", "/journal"], ["report", "/report"]] as const) {
        await gotoPlan(page, `/ops/plans/${plan.id}${path}`);
        if (name === "report") await expect(page.getByTestId("report-screen")).toBeVisible();
        await page.waitForLoadState("networkidle").catch(() => undefined);
        out[name] = await height(page);
      }
      console.log(`[長さ・実データ並み] ${size.name}: 計画 ${out["overview"]}px / 日誌 ${out["journal"]}px / 作業台 ${out["report"]}px`);
      expect(out["overview"], "計画").toBeLessThanOrEqual(lim.overview);
      expect(out["journal"], "日誌").toBeLessThanOrEqual(lim.journal);
      expect(out["report"], "作業台").toBeLessThanOrEqual(lim.report);
    }
    await gotoPlan(page, `/ops/plans/${plan.id}/overview`);
    await expect(page.getByTestId("version-list-older")).toHaveCount(1);
    await gotoPlan(page, `/ops/plans/${plan.id}/journal`);
    await expect(page.getByTestId("plan-flights-older")).toHaveCount(1);
  });

  test("中-B：中止していない計画で取消を記録しても、通報がまだ必要なら「取消済み」と読ませず、主操作は「通報する」", async ({ page }) => {
    await login(page);
    const plan = await activate(await createPlan({ title: `S172 取消 ${stamp}` }));
    await recordApi(plan, "new", "FP-S172-CANCEL");
    const view = (await (await manager.get(`/api/ops/plans/${plan.id}/report`)).json()) as { effective: { id: string } };
    await recordApi(plan, "cancel", "CANCEL-S172", view.effective.id);
    await gotoPlan(page, `/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "cancelled");
    await expect(page.getByTestId("plan-report-label")).toContainText("前の通報は取消済み");
    await expect(page.getByTestId("plan-primary-action")).toHaveText("通報する");
  });

  test("中-D：版が 6 件以上の計画を中止して読み直すと、フォーカスは新しい版の行に届く(畳んだ古い版ではない)", async ({ page }) => {
    await login(page);
    const plan = await activate(await createPlan({ plannedStartAt: "2027-02-01T10:00", title: `S172 版 ${stamp}` }));
    let cur = await getPlan(plan.id);
    for (let i = 0; i < 6; i++) {
      const r = await manager.patch(`/api/ops/plans/${plan.id}`, { data: { expectedVersion: cur.version, reason: `訂正 ${i}`, durationMinutes: 31 + i } });
      expect(r.status(), await r.text()).toBe(200);
      cur = await getPlan(plan.id);
    }
    await gotoPlan(page, `/ops/plans/${plan.id}/overview`);
    await expect(page.getByTestId("version-list-older")).toHaveCount(1);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("plan-void-details").locator("summary").click();
    await page.getByLabel("取消の理由").fill("中止の試験");
    await page.getByRole("button", { name: /この計画を取り消す/ }).click();
    await expect(page.getByTestId("ops-change-notice").filter({ hasText: "取消しました" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a?.dataset.testid === "version-row" && a.parentElement?.dataset.testid === "version-list"; }), { message: "新しい版の行にフォーカス" })
      .toBe(true);
  });
});
