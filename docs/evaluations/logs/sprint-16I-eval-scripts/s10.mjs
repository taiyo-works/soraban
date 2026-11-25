import { launch, signedCtx } from "./lib.mjs";
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
for (const [n, vp] of [["375", {width:375,height:812}], ["1280", {width:1280,height:800}]]) {
const ctx = await signedCtx(b, "a-pilot", { viewport: vp, hasTouch: n==="375" });
const page = await ctx.newPage();
await page.goto(`/ops/inspections/new?aircraftId=${AC}`);
await page.getByRole("form", { name: "日常点検の入力" }).waitFor(); await page.waitForTimeout(800);
console.log(n, JSON.stringify(await page.evaluate(() => {
  const h = (e) => Math.round(e.getBoundingClientRect().height*10)/10, w=(e)=>Math.round(e.getBoundingClientRect().width*10)/10;
  const sums = [...document.querySelectorAll('[data-testid^="inspection-group-"] > summary')].map(h);
  const labels = [...document.querySelectorAll('[data-testid^="inspection-item-"] label')].map(e => [h(e), w(e)]);
  const rows = [...document.querySelectorAll('li[data-testid^="inspection-item-"]')].map(h);
  const radios = [...document.querySelectorAll('[data-testid^="inspection-item-"] input')].map(e => [w(e),h(e)]);
  const all = [...document.querySelectorAll("main *")].filter(e => e.children.length===0 && e.textContent.trim() && getComputedStyle(e).display!=="none");
  const small = all.filter(e => parseFloat(getComputedStyle(e).fontSize) < 14).map(e => e.textContent.trim().slice(0,12)+":"+getComputedStyle(e).fontSize);
  const notes14 = all.filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.textContent.trim().slice(0,10)+":"+getComputedStyle(e).fontSize);
  const save = document.querySelector('button[type=submit]'); 
  return { sumH: [...new Set(sums)], labelMin: Math.min(...labels.map(x=>x[0])), labelW: Math.min(...labels.map(x=>x[1])), rowMin: Math.min(...rows), radio: [...new Set(radios.map(String))], small, under16: [...new Set(notes14)].slice(0,12), saveH: save && h(save), pageH: document.documentElement.scrollHeight };
})));
await ctx.close(); }
await b.close();
