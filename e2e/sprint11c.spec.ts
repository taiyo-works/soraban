import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { expectNoApplicationSupport } from "./field-checks";

// Sprint 11c 契約（docs/sprints/sprint-11c.md）の E2E。許可の入力の不具合修正
// （飛行禁止法の「同意」と「通報」を分ける、「国交省 DIPS」の説明を動きに合わせる）。
// 本番相当サーバー（baseURL、同梱データ）だけを使う。
//
// Sprint 11d で直した表示の検査（地点・入力・期待する規制の該当は変えていない）：
// - 許可・同意は status（元の判定）を変えなくなった（満たす例外）。カードの data-status は該当（red／yellow）のまま、
//   判定は data-verdict（procedure_done／needs_procedure）で確かめる。
// - カードの「適用された例外節」の欄は「適用した許可・同意・目的（元の判定は変えない）」に改めた。
// - 「国交省 DIPS」は種類ごとの入力になった。DID 上空の許可のチェック（「国交省 DIPS：DID 上空の飛行許可」）で確かめる。

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

const openReady = async (page: Page): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto("/");
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
};

const card = (page: Page, id: string): Locator => page.getByTestId(`regulation-card-${id}`);
const preset = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(name) }).filter({ visible: true }).first();

const selectPreset = async (page: Page, name: string): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await preset(page, name).click();
  await Promise.all([check, diag]);
};

/** 「機体・運航条件」を開く（取得済みの許可のチェックはこの中にある）。 */
const openConditions = async (page: Page): Promise<void> => {
  const details = conditions(page);
  if ((await details.getAttribute("open")) === null) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
};

// 申請支援の手続きのチェック（「施設管理者の同意 ＋ … を完了にする」）と取り違えないよう、05 の中に限る。
const conditions = (page: Page): Locator => page.locator("details", { hasText: "機体・運航条件" });
const consent = (page: Page) => conditions(page).getByRole("checkbox", { name: "施設管理者の同意" });
const notice = (page: Page) => conditions(page).getByRole("checkbox", { name: "公安委員会への通報" });
const DIPS_DID = "国交省 DIPS：DID 上空の飛行許可";
const dips = (page: Page) => conditions(page).getByRole("checkbox", { name: DIPS_DID });
const APPLIED = "適用した許可・同意・目的";

/** チェックを切り替え、再判定（地点判定・申請支援診断）が終わるのを待つ。 */
const toggle = async (box: Locator, page: Page, on: boolean): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  if (on) await box.check();
  else await box.uncheck();
  await Promise.all([check, diag]);
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

const exportPdf = async (page: Page): Promise<string> => {
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /PDF 出力/ }).click();
  return pdfText(await dl);
};

const MIHO = "美保基地の周辺（境港市）";
const SDL_EXCEPTION =
  "対象施設の管理者の同意を得たうえで、飛行の 48 時間前までに都道府県公安委員会へ通報した場合";
const PROC_TITLE = "施設管理者の同意 ＋ 都道府県公安委員会への事前通報（飛行の 48 時間前まで）";
const AIRPORT_NOTE_PART = "空港ごとの個別の許可と、空港の設置管理者等との調整が必要";

test.describe("A. 飛行禁止法の同意と通報", () => {
  test("3. 美保基地の周辺：同意だけ・通報だけでは飛行禁止法のカードが red のままで、例外が当たらない", async ({
    page,
  }) => {
    await openReady(page);
    await selectPreset(page, MIHO);
    await openConditions(page);
    const sdl = card(page, "small-drone-law");
    await expect(sdl).toHaveAttribute("data-status", "red");

    await toggle(consent(page), page, true);
    await expect(sdl).toHaveAttribute("data-status", "red");
    await expect(sdl).toHaveAttribute("data-verdict", "needs_procedure");
    await expect(sdl).not.toContainText(APPLIED);

    await toggle(consent(page), page, false);
    await toggle(notice(page), page, true);
    await expect(sdl).toHaveAttribute("data-status", "red");
    await expect(sdl).toHaveAttribute("data-verdict", "needs_procedure");
    await expect(sdl).not.toContainText(APPLIED);
  });

  test("4・11. 同意と通報の両方で例外が適用と表示され、PDF の取得済み許可に同意と通報が別の語で出る", async ({
    page,
  }) => {
    await openReady(page);
    await selectPreset(page, MIHO);
    await openConditions(page);
    await toggle(consent(page), page, true);
    await toggle(notice(page), page, true);
    const sdl = card(page, "small-drone-law");
    await expect(sdl).toContainText(APPLIED);
    await expect(sdl).toContainText(SDL_EXCEPTION);
    // Sprint 11d：元の判定は該当のまま、判定は手続き済み（条件付き）
    await expect(sdl).toHaveAttribute("data-status", "red");
    await expect(sdl).toHaveAttribute("data-verdict", "procedure_done");

    const text = await exportPdf(page);
    expect(text).toContain("施設管理者の同意");
    expect(text).toContain("公安委員会への通報（飛行禁止法）");
  });

  test("5. 県条例（迷惑行為等防止条例）は同意だけで従来どおり例外が当たる", async ({ page }) => {
    // 県条例のエンジンは公衆密集地のバッファ内で yellow を返す（red にはならない）。病院の地点で確かめる。
    await openReady(page);
    await selectPreset(page, "鳥取大学医学部附属病院");
    await openConditions(page);
    const pref = card(page, "31-pref-nuisance-prevention");
    await expect(pref).toHaveAttribute("data-status", /^(red|yellow)$/);
    await expect(pref).not.toContainText(APPLIED);
    const before = await pref.getAttribute("data-status");

    await toggle(consent(page), page, true);
    // Sprint 11d：元の判定は変わらず、判定は手続き済み（条件付き）
    await expect(pref).toHaveAttribute("data-status", before!);
    await expect(pref).toHaveAttribute("data-verdict", "procedure_done");
    await expect(pref).toContainText(APPLIED);
    await expect(pref).toContainText("施設管理者・自治体担当部署と事前調整し、合意を得た場合");
  });

  test("6. 判定の『同意＋事前通報』は同意・通報のチェックの有無にかかわらず美保基地の周辺で出る（診断パネルは出ない）", async ({
    page,
  }) => {
    // 以前は診断パネルの article（手続きカード「施設管理者の同意 ＋ … 事前通報」）が常に出ることを検査していた。
    // 申請支援を止めたので（Sprint 18-1）、判定の画面の同じ内容で検査する：未入力のときは「要手続きの手続き」の同意・通報の 2 行、
    // 入力したあとは手続き済み（verdict-done-item）か残りの行のどちらかに必ず出る（小型無人機等飛行禁止法が画面から消えない）。
    await openReady(page);
    await selectPreset(page, MIHO);
    const consentRow = page.locator('[data-testid="verdict-procedure"][data-procedure-id="verdict-small-drone-consent"]');
    const noticeRow = page.locator('[data-testid="verdict-procedure"][data-procedure-id="verdict-small-drone-notice"]');
    await expect(consentRow).toContainText("施設管理者の同意と都道府県公安委員会への事前通報（飛行の 48 時間前まで）");
    await expect(noticeRow).toBeVisible();
    await expect(page.locator("article", { hasText: PROC_TITLE })).toHaveCount(0);
    await expectNoApplicationSupport(page, "11c #6");
    const smallDrone = page.locator(
      '[data-testid="verdict-procedure"][data-procedure-id^="verdict-small-drone"], [data-testid="verdict-done-item"][data-item-id="small-drone-law"]',
    );
    await openConditions(page);
    await toggle(consent(page), page, true);
    await expect(smallDrone.first()).toBeVisible();
    await toggle(notice(page), page, true);
    await expect(smallDrone.first()).toBeVisible();
    await toggle(consent(page), page, false);
    await expect(smallDrone.first()).toBeVisible();
  });
});

test.describe("B. DIPS の説明", () => {
  test("7. 「国交省 DIPS」（DID 上空の許可）の説明に「空港」がなく「DID」を含む", async ({ page }) => {
    await openReady(page);
    await openConditions(page);
    const label = conditions(page)
      .locator("label")
      .filter({ has: page.getByRole("checkbox", { name: DIPS_DID }) });
    const text = await label.innerText();
    const desc = text.replace(DIPS_DID, "");
    expect(desc).toContain("DID");
    expect(desc).not.toContain("空港");
  });

  test("8. 米子鬼太郎空港：DIPS をチェックしても空港等周辺の状態は変わらず補足が出る。外すと補足は出ない", async ({
    page,
  }) => {
    await openReady(page);
    await selectPreset(page, "米子鬼太郎空港");
    await openConditions(page);
    const ap = card(page, "aviation-law-airport");
    const before = await ap.getAttribute("data-status");
    expect(before).toMatch(/^(red|yellow)$/);
    await expect(ap.getByTestId("airport-mlit-note")).toHaveCount(0);

    await toggle(dips(page), page, true);
    await expect(ap).toHaveAttribute("data-status", before!);
    await expect(ap.getByTestId("airport-mlit-note")).toContainText(AIRPORT_NOTE_PART);
    // 空港等周辺以外のカードには出さない
    await expect(page.getByTestId("airport-mlit-note")).toHaveCount(1);

    const text = await exportPdf(page);
    expect(text).toContain(AIRPORT_NOTE_PART);

    await toggle(dips(page), page, false);
    await expect(ap).toHaveAttribute("data-status", before!);
    await expect(ap.getByTestId("airport-mlit-note")).toHaveCount(0);
  });
});

test.describe("C. 旧形式の判定履歴の復元（evaluator 差し戻し 1 回目）", () => {
  const MIHO_LOC = { lat: 35.4936, lng: 133.26604 };
  const LEGACY: Array<[string, string[]]> = [
    ["Sprint 11b までの形式", ["facility_manager", "facility_manager_and_pref_pubsafety"]],
    ["Sprint 6 形式", ["facility_manager_and_pref_pubsafety"]],
  ];

  for (const [name, permits] of LEGACY) {
    test(`${name}の履歴を復元しても飛行禁止法は red のままで例外が当たらず、/api/check に両方の値を送らない`, async ({
      page,
    }) => {
      const address = `旧形式の履歴 ${name}`;
      const entry = {
        runId: "run_legacy_11c",
        evidenceId: "ev_11c011c011c011c0",
        savedAt: "2026-10-18T09:00:00.000Z",
        loc: MIHO_LOC,
        ctx: { droneWeightG: 900, pilotPermits: permits },
        overall: "green",
        resolvedAddress: address,
        engineVersion: "soraban-0.3.0-regulations-2026-07",
        checkedAt: "2026-10-18T09:00:00.000Z",
        muniCode: "31204",
      };
      await page.addInitScript((raw) => {
        if (sessionStorage.getItem("seeded-11c")) return;
        sessionStorage.setItem("seeded-11c", "1");
        localStorage.setItem("soraban:history:v1", raw);
      }, JSON.stringify([entry]));
      await openReady(page);

      const item = page.getByTestId("history-item").filter({ hasText: address });
      await expect(item).toBeVisible();
      const req = page.waitForRequest((r) => r.url().endsWith("/api/check") && r.method() === "POST");
      const check = waitCheck(page);
      const diag = waitDiagnose(page);
      await item.locator("button").first().click();
      const body = (await req).postData() ?? "";
      await Promise.all([check, diag]);
      expect(body).not.toContain("facility_manager_and_pref_pubsafety");

      const sdl = card(page, "small-drone-law");
      await expect(sdl).toHaveAttribute("data-status", "red");
      await expect(sdl).not.toContainText(APPLIED);

      await openConditions(page);
      await expect(notice(page)).not.toBeChecked();
      await expect(consent(page)).toBeChecked({ checked: permits.includes("facility_manager") });

      const text = await exportPdf(page);
      expect(text).not.toContain("同意＋通報（両方）");
    });
  }
});
