import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { gotoPlanOpen, planTab, planTabs } from "./plan-screen";

// Sprint 17-1 の E2E-DB（docs/sprints/sprint-17.md §10 の S-1〜S-3・S-5・S-6・J-1〜J-4 の構造の部分）。
// 画面の分離：通報の主画面（/ops/plans/[id]）・通報の作業台（/report）・計画（/overview）・日誌（/journal）・判定（/judgement）。
// 長さ（L）・通報の主画面の作り込み（plan-primary-action ほか）は 17-2。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する。
// サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定している。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
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

const afterFlash = async (page: Page, text: string | RegExp) => {
  await expect(page.getByTestId("ops-change-notice").filter({ hasText: text })).toBeVisible();
  await page.waitForFunction(() => document.activeElement !== null && document.activeElement !== document.body);
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

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 17-1 E2E-DB：計画の画面の分離", () => {
  let manager: APIRequestContext;
  let aircraftId = "";
  let pilotId = "";

  const createPlan = async (extra: object = {}): Promise<PlanJson> => {
    const r = await manager.post("/api/ops/plans", {
      data: {
        title: `S17 ${stamp}-${seq++}`,
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

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    const mark = `JUS17${stamp}`;
    const r = await manager.post("/api/ops/aircraft", {
      data: { registrationMark: mark, modelName: "S17 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    expect(r.status(), await r.text()).toBe(201);
    aircraftId = ((await r.json()) as { id: string }).id;
    const me = await apiAs(seeded("a-pilot"));
    pilotId = ((await (await me.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await me.dispose();
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const login = async (page: Page) => {
    await noBrowserCache(page);
    await signIn(page.request, seeded("a-manager"));
  };

  test("S-1・S-2・S-3・J-1・J-4：5 つの画面にタブ（現在に aria-current）。現場には出ない。判定の本体は /judgement だけ。移動先に移したものが揃う", async ({ page }) => {
    await login(page);
    const plan = await activate(await createPlan());
    const base = `/ops/plans/${plan.id}`;
    const screens: [string, "overview" | "report" | "journal" | null][] = [
      [base, "report"],
      [`${base}/report`, "report"],
      [`${base}/overview`, "overview"],
      [`${base}/journal`, "journal"],
      [`${base}/judgement`, null],
    ];
    for (const [url, current] of screens) {
      await page.goto(url);
      const tabs = planTabs(page);
      await expect(tabs, url).toBeVisible();
      await expect(tabs).toHaveAttribute("aria-label", "計画の画面");
      await expect(tabs.locator('[aria-current="page"]'), url).toHaveCount(current ? 1 : 0);
      if (current) await expect(planTab(page, current), url).toHaveAttribute("aria-current", "page");
      for (const key of ["overview", "report", "field", "journal"]) {
        const box = (await planTab(page, key).boundingBox())!;
        expect(box.height, `${url} ${key}`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${url} ${key}`).toBeGreaterThanOrEqual(80);
      }
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw, `${url}: 横スクロール`).toBeLessThanOrEqual(cw);
      if (url !== `${base}/report`) await expect(page.getByTestId("plan-title-heading"), url).toBeVisible();
    }
    await page.goto(`${base}/field`);
    await expect(page.getByTestId("plan-tabs")).toHaveCount(0);

    // S-2：判定の本体は /judgement にだけある
    const judgeIds = ["plan-judgement", "plan-snapshot-seq", "plan-judged-at", "plan-check-evidence", "plan-permit-list", "plan-permit-applied-note", "plan-rejudge", "plan-basis-link", "plan-snapshots-link", "verdict-level"];
    for (const url of [base, `${base}/report`]) {
      await page.goto(url);
      await expect(page.locator("main").first()).toBeVisible();
      for (const id of judgeIds) await expect(page.getByTestId(id), `${url} ${id}`).toHaveCount(0);
    }
    await page.goto(`${base}/judgement`);
    for (const id of ["plan-judgement", "plan-snapshot-seq", "plan-judged-at", "plan-check-evidence", "plan-diagnosis-evidence", "plan-basis-link", "plan-snapshots-link", "verdict-level", "plan-disclaimer"]) {
      await expect(page.getByTestId(id), id).toHaveCount(1);
    }
    await expect(page.getByTestId("plan-rejudge")).toHaveCount(1);
    await expect(page.getByTestId("plan-permit-list").or(page.getByTestId("plan-permit-empty"))).toHaveCount(1);

    // S-3：通報の主画面には確認の一覧・版の一覧・概要・飛行記録・手続きの記録が無く、移動先にある
    const away = ["plan-confirmation-status", "plan-confirm-facts", "version-list", "plan-overview", "plan-flights-empty", "incident-linked", "procedure-dips_permit", "plan-edit-link", "plan-request-confirmation"];
    await page.goto(base);
    await expect(page.getByTestId("plan-report-box")).toBeVisible();
    for (const id of away) await expect(page.getByTestId(id), `主画面 ${id}`).toHaveCount(0);
    await expect(page.getByTestId("plan-confirmations")).toHaveCount(0);
    await page.goto(`${base}/overview`);
    for (const id of ["plan-overview", "plan-start", "plan-pilot-name", "plan-permit-numbers-text", "plan-edit-link", "plan-confirmation-status", "plan-confirm-facts", "plan-unknown-count", "plan-stale-sources", "version-list", "plan-procedures-details"]) {
      await expect(page.getByTestId(id), `計画 ${id}`).toHaveCount(1);
    }
    await expect(page.getByTestId("plan-confirmation-status").getByTestId("plan-state")).toHaveCount(1);
    // Sprint 18-2：この計画（夜間飛行。飛行禁止法の手続きなし）は、許可・承認の記録を受け付けないため、記録の対象が無い旨の文が出る
    // （以前は plan-procedures の中に dips_permit の記録のフォームが出ていた）。手続きの記録の節（plan-procedures-details）は残る
    await expect(page.getByTestId("procedure-none")).toHaveCount(1);
    await page.goto(`${base}/journal`);
    await expect(page.getByTestId("plan-flights-empty")).toBeVisible();
    await expect(page.getByTestId("incident-linked")).toBeVisible();
    await expect(page.getByTestId("plan-make-flight")).toBeVisible();

    // J-1（暫定）：判定の入口が主画面にあり、/judgement へ移る。J-4：禁止語が無い
    await page.goto(base);
    await expect(page.getByTestId("plan-judge-line")).toBeVisible();
    await expect(page.getByTestId("plan-field-link")).toHaveAttribute("href", `${base}/field`);
    for (const url of [base, `${base}/report`]) {
      await page.goto(url);
      const text = await page.locator("main").first().innerText();
      for (const w of FORBIDDEN) expect(text, `${url}: 「${w}」`).not.toContain(w);
      expect(text, `${url}: OK`).not.toMatch(/\bOK\b/);
    }
    // Sprint 18-1（契約 1-3 の誤りの訂正）：責任の注記 verdict-responsibility は公開の `/` だけに出る。運航管理の判定の画面には元から出ない。
    // 旧い注記の文「入力項目の下書きまでを手伝います」は、主画面・/report・/judgement のどこにも無い（/report には別の意味の「下書き」が元からあるので、文で検査する）。
    for (const url of [base, `${base}/report`, `${base}/judgement`]) {
      await page.goto(url);
      const text = await page.locator("main").first().innerText();
      expect(text, `${url}: 入力項目の下書き`).not.toContain("入力項目の下書き");
      expect(text, `${url}: 手伝います`).not.toContain("手伝います");
      await expect(page.getByTestId("verdict-responsibility"), url).toHaveCount(0);
    }
    await page.goto(base);
    await tapAndWait(page, page.getByTestId("plan-judge-link"), /\/judgement$/);
    // 判定からも戻れる（戻る＝通報の状況）
    await expect(page.getByRole("link", { name: /通報の状況/ })).toHaveAttribute("href", base);
  });

  test("S-6：旧いアンカー 8 つ（#sec-verdict ほか）で通報の主画面を開くと、新しい場所へ移り、その節までスクロールされる（ビューポート内）", async ({ page }) => {
    await login(page);
    const plan = await activate(await createPlan());
    const draft = await createPlan();
    const moves: [string, string, string][] = [
      ["#sec-verdict", "judgement", plan.id],
      ["#permits", "judgement", plan.id],
      ["#rejudge", "judgement", plan.id],
      ["#sec-confirm", "overview", plan.id],
      ["#request-confirmation", "overview", draft.id],
      ["#confirm", "overview", plan.id],
      ["#procedures", "overview", plan.id],
    ];
    for (const [hash, screen, id] of moves) {
      const base = `/ops/plans/${id}`;
      await page.goto(`${base}${hash}`);
      await page.waitForURL((u) => u.pathname === `${base}/${screen}`, { timeout: 15_000 });
      expect(new URL(page.url()).hash, hash).toBe(hash);
      await expectInViewport(page, hash.slice(1), hash);
    }
    // #sec-report は通報の主画面そのもの（移さない）
    const base = `/ops/plans/${plan.id}`;
    await page.goto(`${base}#sec-report`);
    await expect(page.getByTestId("plan-report-box")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(new URL(page.url()).pathname).toBe(base);
    await expectInViewport(page, "sec-report", "#sec-report");
  });

  test("S-5・次にやることの行き先：確認・再判定・手続きは新しい画面へ。保存直後と一覧の行は通報の主画面", async ({ page }) => {
    await login(page);
    const draft = await getPlan((await createPlan()).id);
    const base = `/ops/plans/${draft.id}`;
    expect(draft.nextActions.find((a) => a.id === "request_confirmation")?.href).toBe(`${base}/overview#request-confirmation`);
    const pending = await activate(draft);
    expect(pending.nextActions.find((a) => a.id === "confirm")?.href).toBe(`${base}/overview#confirm`);
    // Sprint 18-2：apply_permit は出ない。許可・承認の手続きが残る計画には register_permit（/ops/permits/new）が出る。
    // 手続きの記録への移動は notify_police（美保基地の周辺の計画。飛行禁止法の同意・通報）で検査する
    expect(pending.nextActions.find((a) => a.id === "apply_permit")).toBeUndefined();
    expect(pending.nextActions.find((a) => a.id === "register_permit")?.href).toBe("/ops/permits/new");
    const miho = await activate(await createPlan({ latitude: 35.4936, longitude: 133.2361, flags: [] }));
    expect(miho.nextActions.find((a) => a.id === "notify_police")?.href).toBe(`/ops/plans/${miho.id}/overview#procedures`);
    // 計画の一覧の行 → 通報の主画面
    await page.goto("/ops/plans");
    await expect(page.getByTestId("plan-row").first()).toBeVisible();
    expect(await page.locator(`[data-testid="plan-row"][href="${base}"]`).count()).toBe(1);
    // 主画面の「次にやること」→ 計画（確認）の画面
    await gotoPlanOpen(page, base);
    const confirmLink = page.locator('[data-testid="next-action"][data-action-id="confirm"]').getByTestId("next-action-link");
    await tapAndWait(page, confirmLink, /\/overview#confirm$/);
    await expect(page.getByTestId("plan-confirm-panel")).toBeVisible();
    await expectInViewport(page, "confirm", "次にやること（確認）");
    // 次にやること（手続き）→ /overview#procedures もビューポート内
    await gotoPlanOpen(page, `/ops/plans/${miho.id}`);
    await tapAndWait(page, page.locator('[data-testid="next-action"][data-action-id="notify_police"]').getByTestId("next-action-link"), /\/overview#procedures$/);
    await expectInViewport(page, "procedures", "次にやること（手続き）");
    // 許可・承認を登録する → 登録の新規入力へ
    await gotoPlanOpen(page, base);
    await tapAndWait(page, page.locator('[data-testid="next-action"][data-action-id="register_permit"]').getByTestId("next-action-link"), /\/ops\/permits\/new$/);
  });

  test("J-2（17-1 の範囲）：判定の画面を一度も開かずに、確認の依頼 → 確認 → 通報の記録（新規）→ 変更 → 取消が、主画面・/report・/overview だけで完了する", async ({ page }) => {
    await login(page);
    const visited: string[] = [];
    page.on("request", (req) => {
      if (req.isNavigationRequest()) visited.push(new URL(req.url()).pathname);
    });
    const plan = await createPlan({ plannedStartAt: "2027-01-10T10:00" });
    const base = `/ops/plans/${plan.id}`;
    // 下書き → 主画面の次にやること → 確認の依頼（/overview）
    await gotoPlanOpen(page, base);
    await tapAndWait(page, page.locator('[data-testid="next-action"][data-action-id="request_confirmation"]').getByTestId("next-action-link"), /\/overview#request-confirmation$/);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("plan-request-confirmation").click();
    await expect(page.getByTestId("plan-confirmation-status")).toContainText("確認待ち");
    await afterFlash(page, "確認を依頼しました");
    // 確認（自己確認）
    await page.getByTestId("plan-confirm-approve").click();
    await expect(page.getByTestId("plan-confirmation-status")).toContainText("確認済み");
    // 通報の記録（新規）：主画面の次にやること → /report
    await gotoPlanOpen(page, base);
    await tapAndWait(page, page.locator('[data-testid="next-action"][data-action-id="report"]').getByTestId("next-action-link"), /\/report$/);
    await expect(page.getByTestId("report-screen")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const record = async (time: string, number: string) => {
      await page.getByTestId("record-reported-at-date").fill("2027-01-05");
      await page.getByTestId("record-reported-at-time").fill(time);
      await page.getByTestId("record-dips-number").fill(number);
      await page.getByTestId("record-confirm-done").check();
      await page.getByTestId("record-confirm-latest").check();
      await page.getByTestId("record-submit").click();
    };
    await record("11:00", "FP-S17-0001");
    await afterFlash(page, "通報の結果を記録しました");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "reported");
    // 計画を訂正（予定を変える）→ 変更の通報
    const cur = await getPlan(plan.id);
    const patched = await manager.patch(`/api/ops/plans/${plan.id}`, { data: { expectedVersion: cur.version, reason: "時刻の変更", plannedStartAt: "2027-01-10T13:00", durationMinutes: 45 } });
    expect(patched.status(), await patched.text()).toBe(200);
    await gotoPlanOpen(page, base);
    await tapAndWait(page, page.locator('[data-testid="next-action"][data-action-id="change_report"]').getByTestId("next-action-link"), /\/report\?kind=change/);
    await expect(page.getByTestId("report-screen")).toHaveAttribute("data-kind", "change");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await record("11:40", "FP-S17-0002");
    await afterFlash(page, "通報の結果を記録しました");
    // 中止 → 取消の記録
    const v = await getPlan(plan.id);
    expect((await manager.post(`/api/ops/plans/${plan.id}/void`, { data: { expectedVersion: v.version, reason: "中止" } })).status()).toBe(200);
    await gotoPlanOpen(page, base);
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "cancel_needed");
    await tapAndWait(page, page.locator('[data-testid="next-action"][data-action-id="cancel_report"]').getByTestId("next-action-link"), /\/report\?kind=cancel/);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await record("11:50", "CANCEL-S17");
    await afterFlash(page, "取消の結果を記録しました");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "cancelled");
    expect(visited.filter((p) => /\/judgement|\/snapshots/.test(p)), "判定の画面を開いていない").toEqual([]);
  });

  test("J-3：判定が古い計画でも、通報の記録は止まらない（警告の表示だけ）。判定の行は主画面に残る", async ({ page }) => {
    await login(page);
    const mark = `JUS17B${stamp}`;
    const ar = await manager.post("/api/ops/aircraft", {
      data: { registrationMark: mark, modelName: "S17 古い判定", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    const aircraft = (await ar.json()) as { id: string; version: number };
    const plan = await activate(await createPlan({ aircraftId: aircraft.id }));
    const patch = await manager.patch(`/api/ops/aircraft/${aircraft.id}`, { data: { maxTakeoffWeightKg: 1.5, expectedVersion: aircraft.version, reason: "重量の訂正" } });
    expect(patch.status(), await patch.text()).toBe(200);
    await gotoPlanOpen(page, `/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-stale").first()).toContainText("判定が古い");
    await expect(page.getByTestId("plan-judge-line")).toBeVisible();
    await expect(page.getByTestId("plan-report-label")).toContainText("通報：");
    // 再判定の次にやることは /judgement#rejudge へ
    const rejudge = page.locator('[data-testid="next-action"][data-action-id="rejudge"]').getByTestId("next-action-link");
    await tapAndWait(page, rejudge, /\/judgement#rejudge$/);
    await expect(page.getByTestId("plan-rejudge")).toBeVisible();
    await expectInViewport(page, "rejudge", "次にやること（再判定）");
    await page.goto(`/ops/plans/${plan.id}/report`);
    await expect(page.getByTestId("report-record-form")).toBeVisible();
    await expect(page.getByTestId("record-submit")).toBeEnabled();
  });

  test("R-1：壊れた % 表記の hash（#%zz・#%E0%A4%A）でも計画の画面が出る。#a%20b と # も正常", async ({ page }) => {
    await login(page);
    const plan = await activate(await createPlan());
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const sub of ["", "/overview", "/judgement", "/journal"]) {
      for (const hash of ["#%zz", "#%E0%A4%A", "#a%20b", "#"]) {
        await gotoPlanOpen(page, `/ops/plans/${plan.id}${sub}${hash}`);
        await expect(page.getByTestId("plan-title-heading"), `${sub}${hash}`).toBeVisible();
        await expect(page.getByText("This page couldn't load")).toHaveCount(0);
      }
    }
    expect(errors).toEqual([]);
  });
});
