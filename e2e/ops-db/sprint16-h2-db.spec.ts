import { readFileSync } from "node:fs";
import { expect, request as pwRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTextZoom, waitForSettledStyles } from "../field-checks";
import { expectStep, fillStep, tapNext, walkWizard, clickSave, type WizardValues } from "./plan-wizard";

// Sprint 16-H2 の E2E-DB：計画作成 2（日時のクイック選択・判定の画面の 3 層・訂正の載せ替え）。契約 H2-1〜H2-5、§17 の 12・13。
// H2-1 クイック選択／断り書きが段 ①⑤ で見え ②〜④ で隠れる／段 ② の主ボタンが下部ナビに半分隠れない／
// H2-2 判定の 3 層（総合・タイル・シート）／H2-3 主ボタン 1 つ／H2-4 訂正の載せ替え・緯度経度の 200%・シートの Esc（変換中）／H2-5 は sprint17-2-db。
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

const PRIMARY = '.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]';
const visiblePrimaries = (page: Page): Promise<string[]> =>
  page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        })
        .map((el) => el.getAttribute("data-testid") ?? el.textContent?.trim() ?? el.tagName),
    PRIMARY,
  );

/** 日本時間の日付（YYYY-MM-DD）。 */
const jst = (d: Date): string => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);

const NIGHT_SPOT = { lat: 35.44, lng: 133.35 };
const LEDGER = (JSON.parse(readFileSync(`${process.cwd()}/packages/regulations/data/sources.json`, "utf8")) as { datasets: { id: string; name: string; url: string; verifiedAt: string; provider: string; version: string }[] }).datasets;

/** リンクを押して、遷移するまで押し直す（§17 申し送り 9 の揺れ。goto で逃げない）。 */
const tapUntil = async (page: Page, target: Locator, url: RegExp): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await target.click();
    try {
      await page.waitForURL(url, { timeout: 8_000, waitUntil: "commit" });
      return;
    } catch {
      // 押し直す
    }
  }
  await page.waitForURL(url);
};

test.use({ viewport: { width: 375, height: 812 }, hasTouch: false });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 16-H2 E2E-DB：計画作成 2", () => {
  let manager: APIRequestContext;
  let aircraft: { id: string; registrationMark: string; version: number };
  let pilotId = "";

  const mkAircraft = async (extra: object = {}): Promise<{ id: string; registrationMark: string; version: number }> => {
    const registrationMark = `JUSH2${stamp}${seq++}`;
    const r = await manager.post("/api/ops/aircraft", {
      data: { registrationMark, modelName: "H2 試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9, ...extra },
    });
    expect(r.status()).toBe(201);
    return { ...((await r.json()) as { id: string; version: number }), registrationMark };
  };
  const mkPlan = async (acId: string, extra: object = {}): Promise<{ id: string; version: number; currentSnapshotId: string; title: string }> => {
    const r = await manager.post("/api/ops/plans", {
      data: {
        title: `H2 計画 ${stamp}-${seq++}`,
        aircraftId: acId,
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
    return (await r.json()) as { id: string; version: number; currentSnapshotId: string; title: string };
  };

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    aircraft = await mkAircraft();
    const pilotCtx = await apiAs(seeded("a-pilot"));
    pilotId = ((await (await pilotCtx.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await pilotCtx.dispose();
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const login = async (page: Page, who = "a-manager"): Promise<void> => {
    await page.route("**/_next/**", (route) => route.continue());
    await signIn(page.request, seeded(who));
  };
  const openWizard = async (page: Page, url = "/ops/plans/new"): Promise<void> => {
    await login(page);
    await page.goto(url);
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
  };
  const toStep2 = async (page: Page): Promise<void> => {
    await fillStep(page, 1, { placeName: "H2 試験地点", lat: "35.123456", lng: "133.654321", radius: "120" });
    await tapNext(page);
    await expectStep(page, 2);
  };
  const full = (label: string): WizardValues => ({
    placeName: `H2 試験地点 ${label}`,
    lat: "35.123456",
    lng: "133.654321",
    radius: "120",
    title: `E2E H2 ${label}`,
    purpose: "橋梁の点検",
    altitude: "60",
    flags: ["method_night"],
    aircraftId: aircraft.id,
    pilotId,
    notes: "",
  });
  const quick = (page: Page, id: string): Locator => page.getByTestId(id);

  // ---------------- H2-1 ----------------

  test("H2-1. 段 ②：今日・明日・30 分刻みの開始・飛行時間（15・30・60・90）のクイック選択。aria-pressed・押す部品 48px 以上・標準の入力欄も残る。保存した値が一致", async ({ page }) => {
    await openWizard(page);
    await toStep2(page);
    // 標準の日付・時刻・数値の入力欄は残る（クイック選択だけにしない）
    await expect(page.getByTestId("plan-start-date")).toHaveAttribute("type", "date");
    await expect(page.getByTestId("plan-start-time")).toHaveAttribute("type", "time");
    await expect(page.getByTestId("plan-duration")).toBeVisible();
    // クイック選択は入力欄より先（DOM の順）
    const order = await page.evaluate(() => {
      const q = document.querySelector('[data-testid="plan-quick"]')!;
      const d = document.querySelector('[data-testid="plan-start-date"]')!;
      return Boolean(q.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order, "クイック選択が日付の入力欄より前にある").toBe(true);

    const today = jst(new Date());
    const tomorrow = jst(new Date(Date.now() + 24 * 3600 * 1000));
    // 最初は何も押されていない
    await expect(quick(page, "plan-quick-today")).toHaveAttribute("aria-pressed", "false");
    await expect(quick(page, "plan-quick-tomorrow")).toHaveAttribute("aria-pressed", "false");
    // 明日 → 入力欄に入り、押された状態（排他）
    await quick(page, "plan-quick-tomorrow").click();
    await expect(page.getByTestId("plan-start-date")).toHaveValue(tomorrow);
    await expect(quick(page, "plan-quick-tomorrow")).toHaveAttribute("aria-pressed", "true");
    await expect(quick(page, "plan-quick-today")).toHaveAttribute("aria-pressed", "false");
    // 今日 → 入力欄に入り、押された状態
    await quick(page, "plan-quick-today").click();
    await expect(page.getByTestId("plan-start-date")).toHaveValue(today);
    await expect(quick(page, "plan-quick-today")).toHaveAttribute("aria-pressed", "true");
    await expect(quick(page, "plan-quick-tomorrow")).toHaveAttribute("aria-pressed", "false");
    // 今日の開始時刻の候補は、今より後の 30 分刻み（過去の時刻を出さない）
    const todaySlots = await page.locator('[data-testid="plan-quick-time"] button').allTextContents();
    for (const s of todaySlots) expect(s.trim()).toMatch(/^\d{2}:(00|30)$/);
    expect(todaySlots.length).toBeLessThanOrEqual(12);
    // 日付を入力欄で変えると、今日・明日の押された状態は外れる
    await page.getByTestId("plan-start-date").fill("2027-03-05");
    await expect(quick(page, "plan-quick-today")).toHaveAttribute("aria-pressed", "false");
    await expect(quick(page, "plan-quick-tomorrow")).toHaveAttribute("aria-pressed", "false");

    // 明日に戻し、08:00 から 30 分刻み 12 個。09:00 を選ぶ
    await quick(page, "plan-quick-tomorrow").click();
    const slots = (await page.locator('[data-testid="plan-quick-time"] button').allTextContents()).map((s) => s.trim());
    expect(slots).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"]);
    await quick(page, "plan-quick-time-0900").click();
    await expect(page.getByTestId("plan-start-time")).toHaveValue("09:00");
    await expect(quick(page, "plan-quick-time-0900")).toHaveAttribute("aria-pressed", "true");
    await expect(quick(page, "plan-quick-time-0830")).toHaveAttribute("aria-pressed", "false");
    await quick(page, "plan-quick-time-1030").click();
    await expect(quick(page, "plan-quick-time-0900")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("plan-start-time")).toHaveValue("10:30");
    // 時刻を入力欄で変えると外れる
    await page.getByTestId("plan-start-time").fill("10:45");
    await expect(quick(page, "plan-quick-time-1030")).toHaveAttribute("aria-pressed", "false");
    await quick(page, "plan-quick-time-0900").click();

    // 飛行時間：15・30・60・90。数値の入力欄と同期
    for (const m of [15, 30, 60, 90]) {
      await quick(page, `plan-quick-duration-${m}`).click();
      await expect(page.getByTestId("plan-duration")).toHaveValue(String(m));
      for (const o of [15, 30, 60, 90]) await expect(quick(page, `plan-quick-duration-${o}`)).toHaveAttribute("aria-pressed", o === m ? "true" : "false");
    }
    await page.getByTestId("plan-duration").fill("45");
    for (const o of [15, 30, 60, 90]) await expect(quick(page, `plan-quick-duration-${o}`)).toHaveAttribute("aria-pressed", "false");
    await quick(page, "plan-quick-duration-60").click();

    // 押す部品：48×48 以上・隣との間 8px 以上。押された状態は薄い主色の面＋チェックの記号（色だけに頼らない）。押されていないものに記号はない
    const boxes = await page.locator('[data-testid="plan-quick"] button').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const mark = e.querySelector("svg")!;
        const cs = getComputedStyle(e);
        return { id: e.getAttribute("data-testid"), x: r.x, y: r.y, w: r.width, h: r.height, pressed: e.getAttribute("aria-pressed") === "true", markShown: getComputedStyle(mark).display !== "none", bg: cs.backgroundColor, fs: parseFloat(cs.fontSize), text: (e.textContent ?? "").trim() };
      }),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(2 + 12 + 4);
    for (const b of boxes) {
      expect(b.w, `${b.id} 幅`).toBeGreaterThanOrEqual(47.5);
      expect(b.h, `${b.id} 高さ`).toBeGreaterThanOrEqual(47.5);
      expect(b.fs, `${b.id} 文字`).toBeGreaterThanOrEqual(16);
      expect(b.text, `${b.id} 文字がある`).not.toBe("");
      expect(b.markShown, `${b.id} 記号は押された状態だけ`).toBe(b.pressed);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const c = boxes[j]!;
        const dx = Math.max(a.x - (c.x + c.w), c.x - (a.x + a.w));
        const dy = Math.max(a.y - (c.y + c.h), c.y - (a.y + a.h));
        expect(Math.max(dx, dy), `${a.id} と ${c.id} の間`).toBeGreaterThanOrEqual(7.5);
      }
    }
    const pressedBg = new Set(boxes.filter((b) => b.pressed).map((b) => b.bg));
    const plainBg = new Set(boxes.filter((b) => !b.pressed).map((b) => b.bg));
    expect(pressedBg.size).toBe(1);
    expect([...pressedBg][0]).toBe("rgb(232, 240, 253)"); // --sb-primary-soft（薄い主色）
    expect([...plainBg]).not.toContain("rgb(232, 240, 253)");
    // キーボード：Space で押せる
    await quick(page, "plan-quick-duration-30").focus();
    await page.keyboard.press("Space");
    await expect(quick(page, "plan-quick-duration-30")).toHaveAttribute("aria-pressed", "true");
    await quick(page, "plan-quick-duration-60").click();

    // 保存した値が一致（明日 09:00・60 分）
    await tapNext(page);
    await fillStep(page, 3, { title: `E2E H2 quick ${stamp}`, purpose: "橋梁の点検" });
    await tapNext(page);
    await fillStep(page, 4, { aircraftId: aircraft.id, pilotId });
    await tapNext(page);
    await expect(page.getByTestId("plan-review-start")).toContainText(`${tomorrow} 09:00`);
    await expect(page.getByTestId("plan-review-duration")).toHaveText("60 分");
    await clickSave(page);
    await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
    const plan = (await (await manager.get(`/api/ops/plans/${page.url().split("/").pop()}`)).json()) as { plannedStartAt: string; durationMinutes: number };
    expect(String(plan.plannedStartAt)).toContain(`${tomorrow}T09:00`);
    expect(plan.durationMinutes).toBe(60);
  });

  test("H2-1・K-15. クイック選択はストレージに何も書かない", async ({ page }) => {
    await openWizard(page);
    const snap = () =>
      page.evaluate(async () => ({
        local: Object.keys(localStorage).sort(),
        session: Object.keys(sessionStorage).sort(),
        idb: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((d) => d.name ?? "").sort() : [],
      }));
    const before = await snap();
    await toStep2(page);
    await quick(page, "plan-quick-tomorrow").click();
    await quick(page, "plan-quick-time-0900").click();
    await quick(page, "plan-quick-duration-30").click();
    expect(await snap()).toEqual(before);
  });

  // ---------------- 断り書き（§17 申し送り 12） ----------------

  test("断り書き：段 ① と ⑤ では同じ 2 つの断り書き（免責・DIPS の注記）が見え、段 ②〜④ では隠れる", async ({ page }) => {
    await openWizard(page);
    const notes = page.locator("main > div:first-child .opx-note");
    const dips = page.getByTestId("plan-dips-notice");
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0)).toBeVisible();
    await expect(dips).toBeVisible();
    const t1 = [(await notes.nth(0).innerText()).trim(), (await dips.innerText()).trim()];
    expect(t1[0]).not.toBe("");
    expect(t1[1]).toContain("DIPS");
    const v = full("notes");
    await fillStep(page, 1, v);
    await tapNext(page);
    for (const n of [2, 3, 4]) {
      await expectStep(page, n);
      await expect(notes.nth(0), `段 ${n}：免責は隠れる`).toBeHidden();
      await expect(dips, `段 ${n}：DIPS の注記は隠れる`).toBeHidden();
      // 隠れていても DOM の文言は同じ（出し分けは CSS だけ）
      expect((await notes.nth(0).textContent())?.trim()).toBe(t1[0]);
      await fillStep(page, n, { ...v, date: "2027-03-05", time: "10:30", duration: "30" });
      await tapNext(page);
    }
    await expectStep(page, 5);
    await expect(notes.nth(0)).toBeVisible();
    await expect(dips).toBeVisible();
    expect([(await notes.nth(0).innerText()).trim(), (await dips.innerText()).trim()]).toEqual(t1);
  });

  // ---------------- 段 ② の主ボタン（§17 申し送り 12） ----------------

  for (const [w, h] of [[375, 812], [390, 844]] as const) {
    test(`段 ②（${w}×${h}）：主ボタン「次へ」は、最初の画面で下部ナビに重ならない（半分隠れない）。スクロールすれば押せる`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openWizard(page);
      await toStep2(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const geo = await page.evaluate(() => {
        const next = document.querySelector<HTMLElement>('[data-testid="plan-wizard-next"]')!.getBoundingClientRect();
        const nav = document.querySelector<HTMLElement>('[data-testid="ops-bottom-nav"]')!.getBoundingClientRect();
        return { top: next.top, bottom: next.bottom, navTop: nav.top, vh: window.innerHeight };
      });
      // 半分隠れる＝ボタンの一部が下部ナビに重なり、一部は見えている
      const overlap = Math.min(geo.bottom, geo.vh) - Math.max(geo.top, geo.navTop);
      const visiblePart = Math.min(geo.bottom, geo.navTop) - Math.max(geo.top, 0);
      expect(overlap > 0 && visiblePart > 0, `主ボタン（${geo.top.toFixed(0)}〜${geo.bottom.toFixed(0)}）が下部ナビ（上端 ${geo.navTop.toFixed(0)}）に半分隠れている`).toBe(false);
      // 下までスクロールすると、ナビに隠れず押せる（覆われていない）
      await page.getByTestId("plan-wizard-next").scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const covered = await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>('[data-testid="plan-wizard-next"]')!.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !(el && (el.closest('[data-testid="plan-wizard-next"]') !== null));
      });
      expect(covered, "スクロールの最後で、主ボタンの中心がナビなどに覆われている").toBe(false);
    });
  }

  // ---------------- H2-2・H2-3 ----------------

  test("H2-2・H2-3. 判定の画面：総合（形と言葉）→ 項目のタイル → シートの詳細。取得時刻。主ボタンは「DIPS に出す内容を確認」1 つ", async ({ page }) => {
    const ac = await mkAircraft();
    const plan = await mkPlan(ac.id);
    await login(page);
    await page.goto(`/ops/plans/${plan.id}/judgement`);
    await expect(page.locator('[data-testid="plan-tabs"]:visible').first()).toBeVisible();
    await expect(page.getByTestId("judgement-total")).toBeVisible();
    // 保存した判定の項目（API）と、タイルが一致する
    const snap = (await (await manager.get(`/api/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`)).json()) as {
      result: { verdict: { items: { id: string; title: string; verdict: string }[]; unknownCount: number } };
      checkedAt: string;
    };
    const items = snap.result.verdict.items;
    const tiles = page.getByTestId("judgement-tile");
    await expect(tiles).toHaveCount(items.length);
    expect(items.length).toBeGreaterThan(0);

    // 第 1 層：総合の語（§8.2）と記号。件数はタイルの数と一致
    const total = page.getByTestId("judgement-total");
    const key = await total.getAttribute("data-total-key");
    const count = (v: string) => items.filter((i) => i.verdict === v).length;
    const text = (await total.innerText()).trim();
    if (key === "no_fly") expect(text).toBe(`飛行不可の項目があります（${count("no_fly")} 件）`);
    else if (key === "needs_procedure") expect(text).toBe(`手続きが要る項目があります（${count("needs_procedure")} 件）`);
    else if (key === "unknown") expect(text).toMatch(/^未確認の項目があります（\d+ 件）$/);
    else if (key === "done") expect(text).toBe("調べた項目は手続き済みです。条件を確認してください");
    else expect(text).toBe("調べた項目では、手続きが要るものは見つかりませんでした");
    expect(["飛行不可の項目があります", "手続きが要る項目があります", "未確認の項目があります", "調べた項目"].some((p) => text.startsWith(p))).toBe(true);
    // 夜間飛行の計画は、要手続き以上（飛行可・安全・問題なしと読める語は出ない）
    expect(["no_fly", "needs_procedure"]).toContain(key);
    for (const w of ["飛行可", "安全", "問題なし", "通報不要", "OK"]) expect(text).not.toContain(w);
    await expect(page.locator('[data-testid="verdict-conclusion"] svg').first()).toBeVisible(); // 形の記号
    await expect(page.getByTestId("verdict-level")).not.toHaveText("");
    // 判定の取得時刻（日本時間）
    const at = page.getByTestId("judgement-fetched-at");
    await expect(at).toContainText("判定の取得時刻（日本時間）");
    await expect(at).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);

    // 第 2 層：タイルは項目の区分だけ（気象・標高・ハザードなど、持っていない項目は出ない）。重い順
    const tileInfo = await tiles.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.getAttribute("data-item-id"), verdict: e.getAttribute("data-verdict"), h: r.height, w: r.width, hasSvg: e.querySelector("svg") !== null, text: (e.textContent ?? "").trim(), expanded: e.getAttribute("aria-expanded"), popup: e.getAttribute("aria-haspopup") };
      }),
    );
    expect(tileInfo.map((t) => t.id).sort()).toEqual(items.map((i) => i.id).sort());
    const rank: Record<string, number> = { no_fly: 0, needs_procedure: 1, unknown: 2, procedure_done: 3, no_procedure: 4 };
    for (let i = 1; i < tileInfo.length; i++) expect(rank[tileInfo[i]!.verdict!]!, `${tileInfo[i]!.id} は重い順`).toBeGreaterThanOrEqual(rank[tileInfo[i - 1]!.verdict!]!);
    for (const t of tileInfo) {
      expect(t.h, `${t.id} 高さ`).toBeGreaterThanOrEqual(47.5);
      expect(t.hasSvg, `${t.id} 形の記号`).toBe(true);
      expect(t.text.length, `${t.id} 文字`).toBeGreaterThan(2);
      expect(t.popup).toBe("dialog");
      expect(t.expanded).toBe("false");
    }
    const bodyText = (await page.locator("main").innerText()).toString();
    for (const w of ["気象", "標高", "ハザード", "日没"]) {
      // 「まだ調べていません」の 1 文だけが言及してよい（タイルとしては出さない）
      for (const t of tileInfo) expect(t.text, `タイルに ${w} は無い`).not.toContain(w);
    }
    expect(bodyText).toContain("気象・標高・ハザードは、まだ調べていません");

    // 第 3 層：タイルを押すとボトムシート（詳細）
    const first = tiles.first();
    const firstId = await first.getAttribute("data-item-id");
    const firstTitle = items.find((i) => i.id === firstId)!.title;
    await first.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: firstTitle }).first()).toBeVisible();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    const detail = page.getByTestId("judgement-sheet-detail");
    await expect(detail).toHaveAttribute("data-item-id", firstId!);
    await expect(page.getByTestId("judgement-sheet-reason")).not.toHaveText("");
    await expect(page.getByTestId("judgement-sheet-verdict")).not.toHaveText("");
    // 取得時刻はシートにも出る（第 1 層と同じ時刻）
    const sheetAt = (await page.getByTestId("judgement-sheet-fetched-at").innerText()).trim();
    expect((await at.innerText()).includes(sheetAt)).toBe(true);
    // 根拠：台帳（sources.json）の値だけ。名称・確認日・出典の URL・提供元・版が台帳と一致
    const ds = page.getByTestId("judgement-sheet-dataset");
    const nDs = await ds.count();
    expect(nDs, "判定に使ったデータが出る").toBeGreaterThan(0);
    for (let i = 0; i < nDs; i++) {
      const row = ds.nth(i);
      const name = (await row.locator(".opx-tile-ds-name").innerText()).trim();
      const rec = LEDGER.find((d) => d.name === name);
      expect(rec, `「${name}」は台帳（sources.json）にある`).toBeTruthy();
      const metaText = await row.innerText();
      expect(metaText).toContain(`確認日 ${rec!.verifiedAt}`);
      expect(metaText).toContain(`提供元：${rec!.provider}`);
      expect(metaText).toContain(`版 ${rec!.version}`);
      const link = row.getByRole("link");
      await expect(link).toHaveAttribute("href", rec!.url);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
    // 押す部品は 48px 以上（閉じる・広げる・縮める・リンク）
    const small = await page.locator('[role="dialog"] button, [role="dialog"] a').evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 47.5).map((e) => (e.textContent ?? "").trim()),
    );
    expect(small, "シートの押す部品の高さ").toEqual([]);
    // IME の変換中の Esc では閉じない。通常の Esc で閉じ、フォーカスはタイルに戻る
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    // 「閉じる」でも閉じる。別のタイルを開ける
    await tiles.nth(items.length - 1).click();
    await expect(sheet).toBeVisible();
    await page.getByTestId("judgement-sheet-close").click();
    await expect(sheet).toHaveCount(0);

    // N-7：シートが開いたまま別のタイルを押したら、フォーカスは新しい見出しへ。閉じたときは、そのタイルへ戻る
    expect(items.length, "N-7 の前提：タイルが 2 つ以上（夜間飛行の計画は項目が 2 つ以上になる）").toBeGreaterThanOrEqual(2);
    {
      const a = tiles.nth(0);
      const b = tiles.nth(1);
      await a.click();
      await expect(sheet).toBeVisible();
      await b.evaluate((el: HTMLElement) => el.click()); // 地のタイルを押す（ピーク段では暗幕が無く、地のタイルを押せる）
      await expect(b).toHaveAttribute("aria-expanded", "true");
      await expect(sheet.getByRole("heading").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(b).toBeFocused();
    }

    // N-2：要手続きの項目のシートに、その項目の手続き（itemId が一致するもの）の名前・提出先・期限を出す（エンジンが保存した値）
    const verdictFull = (await (await manager.get(`/api/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`)).json()) as {
      result: { verdict: { procedures: { id: string; title: string; submitTo: string; itemId: string; deadline: { label: string } }[] } };
    };
    const procs = verdictFull.result.verdict.procedures;
    const needsTile = page.locator('[data-testid="judgement-tile"][data-verdict="needs_procedure"]').first();
    // 前提（夜間飛行の計画は、要手続きの項目と、その項目の手続きを持つ）。満たさないときは何も確かめずに通らず、ここで落とす
    expect(await needsTile.count(), "要手続きのタイルがある").toBeGreaterThan(0);
    {
      const needsId = (await needsTile.getAttribute("data-item-id"))!;
      const mine = procs.filter((p) => p.itemId === needsId);
      expect(mine.length, "要手続きの項目に、手続きがある").toBeGreaterThan(0);
      await needsTile.click();
      await expect(sheet).toBeVisible();
      const rows = page.getByTestId("judgement-sheet-procedure");
      await expect(rows).toHaveCount(mine.length);
      for (const p of mine) {
        const t = await rows.filter({ hasText: p.title }).first().innerText();
        expect(t).toContain(`提出先：${p.submitTo}`);
        expect(t).toContain(`期限：${p.deadline.label}`);
      }
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    }

    // H2-3：主ボタンは 1 つ。「DIPS に出す内容を確認」。送信・通報すると読める語を使わない
    expect(await visiblePrimaries(page)).toEqual(["judgement-primary"]);
    const primary = page.getByTestId("judgement-primary");
    await expect(primary).toHaveText("DIPS に出す内容を確認");
    await expect(primary).toHaveAttribute("href", `/ops/plans/${plan.id}`);
    for (const w of ["通報する", "送信", "送る", "代行", "申請"]) expect((await primary.innerText()).includes(w), `主ボタンに ${w}`).toBe(false);
    const pb = (await primary.boundingBox())!;
    expect(pb.height).toBeGreaterThanOrEqual(55.5);
    // 副ボタン（再判定）は主ボタンにならない
    await expect(page.getByTestId("plan-rejudge")).not.toHaveAttribute("data-variant", "primary");
    // 禁止語（判定の領域の外）。本文に通報不要・問題なし
    const text2 = await page.locator("main").evaluate((el) => el.textContent ?? "");
    for (const w of ["通報不要", "通報は不要", "問題なし", "大丈夫", "完璧", "代行"]) expect(text2, w).not.toContain(w);
    // 主ボタンで通報の主画面へ
    await tapUntil(page, primary, new RegExp(`/ops/plans/${plan.id}$`));
  });

  test("H2-2・R-2・N-4. 判定が古いとき：総合の語の前に「古い判定：」、再判定が主ボタンの 1 つだけで judgement-primary は副ボタン、再判定の導線は総合の直下。再判定後は judgement-primary の 1 つだけ", async ({ page }) => {
    const ac = await mkAircraft({ maxTakeoffWeightKg: 0.9 });
    const plan = await mkPlan(ac.id);
    await login(page);
    await page.goto(`/ops/plans/${plan.id}/judgement`);
    await expect(page.getByTestId("judgement-total")).toBeVisible();
    await expect(page.getByTestId("judgement-total")).toHaveAttribute("data-stale", "false");
    expect((await page.getByTestId("judgement-total").innerText()).startsWith("古い判定：")).toBe(false);
    // 新しいとき：主ボタンは judgement-primary の 1 つだけ
    expect(await visiblePrimaries(page), "新しいとき").toEqual(["judgement-primary"]);
    await expect(page.getByTestId("judgement-tile-stale")).toHaveCount(0);
    const patch = await manager.patch(`/api/ops/aircraft/${ac.id}`, { data: { maxTakeoffWeightKg: 1.5, expectedVersion: ac.version, reason: "重量の訂正" } });
    expect(patch.status(), await patch.text()).toBe(200);
    await page.goto(`/ops/plans/${plan.id}/judgement`);
    await expect(page.getByTestId("judgement-total")).toHaveAttribute("data-stale", "true");
    expect((await page.getByTestId("judgement-total").innerText()).startsWith("古い判定：")).toBe(true);
    await expect(page.getByTestId("plan-stale-box")).toBeVisible();
    await expect(page.getByTestId("plan-rejudge")).toBeVisible();
    // 古いとき：主ボタンは再判定の 1 つだけ。judgement-primary は副ボタン
    expect(await visiblePrimaries(page), "古いとき").toEqual(["plan-rejudge"]);
    await expect(page.getByTestId("judgement-primary")).not.toHaveAttribute("data-variant", "primary");
    await expect(page.getByTestId("judgement-primary")).toBeVisible();
    // 再判定の導線（plan-stale-box）は、総合の直下（タイルより前）
    const order = await page.evaluate(() => {
      const y = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect().top;
      return { total: y("judgement-total"), box: y("plan-stale-box"), rejudge: y("plan-rejudge"), tiles: y("judgement-tiles") };
    });
    expect(order.box).toBeGreaterThan(order.total);
    expect(order.box).toBeLessThan(order.tiles);
    expect(order.rejudge).toBeLessThan(order.tiles);
    // 総合の印は注意側（手続き済み・手続き不要の印のままにしない）、タイルとシートに文字で「古い判定」
    const tileCount = await page.getByTestId("judgement-tile").count();
    await expect(page.getByTestId("judgement-tile-stale")).toHaveCount(tileCount);
    await expect(page.getByTestId("judgement-tile-stale").first()).toHaveText("古い判定");
    await page.getByTestId("judgement-tile").first().click();
    await expect(page.getByRole("dialog").getByRole("heading").first()).toContainText("古い判定");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (let i = 0; i < 4; i++) {
      await page.getByTestId("plan-rejudge").click();
      try {
        await expect(page.getByTestId("judgement-total")).toHaveAttribute("data-stale", "false", { timeout: 8_000 });
        break;
      } catch {
        // 押し直す
      }
    }
    await expect(page.getByTestId("judgement-total")).toHaveAttribute("data-stale", "false");
    await expect(page.getByTestId("judgement-primary")).toBeVisible(); // 再読み込みの直後は本文が display:none の中（Suspense）
    expect(await visiblePrimaries(page), "再判定の後").toEqual(["judgement-primary"]);
  });

  test("N-e. 判定が古く、再判定の権限がない（閲覧だけの）利用者：主ボタンは judgement-primary の 1 つだけ。「判定のやり直しは、計画を変更できる人が行います」の案内が出て、再判定のボタンは出ない", async ({ page }) => {
    const ac = await mkAircraft({ maxTakeoffWeightKg: 0.9 });
    const plan = await mkPlan(ac.id);
    const patch = await manager.patch(`/api/ops/aircraft/${ac.id}`, { data: { maxTakeoffWeightKg: 1.5, expectedVersion: ac.version, reason: "重量の訂正" } });
    expect(patch.status(), await patch.text()).toBe(200);
    // 閲覧者（a-viewer）は計画を変更できない（既存の E2E と同じ、シードの閲覧者）
    const viewer = await apiAs(seeded("a-viewer"));
    expect((await viewer.patch(`/api/ops/plans/${plan.id}`, { data: { expectedVersion: plan.version, reason: "x", title: "x" } })).status()).toBe(403);
    await viewer.dispose();
    await login(page, "a-viewer");
    await page.goto(`/ops/plans/${plan.id}/judgement`);
    await expect(page.getByTestId("judgement-total")).toHaveAttribute("data-stale", "true");
    await expect(page.getByTestId("plan-stale-box")).toBeVisible();
    const note = page.getByTestId("plan-stale-readonly-note");
    await expect(note).toBeVisible();
    await expect(note).toHaveText("判定のやり直しは、計画を変更できる人が行います");
    for (const w of ["完璧", "保証", "必ず", "代行", "代理", "申請", "通報不要", "問題なし"]) expect(await note.innerText(), w).not.toContain(w);
    await expect(page.getByTestId("plan-rejudge")).toHaveCount(0);
    await expect(page.getByTestId("judgement-primary")).toBeVisible();
    expect(await visiblePrimaries(page), "閲覧だけ・古いとき").toEqual(["judgement-primary"]);
    await expect(page.getByTestId("judgement-primary")).toHaveAttribute("data-variant", "primary");
    // 計画を変更できる人（運航管理者）には、案内は出ず、再判定が主ボタン
    await login(page, "a-manager");
    await page.goto(`/ops/plans/${plan.id}/judgement`);
    await expect(page.getByTestId("plan-rejudge")).toBeVisible();
    await expect(page.getByTestId("plan-stale-readonly-note")).toHaveCount(0);
  });

  test("K-4・K-5・K-8. 判定の画面：320〜1440 の幅で横スクロールなし。文字 200%（390・430）で切れ・横スクロールなし。シートを開いても横スクロールなし", async ({ page }) => {
    const ac = await mkAircraft();
    const plan = await mkPlan(ac.id);
    await login(page);
    await page.goto(`/ops/plans/${plan.id}/judgement`);
    await expect(page.getByTestId("judgement-total")).toBeVisible();
    for (const w of [320, 360, 375, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: w >= 768 ? 900 : 812 });
      await waitForSettledStyles(page);
      await expectNoHorizontalScroll(page, `判定 ${w}px`);
      expect(await visiblePrimaries(page), `${w}px 主ボタン`).toEqual(["judgement-primary"]);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId("judgement-tile").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalScroll(page, "判定 シートを開いた状態");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectTextZoom(page, "判定（H2）");
  });

  // ---------------- H2-4 ----------------

  test("H2-4. 訂正の画面：段に分けず、節の見出し・新しい部品で載せ替え。plan-reason を残す。理由を入れて保存できる", async ({ page }) => {
    const ac = await mkAircraft();
    const plan = await mkPlan(ac.id);
    await login(page);
    await page.goto(`/ops/plans/${plan.id}/edit`);
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    // 段に分けない：進捗の帯・段の番号・「次へ」が無い
    await expect(page.getByTestId("plan-wizard-progress")).toHaveCount(0);
    await expect(page.getByTestId("plan-wizard-next")).toHaveCount(0);
    expect(await page.getByTestId("plan-form").getAttribute("data-step")).toBeNull();
    // 節の見出し（h2）と、fieldset の legend
    const heads = await page.locator("form[data-testid=plan-form] > section > h2").allTextContents();
    expect(heads.map((s) => s.trim())).toEqual(["計画の基本", "日時", "判定の条件", "許可・承認の番号とメモ", "訂正の記録"]);
    const legends = await page.locator("form[data-testid=plan-form] > fieldset > legend").allTextContents();
    expect(legends.map((s) => s.trim())).toEqual(["場所", "飛行の方法・空域", "取得済みの同意・通報・許可（DIPS の許可・承認を除く）"]);
    // 残す識別子
    for (const id of ["plan-reason", "plan-title", "plan-purpose", "plan-start-date", "plan-start-time", "plan-duration", "plan-place-name", "plan-lat", "plan-lng", "plan-radius", "plan-altitude", "plan-permit-numbers", "plan-notes", "plan-submit", "plan-aircraft-readonly", "plan-pilot"]) {
      await expect(page.getByTestId(id), id).toHaveCount(1);
    }
    // 主ボタンは 1 つ（訂正を保存する）。新しい部品（カード）で、押す部品は 48px 以上
    expect(await visiblePrimaries(page)).toEqual(["plan-submit"]);
    const cards = await page.locator("form[data-testid=plan-form] > section, form[data-testid=plan-form] > fieldset").evaluateAll((els) => els.map((e) => ({ r: getComputedStyle(e).borderRadius, bg: getComputedStyle(e).backgroundColor })));
    expect(cards.length).toBe(8);
    expect(new Set(cards.map((c) => c.r)).size, "カードの角丸は 1 種類").toBe(1);
    const tooSmall = await page.locator("form[data-testid=plan-form] button, form[data-testid=plan-form] input:not([type=checkbox]), form[data-testid=plan-form] select").evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 47.5).map((e) => e.getAttribute("data-testid") ?? e.tagName),
    );
    expect(tooSmall, "訂正の押す部品の高さ").toEqual([]);
    // 理由なしは保存できない（サーバーの規則は変えない）。理由を入れて保存
    await page.getByTestId("plan-title").fill(`${plan.title} 訂正`);
    await page.getByTestId("plan-submit").click();
    await expect(page.getByTestId("plan-form").locator("[data-form-error], [role=alert]").first()).toBeVisible();
    await page.getByTestId("plan-reason").fill("H2 の訂正の試験");
    await page.getByTestId("plan-submit").click();
    await page.waitForURL(new RegExp(`/ops/plans/${plan.id}$`));
    const after = (await (await manager.get(`/api/ops/plans/${plan.id}`)).json()) as { title: string; version: number };
    expect(after.title).toBe(`${plan.title} 訂正`);
    expect(after.version).toBe(plan.version + 1);
  });

  test("H2-4・K-4・K-5. 訂正の画面：緯度・経度の欄は 320〜1440 の幅、文字 200%（320・390）でも切れず、横スクロールなし", async ({ page }) => {
    const ac = await mkAircraft();
    const plan = await mkPlan(ac.id);
    await login(page);
    await page.goto(`/ops/plans/${plan.id}/edit`);
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const inside = async (label: string, w: number) => {
      const r = await page.evaluate(() => {
        const g = (id: string) => {
          const b = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect();
          return { left: b.left, right: b.right, w: b.width };
        };
        return { lat: g("plan-lat"), lng: g("plan-lng"), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      for (const k of ["lat", "lng"] as const) {
        expect(r[k].left, `${label} ${k} 左端`).toBeGreaterThanOrEqual(0);
        expect(r[k].right, `${label} ${k} 右端（${r[k].right}）が画面（${w}）以内`).toBeLessThanOrEqual(w);
        expect(r[k].w, `${label} ${k} の幅`).toBeGreaterThanOrEqual(100);
      }
      expect(r.sw, `${label} 横スクロール`).toBeLessThanOrEqual(r.cw);
    };
    for (const w of [320, 360, 375, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: 800 });
      await inside(`訂正 ${w}px 100%`, w);
    }
    for (const w of [320, 390, 430]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      await waitForSettledStyles(page);
      await inside(`訂正 ${w}px 200%`, w);
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.setViewportSize({ width: 390, height: 844 });
    // 入力欄の値は、入力欄の中で横に動く（1 行の入力欄の仕様で、文字の切れではない）。共通の測定は入れ物の切れとして数えるので、値を空にしてから測る
    for (const el of await page.locator("form[data-testid=plan-form] input:not([type=checkbox]):not([type=date]):not([type=time]):not([disabled])").all()) await el.fill("");
    await expectTextZoom(page, "訂正（H2）");
  });

  test("N-5・H2-4. 訂正の画面：文字 200% で、緯度・経度の欄が値を全部見せる（scrollWidth <= clientWidth）", async ({ page }) => {
    const ac = await mkAircraft();
    const plan = await mkPlan(ac.id);
    await login(page);
    await page.goto(`/ops/plans/${plan.id}/edit`);
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    for (const w of [320, 390, 430]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      await waitForSettledStyles(page);
      for (const id of ["plan-lat", "plan-lng"]) {
        const el = page.getByTestId(id);
        await expect(el, `${id} は値を持つ`).not.toHaveValue("");
        const r = await el.evaluate((e: HTMLInputElement) => ({ sw: e.scrollWidth, cw: e.clientWidth, len: e.value.length }));
        expect(r.sw, `${w}px 200% ${id}（値 ${r.len} 文字）の scrollWidth ${r.sw} <= clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
      }
    }
  });

  // ---------------- 422 の一覧（§17 申し送り 12） ----------------

  test("422 の一覧：項目名が重ならない（「緯度：緯度は…」→「緯度は…」）。段へ戻る導線は今のまま", async ({ page }) => {
    await openWizard(page);
    const v = full("422");
    await page.route("**/api/ops/plans", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_input", fields: { latitude: "緯度：緯度は −90〜90 の範囲で入力してください", radiusM: "範囲の半径（m）は 1〜10000 の整数で入力してください" } }),
      });
    });
    await walkWizard(page, { ...v, date: "2027-03-05", time: "10:30", duration: "30" }, 5);
    await clickSave(page);
    const errs = page.getByTestId("plan-review-error");
    await expect(errs).toHaveCount(2);
    const texts = await errs.allTextContents();
    expect(texts.join("\n")).not.toContain("緯度：緯度は");
    expect(texts[0]).toContain("場所：");
    expect(texts[0]).toContain("緯度は −90〜90 の範囲で入力してください");
    expect(texts[1]).toContain("範囲の半径（m）は 1〜10000 の整数で入力してください");
    await expect(page.getByTestId("plan-review-error-fix-1").first()).toBeVisible();
  });

  // ---------------- 段 ④ のラベル（§17 申し送り 13）と文書の幅 ----------------

  test("段 ④：許可の欄のラベル「公安委員会への通報（飛行禁止法）」は 320・文字 200% でも折り返し、文書の幅が画面を超えない", async ({ page }) => {
    await openWizard(page);
    await page.setViewportSize({ width: 320, height: 800 });
    const v = { ...full("label"), date: "2027-03-05", time: "10:30", duration: "30" };
    await walkWizard(page, v, 4);
    await expectStep(page, 4);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    await waitForSettledStyles(page);
    const r = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('[data-testid="plan-permit-pref_pubsafety_notice"]')!.closest("label")!;
      const b = row.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(row);
      const lines = new Set(Array.from(range.getClientRects()).map((q) => Math.round(q.top))).size;
      return { right: b.right, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, lines, text: (row.textContent ?? "").trim() };
    });
    expect(r.text).toContain("公安委員会への通報（飛行禁止法）");
    expect(r.right, "ラベルの右端が画面内").toBeLessThanOrEqual(r.vw);
    expect(r.lines, "ラベルは折り返す").toBeGreaterThan(1);
    expect(r.sw, "文書の幅").toBeLessThanOrEqual(r.vw);
  });
});
