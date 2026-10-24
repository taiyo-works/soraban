import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { expandNextActions, openUserMenu } from "../ops-menu";
import { collectTextSamples, expectContrast, expectFontSize, expectNoHorizontalScroll, expectTapTargets } from "../field-checks";
import {
  eventTypeOptions,
  INCIDENT_CHANGED_SINCE_REPORT,
  INCIDENT_EVENT_TYPE_NOTICE,
  INCIDENT_FACT_NOTICE,
  INCIDENT_GUIDANCE_REVISION_1,
  INCIDENT_KIND_NOTICE,
  INCIDENT_OFFICIAL_PROCEDURE_NOTICE,
  INCIDENT_PERSONAL_INFO_NOTICE,
  INCIDENT_QUICK_LATER_NOTICE,
  INCIDENT_QUICK_SAVED_MESSAGE,
  INCIDENT_REPORT_RECORD_NOTICE,
  INCIDENT_SAFETY_FIRST_LINES,
  incidentGuidanceNote,
} from "../../apps/web/src/lib/ops-incident";
import { INCIDENT_FORBIDDEN, NUMERIC_DEADLINE } from "../../apps/web/src/lib/incident-words.test-helpers";

// Sprint 12e の E2E-DB（契約 9〜13・15 の画面・通しの部分）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1・逆ジオコーダの模擬サーバーを与えた next start に対して実行する。
// サーバーの時計は OPS_TEST_NOW で JST 2027-01-05 12:00 に固定している（日数の経過は、起きた日時を過去にした記録で確かめる）。
// ブラウザの時計は page.clock で合わせる。画面は幅 375px のタッチ端末で確かめる。圏外は context.setOffline(true)。
// そらばんは国・DIPS へ何も送らない（報告の記録は利用者の申告）。
// テスト用の初期データ（組織A）：事故・ヒヤリハットの記録 7 件（OPS_TEST_INCIDENTS）。組織A の「今日」には初期データの
// 報告の要否の確認（tier 1）が上位に出るため、「今日」の出入りは組織B で確かめる。共有の初期データは変えない（訂正・報告の記録・
// 取消はテストごとに作った記録で行う）。
// 過去の教訓：waitForResponse を goto の後に登録しない（このファイルは応答の待ち受けを使わず、画面の結果を待つ）。

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

const DAY = "2027-01-05";
const HQ = { lat: 35.434238, lng: 133.380508 };
const SOURCE_TEXT = "2026-10-22 原本照合";
const POSSIBLE_HEAD = "報告は、DIPS 2.0 の『事故等の報告』から、操縦者が速やかに行います（そらばんは送信しません）";
const ASSERTIVE = ["報告不要", "報告対象外", "報告が必要です", "報告義務があります"];

let seq = 0;
const stamp = Date.now().toString(36).toUpperCase();
const uniqueMark = () => `JUS12E${stamp}${seq++}`;
const at = (hms: string) => new Date(`${DAY}T${hms}+09:00`);
const fixClock = (page: Page, hms: string) => page.clock.setFixedTime(at(hms));

const createAircraft = async (manager: APIRequestContext): Promise<{ id: string; registrationMark: string }> => {
  const registrationMark = uniqueMark();
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "事故試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { ...((await r.json()) as { id: string }), registrationMark };
};

const meOf = async (who: Who): Promise<{ memberId: string; pilotId: string | null }> => {
  const ctx = await apiAs(who);
  const me = (await (await ctx.get("/api/ops/me")).json()) as { pilotId: string | null; member: { id: string } };
  await ctx.dispose();
  return { memberId: me.member.id, pilotId: me.pilotId };
};

type PlanJson = { id: string; version: number; title: string; currentSnapshotId: string };
const planBody = (aircraftId: string, pilotId: string, extra: Record<string, unknown> = {}) => ({
  title: `事故 ${stamp}-${seq++}`,
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
const createPlan = async (ctx: APIRequestContext, body: object): Promise<PlanJson> => {
  const r = await ctx.post("/api/ops/plans", { data: body });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as PlanJson;
};
const voidPlan = async (manager: APIRequestContext, planId: string): Promise<void> => {
  const plan = (await (await manager.get(`/api/ops/plans/${planId}`)).json()) as { version: number; voided: boolean };
  if (!plan.voided) await manager.post(`/api/ops/plans/${planId}/void`, { data: { expectedVersion: plan.version, reason: "試験の後始末" } });
};

type IncidentJson = {
  id: string;
  version: number;
  kind: string;
  detailPending: boolean;
  source: string;
  guidance: { level: string };
  reportState: { code: string; changedSinceReport: boolean };
  voided: boolean;
  planId: string | null;
  snapshotId: string | null;
};
const fullBody = (extra: Record<string, unknown> = {}) => ({
  mode: "full",
  kind: "near_miss",
  occurredAt: `${DAY}T11:00`,
  summary: `E2E 12e ${stamp}-${seq++}`,
  eventTypes: ["near_collision"],
  peopleInjury: "no",
  aircraftDamage: "no",
  ...extra,
});
const createIncident = async (ctx: APIRequestContext, body: Record<string, unknown>): Promise<IncidentJson> => {
  const r = await ctx.post("/api/ops/incidents", { data: body });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as IncidentJson;
};
const getIncident = async (ctx: APIRequestContext, id: string): Promise<IncidentJson> => {
  const r = await ctx.get(`/api/ops/incidents/${id}`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as IncidentJson;
};
const voidIncident = async (manager: APIRequestContext, id: string): Promise<void> => {
  const d = await getIncident(manager, id);
  if (!d.voided) await manager.post(`/api/ops/incidents/${id}/void`, { data: { expectedVersion: d.version, reason: "試験の後始末" } });
};
const listForPlan = async (ctx: APIRequestContext, planId: string): Promise<IncidentJson[]> => {
  const r = await ctx.get(`/api/ops/incidents?planId=${planId}&includeVoided=1`);
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { incidents: IncidentJson[] }).incidents;
};

/** リンクを押して、遷移（URL の変化）まで確かめる（12a〜12d と同じ作法）。応答の待ち受けは作らない。 */
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
  for (const w of INCIDENT_FORBIDDEN) expect(text, `${label}: 「${w}」が出ている`).not.toContain(w);
  expect(text, `${label}: 数値の期限`).not.toMatch(NUMERIC_DEADLINE);
  expect(text, `${label}: ※要確認（版 1 は原本照合済み）`).not.toContain("※要確認");
};
const expectNoForbiddenInJson = (json: string, label: string) => {
  for (const w of [...INCIDENT_FORBIDDEN, ...ASSERTIVE]) expect(json, `${label}: 「${w}」`).not.toContain(w);
  expect(json, label).not.toMatch(NUMERIC_DEADLINE);
};

const watchDialogs = (page: Page): string[] => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  return dialogs;
};

/** a が b より DOM の前にある。 */
const isBefore = async (a: Locator, b: Locator): Promise<boolean> => {
  const ha = await a.elementHandle();
  const hb = await b.elementHandle();
  return ha!.evaluate((x, y) => Boolean(x.compareDocumentPosition(y as Node) & Node.DOCUMENT_POSITION_FOLLOWING), hb);
};

const openQuick = async (page: Page, planId: string): Promise<void> => {
  await page.goto(`/ops/plans/${planId}/field/incident`);
  await expect(page.locator('[data-testid="incident-quick-root"][data-hydrated="true"]')).toBeVisible();
};

const expectSafetyFirst = async (page: Page, label: string) => {
  const lines = tid(page, "incident-safety-first-line");
  await expect(lines, label).toHaveText([...INCIDENT_SAFETY_FIRST_LINES]);
  const first = (await lines.first().innerText()).trim();
  expect(first.startsWith("まず、飛行を中止し（速やかに着陸させ）、けがをした人の救護と危険の防止を最優先にしてください。"), label).toBe(true);
  expect(first).toContain("119 番（救急・消防）");
  expect(first).toContain("110 番（警察）");
};

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, timezoneId: "America/Los_Angeles" });

test.describe("Sprint 12e E2E-DB：事故・ヒヤリハット", () => {
  test("9. 安全の案内と固定の注意書き：G1 が入力欄より前（画面の上でも DOM の順でも）。N1〜N7 が定数どおり設計 A の場所に出る。各類型の説明文が選択肢の下に出る", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");

    // 一覧：N1・N2
    await page.goto("/ops/incidents");
    await expect(tid(page, "incident-list-page")).toBeVisible();
    await expect(tid(page, "incident-fact-notice")).toHaveText(INCIDENT_FACT_NOTICE);
    await expect(tid(page, "incident-official-notice")).toHaveText(INCIDENT_OFFICIAL_PROCEDURE_NOTICE);
    await expectNoForbiddenWords(page, "一覧");

    // 入力：G1 が最上部（入力欄より前）、そのあと N1。N5・N6・N7 が各欄の近く
    await page.goto("/ops/incidents/new");
    await expect(tid(page, "incident-new-page")).toBeVisible();
    await expectSafetyFirst(page, "入力");
    const g1 = tid(page, "incident-safety-first");
    const firstInput = page.locator('[data-testid="incident-form"] input, [data-testid="incident-form"] select, [data-testid="incident-form"] textarea').first();
    expect(await isBefore(g1, firstInput), "G1 が DOM の順で入力欄より前").toBe(true);
    expect(await isBefore(g1, tid(page, "incident-fact-notice")), "G1 が N1 より前").toBe(true);
    const g1Box = (await g1.boundingBox())!;
    const inputBox = (await firstInput.boundingBox())!;
    expect(g1Box.y + g1Box.height).toBeLessThanOrEqual(inputBox.y);
    // 読まずに入力を進めても妨げられない（入力欄はすぐ操作できる）
    await expect(firstInput).toBeEnabled();
    await expect(tid(page, "incident-fact-notice")).toHaveText(INCIDENT_FACT_NOTICE);
    await expect(tid(page, "incident-kind-notice")).toHaveText(INCIDENT_KIND_NOTICE);
    await expect(tid(page, "incident-event-type-notice")).toHaveText(INCIDENT_EVENT_TYPE_NOTICE);
    await expect(tid(page, "incident-personal-notice")).toHaveText(INCIDENT_PERSONAL_INFO_NOTICE);
    // 各類型の説明文が選択肢の下に出る（版 1 の定数どおり。「※要確認」は付かない）
    for (const o of eventTypeOptions()) {
      const label = tid(page, `incident-event-type-label-${o.key}`);
      const desc = tid(page, `incident-event-type-desc-${o.key}`);
      await expect(label).toHaveText(o.label);
      await expect(desc).toHaveText(o.description!);
      expect((await desc.boundingBox())!.y, `${o.key} の説明が名称の下`).toBeGreaterThan((await label.boundingBox())!.y);
    }
    // N4：目安のすぐ下
    await tid(page, "incident-event-type-minor_injury").check();
    await expect(tid(page, "incident-live-guidance-note")).toHaveText(incidentGuidanceNote());
    await expectNoForbiddenWords(page, "入力");
    await expectNoHorizontalScroll(page, "入力");

    // 詳細：N1・N2・N3・N4（初期データの「報告の記録あり」）
    const manager = await apiAs(seeded("a-manager"));
    const list = (await (await manager.get("/api/ops/incidents")).json()) as { incidents: { id: string; summary: string | null }[] };
    const reported = list.incidents.find((x) => x.summary === "テスト事故：倉庫の壁に機体が接触した")!;
    await page.goto(`/ops/incidents/${reported.id}`);
    await expect(tid(page, "incident-detail-page")).toBeVisible();
    await expect(tid(page, "incident-fact-notice")).toHaveText(INCIDENT_FACT_NOTICE);
    await expect(tid(page, "incident-official-notice")).toHaveText(INCIDENT_OFFICIAL_PROCEDURE_NOTICE);
    await expect(tid(page, "incident-report-record-notice").first()).toHaveText(INCIDENT_REPORT_RECORD_NOTICE);
    await expect(tid(page, "incident-guidance-note")).toHaveText(incidentGuidanceNote(1));
    await expect(tid(page, "incident-report-state")).toHaveAttribute("data-code", "reported");
    // 報告の記録のフォームにも N3
    await tid(page, "incident-report-open").click();
    await expect(tid(page, "incident-report-form").getByTestId("incident-report-record-notice")).toHaveText(INCIDENT_REPORT_RECORD_NOTICE);
    await expectNoForbiddenWords(page, "詳細");
    await expectNoHorizontalScroll(page, "詳細");

    // 現場の簡易記録：G1 が区分の選択より前、N1、完了後に N2
    const aircraft = await createAircraft(manager);
    const pilot = await meOf(seeded("a-pilot"));
    const plan = await createPlan(manager, planBody(aircraft.id, pilot.pilotId!));
    await openQuick(page, plan.id);
    await expectSafetyFirst(page, "簡易記録");
    expect(await isBefore(tid(page, "incident-safety-first"), tid(page, "incident-quick-kind-accident"))).toBe(true);
    expect(await isBefore(tid(page, "incident-fact-notice"), tid(page, "incident-quick-kind-accident"))).toBe(true);
    await expect(tid(page, "incident-fact-notice")).toHaveText(INCIDENT_FACT_NOTICE);
    await expect(tid(page, "incident-quick-later")).toHaveText(INCIDENT_QUICK_LATER_NOTICE);
    await expect(tid(page, "incident-official-notice")).toHaveCount(0);
    await tid(page, "incident-quick-kind-near_miss").click();
    await tid(page, "incident-quick-injury-no").click();
    await tid(page, "incident-quick-submit").click();
    await expect(tid(page, "incident-quick-saved-message")).toContainText(INCIDENT_QUICK_SAVED_MESSAGE);
    await expect(tid(page, "incident-official-notice")).toHaveText(INCIDENT_OFFICIAL_PROCEDURE_NOTICE);
    await expectNoForbiddenWords(page, "簡易記録");
    await expect(tid(page, "incident-quick-unsent")).toContainText("送信済み");
    for (const r of await listForPlan(manager, plan.id)) await voidIncident(manager, r.id);
    await voidPlan(manager, plan.id);
    await manager.dispose();
  });

  test("10. 事務所の通し：一覧 → 記録する → 類型（初期値なし）→ 目安が切り替わる → 保存 → 詳細・版・出典 → 訂正 → 報告の結果・要否の確認 → 内容が変わった → 取消。操縦者は自分の分だけ、閲覧者は書けない", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    await signIn(page.request, seeded("a-manager"));
    await fixClock(page, "12:00:10");
    await page.goto("/ops/incidents");
    await tapAndWait(page, tid(page, "incident-new-link"), /\/ops\/incidents\/new$/);
    await expect(tid(page, "incident-form")).toBeVisible();

    // 初期値がない：区分・類型・けがの有無・機体の損傷のどれも選ばれていない
    await expect(page.locator('[data-testid="incident-form"]:visible input[type="checkbox"]:checked')).toHaveCount(0);
    for (const k of ["accident", "near_miss", "undetermined"]) await expect(tid(page, `incident-kind-${k}`)).not.toBeChecked();
    for (const v of ["yes", "no", "unknown"]) {
      await expect(tid(page, `incident-injury-${v}`)).not.toBeChecked();
      await expect(tid(page, `incident-damage-${v}`)).not.toBeChecked();
    }
    await expect(tid(page, "incident-live-guidance-empty")).toBeVisible();

    // 操縦ミスなどの類型だけなら none_selected、「まだ分からない」なら possible（排他：ほかの選択が外れる）
    await tid(page, "incident-event-type-loss_by_operation").check();
    await expect(tid(page, "incident-live-guidance")).toHaveAttribute("data-level", "none_selected");
    await expect(tid(page, "incident-live-guidance-text")).toHaveText(INCIDENT_GUIDANCE_REVISION_1.guidanceText.none_selected);
    await tid(page, "incident-event-type-unknown").check();
    await expect(tid(page, "incident-event-type-loss_by_operation")).not.toBeChecked();
    await expect(tid(page, "incident-live-guidance")).toHaveAttribute("data-level", "possible");
    await expect(tid(page, "incident-live-guidance-text")).toContainText(POSSIBLE_HEAD);
    await expect(tid(page, "incident-live-guidance-text")).not.toContainText("※要確認");
    // 目安に効く類型を選ぶと「まだ分からない」が外れる。けがの重さはアプリが判定しない（選んだ類型のまま）
    await tid(page, "incident-event-type-minor_injury").check();
    await expect(tid(page, "incident-event-type-unknown")).not.toBeChecked();
    await expect(tid(page, "incident-live-guidance")).toHaveAttribute("data-level", "possible");
    await expect(tid(page, "incident-live-guidance-text")).toHaveText(INCIDENT_GUIDANCE_REVISION_1.guidanceText.possible);

    // 必須の未選択は保存できない（項目ごとの案内）
    await tid(page, "incident-submit").click();
    await expect(page.locator("[data-form-error]:visible")).toBeVisible();
    expect((await (await manager.get("/api/ops/incidents")).json()).incidents.filter((x: { summary: string | null }) => x.summary === `通しの記録 ${stamp}`)).toHaveLength(0);

    const summary = `通しの記録 ${stamp}`;
    await tid(page, "incident-kind-accident").check();
    await tid(page, "incident-injury-yes").check();
    await tid(page, "incident-injured-count").fill("1");
    await tid(page, "incident-damage-no").check();
    await tid(page, "incident-summary").fill(summary);
    await tid(page, "incident-factors").fill("風の確認が足りなかったかもしれない");
    await tid(page, "incident-submit").click();
    await page.waitForURL(/\/ops\/incidents\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;

    // 詳細：目安・データの版・出典・版の履歴
    await expect(tid(page, "incident-title")).toHaveText(summary);
    await expect(tid(page, "incident-guidance")).toHaveAttribute("data-level", "possible");
    await expect(tid(page, "incident-guidance-source")).toContainText("類型のデータの版 1");
    await expect(tid(page, "incident-guidance-source")).toContainText(SOURCE_TEXT);
    await expect(tid(page, "version-row")).toHaveCount(1);
    await expect(tid(page, "incident-report-state")).toHaveAttribute("data-code", "none");
    await expectNoForbiddenWords(page, "詳細（保存直後）");
    expectNoForbiddenInJson(await (await manager.get(`/api/ops/incidents/${id}`)).text(), "詳細の API");

    // 訂正：理由が要る。版が増え、前の値が版に残る
    await tid(page, "incident-summary").fill(`${summary}（訂正）`);
    await tid(page, "incident-submit").click();
    await expect(tid(page, "incident-form").locator("[data-form-error]")).toBeVisible();
    await tid(page, "incident-reason").fill("要約の言い回しを直す");
    await tid(page, "incident-submit").click();
    await expect(tid(page, "incident-detail-version")).toHaveText("版 2");
    await expect(tid(page, "version-row")).toHaveCount(2);
    await expect(tid(page, "version-reason").last()).toContainText("要約の言い回しを直す");
    const versions = (await (await manager.get(`/api/ops/incidents/${id}/versions`)).json()) as { versions: { content: { summary: string } }[] };
    expect(versions.versions[0]!.content.summary).toBe(summary);

    // 報告の結果を記録する（確認のチェックを入れるまで押せない）
    await tid(page, "incident-report-open").click();
    await expect(tid(page, "incident-report-submit")).toBeDisabled();
    await tid(page, "incident-report-reference").fill(`E2E-${stamp}`);
    await tid(page, "incident-report-check").check();
    await expect(tid(page, "incident-report-submit")).toBeEnabled();
    await tid(page, "incident-report-submit").click();
    await expect(tid(page, "incident-report-state")).toHaveAttribute("data-code", "reported");
    await expect(tid(page, "incident-report-state")).toContainText("報告の記録あり（利用者の申告）");
    await expect(tid(page, "incident-report-record")).toHaveCount(1);
    await expect(tid(page, "incident-report-record-detail")).toContainText(`DIPS 2.0／番号 E2E-${stamp}`);

    // 報告の要否を確かめたことを記録する（note 必須・確認のチェック）
    await tid(page, "incident-consult-open").click();
    await expect(tid(page, "incident-consult-submit")).toBeDisabled();
    await tid(page, "incident-consult-check").check();
    await tid(page, "incident-consult-submit").click();
    await expect(tid(page, "incident-consult-form").locator("[data-form-error]")).toBeVisible();
    await tid(page, "incident-consult-note").fill("地方航空局の担当部署に確認した");
    await tid(page, "incident-consult-submit").click();
    await expect(tid(page, "incident-report-record")).toHaveCount(2);
    await expect(tid(page, "incident-report-state")).toHaveAttribute("data-code", "reported");

    // 類型を変えると「内容が変わりました」
    await tid(page, "incident-event-type-property_damage").check();
    await tid(page, "incident-reason").fill("物の損壊が分かった");
    await tid(page, "incident-submit").click();
    await expect(tid(page, "incident-detail-version")).toHaveText("版 3");
    await expect(tid(page, "incident-report-state-changed")).toContainText(INCIDENT_CHANGED_SINCE_REPORT);
    expect((await getIncident(manager, id)).reportState.changedSinceReport).toBe(true);
    await expectNoForbiddenWords(page, "詳細（内容が変わった）");

    // 取り下げ：理由が要り、元の行は残る
    await tid(page, "incident-retract-open").first().click();
    await tid(page, "incident-retract-reason").first().fill("誤って記録した");
    await tid(page, "incident-retract-submit").first().click();
    await expect(page.locator('[data-testid="incident-report-record"][data-retracted="true"]:visible')).toHaveCount(1);
    await expect(tid(page, "incident-report-record")).toHaveCount(3);

    // 操縦者：運航管理者が作った（操縦者が自分でない）記録は訂正・取消できない。自分で作った記録は訂正でき、取消はできない
    const pilotPage = await page.context().browser()!.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
    await signIn(pilotPage.request, seeded("a-pilot"));
    await pilotPage.clock.setFixedTime(at("12:00:10"));
    await pilotPage.goto(`/ops/incidents/${id}`);
    await expect(tid(pilotPage, "incident-detail-page")).toBeVisible();
    await expect(tid(pilotPage, "incident-form")).toHaveCount(0);
    await expect(tid(pilotPage, "incident-correct-denied")).toBeVisible();
    await expect(tid(pilotPage, "incident-report-open")).toHaveCount(0);
    await expect(pilotPage.getByRole("button", { name: "この記録を取り消す" })).toHaveCount(0);
    const pilotApi = await apiAs(seeded("a-pilot"));
    const own = await createIncident(pilotApi, fullBody());
    await pilotPage.goto(`/ops/incidents/${own.id}`);
    await expect(tid(pilotPage, "incident-form")).toBeVisible();
    await expect(tid(pilotPage, "incident-report-open")).toBeVisible();
    await expect(pilotPage.getByRole("button", { name: "この記録を取り消す" })).toHaveCount(0);
    expect((await pilotApi.post(`/api/ops/incidents/${own.id}/void`, { data: { expectedVersion: own.version, reason: "x" } })).status()).toBe(403);
    await pilotPage.close();

    // 閲覧者：記録する・訂正・報告の記録・取消のどれも出ない（API も 403）
    const viewerPage = await page.context().browser()!.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
    await signIn(viewerPage.request, seeded("a-viewer"));
    await viewerPage.goto("/ops/incidents");
    await expect(tid(viewerPage, "incident-list-page")).toBeVisible();
    await expect(tid(viewerPage, "incident-new-link")).toHaveCount(0);
    await viewerPage.goto("/ops/incidents/new");
    await expect(tid(viewerPage, "incident-new-forbidden")).toBeVisible();
    await expect(tid(viewerPage, "incident-form")).toHaveCount(0);
    await viewerPage.goto(`/ops/incidents/${id}`);
    await expect(tid(viewerPage, "incident-detail-page")).toBeVisible();
    await expect(tid(viewerPage, "incident-form")).toHaveCount(0);
    await expect(tid(viewerPage, "incident-report-open")).toHaveCount(0);
    const viewerApi = await apiAs(seeded("a-viewer"));
    expect((await viewerApi.post("/api/ops/incidents", { data: fullBody() })).status()).toBe(403);
    await viewerApi.dispose();
    await viewerPage.close();

    // 運航管理者が取消（理由が要る）。取消は既定の一覧に出ない
    await page.goto(`/ops/incidents/${id}`);
    // pressed again until the client has taken over (before that the click does not run the form's check)
    await expect(async () => {
      await page.getByRole("button", { name: "この記録を取り消す" }).click();
      await expect(page.locator("[data-form-error]:visible")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await page.getByLabel("取消の理由").fill("試験の記録");
    await page.getByRole("button", { name: "この記録を取り消す" }).click();
    await expect(tid(page, "incident-voided")).toBeVisible();
    await expect(tid(page, "incident-form")).toHaveCount(0);
    await page.goto("/ops/incidents");
    await expect(page.locator(`[data-testid="incident-row"][data-id="${id}"]:visible`)).toHaveCount(0);
    await page.goto("/ops/incidents?includeVoided=1");
    await expect(page.locator(`[data-testid="incident-row"][data-id="${id}"][data-voided="true"]:visible`)).toHaveCount(1);
    expectNoForbiddenInJson(await (await manager.get("/api/ops/incidents?includeVoided=1")).text(), "一覧の API");
    await expectNoForbiddenWords(page, "一覧（取消を含む）");
    await voidIncident(manager, own.id);
    await pilotApi.dispose();
    await manager.dispose();
  });

  test("11. 現場の簡易記録：現場モードの帯から移り、区分とけがの有無を選んで「記録する」だけで保存（確認ダイアログなし）。詳細の記入へ移れ、一覧に印、「今日」に詳細の記入。帯は離着陸のボタンから 24px 以上離れる", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    const bPilot = await meOf(seeded("b-pilot"));
    const aircraft = await createAircraft(bm);
    const plan = await createPlan(bm, planBody(aircraft.id, bPilot.pilotId!));
    await signIn(page.request, seeded("b-pilot"));
    await fixClock(page, "12:00:10");
    const dialogs = watchDialogs(page);

    await page.goto(`/ops/plans/${plan.id}/field`);
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    const band = tid(page, "field-incident-link");
    const flightBtn = tid(page, "field-flight-button");
    await expect(band).toHaveText(/事故・ヒヤリハットを記録する/);
    const bb = (await band.boundingBox())!;
    const fb = (await flightBtn.boundingBox())!;
    expect(bb.height).toBeGreaterThanOrEqual(56);
    expect(Math.abs(bb.width - fb.width), "帯は全幅").toBeLessThan(2);
    const gap = Math.max(fb.y - (bb.y + bb.height), bb.y - (fb.y + fb.height));
    expect(gap, "帯と離着陸のボタンの距離").toBeGreaterThanOrEqual(24);
    // 隣・直上・直下に置かない：帯と離着陸のボタンの間に、ほかの要素（段階・送信の状況など）がある
    const between = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="field-incident-link"]')!.getBoundingClientRect();
      const b = document.querySelector('[data-testid="field-flight-button"]')!.getBoundingClientRect();
      const lo = Math.min(a.bottom, b.bottom);
      const hi = Math.max(a.top, b.top);
      return Array.from(document.querySelectorAll('[data-testid="field-root"] [data-testid]')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= lo && r.bottom <= hi && r.height > 0;
      }).length;
    });
    expect(between).toBeGreaterThan(0);
    // 下メニューは出ない（現場モード・簡易記録）
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);

    await tapAndWait(page, band, new RegExp(`/ops/plans/${plan.id}/field/incident$`));
    await expect(page.locator('[data-testid="incident-quick-root"][data-hydrated="true"]')).toBeVisible();
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    // その場では記録されていない（移動しただけ）
    expect(await listForPlan(bm, plan.id)).toHaveLength(0);
    await expect(tid(page, "incident-quick-submit")).toBeDisabled();
    await tid(page, "incident-quick-kind-accident").click();
    await expect(tid(page, "incident-quick-submit")).toBeDisabled();
    await tid(page, "incident-quick-injury-unknown").click();
    await tid(page, "incident-quick-submit").click();
    await expect(tid(page, "incident-quick-saved-message")).toContainText(INCIDENT_QUICK_SAVED_MESSAGE);
    await expect(tid(page, "incident-quick-unsent")).toContainText("送信済み");
    const rows = await listForPlan(bm, plan.id);
    expect(rows).toHaveLength(1);
    const rec = rows[0]!;
    expect(rec.detailPending).toBe(true);
    expect(rec.source).toBe("field_quick");
    expect(rec.snapshotId).toBe(plan.currentSnapshotId);
    expect(rec.guidance.level).toBe("possible");
    await expect(tid(page, "incident-quick-detail")).toHaveAttribute("href", `/ops/incidents/${rec.id}#correct`);
    await expect(tid(page, "incident-quick-back-field")).toHaveAttribute("href", `/ops/plans/${plan.id}/field`);

    // 詳細を記入する → 詳細（最上部に「詳細を記入する」、訂正のフォーム）
    await tapAndWait(page, tid(page, "incident-quick-detail"), new RegExp(`/ops/incidents/${rec.id}#correct$`));
    await expect(tid(page, "incident-detail-pending")).toBeVisible();
    await expect(tid(page, "incident-form")).toBeVisible();
    // 一覧に印つきで出る
    await page.goto("/ops/incidents");
    const row = page.locator(`[data-testid="incident-row"][data-id="${rec.id}"]:visible`);
    await expect(row).toHaveAttribute("data-detail-pending", "true");
    await expect(row.getByTestId("incident-row-pending")).toContainText("✎");
    await expect(row.getByTestId("incident-row-pending")).toContainText("詳細は未記入");
    // 「今日」の次にやること（詳細を記入する・報告の要否を確認する）
    await page.goto("/ops");
    await expandNextActions(page);
    await expect(page.locator(`[data-testid="today-next-action-link"][href="/ops/incidents/${rec.id}#correct"]:visible`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="today-next-action-link"][href="/ops/incidents/${rec.id}#correct"]:visible`)).toContainText("事故・ヒヤリハットの詳細を記入する");
    await expect(page.locator(`[data-testid="today-next-action-link"][href="/ops/incidents/${rec.id}#report"]:visible`)).toContainText("事故・ヒヤリハットの報告の要否を確認する");

    // 12c の離着陸は変わらない（帯があっても、離陸 → 着陸を記録できる。確認ダイアログなし）
    await page.goto(`/ops/plans/${plan.id}/field`);
    await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
    await tid(page, "field-flight-button").click();
    await expect(tid(page, "field-flight-button")).toHaveText("着陸");
    await fixClock(page, "12:01:10");
    await page.waitForTimeout(1600);
    await tid(page, "field-flight-button").click();
    await expect(tid(page, "field-flight-button")).toHaveText("離陸");
    await expect(tid(page, "field-unsent")).toContainText("送信済み");
    expect(dialogs).toEqual([]);

    // 後始末（離着陸を取り消して計画を中止、記録は取消）
    const ev = (await (await bm.get(`/api/ops/plans/${plan.id}/field-events`)).json()) as { events: { id: string; kind: string }[] };
    for (const e of ev.events.filter((x) => x.kind === "landing")) await bm.post(`/api/ops/plans/${plan.id}/field-events`, { data: { kind: "undo", targetEventId: e.id, clientEventId: randomUUID(), occurredAt: `${DAY}T12:00` } });
    for (const e of ev.events.filter((x) => x.kind === "takeoff")) await bm.post(`/api/ops/plans/${plan.id}/field-events`, { data: { kind: "undo", targetEventId: e.id, clientEventId: randomUUID(), occurredAt: `${DAY}T12:00` } });
    await voidIncident(bm, rec.id);
    await voidPlan(bm, plan.id);
    await bm.dispose();
  });

  test("12. 端末の保存：圏外でも押した結果が出て「未送信 N 件」。戻ると送られ、応答を落とした再送でも 1 件。4xx は黙って捨てず「あとから入力」へ。ログアウトは未送信を警告。端末に個人情報を残さない。他の利用者の保存は消える", async ({ page, context }) => {
    const bm = await apiAs(seeded("b-manager"));
    const bPilot = await meOf(seeded("b-pilot"));
    const aircraft = await createAircraft(bm);
    const plan = await createPlan(bm, planBody(aircraft.id, bPilot.pilotId!));
    await signIn(page.request, seeded("b-pilot"));
    await fixClock(page, "12:00:10");
    const dialogs = watchDialogs(page);
    const storageKey = `soraban:ops-draft:incident-${plan.id}:${bPilot.memberId}`;

    // 圏外：押した結果は画面に反映され、未送信が増える。サーバーには届かない
    await openQuick(page, plan.id);
    await context.setOffline(true);
    await tid(page, "incident-quick-kind-accident").click();
    await tid(page, "incident-quick-injury-yes").click();
    await tid(page, "incident-quick-submit").click();
    await expect(tid(page, "incident-quick-saved-message")).toContainText(INCIDENT_QUICK_SAVED_MESSAGE);
    await expect(tid(page, "incident-quick-unsent")).toContainText("未送信 1 件");
    await expect(tid(page, "incident-quick-detail-note")).toBeVisible();
    expect(await listForPlan(bm, plan.id)).toHaveLength(0);
    // 端末に残る内容：区分・けがの有無・時刻・識別子だけ（氏名・技能証明書番号・座標・自由記述を含まない）
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), storageKey);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as { entries: Record<string, unknown>[] };
    expect(parsed.entries).toHaveLength(1);
    for (const e of parsed.entries) for (const k of Object.keys(e)) expect(["clientRequestId", "kind", "peopleInjury", "occurredAt", "status", "attempts", "rejection"]).toContain(k);
    expect(stored).not.toMatch(/操縦|組織B|TEST-|事故 |35\.4|133\.3|latitude|longitude|summary|name/);

    // 戻ると送られる（二重にならない）
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(tid(page, "incident-quick-unsent")).toContainText("送信済み");
    expect(await listForPlan(bm, plan.id)).toHaveLength(1);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), storageKey)).toBeNull();
    await expect(tid(page, "incident-quick-detail")).toHaveAttribute("href", /\/ops\/incidents\/[0-9a-f-]{36}#correct$/);

    // 応答を落とした再送でも記録は 1 件（サーバーには届いたが、端末は届いたと分からない）
    let dropped = false;
    await page.route("**/api/ops/incidents", async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await openQuick(page, plan.id);
    await tid(page, "incident-quick-kind-near_miss").click();
    await tid(page, "incident-quick-injury-no").click();
    await tid(page, "incident-quick-submit").click();
    await expect(tid(page, "incident-quick-unsent")).toContainText("未送信 1 件");
    // "unsent 1" is shown from the device's own state as soon as the button is pressed; the server has the row only once the
    // (dropped-response) POST has been committed, so wait for it instead of reading once
    await expect.poll(async () => (await listForPlan(bm, plan.id)).length).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(tid(page, "incident-quick-unsent")).toContainText("送信済み");
    expect(await listForPlan(bm, plan.id)).toHaveLength(2);
    await page.unroute("**/api/ops/incidents");

    // 4xx（端末の時計のずれ）は黙って捨てず、理由と「あとから入力」を出す
    await fixClock(page, "11:30:00");
    await openQuick(page, plan.id);
    await tid(page, "incident-quick-kind-undetermined").click();
    await tid(page, "incident-quick-injury-no").click();
    await tid(page, "incident-quick-submit").click();
    const rejected = tid(page, "incident-quick-rejected-row");
    await expect(rejected).toHaveCount(1);
    await expect(rejected).toHaveAttribute("data-code", "clock_skew");
    await expect(tid(page, "incident-quick-rejected-reason")).toContainText("端末の時刻がずれています");
    await expect(tid(page, "incident-quick-rejected-after-entry")).toHaveAttribute("href", `/ops/incidents/new?planId=${plan.id}`);
    await expect(tid(page, "incident-quick-saved-message")).toHaveAttribute("data-rejected", "true");
    // 開き直しても残る（黙って捨てない）。破棄は利用者が選ぶ
    await fixClock(page, "12:00:10");
    await openQuick(page, plan.id);
    await expect(tid(page, "incident-quick-rejected-row")).toHaveCount(1);
    await tid(page, "incident-quick-rejected-discard").click();
    await expect(tid(page, "incident-quick-rejected-row")).toHaveCount(0);
    expect(await listForPlan(bm, plan.id)).toHaveLength(2);

    // 送信待ちが 72 時間を超えた行（too_old）も、理由を出して「あとから入力」へ案内する
    await page.evaluate(
      ([k]) =>
        window.localStorage.setItem(
          k!,
          JSON.stringify({ v: 1, entries: [{ clientRequestId: "aaaaaaaa-1111-4111-8111-111111111111", kind: "accident", peopleInjury: "no", occurredAt: "2027-01-01T09:00", status: "pending", attempts: 1 }] }),
        ),
      [storageKey],
    );
    await openQuick(page, plan.id);
    await expect(tid(page, "incident-quick-rejected-row")).toHaveAttribute("data-code", "too_old");
    await expect(tid(page, "incident-quick-rejected-reason")).toContainText("あとから入力");
    await tid(page, "incident-quick-rejected-discard").click();
    await expect(tid(page, "incident-quick-rejected-row")).toHaveCount(0);

    // ログアウトは未送信があると警告し、黙って消さない。送れるようになったら送ってからログアウトする
    await openQuick(page, plan.id);
    await context.setOffline(true);
    await tid(page, "incident-quick-kind-near_miss").click();
    await tid(page, "incident-quick-injury-no").click();
    await tid(page, "incident-quick-submit").click();
    await expect(tid(page, "incident-quick-unsent")).toContainText("未送信 1 件");
    // 先に 503 の応答を仕込んでから通信を戻す。順序が逆だと、通信が戻った瞬間（online イベント）の自動の再送が本物のサーバーに
    // 届いて未送信が 0 件になり、そのあとのログアウトの押下が警告なしでログアウトしてしまう（待ちの不足による不安定）。
    await page.route("**/api/ops/incidents", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 503, body: "{}" }) : route.continue()));
    await context.setOffline(false);
    await page.goto("/ops/more");
    // a click before hydration does nothing (no handler yet), so press again until the warning shows; with an unsent item
    // the hydrated click only ever opens the warning (never signs out), so repeating it is safe
    // ログアウトは右上の利用者メニューの中
    await expect(async () => {
      await openUserMenu(page);
      await page.getByTestId("signout").click();
      await expect(page.getByTestId("signout-warning")).toContainText("未送信 1 件があります", { timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    expect(await page.evaluate((k) => window.localStorage.getItem(k), storageKey)).not.toBeNull();
    await page.getByTestId("signout-send").click();
    await expect(page.getByTestId("signout-warning")).toContainText("送れませんでした");
    expect(new URL(page.url()).pathname).toBe("/ops/more");
    await page.unroute("**/api/ops/incidents");
    await page.getByTestId("signout-send").click();
    await expect(page).toHaveURL(/\/ops\/sign-in$/);
    expect(await listForPlan(bm, plan.id)).toHaveLength(3);
    expect(await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("soraban:ops-draft:")))).toEqual([]);

    // 他の利用者の保存は消える（共用の端末）
    await signIn(page.request, seeded("b-pilot"));
    await page.goto("/ops/more");
    await page.evaluate(() => window.localStorage.setItem("soraban:ops-draft:incident-00000000-0000-4000-8000-000000000000:other-member", "{}"));
    await page.goto("/ops");
    await expect(page.getByTestId("ops-today")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.endsWith(":other-member")))).toEqual([]);
    expect(dialogs).toEqual([]);
    for (const r of await listForPlan(bm, plan.id)) await voidIncident(bm, r.id);
    await voidPlan(bm, plan.id);
    await bm.dispose();
  });

  test("13. 連携：計画・日誌の画面に「この飛行の事故・ヒヤリハット」。日誌の安全に影響のあった事項から入力画面へ（要約が初期値、自動で作らない）。日誌から入れる。「ホーム」の報告の要否の確認は日数が経っても出続け、確認の記録で消える", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    const bPilot = await meOf(seeded("b-pilot"));
    const aircraft = await createAircraft(bm);
    const plan = await createPlan(bm, planBody(aircraft.id, bPilot.pilotId!));
    await signIn(page.request, seeded("b-manager"));
    await fixClock(page, "12:00:10");

    // 計画に結び付いた記録（計画から機体・操縦者・スナップショットを引き継ぐ）
    const linked = await createIncident(bm, fullBody({ planId: plan.id, summary: `計画の記録 ${stamp}` }));
    expect(linked.snapshotId).toBe(plan.currentSnapshotId);
    await page.goto(`/ops/plans/${plan.id}`);
    const sec = tid(page, "incident-linked");
    await expect(sec).toBeVisible();
    await expect(tid(page, "incident-linked-count")).toHaveAttribute("data-count", "1");
    await expect(sec.locator(`[data-testid="incident-row"][data-id="${linked.id}"]`)).toBeVisible();
    await expect(tid(page, "incident-linked-new")).toHaveAttribute("href", `/ops/incidents/new?planId=${plan.id}`);
    await tapAndWait(page, tid(page, "incident-linked-new"), /\/ops\/incidents\/new\?planId=/);
    await expect(tid(page, "incident-plan")).toHaveValue(plan.id);

    // 日誌：安全に影響のあった事項があると「事故・ヒヤリハットとして記録する」（押すと要約が初期値に入る。記録は作られない）
    const detail = `着陸の直前に強い風で機体が流された ${stamp}`;
    const flight = await bm.post("/api/ops/flights", {
      data: {
        aircraftId: aircraft.id,
        pilotId: bPilot.pilotId,
        flightPlanId: plan.id,
        purpose: "空撮",
        takeoffPlace: "試験地点",
        landingPlace: "試験地点",
        safetyIssue: true,
        safetyIssueDetail: detail,
        takeoffAt: `${DAY}T10:00`,
        landingAt: `${DAY}T10:10`,
      },
    });
    expect(flight.status(), await flight.text()).toBe(201);
    const flightId = ((await flight.json()) as { id: string }).id;
    const before = (await listForPlan(bm, plan.id)).length;
    await page.goto(`/ops/flights/${flightId}`);
    await expect(tid(page, "incident-linked")).toBeVisible();
    await expect(tid(page, "incident-linked-count")).toHaveAttribute("data-count", "0");
    await tapAndWait(page, tid(page, "incident-linked-safety"), /\/ops\/incidents\/new\?/);
    await expect(tid(page, "incident-summary")).toHaveValue(detail);
    await expect(tid(page, "incident-plan")).toHaveValue(plan.id);
    expect((await listForPlan(bm, plan.id)).length).toBe(before);
    // 日誌の列・保存は変わらない（安全に影響のあった事項はそのまま）
    const fj = (await (await bm.get(`/api/ops/flights/${flightId}`)).json()) as { safetyIssue: boolean; safetyIssueDetail: string };
    expect(fj.safetyIssue).toBe(true);
    expect(fj.safetyIssueDetail).toBe(detail);
    // 日誌から入力画面で保存すると、日誌に結び付く
    await tid(page, "incident-kind-near_miss").check();
    await tid(page, "incident-event-type-none").check();
    await tid(page, "incident-injury-no").check();
    await tid(page, "incident-damage-no").check();
    await tid(page, "incident-submit").click();
    await page.waitForURL(/\/ops\/incidents\/[0-9a-f-]{36}$/);
    await expect(tid(page, "incident-detail-flight")).toHaveAttribute("href", `/ops/flights/${flightId}`);
    await expect(tid(page, "incident-guidance")).toHaveAttribute("data-level", "none_selected");
    await page.goto(`/ops/flights/${flightId}`);
    await expect(tid(page, "incident-linked-count")).toHaveAttribute("data-count", "1");

    // 日誌から入れ（登録からは外れた）、下メニューの「日誌」が現在地。一覧の戻り先は日誌
    await page.goto("/ops/more");
    await expect(tid(page, "more-link-incidents")).toHaveCount(0);
    await page.goto("/ops/journal");
    await tapAndWait(page, tid(page, "journal-tab-incidents"), /\/ops\/incidents$/);
    await expect(tid(page, "incident-list-page")).toBeVisible();
    const bottom = page.getByTestId("ops-bottom-nav");
    await expect(bottom.getByTestId("nav-journal")).toHaveAttribute("data-active", "true");
    await expect(bottom.getByTestId("nav-journal")).toHaveAttribute("aria-current", "page");
    await expect(bottom.getByTestId("nav-more")).toHaveAttribute("data-active", "false");
    await expect(page.getByTestId("incident-list-page").getByRole("link", { name: /日誌/ }).first()).toHaveAttribute("href", "/ops/journal");

    // 「ホーム」：目安が possible で報告・確認の記録がない記録は、日数が経っても出続ける（起きてから 35 日・365 日）
    const old35 = await createIncident(bm, fullBody({ kind: "accident", occurredAt: "2026-12-01T09:00", eventTypes: ["property_damage"], summary: `35 日前 ${stamp}` }));
    const old365 = await createIncident(bm, fullBody({ kind: "accident", occurredAt: "2026-01-05T09:00", eventTypes: ["minor_injury"], peopleInjury: "yes", summary: `365 日前 ${stamp}` }));
    const confirmLink = (id: string) => page.locator(`[data-testid="today-next-action-link"][href="/ops/incidents/${id}#report"]:visible`);
    await page.goto("/ops");
    await expect(page.getByTestId("ops-today")).toBeVisible();
    await expandNextActions(page);
    await expect(confirmLink(old35.id)).toHaveCount(1);
    await expect(confirmLink(old365.id)).toHaveCount(1);
    await expect(confirmLink(old35.id)).toContainText("事故・ヒヤリハットの報告の要否を確認する");
    // 押すと記録の詳細（報告の記録のフォーム）へ
    await tapAndWait(page, confirmLink(old35.id), new RegExp(`/ops/incidents/${old35.id}#report$`));
    await expect(tid(page, "incident-consult-open")).toBeVisible();
    // 要否の確認の記録を足すと消える（日数では消えない）
    const consulted = await bm.post(`/api/ops/incidents/${old35.id}/reports`, {
      data: { action: "consulted", doneAt: `${DAY}T11:30`, note: "担当部署に確認した", checks: { consultationDone: true } },
    });
    expect(consulted.status(), await consulted.text()).toBe(201);
    const reported = await bm.post(`/api/ops/incidents/${old365.id}/reports`, {
      data: { action: "reported", doneAt: `${DAY}T11:30`, channel: "dips", referenceAbsent: true, checks: { reportCompleted: true } },
    });
    expect(reported.status(), await reported.text()).toBe(201);
    await page.goto("/ops");
    await expect(page.getByTestId("ops-today")).toBeVisible();
    await expect(confirmLink(old35.id)).toHaveCount(0);
    await expect(confirmLink(old365.id)).toHaveCount(0);
    expectNoForbiddenInJson(await (await bm.get("/api/ops/today")).text(), "今日の API");

    for (const r of await listForPlan(bm, plan.id)) await voidIncident(bm, r.id);
    for (const id of [old35.id, old365.id]) await voidIncident(bm, id);
    await bm.post(`/api/ops/flights/${flightId}/void`, { data: { expectedVersion: 1, reason: "試験の後始末" } });
    await voidPlan(bm, plan.id);
    await bm.dispose();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`15. 現場の簡易記録の見た目の基準（${scheme === "light" ? "明るい" : "暗い"}配色）：押す部品 56px 以上・間 12px 以上、本文 18px 以上、状態の語 20px 以上、コントラスト 7:1`, async ({ page }) => {
      const bm = await apiAs(seeded("b-manager"));
      const bPilot = await meOf(seeded("b-pilot"));
      const aircraft = await createAircraft(bm);
      const plan = await createPlan(bm, planBody(aircraft.id, bPilot.pilotId!));
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page.request, seeded("b-pilot"));
      await fixClock(page, "12:00:10");
      await openQuick(page, plan.id);
      const label = `簡易記録（${scheme}）`;
      const root = '[data-testid="incident-quick-root"]';
      await expectNoHorizontalScroll(page, label);
      await tid(page, "incident-quick-kind-accident").click();
      await expectTapTargets(page, root, `${label} 入力`);
      await expectFontSize(page, root, 18, `${label} 入力`);
      await expectContrast(page, root, 7, `${label} 入力`);
      const submit = (await tid(page, "incident-quick-submit").boundingBox())!;
      expect(submit.height).toBeGreaterThanOrEqual(56);
      expect(submit.width).toBeGreaterThan(300);
      // 状態の語（送信の状況）は 20px 以上。選んだ選択肢は記号と aria-checked で示す（色だけで区別しない）
      const samples = await collectTextSamples(page, root);
      for (const s of samples.filter((x) => x.testId === "incident-quick-unsent")) expect(s.fontSize).toBeGreaterThanOrEqual(20);
      await expect(tid(page, "incident-quick-kind-accident")).toHaveAttribute("aria-checked", "true");
      await expect(tid(page, "incident-quick-kind-accident")).toContainText("◉");
      // ホバーだけに頼る操作がない
      expect(await page.locator(`${root} [class*="group-hover"], ${root} [class*="hover:block"]`).count()).toBe(0);
      // 保存後の画面
      await tid(page, "incident-quick-injury-no").click();
      await tid(page, "incident-quick-submit").click();
      await expect(tid(page, "incident-quick-saved-message")).toBeVisible();
      await expect(tid(page, "incident-quick-unsent")).toContainText("送信済み");
      await expectTapTargets(page, root, `${label} 保存後`);
      await expectFontSize(page, root, 18, `${label} 保存後`);
      await expectContrast(page, root, 7, `${label} 保存後`);
      await expectNoHorizontalScroll(page, `${label} 保存後`);
      for (const r of await listForPlan(bm, plan.id)) await voidIncident(bm, r.id);
      await voidPlan(bm, plan.id);
      await bm.dispose();
    });
  }
});
