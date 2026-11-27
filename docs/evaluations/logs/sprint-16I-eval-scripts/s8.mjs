import { launch, signedCtx } from "./lib.mjs";
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
const ctx = await signedCtx(b, "a-pilot", { viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
const re = /完璧|保証|必ず|代行|代理|申請|通報不要|問題なし/g;
const urls = [`/ops/inspections/new?aircraftId=${AC}`, "/ops/inspections", "/ops/inspections?includeVoided=1", `/ops/inspections/new?aircraftId=${AC}&takeoffAt=2027-01-05T11:00`];
for (const u of urls) {
  await page.goto(u); await page.waitForTimeout(900);
  await page.getByRole("button", { name: "保存", exact: true }).click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll(".sr-only")].map(e=>e.textContent).join(" ") + [...document.querySelectorAll("[aria-label]")].map(e=>e.getAttribute("aria-label")).join(" "));
  console.log(u, [...t.matchAll(re)].map(m => m[0] + "…" + t.slice(Math.max(0, m.index - 15), m.index + 15).replace(/\n/g, " ")));
}
await b.close();
