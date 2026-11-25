import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { measureTextZoom, waitForSettledStyles } from "../field-checks";

// Sprint 16-L の E2E-DB（契約 L-1〜L-5、§17 の 16-L の申し送り）。
//   L-1  通報・計画の詳細・事故・登録系の画面が新しい部品で描かれる（旧い class 0、主ボタンは各画面・各状態で 1 つ以下、押す部品 48px、本文 14px 以上、
//        320〜430 幅で横スクロール 0、文字 200%（320・390・430）で横スクロール 0・切れ 0）。事故の詳細は、報告の記録・確認の記録のフォームを開いても主ボタンは 1 つ。
//   L-3  判定不能の項目のシートに「必ず」が出ない（エンジンの文は変えず、画面の側で外す）。
//   L-4  閲覧だけの利用者が古い判定を開いたとき、judgement-primary は主ボタンにならない（再判定できる人は再判定が主）。
//   E-5  日誌から点検へ移ったときの注記が 360×740 で下部ナビの手前に収まる。
//   §17  /ops/about の文字 200% の横スクロール、計画の一覧の plan-report のチップの 320・200% の折り返し。
// L-5（長さの上限を元の値に戻す）は sprint17-2-db が元の値で通ることで確かめる。
// 固定ナビの画面の「最初の画面に入る」は ops-bottom-nav の上端で測る（16-I の申し送り）。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

type Who = { authUserId: string; email: string };
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

const LEGACY_SELECTOR =
  '[class*="rounded-sharp"], [class*="bg-paper"], [class*="border-brand"], [class*="text-brand"], [class*="signal-"], [class*="ink-soft"], [class*="ink-mute"], [class*="ring-brand"], [class*="border-rule"], .font-mono';
const PRIMARY = '[data-variant="primary"]';
const STRAY = ".opx-btn-primary:not([data-variant]):not(.opx-btn-flat), .sb-pill-primary:not([data-variant])";

const primaryState = (page: Page): Promise<{ ids: string[]; stray: string[] }> =>
  page.evaluate(
    ({ primary, stray }) => {
      const vis = (e: Element): boolean => (e as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true, contentVisibilityAuto: true }) !== false && e.getBoundingClientRect().width > 0;
      const name = (e: Element): string => e.getAttribute("data-testid") ?? e.tagName.toLowerCase();
      return {
        ids: Array.from(document.querySelectorAll(primary)).filter(vis).map(name),
        stray: Array.from(document.querySelectorAll(stray)).filter(vis).map(name),
      };
    },
    { primary: PRIMARY, stray: STRAY },
  );

/** 押す部品（button・select・summary・段落の外のリンク）は 48px 以上。ラベル付きのチェック・ラジオは、ラベルの行で測る。 */
const smallTargets = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    const vis = (e: Element): boolean => (e as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true, contentVisibilityAuto: true }) !== false;
    for (const e of Array.from(document.querySelectorAll<HTMLElement>("main button, main select, main summary, main a[href], main label:has(input[type=checkbox]), main label:has(input[type=radio])"))) {
      if (!vis(e) || e.closest(".sr-only, .sb-sr")) continue;
      if (e.tagName === "A" && getComputedStyle(e).display === "inline") continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 47.5) out.push(`${e.getAttribute("data-testid") ?? e.tagName.toLowerCase()}「${(e.textContent ?? "").trim().slice(0, 14)}」 ${Math.round(r.height)}px`);
    }
    return out;
  });

/** 14px 未満の文字（文字を持つ要素）。 */
const tinyText = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const e of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
      const own = Array.from(e.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
      if (!own || e.closest(".sr-only, .sb-sr")) continue;
      if (!(e.checkVisibility?.({ checkVisibilityCSS: true }) ?? true)) continue;
      const fs = parseFloat(getComputedStyle(e).fontSize);
      if (fs < 13.99) out.push(`${e.tagName.toLowerCase()} ${fs}px`);
    }
    return out.slice(0, 8);
  });

const noHScroll = async (page: Page, label: string): Promise<void> => {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(m.s, `${label}: 横スクロール（${m.s} > ${m.c}）`).toBeLessThanOrEqual(m.c);
};

/** 文字 200%（K-5）。入力欄の中の長い値は欄の中で読む（入力欄の overflow は意図したもの）ので、入れ物の切れの検査から入力欄だけを除く。 */
const zoom200 = async (page: Page, label: string, widths: readonly number[] = [320, 390, 430]): Promise<void> => {
  for (const w of widths) {
    const r = await measureTextZoom(page, w);
    const l = `${label} 文字 200%・${w}px`;
    expect(r.scrollWidth, `${l}: 横スクロール`).toBeLessThanOrEqual(r.clientWidth);
    expect(r.clipped, `${l}: 文字の切れ`).toEqual([]);
    expect(r.clippedContainers.filter((c) => !c.startsWith("input")), `${l}: 入れ物の切れ`).toEqual([]);
    expect(r.unreachablePrimary, `${l}: 届かない主ボタン`).toEqual([]);
    expect(r.navCoversLast, `${l}: 下部ナビが最後の要素を隠す`).toBe(0);
  }
};

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });
test.describe.configure({ mode: "serial" });

type Ids = { aircraftId: string; pilotId: string; permitId: string; placeId: string; incidentId: string; planId: string; viewerPlanId: string; unknownPlanId: string; freshPlanId: string };
let manager: APIRequestContext;
let ids: Ids;

test.beforeAll(async () => {
  manager = await apiAs(seeded("a-manager"));
  const mark = `JUL16${stamp}`;
  const a = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "L16 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(a.status(), await a.text()).toBe(201);
  const aircraft = (await a.json()) as { id: string; version: number };
  const me = await apiAs(seeded("a-pilot"));
  const pilotId = ((await (await me.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
  await me.dispose();
  const perm = await manager.post("/api/ops/permits", {
    data: { permitNumber: `E2E-L16-${stamp}`, coverage: "blanket", kinds: ["night"], issuedOn: "2026-10-01", validFrom: "2026-10-01", validTo: "2027-09-30", placeScope: { type: "nationwide" }, aircraftScope: { type: "any" }, pilotScope: { type: "any" } },
  });
  expect(perm.status(), await perm.text()).toBe(201);
  const pl = await manager.post("/api/ops/places", { data: { name: `L16 地点${stamp}`, latitude: 35.1, longitude: 133.1 } });
  expect(pl.status(), await pl.text()).toBe(201);
  const inc = await manager.post("/api/ops/incidents", { data: { mode: "full", kind: "near_miss", occurredAt: "2027-01-05T11:00", summary: `L16 ${stamp}`, eventTypes: ["near_collision"], peopleInjury: "no", aircraftDamage: "no" } });
  expect(inc.status(), await inc.text()).toBe(201);
  const mkPlan = async (extra: object = {}) => {
    const p = await manager.post("/api/ops/plans", {
      data: { title: `L16 ${stamp}-${seq++}`, aircraftId: aircraft.id, pilotId, plannedStartAt: "2027-01-10T10:00", durationMinutes: 30, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, radiusM: 200, maxAltitudeM: 100, flags: [], ...extra },
    });
    expect(p.status(), await p.text()).toBe(201);
    return (await p.json()) as { id: string; version: number };
  };
  const plan = await mkPlan();
  // DID の該当を確認できない地点（sprint12a の UNVERIFIED_SPOT と同じ）：判定不能の項目にエンジンの文（「…DIPS で必ず確認してください」）が出る
  const unknownPlan = await mkPlan({ latitude: 35.0, longitude: 133.0 });
  await manager.post(`/api/ops/plans/${plan.id}/request-confirmation`, { data: { expectedVersion: plan.version } });
  // 判定が古い計画（機体の重量を訂正して再判定していない）
  const stale = await mkPlan();
  const patch = await manager.patch(`/api/ops/aircraft/${aircraft.id}`, { data: { maxTakeoffWeightKg: 1.5, expectedVersion: aircraft.version, reason: "重量の訂正" } });
  expect(patch.status(), await patch.text()).toBe(200);
  // 重量の訂正のあとに作った計画は、判定が新しい
  const fresh = await mkPlan();
  ids = {
    aircraftId: aircraft.id,
    pilotId,
    permitId: ((await perm.json()) as { id: string }).id,
    placeId: ((await pl.json()) as { id: string }).id,
    incidentId: ((await inc.json()) as { id: string }).id,
    planId: plan.id,
    viewerPlanId: stale.id,
    unknownPlanId: unknownPlan.id,
    freshPlanId: fresh.id,
  };
});
test.afterAll(async () => {
  await manager.dispose();
});

const login = async (page: Page, who = "a-manager") => {
  await signIn(page.request, seeded(who));
};

// 画面ごとの主ボタンの数（運航管理者）。入力・訂正の画面は保存の 1 つ、一覧は「新しく作る」の 1 つ、詳細は内容の訂正の 1 つ。
const screens = (): { name: string; path: string; primaries: string[] | number }[] => [
  { name: "このアプリについて", path: "/ops/about", primaries: 0 },
  { name: "機体の一覧", path: "/ops/aircraft", primaries: 1 },
  { name: "機体の登録", path: "/ops/aircraft/new", primaries: 1 },
  { name: "機体の詳細", path: `/ops/aircraft/${ids.aircraftId}`, primaries: 1 },
  { name: "操縦者の一覧", path: "/ops/pilots", primaries: 1 },
  { name: "操縦者の登録", path: "/ops/pilots/new", primaries: 1 },
  { name: "操縦者の詳細", path: `/ops/pilots/${ids.pilotId}`, primaries: 1 },
  { name: "許可・承認の一覧", path: "/ops/permits", primaries: ["permit-new-link"] },
  { name: "許可・承認の登録", path: "/ops/permits/new", primaries: ["permit-submit"] },
  { name: "許可・承認の詳細", path: `/ops/permits/${ids.permitId}`, primaries: ["permit-submit"] },
  { name: "地点の一覧", path: "/ops/places", primaries: ["place-new-link"] },
  { name: "地点の登録", path: "/ops/places/new", primaries: ["place-submit"] },
  { name: "地点の詳細", path: `/ops/places/${ids.placeId}`, primaries: ["place-submit"] },
  { name: "利用者", path: "/ops/members", primaries: 1 },
  { name: "事故・ヒヤリハットの一覧", path: "/ops/incidents", primaries: ["incident-new-link"] },
  { name: "事故・ヒヤリハットの記録", path: "/ops/incidents/new", primaries: ["incident-submit"] },
  { name: "事故・ヒヤリハットの詳細", path: `/ops/incidents/${ids.incidentId}`, primaries: ["incident-submit"] },
  { name: "計画の一覧", path: "/ops/plans", primaries: ["plan-new-link"] },
  { name: "計画の主画面（通報）", path: `/ops/plans/${ids.planId}`, primaries: ["plan-primary-action"] },
  { name: "計画の概要", path: `/ops/plans/${ids.planId}/overview`, primaries: ["plan-confirm-approve"] },
  { name: "通報の作業台", path: `/ops/plans/${ids.planId}/report`, primaries: ["record-submit"] },
];

test.describe("L-1 載せ替えた画面の共通の基準", () => {
  test("旧い名前の class 0・主ボタンは契約の数・押す部品 48px・文字 14px 以上・320〜430 幅の横スクロール 0（375×812）", async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    for (const s of screens()) {
      await page.goto(s.path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(page.locator("main").first()).toBeVisible();
      await waitForSettledStyles(page);
      expect(await page.locator(LEGACY_SELECTOR).count(), `${s.name}: 旧い名前の class`).toBe(0);
      const p = await primaryState(page);
      if (typeof s.primaries === "number") expect(p.ids.length, `${s.name}: 見えている主ボタン ${JSON.stringify(p.ids)}`).toBe(s.primaries);
      else expect(p.ids, `${s.name}: 見えている主ボタン`).toEqual(s.primaries);
      expect(p.stray, `${s.name}: data-variant の無い主色のボタン`).toEqual([]);
      expect(await smallTargets(page), `${s.name}: 48px 未満の押す部品`).toEqual([]);
      expect(await tinyText(page), `${s.name}: 14px 未満の文字`).toEqual([]);
      for (const w of [320, 360, 375, 390, 430]) {
        await page.setViewportSize({ width: w, height: 812 });
        await noHScroll(page, `${s.name} ${w}px`);
      }
      await page.setViewportSize({ width: 375, height: 812 });
    }
  });

  test("文字 200%（320・390・430）：横スクロール 0・文字の切れ 0・主ボタンに届く・下部ナビが最後を隠さない", async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    for (const s of screens()) {
      await page.goto(s.path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(page.locator("main").first()).toBeVisible();
      await zoom200(page, s.name);
    }
  });
});

test.describe("L-1・K-8 事故・ヒヤリハットの詳細", () => {
  test("運航管理者：主ボタンは訂正の保存の 1 つ。報告の記録・確認の記録のフォームを開いても 1 つのまま（フォームの送信は副ボタン）。閲覧者は 0", async ({ page }) => {
    await login(page);
    await page.goto(`/ops/incidents/${ids.incidentId}`);
    await expect(page.getByTestId("incident-detail-page")).toBeVisible();
    expect((await primaryState(page)).ids).toEqual(["incident-submit"]);
    await page.getByTestId("incident-report-open").click();
    await expect(page.getByTestId("incident-report-form")).toBeVisible();
    expect((await primaryState(page)).ids, "報告の記録を開いた").toEqual(["incident-submit"]);
    await expect(page.getByTestId("incident-report-submit")).not.toHaveAttribute("data-variant", "primary");
    await page.getByTestId("incident-consult-open").click();
    await expect(page.getByTestId("incident-consult-form")).toBeVisible();
    expect((await primaryState(page)).ids, "確認の記録も開いた").toEqual(["incident-submit"]);
    await expect(page.getByTestId("incident-follow-up-update-submit")).not.toHaveAttribute("data-variant", "primary");
    // 閲覧者
    await login(page, "a-viewer");
    await page.goto(`/ops/incidents/${ids.incidentId}`);
    await expect(page.getByTestId("incident-detail-page")).toBeVisible();
    expect((await primaryState(page)).ids, "閲覧者").toEqual([]);
  });

  test("事故・ヒヤリハットの記録（320 幅・文字 200%）：題と「考えられる要因」の見出しが折り返して横にはみ出さない", async ({ page }) => {
    await login(page);
    await page.goto("/ops/incidents/new");
    await expect(page.getByTestId("incident-form")).toBeVisible();
    await zoom200(page, "事故・ヒヤリハットの記録", [320]);
  });
});

test.describe("§17 申し送り（16-L）", () => {
  test("/ops/about：文字 200% の 320・360・390・430 で横スクロール 0（メールのリンクが折り返す）", async ({ page }) => {
    await login(page);
    await page.goto("/ops/about");
    await expect(page.getByTestId("ops-about")).toBeVisible();
    for (const w of [320, 360, 390, 430]) {
      await page.setViewportSize({ width: w, height: 812 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await noHScroll(page, `about 200% ${w}px`);
      const mail = (await page.getByRole("link", { name: /@/ }).first().boundingBox())!;
      expect(mail.x + mail.width, `メールのリンクの右端（${w}px）`).toBeLessThanOrEqual(w + 0.5);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
  });

  test("計画の一覧：plan-report のチップ（通報：…）が 320・文字 200% で折り返し、文書の幅が 320 以内", async ({ page }) => {
    await login(page);
    await page.goto("/ops/plans");
    await expect(page.getByTestId("plan-report").first()).toBeVisible();
    await zoom200(page, "計画の一覧", [320]);
    // 長い方の札（要確認）も、折り返して札の中に収まる
    await page.setViewportSize({ width: 320, height: 812 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const boxes = await page.getByTestId("plan-report").evaluateAll((els) => els.slice(0, 20).map((e) => ({ r: e.getBoundingClientRect().right, w: e.getBoundingClientRect().width, sw: (e as HTMLElement).scrollWidth, cw: (e as HTMLElement).clientWidth })));
    for (const b of boxes) {
      expect(b.r, "札の右端").toBeLessThanOrEqual(320 + 0.5);
      expect(b.sw, "札の中身が札からはみ出さない").toBeLessThanOrEqual(b.cw + 1);
    }
  });

  test.describe("E-5 日誌から点検へ移ったとき（360×740）", () => {
    test.use({ viewport: { width: 360, height: 740 } });
    test("離陸より後の実施日時の注記は、最初の画面で下部ナビの上端の手前に全体が入る。「今」は 48px 以上で、日付・時刻の入力欄と重ならない", async ({ page }) => {
      await login(page);
      await page.clock.setFixedTime(new Date("2027-01-05T11:30:00+09:00"));
      await page.goto(`/ops/inspections/new?aircraftId=${ids.aircraftId}&takeoffAt=2027-01-05T11:00`);
      const note = page.getByTestId("inspection-after-takeoff");
      await expect(note).toBeVisible();
      await waitForSettledStyles(page);
      const n = (await note.boundingBox())!;
      const nav = (await page.getByTestId("ops-bottom-nav").boundingBox())!;
      expect(n.y + n.height, `注記の下端 ${n.y + n.height} は下部ナビの上端（${nav.y}）以内`).toBeLessThanOrEqual(nav.y);
      const now = (await page.getByRole("button", { name: "今", exact: true }).boundingBox())!;
      expect(now.height).toBeGreaterThanOrEqual(47.5);
      expect(now.width).toBeGreaterThanOrEqual(47.5);
      for (const label of ["実施日", "実施時刻"]) {
        const input = (await page.getByLabel(label, { exact: true }).first().boundingBox())!;
        const overlap = now.x < input.x + input.width && now.x + now.width > input.x && now.y < input.y + input.height && now.y + now.height > input.y;
        expect(overlap, `「今」と ${label} の入力欄が重ならない`).toBe(false);
        expect(input.y - (now.y + now.height), `「今」と ${label} の間（8px 以上）`).toBeGreaterThanOrEqual(8 - 0.5);
      }
      // 「今」を押すと実施時刻が今に入る（動きは今までと同じ）
      await page.getByRole("button", { name: "今", exact: true }).click();
      await expect(page.getByLabel("実施時刻", { exact: true })).toHaveValue("11:30");
      await noHScroll(page, "点検の入力（日誌から）");
      // 320 幅の標準の日付・時刻の入力欄は、文字 200% で 2 列に収まらない（16-J の S-2。基準でも同じ。16-N で扱う）ので、390・430 で測る
      await zoom200(page, "点検の入力（日誌から）", [390, 430]);
    });
  });
});

test.describe("L-3・L-4 判定の画面", () => {
  test("L-3. 判定不能の項目を含め、どのタイルのシートにも「必ず」が出ない。判定不能の文は「…で確認してください」で出る", async ({ page }) => {
    await login(page);
    await page.goto(`/ops/plans/${ids.unknownPlanId}/judgement`);
    await expect(page.getByTestId("judgement-total")).toBeVisible();
    const tiles = page.getByTestId("judgement-tile");
    const n = await tiles.count();
    expect(n).toBeGreaterThan(0);
    const reasons: string[] = [];
    for (let i = 0; i < n; i++) {
      await tiles.nth(i).click();
      await expect(page.getByTestId("judgement-sheet-detail")).toBeVisible();
      const detail = await page.getByTestId("judgement-sheet-detail").innerText();
      expect(detail, `タイル ${i} のシート`).not.toContain("必ず");
      reasons.push(await page.getByTestId("judgement-sheet-reason").innerText());
      await page.getByTestId("judgement-sheet-close").click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    // DID の該当を確認できない地点の判定不能の理由。エンジンの文のうち「必ず」だけを外して出す
    const unknown = reasons.find((r) => r.includes("確認できません（未確認）"));
    expect(unknown, `判定不能の理由が出ている（${JSON.stringify(reasons)}）`).toBeTruthy();
    expect(unknown!).toContain("地理院地図・DIPS で確認してください");
  });

  test("L-4. 判定が古いとき：閲覧だけの利用者は主ボタン無し（judgement-primary は副ボタンで、案内が出る）。計画を変更できる運航管理者は再判定が主ボタンの 1 つ", async ({ page }) => {
    await login(page, "a-viewer");
    await page.goto(`/ops/plans/${ids.viewerPlanId}/judgement`);
    await expect(page.getByTestId("judgement-total")).toHaveAttribute("data-stale", "true");
    await expect(page.getByTestId("plan-stale-readonly-note")).toBeVisible();
    expect((await primaryState(page)).ids, "閲覧だけ・古いとき").toEqual([]);
    await expect(page.getByTestId("judgement-primary")).toBeVisible();
    await expect(page.getByTestId("judgement-primary")).not.toHaveAttribute("data-variant", "primary");
    await expect(page.getByTestId("plan-rejudge")).toHaveCount(0);
    await login(page, "a-manager");
    await page.goto(`/ops/plans/${ids.viewerPlanId}/judgement`);
    await expect(page.getByTestId("plan-rejudge")).toBeVisible();
    expect((await primaryState(page)).ids, "運航管理者・古いとき").toEqual(["plan-rejudge"]);
    // 新しいとき：閲覧者でも judgement-primary が主（今までと同じ）
    await login(page, "a-viewer");
    await page.goto(`/ops/plans/${ids.freshPlanId}/judgement`);
    await expect(page.getByTestId("judgement-total")).toHaveAttribute("data-stale", "false");
    await expect(page.getByTestId("judgement-primary")).toBeVisible(); // 本文は Suspense で後から出る
    expect((await primaryState(page)).ids, "閲覧者・新しいとき").toEqual(["judgement-primary"]);
  });
});

test.describe("K-15 端末データ", () => {
  test("載せ替えた画面を開いても、localStorage・sessionStorage に新しい鍵が増えない", async ({ page }) => {
    await login(page);
    await page.goto("/ops/about");
    await expect(page.getByTestId("ops-about")).toBeVisible();
    const keys = () => page.evaluate(() => ({ l: Object.keys(localStorage).sort(), s: Object.keys(sessionStorage).sort() }));
    const before = await keys();
    for (const path of [`/ops/incidents/${ids.incidentId}`, `/ops/permits/${ids.permitId}`, `/ops/plans/${ids.planId}/overview`]) {
      await page.goto(path);
      await expect(page.locator("main").first()).toBeVisible();
    }
    const after = await keys();
    expect(after).toEqual(before);
  });
});
