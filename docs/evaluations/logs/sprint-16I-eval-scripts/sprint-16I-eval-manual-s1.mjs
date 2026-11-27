import { launch, signedCtx, SHOT } from "./lib.mjs";
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
const out = {};
for (const [name, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 800 }]]) {
  const ctx = await signedCtx(b, "a-manager", { viewport: vp, hasTouch: name === "375" });
  const page = await ctx.newPage();
  const posts = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/ops/inspections")) posts.push(r.url()); });
  await page.goto(`/ops/inspections/new?aircraftId=${AC}`);
  await page.getByRole("form", { name: "日常点検の入力" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOT}/s1-initial-${name}.png`, fullPage: true });
  const groups = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="inspection-group-"]')].filter(e=>/^inspection-group-(body|link|power)$/.test(e.dataset.testid)).map(e => ({ id: e.dataset.testid, open: e.open, summary: e.querySelector("summary").innerText.replace(/\n/g," | "), srOnly: [...e.querySelectorAll(".sr-only")].map(x=>x.textContent) })));
  out.groups = groups;
  out.note = await page.getByTestId("inspection-group-note").innerText();
  out.progress = await page.getByTestId("inspection-progress").innerText();
  out.missing = await page.getByTestId("inspection-missing-count").innerText();
  // aria-live
  out.live = await page.evaluate(() => [...document.querySelectorAll("[aria-live]")].map(e => e.dataset.testid || e.tagName));
  // I-2 click save with nothing
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(300);
  out.afterSave1 = await page.evaluate(() => { const a = document.activeElement; const id = a.getAttribute("aria-describedby"); return { tag: a.tagName, label: a.getAttribute("aria-label"), invalid: a.getAttribute("aria-invalid"), id, text: id ? document.getElementById(id)?.textContent : null }; });
  out.posts1 = posts.length;
  await page.screenshot({ path: `${SHOT}/s2-after-save-${name}.png` });
  // collapse group 1 and 2, click again
  await page.locator('[data-testid="inspection-group-body"] > summary').click();
  await page.locator('[data-testid="inspection-group-link"] > summary').click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(300);
  out.afterSave2 = await page.evaluate(() => ({ body: document.querySelector('[data-testid="inspection-group-body"]').open, link: document.querySelector('[data-testid="inspection-group-link"]').open, focus: document.activeElement.getAttribute("aria-label") }));
  // N-1: abnormal one item, collapse group, press all normal
  await page.getByRole("radiogroup", { name: "プロペラの結果" }).getByRole("radio", { name: "異常" }).check();
  await page.locator('[data-testid="inspection-group-body"] > summary').click();
  await page.getByRole("button", { name: "すべて正常" }).click();
  out.n1 = await page.evaluate(() => ({ propeller: document.querySelector('[data-testid="inspection-mark-propeller"]').dataset.state, general: document.querySelector('[data-testid="inspection-mark-general"]').dataset.state, bodyOpen: document.querySelector('[data-testid="inspection-group-body"]').open, bodyCount: document.querySelector('[data-testid="inspection-group-body-count"]').innerText, missing: document.querySelector('[data-testid="inspection-missing-count"]').innerText }));
  // save with abnormal without note -> server validation, should open group
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(800);
  out.abnormalNoNote = await page.evaluate(() => ({ bodyOpen: document.querySelector('[data-testid="inspection-group-body"]').open, focus: document.activeElement.getAttribute("aria-label") || document.activeElement.tagName, url: location.pathname }));
  out.postsAfterAbn = posts.length;
  await page.screenshot({ path: `${SHOT}/s3-abnormal-nonote-${name}.png`, fullPage: true });
  // draft localStorage
  out.ls = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  out.idb = await page.evaluate(async () => indexedDB.databases ? (await indexedDB.databases()).map(d=>d.name) : null);
  // fill note and save; double click
  await page.getByLabel("プロペラの備考").fill("欠けあり、交換した");
  await page.getByLabel("実施場所", { exact: true }).fill("本社 駐車場");
  const btn = page.getByRole("button", { name: "保存", exact: true });
  await btn.dblclick();
  await page.waitForURL(/\/ops\/inspections\/[0-9a-f-]{36}$/, { timeout: 15000 }).catch(() => {});
  out.finalUrl = page.url();
  out.postsFinal = posts.length;
  await ctx.close();
  console.log(name, JSON.stringify(out, null, 1));
}
await b.close();
