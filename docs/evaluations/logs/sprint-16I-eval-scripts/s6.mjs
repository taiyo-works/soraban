import { launch, signedCtx, SHOT } from "./lib.mjs";
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
for (const w of [360, 320, 390]) {
  const ctx = await signedCtx(b, "a-pilot", { viewport: { width: w, height: 780 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`/ops/inspections/new?aircraftId=${AC}`);
  await page.getByRole("form", { name: "日常点検の入力" }).waitFor();
  await page.waitForTimeout(500);
  const sw = () => page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth, bodyS: document.body.scrollWidth }));
  const res = { fresh100: await sw() };
  // all abnormal with notes, then save-missing state
  await page.getByRole("button", { name: "保存", exact: true }).click(); // missing state
  await page.waitForTimeout(300);
  res.missing100 = await sw();
  for (const l of ["機体全般","プロペラ","フレーム","通信系統","推進系統","電源系統","自動制御系統","操縦装置","バッテリー・燃料"]) await page.getByRole("radiogroup", { name: `${l}の結果` }).getByRole("radio", { name: "異常" }).check();
  await page.getByLabel("機体全般の備考").fill("とても長い備考とても長い備考とても長い備考とても長い備考とても長い備考");
  res.abn100 = await sw();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.waitForTimeout(600);
  res.abn200 = await sw();
  // clipped elements: elements extending beyond viewport width
  res.over200 = await page.evaluate(() => [...document.body.querySelectorAll("*")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > document.documentElement.clientWidth + 0.5 || r.left < -0.5); }).slice(0,8).map(e => `${e.tagName}${e.dataset.testid?'['+e.dataset.testid+']':''}:${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}`));
  await page.screenshot({ path: `${SHOT}/s6-zoom200-${w}.png`, fullPage: false });
  // fresh page, 200%, 
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.goto("/ops/inspections"); await page.getByTestId("inspection-list").waitFor();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.waitForTimeout(500);
  res.list200 = await sw();
  console.log(w, JSON.stringify(res));
  await ctx.close();
}
await b.close();
