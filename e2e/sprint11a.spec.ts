import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

// Sprint 11a 契約（docs/sprints/sprint-11a.md）の E2E。制度の最新化と公開面の意図の明確化。
// 本番相当サーバー（baseURL、同梱データ）だけを使う。運航管理の項目は e2e/ops-db/sprint11a-db.spec.ts。

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

const checker = (page: Page): Locator => page.locator('section[aria-labelledby="checker-heading"]');
const diagnosisSection = (page: Page): Locator => page.locator('section[aria-labelledby="diagnosis-heading"]');
const hero = (page: Page): Locator => page.locator("header", { has: page.locator("h1") });
const card = (page: Page, id: string) => page.getByTestId(`regulation-card-${id}`);
const preset = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).first();

const selectPreset = async (page: Page, name: string): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await preset(page, name).click();
  await Promise.all([check, diag]);
};

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

const bundlePdf = async (page: Page): Promise<string> => {
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /束ね PDF を出力/ }).click();
  return pdfText(await dl);
};

test.describe("A. 地点の例と初期表示", () => {
  test("1. 判定の節の画面テキストと placeholder に「本社」「拠点」「日吉津」がない", async ({ page }) => {
    await openReady(page);
    const text = await checker(page).innerText();
    for (const w of ["本社", "拠点", "日吉津"]) expect(text, `判定の節に「${w}」`).not.toContain(w);
    const placeholders = await checker(page)
      .locator("input")
      .evaluateAll((els) => els.map((e) => e.getAttribute("placeholder") ?? ""));
    expect(placeholders.length).toBeGreaterThan(0);
    for (const p of placeholders) {
      for (const w of ["本社", "拠点", "日吉津"]) expect(p, `placeholder「${p}」に「${w}」`).not.toContain(w);
    }
  });

  test("2. 鳥取県の群の先頭が 米子市役所・美保基地の周辺・鳥取市の工業専用地域 の順で、既存の例も残る", async ({
    page,
  }) => {
    await openReady(page);
    const names = await checker(page)
      .getByRole("button")
      .filter({ visible: true })
      .filter({ hasText: "鳥取県" })
      .allInnerTexts();
    const first3 = names.slice(0, 3);
    expect(first3[0]).toContain("米子市役所");
    expect(first3[1]).toContain("美保基地の周辺（境港市）");
    expect(first3[2]).toContain("鳥取市の工業専用地域");
    await expect(preset(page, "米子鬼太郎空港")).toBeVisible();
    await expect(preset(page, "出雲大社")).toBeVisible();
  });

  test("3. 美保基地の周辺：飛行禁止法 red（1,000m）、DID green", async ({ page }) => {
    await openReady(page);
    await selectPreset(page, "美保基地の周辺（境港市）");
    await expect(card(page, "small-drone-law")).toHaveAttribute("data-status", "red");
    await expect(card(page, "small-drone-law")).toContainText("1,000m");
    await expect(card(page, "aviation-law-did")).toHaveAttribute("data-status", "green");
  });

  test("4. 鳥取市の工業専用地域：DID green・「DID：非該当（工業専用地域）」・申請支援も非該当（工業専用地域）", async ({
    page,
  }) => {
    await openReady(page);
    await selectPreset(page, "鳥取市の工業専用地域");
    await expect(card(page, "aviation-law-did")).toHaveAttribute("data-status", "green");
    await expect(page.getByTestId("did-detail")).toContainText("DID：非該当（工業専用地域）");
    await expect(page.getByTestId("diagnosis-did-status")).toContainText("非該当（工業専用地域）");
  });

  test("5. 開いた直後は米子市役所で、初回の判定は DID red・unknown なし・証跡 ID あり", async ({ page }) => {
    await openReady(page);
    await expect(page.getByPlaceholder("35.4278", { exact: true })).toHaveValue("35.4278");
    await expect(page.getByPlaceholder("133.3314", { exact: true })).toHaveValue("133.3314");
    await expect(card(page, "aviation-law-did")).toHaveAttribute("data-status", "red");
    const statuses = await page
      .locator('[data-testid^="regulation-card-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses).not.toContain("unknown");
    await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
  });
});

test.describe("B. トップの意図", () => {
  test("7. site-lead に対象と得られることがあり、地域名がない", async ({ page }) => {
    await openReady(page);
    const lead = hero(page).getByTestId("site-lead");
    const t = await lead.innerText();
    for (const w of ["業務でドローンを飛ばす事業者・操縦者", "飛ばす前に", "法令・条例", "手続き", "出典", "記録"]) {
      expect(t).toContain(w);
    }
    const h1 = await hero(page).locator("h1").innerText();
    for (const w of ["鳥取", "島根", "山陰"]) {
      expect(t).not.toContain(w);
      expect(h1).not.toContain(w);
    }
  });

  test("8. site-ops-note に運航管理・社内で試験運用があり、見出し領域に誇張の語がない", async ({ page }) => {
    await openReady(page);
    const note = await hero(page).getByTestId("site-ops-note").innerText();
    expect(note).toContain("運航管理");
    expect(note).toContain("社内で試験運用");
    const header = await hero(page).innerText();
    for (const w of ["唯一", "業界初", "No.1", "最適", "完全", "自動で申請", "一括申請", "AI"]) {
      expect(header, `見出し領域に「${w}」`).not.toContain(w);
    }
  });
});

test.describe("C. 制度の最新化（申請支援）", () => {
  test("12. 物件の投下を選ぶと通達の注記とリンクが出て、申請支援 PDF に通達の番号が入る", async ({ page }) => {
    await openReady(page);
    const diag = waitDiagnose(page);
    await page.getByRole("checkbox", { name: "物件の投下", exact: true }).check();
    await diag;
    const section = diagnosisSection(page);
    await expect(section).toContainText("国空無機第338898号");
    await expect(section.locator('a[href="https://www.mlit.go.jp/common/001990796.pdf"]').first()).toBeVisible();
    const t = await bundlePdf(page);
    expect(t).toContain("国空無機第338898号");
  });

  test("17. 緊急用務空域にチェックすると「飛行できません」で、提出期限の逆算が出ない。PDF も同様", async ({ page }) => {
    await openReady(page);
    const diag = waitDiagnose(page);
    await page.getByTestId("airspace-airspace_emergency").locator("input").check();
    await diag;
    const section = diagnosisSection(page);
    await expect(section).toContainText("飛行できません");
    const emergency = section.locator("article", { hasText: "緊急用務空域の指定の確認" });
    await expect(emergency).toBeVisible();
    await expect(emergency).not.toContainText("開庁日以上前までに提出");
    // 期限の一覧（逆算）にも緊急用務空域の項目がない
    const sectionText = await section.innerText();
    for (const line of sectionText.split("\n")) {
      if (line.includes("開庁日以上前までに提出")) expect(line).not.toContain("緊急用務");
    }
    await expect(section).not.toContainText("IIA 相当・申請が必要");
    // 原則飛行禁止は「要確認」ではなく言い切る
    await expect(section).toContainText("※ 緊急用務空域は原則として飛行禁止です");
    await expect(section).not.toContainText("要確認: 緊急用務空域");
    const t = await bundlePdf(page);
    expect(t).toContain("飛行できません");
    expect(t).toContain("緊急用務空域は原則として飛行禁止です");
    expect(t).not.toMatch(/要確認:\s*緊急用務空域/);
    expect(t).not.toContain("IIA 相当・申請が必要");
  });
});

test.describe("D. 過去の履歴は不変", () => {
  test("21. 変更前の形式の履歴（II_A・申請支援の証跡 ID）は書き換えられずにそのまま出る", async ({ page }) => {
    const OLD_DIAG = "ev_3ad16b0d5ef51d89";
    await page.addInitScript((diagId) => {
      if (window.sessionStorage.getItem("s11a-seeded")) return;
      window.sessionStorage.setItem("s11a-seeded", "1");
      window.localStorage.setItem(
        "soraban:history:v1",
        JSON.stringify([
          {
            evidenceId: "ev_5722337c7b5f785e",
            savedAt: "2026-10-18T00:00:00.000Z",
            loc: { lat: 35.4936, lng: 133.2361 },
            overall: "red",
            engineVersion: "soraban-0.3.0-regulations-2026-07",
            checkedAt: "2026-10-18T00:00:00.000Z",
            resolvedAddress: "緊急用務空域の旧履歴",
            diagnosisSummary: {
              diagnosisEvidenceId: diagId,
              category: "II_A",
              isSpecificFlight: true,
              procedureCount: 4,
            },
          },
        ]),
      );
    }, OLD_DIAG);
    await openReady(page);
    const item = page.getByTestId("history-item").filter({ hasText: "緊急用務空域の旧履歴" });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`diag:${OLD_DIAG}`);
    await expect(item).toContainText("cat:IIA相当");
    const stored = await page.evaluate(() => window.localStorage.getItem("soraban:history:v1") ?? "");
    expect(stored).toContain(OLD_DIAG);
  });
});
