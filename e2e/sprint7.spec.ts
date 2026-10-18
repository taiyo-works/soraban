import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";

// Sprint 7 契約（docs/sprints/sprint-7.md）の E2E。
//   - 本番相当サーバー（baseURL、DID_DATA_DIR・INDUSTRIAL_DATA_DIR なし）：飛行禁止法・出典表示・PDF
//   - フィクスチャ用サーバー（FIXTURE_URL）：DID・工業専用地域をテスト用フィクスチャ（e2e/fixtures、
//     実在の区域ではない）に差し替え、工業専用地域の除外の表示を確かめる

const FIXTURE_URL = `http://127.0.0.1:${process.env.E2E_FIXTURE_PORT ?? 3101}`;

// 美保基地（中心点のみ・推定敷地半径 2,000m。data/small-drone-law/facilities.json）の
// 敷地境界（推定）から東へ 700m の地点＝中心から 2,700m（旧実装では 1.5km 超のため green）。
const MIHO = { lat: 35.4936, lng: 133.2361 };
const M_PER_DEG = (6371008.8 * Math.PI) / 180;
const MIHO_700M = {
  lat: MIHO.lat,
  lng: Number((MIHO.lng + 2700 / (M_PER_DEG * Math.cos((MIHO.lat * Math.PI) / 180))).toFixed(6)),
};

const preset = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).first();

const card = (page: Page, id: string) => page.getByTestId(`regulation-card-${id}`);

const waitCheck = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

const gotoCoords = async (page: Page, loc: { lat: number; lng: number }): Promise<void> => {
  const input = page.getByPlaceholder(/拠点（本社）/);
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await input.fill(`${loc.lat}, ${loc.lng}`);
  await input.press("Enter");
  await Promise.all([check, diag]);
};

const selectPreset = async (page: Page, name: string): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await preset(page, name).click();
  await Promise.all([check, diag]);
};

// PDF のテキスト抽出（pdfjs-dist）。
const pdfText = async (download: Download): Promise<string> => {
  const file = await download.path();
  const data = new Uint8Array(await readFile(file));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join("") + "\n";
  }
  return text;
};

const didBundled = async (page: Page): Promise<boolean> => {
  const res = await page.request.get("/api/did/31");
  return res.ok();
};

test.describe("A. 小型無人機等飛行禁止法（本番相当サーバー）", () => {
  test("境界から 700m の地点は飛行禁止法のカードが red で『1,000m』を含み、300m・1.5km の表記がない。PDF も同様", async ({
    page,
  }) => {
    await page.goto("/");
    await gotoCoords(page, MIHO_700M);
    const c = card(page, "small-drone-law");
    await expect(c).toHaveAttribute("data-status", "red");
    await expect(c).toContainText("1,000m");
    await expect(c).not.toContainText("300m");
    await expect(c).not.toContainText("1.5km");

    // 画面全体・地図の凡例にも飛行禁止法の旧距離が残っていない
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("300m");
    expect(body).not.toContain("1.5km");
    expect(body).toContain("おおむね 1,000m");

    // 地点判定 PDF
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /PDF 出力/ }).click();
    const text = await pdfText(await dl);
    expect(text).toContain("1,000m");
    expect(text).not.toContain("300m");
    expect(text).not.toContain("1.5km");
    expect(text).toContain("免責");
  });

  test("飛行禁止法が red の地点で申請支援に『同意＋事前通報』が出典リンク付きで出る。green の地点では出ない", async ({
    page,
  }) => {
    const title = "施設管理者の同意 ＋ 都道府県公安委員会への事前通報（飛行の 48 時間前まで）";
    await page.goto("/");
    await gotoCoords(page, MIHO_700M);
    const proc = page.locator("article", { hasText: title });
    await expect(proc).toBeVisible();
    await expect(proc.getByRole("link", { name: /出典/ })).toHaveAttribute(
      "href",
      "https://www.npa.go.jp/bureau/security/kogatamujinki/tsuhou.html",
    );

    await selectPreset(page, "タイヨー通信本社");
    await expect(card(page, "small-drone-law")).toHaveAttribute("data-status", "green");
    await expect(page.locator("article", { hasText: title })).toHaveCount(0);
  });
});

test.describe("B. DID データ（本番相当サーバー・DID_DATA_DIR なし）", () => {
  test("米子市役所は DID 該当（red）で未確認にならない／タイヨー通信本社は非該当（green）", async ({ page }) => {
    await page.goto("/");
    // 同梱の DID（国土数値情報 A16 令和2年）が読めること自体も確かめる（未同梱なら失敗させる）。
    expect(await didBundled(page)).toBe(true);
    await selectPreset(page, "米子市役所");
    await expect(card(page, "aviation-law-did")).toHaveAttribute("data-status", "red");
    await selectPreset(page, "タイヨー通信本社");
    await expect(card(page, "aviation-law-did")).toHaveAttribute("data-status", "green");
  });
});

test.describe("C. 工業専用地域の除外（本番相当サーバー・実データ）", () => {
  test("境港市の工業専用地域内（実データ）では DID カードが green・『非該当（工業専用地域）』・告示第435号の出典リンク", async ({
    page,
  }) => {
    await page.goto("/");
    // 同梱の DID（A16 令和2年）と工専（A29 令和元年度）で、境港市の DID 内かつ工専の内側（約 385m）にある地点
    await gotoCoords(page, { lat: 35.541296, lng: 133.250208 });
    const did = card(page, "aviation-law-did");
    await expect(did).toHaveAttribute("data-status", "green");
    await expect(did.getByTestId("did-detail")).toHaveText("DID：非該当（工業専用地域）");
    await expect(did).toContainText("境港市 の工業専用地域内");
    await expect(did.getByRole("link", { name: /国土交通省告示第435号/ })).toHaveAttribute(
      "href",
      "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
    );
    await expect(page.getByTestId("diagnosis-did-status")).toContainText("非該当（工業専用地域）");
  });
});

// 縮退表示（未収録の市町村）は実データに該当地点を固定しにくいため、フィクスチャで確かめる。
test.describe("C. 工業専用地域の除外（フィクスチャ用サーバー）", () => {
  test.use({ baseURL: FIXTURE_URL });

  test("DID 内・工専未収録では『工業専用地域の除外：未確認』、収録済み市町村の DID 内・工専外では出ない", async ({
    page,
  }) => {
    await page.goto("/");
    await gotoCoords(page, { lat: 35.4278, lng: 133.3314 }); // フィクスチャ：米子市（未収録）の DID 内
    const did = card(page, "aviation-law-did");
    await expect(did).toHaveAttribute("data-status", "red");
    await expect(did).toContainText("工業専用地域の除外：未確認");

    await gotoCoords(page, { lat: 35.5447, lng: 133.237953 }); // フィクスチャ：境港市（収録済み）の DID 内・工専外
    await expect(did).toHaveAttribute("data-status", "red");
    await expect(did).not.toContainText("工業専用地域の除外：未確認");
  });

  test("DID 内かつ工専内では DID カードが green・『非該当（工業専用地域）』・告示第435号の出典リンク", async ({
    page,
  }) => {
    await page.goto("/");
    await gotoCoords(page, { lat: 35.5447, lng: 133.2269 }); // フィクスチャ：境港市の工業専用地域内
    const did = card(page, "aviation-law-did");
    await expect(did).toHaveAttribute("data-status", "green");
    await expect(did.getByTestId("did-detail")).toHaveText("DID：非該当（工業専用地域）");
    await expect(did.getByRole("link", { name: /国土交通省告示第435号/ })).toHaveAttribute(
      "href",
      "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
    );
    await expect(page.getByTestId("diagnosis-did-status")).toContainText("非該当（工業専用地域）");
  });
});

test.describe("D. データ出典と確認日（本番相当サーバー）", () => {
  test("米子市役所の判定で DID と飛行禁止法のカードにデータ名・基準年・確認日が出る", async ({ page }) => {
    await page.goto("/");
    await selectPreset(page, "米子市役所");
    const did = card(page, "aviation-law-did").getByTestId("regulation-datasets");
    await expect(did).toContainText("国土数値情報 人口集中地区データ（A16）令和2年");
    await expect(did).toContainText("基準年 2020");
    await expect(did).toContainText(/確認日 \d{4}-\d{2}-\d{2}/);
    const sdl = card(page, "small-drone-law").getByTestId("regulation-datasets");
    await expect(sdl).toContainText("小型無人機等飛行禁止法 対象施設");
    await expect(sdl).toContainText("基準年 2026");
    await expect(sdl).toContainText(/確認日 \d{4}-\d{2}-\d{2}/);
  });

  test("地点判定 PDF と申請支援 PDF にデータ名・確認日・反映済みの改正が入る", async ({ page }) => {
    await page.goto("/");
    await selectPreset(page, "米子市役所");

    const dl1 = page.waitForEvent("download");
    await page.getByRole("button", { name: /PDF 出力/ }).first().click();
    const t1 = await pdfText(await dl1);

    const dl2 = page.waitForEvent("download");
    await page.getByRole("button", { name: /束ね PDF を出力/ }).click();
    const t2 = await pdfText(await dl2);

    for (const t of [t1, t2]) {
      expect(t).toContain("国土数値情報 人口集中地区データ（A16）令和2年");
      expect(t).toMatch(/確認日 \d{4}-\d{2}-\d{2}/);
      expect(t).toContain("国土交通省告示第435号");
      expect(t).toContain("2026-07-01");
      expect(t).toContain("改正小型無人機等飛行禁止法");
      expect(t).toContain("2026-07-14");
      expect(t).toContain("免責");
    }
  });
});
