// 手順 3: 離脱の確認（beforeunload・アプリ内リンク・戻るの番兵）、履歴との衝突、422、役割。
import { apiAs, launch, newPage, mkAircraft, pilotIdOf, shot, settle, T, stepOf, tapNext, BASE, stamp } from "./sprint-16H1-eval-lib.mjs";
import fs from "node:fs";
const out = [];
const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };
const mgr = await apiAs("a-manager");
const ac = await mkAircraft(mgr, "H1L");
const pid = await pilotIdOf("a-pilot");
const browser = await launch();
const unload = (page) => page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
const hist = (page) => page.evaluate(() => ({ url: location.pathname + location.search, state: JSON.stringify(history.state), len: history.length }));

// ---- A. 入力なし：全部出ない
{
  const { context, page } = await newPage(browser, "a-manager", { width: 375, height: 812 });
  const dialogs = []; page.on("dialog", (d) => { dialogs.push(d.type()); d.dismiss(); });
  await page.goto(`${BASE}/ops/plans`); await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  const u0 = await unload(page);
  await T(page, "plan-wizard-next").click(); await page.waitForTimeout(300); // 空で次へ（エラーだけ・入力ではない）
  const u1 = await unload(page);
  await page.getByRole("link", { name: "飛行計画の一覧" }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  log({ case: "A-no-input", beforeunloadPrevented: [u0, u1], dialogs, movedTo: new URL(page.url()).pathname });
  await context.close();
}
// ---- B. 入力あり：beforeunload・リンク（取り消し→留まる→承諾→移る）
{
  const { context, page } = await newPage(browser, "a-manager", { width: 375, height: 812 });
  const dialogs = []; let accept = false;
  page.on("dialog", async (d) => { dialogs.push({ type: d.type(), msg: d.message().slice(0, 30) }); accept ? await d.accept() : await d.dismiss(); });
  await page.goto(`${BASE}/ops/plans`); await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  await T(page, "plan-place-name").fill("離脱の試験");
  const u = await unload(page);
  const h1 = await hist(page);
  // ヘッダの戻るリンク
  await page.getByRole("link", { name: "飛行計画の一覧" }).first().click(); await page.waitForTimeout(600);
  log({ case: "B-link-cancel", beforeunloadPrevented: u, dialogs: [...dialogs], stayed: new URL(page.url()).pathname, valueKept: await T(page, "plan-place-name").inputValue(), histAfterInput: h1 });
  // 下部ナビ
  dialogs.length = 0;
  await page.locator('[data-testid="ops-bottom-nav"] a').first().click(); await page.waitForTimeout(600);
  log({ case: "B-bottomnav-cancel", dialogs: [...dialogs], stayed: new URL(page.url()).pathname });
  accept = true; dialogs.length = 0;
  await page.locator('[data-testid="ops-bottom-nav"] a').first().click(); await page.waitForTimeout(1500);
  log({ case: "B-bottomnav-accept", dialogs: [...dialogs], movedTo: new URL(page.url()).pathname });
  // 移った先で、また戻ってきて入力なしなら出ない・新しい画面は空
  dialogs.length = 0;
  await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor();
  log({ case: "B-reopen-empty", placeName: await T(page, "plan-place-name").inputValue(), unload: await unload(page) });
  await context.close();
}
// ---- C. 戻るの番兵：段間の戻る・進む、段①の戻る→確認、衝突
{
  const { context, page } = await newPage(browser, "a-manager", { width: 375, height: 812 });
  const dialogs = []; let accept = false;
  page.on("dialog", async (d) => { dialogs.push(d.type()); accept ? await d.accept() : await d.dismiss(); });
  await page.goto(`${BASE}/ops/plans`); await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  const h0 = await hist(page);
  await T(page, "plan-place-name").fill("番兵の試験"); await T(page, "plan-lat").fill("35.1"); await T(page, "plan-lng").fill("133.1");
  const h1 = await hist(page);
  await tapNext(page);
  await T(page, "plan-start-date").fill("2027-04-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20");
  await tapNext(page);
  await T(page, "plan-title").fill("番兵の計画"); await T(page, "plan-purpose").fill("試験");
  await tapNext(page);
  const trail = [{ at: "step4", ...(await hist(page)) }];
  await page.goBack(); await page.waitForTimeout(300); trail.push({ at: "back1", step: await stepOf(page), ...(await hist(page)) });
  await page.goBack(); await page.waitForTimeout(300); trail.push({ at: "back2", step: await stepOf(page), ...(await hist(page)) });
  await page.goForward(); await page.waitForTimeout(300); trail.push({ at: "fwd1", step: await stepOf(page), vals: await T(page, "plan-title").inputValue().catch(() => null), ...(await hist(page)) });
  await page.goBack(); await page.waitForTimeout(300); await page.goBack(); await page.waitForTimeout(300);
  trail.push({ at: "to-step1", step: await stepOf(page), place: await T(page, "plan-place-name").inputValue(), dialogs: [...dialogs], ...(await hist(page)) });
  const back3 = await page.goBack().catch(() => null); await page.waitForTimeout(500);
  trail.push({ at: "back-from-step1-cancel", dialogs: [...dialogs], step: await stepOf(page).catch(() => null), place: await T(page, "plan-place-name").inputValue().catch(() => null), ...(await hist(page)) });
  // 次へが効く（Next ルーターと衝突していない）
  const r = await tapNext(page); trail.push({ at: "next-after-cancel", r, step: await stepOf(page) });
  await page.goBack(); await page.waitForTimeout(300); // step1 へ
  dialogs.length = 0;
  accept = true;
  await page.goBack(); await page.waitForTimeout(1200);
  trail.push({ at: "back-from-step1-accept", dialogs: [...dialogs], url: new URL(page.url()).pathname, hist: await hist(page) });
  log({ case: "C-sentinel", h0, h1, trail });
  await context.close();
}
// ---- D. 実際の 422（緯度の範囲外・半径の範囲外）→ ⑤ に一覧と導線
{
  const { context, page } = await newPage(browser, "a-manager", { width: 375, height: 812 });
  await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  await T(page, "plan-place-name").fill("422の試験"); await T(page, "plan-lat").fill("95"); await T(page, "plan-lng").fill("133.1"); await T(page, "plan-radius").fill("99999");
  await tapNext(page);
  await T(page, "plan-start-date").fill("2027-04-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20"); await tapNext(page);
  await T(page, "plan-title").fill("422の計画"); await T(page, "plan-purpose").fill("試験"); await tapNext(page);
  await T(page, "plan-aircraft").selectOption(ac.id); await T(page, "plan-pilot").selectOption(pid); await tapNext(page);
  let status = null; page.on("response", (r) => { if (r.url().endsWith("/api/ops/plans") && r.request().method() === "POST") status = r.status(); });
  await T(page, "plan-submit").click(); await page.waitForTimeout(1500);
  const errs = await page.evaluate(() => ({ step: document.querySelector('[data-testid="plan-form"]').dataset.step, list: Array.from(document.querySelectorAll('[data-testid="plan-review-error"]')).map((e) => e.textContent.trim()), lead: document.querySelector(".opx-wiz-errlead")?.textContent, formErr: document.querySelector("[data-form-error]")?.textContent?.trim(), saveBtn: !!document.querySelector('[data-testid="plan-submit"]') }));
  log({ case: "D-422", status, errs });
  await shot(page, "375-422");
  // 導線: 場所の段へ戻る
  const fix = page.locator('[data-testid^="plan-review-error-fix-"]').first();
  const fixId = await fix.getAttribute("data-testid"); const box = await fix.boundingBox();
  await fix.click(); await page.waitForTimeout(500);
  log({ case: "D-fix", fixId, box, step: await stepOf(page), focus: await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), fieldErrs: await page.evaluate(() => Array.from(document.querySelectorAll('[aria-invalid="true"]')).map((e) => e.getAttribute("data-testid"))), msg: await page.evaluate(() => document.querySelector("[data-form-error]")?.textContent?.trim()) });
  await shot(page, "375-422-fixed-step");
  // 直して保存
  await T(page, "plan-lat").fill("35.1"); await T(page, "plan-radius").fill("200");
  await T(page, "plan-wizard-next").click(); await page.waitForTimeout(500);
  log({ case: "D-back-to-review", step: await stepOf(page), formErr: await page.evaluate(() => document.querySelector("[data-form-error]")?.textContent?.trim() ?? null) });
  await T(page, "plan-submit").click(); await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/, { timeout: 30000 });
  log({ case: "D-saved", url: page.url() });
  await context.close();
}
// ---- E. 役割
for (const who of ["a-viewer", "a-pilot"]) {
  const { context, page } = await newPage(browser, who, { width: 375, height: 812 });
  await page.goto(`${BASE}/ops/plans/new`); await page.waitForTimeout(800);
  log({ case: `E-${who}`, form: await T(page, "plan-form").count(), h1: await page.locator("h1").first().textContent().catch(() => null), body: (await page.locator("main").innerText()).slice(0, 80) });
  await context.close();
}
fs.writeFileSync("/home/user/soraban/docs/evaluations/logs/sprint-16H1-eval-leave.json", JSON.stringify(out, null, 1));
await browser.close(); await mgr.dispose();
