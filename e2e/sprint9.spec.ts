import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";

// Sprint 9 契約（docs/sprints/sprint-9.md）の E2E。
//   - 本番相当サーバー（baseURL）：現在地・長押し・右クリック・出典表示・プライバシー
//   - フィクスチャ用サーバー（FIXTURE_URL）：住所検索の索引を架空のフィクスチャ（e2e/fixtures/address）に差し替え、
//     国土地理院の住所検索は接続できない宛先にしたもの。検索結果の出典・精度の表示を確かめる

const FIXTURE_URL = `http://127.0.0.1:${process.env.E2E_FIXTURE_PORT ?? 3101}`;

const isApi = (url: string, names: readonly string[]) =>
  names.some((n) => new URL(url).pathname === `/api/${n}`);

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

/** ページを開き、初回の自動判定と地図の読み込みを待つ。 */
const openReady = async (page: Page, url = "/"): Promise<void> => {
  const check = waitCheck(page);
  await page.goto(url);
  await check;
  await expect(page.getByTestId("regulation-map")).toHaveAttribute("data-center-lat", /\d/);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
};

const latInput = (page: Page) => page.getByPlaceholder("35.4278", { exact: true });
const lngInput = (page: Page) => page.getByPlaceholder("133.3314", { exact: true });

/** 地図の中心付近の画面座標。 */
const mapPoint = async (page: Page, dx = 0, dy = 0) => {
  await page.locator(".maplibregl-canvas").evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(200);
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  return { x: Math.round(box.x + box.width / 2 + dx), y: Math.round(box.y + box.height / 2 + dy) };
};

const GEO = { latitude: 35.4400123, longitude: 133.3500456, accuracy: 30 };

const geoContext = async (
  browser: import("@playwright/test").Browser,
  baseURL: string | undefined,
  opts: { grant: boolean; accuracy?: number },
): Promise<BrowserContext> => {
  const ctx = await browser.newContext({
    baseURL,
    geolocation: { ...GEO, accuracy: opts.accuracy ?? GEO.accuracy },
    permissions: opts.grant ? ["geolocation"] : [],
  });
  // getCurrentPosition・watchPosition の呼び出し回数を数える
  await ctx.addInitScript(() => {
    const g = navigator.geolocation;
    const w = window as unknown as { __geoCalls: { get: number; watch: number } };
    w.__geoCalls = { get: 0, watch: 0 };
    const get = g.getCurrentPosition.bind(g);
    const watch = g.watchPosition.bind(g);
    g.getCurrentPosition = (...a: Parameters<Geolocation["getCurrentPosition"]>) => {
      w.__geoCalls.get++;
      return get(...a);
    };
    g.watchPosition = (...a: Parameters<Geolocation["watchPosition"]>) => {
      w.__geoCalls.watch++;
      return watch(...a);
    };
  });
  return ctx;
};

const geoCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __geoCalls: { get: number; watch: number } }).__geoCalls);

test.describe("C・E. 現在地（本番相当サーバー）", () => {
  // Sprint 12h PR ②：現在地は「押したらすぐ判定」（精度 100m 以内は確認なし、超えるときだけ確認を 1 回）。
  // 以前は「ボタンを押した時点では判定・検索の通信がなく、『この地点で判定』で初めて判定」だった。
  // 変えたのは「押した後に判定の通信が 1 回ある」ことだけで、要求本文に精度・時刻・指定方法がないこと・開いただけで位置を要求しないこと・
  // 押すまで通信がないこと・追跡しないことは、元と同じ（より厳しく、保存・Cookie にも精度がないことを足した）。
  test("開いただけでは位置を要求せず、押すまで通信がない。押すと判定の通信が 1 回ずつ（check・diagnose）で、与えた座標（小数 6 桁）だけを送り、要求本文に精度・時刻・指定方法がない。結果に「現在地（精度 約 30 m）」を添える", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await geoContext(browser, baseURL, { grant: true });
    const page = await ctx.newPage();
    await openReady(page);

    // ページを開いただけでは位置情報を要求しない
    expect(await geoCalls(page)).toEqual({ get: 0, watch: 0 });
    // 説明文がボタンの近くにある
    await expect(page.getByTestId("current-location")).toContainText("「現在地で判定」を押したときに 1 回だけ取得し");
    await expect(page.getByTestId("current-location")).toContainText("緯度・経度（小数 6 桁）だけを送ります");
    await expect(page.getByTestId("current-location-button")).toContainText("現在地で判定");

    // 押すまで通信がない（開いたあとの待ちの間も）
    const apiCalls: string[] = [];
    const onReq = (r: Request) => {
      if (isApi(r.url(), ["check", "diagnose", "geocode"])) apiCalls.push(new URL(r.url()).pathname);
    };
    page.on("request", onReq);
    await page.waitForTimeout(800);
    expect(apiCalls).toEqual([]);

    const checkReq = page.waitForRequest((r) => isApi(r.url(), ["check"]));
    const diagReq = page.waitForRequest((r) => isApi(r.url(), ["diagnose"]));
    const check = waitCheck(page);
    const diag = waitDiagnose(page);
    await page.getByTestId("current-location-button").click();
    const [cReq, dReq] = await Promise.all([checkReq, diagReq, check, diag]);
    for (const req of [cReq, dReq]) {
      const body = req.postDataJSON() as Record<string, unknown>;
      expect(body["lat"]).toBe(35.440012);
      expect(body["lng"]).toBe(133.350046);
      const raw = req.postData() ?? "";
      for (const key of ["accuracy", "timestamp", "method", "pickMethod", "source", "geolocation"]) {
        expect(raw, key).not.toContain(`"${key}"`);
      }
    }
    // 判定の通信は check と diagnose が 1 回ずつ（住所検索は呼ばない）
    await page.waitForTimeout(800);
    expect(apiCalls.filter((p) => p === "/api/check")).toHaveLength(1);
    expect(apiCalls.filter((p) => p === "/api/diagnose")).toHaveLength(1);
    expect(apiCalls.filter((p) => p === "/api/geocode")).toHaveLength(0);
    page.off("request", onReq);
    expect(await geoCalls(page)).toEqual({ get: 1, watch: 0 });

    // 確認のパネルは出ず、精度は結果に添える（画面の表示だけ）。地図は精度の円を残す
    await expect(page.getByTestId("current-location-candidate")).toHaveCount(0);
    await expect(page.getByTestId("location-note")).toContainText("現在地（精度 約 30 m）");
    const map = page.getByTestId("regulation-map");
    await expect(map).toHaveAttribute("data-accuracy-radius-m", "30");
    await expect
      .poll(async () => Number(await map.getAttribute("data-center-lat")))
      .toBeCloseTo(GEO.latitude, 4);
    await expect
      .poll(async () => Number(await map.getAttribute("data-center-lng")))
      .toBeCloseTo(GEO.longitude, 4);
    await expect(page.getByText("位置の精度が低い")).toHaveCount(0);
    await expect(latInput(page)).toHaveValue("35.440012");
    await expect(lngInput(page)).toHaveValue("133.350046");

    // 精度は保存しない（履歴は判定した地点の記録。精度・取得時刻・方法は含まない）
    const storage = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        out[k] = localStorage.getItem(k) ?? "";
      }
      return JSON.stringify(out) + document.cookie;
    });
    expect(storage).not.toContain("accuracy");
    await ctx.close();
  });

  test("精度 150m では、精度が低い旨と「この位置で判定しますか」の確認を 1 回出し、確認の前は判定の通信がない。『この地点で判定』で 1 回ずつ判定する", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await geoContext(browser, baseURL, { grant: true, accuracy: 150 });
    const page = await ctx.newPage();
    await openReady(page);
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (isApi(r.url(), ["check", "diagnose", "geocode"])) apiCalls.push(new URL(r.url()).pathname);
    });
    await page.getByTestId("current-location-button").click();
    const panel = page.getByTestId("current-location-candidate");
    await expect(panel).toContainText("現在地（精度 約 150 m）");
    await expect(panel).toContainText("この位置で判定しますか");
    await expect(panel).toContainText("位置の精度が低い。地図で位置を確かめ、長押し（右クリック）で直してください");
    await expect(page.getByTestId("regulation-map")).toHaveAttribute("data-accuracy-radius-m", "150");
    // 確認の前は、判定の通信がない
    await page.waitForTimeout(800);
    expect(apiCalls).toEqual([]);

    const check = waitCheck(page);
    const diag = waitDiagnose(page);
    await page.getByRole("button", { name: "この地点で判定" }).click();
    await Promise.all([check, diag]);
    await expect(panel).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(apiCalls.filter((p) => p === "/api/check")).toHaveLength(1);
    expect(apiCalls.filter((p) => p === "/api/diagnose")).toHaveLength(1);
    await expect(page.getByTestId("location-note")).toContainText("現在地（精度 約 150 m）");
    await ctx.close();
  });

  test("確認で取消した後は判定せず、localStorage・Cookie に現在地の座標と精度がない", async ({ browser, baseURL }) => {
    const ctx = await geoContext(browser, baseURL, { grant: true, accuracy: 137 });
    const page = await ctx.newPage();
    await openReady(page);
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (isApi(r.url(), ["check", "diagnose"])) apiCalls.push(r.url());
    });
    await page.getByTestId("current-location-button").click();
    await expect(page.getByTestId("current-location-candidate")).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByTestId("current-location-candidate")).toHaveCount(0);
    await expect(page.getByTestId("regulation-map")).not.toHaveAttribute("data-accuracy-radius-m", /.*/);
    await page.waitForTimeout(800);
    expect(apiCalls).toEqual([]);
    const storage = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        out[k] = localStorage.getItem(k) ?? "";
      }
      return JSON.stringify(out) + document.cookie;
    });
    const cookies = JSON.stringify(await ctx.cookies());
    for (const s of [storage, cookies]) {
      expect(s).not.toContain("35.44001");
      expect(s).not.toContain("133.35004");
      expect(s).not.toContain("133.35005");
      expect(s).not.toContain("accuracy");
    }
    await ctx.close();
  });

  test("`/?start=here`・`/?start=search`：位置の要求は 0 のまま、フォーカスだけが「現在地で判定」・住所の入力欄に移る（押すのは利用者）", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await geoContext(browser, baseURL, { grant: true });
    const page = await ctx.newPage();
    await openReady(page, "/?start=here");
    await expect(page.getByTestId("current-location-button")).toBeFocused();
    expect(await geoCalls(page)).toEqual({ get: 0, watch: 0 });
    const page2 = await ctx.newPage();
    await openReady(page2, "/?start=search");
    await expect(page2.locator("#address-input")).toBeFocused();
    expect(await geoCalls(page2)).toEqual({ get: 0, watch: 0 });
    // パラメータがなければ、どこにもフォーカスを移さない
    const page3 = await ctx.newPage();
    await openReady(page3, "/");
    await expect(page3.getByTestId("current-location-button")).not.toBeFocused();
    await expect(page3.locator("#address-input")).not.toBeFocused();
    await ctx.close();
  });

  test("位置情報を許可しないと、許可されていない旨と案内を表示し、それまでの地点と判定結果は変わらない", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await geoContext(browser, baseURL, { grant: false });
    const page = await ctx.newPage();
    await openReady(page);
    const latBefore = await latInput(page).inputValue();
    const lngBefore = await lngInput(page).inputValue();
    const evidenceBefore = await page.getByTestId("evidence-id").innerText();
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (isApi(r.url(), ["check", "diagnose"])) apiCalls.push(r.url());
    });
    await page.getByTestId("current-location-button").click();
    await expect(page.getByTestId("current-location-error")).toContainText(
      "位置情報の利用が許可されていません。ブラウザの設定で許可するか、住所検索・地図の長押しで指定してください",
    );
    await page.waitForTimeout(500);
    expect(apiCalls).toEqual([]);
    await expect(latInput(page)).toHaveValue(latBefore);
    await expect(lngInput(page)).toHaveValue(lngBefore);
    await expect(page.getByTestId("evidence-id")).toHaveText(evidenceBefore);
    expect((await geoCalls(page)).watch).toBe(0);
    await ctx.close();
  });
});

test.describe("D. 長押し・右クリック・左クリック（本番相当サーバー）", () => {
  test("タッチで 600ms 押すとその位置で判定し、300ms で離した場合は長押しとして扱わない（単タップでも指定しない）", async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 412, height: 915 } });
    const page = await ctx.newPage();
    await openReady(page);
    const canvas = page.locator(".maplibregl-canvas");
    await canvas.scrollIntoViewIfNeeded();
    const cdp = await ctx.newCDPSession(page);
    const touch = async (ms: number, dx: number) => {
      const p = await mapPoint(page, dx, 0);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
      await page.waitForTimeout(ms);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };

    const latBefore = await latInput(page).inputValue();
    const lngBefore = await lngInput(page).inputValue();
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (isApi(r.url(), ["check"])) apiCalls.push(r.url());
    });
    await touch(300, -60);
    await page.waitForTimeout(1500);
    expect(apiCalls).toEqual([]);
    await expect(latInput(page)).toHaveValue(latBefore);

    const check = waitCheck(page);
    await touch(600, 60);
    await check;
    await expect(page.getByTestId("location-note")).toContainText("地図で指定しました（長押し）");
    await expect(lngInput(page)).not.toHaveValue(lngBefore);
    expect(apiCalls).toHaveLength(1);
    await ctx.close();
  });

  test("デスクトップで右クリックするとその位置で判定し、ブラウザの右クリックメニューを出さない。左クリックも従来どおり", async ({
    page,
  }) => {
    await openReady(page);
    await page.evaluate(() => {
      const w = window as unknown as { __ctxPrevented: boolean[] };
      w.__ctxPrevented = [];
      window.addEventListener("contextmenu", (e) => w.__ctxPrevented.push(e.defaultPrevented));
    });
    const before = await lngInput(page).inputValue();
    const p = await mapPoint(page, 80, 40);
    const check = waitCheck(page);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await check;
    await expect(page.getByTestId("location-note")).toContainText("地図で指定しました（右クリック）");
    expect(await page.evaluate(() => (window as unknown as { __ctxPrevented: boolean[] }).__ctxPrevented)).toEqual([
      true,
    ]);
    await expect(lngInput(page)).not.toHaveValue(before);

    const afterRight = await lngInput(page).inputValue();
    const q = await mapPoint(page, -80, -40);
    const check2 = waitCheck(page);
    await page.mouse.click(q.x, q.y);
    await check2;
    await expect(page.getByTestId("location-note")).toContainText("地図で指定しました（クリック）");
    await expect(lngInput(page)).not.toHaveValue(afterRight);

    // 右ドラッグ（地図の回転）では地点を決めない
    const afterLeft = await lngInput(page).inputValue();
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (isApi(r.url(), ["check"])) apiCalls.push(r.url());
    });
    const d = await mapPoint(page, 0, 0);
    await page.mouse.move(d.x, d.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(d.x + 60, d.y, { steps: 6 });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(1500);
    expect(apiCalls).toEqual([]);
    await expect(lngInput(page)).toHaveValue(afterLeft);
  });
});

test.describe("A・B. 住所検索", () => {
  test("（フィクスチャ）結果に出典と精度の説明が表示され、町字の代表点では地図での指定を促す", async ({ page }) => {
    await openReady(page, FIXTURE_URL);
    const input = page.getByPlaceholder(/米子市加茂町1丁目1番地/);

    // 住居表示の住居まで一致（同梱索引で街区以上 → 国土地理院は呼ばない）
    let check = waitCheck(page);
    await input.fill("鳥取県米子市試験町一丁目3番7号");
    await input.press("Enter");
    await check;
    const note = page.getByTestId("location-note");
    await expect(note).toContainText("出典：アドレス・ベース・レジストリ");
    await expect(note).toContainText("住居表示（住居）の代表点");
    await expect(latInput(page)).toHaveValue("35.43062");

    // 町字までしか合わない
    check = waitCheck(page);
    await input.fill("西伯郡日吉津村大字試験100番地");
    await input.press("Enter");
    await check;
    await expect(note).toContainText("出典：アドレス・ベース・レジストリ");
    await expect(note).toContainText("町字の代表点。実際の飛行地点は地図で指定してください");
    await expect(latInput(page)).toHaveValue("35.4412");

    // 同梱索引に一致せず、国土地理院にも接続できない（フィクスチャ用サーバーは接続できない宛先）→「該当なし」と区別して案内
    const latBefore = await latInput(page).inputValue();
    await input.fill("東京都千代田区霞が関一丁目");
    const geo = page.waitForResponse((r) => r.url().includes("/api/geocode"));
    await input.press("Enter");
    const body = (await (await geo).json()) as { results: unknown[]; gsiError?: boolean };
    expect(body).toEqual({ results: [], gsiError: true });
    await expect(page.getByText("住所検索サービスに接続できません。地図の長押し・座標入力で指定してください")).toBeVisible();
    await expect(page.getByText("住所が見つかりませんでした。")).toHaveCount(0);
    await expect(latInput(page)).toHaveValue(latBefore);
  });

  test("出典の表示（同梱索引があるときだけ ABR を示す）と、台帳の 2 件の出典", async ({
    page,
  }) => {
    await openReady(page);
    // 同梱索引が空（ABR 未取得）の間は、使っていない ABR の出典と見出しを出さない
    const indexBundled = readdirSync(path.join(__dirname, "..", "packages", "regulations", "data", "address")).some(
      (f) => /^index-\d+\.json$/.test(f),
    );
    const attribution = page.getByTestId("geocode-attribution");
    await expect(attribution).toContainText("国土地理院");
    if (indexBundled) {
      await expect(attribution).toContainText("アドレス・ベース・レジストリ（デジタル庁）を加工して作成");
      await expect(page.getByText("（アドレス・ベース・レジストリ → 国土地理院）")).toBeVisible();
    } else {
      await expect(attribution).not.toContainText("アドレス・ベース・レジストリ");
      await expect(page.getByText("アドレス・ベース・レジストリ")).toHaveCount(0);
    }
    const sources = JSON.parse(
      readFileSync(path.join(__dirname, "..", "packages", "regulations", "data", "sources.json"), "utf8"),
    ) as { datasets: { id: string; url: string; license: string; verifiedAt: string }[] };
    for (const id of ["abr-address", "gsi-address-search"]) {
      const d = sources.datasets.find((x) => x.id === id);
      expect(d, id).toBeTruthy();
      expect(d!.url).toMatch(/^https:\/\//);
      expect(d!.license.length).toBeGreaterThan(0);
      expect(d!.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
