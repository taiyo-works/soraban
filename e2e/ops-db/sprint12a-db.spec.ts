import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// Sprint 12a の E2E-DB（契約 2・9・11・13・14・16・17・18・20 の画面・通しの部分）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1・逆ジオコーダの模擬サーバー（e2e/mock-gsi-server.mjs）を与えた next start に対して実行する。
// 計画の保存ではサーバーが判定を実行するため、市町村の特定を模擬サーバーに固定する（判定の結果が外部サービスに左右されない）。
// 画面は幅 375px で確かめる（横スクロールなし）。テスト用の初期データ（packages/db/src/ops-seed.ts）：
//   組織A の a-manager・a-pilot（操縦 一郎）・a-pilot2（操縦 二郎）・a-viewer、組織B の b-manager、よく使う地点「フューチャーテック株式会社 本社」。
// 同じ DB で何度実行しても重ならないよう、機体は実行ごとに作る。

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
const DIPS_NOT_SENT = "そらばんは DIPS に送信しません";
const OFFICIAL = "申請・通報は DIPS 2.0 などの公式の手続きで行ってください";
const DISCLAIMER = "判定は入力された情報の範囲での目安です。";

const HQ = { name: "フューチャーテック株式会社 本社", lat: 35.434238, lng: 133.380508 };
/** 夜間飛行の地点（皆生）／市町村を特定できない地点／DID と空港周辺の地点（境港市）。模擬の逆ジオコーダが決める。 */
const NIGHT_SPOT = { lat: 35.44, lng: 133.35 };
const UNVERIFIED_SPOT = { lat: 35.0, lng: 133.0 };
const DID_AIRPORT_SPOT = { lat: 35.5447, lng: 133.237953 };

let seq = 0;
const stamp = Date.now().toString(36).toUpperCase();
const uniqueMark = () => `JUS12A${stamp}${seq++}`;

const createAircraft = async (manager: APIRequestContext, extra: object = {}): Promise<{ id: string; version: number; registrationMark: string }> => {
  const registrationMark = uniqueMark();
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "計画試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, ...extra },
  });
  expect(r.status()).toBe(201);
  return { ...((await r.json()) as { id: string; version: number }), registrationMark };
};

const pilotIdOf = async (who: Who): Promise<string> => {
  const ctx = await apiAs(who);
  const me = (await (await ctx.get("/api/ops/me")).json()) as { pilotId: string };
  await ctx.dispose();
  return me.pilotId;
};

type PlanJson = {
  id: string;
  version: number;
  state: string;
  stateLabel: string;
  currentSnapshotId: string;
  judgement: { seq: number; verdictLevel: string; category: string; checkEvidenceId: string; diagnosisEvidenceId: string; engineVersion: string };
  freshness: { stale: boolean; reasons: { code: string; label: string }[] };
  report: { kind: string; label: string; reasons: string[] };
};

const planBody = (aircraftId: string, pilotId: string, extra: object = {}) => ({
  title: `E2E 計画 ${stamp}-${seq++}`,
  aircraftId,
  pilotId,
  plannedStartAt: "2027-01-10T10:00",
  durationMinutes: 30,
  purpose: "空撮",
  placeName: "試験地点",
  latitude: HQ.lat,
  longitude: HQ.lng,
  flags: [],
  ...extra,
});

const createPlan = async (ctx: APIRequestContext, body: object): Promise<PlanJson> => {
  const r = await ctx.post("/api/ops/plans", { data: body });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as PlanJson;
};

/** 地図の背景（国土地理院の淡色地図のタイル）を外部から取れない環境のエラー。運航管理の追加とは関係がない。 */
const isNotMapTileNoise = (text: string): boolean => !/cyberjapandata\.gsi\.go\.jp|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(text);

const noHorizontalScroll = async (page: Page, label: string) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: 横スクロールがある`).toBeLessThanOrEqual(clientWidth);
};

/** 画面（Suspense の内側）が描かれるのを待ってから本文を読む。 */
const bodyText = async (page: Page): Promise<string> => {
  await expect(page.locator("main").first()).toBeVisible();
  return page.locator("body").innerText();
};
const expectNoForbiddenWords = async (page: Page, label: string) => {
  const text = await bodyText(page);
  for (const w of FORBIDDEN_WORDS) expect(text, `${label}: 「${w}」が出ている`).not.toContain(w);
  expect(text, `${label}: 特許・出願の表示`).not.toMatch(/特許|出願/);
};

/**
 * 保存・読み直しの後、画面は結果の表示（ChangeNotice）へ自動でスクロールして、フォーカスを移す。
 * そのスクロールの前に押すと、押す位置がずれて押し損なうため、結果の表示にフォーカスが移ってから次の操作をする。
 */
const afterFlash = async (page: Page, text: string | RegExp) => {
  await expect(page.getByTestId("ops-change-notice").filter({ hasText: text })).toBeVisible();
  // スクロールとフォーカスの移動（結果の表示か版の一覧の新しい行）が済むのを待つ
  await page.waitForFunction(() => document.activeElement !== null && document.activeElement !== document.body);
};

/**
 * ブラウザの HTTP キャッシュを使わない（Playwright は通信の横取りを設定するとキャッシュを止める）。
 * 保存後の読み直し（window.location.reload）で、読み込み途中の同じファイルの要求が中断されたあと、次の要求が
 * Chromium のキャッシュの排他で止まり、画面遷移が終わらないことがあった（この環境で再現。サーバーは正常）。
 */
const noBrowserCache = (page: Page) => page.route("**/_next/**", (route) => route.continue());

/**
 * リンクを押して、遷移（URL の変化）まで確かめる。画面遷移の要求が、このテスト環境（Chromium・next start）で
 * ごくまれに終わらないことがあったため、一定時間 URL が変わらなければ押し直す（最後は href で開く）。
 * 押すのは本物のタップ（クリック）で、遷移の先は URL で確かめる。
 */
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


const tapSize = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box, testId).not.toBeNull();
  expect(box!.height, `${testId} の高さ`).toBeGreaterThanOrEqual(43.5);
};

const RUN_BASE = Date.UTC(2025, 0, 1) + Math.floor(Math.random() * 600) * 24 * 3600 * 1000;
let slotNo = 0;
const jst = (ms: number): string => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 16);
const slot = (minutes = 10): { takeoffAt: string; landingAt: string } => {
  const t = RUN_BASE + (slotNo++ * 5 + 1) * 3600 * 1000 + Math.floor(Math.random() * 30) * 60 * 1000;
  return { takeoffAt: jst(t), landingAt: jst(t + minutes * 60 * 1000) };
};

test.use({ viewport: { width: 375, height: 812 } });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 12a E2E-DB：飛行計画・判定スナップショット・確認・日誌との紐付け", () => {
  let manager: APIRequestContext;
  let weighted: { id: string; registrationMark: string };
  let unweighted: { id: string; registrationMark: string };
  let selfPilot = "";
  let otherPilot = "";

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    weighted = await createAircraft(manager, { maxTakeoffWeightKg: 0.9 });
    unweighted = await createAircraft(manager);
    selfPilot = await pilotIdOf(seeded("a-pilot"));
    otherPilot = await pilotIdOf(seeded("a-pilot2"));
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const login = async (page: Page, who: Who) => {
    await noBrowserCache(page);
    await signIn(page.request, who);
  };

  test("2. 偽の判定を本文に入れても、保存されるのはサーバーが実行した結果（夜間の計画は要手続き）", async () => {
    const fake = { verdict: { level: "no_procedure", unknownCount: 0 }, category: "I", flags: [], evidenceId: "ev_fake", checkEvidenceId: "ev_fake" };
    const plan = await createPlan(
      manager,
      planBody(weighted.id, selfPilot, {
        latitude: NIGHT_SPOT.lat,
        longitude: NIGHT_SPOT.lng,
        flags: ["method_night"],
        result: fake,
        verdict: fake.verdict,
        snapshot: { seq: 99 },
        evidenceId: "ev_fake",
      }),
    );
    expect(plan.judgement.seq).toBe(1);
    expect(plan.judgement.verdictLevel).toBe("needs_procedure");
    expect(plan.judgement.category).not.toBe("I");
    expect(plan.judgement.diagnosisEvidenceId).toMatch(/^ev_[0-9a-f]{16}$/);
    expect(plan.judgement.diagnosisEvidenceId).not.toBe("ev_fake");
    const snaps = (await (await manager.get(`/api/ops/plans/${plan.id}/snapshots`)).json()) as { snapshots: { seq: number; reason: string }[] };
    expect(snaps.snapshots).toHaveLength(1);
    expect(snaps.snapshots[0]).toMatchObject({ seq: 1, reason: "initial" });
  });

  test("11・16・17・20. 計画をフォームで作る → 確認を依頼 → 確認（自己確認）→ 訂正すると「前の版への確認」", async ({ page }) => {
    await login(page, seeded("a-manager"));
    await page.goto("/ops/plans/new");
    await expect(page.getByTestId("plan-form")).toBeVisible();
    // 固定の文言（判定は目安・DIPS で行う）がフォームに出る
    const formText = await bodyText(page);
    expect(formText).toContain(DISCLAIMER);
    expect(formText).toContain(DIPS_NOT_SENT);
    await noHorizontalScroll(page, "計画のフォーム");

    // よく使う地点から選ぶと名称と座標が入る
    await page.getByTestId("plan-saved-place").selectOption({ label: HQ.name });
    await expect(page.getByTestId("plan-place-name")).toHaveValue(HQ.name);
    await expect(page.getByTestId("plan-lat")).toHaveValue(String(HQ.lat));
    await expect(page.getByTestId("plan-lng")).toHaveValue(String(HQ.lng));

    const title = `E2E フォームの計画 ${stamp}`;
    await page.getByTestId("plan-title").fill(title);
    await page.getByTestId("plan-aircraft").selectOption(weighted.id);
    await page.getByTestId("plan-pilot").selectOption(selfPilot);
    await page.getByTestId("plan-start-date").fill("2027-01-11");
    await page.getByTestId("plan-start-time").fill("09:30");
    await page.getByTestId("plan-duration").fill("45");
    await page.getByTestId("plan-purpose").fill("橋梁の点検");
    await page.getByTestId("plan-flag-method_night").check();
    await expect(page.getByTestId("plan-aircraft").locator(`option[value="${weighted.id}"]`)).toContainText("最大離陸重量 0.9 kg");

    // 保存中は「判定中」と出る（応答を遅らせて確かめる）
    await page.route("**/api/ops/plans", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.getByTestId("plan-submit").click();
    await expect(page.getByTestId("plan-judging")).toContainText("判定中");
    await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
    await page.unroute("**/api/ops/plans");

    const planId = page.url().split("/").pop()!;
    await expect(page.getByTestId("plan-title-heading")).toHaveText(title);
    await afterFlash(page, "飛行計画を保存しました");
    await expect(page.getByTestId("plan-disclaimer")).toContainText(DISCLAIMER);
    // 通報の要否（夜間飛行）と固定の文言
    await expect(page.getByTestId("plan-report-label")).toHaveText("通報：要");
    await expect(page.getByTestId("plan-report-reasons")).toContainText("夜間飛行に当たるため");
    await expect(page.getByTestId("plan-dips-notice").first()).toContainText(DIPS_NOT_SENT);
    await expect(page.getByTestId("plan-dips-notice").first()).toContainText(OFFICIAL);
    await expectNoForbiddenWords(page, "計画の詳細");
    await noHorizontalScroll(page, "計画の詳細");
    // 下書き → 確認を依頼
    await expect(page.getByTestId("plan-confirmation-status")).toContainText("下書き");
    for (const id of ["plan-request-confirmation", "plan-basis-link", "plan-edit-link"]) await tapSize(page, id);
    await page.getByTestId("plan-request-confirmation").click();
    await expect(page.getByTestId("plan-confirmation-status")).toContainText("確認待ち");
    await afterFlash(page, "確認を依頼しました");
    // 確認の画面に、判定不能の件数と、出典・確認日が古い項目が出る
    await expect(page.getByTestId("plan-unknown-count")).toContainText("判定不能");
    await expect(page.getByTestId("plan-stale-sources")).toBeVisible();
    for (const id of ["plan-confirm-approve", "plan-confirm-return"]) await tapSize(page, id);
    // 差し戻しは理由が必須
    await page.getByTestId("plan-confirm-return").click();
    await expect(page.getByRole("alert").filter({ hasText: "差し戻しの理由" }).first()).toBeVisible();
    // 確認する（自分が保存した版への確認なので「自己確認」と併記される）
    await page.getByTestId("plan-confirm-approve").click();
    await expect(page.getByTestId("plan-confirmation-status")).toContainText("確認済み（自己確認）");
    await expect(page.getByTestId("plan-self-confirmation")).toHaveText("自己確認");
    await expect(page.getByTestId("plan-confirmation-row")).toHaveCount(1);
    await afterFlash(page, "確認を記録しました");

    // 確認の後に計画を訂正すると「前の版への確認（再確認が必要）」と出て、「確認済み」とは出ない
    await page.getByTestId("plan-edit-link").click();
    await page.getByTestId("plan-notes").fill("訂正：機体の変更なし");
    await page.getByTestId("plan-reason").fill("メモの追加");
    await page.getByTestId("plan-submit").click();
    await page.waitForURL(new RegExp(`/ops/plans/${planId}$`));
    await afterFlash(page, "訂正しました");
    const status = page.getByTestId("plan-confirmation-status");
    await expect(status).toContainText("前の版への確認（再確認が必要）");
    await expect(status).not.toContainText("確認済み");
    await expect(page.getByTestId("plan-self-confirmation")).toHaveCount(0);
    // メモの訂正では、判定のスナップショットは増えない
    await expect(page.getByTestId("plan-snapshot-seq")).toHaveText("1");
    // 再確認できる（確認の履歴は 2 件になる）
    await page.getByTestId("plan-confirm-approve").click();
    await expect(page.getByTestId("plan-confirmation-row")).toHaveCount(2);
    await afterFlash(page, "確認を記録しました");
    await expect(page.getByTestId("plan-confirmation-status")).toContainText("確認済み");
  });

  test("16. 通報の要否の 4 種（要・要・推奨・要確認）と、固定の文言。画面全文に禁止語がない", async ({ page }) => {
    await login(page, seeded("a-manager"));
    const cases: { name: string; body: object; label: string; reason: string }[] = [
      {
        name: "夜間飛行",
        body: planBody(weighted.id, selfPilot, { latitude: NIGHT_SPOT.lat, longitude: NIGHT_SPOT.lng, flags: ["method_night"] }),
        label: "通報：要",
        reason: "夜間飛行に当たるため",
      },
      {
        name: "DID の該当を確認できない地点",
        body: planBody(weighted.id, selfPilot, { latitude: UNVERIFIED_SPOT.lat, longitude: UNVERIFIED_SPOT.lng }),
        label: "通報：要",
        reason: "DID の該当を確認できない（判定不能）ため、要として扱う",
      },
      {
        name: "特定飛行に当たらない計画",
        body: planBody(weighted.id, selfPilot),
        label: "通報：義務ではないが推奨",
        reason: "特定飛行に当たる項目がないため",
      },
      {
        name: "重量が未登録の機体",
        body: planBody(unweighted.id, selfPilot),
        label: "通報：要確認（要として扱います）",
        reason: "機体の重量が分からないため",
      },
    ];
    for (const c of cases) {
      const plan = await createPlan(manager, c.body);
      await page.goto(`/ops/plans/${plan.id}`);
      await expect(page.getByTestId("plan-report-label"), c.name).toHaveText(c.label);
      await expect(page.getByTestId("plan-report-reasons"), c.name).toContainText(c.reason);
      const text = await bodyText(page);
      expect(text, c.name).toContain(DIPS_NOT_SENT);
      expect(text, c.name).toContain(OFFICIAL);
      await expectNoForbiddenWords(page, c.name);
      await noHorizontalScroll(page, c.name);
      // 判定の根拠の画面にも同じ文言があり、禁止語がない
      await page.goto(`/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`);
      await expect(page.getByTestId("plan-report-label"), `${c.name}（根拠）`).toHaveText(c.label);
      const basis = await bodyText(page);
      expect(basis).toContain(DIPS_NOT_SENT);
      expect(basis).toContain(OFFICIAL);
      await expectNoForbiddenWords(page, `${c.name}（根拠）`);
    }
    // 一覧にも通報の要否と状態の文字がある（色だけで区別しない）
    await page.goto("/ops/plans");
    await expect(page.getByTestId("plan-list")).toBeVisible();
    const first = page.getByTestId("plan-row").first();
    await expect(first.getByTestId("plan-state")).not.toHaveText("");
    await expect(first.getByTestId("plan-report")).toContainText("通報：");
    await expect(first.getByTestId("plan-verdict")).not.toHaveText("");
    await expectNoForbiddenWords(page, "計画の一覧");
    await noHorizontalScroll(page, "計画の一覧");
    expect(await bodyText(page)).toContain(DIPS_NOT_SENT);
  });

  test("9. 機体の最大離陸重量を変えると「判定が古い」と理由が出て、「判定をやり直す」で新しいスナップショットと版ができる", async ({ page }) => {
    await login(page, seeded("a-manager"));
    const aircraft = await createAircraft(manager, { maxTakeoffWeightKg: 0.9 });
    const plan = await createPlan(manager, planBody(aircraft.id, selfPilot));
    await page.goto(`/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-stale")).toHaveCount(0);
    await expect(page.getByTestId("plan-rejudge")).toBeVisible();

    const patch = await manager.patch(`/api/ops/aircraft/${aircraft.id}`, {
      data: { maxTakeoffWeightKg: 1.5, expectedVersion: aircraft.version, reason: "重量の訂正" },
    });
    expect(patch.status(), await patch.text()).toBe(200);

    await page.goto(`/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-stale").first()).toContainText("判定が古い");
    await expect(page.getByTestId("plan-stale-reasons")).toContainText("機体の重量を含む");
    await noHorizontalScroll(page, "判定が古い");
    await page.getByTestId("plan-rejudge").click();
    await expect(page.getByTestId("plan-snapshot-seq")).toHaveText("2");
    await expect(page.getByTestId("plan-stale")).toHaveCount(0);
    await afterFlash(page, "判定をやり直しました");

    // 古いスナップショットは残り、一覧に並ぶ。理由は手動の再判定
    await tapAndWait(page, page.getByTestId("plan-snapshots-link"), /\/snapshots$/);
    const rows = page.getByTestId("snapshot-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByTestId("snapshot-current")).toBeVisible();
    await expect(rows.first().getByTestId("snapshot-reason")).toContainText("再判定");
    await expect(rows.nth(1).getByTestId("snapshot-reason")).toContainText("作成");
    await tapAndWait(page, rows.nth(1), /\/snapshots\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("snapshot-past")).toBeVisible();
    // 計画の版が上がっている（版の履歴に再判定の版がある）
    const after = (await (await manager.get(`/api/ops/plans/${plan.id}`)).json()) as PlanJson;
    expect(after.version).toBe(plan.version + 1);
    expect(after.judgement.seq).toBe(2);
  });

  test("13・14. 計画から飛行記録を作る（形態は DID・空港の導出を含む）→ 日誌の一覧から 2 タップで判定の根拠", async ({ page }) => {
    await login(page, seeded("a-manager"));
    const aircraft = await createAircraft(manager, { maxTakeoffWeightKg: 0.9 });
    const plan = await createPlan(
      manager,
      planBody(aircraft.id, otherPilot, { latitude: DID_AIRPORT_SPOT.lat, longitude: DID_AIRPORT_SPOT.lng, placeName: "境港の試験地点", purpose: "河川の点検" }),
    );
    await page.goto(`/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-flights-empty")).toBeVisible();
    await tapSize(page, "plan-make-flight");
    await tapAndWait(page, page.getByTestId("plan-make-flight"), /\/ops\/flights\/new\?planId=/);

    const form = page.getByRole("form", { name: "飛行記録の入力" });
    await expect(page.getByTestId("flight-from-plan")).toBeVisible();
    await expect(form.getByRole("combobox", { name: "機体" })).toHaveValue(aircraft.id);
    await expect(form.getByRole("combobox", { name: "操縦者" })).toHaveValue(otherPilot);
    await expect(form.getByLabel("飛行の目的")).toHaveValue("河川の点検");
    await expect(form.getByRole("textbox", { name: "離陸場所", exact: true })).toHaveValue("境港の試験地点");
    await expect(form.getByRole("textbox", { name: "着陸場所", exact: true })).toHaveValue("境港の試験地点");
    // 特定飛行の形態：空港等周辺と DID 上空が入っている（判定が導出したもの）。夜間は入っていない
    await expect(form.getByRole("checkbox", { name: "空港等周辺" })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: "人口集中地区（DID）上空" })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: "夜間飛行" })).not.toBeChecked();
    // 離着陸の時刻は引き継がない
    await expect(form.getByLabel("離陸時刻", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("着陸時刻", { exact: true })).toHaveValue("");

    const t = slot();
    await form.getByLabel("離陸日", { exact: true }).fill(t.takeoffAt.slice(0, 10));
    await form.getByLabel("離陸時刻", { exact: true }).fill(t.takeoffAt.slice(11));
    await form.getByLabel("着陸日", { exact: true }).fill(t.landingAt.slice(0, 10));
    await form.getByLabel("着陸時刻", { exact: true }).fill(t.landingAt.slice(11));
    await form.getByRole("radio", { name: "なし" }).check();
    await form.getByRole("button", { name: /保存/ }).first().click();
    await page.waitForURL(/\/ops\/flights\/[0-9a-f-]{36}$/);

    // 保存した記録の詳細に、飛行計画と判定の根拠へのリンクがある
    await expect(page.getByTestId("flight-plan-link")).toBeVisible();
    await expect(page.getByTestId("flight-basis-link")).toBeVisible();

    // 計画の画面にその記録が並ぶ
    await page.goto(`/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-flight-row")).toHaveCount(1);

    // 日誌の一覧 → 詳細（1 タップ）→ 判定の根拠（2 タップ）。証跡 ID・エンジンの版・データセットの版と確認日・手続きデータの版が見える
    const day = t.takeoffAt.slice(0, 10);
    await page.goto(`/ops/flights?from=${day}&to=${day}`);
    await tapAndWait(
      page,
      page.getByTestId("flight-list").locator("li", { hasText: aircraft.registrationMark }).getByRole("link"),
      /\/ops\/flights\/[0-9a-f-]{36}$/,
    );
    await tapAndWait(page, page.getByTestId("flight-basis-link"), /\/snapshots\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("basis-check-evidence")).toHaveText(/^ev_[0-9a-f]{16}$/);
    await expect(page.getByTestId("basis-diagnosis-evidence")).toHaveText(/^ev_[0-9a-f]{16}$/);
    await expect(page.getByTestId("basis-engine")).toContainText("soraban-");
    await expect(page.getByTestId("basis-procedures")).toContainText("確認日");
    await expect(page.getByTestId("basis-dataset").first()).toContainText("確認日");
    await expect(page.getByTestId("basis-hash")).toHaveText(/[0-9a-f]{16,}/);
    await expect(page.getByTestId("verdict-summary")).toBeVisible();
    await noHorizontalScroll(page, "判定の根拠");
    await expectNoForbiddenWords(page, "判定の根拠");

    // 計画なしの記録は従来どおり作れる。特定飛行の形態があって計画に結びつかない記録には「判定の根拠が紐づいていません」と出る
    const t2 = slot();
    const base = { aircraftId: aircraft.id, pilotId: otherPilot, purpose: "空撮", takeoffPlace: "本社", landingPlace: "本社", safetyIssue: false, ...t2 };
    const missing = await manager.post("/api/ops/flights", { data: { ...base, specificFlightTypes: ["night"] } });
    expect(missing.status()).toBe(201);
    const missingFlight = (await missing.json()) as { id: string; judgementLink: string };
    expect(missingFlight.judgementLink).toBe("missing");
    const t3 = slot();
    const plain = await manager.post("/api/ops/flights", { data: { ...base, ...t3, specificFlightTypes: [] } });
    expect(plain.status()).toBe(201);
    const plainFlight = (await plain.json()) as { id: string; judgementLink: string };
    expect(plainFlight.judgementLink).toBe("not_required");

    const day2 = t2.takeoffAt.slice(0, 10);
    await page.goto(`/ops/flights?from=${day2}&to=${day2}`);
    await expect(page.getByTestId("flight-judgement-missing").first()).toContainText("判定の根拠が紐づいていません");
    await page.goto(`/ops/flights/${missingFlight.id}`);
    await expect(page.getByTestId("flight-judgement-missing")).toContainText("判定の根拠が紐づいていません");
    await page.goto(`/ops/flights/${plainFlight.id}`);
    await expect(page.getByTestId("flight-judgement-missing")).toHaveCount(0);
    await expect(page.getByText("計画なし（特定飛行の形態なし）")).toBeVisible();
  });

  test("17. よく使う地点：運航管理者が登録・訂正・取消でき、全役割が一覧を見られる。他の役割は 403・他の組織は 404", async ({ page }) => {
    await login(page, seeded("a-manager"));
    // 初期データの「本社」は座標 35.434238, 133.380508
    await page.goto("/ops/places");
    const seededRow = page.getByTestId("place-row").filter({ hasText: HQ.name }).first();
    await expect(seededRow).toContainText(`${HQ.lat}, ${HQ.lng}`);

    // 本社の座標で登録する（名称は実行ごとに変える：取消していない地点の中で名称は重複できない）
    const name = `${HQ.name} E2E${stamp}`;
    await page.getByTestId("place-new-link").click();
    await page.getByTestId("place-name").fill(name);
    await page.getByTestId("place-address").fill("鳥取県西伯郡日吉津村日吉津45番地3");
    await page.getByTestId("place-lat").fill(String(HQ.lat));
    await page.getByTestId("place-lng").fill(String(HQ.lng));
    await noHorizontalScroll(page, "地点の登録");
    await page.getByTestId("place-submit").click();
    await page.waitForURL(/\/ops\/places\/[0-9a-f-]{36}$/);
    const placeId = page.url().split("/").pop()!;
    await expect(page.getByTestId("place-title")).toHaveText(name);
    await expect(page.getByTestId("place-coords")).toHaveText(`${HQ.lat}, ${HQ.lng}`);

    // 訂正（版が増える）
    await page.getByTestId("place-note").fill("駐車場側の入口");
    await page.getByTestId("place-reason").fill("メモの追加");
    await page.getByTestId("place-submit").click();
    await expect(page.getByTestId("version-row")).toHaveCount(2);

    // 計画のフォームで選ぶと、名称と座標が入る
    await page.goto("/ops/plans/new");
    await page.getByTestId("plan-saved-place").selectOption({ label: name });
    await expect(page.getByTestId("plan-place-name")).toHaveValue(name);
    await expect(page.getByTestId("plan-lat")).toHaveValue(String(HQ.lat));
    await expect(page.getByTestId("plan-lng")).toHaveValue(String(HQ.lng));

    // 全役割が一覧を見られる。登録・訂正・取消は運航管理者だけ（403）。他の組織の地点は 404
    for (const key of ["a-pilot", "a-viewer"]) {
      const ctx = await apiAs(seeded(key));
      expect((await ctx.get("/api/ops/places")).status(), key).toBe(200);
      expect((await ctx.post("/api/ops/places", { data: { name: "不可", latitude: 35.1, longitude: 133.1 } })).status(), key).toBe(403);
      expect((await ctx.patch(`/api/ops/places/${placeId}`, { data: { expectedVersion: 2, reason: "x", note: "y" } })).status(), key).toBe(403);
      expect((await ctx.post(`/api/ops/places/${placeId}/void`, { data: { expectedVersion: 2, reason: "x" } })).status(), key).toBe(403);
      await ctx.dispose();
    }
    const viewerPage = await page.context().browser()!.newContext({ viewport: { width: 375, height: 812 } });
    const vp = await viewerPage.newPage();
    await noBrowserCache(vp);
    await signIn(vp.request, seeded("a-viewer"));
    await vp.goto("/ops/places");
    await expect(vp.getByTestId("place-row").filter({ hasText: HQ.name }).first()).toBeVisible();
    await expect(vp.getByTestId("place-new-link")).toHaveCount(0);
    await viewerPage.close();
    const other = await apiAs(seeded("b-manager"));
    expect((await other.get(`/api/ops/places/${placeId}`)).status()).toBe(404);
    expect((await other.get("/api/ops/places")).status()).toBe(200);
    const otherList = (await (await other.get("/api/ops/places")).json()) as { places: { id: string }[] };
    expect(otherList.places.some((p) => p.id === placeId)).toBe(false);
    await other.dispose();

    // 取消（削除ではない。版の履歴は残る）
    await page.goto(`/ops/places/${placeId}`);
    await page.getByRole("form", { name: "この地点の取消" }).getByRole("textbox").fill("E2E の後始末");
    await page.getByRole("button", { name: "この地点を取り消す" }).click();
    await expect(page.getByTestId("version-row")).toHaveCount(3);
    await page.goto("/ops/plans/new");
    await expect(page.getByTestId("plan-saved-place").locator("option", { hasText: name })).toHaveCount(0);
  });

  test("17. 現在地の座標は、「この地点を使う」で確定するまで入力欄に入らず、通信にも出ない（保存まで送らない）", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      permissions: ["geolocation"],
      geolocation: { latitude: 35.123456, longitude: 133.654321, accuracy: 20 },
    });
    const page = await ctx.newPage();
    await noBrowserCache(page);
    await signIn(page.request, seeded("a-manager"));
    const sent: string[] = [];
    page.on("request", (r) => sent.push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`));
    await page.goto("/ops/plans/new");
    await page.getByTestId("plan-locate").click();
    await expect(page.getByTestId("plan-candidate")).toContainText("35.123456, 133.654321");
    // 候補の段階：入力欄は空のまま、座標はどの通信にも出ていない
    await expect(page.getByTestId("plan-lat")).toHaveValue("");
    await expect(page.getByTestId("plan-lng")).toHaveValue("");
    expect(sent.filter((s) => s.includes("35.123456") || s.includes("133.654321"))).toEqual([]);
    await page.getByTestId("plan-use-candidate").click();
    await expect(page.getByTestId("plan-lat")).toHaveValue("35.123456");
    await expect(page.getByTestId("plan-lng")).toHaveValue("133.654321");
    // 確定した後も、計画を保存するまでは送らない
    expect(sent.filter((s) => s.includes("35.123456") || s.includes("133.654321"))).toEqual([]);

    await page.getByTestId("plan-title").fill(`E2E 現在地の計画 ${stamp}`);
    await page.getByTestId("plan-aircraft").selectOption(weighted.id);
    await page.getByTestId("plan-pilot").selectOption(selfPilot);
    await page.getByTestId("plan-start-date").fill("2027-01-12");
    await page.getByTestId("plan-start-time").fill("13:00");
    await page.getByTestId("plan-duration").fill("20");
    await page.getByTestId("plan-purpose").fill("現場確認");
    await page.getByTestId("plan-place-name").fill("現在地の試験");
    await page.getByTestId("plan-submit").click();
    await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
    const saved = sent.filter((s) => s.startsWith("POST") && s.includes("/api/ops/plans"));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain("35.123456");
    await ctx.close();
  });

  test("18. 運航管理が有効でログイン済み：`/` にリンクとボタンが出て、ボタンで入力（座標・重量・フラグ・許可・予定日）を引き継ぐ。結果は引き継がない", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    // 未ログイン：リンクもボタンもない
    await page.goto("/");
    await expect(page.getByTestId("site-ops-note")).toBeVisible();
    await page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok()).catch(() => undefined);
    await expect(page.getByTestId("verdict-level")).toBeVisible();
    await expect(page.getByTestId("home-ops-link")).toHaveCount(0);
    await expect(page.getByTestId("create-plan-from-verdict")).toHaveCount(0);

    // ログイン済み
    await login(page, seeded("a-manager"));
    await page.goto("/");
    await expect(page.getByTestId("home-ops-link")).toBeVisible();
    await tapSize(page, "home-ops-link");
    await expect(page.getByTestId("verdict-level")).toBeVisible();
    // 入力を変える：夜間飛行・機体の重さ・予定日
    await page.getByPlaceholder(/例: 900/).evaluate((el) => {
      const d = el.closest("details");
      if (d) d.open = true;
    });
    await page.getByPlaceholder(/例: 900/).fill("900");
    await page.locator("label", { hasText: "飛行予定日" }).locator('input[type="date"]').fill("2027-01-20");
    await page.getByRole("checkbox", { name: "夜間飛行", exact: true }).check();
    const button = page.getByTestId("create-plan-from-verdict");
    await expect(button).toBeVisible();
    await expect(button).toHaveText("この判定で飛行計画を作る");
    // 入力の変更がリンクに反映されるまで待つ
    await expect(button).toHaveAttribute("href", /weightG=900/);
    await expect(button).toHaveAttribute("href", /flags=[^&]*method_night/);
    await expect(button).toHaveAttribute("href", /date=2027-01-20/);
    const href = (await button.getAttribute("href"))!;
    // 判定の結果（証跡 ID・判定の段階など）は引き継がない
    expect(href).not.toMatch(/ev_|verdict|level|evidence/);
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/ops/plans/new");
    expect(url.searchParams.get("weightG")).toBe("900");
    expect(url.searchParams.get("flags")).toContain("method_night");
    expect(url.searchParams.get("date")).toBe("2027-01-20");
    expect(url.searchParams.get("lat")).toMatch(/^\d+\.\d+$/);
    const lat = url.searchParams.get("lat")!;
    const lng = url.searchParams.get("lng")!;

    await button.click();
    await page.waitForURL(/\/ops\/plans\/new\?/);
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await expect(page.getByTestId("plan-lat")).toHaveValue(lat);
    await expect(page.getByTestId("plan-lng")).toHaveValue(lng);
    await expect(page.getByTestId("plan-flag-method_night")).toBeChecked();
    await expect(page.getByTestId("plan-start-date")).toHaveValue("2027-01-20");
    await expect(page.getByTestId("plan-handoff-note")).toContainText("900 g");
    // 機体は引き継がない（利用者が選ぶ）
    await expect(page.getByTestId("plan-aircraft")).toHaveValue("");
    await noHorizontalScroll(page, "引き継いだ計画のフォーム");

    // 保存すると、サーバーが判定を実行する（機体の登録上の重量 0.9kg で判定）
    await page.getByTestId("plan-title").fill(`E2E 判定から ${stamp}`);
    await page.getByTestId("plan-aircraft").selectOption(weighted.id);
    await page.getByTestId("plan-pilot").selectOption(selfPilot);
    await page.getByTestId("plan-start-time").fill("08:00");
    await page.getByTestId("plan-duration").fill("30");
    await page.getByTestId("plan-purpose").fill("判定からの計画");
    await page.getByTestId("plan-place-name").fill("判定画面の地点");
    await page.getByTestId("plan-submit").click();
    await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("plan-snapshot-seq")).toHaveText("1");
    await expect(page.getByTestId("plan-check-evidence")).toHaveText(/^ev_[0-9a-f]{16}$/);
    await expect(page.getByTestId("plan-report-reasons")).toContainText("夜間飛行に当たるため");
    expect(errors.filter(isNotMapTileNoise), "コンソールのエラー").toEqual([]);
  });

  test("認可：閲覧者は計画を作れない／操縦者は自分の計画だけ／確認は運航管理者だけ／他の組織は 404", async ({ page, browser }) => {
    const mine = await createPlan(manager, planBody(weighted.id, selfPilot));
    const others = await createPlan(manager, planBody(weighted.id, otherPilot));
    await manager.post(`/api/ops/plans/${mine.id}/request-confirmation`, { data: {} });

    // 閲覧者
    await login(page, seeded("a-viewer"));
    await page.goto("/ops/plans");
    await expect(page.getByTestId("plan-new-link")).toHaveCount(0);
    await expect(page.getByTestId("plan-filter-pending")).toHaveCount(0);
    await page.goto("/ops/plans/new");
    await expect(page.getByRole("heading", { name: "権限がありません" })).toBeVisible();
    await page.goto(`/ops/plans/${mine.id}`);
    await expect(page.getByTestId("plan-edit-link")).toHaveCount(0);
    await expect(page.getByTestId("plan-confirm-panel")).toHaveCount(0);
    await expect(page.getByTestId("plan-make-flight")).toHaveCount(0);
    await page.goto(`/ops/plans/${mine.id}/snapshots/${mine.currentSnapshotId}`);
    await expect(page.getByTestId("basis-check-evidence")).toBeVisible();

    // 操縦者：自分の計画は訂正できるが、確認はできない。他の人の計画は訂正できない
    const pilotCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const pp = await pilotCtx.newPage();
    await noBrowserCache(pp);
    await signIn(pp.request, seeded("a-pilot"));
    await pp.goto(`/ops/plans/${mine.id}`);
    await expect(pp.getByTestId("plan-edit-link")).toBeVisible();
    await expect(pp.getByTestId("plan-confirm-panel")).toHaveCount(0);
    await pp.goto(`/ops/plans/${others.id}`);
    await expect(pp.getByTestId("plan-edit-link")).toHaveCount(0);
    await pp.goto(`/ops/plans/${others.id}/edit`);
    await expect(pp.getByRole("heading", { name: "権限がありません" })).toBeVisible();
    await pp.goto("/ops/plans/new");
    await expect(pp.getByTestId("plan-pilot")).toBeDisabled();
    await pilotCtx.close();
    const pilotApi = await apiAs(seeded("a-pilot"));
    const confirm = await pilotApi.post(`/api/ops/plans/${mine.id}/confirmations`, { data: { decision: "approved", expectedVersion: mine.version + 1 } });
    expect(confirm.status()).toBe(403);
    await pilotApi.dispose();

    // 運航管理者：確認待ちの絞り込みがある
    const mgrCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mp = await mgrCtx.newPage();
    await noBrowserCache(mp);
    await signIn(mp.request, seeded("a-manager"));
    await mp.goto("/ops/plans?view=upcoming&state=pending");
    await expect(mp.getByTestId("plan-filter-pending")).toContainText("確認待ち");
    await expect(mp.getByTestId("plan-row").filter({ hasText: "確認待ち" }).first()).toBeVisible();
    await mgrCtx.close();

    // 他の組織は 404（画面・API）
    const bCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const bp = await bCtx.newPage();
    await noBrowserCache(bp);
    await signIn(bp.request, seeded("b-manager"));
    // 画面は Suspense の内側で notFound() になるため、状態コードは 200 のまま、404 の画面になる（計画の内容は出ない）
    for (const url of [`/ops/plans/${mine.id}`, `/ops/plans/${mine.id}/snapshots/${mine.currentSnapshotId}`, `/ops/plans/${mine.id}/snapshots`]) {
      await bp.goto(url);
      await expect(bp.getByText(/404|could not be found/).first()).toBeVisible();
      await expect(bp.getByTestId("plan-title-heading")).toHaveCount(0);
      await expect(bp.getByTestId("basis-check-evidence")).toHaveCount(0);
    }
    expect((await bp.request.get(`/api/ops/plans/${mine.id}`)).status()).toBe(404);
    await bCtx.close();
  });

  test("20. 375px で横スクロールがなく、状態・通報の要否・判定の結論に文字があり、特許・出願の表示がない", async ({ page }) => {
    await login(page, seeded("a-manager"));
    const plan = await createPlan(manager, planBody(weighted.id, selfPilot, { latitude: NIGHT_SPOT.lat, longitude: NIGHT_SPOT.lng, flags: ["method_night"] }));
    const pages: [string, string][] = [
      ["/ops", "運航管理のトップ"],
      ["/ops/plans", "計画の一覧"],
      ["/ops/plans/new", "計画のフォーム"],
      [`/ops/plans/${plan.id}`, "計画の詳細"],
      [`/ops/plans/${plan.id}/edit`, "計画の訂正"],
      [`/ops/plans/${plan.id}/snapshots`, "判定の履歴"],
      [`/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`, "判定の根拠"],
      ["/ops/places", "地点の一覧"],
      ["/ops/places/new", "地点の登録"],
      ["/ops/flights/new?planId=" + plan.id, "計画からの飛行記録"],
    ];
    for (const [url, label] of pages) {
      await page.goto(url);
      await expect(page.locator("main").first()).toBeVisible();
      await noHorizontalScroll(page, label);
      await expectNoForbiddenWords(page, label);
    }
    await page.goto(`/ops/plans/${plan.id}`);
    // 状態・通報・結論は文字で示す
    await expect(page.getByTestId("plan-confirmation-status").getByTestId("plan-state")).toContainText("下書き");
    await expect(page.getByTestId("plan-report-label")).toContainText("通報：要");
    await expect(page.getByTestId("verdict-level")).not.toHaveText("");
    await page.goto("/ops/plans/new");
    expect(await bodyText(page)).toContain(DISCLAIMER);
  });
});
