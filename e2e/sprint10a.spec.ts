import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

// Sprint 10a 契約（docs/sprints/sprint-10a.md）の E2E。公開面の整備（トップ画面・PDF の表示）。
// 本番相当サーバー（baseURL）だけを使う。

const OPERATOR = "フューチャーテック株式会社";
const TITLE = "そらばん — ドローン飛行の可否判定と運航管理";
const PURPOSE = "ドローン飛行の可否判定と運航管理";

// 契約 1：画面テキストに出してはいけない語。
const SCREEN_FORBIDDEN = [
  "特許",
  "Patent",
  "出願",
  "PoC",
  "Phase",
  "盲点",
  "clausegraph",
  "ClauseGraph",
  "社内限定",
  "個人開発",
  "社内検討",
  "ぼうさいこくたい",
  "課金",
  "正式公開",
  "デモ",
  "Roadmap",
  "段階展開",
  "Next.js",
  "Tailwind",
  "Jamstack",
  "奥田",
  "seed",
  // 表記を「DIPS 2.0」にそろえる（公開面の残り指摘）
  "DIPS2.0",
  "年データ",
] as const;

// 契約 8・9：PDF に出してはいけない語。
const PDF_FORBIDDEN = ["特許", "Patent", "出願", "PoC", "Phase", "clausegraph", "奥田", "seed", "DIPS2.0"] as const;

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

/** ページを開き、初回の自動判定（地点判定・申請支援診断）が終わるのを待つ。 */
const openReady = async (page: Page): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto("/");
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
};

const hero = (page: Page): Locator => page.locator("header", { has: page.locator("h1") });

// PDF のテキスト抽出（pdfjs-dist。e2e/sprint7.spec.ts の pdfText と同じ方法）。
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

test.describe("A. トップ画面の文言", () => {
  test("1. 初回の判定が終わった画面テキストに社内向け・特許の語が 1 つもない", async ({ page }) => {
    await openReady(page);
    const body = await page.locator("body").innerText();
    for (const w of SCREEN_FORBIDDEN) expect(body, `画面に「${w}」が残っている`).not.toContain(w);
  });

  test("2. 見出し領域に名前と目的があり、エンジンの版の表示がない", async ({ page }) => {
    await openReady(page);
    const h = hero(page);
    await expect(h.locator("h1")).toContainText("そらばん");
    await expect(h).toContainText("そらばん");
    await expect(h).toContainText(PURPOSE);
    const text = await h.innerText();
    // 全国展開を見据え、見出しに地域を書かない（地域は site-facts の対象地域で示す）
    expect(text).not.toContain("山陰");
    await expect(page.getByTestId("site-facts")).toContainText("現在は鳥取県・島根県");
    expect(text).not.toContain("soraban-0.");
    expect(text).not.toContain("Engine");
  });

  test("3. site-facts に運営者と利用の範囲がある", async ({ page }) => {
    await openReady(page);
    const facts = page.getByTestId("site-facts");
    await expect(facts).toContainText(OPERATOR);
    await expect(facts).toContainText("現在は社内での試験運用中");
  });

  test("4. 幅 375px・高さ 812px の初期表示で site-disclaimer がビューポート内にある", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const d = page.getByTestId("site-disclaimer");
    await expect(d).toBeInViewport();
    for (const w of ["参考情報", "国土交通省", "警察", "自治体"]) await expect(d).toContainText(w);
  });

  test("5. 画面のフッターに運営者の著作権表示がある", async ({ page }) => {
    await openReady(page);
    await expect(page.locator("footer").last()).toContainText(`© 2026 ${OPERATOR}`);
  });

  test("6. document.title と meta description", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(TITLE);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", TITLE);
    for (const sel of ['meta[name="description"]', 'meta[property="og:description"]']) {
      const desc = await page.locator(sel).getAttribute("content");
      expect(desc, sel).toContain(OPERATOR);
      for (const w of ["SaaS", "山陰", "鳥取", "島根"]) expect(desc, `${sel} に「${w}」`).not.toContain(w);
    }
  });
});

test.describe("B. 表示の崩れ", () => {
  for (const width of [375, 1280]) {
    test(`7. 幅 ${width}px で横スクロールが出ず、見出し・site-facts・site-disclaimer・フッターがビューポート内に収まる`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      await openReady(page);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      const targets: Array<[string, Locator]> = [
        ["見出し領域", hero(page)],
        ["site-facts", page.getByTestId("site-facts")],
        ["site-disclaimer", page.getByTestId("site-disclaimer")],
        ["フッター", page.locator("footer").last()],
      ];
      for (const [name, loc] of targets) {
        const box = await loc.boundingBox();
        expect(box, `${name} が描画されていない`).not.toBeNull();
        expect(box!.x, `${name} の左端がはみ出している`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${name} の右端がはみ出している`).toBeLessThanOrEqual(clientWidth);
      }
    });
  }
});

test.describe("C. PDF", () => {
  test("8. 地点判定 PDF に運営者・免責・「判定の版」があり、特許・社内向けの語がない", async ({ page }) => {
    await openReady(page);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /PDF 出力/ }).first().click();
    const t = await pdfText(await dl);
    expect(t).toContain(OPERATOR);
    // メタのラベルは字間を空けて組むため、抽出テキストでは「判 定 の 版」になる。字形が無ければ抽出されない
    expect(t).toMatch(/判\s*定\s*の\s*版/);
    expect(t).toContain("免責");
    for (const w of PDF_FORBIDDEN) expect(t, `地点判定 PDF に「${w}」が残っている`).not.toContain(w);
  });

  test("9. 申請支援 PDF に運営者・免責・「判定の版」があり、特許・社内向けの語がない", async ({ page }) => {
    await openReady(page);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /束ね PDF を出力/ }).click();
    const t = await pdfText(await dl);
    expect(t).toContain(OPERATOR);
    // メタのラベルは字間を空けて組むため、抽出テキストでは「判 定 の 版」になる。字形が無ければ抽出されない
    expect(t).toMatch(/判\s*定\s*の\s*版/);
    expect(t).toContain("免責");
    // フッターの証跡 ID は日本語のラベルで出す（英字の「Evidence」にしない）
    expect(t).toMatch(/証跡 ID ev_[0-9a-f]{16}/);
    expect(t).not.toMatch(/Evidence ev_/);
    for (const w of PDF_FORBIDDEN) expect(t, `申請支援 PDF に「${w}」が残っている`).not.toContain(w);
  });
});
