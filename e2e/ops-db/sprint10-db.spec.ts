import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";

// Sprint 10 の E2E-DB（契約 6・8・14・17・18・20）。
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する（playwright.ops.config.ts）。
// テスト用の初期データ（packages/db/src/ops-seed.ts）を前提にする：
//   組織A：a-manager（運航管理者）・a-pilot・a-pilot2（操縦者、各自の操縦者の行に結び付け済み）・a-viewer（閲覧者）・
//          a-invited（招待中の操縦者）・a-invited-unverified（招待中の閲覧者）
//   組織B：b-manager・b-pilot、機体 JUORGB0001
// テストは記載順に実行する（workers: 1）。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;

type Who = { readonly authUserId: string; readonly email: string; readonly emailVerified?: boolean; readonly name?: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key });

const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", {
    data: { authUserId: who.authUserId, email: who.email, emailVerified: who.emailVerified ?? true, name: who.name ?? null },
  });
  expect(r.status()).toBe(200);
};

/** 指定した人でログインした API の要求コンテキスト。 */
const apiAs = async (who: Who | null): Promise<APIRequestContext> => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  if (who) await signIn(ctx, who);
  return ctx;
};

const pageAs = async (page: Page, who: Who): Promise<void> => {
  await signIn(page.request, who);
};

const AIRCRAFT = {
  modelName: "Matrice 350 RTK",
  manufacturer: "DJI",
  serialNumber: "SN-E2E",
  typeCertified: false,
  initialFlightMinutes: 90,
};

let seq = 0;
const uniqueMark = () => `JUE2E${Date.now().toString(36).toUpperCase()}${seq++}`;

test.describe.configure({ mode: "serial" });

test.describe("Sprint 10 E2E-DB：運航管理", () => {
  test("6. 招待済み・確認済みのメールアドレスで初回ログインすると結び付き、/ops に表示名と役割が出る", async ({ page }) => {
    await pageAs(page, { authUserId: "auth-invited-1", email: "A-Invited@Example.test", emailVerified: true, name: "招待さん" });
    await page.goto("/ops");
    await expect(page.getByTestId("ops-me-name")).toHaveText("招待 三郎");
    await expect(page.getByTestId("ops-me-role")).toHaveText("役割：操縦者");
    const me = await page.request.get("/api/ops/me");
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ member: { displayName: "招待 三郎", role: "pilot" }, org: { name: "テスト組織A" } });
  });

  test("6. 招待されていないアドレスでは /ops/no-access が表示され、/api/ops/me が 403", async ({ page }) => {
    await pageAs(page, { authUserId: "auth-stranger", email: "stranger@example.test", emailVerified: true });
    await page.goto("/ops");
    await expect(page).toHaveURL(/\/ops\/no-access$/);
    await expect(page.getByTestId("ops-no-access")).toHaveText("権限がありません");
    expect((await page.request.get("/api/ops/me")).status()).toBe(403);
  });

  test("6. 招待済みのアドレスでも emailVerified: false では結び付かない", async () => {
    const unverified = await apiAs({
      authUserId: "auth-unverified",
      email: "a-invited-unverified@example.test",
      emailVerified: false,
    });
    expect((await unverified.get("/api/ops/me")).status()).toBe(403);
    expect((await unverified.get("/api/ops/aircraft")).status()).toBe(403);
    const manager = await apiAs(seeded("a-manager"));
    const members = (await (await manager.get("/api/ops/members")).json()) as { members: { email: string; status: string; linked: boolean }[] };
    expect(members.members.find((m) => m.email === "a-invited-unverified@example.test")).toMatchObject({ status: "invited", linked: false });
    await unverified.dispose();
    await manager.dispose();
  });

  test("8. 役割ごとの API の状態コード（機体・操縦者・利用者）", async () => {
    const manager = await apiAs(seeded("a-manager"));
    const pilot = await apiAs(seeded("a-pilot"));
    const viewer = await apiAs(seeded("a-viewer"));
    const anon = await apiAs(null);

    // 準備：機体 1 件、操縦者の ID（自分・他人）、利用者の ID
    const created = await manager.post("/api/ops/aircraft", { data: { ...AIRCRAFT, registrationMark: uniqueMark() } });
    expect(created.status()).toBe(201);
    const aircraft = (await created.json()) as { id: string; version: number };
    const pilots = ((await (await manager.get("/api/ops/pilots")).json()) as { pilots: { id: string; fullName: string; version: number }[] }).pilots;
    const selfPilot = pilots.find((p) => p.fullName === "操縦 一郎")!;
    const otherPilot = pilots.find((p) => p.fullName === "操縦 二郎")!;
    const members = ((await (await manager.get("/api/ops/members")).json()) as { members: { id: string; email: string; version: number }[] })
      .members;
    const viewerMember = members.find((m) => m.email === "a-viewer@example.test")!;

    // 機体の登録：運航管理者 201（上で確認）、操縦者・閲覧者 403、未ログイン 401
    for (const [ctx, status] of [
      [pilot, 403],
      [viewer, 403],
      [anon, 401],
    ] as const) {
      expect((await ctx.post("/api/ops/aircraft", { data: { ...AIRCRAFT, registrationMark: uniqueMark() } })).status()).toBe(status);
    }
    // 機体の訂正
    for (const [ctx, status] of [
      [pilot, 403],
      [viewer, 403],
      [anon, 401],
    ] as const) {
      const r = await ctx.patch(`/api/ops/aircraft/${aircraft.id}`, { data: { expectedVersion: 1, reason: "試験", modelName: "X" } });
      expect(r.status()).toBe(status);
    }
    const upd = await manager.patch(`/api/ops/aircraft/${aircraft.id}`, { data: { expectedVersion: 1, reason: "試験", modelName: "M350" } });
    expect(upd.status()).toBe(200);
    // 機体の取消
    for (const [ctx, status] of [
      [pilot, 403],
      [viewer, 403],
      [anon, 401],
    ] as const) {
      expect((await ctx.post(`/api/ops/aircraft/${aircraft.id}/void`, { data: { expectedVersion: 2, reason: "試験" } })).status()).toBe(status);
    }
    expect((await manager.post(`/api/ops/aircraft/${aircraft.id}/void`, { data: { expectedVersion: 2, reason: "試験" } })).status()).toBe(200);

    // 操縦者の訂正：自分に結び付いた操縦者は操縦者も 200、他人の操縦者は 403。閲覧者は 403、未ログイン 401、運航管理者 200
    const selfPatch = await pilot.patch(`/api/ops/pilots/${selfPilot.id}`, {
      data: { expectedVersion: selfPilot.version, reason: "有効期限の更新", licenseExpiresOn: "2030-03-31" },
    });
    expect(selfPatch.status()).toBe(200);
    const selfAfter = (await selfPatch.json()) as { version: number };
    expect(
      (await pilot.patch(`/api/ops/pilots/${otherPilot.id}`, { data: { expectedVersion: otherPilot.version, reason: "x", fullName: "x" } })).status(),
    ).toBe(403);
    // 操縦者は自分の行でも、利用者との結び付けは変えられない
    expect(
      (await pilot.patch(`/api/ops/pilots/${selfPilot.id}`, { data: { expectedVersion: selfAfter.version, reason: "x", memberId: null } })).status(),
    ).toBe(403);
    expect(
      (await viewer.patch(`/api/ops/pilots/${selfPilot.id}`, { data: { expectedVersion: selfAfter.version, reason: "x", fullName: "x" } })).status(),
    ).toBe(403);
    expect(
      (await anon.patch(`/api/ops/pilots/${selfPilot.id}`, { data: { expectedVersion: selfAfter.version, reason: "x", fullName: "x" } })).status(),
    ).toBe(401);
    const mgrPilot = await manager.patch(`/api/ops/pilots/${otherPilot.id}`, {
      data: { expectedVersion: otherPilot.version, reason: "限定事項の訂正", limitationDaytime: true },
    });
    expect(mgrPilot.status()).toBe(200);

    // 利用者の招待
    const invite = (email: string) => ({ email, displayName: "招待試験", role: "viewer" });
    for (const [ctx, status] of [
      [pilot, 403],
      [viewer, 403],
      [anon, 401],
    ] as const) {
      expect((await ctx.post("/api/ops/members", { data: invite(`denied-${status}@example.test`) })).status()).toBe(status);
    }
    const tempEmail = `e2e-temp-${Date.now()}@example.test`;
    const invited = await manager.post("/api/ops/members", { data: invite(tempEmail) });
    expect(invited.status()).toBe(201);
    const temp = (await invited.json()) as { id: string; version: number };

    // 役割の変更
    for (const [ctx, status] of [
      [pilot, 403],
      [viewer, 403],
      [anon, 401],
    ] as const) {
      const r = await ctx.patch(`/api/ops/members/${viewerMember.id}`, {
        data: { expectedVersion: viewerMember.version, reason: "x", role: "manager" },
      });
      expect(r.status()).toBe(status);
    }
    const roleChange = await manager.patch(`/api/ops/members/${temp.id}`, {
      data: { expectedVersion: temp.version, reason: "役割の見直し", role: "pilot" },
    });
    expect(roleChange.status()).toBe(200);
    const tempAfter = (await roleChange.json()) as { version: number; role: string };
    expect(tempAfter.role).toBe("pilot");

    // 停止された利用者は次の要求から 403
    const tempUser = await apiAs({ authUserId: `auth-temp-${Date.now()}`, email: tempEmail, emailVerified: true });
    expect((await tempUser.get("/api/ops/me")).status()).toBe(200);
    const meNow = ((await (await manager.get(`/api/ops/members/${temp.id}`)).json()) as { version: number }).version;
    const disable = await manager.patch(`/api/ops/members/${temp.id}`, { data: { expectedVersion: meNow, reason: "退職", status: "disabled" } });
    expect(disable.status()).toBe(200);
    expect((await tempUser.get("/api/ops/me")).status()).toBe(403);
    expect((await tempUser.get("/api/ops/aircraft")).status()).toBe(403);

    for (const c of [manager, pilot, viewer, anon, tempUser]) await c.dispose();
  });

  test("14. 理由なしの訂正・取消は 400。取消した機体は既定の一覧に出ず、詳細と版の一覧には残る。DELETE は 405 で行が残る", async () => {
    const manager = await apiAs(seeded("a-manager"));
    const mark = uniqueMark();
    const a = (await (await manager.post("/api/ops/aircraft", { data: { ...AIRCRAFT, registrationMark: mark } })).json()) as { id: string };
    const noReason = await manager.patch(`/api/ops/aircraft/${a.id}`, { data: { expectedVersion: 1, modelName: "X" } });
    expect(noReason.status()).toBe(400);
    expect(await noReason.json()).toMatchObject({ error: "invalid_input", fields: { reason: expect.any(String) } });
    expect((await manager.post(`/api/ops/aircraft/${a.id}/void`, { data: { expectedVersion: 1, reason: " " } })).status()).toBe(400);
    expect((await manager.post(`/api/ops/aircraft/${a.id}/void`, { data: { expectedVersion: 1, reason: "誤登録" } })).status()).toBe(200);

    const list = (await (await manager.get("/api/ops/aircraft")).json()) as { aircraft: { id: string }[] };
    expect(list.aircraft.map((x) => x.id)).not.toContain(a.id);
    const all = (await (await manager.get("/api/ops/aircraft?includeVoided=1")).json()) as { aircraft: { id: string; voided: boolean }[] };
    expect(all.aircraft.find((x) => x.id === a.id)).toMatchObject({ voided: true });
    const detail = await manager.get(`/api/ops/aircraft/${a.id}`);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toMatchObject({ registrationMark: mark, voided: true });
    const versions = (await (await manager.get(`/api/ops/aircraft/${a.id}/versions`)).json()) as { versions: { op: string; reason: string | null }[] };
    expect(versions.versions.map((v) => v.op)).toEqual(["create", "void"]);
    expect(versions.versions[1]!.reason).toBe("誤登録");

    const del = await manager.delete(`/api/ops/aircraft/${a.id}`);
    expect(del.status()).toBe(405);
    expect((await manager.get(`/api/ops/aircraft/${a.id}`)).status()).toBe(200);
    // 他の組織の機体の ID は 404
    const b = await apiAs(seeded("b-manager"));
    expect((await b.get(`/api/ops/aircraft/${a.id}`)).status()).toBe(404);
    await manager.dispose();
    await b.dispose();
  });

  test("17. 運航管理者が画面で機体を登録し、型式名を理由付きで訂正すると、版の一覧に登録・訂正の 2 行が出る", async ({ page }) => {
    await pageAs(page, seeded("a-manager"));
    await page.goto("/ops/aircraft/new");
    const mark = uniqueMark();
    await page.getByLabel("登録記号").fill(mark.toLowerCase());
    await page.getByLabel("型式名").fill("Mavic 3 Enterprise");
    await page.getByLabel("設計製造者").fill("DJI");
    await page.getByLabel("製造番号").fill("SN-UI-1");
    await page.getByLabel("既存の総飛行時間（時間）").fill("12");
    await page.getByLabel("既存の総飛行時間（分）").fill("30");
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page).toHaveURL(/\/ops\/aircraft\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(mark);
    await expect(page.getByTestId("aircraft-detail")).toContainText("12:30");
    await expect(page.getByTestId("version-row")).toHaveCount(1);

    const form = page.getByRole("form", { name: "機体の訂正" });
    await form.getByLabel("型式名").fill("Mavic 3T");
    await form.getByLabel("訂正の理由").fill("型式名の誤記を訂正");
    const before = Date.now();
    await form.getByRole("button", { name: "訂正する" }).click();
    await expect(page.getByTestId("version-row")).toHaveCount(2);
    const row = page.getByTestId("version-row").nth(1);
    await expect(row.getByTestId("version-op")).toHaveText("訂正");
    await expect(row.getByTestId("version-actor")).toHaveText("運航 管理子");
    await expect(row.getByTestId("version-reason")).toHaveText("理由：型式名の誤記を訂正");
    await expect(row.getByTestId("version-changed")).toHaveText("変わった項目：型式名");
    const shown = (await row.getByTestId("version-time").textContent()) ?? "";
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // 日本時間（UTC+9）の分までで、操作した時刻と 2 分以内
    const asUtc = Date.parse(`${shown.replace(" ", "T")}:00+09:00`);
    expect(Math.abs(asUtc - before)).toBeLessThan(2 * 60 * 1000);
    await expect(page.getByTestId("aircraft-detail")).toContainText("Mavic 3T");
    const first = page.getByTestId("version-row").nth(0);
    await expect(first.getByTestId("version-op")).toHaveText("登録");
  });

  test("18. 技能証明書番号：一覧は末尾 4 桁以外を伏せ、詳細は運航管理者と本人にだけ全桁", async () => {
    const manager = await apiAs(seeded("a-manager"));
    const pilot = await apiAs(seeded("a-pilot"));
    const viewer = await apiAs(seeded("a-viewer"));
    const listRes = await manager.get("/api/ops/pilots");
    const listText = await listRes.text();
    const list = JSON.parse(listText) as { pilots: { id: string; fullName: string; licenseNumber: string | null }[] };
    const self = list.pilots.find((p) => p.fullName === "操縦 一郎")!;
    const other = list.pilots.find((p) => p.fullName === "操縦 二郎")!;
    expect(self.licenseNumber).toBe("*********2222");
    expect(other.licenseNumber).toBe("*********4444");
    expect(listText).not.toContain("1111");
    expect(listText).not.toContain("3333");
    for (const ctx of [pilot, viewer]) {
      const t = await (await ctx.get("/api/ops/pilots")).text();
      expect(t).not.toContain("TEST-1111");
      expect(t).not.toContain("TEST-3333");
    }

    const detail = async (ctx: APIRequestContext, id: string) => {
      const r = await ctx.get(`/api/ops/pilots/${id}`);
      expect(r.status()).toBe(200);
      const text = await r.text();
      return { text, json: JSON.parse(text) as { licenseNumber: string; licenseNumberMasked: boolean } };
    };
    // 運航管理者：両方とも全桁
    expect((await detail(manager, self.id)).json.licenseNumber).toBe("TEST-11112222");
    expect((await detail(manager, other.id)).json.licenseNumber).toBe("TEST-33334444");
    // 本人：自分の分だけ全桁、他の操縦者は伏せた値だけ
    expect((await detail(pilot, self.id)).json).toMatchObject({ licenseNumber: "TEST-11112222", licenseNumberMasked: false });
    const pOther = await detail(pilot, other.id);
    expect(pOther.json).toMatchObject({ licenseNumber: "*********4444", licenseNumberMasked: true });
    expect(pOther.text).not.toContain("3333");
    // 閲覧者：伏せた値だけ
    for (const id of [self.id, other.id]) {
      const v = await detail(viewer, id);
      expect(v.json.licenseNumberMasked).toBe(true);
      expect(v.text).not.toContain("TEST-");
    }
    // 版の一覧の応答にも番号を含めない
    const vt = await (await viewer.get(`/api/ops/pilots/${self.id}/versions`)).text();
    expect(vt).not.toContain("1111");
    for (const c of [manager, pilot, viewer]) await c.dispose();
  });

  test("20. スマートフォン幅 375px で /ops/aircraft と /ops/aircraft/new に横スクロールがない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await pageAs(page, seeded("a-manager"));
    for (const path of ["/ops/aircraft", "/ops/aircraft/new", "/ops", "/ops/pilots"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).or(page.getByTestId("ops-me-name"))).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, path).toBeLessThanOrEqual(clientWidth);
    }
  });
});
