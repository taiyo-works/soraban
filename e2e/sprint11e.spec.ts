import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

// Sprint 11e 契約（docs/sprints/sprint-11e.md）の E2E。100g 未満の機体（模型航空機）の手続きと参照先。
// 補助関数は e2e/sprint11d.spec.ts と同じ。
// （以下、元の説明）Sprint 11d 契約（docs/sprints/sprint-11d.md）の E2E。判定の 4 段（飛行不可／要手続き／手続き済み（条件付き）／
// 手続き不要）＋判定不能、結論の下の段取り（手続きと期限）、PDF・履歴の表示。
// 本番相当サーバー（baseURL、同梱データ）だけを使う。

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

const summary = (page: Page): Locator => page.getByTestId("verdict-summary");
const level = (page: Page): Locator => page.getByTestId("verdict-level");
const item = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="verdict-item"][data-item-id="${id}"]`);
const procedures = (page: Page): Locator => page.getByTestId("verdict-procedure");
const doneItem = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="verdict-done-item"][data-item-id="${id}"]`);
const duty = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="verdict-duty"][data-duty-id="${id}"]`);

/** 結論が出そろう（判定中でない）まで待つ。 */
const settled = async (page: Page): Promise<void> => {
  await expect(summary(page)).not.toHaveAttribute("data-level", "pending");
};

const openReady = async (page: Page): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto("/");
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
  await settled(page);
};

const preset = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).first();

const selectPreset = async (page: Page, name: string): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await preset(page, name).click();
  await Promise.all([check, diag]);
  await settled(page);
};

/** 緯度・経度を直接入れて判定する。 */
const gotoLatLng = async (page: Page, lat: number, lng: number): Promise<void> => {
  await page.getByPlaceholder("35.4278", { exact: true }).fill(String(lat));
  await page.getByPlaceholder("133.3314", { exact: true }).fill(String(lng));
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.getByRole("button", { name: /規制をチェック/ }).click();
  await Promise.all([check, diag]);
  await settled(page);
};

const conditions = (page: Page): Locator => page.locator("details", { hasText: "05 — 機体・運航条件" });
const openConditions = async (page: Page): Promise<void> => {
  const details = conditions(page);
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
};
const permitBox = (page: Page, name: string) => conditions(page).getByRole("checkbox", { name });

/** 入力を切り替え、再判定（地点判定・申請支援診断）が終わるのを待つ。 */
const toggle = async (box: Locator, page: Page, on: boolean, withCheck = true): Promise<void> => {
  const check = withCheck ? waitCheck(page) : Promise.resolve();
  const diag = waitDiagnose(page);
  if (on) await box.check();
  else await box.uncheck();
  await Promise.all([check, diag]);
  await settled(page);
};

/** 飛行方法のチェック（06 の中。申請支援の診断だけをやり直す）。 */
const methodBox = (page: Page, label: string) =>
  page.locator("fieldset", { hasText: "06 — 飛行方法" }).getByRole("checkbox", { name: label, exact: true });

const setPlannedDate = async (page: Page, iso: string): Promise<void> => {
  const diag = waitDiagnose(page);
  await page.locator('input[type="date"]').fill(iso);
  await diag;
  await settled(page);
};

const pdfText = async (download: Download): Promise<string> => {
  const file = await download.path();
  const data = new Uint8Array(await readFile(file));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const content = await p.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join("") + "\n";
  }
  return text;
};

/** 空白（改行・NBSP を含む）を除いて比べる。 */
const squash = (s: string): string => s.replace(/[\s ]+/g, "");

const exportPdf = async (page: Page): Promise<string> => {
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /PDF 出力/ }).click();
  return pdfText(await dl);
};


const QUIET = { lat: 35.38, lng: 133.35 };
const IZUMO_AROUND = { lat: 35.44, lng: 132.89 };
const EGOV = "https://laws.e-gov.go.jp/law/327AC0000000231";

const setWeight = async (page: Page, w: string): Promise<void> => {
  await openConditions(page);
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.getByPlaceholder(/例: 900／80/).fill(w);
  await Promise.all([check, diag]);
  await settled(page);
};

const RELAX = /100g 未満の例外|手続き不要（100g 未満）/;

test.describe("Sprint 11e：100g 未満の機体（模型航空機）", () => {
  test("12. 出雲縁結び空港の周辺で 50g：要手続き、第134条の3 の許可・出す先・事前に・参照先。PDF も同じ言葉と URL", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, IZUMO_AROUND.lat, IZUMO_AROUND.lng);
    await setWeight(page, "50");
    await expect(level(page)).toHaveText("要手続き");
    const proc = procedures(page).filter({ hasText: "航空法第134条の3 に基づく飛行の許可または通報（模型航空機・空港等の周辺）" });
    await expect(proc).toHaveCount(1);
    await expect(proc).toContainText("国土交通大臣");
    await expect(proc.getByTestId("verdict-procedure-deadline")).toHaveText("事前に（参照先で確認）");
    await expect(proc.getByTestId("model-aircraft-references").getByRole("link").first()).toHaveAttribute("href", EGOV);
    await expect(proc.getByRole("link", { name: /参照先：e-Gov 法令検索 航空法（航空法第134条の3）/ })).toBeVisible();
    await expect(item(page, "model-aircraft-airport")).toHaveAttribute("data-verdict", "needs_procedure");
    expect(await page.locator("body").innerText()).not.toMatch(RELAX);

    const text = await exportPdf(page);
    const t = squash(text);
    expect(t).toContain(squash("航空法第134条の3 に基づく飛行の許可または通報（模型航空機・空港等の周辺）"));
    expect(t).toContain(squash("国土交通大臣（窓口の空港事務所等は参照先で確認）"));
    expect(t).toContain(squash("事前に（参照先で確認）"));
    expect(t).toContain(EGOV);
    expect(text).not.toMatch(RELAX);
  });

  test("13. 米子市役所で 50g＋150m 以上：要手続き、通報と 150m／250m の注記、DID は対象外（模型航空機）、申請支援のカテゴリーと PDF", async ({
    page,
  }) => {
    await openReady(page);
    await setWeight(page, "50");
    await toggle(methodBox(page, "150m以上の高さ"), page, true, false);
    await expect(level(page)).toHaveText("要手続き");
    const proc = procedures(page).filter({ hasText: "航空法第134条の3 に基づく飛行の許可または通報（模型航空機・高い空域）" });
    await expect(proc).toHaveCount(1);
    await expect(proc).toContainText("150m");
    await expect(proc).toContainText("250m");
    await expect(item(page, "aviation-law-did")).toHaveAttribute("data-verdict", "no_procedure");
    await expect(item(page, "aviation-law-did").getByTestId("verdict-item-reason")).toContainText("対象外（模型航空機）");
    const headline = page.getByTestId("diagnosis-category-headline");
    await expect(headline).toContainText("対象外（模型航空機");
    await expect(page.locator("body")).not.toContainText("カテゴリー I（特定飛行に非該当）");

    // 申請支援の束ね PDF
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /束ね PDF を出力/ }).click();
    const app = await pdfText(await dl);
    expect(squash(app)).toContain(squash("対象外（模型航空機。航空法の無人航空機の区分に当たらない）"));
    expect(app).not.toContain("カテゴリー I（特定飛行に非該当）");
    expect(squash(app)).toContain(squash("航空法第134条の3 に基づく飛行の許可または通報"));
    // 飛行マニュアル骨子（独自）の根拠に無人航空機の特定飛行の条文を出さない
    expect(app).not.toContain("第132条の85");
    expect(app).not.toContain("第132条の86");

    const reg = await exportPdf(page);
    expect(squash(reg)).toContain(squash("航空法第134条の3 に基づく飛行の許可または通報（模型航空機・高い空域）"));
    expect(squash(reg)).toContain(squash("対象外（模型航空機）"));
    expect(reg).not.toMatch(RELAX);
  });

  test("14. 重さの欄に 50 を入れると、模型航空機の補足と中立の札が出る（緩和を示す表示はない）", async ({ page }) => {
    await openReady(page);
    await setWeight(page, "50");
    const note = page.getByTestId("model-aircraft-weight-note");
    await expect(note).toContainText("航空法の無人航空機の規制");
    await expect(note).toContainText("対象外");
    await expect(note).toContainText("第134条の3の許可または通報（管制圏等の内側は許可、外側は通報）");
    await expect(note).toContainText("小型無人機等飛行禁止法・条例は重量に関係なく対象");
    await expect(page.getByTestId("model-aircraft-tag")).toHaveText("模型航空機として判定");
    await expect(page.locator("body")).not.toContainText("100g 未満の例外");
    // 区域外でも 100g 未満なら管制圏等の確認が飛行の前後に出る
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    await expect(duty(page, "model-aircraft-control-zone-check")).toBeVisible();
    await expect(duty(page, "drone-registration")).toHaveCount(0);
  });
});
