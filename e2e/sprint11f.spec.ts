import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

// Sprint 11f 契約（docs/sprints/sprint-11f.md）の E2E。判定の表示の軽微な直し：
// 100g 未満で DID 内の地点の表示、診断待ちの履歴、参照先の分割、未収録の市町村の題名。
// 補助関数は e2e/sprint11e.spec.ts と同じ。本番相当サーバー（baseURL、同梱データ）だけを使う。

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
const MIHO = "美保基地の周辺（境港市）";
const EGOV = "https://laws.e-gov.go.jp/law/327AC0000000231";
const EGOV_ORD = "https://laws.e-gov.go.jp/law/327M50000800056";
const MODEL = "対象外（模型航空機）";

const setWeight = async (page: Page, w: string): Promise<void> => {
  await openConditions(page);
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.getByPlaceholder(/例: 900／80/).fill(w);
  await Promise.all([check, diag]);
  await settled(page);
};

const latestHistory = (page: Page) => page.getByTestId("history-item").first();
const bundledPdf = async (page: Page): Promise<string> => {
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /束ね PDF を出力/ }).click();
  return pdfText(await dl);
};

test.describe("Sprint 11f", () => {
  test("3・4. 米子市役所：50g は DID を対象外（模型航空機）と出し、900g は該当のまま", async ({ page }) => {
    await openReady(page);
    await setWeight(page, "50");
    const body50 = page.locator("body");
    await expect(page.getByTestId("diagnosis-did-status")).toContainText(`DID（人口集中地区）: ${MODEL}`);
    await expect(body50).toContainText(`DID 自動判定：${MODEL}`);
    await expect(item(page, "aviation-law-did")).toContainText(MODEL);
    const card = page.getByTestId("regulation-card-aviation-law-did");
    await expect(card.getByTestId("regulation-base-status")).toHaveText(MODEL);
    await expect(card.getByTestId("regulation-verdict-line")).toContainText(`元の判定 ${MODEL}`);
    await expect(card.getByTestId("regulation-excluded")).toContainText("対象外にした例外（模型航空機）");
    await expect(card.getByTestId("regulation-excluded")).toContainText("例外前の判定：該当");
    await expect(latestHistory(page)).toContainText(`DID:${MODEL}`);
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("DID（人口集中地区）: 非該当");
    expect(text).not.toContain("DID:非該当");
    expect(text).not.toMatch(/飛行可能|要確認・要許可/);

    const app = await bundledPdf(page);
    expect(squash(app)).toContain(squash(`DID（人口集中地区）: ${MODEL}`));
    expect(squash(app)).not.toContain(squash("DID（人口集中地区）: 非該当"));
    const reg = await exportPdf(page);
    expect(squash(reg)).toContain(squash(MODEL));
    expect(squash(reg)).toContain(squash("例外前の判定：該当"));
    expect(squash(reg)).not.toContain(squash("DID:非該当"));
    expect(squash(reg)).not.toContain(squash("DID（人口集中地区）: 非該当"));

    await setWeight(page, "900");
    await expect(page.getByTestId("diagnosis-did-status")).toContainText("DID（人口集中地区）: 該当");
    await expect(page.getByTestId("diagnosis-did-status")).not.toContainText("模型航空機");
    await expect(item(page, "aviation-law-did")).toContainText("該当");
    await expect(item(page, "aviation-law-did")).not.toContainText(MODEL);
    await expect(latestHistory(page)).toContainText("DID:該当");
    await expect(latestHistory(page)).not.toContainText("模型航空機");
    await expect(page.getByTestId("regulation-card-aviation-law-did").getByTestId("regulation-base-status")).toHaveText(
      "該当",
    );
  });

  test("6. 区域外で手続き不要の後、診断の応答が遅れる間、履歴は判定中で手続き不要も前の入力の表示も出ない", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    await expect(level(page)).toHaveText("手続き不要");
    await expect(latestHistory(page).getByTestId("history-verdict")).toHaveText(/^手続き不要/);
    await expect(latestHistory(page)).toContainText("cat:");

    await page.route("**/api/diagnose", async (route) => {
      await new Promise((r) => setTimeout(r, 4_000));
      await route.continue();
    });
    const diag = waitDiagnose(page);
    await methodBox(page, "夜間飛行").check();
    const v = latestHistory(page).getByTestId("history-verdict");
    await expect(v).toHaveAttribute("data-pending", "true");
    await expect(v).toContainText("判定中");
    await expect(latestHistory(page)).not.toContainText("手続き不要");
    await expect(latestHistory(page)).not.toContainText("cat:");
    await expect(latestHistory(page)).not.toContainText("DID:");
    await expect(latestHistory(page)).not.toContainText("手続き");
    await diag;
    await settled(page);
    await page.unroute("**/api/diagnose");
    await expect(level(page)).toHaveText("要手続き");
    await expect(v).not.toHaveAttribute("data-pending", "true");
    await expect(v).toHaveText(/^要手続き/);
    await expect(latestHistory(page)).toContainText("cat:");
  });

  test("10. 出雲縁結び空港の周辺で 50g：参照先に航空法と航空法施行規則が別々に出る。PDF に両方の URL", async ({ page }) => {
    await openReady(page);
    await gotoLatLng(page, IZUMO_AROUND.lat, IZUMO_AROUND.lng);
    await setWeight(page, "50");
    const proc = procedures(page).filter({ hasText: "航空法第134条の3 に基づく飛行の許可" });
    const refs = proc.getByTestId("model-aircraft-references");
    const law = refs.getByRole("link", { name: "参照先：e-Gov 法令検索 航空法（航空法第134条の3）（新しいタブで開く）", exact: true });
    const ord = refs.getByRole("link", {
      name: "参照先：e-Gov 法令検索 航空法施行規則（航空法施行規則第239条の2）（新しいタブで開く）",
      exact: true,
    });
    await expect(law).toHaveAttribute("href", EGOV);
    await expect(ord).toHaveAttribute("href", EGOV_ORD);
    expect(await refs.getByRole("link").count()).toBe(6);
    const text = await exportPdf(page);
    expect(squash(text)).toContain(EGOV);
    expect(squash(text)).toContain(EGOV_ORD);
    expect(squash(text)).not.toContain("は航空法施行規則");
  });

  test("11・13. 境港市の地点：未収録の史跡の題名に米子市の名前が出ず、判定不能の件数が結論の横に出る", async ({ page }) => {
    await openReady(page);
    await selectPreset(page, MIHO);
    await expect(page.getByTestId("verdict-unknown-count")).toContainText(/判定不能 \d+ 件（データ未整備）/);
    const row = item(page, "31202-heritage-protection");
    await expect(row).toContainText("市町村の文化財保護条例（データ未整備）");
    await expect(row).not.toContainText("米子市");
    const card = page.getByTestId("regulation-card-31202-heritage-protection");
    await expect(card).toContainText("市町村の文化財保護条例（データ未整備）");
    await expect(card).not.toContainText("米子市文化財保護条例");
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("米子市文化財保護条例");
    expect(text).not.toContain("米子市都市公園条例"); // 境港市の都市公園は収録済み。米子市の題名は出ない
    const reg = await exportPdf(page);
    expect(squash(reg)).not.toContain(squash("米子市文化財保護条例"));
    expect(squash(reg)).toContain(squash("市町村の文化財保護条例（データ未整備）"));
  });

  test("カード：50g の米子市役所は DID の行を模型航空機のため対象外と出し、許可・承認なく飛行できませんを出さない。900g は従来どおり", async ({
    page,
  }) => {
    await openReady(page);
    const card = page.getByTestId("regulation-card-aviation-law-did");
    await expect(card.getByTestId("did-detail")).toHaveText("DID：該当");
    await expect(card).toContainText("許可・承認なく飛行できません");
    await setWeight(page, "50");
    await expect(card.getByTestId("did-detail")).toHaveText("DID：該当（模型航空機のため対象外）");
    await expect(card.getByTestId("did-detail")).not.toHaveClass(/border-signal-red/);
    await expect(card).not.toContainText("許可・承認なく飛行できません");
    await expect(card).toContainText("対象外です");
    const reg = await exportPdf(page);
    expect(squash(reg)).not.toContain(squash("許可・承認なく飛行できません"));
    await setWeight(page, "900");
    await expect(card.getByTestId("did-detail")).toHaveText("DID：該当");
    await expect(card).toContainText("許可・承認なく飛行できません");
  });

  test("診断が失敗した後の履歴は判定未確定で、前の診断のカテゴリー・DID・手続きの件数・診断の証跡 ID を出さない。回復すると戻る", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    await expect(latestHistory(page)).toContainText("cat:");
    await page.route("**/api/diagnose", (route) => route.fulfill({ status: 500, body: '{"error":"test"}' }));
    const failed = page.waitForResponse((r) => r.url().endsWith("/api/diagnose"));
    await methodBox(page, "夜間飛行").check();
    await failed;
    await expect(page.getByTestId("verdict-failed")).toBeVisible();
    const row = latestHistory(page);
    await expect(row.getByTestId("history-verdict")).toContainText("判定未確定");
    await expect(row).not.toContainText("cat:");
    await expect(row).not.toContainText("DID:");
    await expect(row).not.toContainText("手続き1");
    await expect(row).not.toContainText("diag:");
    // 保存値にも前の診断の判定は残らない（開き直した行は判定未確定）
    const stored = await page.evaluate(() => window.localStorage.getItem("soraban:history:v1") ?? "");
    const first = JSON.parse(stored)[0] as { diagnosisSummary?: { verdict?: string } };
    expect(first.diagnosisSummary?.verdict).toBeUndefined();
    await page.unroute("**/api/diagnose");
    const diag = waitDiagnose(page);
    await page.getByTestId("verdict-retry").click();
    await diag;
    await settled(page);
    await expect(level(page)).toHaveText("要手続き");
    await expect(latestHistory(page).getByTestId("history-verdict")).toHaveText(/^要手続き/);
    await expect(latestHistory(page)).toContainText("cat:");
    await expect(latestHistory(page)).toContainText("手続き");
  });
});
