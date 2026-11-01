import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { gotoPlanOpen, onAllPlanScreens, openReportFolds } from "./plan-screen";

// Sprint 12b の E2E-DB（契約 1・4・5・13・16・17・18 の画面・通しの部分）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1・逆ジオコーダの模擬サーバーを与えた next start に対して実行する。
//   - 手動（既定。DIPS_REPORT_ADAPTER 未設定）のサーバー：E2E_OPS_PORT（既定 3300）
//   - 模擬アダプター（DIPS_REPORT_ADAPTER=mock）のサーバー：E2E_OPS_MOCK_ADAPTER_PORT（既定 3302）。同じ DB。
// サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定している（期限の段階は、飛行予定日時でつくる）。
// 通報は常にローカル（手動の記録／模擬の結果）。DIPS へは何も送らない。画面は幅 375px で確かめる（横スクロールなし）。
// テスト用の初期データ：組織A の a-manager・a-pilot（操縦 一郎。技能証明書番号 TEST-11112222）・a-pilot2・a-viewer、組織B の b-manager。
// 同じ DB で何度実行しても重ならないよう、機体は実行ごとに作る。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const MOCK_BASE = `http://127.0.0.1:${process.env.E2E_OPS_MOCK_ADAPTER_PORT ?? 3302}`;

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });

const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", {
    data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId },
  });
  expect(r.status()).toBe(200);
};
const apiAs = async (who: Who | null, base = BASE): Promise<APIRequestContext> => {
  const ctx = await pwRequest.newContext({ baseURL: base });
  if (who) await signIn(ctx, who);
  return ctx;
};

const FORBIDDEN_WORDS = ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて"];
const NOT_SENT = "そらばんは DIPS に送信しません";
const NOT_REPORTED_UNTIL_RECORD = "記録するまで『通報済み』にはなりません";
const OFFICIAL = "許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 で行います";
const REPORTED_LABEL = "DIPS で通報済み（利用者の申告・手動記録）";

/** 夜間飛行の地点（皆生）／判定不能が残る運営拠点／判定不能が無く特定飛行に当たらない地点（鳥取市の工業専用地域内）／美保基地（小型無人機等飛行禁止法）。 */
const NIGHT_SPOT = { lat: 35.44, lng: 133.35 };
const HQ = { lat: 35.434238, lng: 133.380508 };
const CLEAR_SPOT = { lat: 35.474926, lng: 134.222963 };
const MIHO_SPOT = { lat: 35.4936, lng: 133.2361 };

let seq = 0;
const stamp = Date.now().toString(36).toUpperCase();
const uniqueMark = () => `JUS12B${stamp}${seq++}`;

const createAircraft = async (manager: APIRequestContext, extra: object = {}): Promise<{ id: string; version: number; registrationMark: string }> => {
  const registrationMark = uniqueMark();
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "通報試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9, ...extra },
  });
  expect(r.status(), await r.text()).toBe(201);
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
  title: string;
  version: number;
  state: string;
  currentSnapshotId: string;
  judgement: { seq: number; checkEvidenceId: string; diagnosisEvidenceId: string; checkedAt: string };
  report: { kind: string; label: string; status: { code: string }; deadline: { state: string } };
  nextActions: { id: string; tier: number; label: string }[];
};

const planBody = (aircraftId: string, pilotId: string, extra: object = {}) => ({
  title: `通報試験 ${stamp}-${seq++}`,
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
});

const createPlan = async (ctx: APIRequestContext, body: object): Promise<PlanJson> => {
  const r = await ctx.post("/api/ops/plans", { data: body });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as PlanJson;
};

/** 確認を依頼して active にする（通報の記録は、確認を依頼した計画にだけできる）。 */
const activate = async (ctx: APIRequestContext, plan: PlanJson): Promise<PlanJson> => {
  const r = await ctx.post(`/api/ops/plans/${plan.id}/request-confirmation`, { data: { expectedVersion: plan.version } });
  expect(r.status(), await r.text()).toBe(200);
  return getPlan(ctx, plan.id);
};

const getPlan = async (ctx: APIRequestContext, id: string): Promise<PlanJson> => {
  const r = await ctx.get(`/api/ops/plans/${id}`);
  expect(r.status()).toBe(200);
  return (await r.json()) as PlanJson;
};

type ReportJson = {
  id: string;
  kind: string;
  channel: string;
  status: string;
  version: number;
  planVersion: number;
  snapshotId: string;
  fingerprint: string;
  mapRevision: number;
  idempotencyKey: string;
  checkEvidenceId: string;
  diagnosisEvidenceId: string;
  dipsNumber: string | null;
  content: Record<string, unknown>;
  isEffective: boolean;
};
type ViewJson = {
  reports: ReportJson[];
  audit: { operation: string; result: string }[];
  effective: ReportJson | null;
  status: { code: string };
};
const getView = async (ctx: APIRequestContext, planId: string): Promise<ViewJson> => {
  const r = await ctx.get(`/api/ops/plans/${planId}/report`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as ViewJson;
};

const noHorizontalScroll = async (page: Page, label: string) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: 横スクロールがある`).toBeLessThanOrEqual(clientWidth);
};

const bodyText = async (page: Page): Promise<string> => {
  await expect(page.locator("main").first()).toBeVisible();
  return page.locator("body").innerText();
};
const expectNoForbiddenWords = async (page: Page, label: string) => {
  const text = await bodyText(page);
  for (const w of FORBIDDEN_WORDS) expect(text, `${label}: 「${w}」が出ている`).not.toContain(w);
  expect(text, `${label}: 特許・出願の表示`).not.toMatch(/特許|出願/);
  expect(text, `${label}: 罰則の金額`).not.toMatch(/\d+\s*万?円以下/);
};

/** 保存・読み直しの後、結果の表示（ChangeNotice）が出てフォーカスが移るのを待つ（12a と同じ作法）。 */
const afterFlash = async (page: Page, text: string | RegExp) => {
  await expect(page.getByTestId("ops-change-notice").filter({ hasText: text })).toBeVisible();
  await page.waitForFunction(() => document.activeElement !== null && document.activeElement !== document.body);
};

const noBrowserCache = (page: Page) => page.route("**/_next/**", (route) => route.continue());

/**
 * リンクを押して、遷移（URL の変化）まで確かめる（12a の tapAndWait と同じ作法）。描画直後のクリックが遷移しないことがあるため、
 * 一定時間 URL が変わらなければ押し直す（最後は href で開く）。応答の待ち受けは作らず、URL と画面の結果で確かめる。
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

/** 通報の画面を開き、描画と水和が済むのを待つ。 */
const openReport = async (page: Page, planId: string, query = "", opts: { folds?: boolean } = {}) => {
  await page.goto(`/ops/plans/${planId}/report${query}`);
  await expect(page.getByTestId("report-screen")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  if (opts.folds !== false) await openReportFolds(page); // Sprint 17-2：状況の詳細・履歴・監査は折りたたんである（既定の見え方を試験する検査は folds:false）
};

const fieldsData = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "packages", "dips", "data", "report-fields.json"), "utf8")) as {
  revision: number;
  groups: { id: string; label: string; order: number }[];
  fields: { key: string; order: number; group: string; source: string; screenStatus: string }[];
};
const displayKeysInOrder = (): string[] =>
  [...fieldsData.fields].filter((f) => f.source !== "api_only").sort((a, b) => a.order - b.order).map((f) => f.key);

const fillManual = async (page: Page, prefix: string, v: { date: string; time: string; number?: string; unavailable?: boolean; memo?: string }) => {
  await page.getByTestId(`${prefix}-reported-at-date`).fill(v.date);
  await page.getByTestId(`${prefix}-reported-at-time`).fill(v.time);
  if (v.unavailable) await page.getByTestId(`${prefix}-number-unavailable`).check();
  else if (v.number !== undefined) await page.getByTestId(`${prefix}-dips-number`).fill(v.number);
  if (v.memo !== undefined) await page.getByTestId(`${prefix}-memo`).fill(v.memo);
};

test.use({ viewport: { width: 375, height: 812 } });
test.describe.configure({ mode: "serial" });

// ======================================================================
// 手動アダプター（既定）
// ======================================================================
test.describe("Sprint 12b E2E-DB（手動）：通報内容のコピー・結果の記録・変更・取消・次にやること・手続きの記録", () => {
  let manager: APIRequestContext;
  let aircraft: { id: string; version: number; registrationMark: string };
  let selfPilot = "";
  let otherPilot = "";

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    aircraft = await createAircraft(manager);
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

  test("1. 判定不能が残る計画は「通報：要確認（要として扱います）」、判定不能が無く特定飛行に当たらない計画は「推奨」のまま。「次の版で追加します」が残らない", async ({ page }) => {
    await login(page, seeded("a-manager"));
    const confirmPlan = await createPlan(manager, planBody(aircraft.id, selfPilot, { latitude: HQ.lat, longitude: HQ.lng, flags: [], radiusM: null }));
    const recommended = await createPlan(manager, planBody(aircraft.id, selfPilot, { latitude: CLEAR_SPOT.lat, longitude: CLEAR_SPOT.lng, flags: [], title: `通報試験 推奨 ${stamp}` }));
    expect(confirmPlan.report.kind).toBe("confirm");
    expect(recommended.report.kind).toBe("recommended");

    await gotoPlanOpen(page, `/ops/plans/${confirmPlan.id}`);
    await expect(page.getByTestId("plan-report-label")).toHaveText("通報：要確認（要として扱います）");
    await expect(page.getByTestId("plan-report-reasons")).toContainText("判定不能");
    expect(await bodyText(page)).not.toContain("次の版で追加します");
    await gotoPlanOpen(page, `/ops/plans/${recommended.id}`);
    await expect(page.getByTestId("plan-report-label")).toHaveText("通報：義務ではないが推奨");
    expect(await bodyText(page)).not.toContain("次の版で追加します");
    await expectNoForbiddenWords(page, "推奨の計画");

    // 一覧と詳細で同じ結果
    await page.goto("/ops/plans?view=upcoming");
    const rows = page.getByTestId("plan-row").filter({ hasText: recommended.title });
    await expect(rows.getByTestId("plan-report")).toHaveAttribute("data-kind", "recommended");
  });

  test("4・5・13. 通報内容を DIPS の入力順に並べてコピーし、記録するまで「通報済み」と出ず、二つの確認と番号が揃うと記録される。変更・取消まで", async ({ page }) => {
    await login(page, seeded("a-manager"));
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const draft = await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `通報 通し ${stamp}` }));
    const plan = await activate(manager, draft);
    const evidence = plan.judgement;

    // 記録が無いうちは、どの応答にも「通報済み」の状況が出ない
    const noRecordJson = JSON.stringify(await getPlan(manager, plan.id)) + JSON.stringify(await getView(manager, plan.id));
    expect(noRecordJson).not.toContain("DIPS で通報済み");
    expect(noRecordJson).not.toContain(REPORTED_LABEL);

    await openReport(page, plan.id);
    await noHorizontalScroll(page, "通報の画面");
    // 固定の文言
    const notice = page.getByTestId("report-notice");
    await expect(notice).toContainText(NOT_SENT);
    await expect(notice).toContainText(NOT_REPORTED_UNTIL_RECORD);
    await expect(notice).toContainText(OFFICIAL);
    await expect(page.getByTestId("report-adapter")).toHaveAttribute("data-adapter", "manual");
    await expect(page.getByTestId("report-adapter")).toContainText("手動（利用者の申告）");
    // 状況は「記録なし」
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "no_record");
    await expect(page.getByTestId("plan-report-status-label")).toHaveText("通報の記録がありません");
    expect(await page.getByTestId("plan-report-status").innerText()).not.toContain("通報済み");
    await expectNoForbiddenWords(page, "通報の画面");

    // 対応表の版・確認日と「※要確認」（データから出る）
    await expect(page.getByTestId("report-map-revision")).toHaveText(String(fieldsData.revision));
    await expect(page.getByTestId("report-map-verified")).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    for (const g of fieldsData.groups) {
      const needs = fieldsData.fields.some((f) => f.group === g.id && f.source !== "api_only" && f.screenStatus === "unconfirmed");
      const group = page.getByTestId(`report-group-${g.id}`);
      if ((await group.count()) === 0) continue;
      await expect(group).toHaveAttribute("data-needs-confirmation", needs ? "1" : "0");
      if (needs) await expect(page.getByTestId(`report-group-mark-${g.id}`)).toHaveText("※要確認");
    }

    // 項目が対応表の順に並ぶ（まとまりごと）
    const shownKeys = await page.locator('[data-testid^="report-item-"][data-status]').evaluateAll((els) =>
      els.map((e) => (e.getAttribute("data-testid") ?? "").replace("report-item-", "")),
    );
    const expected = displayKeysInOrder();
    expect(shownKeys).toEqual(expected.filter((k) => shownKeys.includes(k)));
    expect(shownKeys.length).toBe(expected.length);

    // そらばんが持たない項目の案内、未入力の必須項目の件数
    await expect(page.getByTestId("report-item-value-insurance_company")).toContainText("そらばんは保持しません");
    await expect(page.getByTestId("report-item-insurance_company").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("report-missing-count")).toContainText("未入力の必須項目");
    const missingBefore = Number(await page.getByTestId("report-missing-count").getAttribute("data-count"));
    expect(missingBefore).toBeGreaterThan(0);

    // 経路：座標と「DIPS の地図で描く」の案内。コピーのボタンは無い
    await expect(page.getByTestId("report-route-guide")).toContainText("DIPS の地図で描いてください");
    await expect(page.getByTestId("report-item-value-route")).toContainText(`経度 ${NIGHT_SPOT.lng}`);
    await expect(page.getByTestId("report-item-value-route")).toContainText("半径 200 m");
    await expect(page.getByTestId("report-copy-route")).toHaveCount(0);

    // 通報の画面の入力が、項目に反映される
    await page.getByTestId("report-input-flightSpeed").fill("40");
    await expect(page.getByTestId("report-item-value-speed")).toHaveText(/40/);
    await page.getByTestId("report-input-assistantsNumber").fill("1");
    await expect(page.getByTestId("report-item-value-assistants")).toHaveText(/1/);

    // コピー：クリップボードに値が入る
    const nameValue = (await page.getByTestId("report-item-value-name").innerText()).trim();
    await page.getByTestId("report-copy-name").click();
    await expect(page.getByTestId("report-copied-name")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(nameValue);
    await page.getByTestId("report-copy-speed").click();
    await expect(page.getByTestId("report-copied-speed")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("40");
    // 運航管理者には技能証明書番号の全桁が出て、コピーできる
    await expect(page.getByTestId("report-item-value-skill_number")).toHaveText("TEST-11112222");
    await page.getByTestId("report-copy-skill_number").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("TEST-11112222");
    // コピーの監査（誰がいつどの項目を。値は残さない）
    await expect
      .poll(async () => (await getView(manager, plan.id)).audit.filter((a) => a.operation === "copy").length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);

    // 記録：二つの確認が無いと記録できない（エラーが出て、状況は「記録なし」のまま）
    await fillManual(page, "record", { date: "2027-01-05", time: "11:00", number: "FP-E2E-0001" });
    await page.getByTestId("record-submit").click();
    await expect(page.getByTestId("report-record-form").getByRole("alert").first()).toBeVisible();
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "no_record");
    expect((await getView(manager, plan.id)).reports).toHaveLength(0);
    // 未来の時刻は記録できない
    await page.getByTestId("record-confirm-done").check();
    await page.getByTestId("record-confirm-latest").check();
    await page.getByTestId("record-reported-at-date").fill("2027-01-06");
    await page.getByTestId("record-submit").click();
    await expect(page.getByTestId("report-record-form")).toContainText("現在より後");
    expect((await getView(manager, plan.id)).reports).toHaveLength(0);
    // 番号なしの宣言はメモが必須
    await page.getByTestId("record-reported-at-date").fill("2027-01-05");
    await page.getByTestId("record-number-unavailable").check();
    await page.getByTestId("record-submit").click();
    await expect(page.getByTestId("report-record-form")).toContainText("メモ");
    expect((await getView(manager, plan.id)).reports).toHaveLength(0);
    await page.getByTestId("record-number-unavailable").uncheck();
    await page.getByTestId("record-dips-number").fill("FP-E2E-0001");

    // 記録する
    await page.getByTestId("record-submit").click();
    await afterFlash(page, "通報の結果を記録しました");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "reported");
    await expect(page.getByTestId("plan-report-status-label")).toContainText(REPORTED_LABEL);
    await expect(page.getByTestId("plan-report-status-label")).toContainText("FP-E2E-0001");
    const row = page.getByTestId("report-row").first();
    await expect(row).toHaveAttribute("data-status", "reported_manual");
    await expect(row).toHaveAttribute("data-channel", "manual");
    await expect(row.getByTestId("report-row-channel")).toHaveText("手動（利用者の申告）");
    await expect(row.getByTestId("report-row-number")).toHaveText("FP-E2E-0001");
    await expect(row.getByTestId("report-row-reported-at")).toHaveText("2027-01-05 11:00");
    await expect(row.getByTestId("report-row-check-evidence")).toHaveText(evidence.checkEvidenceId);
    await expect(row.getByTestId("report-row-diagnosis-evidence")).toHaveText(evidence.diagnosisEvidenceId);
    await expect(row.getByTestId("report-row-plan-version")).toHaveText(String(plan.version));
    await expect(row.getByTestId("report-row-map-revision")).toHaveText(String(fieldsData.revision));
    await expect(row.getByTestId("report-row-effective")).toBeVisible();
    // 入力は端末の下書きから消え、前回の入力を初期値にする
    await expect(page.getByTestId("report-input-flightSpeed")).toHaveValue("40");
    await noHorizontalScroll(page, "記録後の通報の画面");

    // DB の行の形（API 経由）：根拠の鎖・個人情報を含まない写し
    const afterRecord = await getView(manager, plan.id);
    const rec = afterRecord.reports[0]!;
    expect(rec).toMatchObject({ kind: "new", channel: "manual", status: "reported_manual", planVersion: plan.version, snapshotId: plan.currentSnapshotId, mapRevision: fieldsData.revision });
    expect(rec.checkEvidenceId).toBe(evidence.checkEvidenceId);
    expect(rec.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    const contentJson = JSON.stringify(rec.content);
    expect(contentJson).not.toContain("TEST-11112222");
    expect(contentJson).not.toContain("操縦 一郎");
    // 二重送信（同じ内容）：新しい行を作らず、既存を 200 で返す
    const again = await manager.post(`/api/ops/plans/${plan.id}/reports`, {
      data: {
        kind: "new",
        expectedPlanVersion: plan.version,
        inputs: { flightSpeed: 40, assistantsNumber: 1 },
        manual: { reportedAt: "2027-01-05T11:30", dipsNumber: "FP-E2E-0002", confirmedDipsDone: true, confirmedMatchesLatest: true },
      },
    });
    expect([200, 409]).toContain(again.status());
    expect((await getView(manager, plan.id)).reports.filter((r) => r.kind === "new")).toHaveLength(1);

    // 訂正（理由つき）：番号を直す。元の値は履歴に残る
    await page.getByTestId("report-action-correct").click();
    await page.getByTestId("correct-dips-number").fill("FP-E2E-0001B");
    await page.getByTestId("report-correct-reason").fill("番号の入力ミス");
    await page.getByTestId("report-correct-submit").click();
    await afterFlash(page, "記録を訂正しました");
    await expect(page.getByTestId("report-row").first().getByTestId("report-row-number")).toHaveText("FP-E2E-0001B");
    await expect(page.getByTestId("report-row").first().getByTestId("report-row-version")).toHaveText("2");

    // 計画を変更（予定開始 10:00 → 15:00）→ 「通報を変更する」と変更点
    const patch = await manager.patch(`/api/ops/plans/${plan.id}`, { data: { expectedVersion: plan.version, reason: "開始時刻の変更", plannedStartAt: "2027-01-10T15:00" } });
    expect(patch.status(), await patch.text()).toBe(200);
    await gotoPlanOpen(page, `/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "change_review");
    await expect(page.getByTestId("plan-report-changes")).toContainText("予定開始");
    await expect(page.getByTestId("plan-report-changes")).toContainText("2027-01-10 10:00");
    await expect(page.getByTestId("plan-report-changes")).toContainText("2027-01-10 15:00");
    const changeAction = page.getByTestId("next-action").filter({ has: page.locator('[data-action-id="change_report"]') });
    await expect(changeAction.getByTestId("next-action-label")).toHaveText("通報を変更する");
    // 押すと、変更点つきの通報内容（変更の記録フォーム）へ移る
    await tapAndWait(page, changeAction.getByTestId("next-action-link"), /\/report\?kind=change/);
    await expect(page.getByTestId("report-screen")).toHaveAttribute("data-kind", "change");
    await expect(page.getByTestId("plan-report-changes")).toContainText("予定開始");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await fillManual(page, "record", { date: "2027-01-05", time: "11:40", number: "FP-E2E-0003" });
    await page.getByTestId("record-confirm-done").check();
    await page.getByTestId("record-confirm-latest").check();
    await page.getByTestId("record-submit").click();
    await afterFlash(page, "通報の結果を記録しました");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "reported");
    const afterChange = await getView(manager, plan.id);
    expect(afterChange.reports[0]).toMatchObject({ kind: "change", status: "reported_manual", isEffective: true });
    expect(afterChange.reports[1]).toMatchObject({ kind: "new", isEffective: false });
    expect(afterChange.effective?.id).toBe(afterChange.reports[0]!.id);

    // 計画を中止 → 「通報を取り消す」→ 取消の結果を記録 → 取消済み
    const voided = await manager.post(`/api/ops/plans/${plan.id}/void`, { data: { expectedVersion: (await getPlan(manager, plan.id)).version, reason: "中止" } });
    expect(voided.status(), await voided.text()).toBe(200);
    await gotoPlanOpen(page, `/ops/plans/${plan.id}`);
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "cancel_needed");
    const cancelAction = page.getByTestId("next-action").filter({ has: page.locator('[data-action-id="cancel_report"]') });
    await expect(cancelAction.getByTestId("next-action-label")).toHaveText("通報を取り消す");
    await tapAndWait(page, cancelAction.getByTestId("next-action-link"), /\/report\?kind=cancel/);
    await expect(page.getByTestId("report-screen")).toHaveAttribute("data-kind", "cancel");
    await expect(page.getByTestId("report-cancel-info")).toContainText("DIPS 2.0 の画面で通報を取り消し");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await fillManual(page, "record", { date: "2027-01-05", time: "11:50", number: "CANCEL-0001" });
    await page.getByTestId("record-confirm-done").check();
    await page.getByTestId("record-confirm-latest").check();
    await page.getByTestId("record-submit").click();
    await afterFlash(page, "取消の結果を記録しました");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "cancelled");
    const afterCancel = await getView(manager, plan.id);
    expect(afterCancel.reports[0]).toMatchObject({ kind: "cancel", status: "reported_manual" });
    expect(afterCancel.effective).toBeNull();
    // 中止した計画の新規・変更は 409（取消は記録できた）
    const newOnVoided = await manager.post(`/api/ops/plans/${plan.id}/reports`, { data: { kind: "new", expectedPlanVersion: 1, manual: {} } });
    expect([400, 409]).toContain(newOnVoided.status());
    // 監査に、記録・訂正・取消の行が残る
    const ops = new Set(afterCancel.audit.map((a) => a.operation));
    for (const op of ["manual_record", "correct", "cancel", "copy"]) expect(ops.has(op), op).toBe(true);
    await expectNoForbiddenWords(page, "取消後の通報の画面");
  });

  test("4. 閲覧者・他の操縦者には技能証明書番号が伏せ字でコピーできず、運航管理者と本人には全桁が出る。他の組織は 404", async ({ page }) => {
    const plan = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot)));
    // 閲覧者
    await login(page, seeded("a-viewer"));
    await openReport(page, plan.id);
    const license = page.getByTestId("report-item-value-skill_number");
    await expect(license).not.toHaveText("TEST-11112222");
    await expect(license).toContainText("*");
    await expect(page.getByTestId("report-copy-skill_number")).toHaveCount(0);
    await expect(page.getByTestId("report-license-masked-note")).toBeVisible();
    // 閲覧者は記録できない
    await expect(page.getByTestId("report-record-form")).toHaveCount(0);
    await expect(page.getByTestId("report-notice")).toContainText(NOT_SENT);
    await noHorizontalScroll(page, "閲覧者の通報の画面");
    // 本人（操縦者）
    await login(page, seeded("a-pilot"));
    await openReport(page, plan.id);
    await expect(page.getByTestId("report-item-value-skill_number")).toHaveText("TEST-11112222");
    await expect(page.getByTestId("report-copy-skill_number")).toBeVisible();
    await expect(page.getByTestId("report-record-form")).toBeVisible();
    // 別の操縦者は、伏せ字で記録もできない
    await login(page, seeded("a-pilot2"));
    await openReport(page, plan.id);
    await expect(page.getByTestId("report-item-value-skill_number")).not.toHaveText("TEST-11112222");
    await expect(page.getByTestId("report-record-form")).toHaveCount(0);
    // 他の組織は 404
    const other = await apiAs(seeded("b-manager"));
    expect((await other.get(`/api/ops/plans/${plan.id}/report`)).status()).toBe(404);
    expect((await other.post(`/api/ops/plans/${plan.id}/reports`, { data: { kind: "new" } })).status()).toBe(404);
    expect((await other.get(`/api/ops/plans/${plan.id}/procedure-records`)).status()).toBe(404);
    await other.dispose();
    const viewer = await apiAs(seeded("a-viewer"));
    expect((await viewer.post(`/api/ops/plans/${plan.id}/reports`, { data: { kind: "new" } })).status()).toBe(403);
    await viewer.dispose();
    // 画面は Suspense の内側で notFound() になるため、状態コードは 200 のまま 404 の画面になる（12a と同じ）
    await login(page, seeded("b-manager"));
    await page.goto(`/ops/plans/${plan.id}/report`);
    await expect(page.getByText(/404|could not be found/).first()).toBeVisible();
    await expect(page.getByTestId("report-screen")).toHaveCount(0);
  });

  test("16. 次にやること：目安超過・飛行開始後の最上位の警告・記録後に消える・詳細と一覧から直接移る・対応が必要の絞り込み", async ({ page }) => {
    await login(page, seeded("a-manager"));
    // 時計は JST 2027-01-05 12:00。24 時間前の目安は、飛行開始の 24 時間前。
    const overdue = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { plannedStartAt: "2027-01-05T10:00", title: `期限 開始後 ${stamp}` })));
    const pastGuide = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { plannedStartAt: "2027-01-05T15:00", title: `期限 目安超過 ${stamp}` })));
    const upcoming = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { plannedStartAt: "2027-01-12T10:00", title: `期限 目安前 ${stamp}` })));
    const recommended = await activate(
      manager,
      await createPlan(manager, planBody(aircraft.id, selfPilot, { latitude: CLEAR_SPOT.lat, longitude: CLEAR_SPOT.lng, flags: [], plannedStartAt: "2027-01-12T10:00", title: `期限 推奨 ${stamp}` })),
    );

    // 飛行開始後で記録なし：最上位の警告（罰則の文言は「※要確認」付き、金額なし）
    await openReport(page, overdue.id, "", { folds: false });
    const od = page.getByTestId("plan-report-deadline");
    // 開く操作なしで見える（飛行開始後の警告は、既定で開いている）
    await expect(od).toBeVisible();
    await expect(page.getByTestId("plan-report-penalty")).toBeVisible();
    await expect(od).toHaveAttribute("data-state", "overdue_started");
    await expect(page.getByTestId("plan-report-penalty")).toContainText("罰則の対象になりえます");
    await expect(page.getByTestId("plan-report-penalty")).toContainText("※要確認");
    await expect(od).toContainText("社内の目安であり、法定の期限ではありません");
    await expectNoForbiddenWords(page, "飛行開始後の通報の画面");
    const odPlan = await getPlan(manager, overdue.id);
    expect(odPlan.nextActions.find((a) => a.id === "report")?.tier).toBe(1);

    // 目安を過ぎた：警告（tier 2）
    await openReport(page, pastGuide.id, "", { folds: false });
    await expect(page.getByTestId("plan-report-deadline-message")).toBeVisible();
    await expect(page.getByTestId("plan-report-deadline")).toHaveAttribute("data-state", "past_guide");
    await expect(page.getByTestId("plan-report-deadline-message")).toContainText("社内の目安（飛行開始の 24 時間前）を過ぎています");
    expect((await getPlan(manager, pastGuide.id)).nextActions.find((a) => a.id === "report")?.tier).toBe(2);

    // 目安の前：情報（目安まであと N 時間）。社内の目安と併記され、法定の期限としての日付は出ない
    await openReport(page, upcoming.id);
    await expect(page.getByTestId("plan-report-deadline")).toHaveAttribute("data-state", "upcoming");
    await expect(page.getByTestId("plan-report-deadline-message")).toContainText("目安まであと");
    await expect(page.getByTestId("plan-report-guide-note")).toContainText("社内の目安であり、法定の期限ではありません");
    expect(await page.getByTestId("plan-report-deadline").innerText()).not.toContain("法定の期限：");

    // 推奨：警告にならず、次にやることの末尾（tier 5）に出るだけ（確認を済ませると、推奨だけが残る）
    const confirmed = await manager.post(`/api/ops/plans/${recommended.id}/confirmations`, { data: { decision: "approved", expectedVersion: recommended.version } });
    expect(confirmed.status(), await confirmed.text()).toBe(201);
    const rec = await getPlan(manager, recommended.id);
    expect(rec.nextActions.map((a) => a.id)).toEqual(["consider_report"]);
    expect(rec.nextActions.find((a) => a.id === "consider_report")?.tier).toBe(5);
    await openReport(page, recommended.id);
    await expect(page.getByTestId("plan-report-deadline")).toHaveAttribute("data-state", "recommended_open");
    await expect(page.getByTestId("plan-report-deadline-message")).toHaveText("通報を行うことを推奨します");

    // 詳細：次にやることが動詞で始まる 1 行で出て、押すと通報内容へ移る
    await gotoPlanOpen(page, `/ops/plans/${overdue.id}`);
    const first = page.getByTestId("next-action").first();
    await expect(first).toHaveAttribute("data-action-id", "report");
    await expect(first).toHaveAttribute("data-tier", "1");
    await expect(first.getByTestId("next-action-label")).toHaveText("飛行計画を DIPS で通報する");
    await onAllPlanScreens(page, overdue.id, (l) => expectNoForbiddenWords(page, `計画の詳細（${l}）`));
    await tapAndWait(page, first.getByTestId("next-action-link"), new RegExp(`/ops/plans/${overdue.id}/report$`));
    await expect(page.getByTestId("report-screen")).toBeVisible();

    // 一覧：先頭の次にやること、状況の印、対応が必要の絞り込み
    // 予定日が今日（時計は 2027-01-05）の計画は「これから」の表示に出る（日付で分ける）
    await page.goto("/ops/plans?view=upcoming");
    const row = page.getByTestId("plan-row").filter({ hasText: overdue.title });
    await expect(row).toHaveCount(1);
    const li = page.getByRole("listitem").filter({ has: row });
    await expect(li.getByTestId("plan-row-next-action-label")).toHaveText("飛行計画を DIPS で通報する");
    await expect(li.getByTestId("plan-report-status-badge")).toHaveAttribute("data-code", "no_record");
    await tapAndWait(page, li.getByTestId("plan-row-next-action-link"), new RegExp(`/ops/plans/${overdue.id}/report$`));
    await page.goto("/ops/plans?view=upcoming");
    const all = await page.getByTestId("plan-row").count();
    await tapAndWait(page, page.getByTestId("plan-filter-attention"), /attention=1/);
    await expect(page.getByTestId("plan-list")).toBeVisible();
    expect(await page.getByTestId("plan-row").count()).toBeLessThanOrEqual(all);
    await expect(page.getByTestId("plan-row").filter({ hasText: recommended.title })).toHaveCount(0);
    await expect(page.getByTestId("plan-row").filter({ hasText: upcoming.title })).toHaveCount(1);
    await expectNoForbiddenWords(page, "計画の一覧");

    // 記録すると、次にやることから消える（保存した状態ではなく、記録の有無から導出）
    await openReport(page, pastGuide.id);
    await fillManual(page, "record", { date: "2027-01-05", time: "11:00", number: "FP-E2E-0100" });
    await page.getByTestId("record-confirm-done").check();
    await page.getByTestId("record-confirm-latest").check();
    await page.getByTestId("record-submit").click();
    await afterFlash(page, "通報の結果を記録しました");
    const done = await getPlan(manager, pastGuide.id);
    expect(done.nextActions.map((a) => a.id)).not.toContain("report");
    expect(done.report.deadline.state).toBe("none");
    await gotoPlanOpen(page, `/ops/plans/${pastGuide.id}`);
    await expect(page.locator('[data-testid="next-action"][data-action-id="report"]')).toHaveCount(0);
  });

  test("17. 手続きの記録（Sprint 18-2）：許可・承認の「申請済み」の記録は止める（フォーム無し・API は 409・apply_permit は出ない）。飛行禁止法の同意・通報は、すべての確認が真のときだけ記録できる。取り下げ・前の判定に対する記録", async ({ page }) => {
    await login(page, seeded("a-manager"));
    const plan = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `手続き 許可 ${stamp}` })));
    await gotoPlanOpen(page, `/ops/plans/${plan.id}`);
    // 「許可・承認を申請する」は出ない。代わりに「取得した許可・承認を登録する」（申請の記録に依存しない・期限の文言なし）
    await expect(page.locator('[data-testid="next-action"][data-action-id="apply_permit"]')).toHaveCount(0);
    const register = page.locator('[data-testid="next-action"][data-action-id="register_permit"]');
    await expect(register.getByTestId("next-action-label")).toHaveText("取得した許可・承認を登録する");
    await expect(register.getByTestId("next-action-due")).toHaveCount(0);
    // 手続きの記録の節には、許可・承認の記録（フォーム・状態・取り下げ）が無い。行が無いので「以前の記録」も出ない
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/overview`);
    await expect(page.getByTestId("procedure-dips_permit")).toHaveCount(0);
    await expect(page.getByTestId("procedure-form-dips_permit")).toHaveCount(0);
    await expect(page.getByTestId("procedure-submit-dips_permit")).toHaveCount(0);
    await expect(page.getByTestId("procedure-none")).toHaveText("この計画の判定には、記録する手続き（小型無人機等飛行禁止法の同意・通報）はありません。");
    // API：done・retract とも 409 procedure_kind_disabled。行は増えない
    const rowsBefore = (await (await manager.get(`/api/ops/plans/${plan.id}/procedure-records`)).json()) as { records: unknown[] };
    for (const data of [
      { kind: "dips_permit", action: "done", doneAt: "2027-01-05T09:00", checks: { applicationCompleted: true } },
      { kind: "dips_permit", action: "retract", reason: "x" },
    ]) {
      const r = await manager.post(`/api/ops/plans/${plan.id}/procedure-records`, { data });
      expect(r.status(), await r.text()).toBe(409);
      expect(((await r.json()) as { error: string }).error).toBe("procedure_kind_disabled");
    }
    const rowsAfter = (await (await manager.get(`/api/ops/plans/${plan.id}/procedure-records`)).json()) as { records: unknown[] };
    expect(rowsAfter.records).toHaveLength(rowsBefore.records.length);
    await onAllPlanScreens(page, plan.id, async (l) => {
      const text = await bodyText(page);
      expect(text, `${l}: 許可済み`).not.toContain("許可済み");
      expect(text, `${l}: 申請済み`).not.toContain("申請済み");
    });
    await noHorizontalScroll(page, "手続きの記録");
    await onAllPlanScreens(page, plan.id, (l) => expectNoForbiddenWords(page, `手続きの記録（${l}）`));

    // 飛行禁止法の同意・通報（美保基地）：二つの確認が要る
    const miho = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `手続き 警察 ${stamp}`, latitude: MIHO_SPOT.lat, longitude: MIHO_SPOT.lng, flags: [] })));
    await gotoPlanOpen(page, `/ops/plans/${miho.id}`);
    await expect(page.locator('[data-testid="next-action"][data-action-id="notify_police"]').getByTestId("next-action-label")).toHaveText("警察へ通報する");
    await gotoPlanOpen(page, `/ops/plans/${miho.id}/overview`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("procedure-done-at-small_drone_law-date").fill("2027-01-05");
    await page.getByTestId("procedure-done-at-small_drone_law-time").fill("09:00");
    await page.getByTestId("procedure-check-small_drone_law-facilityConsentObtained").check();
    await page.getByTestId("procedure-submit-small_drone_law").click();
    await expect(page.getByTestId("procedure-form-small_drone_law").getByRole("alert").first()).toBeVisible();
    await expect(page.getByTestId("procedure-small_drone_law")).toHaveAttribute("data-status", "none");
    await page.getByTestId("procedure-check-small_drone_law-policeNoticeDone").check();
    await page.getByTestId("procedure-submit-small_drone_law").click();
    await afterFlash(page, "手続きの記録を残しました");
    await expect(page.getByTestId("procedure-status-small_drone_law")).toHaveText(/同意・通報を記録済み（利用者の申告）/);
    expect(await page.getByTestId("plan-procedures").innerText()).not.toContain("許可済み");
    await gotoPlanOpen(page, `/ops/plans/${miho.id}`);
    await expect(page.locator('[data-testid="next-action"][data-action-id="notify_police"]')).toHaveCount(0);
    await gotoPlanOpen(page, `/ops/plans/${miho.id}/overview`);

    // 取り下げ（理由つき）→ 取り下げた行として残り、次にやること（警察へ通報する）に戻る
    await page.getByTestId("procedure-retract-open-small_drone_law").click();
    await page.getByTestId("procedure-retract-reason-small_drone_law").fill("通報していなかった");
    await page.getByTestId("procedure-retract-small_drone_law").click();
    await afterFlash(page, "記録を取り下げました");
    await expect(page.getByTestId("procedure-small_drone_law")).toHaveAttribute("data-status", "retracted");
    await gotoPlanOpen(page, `/ops/plans/${miho.id}`);
    await expect(page.locator('[data-testid="next-action"][data-action-id="notify_police"]')).toHaveCount(1);
    await gotoPlanOpen(page, `/ops/plans/${miho.id}/overview`);
    await expect(page.getByTestId("procedure-history-small_drone_law").getByTestId("procedure-history-row")).toHaveCount(2);

    // 記録し直したあと、計画の訂正（判定が変わる）で「前の判定に対する記録です」と出て、次にやることに戻る
    await page.getByTestId("procedure-done-at-small_drone_law-date").fill("2027-01-05");
    await page.getByTestId("procedure-done-at-small_drone_law-time").fill("09:30");
    await page.getByTestId("procedure-check-small_drone_law-facilityConsentObtained").check();
    await page.getByTestId("procedure-check-small_drone_law-policeNoticeDone").check();
    await page.getByTestId("procedure-submit-small_drone_law").click();
    await afterFlash(page, "手続きの記録を残しました");
    await expect(page.getByTestId("procedure-small_drone_law")).toHaveAttribute("data-status", "done");
    const patched = await manager.patch(`/api/ops/plans/${miho.id}`, { data: { expectedVersion: (await getPlan(manager, miho.id)).version, reason: "日の変更", plannedStartAt: "2027-01-14T10:00" } });
    expect(patched.status(), await patched.text()).toBe(200);
    await gotoPlanOpen(page, `/ops/plans/${miho.id}/overview`);
    await expect(page.getByTestId("procedure-small_drone_law")).toHaveAttribute("data-status", "stale");
    await expect(page.getByTestId("procedure-stale-small_drone_law")).toContainText("前の判定に対する記録です");
    await gotoPlanOpen(page, `/ops/plans/${miho.id}`);
    await expect(page.locator('[data-testid="next-action"][data-action-id="notify_police"]')).toHaveCount(1);
    await gotoPlanOpen(page, `/ops/plans/${miho.id}/overview`);
    await noHorizontalScroll(page, "手続きの記録（飛行禁止法）");
    await onAllPlanScreens(page, miho.id, (l) => expectNoForbiddenWords(page, `手続きの記録（飛行禁止法・${l}）`));

    // 閲覧者は 403、他の組織は 404
    const viewer = await apiAs(seeded("a-viewer"));
    expect((await viewer.post(`/api/ops/plans/${miho.id}/procedure-records`, { data: { kind: "small_drone_law", action: "retract", reason: "x" } })).status()).toBe(403);
    expect((await viewer.get(`/api/ops/plans/${miho.id}/procedure-records`)).status()).toBe(200);
    await viewer.dispose();
    const other = await apiAs(seeded("b-manager"));
    expect((await other.get(`/api/ops/plans/${miho.id}/procedure-records`)).status()).toBe(404);
    expect((await other.post(`/api/ops/plans/${miho.id}/procedure-records`, { data: { kind: "small_drone_law", action: "retract", reason: "x" } })).status()).toBe(404);
    await other.dispose();
    // 閲覧者の画面には記録のフォームが出ない
    await login(page, seeded("a-viewer"));
    await gotoPlanOpen(page, `/ops/plans/${miho.id}/overview`);
    await expect(page.getByTestId("procedure-small_drone_law")).toBeVisible();
    await expect(page.getByTestId("procedure-form-small_drone_law")).toHaveCount(0);
    await expect(page.getByTestId("procedure-retract-open-small_drone_law")).toHaveCount(0);
  });

  test("18. 軽微な表示：判定の日時が JST、タップ領域 44px 以上、訂正フォームの機体は読み取り専用の文、新規の機体セレクトがはみ出さない", async ({ page }) => {
    await login(page, seeded("a-manager"));
    const plan = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `表示 ${stamp}` })));
    // ① 判定の日時
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);
    const judgedAt = page.getByTestId("plan-judged-at");
    await expect(judgedAt).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const iso = (await judgedAt.getAttribute("datetime"))!;
    const jstExpected = new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
    await expect(judgedAt).toHaveText(jstExpected);
    expect(await bodyText(page)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[:\d.]*Z/);

    // ② タップ領域（ボタン・フォームの部品・独立したリンク）
    const small = async (label: string) => {
      const { found, checked } = await page.evaluate(() => {
        const out: string[] = [];
        let n = 0;
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none";
        };
        const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"]';
        for (const el of Array.from(document.querySelectorAll(sel))) {
          if (!visible(el)) continue;
          const cs = getComputedStyle(el);
          // 文章の中のリンク（inline）は除く
          if (el.tagName === "A" && cs.display === "inline") continue;
          n += 1;
          let box = el.getBoundingClientRect();
          if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
            const lab = el.closest("label");
            if (lab) box = lab.getBoundingClientRect();
          }
          if (box.height < 43.5) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? (el.textContent ?? "").trim().slice(0, 20)}] ${Math.round(box.height)}px`);
        }
        return { found: out, checked: n };
      });
      expect(checked, `${label}: 走査した部品がない`).toBeGreaterThan(0);
      expect(found, `${label}: 44px 未満の部品`).toEqual([]);
    };
    for (const url of ["/ops/places", "/ops/plans", `/ops/plans/${plan.id}`, `/ops/plans/${plan.id}/overview`, `/ops/plans/${plan.id}/judgement`, `/ops/plans/${plan.id}/journal`, `/ops/plans/${plan.id}/report`, "/ops/flights", "/ops/inspections", "/ops/members"]) {
      await page.goto(url);
      await expect(page.locator("main").first()).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      if (url.endsWith("/report")) await expect(page.getByTestId("report-screen")).toBeVisible();
      await small(url);
      await noHorizontalScroll(page, url);
    }
    // 絞り込みの切り替え（取消済みを含める）も 44px 以上
    await page.goto("/ops/flights");
    await expect(page.locator("main").first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await small("/ops/flights（絞り込み）");

    // ③ 訂正フォーム：機体は読み取り専用の文（折り返して全部見える）。新規の機体セレクトは親に収まる
    await page.goto(`/ops/plans/${plan.id}/edit`);
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await expect(page.getByTestId("plan-aircraft")).toHaveCount(0);
    const text = page.getByTestId("plan-aircraft-text");
    await expect(text).toContainText(aircraft.registrationMark);
    await expect(text).toContainText("通報試験機");
    const box = await text.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    await noHorizontalScroll(page, "計画の訂正フォーム");
    await page.goto("/ops/plans/new");
    await expect(page.getByTestId("plan-aircraft")).toBeVisible();
    const sel = await page.getByTestId("plan-aircraft").boundingBox();
    expect(sel!.x + sel!.width).toBeLessThanOrEqual(375);
    await noHorizontalScroll(page, "計画の新規作成フォーム");
  });
});

// ======================================================================
// 模擬アダプター（DIPS_REPORT_ADAPTER=mock）。実際の DIPS には送信されない。
// ======================================================================
test.describe("Sprint 12b E2E-DB（模擬）：送信内容の確認 → 送信、結果不明・失敗・再送", () => {
  test.use({ baseURL: MOCK_BASE });
  let manager: APIRequestContext;
  let aircraft: { id: string; version: number; registrationMark: string };
  let selfPilot = "";

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"), MOCK_BASE);
    aircraft = await createAircraft(manager);
    selfPilot = await pilotIdOf(seeded("a-pilot"));
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const login = async (page: Page) => {
    await noBrowserCache(page);
    await signIn(page.request, seeded("a-manager"));
  };

  test("13. 同じシナリオ（通報内容 → 送信 → 番号と状態 → 変更 → 取消）を模擬で流す。模擬の表示・根拠の鎖は手動と同じ形", async ({ page }) => {
    await login(page);
    const plan = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `模擬 通し ${stamp}` })));
    await openReport(page, plan.id);
    await expect(page.getByTestId("report-notice")).toContainText("模擬（開発用）です。実際の DIPS には送信されません。");
    await expect(page.getByTestId("report-adapter")).toHaveAttribute("data-adapter", "mock");
    await expect(page.getByTestId("report-adapter")).toContainText("模擬（開発用）");
    await expect(page.getByTestId("report-mock-assumption")).toContainText("そらばん独自の仮定");
    await expect(page.getByTestId("mock-notice")).toContainText("実際の DIPS には送信されません");
    await expectNoForbiddenWords(page, "模擬の通報の画面");
    await noHorizontalScroll(page, "模擬の通報の画面");

    // 送信内容の確認が無いと送信できない
    await expect(page.getByTestId("send-submit")).toBeDisabled();
    const noConfirm = await manager.post(`/api/ops/plans/${plan.id}/reports`, { data: { kind: "new", expectedPlanVersion: plan.version } });
    expect(noConfirm.status()).toBe(400);
    await page.getByTestId("send-confirm").check();
    await page.getByTestId("send-scenario").selectOption("ok");
    await page.getByTestId("send-submit").click();
    await afterFlash(page, "送信しました（模擬・開発用）");
    const row = page.getByTestId("report-row").first();
    await expect(row).toHaveAttribute("data-status", "submitted_api");
    await expect(row).toHaveAttribute("data-channel", "mock");
    await expect(row.getByTestId("report-row-channel")).toHaveText("模擬（開発用）");
    await expect(row.getByTestId("report-row-status")).toHaveText("送信済み（模擬・開発用）");
    await expect(row.getByTestId("report-row-number")).toHaveText(/^MOCK-[0-9A-F]{10}$/);
    await expect(row.getByTestId("report-row-check-evidence")).toHaveText(plan.judgement.checkEvidenceId);
    await expect(row.getByTestId("report-row-diagnosis-evidence")).toHaveText(plan.judgement.diagnosisEvidenceId);
    await expect(row.getByTestId("report-row-plan-version")).toHaveText(String(plan.version));
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "reported");
    // DB の行の形は手動と同じ（根拠の鎖を持つ）
    const v1 = await getView(manager, plan.id);
    expect(v1.reports[0]).toMatchObject({ kind: "new", channel: "mock", status: "submitted_api", planVersion: plan.version, snapshotId: plan.currentSnapshotId, mapRevision: fieldsData.revision });
    expect(v1.reports[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(v1.reports[0]!.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(v1.effective?.id).toBe(v1.reports[0]!.id);
    // 二重送信：新しい行を作らない
    const dup = await manager.post(`/api/ops/plans/${plan.id}/reports`, { data: { kind: "new", expectedPlanVersion: plan.version, confirmSend: true } });
    expect([200, 409]).toContain(dup.status());
    expect((await getView(manager, plan.id)).reports.filter((r) => r.kind === "new")).toHaveLength(1);
    // 監査：送信の開始と結果
    expect((await getView(manager, plan.id)).audit.filter((a) => a.operation === "submit").length).toBeGreaterThanOrEqual(2);

    // 計画の変更 → 変更の送信
    const patch = await manager.patch(`/api/ops/plans/${plan.id}`, { data: { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-10T15:00" } });
    expect(patch.status(), await patch.text()).toBe(200);
    await openReport(page, plan.id, "?kind=change#record");
    await expect(page.getByTestId("report-screen")).toHaveAttribute("data-kind", "change");
    await expect(page.getByTestId("plan-report-changes")).toContainText("予定開始");
    await page.getByTestId("send-confirm").check();
    await page.getByTestId("send-submit").click();
    await afterFlash(page, "送信しました（模擬・開発用）");
    const v2 = await getView(manager, plan.id);
    expect(v2.reports[0]).toMatchObject({ kind: "change", channel: "mock", status: "submitted_api", isEffective: true });
    expect(v2.reports[1]).toMatchObject({ kind: "new", isEffective: false });

    // 取消：模擬は取消を送れない（API と同じ前提）。DIPS の画面で取り消した結果を記録する
    await openReport(page, plan.id, "?kind=cancel#record");
    await expect(page.getByTestId("report-record-form")).toHaveAttribute("data-mode", "manual");
    await fillManual(page, "record", { date: "2027-01-05", time: "11:55", number: "CANCEL-MOCK-1" });
    await page.getByTestId("record-confirm-done").check();
    await page.getByTestId("record-confirm-latest").check();
    await page.getByTestId("record-submit").click();
    await afterFlash(page, "取消の結果を記録しました");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "cancelled");
    const v3 = await getView(manager, plan.id);
    expect(v3.reports[0]).toMatchObject({ kind: "cancel", status: "reported_manual" });
    expect(v3.effective).toBeNull();
  });

  test("13. 模擬の timeout は「結果不明」で再送のボタンが出ず、確認後に確定できる。rejected は失敗となり再送できる", async ({ page }) => {
    await login(page);
    // timeout → 結果不明
    const a = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `模擬 結果不明 ${stamp}` })));
    await openReport(page, a.id);
    await page.getByTestId("send-confirm").check();
    await page.getByTestId("send-scenario").selectOption("timeout");
    await page.getByTestId("send-submit").click();
    await afterFlash(page, "送信しました（模擬・開発用）");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "unknown");
    const row = page.getByTestId("report-row").first();
    await expect(row).toHaveAttribute("data-status", "unknown");
    await expect(row.getByTestId("report-row-status")).toContainText("送信結果が不明です。DIPS の画面で確かめてください");
    await expect(row.getByTestId("report-row-error")).toContainText("応答がありませんでした");
    await expect(page.getByTestId("report-action-retry")).toHaveCount(0);
    // 状況は「通報済み」にならない
    expect(await page.getByTestId("plan-report-status").innerText()).not.toContain("DIPS で通報済み");
    // 確認後に確定：通報されていなかった → 失敗となり再送できる
    await page.getByTestId("report-action-resolve").click();
    await page.getByTestId("report-resolve-outcome").selectOption("not_reported");
    await page.getByTestId("report-resolve-reason").fill("DIPS の画面で、通報されていないことを確認した");
    await page.getByTestId("report-resolve-submit").click();
    await afterFlash(page, "通報されていなかったものとして確定");
    await expect(page.getByTestId("report-row").first()).toHaveAttribute("data-status", "failed");
    await expect(page.getByTestId("report-action-retry")).toBeVisible();
    // 再送（同じ行・同じキー）→ 受理
    await page.getByTestId("report-action-retry").click();
    await page.getByTestId("report-retry-scenario").selectOption("ok");
    await expect(page.getByTestId("report-retry-submit")).toBeDisabled();
    await page.getByTestId("report-retry-confirm").check();
    await page.getByTestId("report-retry-submit").click();
    await afterFlash(page, "再送しました");
    await expect(page.getByTestId("report-row")).toHaveCount(1);
    await expect(page.getByTestId("report-row").first()).toHaveAttribute("data-status", "submitted_api");
    const view = await getView(manager, a.id);
    expect(view.reports).toHaveLength(1);
    expect(view.reports[0]!.version).toBeGreaterThanOrEqual(4);

    // 結果不明を「通報されていた」として確定（番号を入れる）
    const b = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `模擬 確定 ${stamp}` })));
    await openReport(page, b.id);
    await page.getByTestId("send-confirm").check();
    await page.getByTestId("send-scenario").selectOption("server_error");
    await page.getByTestId("send-submit").click();
    await afterFlash(page, "送信しました（模擬・開発用）");
    await expect(page.getByTestId("report-row").first()).toHaveAttribute("data-status", "unknown");
    await page.getByTestId("report-action-resolve").click();
    await page.getByTestId("report-resolve-outcome").selectOption("reported");
    await fillManual(page, "resolve", { date: "2027-01-05", time: "11:10", number: "FP-RESOLVED-1" });
    await page.getByTestId("report-resolve-reason").fill("DIPS の画面で通報されていることを確認した");
    await page.getByTestId("report-resolve-submit").click();
    await afterFlash(page, "通報済み（利用者の申告）として確定");
    await expect(page.getByTestId("report-row").first()).toHaveAttribute("data-status", "reported_manual");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "reported");

    // rejected → 失敗、再送できる。unauthorized も失敗
    const c = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `模擬 失敗 ${stamp}` })));
    await openReport(page, c.id);
    await page.getByTestId("send-confirm").check();
    await page.getByTestId("send-scenario").selectOption("rejected");
    await page.getByTestId("send-submit").click();
    await afterFlash(page, "送信しました（模擬・開発用）");
    await expect(page.getByTestId("report-row").first()).toHaveAttribute("data-status", "failed");
    await expect(page.getByTestId("plan-report-status")).toHaveAttribute("data-code", "failed");
    await expect(page.getByTestId("report-row").first().getByTestId("report-row-error")).toContainText("パラメータが正しくありません");
    await expect(page.getByTestId("report-action-retry")).toBeVisible();
    await expect(page.getByTestId("report-action-resolve")).toHaveCount(0);
    await page.getByTestId("report-action-retry").click();
    await page.getByTestId("report-retry-scenario").selectOption("unauthorized");
    await page.getByTestId("report-retry-confirm").check();
    await page.getByTestId("report-retry-submit").click();
    await afterFlash(page, "再送しました");
    await expect(page.getByTestId("report-row")).toHaveCount(1);
    await expect(page.getByTestId("report-row").first()).toHaveAttribute("data-status", "failed");
    await expect(page.getByTestId("report-row").first().getByTestId("report-row-error")).toContainText("再度連携してください");
    await noHorizontalScroll(page, "失敗の履歴");
    await expectNoForbiddenWords(page, "模擬の失敗");
  });

  test("13. 未知の外部状況は状態を増やさず「状況：不明（生の値）」と出る", async ({ page }) => {
    await login(page);
    const p = await activate(manager, await createPlan(manager, planBody(aircraft.id, selfPilot, { title: `模擬 未知 ${stamp}` })));
    await openReport(page, p.id);
    await page.getByTestId("send-confirm").check();
    await page.getByTestId("send-scenario").selectOption("unknown_status");
    await page.getByTestId("send-submit").click();
    await afterFlash(page, "送信しました（模擬・開発用）");
    await expect(page.getByTestId("report-row").first()).toHaveAttribute("data-status", "submitted_api");
    await expect(page.getByTestId("report-row-external-status")).toHaveText("状況：不明（XYZ）");
  });
});
