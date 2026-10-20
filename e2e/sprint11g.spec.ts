import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

// Sprint 11g 契約 14〜16（docs/sprints/sprint-11g.md）の E2E。100g 未満の機体（模型航空機）の手続きを「許可または通報」と表示する。
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
const SITE = { lat: 35.4136, lng: 132.89 };
const NEW_URLS = [
  "https://www.mlit.go.jp/koku/koku_fr10_000040.html",
  "https://www.mlit.go.jp/koku/content/001407133.pdf",
  "https://www.mlit.go.jp/koku/koku_fr10_000042.html",
];
const RULE = "管制圏・情報圏・高度変更禁止空域・特別管制空域の内側は国土交通大臣の許可";

const setWeight = async (page: Page, w: string): Promise<void> => {
  await openConditions(page);
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.getByPlaceholder(/例: 900／80/).fill(w);
  await Promise.all([check, diag]);
  await settled(page);
};


test.describe("Sprint 11g：許可または通報", () => {
  test("14. 出雲縁結び空港の周辺で 50g：許可または通報、内側＝許可・外側＝通報、参照先 9 件（読み上げの名前が異なる）。PDF に同じ手続き名・理由と 9 件の URL", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, IZUMO_AROUND.lat, IZUMO_AROUND.lng);
    await setWeight(page, "50");
    await expect(level(page)).toHaveText("要手続き");
    const proc = procedures(page).filter({ hasText: "許可または通報（模型航空機・空港等の周辺）" });
    await expect(proc).toHaveCount(1);
    await expect(proc).toContainText("国土交通大臣");
    await expect(proc.getByTestId("verdict-procedure-deadline")).toHaveText("事前に（参照先で確認）");
    await expect(proc).toContainText(RULE);
    await expect(proc).toContainText("外側は事前の通報");
    const refs = proc.getByTestId("model-aircraft-references");
    const links = refs.getByRole("link");
    expect(await links.count()).toBe(9);
    const names = await links.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent ?? ""));
    expect(new Set(names).size).toBe(9);
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    for (const u of NEW_URLS) expect(hrefs).toContain(u);

    const text = await exportPdf(page);
    const t = squash(text);
    expect(t).toContain(squash("航空法第134条の3 に基づく飛行の許可または通報（模型航空機・空港等の周辺）"));
    expect(t).toContain(squash(RULE));
    expect(t).toContain(squash("事前に（参照先で確認）"));
    for (const u of [EGOV, ...NEW_URLS]) expect(t).toContain(u);
  });

  test("15. 米子市役所で 50g＋150m 以上：許可または通報（高い空域）、確認の義務項目、申請支援の注記・PDF・飛行マニュアル骨子", async ({
    page,
  }) => {
    await openReady(page);
    await setWeight(page, "50");
    await toggle(methodBox(page, "150m以上の高さ"), page, true, false);
    await expect(level(page)).toHaveText("要手続き");
    const proc = procedures(page).filter({ hasText: "許可または通報（模型航空機・高い空域）" });
    await expect(proc).toHaveCount(1);
    await expect(proc).toContainText("150m");
    await expect(proc).toContainText("250m");
    const d = duty(page, "model-aircraft-control-zone-check");
    await expect(d).toContainText("許可か通報かの確認");
    await expect(d).toContainText("空港事務所・管制機関・空港管理者");
    await expect(page.getByTestId("model-aircraft-weight-note")).toContainText(
      "許可または通報（管制圏等の内側は許可、外側は通報）",
    );

    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /束ね PDF を出力/ }).click();
    const app = await pdfText(await dl);
    const a = squash(app);
    expect(a).toContain(squash("許可または通報（管制圏等の内側は許可、外側は通報）"));
    expect(a).toContain(squash("航空法第134条の3 に基づく飛行の許可または通報（模型航空機・高い空域）"));
    for (const u of NEW_URLS) expect(a).toContain(u);
    // 飛行マニュアル骨子：許可または通報の観点
    expect(a).toContain(squash("内側（許可）か外側（通報）かは、空港事務所・管制機関・空港管理者に確かめる"));
    expect(app).not.toContain("第132条の85");

    // 地点判定の PDF：長い手続き名の折り返しで「-」が入らない
    const reg = squash(await exportPdf(page));
    expect(reg).toContain(squash("航空法第134条の3 に基づく飛行の許可または通報（模型航空機・高い空域）"));
    expect(reg).toContain(squash("許可か通報かの確認（管制圏・情報圏・高度変更禁止空域・特別管制空域の内か外か）"));
    for (const u of NEW_URLS) expect(reg).toContain(u);
  });

  test("16. 出雲縁結び空港の敷地内で 50g：飛行不可。新しい note（画面と PDF）。「航空法に基づき」が出ない", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, SITE.lat, SITE.lng);
    await setWeight(page, "50");
    await expect(level(page)).toHaveText("飛行不可");
    const body = squash(await page.locator("body").innerText());
    expect(body).toContain(squash("安全側の判定。空港の管理者への確認が要り、許可・同意・機体重量を入力しても変わりません"));
    expect(body).not.toContain("航空法に基づき");
    expect(body).not.toContain("主要8空港");
    const t = squash(await exportPdf(page));
    expect(t).toContain(squash("安全側の判定。空港の管理者への確認が要り、許可・同意・機体重量を入力しても変わりません"));
    expect(t).not.toContain("航空法に基づき");
    await setWeight(page, "900");
    await expect(level(page)).toHaveText("飛行不可");
  });
});
