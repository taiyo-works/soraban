import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

// Sprint 11d 契約（docs/sprints/sprint-11d.md）の E2E。判定の 4 段（飛行不可／要手続き／手続き済み（条件付き）／
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
  await page.getByRole("button", { name: /この地点を判定する/ }).click();
  await Promise.all([check, diag]);
  await settled(page);
};

const conditions = (page: Page): Locator => page.locator("details", { hasText: "機体・運航条件" });
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

/** 飛行の方法のチェック（06 の中。判定だけをやり直す）。凡例は Sprint 18-1 で「飛行方法（申請支援）」から「飛行の方法」に変えた。 */
const methodBox = (page: Page, label: string) =>
  page.locator("fieldset", { hasText: "飛行の方法（選ぶと判定に反映します）" }).getByRole("checkbox", { name: label, exact: true });

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

const FORBIDDEN = new RegExp([["飛行", "可能"].join(""), ["要確認", "要許可"].join("・")].join("|"));
// 公開面の禁止語（Sprint 10a・11c の grep に掛からないよう、部品をつないで作る）。
const PATENT = new RegExp([["特", "許"].join(""), ["出", "願"].join(""), ["Pat", "ent"].join("")].join("|"));

const MIHO = "美保基地の周辺（境港市）";
/** 収録範囲（米子市）内で、どの規制にも当たらない地点（DID 外・空港から 6km 超・公園・史跡・公衆密集地の外）。 */
const QUIET = { lat: 35.38, lng: 133.35 };

test.describe("A. 規則（契約 3）", () => {
  test("3. 空港の敷地内は全ての許可を入れても飛行不可。緊急用務空域も飛行不可", async ({ page }) => {
    await openReady(page);
    await selectPreset(page, "米子鬼太郎空港");
    await openConditions(page);
    const boxes = conditions(page).getByRole("checkbox");
    const n = await boxes.count();
    expect(n).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < n; i++) {
      await toggle(boxes.nth(i), page, true);
    }
    await expect(level(page)).toHaveText("飛行不可");
    await expect(summary(page)).toHaveAttribute("data-level", "no_fly");
    await expect(item(page, "aviation-law-airport")).toHaveAttribute("data-verdict", "no_fly");
    await expect(page.getByTestId("verdict-no-fly-item").first()).toBeVisible();

    // 緊急用務空域（区域外の地点でも、全ての許可があっても飛行不可）
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    await toggle(page.getByTestId("airspace-airspace_emergency").getByRole("checkbox"), page, true, false);
    await expect(level(page)).toHaveText("飛行不可");
    await expect(item(page, "airspace_emergency")).toHaveAttribute("data-verdict", "no_fly");
  });
});

test.describe("A. 規則（差し戻し 1 回目 F1）", () => {
  test("3. 空港の敷地内（出雲縁結び空港）は 50g・150m 以上・全ての許可でも飛行不可で、手続き不要にならない", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, 35.4136, 132.89);
    await openConditions(page);
    {
      const check = waitCheck(page);
      const diag = waitDiagnose(page);
      await page.getByPlaceholder(/例: 900／80/).fill("50");
      await Promise.all([check, diag]);
      await settled(page);
    }
    await toggle(methodBox(page, "150m以上の高さ"), page, true, false);
    const boxes = conditions(page).getByRole("checkbox");
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await toggle(boxes.nth(i), page, true);
    await expect(level(page)).toHaveText("飛行不可");
    await expect(summary(page)).toHaveAttribute("data-level", "no_fly");
    await expect(item(page, "aviation-law-airport")).toHaveAttribute("data-verdict", "no_fly");
    await expect(page.getByTestId("regulation-card-aviation-law-airport")).toHaveAttribute("data-status", "red");
    const text = await exportPdf(page);
    expect(squash(text)).toContain(squash("そらばん 飛行判定と手続きのレポート"));
    expect(squash(text)).toContain(squash("飛行不可"));
  });
});

test.describe("B. 地点と飛び方での結果", () => {
  test("6. 米子市役所：許可なし → 要手続き（DID の許可と期限）。DID の DIPS 許可 → DID は手続き済み（条件付き）", async ({
    page,
  }) => {
    await openReady(page);
    await expect(level(page)).toHaveText("要手続き");
    const didProc = procedures(page).filter({ hasText: "飛行許可（DID上空）" });
    await expect(didProc).toHaveCount(1);
    await expect(didProc.getByTestId("verdict-procedure-deadline")).toContainText("10 開庁日以上前");
    await expect(item(page, "aviation-law-did")).toHaveAttribute("data-verdict", "needs_procedure");

    await openConditions(page);
    await toggle(permitBox(page, "国交省 DIPS：DID 上空の飛行許可"), page, true);
    await expect(item(page, "aviation-law-did")).toHaveAttribute("data-verdict", "procedure_done");
    await expect(item(page, "aviation-law-did")).toHaveAttribute("data-base-status", "red");
    const done = doneItem(page, "aviation-law-did");
    await expect(done).toContainText("元の判定：該当");
    await expect(done).toContainText("国交省 DIPS：DID 上空の飛行許可");
    await expect(done).toContainText("許可の範囲と有効期間は照合していません。許可書で確認してください。");
    // カードは元の判定（該当）を保ち、判定は手続き済み（条件付き）
    const card = page.getByTestId("regulation-card-aviation-law-did");
    await expect(card).toHaveAttribute("data-status", "red");
    await expect(card).toHaveAttribute("data-verdict", "procedure_done");
    // DID の手続きは段取り（要手続きの手続き）から外れ、判定の「手続き済み（条件付き）」の節（verdict-done）の項目に残る。
    // 以前は申請支援の手続きカード（procedure-card）に印つきで残ることを検査していた。申請支援を止めたので（Sprint 18-1）、
    // 判定側の節の見出しと条件の行で検査する（verdict-done-item は item の id を持ち、手続きの id は持たない）。診断パネル（procedure-card）は出ない。
    await expect(procedures(page).filter({ hasText: "飛行許可（DID上空）" })).toHaveCount(0);
    await expect(page.getByTestId("verdict-done")).toContainText("手続き済み（条件付き）");
    expect(await done.getByTestId("verdict-done-condition").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("procedure-card")).toHaveCount(0);
  });

  test("7. 空港等周辺（該当の可能性）：DIPS の全種類を入れても要手続きのまま、個別許可と調整の理由、空港等周辺の飛行許可が手続きに出る", async ({
    page,
  }) => {
    await openReady(page);
    await selectPreset(page, MIHO);
    await expect(item(page, "aviation-law-airport")).toHaveAttribute("data-base-status", "yellow");
    const apProc = procedures(page).filter({ hasText: "飛行許可（空港等周辺）" });
    await expect(apProc).toHaveCount(1);
    await expect(apProc).toContainText("該当の可能性（要確認）");
    await openConditions(page);
    const dips = conditions(page).getByRole("checkbox", { name: /^国交省 DIPS：/ });
    expect(await dips.count()).toBe(8);
    for (let i = 0; i < 8; i++) await toggle(dips.nth(i), page, true);
    await expect(item(page, "aviation-law-airport")).toHaveAttribute("data-verdict", "needs_procedure");
    await expect(apProc).toHaveCount(1);
    await expect(apProc).toContainText("空港ごとの個別の許可と、空港の設置管理者等との調整が必要");
    // 申請支援の空域フラグにも入る（自動検出）
    await expect(page.getByTestId("airspace-airspace_airport").getByRole("checkbox")).toBeChecked();
  });

  test("8・10. 美保基地の周辺：同意だけ → 要手続き、同意＋通報 → 飛行禁止法は手続き済み。通報の期限は飛行予定日の 2 日前。判定不能の件数が結論に出る", async ({
    page,
  }) => {
    await openReady(page);
    await selectPreset(page, MIHO);
    // 10. 境港市の史跡は未収録で判定不能 → 全体は要手続き以上、件数が結論の位置に出る
    await expect(page.getByTestId("verdict-unknown-count")).toContainText(/判定不能 \d+ 件（データ未整備）/);
    await expect(summary(page)).toHaveAttribute("data-level", /^(needs_procedure|no_fly)$/);

    await openConditions(page);
    await toggle(permitBox(page, "施設管理者の同意"), page, true);
    await expect(item(page, "small-drone-law")).toHaveAttribute("data-verdict", "needs_procedure");
    await toggle(permitBox(page, "公安委員会への通報（飛行禁止法）"), page, true);
    await expect(item(page, "small-drone-law")).toHaveAttribute("data-verdict", "procedure_done");
    await expect(doneItem(page, "small-drone-law")).toContainText("施設管理者の同意 ＋ 公安委員会への通報（飛行禁止法）");

    await toggle(permitBox(page, "公安委員会への通報（飛行禁止法）"), page, false);
    await setPlannedDate(page, "2026-12-10");
    const notice = procedures(page).filter({ hasText: "都道府県公安委員会への通報（飛行禁止法）" });
    await expect(notice).toHaveAttribute("data-deadline-date", "2026-12-08");
    await expect(notice).toContainText("2026-12-08（飛行予定日 2026-12-10 の 2 日前）の、飛行開始と同じ時刻まで");
    // 同意は入力済みなので、段取りには通報だけが残る
    await expect(procedures(page).filter({ hasText: "対象施設の管理者の同意" })).toHaveCount(0);
    await expect(item(page, "small-drone-law")).toHaveAttribute("data-verdict", "needs_procedure");
  });

  test("9. どの規制にも当たらない地点：手続き不要（機体登録は前提）→ 夜間で要手続き → 夜間の承認で手続き済み。特定飛行で飛行計画の通報と飛行日誌", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    await expect(level(page)).toHaveText("手続き不要");
    await expect(page.getByTestId("verdict-unknown-count")).toHaveCount(0);
    await expect(duty(page, "drone-registration")).toHaveAttribute("data-kind", "premise");
    await expect(duty(page, "flight-plan-report")).toHaveCount(0);

    await toggle(methodBox(page, "夜間飛行"), page, true, false);
    await expect(level(page)).toHaveText("要手続き");
    const night = procedures(page).filter({ hasText: "飛行承認（夜間飛行）" });
    await expect(night).toHaveCount(1);
    await expect(night).toContainText("10 開庁日以上前");
    await expect(duty(page, "flight-plan-report")).toBeVisible();
    await expect(duty(page, "flight-logbook")).toBeVisible();

    await openConditions(page);
    await toggle(permitBox(page, "国交省 DIPS：夜間飛行の承認"), page, true);
    await expect(level(page)).toHaveText("手続き済み（条件付き）");
    await expect(page.getByTestId("verdict-conditional")).toContainText("条件付き");
    await expect(page.getByTestId("verdict-conditional")).toContainText("許可の範囲と有効期間は照合していません");
    await expect(duty(page, "flight-plan-report")).toBeVisible();
    await expect(duty(page, "flight-logbook")).toBeVisible();
  });

  test("11. 手続きの並び：法的な重さ（国の法律 → 条例）、同じ重さでは期限の早い順（期限のないものは最後）", async ({
    page,
  }) => {
    for (const [name, withNight] of [
      ["湊山公園", true],
      [MIHO, true],
    ] as const) {
      await openReady(page);
      await selectPreset(page, name);
      if (withNight) await toggle(methodBox(page, "夜間飛行"), page, true, false);
      await setPlannedDate(page, "2026-12-10");
      const rows = procedures(page);
      const n = await rows.count();
      expect(n).toBeGreaterThanOrEqual(3);
      const keys: { tier: number; date: string }[] = [];
      for (let i = 0; i < n; i++) {
        keys.push({
          tier: Number(await rows.nth(i).getAttribute("data-legal-tier")),
          date: (await rows.nth(i).getAttribute("data-deadline-date")) ?? "",
        });
      }
      // 重さの昇順
      expect(keys.map((k) => k.tier)).toEqual(keys.map((k) => k.tier).sort((a, b) => a - b));
      // 同じ重さの中で、日付のある期限は早い順で、日付のないもの（管理者の定めによる・確認）より前
      for (const tier of new Set(keys.map((k) => k.tier))) {
        const ds = keys.filter((k) => k.tier === tier).map((k) => k.date);
        const dated = ds.filter((d) => d !== "");
        expect(dated).toEqual([...dated].sort());
        const firstUndated = ds.findIndex((d) => d === "");
        if (firstUndated >= 0 && name === "湊山公園") {
          expect(ds.slice(firstUndated).every((d) => d === "")).toBe(true);
        }
      }
      if (name === "湊山公園") {
        expect(keys.map((k) => k.tier)).toContain(2);
        expect(await rows.first().innerText()).toMatch(/飛行許可（DID上空）|飛行承認（夜間飛行）/);
      } else {
        // 同意（通報より前）は通報の直前。DIPS（10 開庁日前）は同意より前。
        const titles = await rows.allInnerTexts();
        const consentIdx = titles.findIndex((t) => t.includes("対象施設の管理者の同意"));
        const noticeIdx = titles.findIndex((t) => t.includes("都道府県公安委員会への通報"));
        const nightIdx = titles.findIndex((t) => t.includes("飛行承認（夜間飛行）"));
        expect(nightIdx).toBeLessThan(consentIdx);
        expect(consentIdx).toBe(noticeIdx - 1);
      }
    }
  });
});

test.describe("C. 表示・PDF・履歴", () => {
  test("12・13. 画面と地点判定の PDF：禁止語が出ず、結論・手続きと期限・手続き済みの元の判定と許可と条件が同じ言葉で出る", async ({
    page,
  }) => {
    await openReady(page);
    await openConditions(page);
    await toggle(permitBox(page, "国交省 DIPS：DID 上空の飛行許可"), page, true);
    await setPlannedDate(page, "2026-12-10");
    const screen = await page.locator("body").innerText();
    expect(screen).not.toMatch(FORBIDDEN);
    expect(screen).not.toMatch(PATENT);

    const levelText = await level(page).innerText();
    const firstProc = procedures(page).first();
    const procTitle = (await firstProc.locator("td").nth(1).locator("span").first().innerText()).trim();
    const deadline = (await firstProc.getByTestId("verdict-procedure-deadline").innerText()).trim();
    const text = await exportPdf(page);
    const t = squash(text);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(PATENT);
    expect(t).toContain(squash(levelText));
    expect(t).toContain(squash("要手続きの手続き（期限順）"));
    expect(t).toContain(squash(procTitle));
    expect(t).toContain(squash(deadline));
    expect(t).toContain(squash("手続き済み（条件付き）"));
    expect(t).toContain(squash("元の判定：該当"));
    expect(t).toContain(squash("適用した許可：国交省 DIPS：DID 上空の飛行許可"));
    expect(t).toContain(squash("許可の範囲と有効期間は照合していません。許可書で確認してください。"));
    expect(t).toContain(squash("飛行の前後に必ず行うこと"));
  });

  test("14. 旧形式の履歴（verdict なし・0.3.0）が旧版の判定と分かる表示になり、旧値 mlit は DID 上空の許可として復元される", async ({
    page,
  }) => {
    const address = "旧形式の履歴（Sprint 11d）";
    const entry = {
      runId: "run_legacy_11d",
      evidenceId: "ev_11d011d011d011d0",
      savedAt: "2026-10-18T09:00:00.000Z",
      loc: { lat: 35.4278, lng: 133.3314 },
      ctx: { droneWeightG: 900, pilotPermits: ["mlit"] },
      overall: "green",
      resolvedAddress: address,
      engineVersion: "soraban-0.3.0-regulations-2026-07",
      checkedAt: "2026-10-18T09:00:00.000Z",
      muniCode: "31202",
    };
    const old02 = {
      ...entry,
      runId: "run_legacy_02",
      evidenceId: "ev_02002002002002a0",
      overall: "red",
      ctx: undefined,
      resolvedAddress: "旧形式の履歴（0.2.0）",
      engineVersion: "soraban-0.2.0-clausegraph",
    };
    await page.addInitScript((raw) => {
      if (sessionStorage.getItem("seeded-11d")) return;
      sessionStorage.setItem("seeded-11d", "1");
      localStorage.setItem("soraban:history:v1", raw);
    }, JSON.stringify([entry, old02]));
    await openReady(page);

    const row = page.getByTestId("history-item").filter({ hasText: address });
    await expect(row.getByTestId("history-verdict")).toHaveText("適用外（旧版の判定）");
    await expect(row.getByTestId("history-verdict")).toHaveAttribute("data-legacy", "true");
    const row02 = page.getByTestId("history-item").filter({ hasText: "旧形式の履歴（0.2.0）" });
    await expect(row02.getByTestId("history-verdict")).toContainText("旧版の判定");
    // 新形式（初回の自動判定）は 4 段の言葉
    const fresh = page.locator('[data-testid="history-verdict"][data-legacy="false"]').first();
    await expect(fresh).toHaveText(/^(飛行不可|要手続き|手続き済み（条件付き）|手続き不要)/);
    const historyText = await page.locator('section[aria-labelledby="history-heading"]').innerText();
    expect(historyText).not.toMatch(FORBIDDEN);

    const req = page.waitForRequest((r) => r.url().endsWith("/api/check") && r.method() === "POST");
    const check = waitCheck(page);
    const diag = waitDiagnose(page);
    await row.locator("button").first().click();
    const body = (await req).postData() ?? "";
    await Promise.all([check, diag]);
    await settled(page);
    expect(body).toContain("mlit:did");
    expect(body).not.toContain('"mlit"');
    await openConditions(page);
    await expect(permitBox(page, "国交省 DIPS：DID 上空の飛行許可")).toBeChecked();
    await expect(permitBox(page, "国交省 DIPS：夜間飛行の承認")).not.toBeChecked();
    await expect(item(page, "aviation-law-did")).toHaveAttribute("data-verdict", "procedure_done");
  });

  // PR #23 レビュー P1：履歴は飛行の方法を含む判定（/api/diagnose）を保存する。
  test("14b. 区域外の地点で夜間を選ぶと、履歴の項目も要手続きになり、外すと手続き不要に戻る", async ({ page }) => {
    await openReady(page);
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    const latest = page.getByTestId("history-item").first().getByTestId("history-verdict");
    await expect(level(page)).toHaveText("手続き不要");
    await expect(latest).toHaveText(/^手続き不要/);
    await toggle(methodBox(page, "夜間飛行"), page, true, false);
    await expect(level(page)).toHaveText("要手続き");
    await expect(latest).toHaveText(/^要手続き/);
    await toggle(methodBox(page, "夜間飛行"), page, false, false);
    await expect(level(page)).toHaveText("手続き不要");
    await expect(latest).toHaveText(/^手続き不要/);
  });

  // PR #23 レビュー P1：診断だけの入力を変えた後の PDF は、診断の証跡 ID で出す（ファイル名とヘッダー）。
  test("13b. 飛行の方法・飛行予定日だけを変えた後の PDF に、その診断の証跡 ID が出て、ファイル名も変わる", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    const download = async () => {
      const dl = page.waitForEvent("download");
      await page.getByRole("button", { name: /PDF 出力/ }).click();
      const d = await dl;
      return { name: d.suggestedFilename(), text: await pdfText(d) };
    };
    const first = await download();

    // 応答を順に記録し、画面に出ている判定（最後に届いた診断）の証跡 ID と照らす。
    const diagIds: { evidenceId: string }[] = [];
    page.on("response", async (r) => {
      if (r.url().endsWith("/api/diagnose") && r.ok()) {
        diagIds.push((await r.json()) as { evidenceId: string });
      }
    });
    const diagRes = page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());
    await methodBox(page, "夜間飛行").check();
    await diagRes;
    await settled(page);
    await expect(level(page)).toHaveText("要手続き");
    await expect.poll(() => diagIds.length).toBeGreaterThan(0);
    const diagJson = diagIds.at(-1)!;
    const second = await download();
    expect(second.name).toMatch(/^soraban-.+\.pdf$/);
    expect(second.name).toBe(`soraban-${diagJson.evidenceId}.pdf`);
    expect(second.name).not.toBe(first.name);
    expect(squash(second.text)).toContain(diagJson.evidenceId);
    // 地点判定（/api/check。画面の証跡 ID・evidence_log と同じ）の証跡 ID も、それと分かる言葉で併記する
    const checkId = (await page.getByTestId("evidence-id").innerText()).trim();
    expect(squash(second.text)).toContain(squash(`地点判定の証跡 ID${checkId}`));

    const diagRes2 = page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());
    await page.locator('input[type="date"]').fill("2026-12-10");
    await diagRes2;
    await settled(page);
    const diagJson2 = diagIds.at(-1)!;
    const third = await download();
    expect(diagJson2.evidenceId).not.toBe(diagJson.evidenceId);
    expect(third.name).toContain(diagJson2.evidenceId);
    expect(squash(third.text)).toContain(diagJson2.evidenceId);
  });

  // 差し戻し 2 回目：診断（/api/diagnose）が失敗したとき、古い判定も地点だけの判定も結論に使わない。
  const failDiagnose = async (page: Page) =>
    page.route("**/api/diagnose", (route) => route.fulfill({ status: 500, body: '{"error":"test"}' }));
  const latestHistory = (page: Page) => page.getByTestId("history-item").first().getByTestId("history-verdict");
  const expectNoClearVerdict = async (page: Page) => {
    await expect(page.getByTestId("verdict-failed")).toBeVisible();
    await expect(summary(page)).toHaveAttribute("data-level", "failed");
    await expect(level(page)).toHaveCount(0);
    await expect(summary(page)).not.toContainText("手続き不要");
    await expect(latestHistory(page)).not.toContainText("手続き不要");
    await expect(latestHistory(page)).toContainText("判定未確定");
    await expect(page.getByRole("button", { name: /PDF 出力/ })).toBeDisabled();
  };

  test("15. C1：区域外で夜間を選んだ後に診断が失敗すると、結論・履歴・PDF のどれにも手続き不要が出ず、再試行で戻る", async ({
    page,
  }) => {
    await openReady(page);
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    await expect(level(page)).toHaveText("手続き不要");
    await failDiagnose(page);
    const failed = page.waitForResponse((r) => r.url().endsWith("/api/diagnose"));
    await methodBox(page, "夜間飛行").check();
    await failed;
    await expectNoClearVerdict(page);

    await page.unroute("**/api/diagnose");
    const diag = waitDiagnose(page);
    await page.getByTestId("verdict-retry").click();
    await diag;
    await settled(page);
    await expect(level(page)).toHaveText("要手続き");
    await expect(latestHistory(page)).toHaveText(/^要手続き/);
    await expect(page.getByRole("button", { name: /PDF 出力/ })).toBeEnabled();
  });

  test("15. C2：夜間を選んだまま新しい地点で判定し、診断が失敗しても、地点だけの判定で手続き不要と出さない", async ({
    page,
  }) => {
    await openReady(page);
    await toggle(methodBox(page, "夜間飛行"), page, true, false);
    await failDiagnose(page);
    await page.getByPlaceholder("35.4278", { exact: true }).fill(String(QUIET.lat));
    await page.getByPlaceholder("133.3314", { exact: true }).fill(String(QUIET.lng));
    const check = waitCheck(page);
    const failed = page.waitForResponse((r) => r.url().endsWith("/api/diagnose"));
    await page.getByRole("button", { name: /この地点を判定する/ }).click();
    await Promise.all([check, failed]);
    await expectNoClearVerdict(page);

    await page.unroute("**/api/diagnose");
    const diag = waitDiagnose(page);
    await page.getByTestId("verdict-retry").click();
    await diag;
    await settled(page);
    await expect(level(page)).toHaveText("要手続き");
    await expect(latestHistory(page)).toHaveText(/^要手続き/);
  });

  // 差し戻し 3 回目 F3：地点判定（/api/check）だけが失敗したとき、前の地点の結果を画面・PDF に混ぜない。
  test("16. F3：/api/check が失敗して地点を移すと、古い証跡 ID とカードを出さず、PDF を出さず、再試行で回復する", async ({
    page,
  }) => {
    await openReady(page);
    const oldId = (await page.getByTestId("evidence-id").innerText()).trim();
    await expect(page.getByTestId("regulation-card-aviation-law-did")).toBeVisible();
    await page.route("**/api/check", (route) => route.fulfill({ status: 500, body: '{"error":"test"}' }));
    await page.getByPlaceholder("35.4278", { exact: true }).fill(String(QUIET.lat));
    await page.getByPlaceholder("133.3314", { exact: true }).fill(String(QUIET.lng));
    const failed = page.waitForResponse((r) => r.url().endsWith("/api/check"));
    const diag = waitDiagnose(page);
    await page.getByRole("button", { name: /この地点を判定する/ }).click();
    await Promise.all([failed, diag]);
    await expect(page.getByTestId("verdict-failed")).toBeVisible();
    await expect(summary(page)).toHaveAttribute("data-level", "failed");
    await expect(page.getByTestId("verdict-failed-note")).toContainText("地点判定");
    await expect(page.getByTestId("evidence-id")).toHaveCount(0);
    // 結論と地点判定の欄に前の地点の証跡 ID を出さない（判定履歴の前の実行の行は、その実行の記録として残る）
    await expect(page.locator("section[aria-live]").first()).not.toContainText(oldId);
    await expect(page.locator('[data-testid^="regulation-card-"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /PDF 出力/ })).toBeDisabled();

    await page.unroute("**/api/check");
    const check = waitCheck(page);
    const diag2 = waitDiagnose(page);
    await page.getByTestId("verdict-retry").click();
    await Promise.all([check, diag2]);
    await settled(page);
    await expect(level(page)).toHaveText("手続き不要");
    await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
    await expect(page.getByTestId("evidence-id")).not.toHaveText(oldId);
    await expect(page.getByTestId("regulation-card-aviation-law-did")).toHaveAttribute("data-status", "green");
    await expect(page.getByRole("button", { name: /PDF 出力/ })).toBeEnabled();
  });

  // 結論が確定していない間（判定中・判定できません）は、カードの判定を「地点だけの判定（結論は未確定）」と示す。
  test("17. 結論が未確定の間、カードに地点だけの判定の札を出さない", async ({ page }) => {
    await openReady(page);
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    await expect(page.getByTestId("regulation-verdict").first()).toBeVisible();
    await page.route("**/api/diagnose", (route) => route.fulfill({ status: 500, body: "{}" }));
    const failed = page.waitForResponse((r) => r.url().endsWith("/api/diagnose"));
    await methodBox(page, "夜間飛行").check();
    await failed;
    await expect(page.getByTestId("verdict-failed")).toBeVisible();
    const card = page.getByTestId("regulation-card-aviation-law-did");
    await expect(card.getByTestId("regulation-verdict")).toHaveCount(0);
    await expect(card.getByTestId("regulation-verdict-provisional")).toContainText("地点だけの判定（結論は未確定）");
    await expect(card).not.toContainText("手続き不要");
  });

  // 診断が応答しないときは、時間の上限（20 秒）で失敗として扱う。
  test("18. 診断が応答しないと、上限の時間で「判定できません」になり、履歴は判定未確定", async ({ page }) => {
    test.setTimeout(120_000);
    await openReady(page);
    await gotoLatLng(page, QUIET.lat, QUIET.lng);
    await page.route("**/api/diagnose", async (route) => {
      await new Promise((r) => setTimeout(r, 40_000));
      await route.abort().catch(() => {});
    });
    await methodBox(page, "夜間飛行").check();
    await expect(page.getByTestId("verdict-pending")).toBeVisible();
    await expect(page.getByTestId("verdict-failed")).toBeVisible({ timeout: 35_000 });
    const latest = page.getByTestId("history-item").first().getByTestId("history-verdict");
    await expect(latest).toContainText("判定未確定");
    await expect(page.getByRole("button", { name: /PDF 出力/ })).toBeDisabled();
  });
});
