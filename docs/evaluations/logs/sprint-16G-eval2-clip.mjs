import { launch, newPage, waitStyles, BASE } from "./sprint-16G-eval2-lib.mjs";
const browser = await launch(); const out = [];
for (const [w, h, z] of [[390, 844, 2], [430, 932, 2], [320, 640, 0], [375, 812, 0]]) {
  const { context, page } = await newPage(browser, "b-manager", { width: w, height: h });
  await page.goto(`${BASE}/ops`); await page.waitForSelector('[data-testid="ops-today"]');
  if (z) await page.addStyleTag({ content: `html{font-size:${16 * z}px !important}` }); await waitStyles(page);
  out.push({ w, z, clipped: await page.evaluate(() => { const r = []; document.querySelectorAll("main *").forEach((e) => { const cs = getComputedStyle(e); if (!/hidden|clip/.test(cs.overflowX + cs.overflowY) || !e.textContent?.trim()) return; const b = e.getBoundingClientRect(); if (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) r.push({ cls: e.className.toString().slice(0, 40), w: Math.round(b.width), h: Math.round(b.height), text: e.textContent.slice(0, 20) }); }); return r; }) });
  await context.close();
}
await browser.close(); console.log(JSON.stringify(out));
