import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { gotoPlanOpen, onAllPlanScreens, openPlanFolds } from "./plan-screen";
import { expectNoHorizontalScroll } from "../field-checks";

// Sprint 12d の E2E-DB（契約 12〜15 の画面・通しの部分。契約 16 の通報内容・現場モードは別の describe）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1・逆ジオコーダの模擬サーバーを与えた next start に対して実行する。
// サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定している。ブラウザの時計は page.clock で合わせる。
// 画面は幅 375px のタッチ端末で確かめる。DIPS へは何も送らない（許可・承認の結果は、利用者が登録する）。
// テスト用の初期データ（組織A）：許可・承認の登録 6 件（TEST-PERMIT-*。共有の初期データは変えない。訂正・失効・取消はテストごとに作った登録で行う）。
// 登録は利用者の申告で、「許可がある＝飛べる」とは読ませない。「通報不要」の語は出さない。

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
const DAY = "2027-01-05";
const HQ = { lat: 35.434238, lng: 133.380508 };
const NIGHT_SPOT = { lat: 35.44, lng: 133.35 };
const SEED = {
  blanket: "TEST-PERMIT-BLANKET-001",
  individual: "TEST-PERMIT-INDIV-002",
  expired: "TEST-PERMIT-EXPIRED-003",
  revoked: "TEST-PERMIT-REVOKED-004",
  airport: "TEST-PERMIT-AIRPORT-005",
  textOnly: "TEST-PERMIT-TEXT-006",
} as const;

let seq = 0;
const stamp = Date.now().toString(36).toUpperCase();
const uniqueMark = () => `JUS12D${stamp}${seq++}`;
const uniqueNumber = (label: string) => `E2E-12D-${stamp}-${label}-${seq++}`;
const at = (hms: string) => new Date(`${DAY}T${hms}+09:00`);
const fixClock = (page: Page, hms: string) => page.clock.setFixedTime(at(hms));

const createAircraft = async (manager: APIRequestContext): Promise<{ id: string; registrationMark: string }> => {
  const registrationMark = uniqueMark();
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "許可試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
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
const planBody = (aircraftId: string, pilotId: string, extra: Record<string, unknown> = {}) => ({
  title: `許可 ${stamp}-${seq++}`,
  aircraftId,
  pilotId,
  plannedStartAt: `${DAY}T13:00`,
  durationMinutes: 60,
  purpose: "空撮",
  placeName: "試験地点",
  latitude: HQ.lat,
  longitude: HQ.lng,
  flags: ["method_night"],
  ...extra,
});
const createPlan = async (ctx: APIRequestContext, body: object): Promise<PlanJson> => {
  const r = await ctx.post("/api/ops/plans", { data: body });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as PlanJson;
};

type PermitJson = { id: string; version: number; permitNumber: string };
/** 包括・全国・夜間・機体と操縦者は限定なし・2026-10-01〜2027-09-30 の登録。 */
const regBody = (number: string, extra: Record<string, unknown> = {}) => ({
  permitNumber: number,
  coverage: "blanket",
  kinds: ["night"],
  issuedOn: "2026-10-01",
  validFrom: "2026-10-01",
  validTo: "2027-09-30",
  placeScope: { type: "nationwide" },
  aircraftScope: { type: "any" },
  pilotScope: { type: "any" },
  ...extra,
});
const createPermit = async (ctx: APIRequestContext, number: string, extra: Record<string, unknown> = {}): Promise<PermitJson> => {
  const r = await ctx.post("/api/ops/permits", { data: regBody(number, extra) });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as PermitJson;
};

type PlanPermits = {
  permits: { numbers: { numberText: string; status: string; reasons: { code: string }[]; versionNo: number | null }[]; grantedValues: string[] };
  candidates: { permitNumber: string }[];
  judgementUpToDate: boolean;
};
const getPlanPermits = async (ctx: APIRequestContext, planId: string): Promise<PlanPermits> => {
  const r = await ctx.get(`/api/ops/plans/${planId}/permits`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as PlanPermits;
};

/** リンクを押して、遷移（URL の変化）まで確かめる（12a〜12c の tapAndWait と同じ作法）。応答の待ち受けは作らない。 */
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

/** 表示中の要素だけ（Next のルーターは直前の画面を非表示のまま残すことがあり、同じ data-testid が重なる）。 */
const tid = (page: Page, id: string): Locator => page.locator(`[data-testid="${id}"]:visible`);

const bodyText = async (page: Page): Promise<string> => {
  await expect(page.locator("main").first()).toBeVisible();
  return page.locator("body").innerText();
};
const expectNoForbiddenWords = async (page: Page, label: string) => {
  const text = await bodyText(page);
  for (const w of FORBIDDEN_WORDS) expect(text, `${label}: 「${w}」が出ている`).not.toContain(w);
  expect(text, `${label}: 特許・出願の表示`).not.toMatch(/特許|出願/);
  expect(text, `${label}: 飛べると読める語`).not.toMatch(/飛べる|飛行可能|許可済み/);
};
const afterFlash = async (page: Page, text: string | RegExp) => {
  await expect(tid(page, "ops-change-notice").filter({ hasText: text })).toBeVisible();
};

const itemVerdict = (page: Page, itemId: string) => page.locator(`[data-testid="verdict-item"][data-item-id="${itemId}"]:visible`);
const planRow = (page: Page, numberText: string) => page.locator(`[data-testid="plan-permit-row"]:visible:has([data-testid="plan-permit-number"]:text-is("${numberText}"))`);

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, timezoneId: "America/Los_Angeles" });

test.describe("Sprint 12d E2E-DB：許可・承認の登録（契約 12）", () => {
  test("12-1. 「登録」から一覧へ：初期データの 6 件が文字と記号つきの有効性で区別され、固定の文言が出る。絞り込みが効く。375px で横スクロールなし", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    await page.goto("/ops/more");
    await expect(tid(page, "ops-more")).toBeVisible();
    await tapAndWait(page, tid(page, "more-link-permits"), /\/ops\/permits$/);
    await expect(tid(page, "permit-list")).toBeVisible();
    // 固定の文言：登録は利用者の申告、DIPS に接続しない、様式の要確認
    await expect(tid(page, "permit-declaration-text")).toHaveText("登録は利用者の入力です。許可書で確認してください。");
    await expect(tid(page, "permit-no-dips-note")).toContainText("DIPS に接続しません");
    await expect(tid(page, "permit-format-note")).toContainText("※要確認");
    await expectNoHorizontalScroll(page, "許可・承認の一覧");
    const row = (n: string) => page.locator(`[data-testid="permit-row"]:has([data-testid="permit-row-number"]:text-is("${n}"))`);
    await expect(row(SEED.blanket)).toHaveAttribute("data-validity", "valid");
    await expect(row(SEED.blanket).getByTestId("permit-validity")).toHaveText("● 有効");
    await expect(row(SEED.expired)).toHaveAttribute("data-validity", "expired");
    await expect(row(SEED.expired).getByTestId("permit-validity")).toHaveText("× 期限切れ");
    await expect(row(SEED.revoked)).toHaveAttribute("data-validity", "revoked");
    await expect(row(SEED.revoked).getByTestId("permit-validity")).toHaveText("× 失効");
    await expect(row(SEED.individual).getByTestId("permit-row-kinds")).toContainText("個別許可");
    await expect(row(SEED.individual).getByTestId("permit-row-scope")).toContainText("円 1 件");
    await expect(row(SEED.textOnly).getByTestId("permit-row-scope")).toContainText("文章のみ");
    await expect(row(SEED.blanket).getByTestId("permit-row-period")).toContainText("2026-10-01 〜 2027-09-30");

    // 期限間近・開始前（自分の登録を足して確かめる）
    const manager = await apiAs(seeded("a-manager"));
    const soon = await createPermit(manager, uniqueNumber("SOON"), { validTo: "2027-01-20" });
    const later = await createPermit(manager, uniqueNumber("LATER"), { validFrom: "2027-02-01" });
    await page.goto("/ops/permits");
    await expect(page.locator(`a[href="/ops/permits/${soon.id}"]`).getByTestId("permit-validity")).toHaveText("▲ 期限間近（30 日以内）");
    await expect(page.locator(`a[href="/ops/permits/${later.id}"]`).getByTestId("permit-validity")).toHaveText("◇ 開始前");

    // 絞り込み（番号）と有効性
    await tid(page, "permit-filter-q").fill("expired-003");
    await tid(page, "permit-filter-submit").click();
    await expect(page).toHaveURL(/q=expired-003/);
    await expect(tid(page, "permit-row")).toHaveCount(1);
    await expect(tid(page, "permit-row-number")).toHaveText(SEED.expired);
    await page.goto("/ops/permits?validity=revoked");
    await expect(tid(page, "permit-row").first()).toHaveAttribute("data-validity", "revoked");
    for (const r of await tid(page, "permit-row").all()) await expect(r).toHaveAttribute("data-validity", "revoked");
    await expectNoForbiddenWords(page, "許可・承認の一覧");
    await manager.dispose();
  });

  test("12-2. 登録（運航管理者のみ）→ 詳細 → 訂正（理由必須・影響する計画の旨）→ 失効 → 取消 → 版の履歴。同じ番号は拒否", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    const number = uniqueNumber("UI");
    await page.goto("/ops/permits");
    await tapAndWait(page, tid(page, "permit-new-link"), /\/ops\/permits\/new$/);
    await expect(tid(page, "permit-form")).toBeVisible();
    await expect(tid(page, "permit-declaration-text")).toBeVisible();
    await expectNoHorizontalScroll(page, "許可・承認の登録フォーム");
    // 必須の項目が空：項目ごとのエラー
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await tid(page, "permit-submit").click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/ops\/permits\/new$/);
    // 個別許可は全国を選べない（円に切り替わる）
    await tid(page, "permit-coverage").selectOption("individual");
    await expect(tid(page, "permit-place-nationwide")).toBeDisabled();
    await expect(tid(page, "permit-circles")).toBeVisible();
    await tid(page, "permit-coverage").selectOption("blanket");
    // 文章のみを選ぶと、照合できない旨が出る
    await tid(page, "permit-place-text").check();
    await expect(tid(page, "permit-text-note")).toContainText("照合できないため、判定には適用しません");
    await tid(page, "permit-place-nationwide").check();
    // 機体・操縦者を限定しない：許可書で確認の旨
    await expect(tid(page, "permit-aircraft-scope")).toContainText("許可書で確認してください");
    await tid(page, "permit-number").fill(number);
    await tid(page, "permit-kind-night").check();
    await tid(page, "permit-issued-on").fill("2026-10-01");
    await tid(page, "permit-valid-from").fill("2026-10-01");
    await tid(page, "permit-valid-to").fill("2027-09-30");
    await tid(page, "permit-submit").click();
    await page.waitForURL(/\/ops\/permits\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await afterFlash(page, "許可・承認を登録しました");
    await expect(tid(page, "permit-detail-number")).toHaveText(number);
    await expect(tid(page, "permit-version-row")).toHaveCount(1);
    await expect(tid(page, "permit-validity")).toHaveAttribute("data-validity", "valid");
    await expectNoHorizontalScroll(page, "許可・承認の詳細");

    // 同じ番号（表記の違いを無視）は 409（API）
    const manager = await apiAs(seeded("a-manager"));
    const dup = await manager.post("/api/ops/permits", { data: regBody(number.toLowerCase()) });
    expect(dup.status()).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe("duplicate_number");

    // 訂正：理由なしは拒否。影響の旨が画面に出る。理由つきで版 2
    await expect(tid(page, "permit-affects-note")).toContainText("判定が古い");
    await tid(page, "permit-valid-to").fill("2027-08-31");
    await tid(page, "permit-submit").click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(tid(page, "permit-version-row")).toHaveCount(1);
    await tid(page, "permit-reason").fill("期間の誤りを直した");
    await tid(page, "permit-submit").click();
    await afterFlash(page, "版 2 として訂正しました");
    await expect(tid(page, "permit-version-row")).toHaveCount(2);
    await expect(tid(page, "permit-version-row").nth(1).getByTestId("permit-version-changed")).toContainText("許可期間（至）");
    await expect(tid(page, "permit-version-row").nth(1)).toContainText("期間の誤りを直した");
    await expect(tid(page, "permit-detail-period")).toContainText("2026-10-01 〜 2027-08-31");
    // 訂正前の値は履歴に残る（版 1）
    await expect(tid(page, "permit-version-row").nth(0).getByTestId("permit-version-content")).toContainText("2026-10-01 〜 2027-09-30");

    // 失効：失効日と理由が必須
    await tid(page, "permit-revoke-submit").click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await tid(page, "permit-revoked-on").fill("2027-01-10");
    await tid(page, "permit-revoke-reason").fill("返納した");
    await tid(page, "permit-revoke-submit").click();
    await afterFlash(page, "失効を記録しました");
    await expect(tid(page, "permit-validity")).toHaveAttribute("data-validity", "revoked");
    await expect(tid(page, "permit-version-row")).toHaveCount(3);
    await expect(tid(page, "permit-version-row").nth(2).getByTestId("permit-version-op")).toHaveText("失効");
    // 失効した登録は訂正できない（画面に訂正の欄がない／API は 409）
    await expect(tid(page, "permit-form")).toHaveCount(0);
    const detail = (await (await manager.get(`/api/ops/permits/${id}`)).json()) as { version: number };
    const again = await manager.patch(`/api/ops/permits/${id}`, { data: { expectedVersion: detail.version, reason: "x", validTo: "2027-08-30" } });
    expect(again.status()).toBe(409);
    const twice = await manager.post(`/api/ops/permits/${id}/revoke`, { data: { expectedVersion: detail.version, revokedOn: "2027-01-11", reason: "二重" } });
    expect(twice.status()).toBe(409);

    // 取消（誤登録）：理由必須。取消後も詳細と版の履歴は残り、番号は再登録できる
    await tid(page, "permit-void-submit").click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await tid(page, "permit-void-reason").fill("誤登録だった");
    await tid(page, "permit-void-submit").click();
    await afterFlash(page, "取り消しました");
    await expect(tid(page, "permit-version-row")).toHaveCount(4);
    await expect(tid(page, "permit-version-row").nth(3).getByTestId("permit-version-op")).toHaveText("取消");
    await expect(tid(page, "permit-validity")).toHaveAttribute("data-validity", "voided");
    await expect(tid(page, "permit-validity")).toHaveText("× 取消");
    await page.goto("/ops/permits");
    await expect(page.locator(`a[href="/ops/permits/${id}"]`)).toHaveCount(0);
    await page.goto("/ops/permits?includeVoided=1");
    await expect(page.locator(`a[href="/ops/permits/${id}"]`)).toHaveCount(1);
    const reuse = await manager.post("/api/ops/permits", { data: regBody(number) });
    expect(reuse.status(), await reuse.text()).toBe(201);
    await expectNoForbiddenWords(page, "許可・承認の一覧（取消を含む）");
    await manager.dispose();
  });

  test("12-3. 操縦者・閲覧者は閲覧だけ（登録の入口・訂正・失効・取消がなく、API は 403）。他の組織の登録は 404。「この登録を根拠にしている計画」が出る", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const permit = await createPermit(manager, uniqueNumber("VIEW"));
    const aircraft = await createAircraft(manager);
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const plan = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: permit.permitNumber }));
    await fixClock(page, "12:00:10");

    for (const key of ["a-pilot", "a-viewer"]) {
      const ctx = await apiAs(seeded(key));
      expect((await ctx.post("/api/ops/permits", { data: regBody(uniqueNumber("DENY")) })).status(), key).toBe(403);
      expect((await ctx.patch(`/api/ops/permits/${permit.id}`, { data: { expectedVersion: 1, reason: "x" } })).status(), key).toBe(403);
      expect((await ctx.post(`/api/ops/permits/${permit.id}/revoke`, { data: { expectedVersion: 1, revokedOn: "2027-01-10", reason: "x" } })).status(), key).toBe(403);
      expect((await ctx.post(`/api/ops/permits/${permit.id}/void`, { data: { expectedVersion: 1, reason: "x" } })).status(), key).toBe(403);
      expect((await ctx.get("/api/ops/permits")).status(), key).toBe(200);
      expect((await ctx.get(`/api/ops/permits/${permit.id}/versions`)).status(), key).toBe(200);
      await ctx.dispose();
    }
    const other = await apiAs(seeded("b-manager"));
    expect((await other.get(`/api/ops/permits/${permit.id}`)).status()).toBe(404);
    expect((await other.get(`/api/ops/permits/${permit.id}/versions`)).status()).toBe(404);
    expect((await other.get(`/api/ops/plans/${plan.id}/permits`)).status()).toBe(404);
    await other.dispose();

    for (const key of ["a-pilot", "a-viewer"]) {
      await signIn(page.request, seeded(key));
      await page.goto("/ops/permits");
      await expect(tid(page, "permit-list")).toBeVisible();
      await expect(tid(page, "permit-new-link")).toHaveCount(0);
      await page.goto("/ops/permits/new");
      await expect(page.getByRole("heading", { name: "権限がありません" })).toBeVisible();
      await page.goto(`/ops/permits/${permit.id}`);
      await expect(tid(page, "permit-detail")).toBeVisible();
      await expect(tid(page, "permit-form")).toHaveCount(0);
      await expect(tid(page, "permit-revoke-form")).toHaveCount(0);
      await expect(tid(page, "permit-void-form")).toHaveCount(0);
      // この登録を根拠にしている計画（件数と一覧）
      await expect(tid(page, "permit-basis-count")).toHaveText("1 件");
      await expect(tid(page, "permit-basis-plan")).toHaveCount(1);
    }
    await manager.dispose();
  });
});

test.describe("Sprint 12d E2E-DB：計画の照合（契約 13）", () => {
  test("13-1. 登録した許可の番号を計画に入れると、範囲に収まる種類だけが判定に使われ、エンジンの「照合していません」が登録の文に置き換わる。番号なし・未登録は要手続きのまま", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const withNumber = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: SEED.blanket }));
    const withoutNumber = await createPlan(manager, planBody(aircraft.id, pilotId));
    const unknown = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: "NO-SUCH-NUMBER-9" }));

    const a = await getPlanPermits(manager, withNumber.id);
    expect(a.permits.numbers[0]).toMatchObject({ numberText: SEED.blanket, status: "applied" });
    expect(a.permits.grantedValues).toContain("mlit:night");
    expect((await getPlanPermits(manager, withoutNumber.id)).permits.grantedValues).toEqual([]);
    expect((await getPlanPermits(manager, unknown.id)).permits.numbers[0]).toMatchObject({ status: "unregistered" });

    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    // 適用：項目の判定は「手続き済み（条件付き）」。エンジンの注記は登録の文に置き換わる
    await gotoPlanOpen(page, `/ops/plans/${withNumber.id}/judgement`);
    const sec = tid(page, "plan-permit-list");
    await expect(sec).toBeVisible();
    await expect(planRow(page, SEED.blanket)).toHaveAttribute("data-status", "applied");
    await expect(planRow(page, SEED.blanket).getByTestId("plan-permit-status")).toHaveText("● 適用");
    await expect(planRow(page, SEED.blanket).getByTestId("plan-permit-version")).toHaveText("版 1");
    await expect(planRow(page, SEED.blanket).getByTestId("plan-permit-conditions")).toContainText("飛行マニュアルに従う");
    await expect(itemVerdict(page, "method_night")).toHaveAttribute("data-verdict", "procedure_done");
    const done = page.locator('[data-testid="verdict-done-item"][data-item-id="method_night"]');
    await expect(done).toBeVisible();
    await expect(done.getByTestId("verdict-done-condition").filter({ hasText: `登録した許可（${SEED.blanket}）の範囲と期間に収まっています` })).toHaveCount(1);
    await expect(done).toContainText("許可書で確認してください");
    await expect(done).not.toContainText("範囲と有効期間は照合していません");
    await expect(tid(page, "plan-permit-format-note")).toContainText("※要確認");
    await expect(tid(page, "plan-permit-applied-note")).toContainText("利用者本人が DIPS 2.0 などの公式の手続きで取得します");
    await expect(tid(page, "plan-permit-applied-note")).not.toContainText("申請済み");
    await expectNoHorizontalScroll(page, "計画の詳細（許可・承認の照合）");
    await onAllPlanScreens(page, withNumber.id, (l) => expectNoForbiddenWords(page, `計画の詳細（適用）${l}`));

    // 番号なし・未登録：要手続きのまま
    await gotoPlanOpen(page, `/ops/plans/${withoutNumber.id}/judgement`);
    await expect(itemVerdict(page, "method_night")).toHaveAttribute("data-verdict", "needs_procedure");
    await expect(tid(page, "plan-permit-empty")).toBeVisible();
    await gotoPlanOpen(page, `/ops/plans/${unknown.id}/judgement`);
    await expect(planRow(page, "NO-SUCH-NUMBER-9")).toHaveAttribute("data-status", "unregistered");
    await expect(planRow(page, "NO-SUCH-NUMBER-9").getByTestId("plan-permit-status")).toContainText("未登録");
    await expect(itemVerdict(page, "method_night")).toHaveAttribute("data-verdict", "needs_procedure");
    await manager.dispose();
  });

  test("13-2. 範囲外・期限切れ・失効・文章のみ・機体の限定・空港等周辺（参考）・手入力の DIPS の許可：すべて要手続きのままで、理由が出る", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const cases: { label: string; number: string; extra: Record<string, unknown>; status: string; reason?: string }[] = [
      { label: "expired", number: SEED.expired, extra: { flags: ["method_night"] }, status: "not_applied", reason: "expired" },
      { label: "revoked", number: SEED.revoked, extra: { flags: ["method_night"] }, status: "not_applied", reason: "revoked" },
      { label: "text", number: SEED.textOnly, extra: { flags: ["method_night", "airspace_150m"], maxAltitudeM: 150 }, status: "not_applied", reason: "place_not_checkable" },
    ];
    const plans: Record<string, PlanJson> = {};
    for (const c of cases) plans[c.label] = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: c.number, ...c.extra }));
    // 個別の許可（円・機体を限定）は、別の機体・計画の半径が未入力だと適用しない
    plans["indiv"] = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: SEED.individual, flags: ["method_bvlos"], bvlosWithObserver: true }));
    // 空港等周辺の個別許可は、範囲に収まっても参考だけ（判定の段は変えない）
    plans["airport"] = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: SEED.airport, flags: ["method_night"], radiusM: 100 }));

    for (const c of cases) {
      const p = await getPlanPermits(manager, plans[c.label]!.id);
      expect(p.permits.numbers[0]!.status, c.label).toBe(c.status);
      expect(p.permits.numbers[0]!.reasons.map((r) => r.code), c.label).toContain(c.reason);
      expect(p.permits.grantedValues, c.label).toEqual([]);
    }
    const indiv = await getPlanPermits(manager, plans["indiv"]!.id);
    expect(indiv.permits.numbers[0]!.status).toBe("not_applied");
    expect(indiv.permits.numbers[0]!.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["aircraft_out_of_scope", "place_extent_unknown"]));
    const airport = await getPlanPermits(manager, plans["airport"]!.id);
    expect(airport.permits.numbers[0]!.status).toBe("reference");
    expect(airport.permits.grantedValues).toEqual([]);

    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    for (const c of cases) {
      await gotoPlanOpen(page, `/ops/plans/${plans[c.label]!.id}/judgement`);
      await expect(planRow(page, c.number)).toHaveAttribute("data-status", "not_applied");
      await expect(planRow(page, c.number).getByTestId("plan-permit-status")).toHaveText("× 適用しない");
      await expect(planRow(page, c.number).locator(`[data-reason="${c.reason}"]`)).toBeVisible();
      await expect(itemVerdict(page, "method_night")).toHaveAttribute("data-verdict", "needs_procedure");
      await expect(page.locator('[data-testid="verdict-done-item"]')).toHaveCount(0);
      await onAllPlanScreens(page, plans[c.label]!.id, (l) => expectNoForbiddenWords(page, `計画（${c.label}）${l}`));
    }
    await gotoPlanOpen(page, `/ops/plans/${plans["indiv"]!.id}/judgement`);
    await expect(planRow(page, SEED.individual).locator('[data-reason="aircraft_out_of_scope"]')).toBeVisible();
    await expect(planRow(page, SEED.individual).locator('[data-reason="place_extent_unknown"]')).toBeVisible();
    await expect(itemVerdict(page, "method_bvlos")).toHaveAttribute("data-verdict", "needs_procedure");

    // 空港等周辺の個別許可：参考の表示と根拠まで。判定の段は変えない
    await gotoPlanOpen(page, `/ops/plans/${plans["airport"]!.id}/judgement`);
    await expect(planRow(page, SEED.airport)).toHaveAttribute("data-status", "reference");
    await expect(planRow(page, SEED.airport).getByTestId("plan-permit-status")).toContainText("◇ 参考");
    await expect(itemVerdict(page, "method_night")).toHaveAttribute("data-verdict", "needs_procedure");
    await expect(tid(page, "plan-permit-list")).not.toContainText("手続き済み");

    // 手入力の DIPS の許可は受け付けない（API は 400）
    const bad = await manager.post("/api/ops/plans", { data: planBody(aircraft.id, pilotId, { pilotPermits: ["mlit:night"] }) });
    expect(bad.status()).toBe(400);
    const badJson = (await bad.json()) as { fields?: Record<string, string> };
    expect(badJson.fields?.["pilotPermits"]).toContain("許可・承認は登録から照合します");
    await manager.dispose();
  });

  test("13-3. 許可があっても、緊急用務空域は飛行不可のまま（結論は判定の部品のまま）。文言は「飛べる」と読めない", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const plan = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: SEED.blanket, flags: ["method_night", "airspace_emergency"] }));
    expect((await getPlanPermits(manager, plan.id)).permits.numbers[0]!.status).toBe("applied");
    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);
    await expect(tid(page, "verdict-no-fly")).toBeVisible();
    await expect(page.locator('[data-testid="verdict-no-fly-item"][data-item-id="airspace_emergency"]')).toBeVisible();
    await expect(tid(page, "verdict-level")).toHaveText(/飛行不可/);
    await onAllPlanScreens(page, plan.id, (l) => expectNoForbiddenWords(page, `計画（緊急用務空域）${l}`));
    await manager.dispose();
  });

  test("13-4. 計画のフォーム：DIPS の許可・承認のチェックがなく、案内が出る。番号の登録の有無が入力中に分かり、候補の「番号を入れる」で欄に足せる。保存すると判定が変わる", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const permit = await createPermit(manager, uniqueNumber("FORM"));
    const plan = await createPlan(manager, planBody(aircraft.id, pilotId, { pilotPermits: ["park_manager"] }));
    expect((await getPlanPermits(manager, plan.id)).candidates.map((c) => c.permitNumber)).toContain(permit.permitNumber);

    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    // 新規：DIPS のチェックはない。同意・通報・公園・文化庁は残る
    await page.goto("/ops/plans/new");
    await expect(tid(page, "plan-form")).toBeVisible();
    await expect(tid(page, "plan-permit-registry-note")).toContainText("登録から照合します");
    await expect(page.locator('[data-testid^="plan-permit-mlit"]')).toHaveCount(0);
    await expect(tid(page, "plan-permit-park_manager")).toBeVisible();
    await expect(tid(page, "plan-permit-facility_manager")).toBeVisible();
    // 入力中：登録のない番号は警告、登録のある番号は「登録があります」
    await tid(page, "plan-permit-numbers").fill("NOT-REGISTERED-1");
    await expect(tid(page, "plan-permit-unregistered")).toContainText("登録にありません。判定には使いません。");
    await tid(page, "plan-permit-numbers").fill(SEED.blanket);
    await expect(tid(page, "plan-permit-input-state")).toHaveAttribute("data-registered", "true");
    await expectNoHorizontalScroll(page, "計画の入力（許可番号）");

    // 訂正：範囲に収まる登録が候補に出て、「番号を入れる」で欄に足せる（保存するまで判定には使わない）
    await page.goto(`/ops/plans/${plan.id}/edit`);
    const candidate = page.locator(`[data-testid="plan-permit-candidate"]:has-text("${permit.permitNumber}")`);
    await expect(candidate).toBeVisible();
    await candidate.getByTestId("plan-permit-insert").click();
    await expect(tid(page, "plan-permit-numbers")).toHaveValue(permit.permitNumber);
    await expect(candidate).toHaveCount(0);
    await tid(page, "plan-reason").fill("許可の番号を入れた");
    await tid(page, "plan-submit").click();
    await page.waitForURL(new RegExp(`/ops/plans/${plan.id}$`));
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);
    await expect(planRow(page, permit.permitNumber)).toHaveAttribute("data-status", "applied");
    await expect(itemVerdict(page, "method_night")).toHaveAttribute("data-verdict", "procedure_done");
    // 同意・通報などの手入力は従来どおり残る
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/overview`);
    await expect(tid(page, "plan-overview")).toContainText("公園管理者");
    expect((await getPlanPermits(manager, plan.id)).permits.grantedValues).toContain("mlit:night");
    await manager.dispose();
  });
});

test.describe("Sprint 12d E2E-DB：根拠の辿りと鮮度（契約 14）", () => {
  test("14. 日誌から 4 タップ以内で、判定の根拠 → 許可の登録の版へ辿れる。登録を訂正すると「判定が古い」→ 再判定で新しい版を根拠にし、古いスナップショットは当時の版を指す", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const permit = await createPermit(manager, uniqueNumber("TRACE"));
    const plan = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: permit.permitNumber }));
    // 他の試験の飛行記録（同じ操縦者）と時間帯が重ならないよう、早朝の乱数の時刻にする
    const minute = 60 + Math.floor(Math.random() * 280);
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const flightRes = await manager.post("/api/ops/flights", {
      data: { aircraftId: aircraft.id, pilotId, flightPlanId: plan.id, purpose: "空撮", takeoffPlace: "試験地点", landingPlace: "試験地点", safetyIssue: false, takeoffAt: `${DAY}T${hm(minute)}`, landingAt: `${DAY}T${hm(minute + 10)}` },
    });
    expect(flightRes.status(), await flightRes.text()).toBe(201);
    const flight = (await flightRes.json()) as { id: string };

    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    // 日誌（0）→ 飛行記録（1）→ 判定の根拠（2）→ 許可の登録の版（3）
    await page.goto("/ops/journal");
    let taps = 0;
    const flightRow = page.locator(`[data-testid="journal-row"][data-kind="flight"] a[href="/ops/flights/${flight.id}"]`).first();
    await tapAndWait(page, flightRow, new RegExp(`/ops/flights/${flight.id}$`));
    taps++;
    const basisLink = page.locator(`a[href^="/ops/plans/${plan.id}/snapshots/"]`).first();
    await tapAndWait(page, basisLink, new RegExp(`/ops/plans/${plan.id}/snapshots/[0-9a-f-]{36}$`));
    taps++;
    const snap1 = page.url();
    const row = tid(page, "basis-permit");
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("basis-permit-number")).toHaveText(permit.permitNumber);
    await expect(row.getByTestId("basis-permit-version")).toHaveText("版 1");
    await expect(row.getByTestId("basis-permit-hash")).toContainText("✓ 版のハッシュが一致します");
    await expect(row.getByTestId("basis-permit-applied")).toHaveText("● 適用");
    await expect(row.getByTestId("basis-permit-period")).toContainText("2026-10-01 〜 2027-09-30");
    await tapAndWait(page, row.getByTestId("basis-permit-link"), new RegExp(`/ops/permits/${permit.id}\\?version=1`));
    taps++;
    expect(taps).toBeLessThanOrEqual(4);
    await expect(page.locator('[data-testid="permit-version-row"][data-version="1"]')).toHaveAttribute("data-highlight", "true");
    await expect(tid(page, "permit-version-highlight")).toContainText("判定の根拠にした版");
    await expectNoHorizontalScroll(page, "登録の版（根拠から）");

    // 登録を訂正 → 計画は「判定が古い」（permits_changed）
    const upd = await manager.patch(`/api/ops/permits/${permit.id}`, { data: { expectedVersion: 1, reason: "期間を短縮", validTo: "2027-06-30" } });
    expect(upd.status(), await upd.text()).toBe(200);
    expect(((await upd.json()) as { affectsPlans: { count: number; note: string | null } }).affectsPlans.count).toBe(1);
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);
    await expect(tid(page, "plan-stale-box")).toBeVisible();
    await expect(tid(page, "plan-stale-reasons")).toContainText("許可・承認の登録");
    await expect(tid(page, "plan-permit-stale")).toBeVisible();
    // 古い判定のうちは、登録の文への置き換えを出さない（保存した判定の根拠と今の登録が一致しないため）
    await expect(page.locator('[data-testid="verdict-done-condition"][data-permit-registry="true"]')).toHaveCount(0);
    // Sprint 17-1：次にやること（通報の主画面）と、再判定のボタン（判定の画面）に分かれた
    await gotoPlanOpen(page, `/ops/plans/${plan.id}`);
    await expect(tid(page, "next-actions")).toContainText("判定をやり直す");
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);

    // 再判定 → 新しいスナップショットが版 2 を根拠にする。古いスナップショットは版 1 を指したまま
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await tid(page, "plan-rejudge").click();
    await expect(tid(page, "plan-stale-box")).toHaveCount(0);
    await openPlanFolds(page); // 再判定の後の再読み込みで、判定の記録の折りたたみは閉じる
    await expect(tid(page, "plan-snapshot-seq")).toHaveText("2");
    await page.goto(`/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`);
    await expect(tid(page, "basis-permit-version")).toHaveText("版 1");
    await expect(tid(page, "basis-permit-hash")).toContainText("✓ 版のハッシュが一致します");
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);
    await tapAndWait(page, tid(page, "plan-basis-link"), new RegExp(`/ops/plans/${plan.id}/snapshots/[0-9a-f-]{36}$`));
    expect(page.url()).not.toBe(snap1);
    await expect(tid(page, "basis-permit-version")).toHaveText("版 2");
    await expect(tid(page, "basis-permit-period")).toContainText("2026-10-01 〜 2027-06-30");
    // 版 1 は履歴に残り、当時の内容（期間）を読める
    await page.goto(`/ops/permits/${permit.id}?version=1#v1`);
    await expect(page.locator('[data-testid="permit-version-row"][data-version="1"]').getByTestId("permit-version-content")).toContainText("2026-10-01 〜 2027-09-30");
    await expect(page.locator('[data-testid="permit-version-row"][data-version="2"]').getByTestId("permit-version-content")).toContainText("2026-10-01 〜 2027-06-30");
    await expectNoForbiddenWords(page, "登録の版");
    await manager.dispose();
  });
});

test.describe("Sprint 12d E2E-DB：12b との関係と次にやること（契約 15）", () => {
  test("15. 申請の記録に依存せず、登録がなければ「取得した許可・承認を登録する」が出て（運航管理者のみ操作）、番号を入れて判定が手続き済みになると消える（Sprint 18-2）", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const permit = await createPermit(manager, uniqueNumber("NEXT"));
    // 夜間飛行（許可・承認の手続きが残る地点）。許可番号は入れない。申請の記録（dips_permit）は作らない（作れない）
    const plan = await createPlan(manager, planBody(aircraft.id, pilotId, { latitude: NIGHT_SPOT.lat, longitude: NIGHT_SPOT.lng }));
    const rec = await manager.post(`/api/ops/plans/${plan.id}/procedure-records`, {
      data: { kind: "dips_permit", action: "done", doneAt: `${DAY}T09:00`, checks: { applicationCompleted: true }, reference: "APPLY-12D" },
    });
    expect(rec.status(), await rec.text()).toBe(409);
    expect(((await rec.json()) as { error: string }).error).toBe("procedure_kind_disabled");

    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);
    // 判定は要手続きのまま。「許可・承認を申請する」は出ず、「取得した許可・承認を登録する」が出る
    await expect(itemVerdict(page, "method_night")).toHaveAttribute("data-verdict", "needs_procedure");
    await gotoPlanOpen(page, `/ops/plans/${plan.id}`);
    await expect(page.locator('[data-testid="next-action"][data-action-id="apply_permit"]')).toHaveCount(0);
    const action = page.locator('[data-testid="next-action"][data-action-id="register_permit"]');
    await expect(action).toHaveCount(1);
    await expect(action).toContainText("取得した許可・承認を登録する");
    await expect(action.getByTestId("next-action-due")).toHaveCount(0);
    await tapAndWait(page, action.getByTestId("next-action-link"), /\/ops\/permits\/new$/);
    await expect(tid(page, "permit-form")).toBeVisible();

    // 操縦者（計画の本人）は押せず、運航管理者に依頼する旨が出る
    await signIn(page.request, seeded("a-pilot"));
    await gotoPlanOpen(page, `/ops/plans/${plan.id}`);
    const pilotAction = page.locator('[data-testid="next-action"][data-action-id="register_permit"]');
    await expect(pilotAction).toHaveCount(1);
    await expect(pilotAction.getByTestId("next-action-cannot")).toContainText("運航管理者に依頼してください");
    await expect(pilotAction.locator("a")).toHaveCount(0);

    // 番号を入れて保存すると、判定が手続き済み（条件付き）になり、次にやることは消える
    const upd = await manager.patch(`/api/ops/plans/${plan.id}`, { data: { expectedVersion: plan.version, reason: "許可が下りたので番号を入れた", permitNumbers: permit.permitNumber } });
    expect(upd.status(), await upd.text()).toBe(200);
    await signIn(page.request, seeded("a-manager"));
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/judgement`);
    await expect(planRow(page, permit.permitNumber)).toHaveAttribute("data-status", "applied");
    await expect(itemVerdict(page, "method_night")).toHaveAttribute("data-verdict", "procedure_done");
    await gotoPlanOpen(page, `/ops/plans/${plan.id}`);
    await expect(page.locator('[data-testid="next-action"][data-action-id="register_permit"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="next-action"][data-action-id="apply_permit"]')).toHaveCount(0);
    await gotoPlanOpen(page, `/ops/plans/${plan.id}/overview`);
    // 申請の記録は無い（フォーム・以前の記録のどちらも出ない）
    await expect(tid(page, "procedure-dips_permit")).toHaveCount(0);
    await expect(tid(page, "procedure-form-dips_permit")).toHaveCount(0);
    await onAllPlanScreens(page, plan.id, (l) => expectNoForbiddenWords(page, `計画（登録後）${l}`));
    await manager.dispose();
  });
});

test.describe("Sprint 12d E2E-DB：通報内容と現場モード（契約 16）", () => {
  test("16. 結びついた登録があれば通報内容に許可書発行日・許可期間が出る（形式は※要確認）。なければ「DIPS で入力」。現場モードの携行品に番号ごとの状態が出る", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const pilotId = await pilotIdOf(seeded("a-pilot"));
    const permit = await createPermit(manager, uniqueNumber("REP"), { issuedOn: "2026-10-02", validFrom: "2026-10-03", validTo: "2027-09-29" });
    const bound = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: permit.permitNumber }));
    const unbound = await createPlan(manager, planBody(aircraft.id, pilotId, { permitNumbers: "NOT-A-REGISTERED-NUMBER" }));

    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    await page.goto(`/ops/plans/${bound.id}/report`);
    await expect(tid(page, "report-item-permit_date")).toBeVisible();
    await expect(tid(page, "report-item-value-permit_date")).toHaveText("2026-10-02");
    await expect(tid(page, "report-item-value-permit_start")).toHaveText("2026-10-03");
    await expect(tid(page, "report-item-value-permit_finish")).toHaveText("2027-09-29");
    await expect(tid(page, "report-item-warnings-permit_date")).toContainText("※要確認");
    await expect(tid(page, "report-item-value-permit_number")).toHaveText(permit.permitNumber);
    await expectNoForbiddenWords(page, "通報内容（登録あり）");
    // 結びつく登録がない計画は、従来どおり DIPS で入力する
    await page.goto(`/ops/plans/${unbound.id}/report`);
    await expect(tid(page, "report-item-value-permit_date")).toContainText("そらばんは保持しません");
    await expect(tid(page, "report-item-value-permit_start")).toContainText("そらばんは保持しません");

    // 現場モードの携行品：番号ごとの状態（既存の data-testid は変えない）
    await page.goto(`/ops/plans/${bound.id}/field`);
    await expect(tid(page, "field-root")).toBeVisible();
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(tid(page, "field-permits")).toContainText(permit.permitNumber);
    await expect(tid(page, "field-permit-state")).toHaveAttribute("data-status", "applied");
    await expect(tid(page, "field-permit-state")).toContainText("● 適用");
    await page.goto(`/ops/plans/${unbound.id}/field`);
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await expect(tid(page, "field-permit-state")).toHaveAttribute("data-status", "unregistered");
    await expect(tid(page, "field-permit-state")).toContainText("未登録");
    await manager.dispose();
  });
});
