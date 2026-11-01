import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { expectNoApplicationSupport, openDetails } from "./field-checks";

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

// 条例を収録していない市町村（日吉津村）の地点。国の規制は該当しない（Sprint 11a で地点の例から外した地点）。
const OUTSIDE_COVERAGE = { lat: 35.434238, lng: 133.380508 };

const preset = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).first();

const card = (page: Page, id: string) => page.getByTestId(`regulation-card-${id}`);

const waitCheck = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

const gotoCoords = async (page: Page, loc: { lat: number; lng: number }): Promise<void> => {
  const input = page.getByPlaceholder(/Google マップの URL/);
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

  test("飛行禁止法が red の地点で判定の手続きに『同意＋事前通報』が出て、規制カードに出典リンクがある。green の地点では出ない", async ({
    page,
  }) => {
    // 以前は申請支援の診断パネル（article）の『同意＋事前通報』と、その出典リンク（npa.go.jp の通報のページ）を検査していた。
    // 申請支援を止めたので（Sprint 18-1）、判定の「要手続きの手続き」の行と、規制カードの出典リンク（npa.go.jp）で検査する。
    // 診断パネルの出典（tsuhou.html）は画面に出なくなった。手続きのデータは sprint12a-diagnose-baseline.json（応答全文の基準）が守る。
    const consent = page.locator('[data-testid="verdict-procedure"][data-procedure-id="verdict-small-drone-consent"]');
    const notice = page.locator('[data-testid="verdict-procedure"][data-procedure-id="verdict-small-drone-notice"]');
    await page.goto("/");
    await gotoCoords(page, MIHO_700M);
    await expect(consent).toContainText("施設管理者の同意と都道府県公安委員会への事前通報（飛行の 48 時間前まで）");
    await expect(notice).toBeVisible();
    await expect(card(page, "small-drone-law").getByRole("link", { name: /出典/ })).toHaveAttribute(
      "href",
      "https://www.npa.go.jp/bureau/security/kogatamujinki/index.html",
    );
    await expectNoApplicationSupport(page, "7 #98");

    await gotoCoords(page, OUTSIDE_COVERAGE);
    await expect(card(page, "small-drone-law")).toHaveAttribute("data-status", "green");
    await expect(consent).toHaveCount(0);
    await expect(notice).toHaveCount(0);
  });
});

test.describe("B. DID データ（本番相当サーバー・DID_DATA_DIR なし）", () => {
  test("米子市役所は DID 該当（red）で未確認にならない／収録範囲外の地点（日吉津村）は非該当（green）", async ({ page }) => {
    await page.goto("/");
    // 同梱の DID（国土数値情報 A16 令和2年）が読めること自体も確かめる（未同梱なら失敗させる）。
    expect(await didBundled(page)).toBe(true);
    await selectPreset(page, "米子市役所");
    await expect(card(page, "aviation-law-did")).toHaveAttribute("data-status", "red");
    await gotoCoords(page, OUTSIDE_COVERAGE);
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
    await openDetails(did.getByTestId("regulation-detail")); // 反映済みの改正は「根拠の詳細」に畳んである
    await expect(did.getByRole("link", { name: /国土交通省告示第435号/ })).toHaveAttribute(
      "href",
      "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
    );
    await expect(page.getByTestId("did-status")).toContainText("非該当（工業専用地域）"); // 以前は申請支援の diagnosis-did-status（Sprint 18-1 で did-status に）
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
    await openDetails(did.getByTestId("regulation-detail")); // 反映済みの改正は「根拠の詳細」に畳んである
    await expect(did.getByRole("link", { name: /国土交通省告示第435号/ })).toHaveAttribute(
      "href",
      "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
    );
    await expect(page.getByTestId("did-status")).toContainText("非該当（工業専用地域）"); // 以前は申請支援の diagnosis-did-status（Sprint 18-1 で did-status に）
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

  test("地点判定 PDF にデータ名・確認日・反映済みの改正が入る（申請支援の束ね PDF は出ない）", async ({ page }) => {
    await page.goto("/");
    await selectPreset(page, "米子市役所");

    const dl1 = page.waitForEvent("download");
    await page.getByRole("button", { name: /PDF 出力/ }).first().click();
    const t1 = await pdfText(await dl1);
    // 以前は申請支援の束ね PDF（t2）も同じ項目を検査していた。Sprint 18-1 で束ね PDF を止めたので、出ないことを検査する。
    await expectNoApplicationSupport(page, "7 #199");

    for (const t of [t1]) {
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
