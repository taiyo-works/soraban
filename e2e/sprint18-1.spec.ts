import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { BOUNDARY_SHORT } from "../apps/web/src/lib/boundary";
import { DISCLAIMER_JUDGEMENT } from "../apps/web/src/lib/disclaimers";
import { APPLICATION_SUPPORT_WORDS, expectNoApplicationSupport } from "./field-checks";

// Sprint 18-1 契約（docs/sprints/sprint-18.md §7.1）：公開の `/` の申請支援を、機能フラグ APPLICATION_SUPPORT_ENABLED（既定・本番は無効）で止める。
// 本番相当サーバー（baseURL。next start）だけを使う。フラグを有効にした E2E は作らない（公開の `/` は静的に描かれ、値はビルドのときに固まるため。
// apps/web/src/lib/boundary.ts）。止めたコードの回帰は packages/regulations の単体テストとルートの層の単体テストが守る。
// 置き換えた既存の E2E は docs/evaluations/sprint-18-test-changes.md、画面に出なくなった data-testid は sprint-18-testid-map.md。

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

const openReady = async (page: Page): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto("/");
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
  await settled(page);
};

const settled = async (page: Page): Promise<void> => {
  await expect(page.getByTestId("verdict-summary")).not.toHaveAttribute("data-level", "pending");
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

const checkEmergency = async (page: Page): Promise<void> => {
  const diag = waitDiagnose(page);
  await page.getByTestId("airspace-airspace_emergency").locator("input").check();
  await diag;
  await settled(page);
};

const methodNight = (page: Page) =>
  page
    .locator("fieldset", { hasText: "飛行の方法（選ぶと判定に反映します）" })
    .getByRole("checkbox", { name: "夜間飛行", exact: true });

const setNight = async (page: Page, on: boolean): Promise<void> => {
  if ((await methodNight(page).isChecked()) === on) return;
  const diag = waitDiagnose(page);
  if (on) await methodNight(page).check();
  else await methodNight(page).uncheck();
  await diag;
  await settled(page);
};

const openAllDetails = (page: Page): Promise<void> =>
  page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));

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

type Point = { readonly name: string; readonly go: (page: Page) => Promise<void> };
const POINTS: readonly Point[] = [
  { name: "米子市役所（初期表示）", go: async () => undefined },
  { name: "美保基地の周辺（境港市）", go: (p) => selectPreset(p, "美保基地の周辺（境港市）") },
  { name: "鳥取市の工業専用地域", go: (p) => selectPreset(p, "鳥取市の工業専用地域") },
  { name: "米子市役所＋緊急用務空域", go: (p) => checkEmergency(p) },
];

for (const vp of [
  { width: 375, height: 812 },
  { width: 1280, height: 900 },
] as const) {
  test.describe(`1-1 申請支援は出ない（${vp.width}×${vp.height}）`, () => {
    for (const point of POINTS) {
      test(`${point.name}：本文に申請支援の語が 0 件。診断の部品が 0 個。畳みを全部開いても同じ`, async ({ page }) => {
        await page.setViewportSize(vp);
        await openReady(page);
        await point.go(page);
        await expectNoApplicationSupport(page, point.name);
        await openAllDetails(page);
        await expectNoApplicationSupport(page, `${point.name}（畳みを開く）`);
        // 横スクロールなし（1-8）
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, "横スクロールがある").toBeLessThanOrEqual(clientWidth);
      });
    }
  });
}

test.describe("1-2 判定は残る", () => {
  test("結論・要手続きの手続き・義務・規制ごとの判定・責任の注記・DID 自動判定・証跡 ID が見え、地点判定の PDF が出る", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    for (const id of [
      "verdict-level",
      "verdict-procedures-section",
      "verdict-duties-section",
      "verdict-items",
      "verdict-responsibility",
      "did-status",
      "evidence-id",
    ]) {
      await expect(page.getByTestId(id).first(), id).toBeVisible();
    }
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /PDF 出力/ }).first().click();
    const t = await pdfText(await dl);
    expect(t).toContain("免責");
    expect(t).toMatch(/証跡 ID（判定と手続き）ev_[0-9a-f]{16}/);
  });

  // 4 段の結論は、申請支援を止める前と同じ。値は判定エンジンの出力（/api/diagnose の handleDiagnosePost。応答の SHA を diagnose-core.test.ts が守る）に
  // 結びつくので、18-1 の前後で変わらない。前の値は基準のコミット（8b3ee65）のビルドで同じ 8 通りを取り、完全に一致した（sprint-18-test-changes.md に記録）。
  const EXPECTED: Readonly<Record<string, readonly [string, string]>> = {
    "米子市役所（初期表示）": ["needs", "needs"],
    "美保基地の周辺（境港市）": ["needs", "needs"],
    "鳥取市の工業専用地域": ["none", "needs"],
    "米子市役所＋緊急用務空域": ["no", "no"],
  };
  test("4 地点 × 飛行の方法 2 通り（なし・夜間）で、結論の data-verdict-key が前と同じ", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    const seen: string[] = [];
    for (const point of POINTS) {
      await point.go(page);
      for (const night of [false, true]) {
        await setNight(page, night);
        const key = await page.getByTestId("verdict-level").getAttribute("data-verdict-key");
        const [none, withNight] = EXPECTED[point.name]!;
        expect(key, `${point.name} ${night ? "夜間" : "なし"}`).toBe(night ? withNight : none);
        seen.push(`${point.name}/${night ? "夜間" : "なし"}=${key}`);
      }
      await setNight(page, false);
    }
    expect(seen).toHaveLength(8);
  });
});

test.describe("1-3 責任の注記は境界の文", () => {
  test("verdict-responsibility の文が BOUNDARY_SHORT。「下書き」「手伝います」が無く、代行・代理の語が無い", async ({ page }) => {
    await openReady(page);
    const note = page.getByTestId("verdict-responsibility");
    await expect(note).toContainText(BOUNDARY_SHORT);
    // 結論が「手続き済み」のときだけ記録の注記が続く。初期表示（要手続き）は境界の文だけ。
    await expect(note).toHaveText(BOUNDARY_SHORT);
    const text = (await note.innerText()) + (await page.locator("main").innerText());
    expect(text).not.toMatch(/下書き|手伝います|代行|代理/);
  });
});

test.describe("1-4 /api/diagnose の応答に prefill が無い", () => {
  test("verdict・procedures・evidenceId はある。prefill は無い", async ({ request }) => {
    const res = await request.post("/api/diagnose", {
      data: { lat: 35.4278, lng: 133.3314, droneWeightG: 900, flags: ["method_night"], plannedDate: "2027-01-14" },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const j = (await res.json()) as Record<string, unknown>;
    expect("prefill" in j, "prefill が残っている").toBe(false);
    expect(j["verdict"]).toBeTruthy();
    expect(Array.isArray(j["procedures"])).toBe(true);
    expect(String(j["evidenceId"])).toMatch(/^ev_[0-9a-f]{16}$/);
  });
});

test.describe("1-4b /api/diagnose の応答に申請期限の逆算・診断の説明が無い（レビュー M1）", () => {
  test("deadlines・categoryNote が無く、「開庁日」「提出期限の目安」が応答のどこにも無い。category・procedures・verdict は残る", async ({ request }) => {
    const res = await request.post("/api/diagnose", {
      data: { lat: 35.4278, lng: 133.3314, flags: ["method_night"], plannedDate: "2027-01-14" },
    });
    expect(res.status()).toBe(200);
    const text = await res.text();
    const j = JSON.parse(text) as Record<string, unknown>;
    for (const k of ["prefill", "deadlines", "categoryNote"]) expect(k in j, k).toBe(false);
    expect(text).not.toContain("提出期限の目安");
    expect(text).not.toContain("開庁日以上前までに提出");
    expect(typeof j["category"]).toBe("string");
    expect(Array.isArray(j["procedures"])).toBe(true);
    expect(j["verdict"]).toBeTruthy();
  });
});

test.describe("1-5 文言", () => {
  test("凡例「飛行の方法」・予定日と補助者の説明・常設の免責 DISCLAIMER_JUDGEMENT。「起算日」「提出期限の逆算」「プリフィル」が無い", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    const fs = page.locator("fieldset", { hasText: "飛行の方法（選ぶと判定に反映します）" });
    await expect(fs.locator("legend")).toContainText("飛行の方法");
    await expect(fs.locator("legend")).not.toContainText("申請支援");
    await expect(fs).toContainText("飛行の予定日（判定の条件に使います）");
    await expect(fs).not.toContainText("起算日");
    await expect(fs).not.toContainText("提出期限の逆算");
    // 目視外を選ぶと補助者の説明が出る
    const diag = waitDiagnose(page);
    await fs.getByRole("checkbox", { name: /目視外/ }).first().check();
    await diag;
    await expect(fs).toContainText("補助者の有無を判定の条件に使います");
    await expect(fs).not.toContainText("プリフィル");
    // 常設の免責と結果の免責は DISCLAIMER_JUDGEMENT
    await expect(page.locator("main").getByText(DISCLAIMER_JUDGEMENT, { exact: false }).first()).toBeVisible();
    expect(await page.getByText(DISCLAIMER_JUDGEMENT, { exact: false }).count()).toBeGreaterThanOrEqual(2);
  });

  test("判定に失敗したときの文は「飛行の方法を含む判定」。「申請支援」の語が無い", async ({ page }) => {
    await openReady(page);
    await page.route("**/api/diagnose", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
    await methodNight(page).check();
    await expect(page.getByTestId("verdict-failed-note")).toContainText("飛行の方法を含む判定に失敗したため");
    await expect(page.getByTestId("verdict-failed-note")).not.toContainText("申請支援");
    const text = await page.evaluate(() => document.body.textContent ?? "");
    expect(text).not.toContain("申請支援");
  });

  test("地点判定の PDF に「許可申請」が無い", async ({ page }) => {
    await openReady(page);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /PDF 出力/ }).first().click();
    const t = await pdfText(await dl);
    expect(t).not.toContain("許可申請");
    for (const w of APPLICATION_SUPPORT_WORDS) expect(t, `PDF に「${w}」`).not.toContain(w);
  });
});

test.describe("1-6 判定履歴", () => {
  const SEED = {
    evidenceId: "ev_5722337c7b5f785e",
    savedAt: "2026-10-18T00:00:00.000Z",
    loc: { lat: 35.4936, lng: 133.2361 },
    ctx: { droneWeightG: 900 },
    overall: "red",
    engineVersion: "soraban-0.3.0-regulations-2026-07",
    checkedAt: "2026-10-18T00:00:00.000Z",
    resolvedAddress: "旧い履歴（手続きの完了を含む）",
    diagnosisInput: {
      methodFlags: ["method_night"],
      airspaceFlags: [],
      plannedDate: "2027-02-03",
      manualChoice: "custom",
      completedProcedureIds: ["drone-registration", "flight-permission-did"],
    },
    diagnosisSummary: {
      diagnosisEvidenceId: "ev_3ad16b0d5ef51d89",
      category: "II_A",
      isSpecificFlight: true,
      procedureCount: 4,
    },
  };

  test("旧い形式の項目が一覧に出て、行に「手続き」の件数と「申請支援」が出ない。localStorage の項目は書き換わらず、押すと復元・再判定できる", async ({ page }) => {
    await page.addInitScript((seed) => {
      if (window.sessionStorage.getItem("s18-seeded")) return;
      window.sessionStorage.setItem("s18-seeded", "1");
      window.localStorage.setItem("soraban:history:v1", JSON.stringify([seed]));
    }, SEED);
    await openReady(page);
    const item = page.getByTestId("history-item").filter({ hasText: "旧い履歴（手続きの完了を含む）" });
    await expect(item).toHaveCount(1);
    // 手続きの件数・進捗・申請支援の語は出ない（行の文字と title）
    await expect(item).not.toContainText(/手続き\s*\d/);
    await expect(item).not.toContainText("申請支援");
    await expect(item).not.toContainText("cat:"); // 診断カテゴリーの区分（cat:IIA相当 など）も出さない（レビュー L1）
    expect(await item.locator("button").first().getAttribute("title")).not.toContain("申請支援");
    // 他の保存値（診断の証跡 ID・カテゴリー・方法の数・予定日）は今までどおり読める
    await expect(item).toContainText("diag:ev_3ad16b0d5ef51d89");
    await expect(item).toContainText("予定:2027-02-03");
    // 押す前の localStorage：シードした項目は一字も変わっていない（別の項目が先頭に足されるのは今までどおり）
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("soraban:history:v1") ?? "[]") as unknown[]);
    expect(stored.find((e) => (e as { evidenceId?: string }).evidenceId === SEED.evidenceId)).toEqual(SEED);
    // 押すと復元して再判定できる（方法・予定日・地点が戻る）
    const diag = waitDiagnose(page);
    await item.locator("button").first().click();
    await diag;
    await settled(page);
    await expect(methodNight(page)).toBeChecked();
    await expect(page.locator('input[type="date"]')).toHaveValue("2027-02-03");
    await expect(page.getByPlaceholder("35.4278", { exact: true })).toHaveValue("35.4936");
    await expectNoApplicationSupport(page, "1-6 復元のあと");
  });
});
