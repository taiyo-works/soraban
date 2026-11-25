import { launch, signedCtx } from "./lib.mjs";
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
const ctx = await signedCtx(b, "a-pilot", { viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
await page.goto(`/ops/inspections/new?aircraftId=${AC}`);
await page.getByRole("form", { name: "日常点検の入力" }).waitFor(); await page.waitForTimeout(800);
console.log(await page.evaluate(() => [...document.querySelectorAll("[aria-live],[role=status],[role=alert]")].map(e => `${e.tagName} live=${e.getAttribute("aria-live")} role=${e.getAttribute("role")} id=${e.id} tid=${e.dataset.testid} in-form=${!!e.closest("form")} text=${e.textContent.slice(0,30)} cls=${(e.className+"").slice(0,30)}`)));
await b.close();
