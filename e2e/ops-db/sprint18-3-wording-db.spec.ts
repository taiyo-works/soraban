import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { BOUNDARY_FULL } from "../../apps/web/src/lib/boundary";
import { saveScan, scanPage, scanPlaceholders, scanString, violationsOf, type ScanRecord } from "../wording-scan";
import { gotoPlanOpen } from "./plan-screen";

// Sprint 18-3 契約 3-8（docs/sprints/sprint-18.md §6.4）：運航管理の禁止語・限定語の走査。
// 全面禁止語は 0（判定の領域の印の中も）。限定語は許可リストの文の外に 0（印の中は検査せず記録する）。
// 区分ごとに 1 本のテストへまとめ、ルートを順に巡回する（失敗の場所が分かるよう、区分は分ける）。違反は区分の最後にまとめて出す。
// 計画は、通報の記録あり・なし、許可・承認の手続きがあるもの（register_permit）、飛行禁止法の手続きがあるもの（notify_police）、
// 技能証明の更新の時期の操縦者（renew_license）を含む。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 の next start に対して実行する。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;
// 実行ごとに変わる過去の日（時間帯の重なり overlap を避ける。サーバーの時計は 2027-01-05）
const DAY = new Date(Date.UTC(2025, 0, 1) + (Math.floor(Math.random() * 600) * 24 * 3600 * 1000)).toISOString().slice(0, 10);

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

const MIHO = { lat: 35.4936, lng: 133.2361 };
const NIGHT_SPOT = { lat: 35.44, lng: 133.35 };
type PlanJson = { id: string; version: number; currentSnapshotId: string; nextActions: { id: string }[] };
const ALL_NORMAL = Object.fromEntries(
  ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"].map((k) => [k, { result: "normal" }]),
);

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
// 区分は互いに独立（前の区分の失敗で後ろを飛ばさない）

test.describe("Sprint 18-3 E2E-DB：禁止語・限定語の走査（運航管理）", () => {
  let manager: APIRequestContext;
  let aircraftId = "";
  let pilotId = "";
  const ids: Record<string, string> = {};
  const plans: Record<"permit" | "reported" | "draft", PlanJson> = {} as never;

  const createPlan = async (extra: object = {}): Promise<PlanJson> => {
    const r = await manager.post("/api/ops/plans", {
      data: {
        title: `S18-3 ${stamp}-${seq++}`,
        aircraftId,
        pilotId,
        plannedStartAt: "2027-02-10T10:00",
        durationMinutes: 30,
        purpose: "空撮",
        placeName: "試験地点",
        latitude: MIHO.lat,
        longitude: MIHO.lng,
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
  const post = async <T>(path: string, data: object): Promise<T> => {
    const r = await manager.post(path, { data });
    expect(r.status(), `${path}: ${await r.text()}`).toBe(201);
    return (await r.json()) as T;
  };

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    const mark = `JUS183${stamp}`;
    aircraftId = (await post<{ id: string }>("/api/ops/aircraft", { registrationMark: mark, modelName: "S18-3 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 })).id;
    const me = await apiAs(seeded("a-pilot"));
    pilotId = ((await (await me.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await me.dispose();
    // 技能証明の更新の時期（満了の約 1 か月前を過ぎたもの・更新の時期のもの）の操縦者
    ids.pilotWindow = (await post<{ id: string }>("/api/ops/pilots", { fullName: `更新 時期${stamp}`, hasLicense: true, licenseClass: "second", licenseNumber: `S183W-${stamp}`.slice(0, 30), licenseExpiresOn: "2027-03-20" })).id;
    ids.pilotPast = (await post<{ id: string }>("/api/ops/pilots", { fullName: `更新 期限${stamp}`, hasLicense: true, licenseClass: "second", licenseNumber: `S183P-${stamp}`.slice(0, 30), licenseExpiresOn: "2027-01-20" })).id;
    ids.place = (await post<{ id: string }>("/api/ops/places", { name: `S18-3 地点${stamp}`, latitude: 35.44, longitude: 133.35 })).id;
    ids.permit = (await post<{ id: string }>("/api/ops/permits", {
      permitNumber: `S183-${stamp}`, coverage: "blanket", kinds: ["night"], issuedOn: "2026-10-01", validFrom: "2026-10-01", validTo: "2027-09-30",
      placeScope: { type: "nationwide" }, aircraftScope: { type: "any" }, pilotScope: { type: "any" },
    })).id;
    plans.permit = await activate(await createPlan());
    plans.draft = await createPlan({ latitude: NIGHT_SPOT.lat, longitude: NIGHT_SPOT.lng });
    plans.reported = await activate(await createPlan({ latitude: NIGHT_SPOT.lat, longitude: NIGHT_SPOT.lng }));
    const cur = await getPlan(plans.reported.id);
    const rep = await manager.post(`/api/ops/plans/${plans.reported.id}/reports`, {
      data: { kind: "new", expectedPlanVersion: cur.version, manual: { reportedAt: "2027-01-05T11:00", dipsNumber: `S183-${stamp}`, confirmedDipsDone: true, confirmedMatchesLatest: true } },
    });
    expect(rep.status(), await rep.text()).toBeLessThan(300);
    ids.inspection = (await post<{ id: string }>("/api/ops/inspections", { aircraftId, pilotId, inspectedAt: `${DAY}T09:00`, placeName: "本社 駐車場", items: ALL_NORMAL })).id;
    ids.flight = (await post<{ id: string }>("/api/ops/flights", { aircraftId, pilotId, purpose: "空撮", takeoffPlace: "試験の離陸地", landingPlace: "試験の着陸地", safetyIssue: false, takeoffAt: `${DAY}T10:00`, landingAt: `${DAY}T10:10` })).id;
    ids.incident = (await post<{ id: string }>("/api/ops/incidents", { mode: "full", kind: "near_miss", occurredAt: `${DAY}T11:00`, summary: `S18-3 ${stamp}`, eventTypes: ["near_collision"], peopleInjury: "no", aircraftDamage: "no" })).id;
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const all: Record<string, ScanRecord[]> = {};
  /** 画面を開いて走査する（計画の画面は本文が出るまで待ち、畳みを開く）。 */
  const visit = async (page: Page, bucket: string, route: string, state: string, planScreen = false, minChars?: number): Promise<void> => {
    if (planScreen) await gotoPlanOpen(page, route);
    else {
      const res = await page.goto(route);
      expect(res?.status(), `${route}: 応答`).toBeLessThan(400);
      await page.waitForLoadState("networkidle").catch(() => undefined);
    }
    // 見出し（または本文）が出るまで待つ
    await expect(page.locator("main, [data-testid]").first()).toBeAttached();
    (all[bucket] ??= []).push(...(await scanPage(page, route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "[id]"), state, minChars)));
  };
  const finish = (bucket: string): void => {
    saveScan(`ops-${bucket}`, all[bucket] ?? []);
    expect(violationsOf(all[bucket] ?? [])).toEqual([]);
  };

  test("A：ホーム・計画の一覧・計画の各画面（通報の記録あり・なし、許可・承認と飛行禁止法の手続き）", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page.request, seeded("a-manager"));
    await visit(page, "A", "/ops", "ホーム");
    await visit(page, "A", "/ops/plans", "計画の一覧");
    await visit(page, "A", "/ops/plans/new", "計画の新規");
    for (const [label, plan] of [["許可・承認と飛行禁止法の手続きがある計画", plans.permit], ["通報の記録がある計画", plans.reported], ["下書きの計画", plans.draft]] as const) {
      const base = `/ops/plans/${plan.id}`;
      // plan-tabs が出る画面（主画面・計画・判定・日誌・通報の作業台）は本文が出るまで待ち、畳みを開く
      for (const [suffix, state] of [["", "主画面"], ["/overview", "計画"], ["/report", "通報の作業台"], ["/judgement", "判定"], ["/journal", "日誌"]] as const) {
        await visit(page, "A", `${base}${suffix}`, `${label}：${state}`, true);
      }
      await visit(page, "A", `${base}/snapshots`, `${label}：判定の履歴`);
      await visit(page, "A", `${base}/snapshots/${plan.currentSnapshotId}`, `${label}：判定の根拠`);
      await visit(page, "A", `${base}/edit`, `${label}：訂正`);
      await visit(page, "A", `${base}/field`, `${label}：現場`);
      await visit(page, "A", `${base}/field/incident`, `${label}：現場の事故の簡易記録`);
    }
    // register_permit・notify_police が出ている計画であること（走査の前提）
    expect((await getPlan(plans.permit.id)).nextActions.map((a) => a.id)).toEqual(expect.arrayContaining(["register_permit", "notify_police"]));
    finish("A");
  });

  test("B：点検・飛行記録・日誌・事故・ヒヤリハット", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page.request, seeded("a-manager"));
    await visit(page, "B", "/ops/inspections", "点検の一覧");
    await visit(page, "B", "/ops/inspections/new", "点検の入力");
    await visit(page, "B", `/ops/inspections/${ids.inspection}`, "点検の詳細");
    await visit(page, "B", "/ops/flights", "飛行記録の一覧");
    await visit(page, "B", "/ops/flights/new", "飛行記録の入力");
    await visit(page, "B", `/ops/flights/${ids.flight}`, "飛行記録の詳細");
    await visit(page, "B", "/ops/journal", "日誌");
    await visit(page, "B", "/ops/incidents", "事故・ヒヤリハットの一覧");
    await visit(page, "B", "/ops/incidents/new", "事故・ヒヤリハットの入力");
    await visit(page, "B", `/ops/incidents/${ids.incident}`, "事故・ヒヤリハットの詳細");
    finish("B");
  });

  test("C：登録（機体・操縦者・許可・承認・地点・利用者・登録・このアプリについて）", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page.request, seeded("a-manager"));
    await visit(page, "C", "/ops/aircraft", "機体の一覧");
    await visit(page, "C", "/ops/aircraft/new", "機体の入力");
    await visit(page, "C", `/ops/aircraft/${aircraftId}`, "機体の詳細");
    await visit(page, "C", "/ops/pilots", "操縦者の一覧（技能証明の更新の時期・期限を過ぎたものを含む）");
    await visit(page, "C", "/ops/pilots/new", "操縦者の入力");
    await visit(page, "C", `/ops/pilots/${ids.pilotWindow}`, "操縦者の詳細（更新の時期）");
    await visit(page, "C", `/ops/pilots/${ids.pilotPast}`, "操縦者の詳細（更新の期限を過ぎた）");
    await visit(page, "C", "/ops/permits", "許可・承認の一覧");
    await visit(page, "C", "/ops/permits/new", "許可・承認の入力");
    await visit(page, "C", `/ops/permits/${ids.permit}`, "許可・承認の詳細");
    await visit(page, "C", "/ops/places", "地点の一覧");
    await visit(page, "C", "/ops/places/new", "地点の入力");
    await visit(page, "C", `/ops/places/${ids.place}`, "地点の詳細");
    await visit(page, "C", "/ops/members", "利用者");
    await visit(page, "C", "/ops/more", "登録");
    await visit(page, "C", "/ops/about", "このアプリについて");
    // 3-3：載せない語（未定・準備中・TBD・要記入・xxx・ダミー・example・法人番号・適格請求書）は /ops/about とマニフェストで 0 件
    // （ほかの画面には「飛行の準備中」「@example.test」など、別の意味の語が正当に出るため、対象にしない）
    (all.C ??= []).push(...(await scanPlaceholders(page, "/ops/about")));
    // 空振りでないこと：/ops/about の記録に境界の全文が許可リストの文として入っている
    expect(all.C!.some((r) => r.kind === "allowed" && r.route === "/ops/about" && r.sentence === BOUNDARY_FULL), "BOUNDARY_FULL が /ops/about の記録にある").toBe(true);
    finish("C");
  });

  test("D：圏外の殻（5 つ）・マニフェスト・操縦者と閲覧者のこのアプリについて", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page.request, seeded("a-manager"));
    for (const shell of ["today", "field", "inspection", "journal", "unavailable"]) await visit(page, "D", `/ops/offline/${shell}`, `圏外の殻（${shell}）`, false, 60); // 殻は短い（端末のデータから描く）。空でないことだけ確かめる
    // マニフェストの JSON の全文字列（ネットワークの応答）
    const res = await page.request.get("/ops/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = await res.text();
    (all.D ??= []).push(...scanString("/ops/manifest.webmanifest", "JSON の全文字列", manifest));
    const manifestJson = JSON.parse(manifest) as { description: string };
    expect(manifestJson.description).toBe("ドローンの飛行計画の通報の記録、飛行前・飛行後の点検、飛行日誌をまとめます。点検と飛行日誌は、電波の弱い現場でも記録できます。提供元：フューチャーテック株式会社");
    // 圏外で使えると読める言い方を通報の記録にしない
    expect(manifestJson.description).not.toMatch(/通報[^。]*電波の弱い/);
    for (const w of ["未定", "準備中", "TBD", "要記入", "xxx", "ダミー", "example", "法人番号", "適格請求書"]) expect(manifest, w).not.toContain(w);
    // 操縦者・閲覧者でも読める
    for (const who of ["a-pilot", "a-viewer"]) {
      const ctx = await apiAs(seeded(who));
      const p = await ctx.get("/ops/about");
      expect(p.status(), who).toBe(200);
      (all.D ??= []).push(...scanString(`/ops/about（${who}）`, "HTML", await p.text()).filter((r) => r.kind === "forbidden"));
      await ctx.dispose();
    }
    finish("D");
  });
});
