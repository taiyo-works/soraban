import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { BOUNDARY_FULL } from "../apps/web/src/lib/boundary";
import { DISCLAIMER_JUDGEMENT } from "../apps/web/src/lib/disclaimers";
import { PROVIDER } from "../apps/web/src/lib/provider-info";
import { saveScan, scanPage, scanPlaceholders, scanString, violationsOf, type ScanRecord } from "./wording-scan";

// Sprint 18-3 契約（docs/sprints/sprint-18.md §7.3）の公開側 E2E：提供元の表記（3-2・3-3）、題名・説明（3-4）、禁止語・限定語の走査（3-8）、横スクロールなし（3-11）。
// 本番相当サーバー（baseURL。next start）だけを使う。走査は 1 本のテストにまとめ、状態を順に巡回する（実行時間を抑える）。違反は最後にまとめて出す。

const TITLE = "そらばん — ドローンの飛行計画の通報・点検・飛行日誌";
const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());
const settled = (page: Page) => expect(page.getByTestId("verdict-summary")).not.toHaveAttribute("data-level", "pending");

const openReady = async (page: Page): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto("/");
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
  await settled(page);
};

const selectPreset = async (page: Page, name: string): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).first().click();
  await Promise.all([check, diag]);
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

const noHorizontalScroll = async (page: Page, label: string): Promise<void> => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `${label}: 横スクロールがある`).toBeLessThanOrEqual(clientWidth);
};

for (const vp of [
  { width: 375, height: 812 },
  { width: 1280, height: 900 },
] as const) {
  test.describe(`3-2・3-4・3-11 提供元の表記と題名（${vp.width}×${vp.height}）`, () => {
    test("フッターの site-provider に確認済みの 6 項目と境界の文。未確認の項目は出ない。見出しの副題・説明は新しい値", async ({ page }) => {
      await page.setViewportSize(vp);
      await openReady(page);
      const prov = page.getByTestId("site-provider");
      await expect(prov).toBeAttached();
      await prov.scrollIntoViewIfNeeded();
      for (const v of [PROVIDER.name, PROVIDER.representative, `〒${PROVIDER.postalCode} ${PROVIDER.address}`, PROVIDER.phone, PROVIDER.email, PROVIDER.hours]) {
        await expect(prov, v).toContainText(v);
      }
      expect(await prov.locator("[data-testid^='provider-']").count()).toBe(6);
      await expect(page.getByTestId("site-boundary")).toHaveText(BOUNDARY_FULL);
      // 免責事項の本文は DISCLAIMER_JUDGEMENT（Sprint 18-3 §5.4）
      await expect(page.locator("#disclaimer-heading").locator("xpath=..")).toContainText(DISCLAIMER_JUDGEMENT);
      // 見出しの副題・題名・説明・OG
      await expect(page.locator(".sb-hero-sub")).toHaveText("ドローンの飛行計画の通報・点検・飛行日誌");
      await expect(page).toHaveTitle(TITLE);
      for (const sel of ['meta[name="description"]', 'meta[property="og:description"]']) {
        const d = await page.locator(sel).getAttribute("content");
        expect(d, sel).toBe(`ドローンの飛行計画の通報の記録、飛行前・飛行後の点検、飛行日誌をまとめる運航管理アプリです。地点の判定は補助の機能です。提供元：${PROVIDER.name}。現在は社内での試験運用中です。`);
      }
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", TITLE);
      await expect(page.getByTestId("site-lead")).toContainText("判定は補助");
      await expect(page.getByTestId("site-ops-note")).toHaveText("通報の記録・点検・飛行日誌は、運航管理の画面で扱います（社内で試験運用中）。");
      // 3-3：載せない語
      const ph = await scanPlaceholders(page, "/");
      expect(violationsOf(ph)).toEqual([]);
      // 受付時間の近く 30 文字以内に曜日・祝日の語がない
      const near = await prov.evaluate((el) => {
        const t = el.textContent ?? "";
        const i = t.indexOf("受付時間");
        return t.slice(Math.max(0, i - 30), i + 30 + "9:00〜17:00".length + 4);
      });
      expect(near).not.toMatch(/平日|土日|祝日|曜日/);
      // ロゴ画像を使っていない（U2：使用ルールが未確認）
      expect(await page.locator("img[src*='futuretec'], img[src*='logo']").count()).toBe(0);
      await noHorizontalScroll(page, `${vp.width}`);
    });
  });
}

test.describe("3-8 禁止語・限定語の走査（公開の /）", () => {
  test("初期表示・プリセット 4 地点・機体と運航条件を開いた後・地点判定の PDF で、全面禁止語が 0、限定語が許可リストの外に 0", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 375, height: 812 });
    const all: ScanRecord[] = [];
    await openReady(page);
    all.push(...(await scanPage(page, "/", "初期表示（米子市役所）")));
    // 機体・運航条件を開いた後
    await page.locator("details", { hasText: "機体・運航条件" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    all.push(...(await scanPage(page, "/", "機体・運航条件を開いた後")));
    // 手で選んだ地点
    for (const name of ["美保基地の周辺（境港市）", "鳥取市の工業専用地域"]) {
      await selectPreset(page, name);
      all.push(...(await scanPage(page, "/", name)));
    }
    const diag = waitDiagnose(page);
    await page.getByTestId("airspace-airspace_emergency").locator("input").check();
    await diag;
    await settled(page);
    all.push(...(await scanPage(page, "/", "緊急用務空域を手で選んだ")));
    // 地点判定の PDF（判定の結果の再掲。限定語は記録だけ、全面禁止語は 0）
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /PDF 出力/ }).first().click();
    const t = await pdfText(await dl);
    expect(t).toContain(DISCLAIMER_JUDGEMENT.replace(/\s/g, "").slice(0, 20));
    expect(t).not.toContain("許可申請");
    all.push(...scanString("PDF（地点判定）", "米子市役所＋緊急用務空域", t.replace(/\s+/g, ""), true));
    saveScan("public", all);
    expect(violationsOf(all)).toEqual([]);
  });
});
