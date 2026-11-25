import { launch, signedCtx, SHOT } from "./lib.mjs";
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
for (const [name, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 800 }]]) {
  const out = {};
  const ctx = await signedCtx(b, "a-pilot", { viewport: vp, hasTouch: name === "375" });
  const page = await ctx.newPage();
  const posts = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/ops/inspections")) posts.push(r.url()); });
  page.on("response", async (r) => { if (r.request().method()==="POST" && r.url().includes("/api/ops/inspections")) out.postStatus = (out.postStatus||[]).concat(r.status()); });
  await page.goto(`/ops/inspections/new?aircraftId=${AC}`);
  await page.getByRole("form", { name: "日常点検の入力" }).waitFor();
  await page.waitForTimeout(500);
  // all normal except propeller abnormal w/o note
  await page.getByRole("button", { name: "すべて正常" }).click();
  await page.getByRole("radiogroup", { name: "プロペラの結果" }).getByRole("radio", { name: "異常" }).check();
  await page.locator('[data-testid="inspection-group-body"] > summary').click();
  await page.getByLabel("実施場所", { exact: true }).fill("本社 駐車場");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(800);
  out.abnNoNote = await page.evaluate(() => ({ bodyOpen: document.querySelector('[data-testid="inspection-group-body"]').open, focus: document.activeElement.getAttribute("aria-label") || document.activeElement.tagName, labelText: document.activeElement.closest("label")?.innerText, url: location.pathname }));
  await page.screenshot({ path: `${SHOT}/s3-abnormal-nonote-${name}.png` });
  await page.getByLabel("プロペラの備考").fill("欠けあり、交換した");
  await page.getByRole("button", { name: "保存", exact: true }).dblclick();
  await page.waitForURL(/\/ops\/inspections\/[0-9a-f-]{36}$/, { timeout: 15000 }).catch(() => {});
  out.finalUrl = page.url();
  out.posts = posts.length; 
  await ctx.close();
  console.log(name, JSON.stringify(out));
}
await b.close();
