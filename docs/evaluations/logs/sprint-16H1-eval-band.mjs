import { apiAs, launch, newPage, mkAircraft, pilotIdOf, settle, T, tapNext, BASE } from "./sprint-16H1-eval-lib.mjs";
const browser = await launch();
for (const [w, h] of [[320, 640], [360, 740], [390, 844], [430, 932]]) {
  const { context, page } = await newPage(browser, "a-manager", { width: w, height: h });
  await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  await T(page, "plan-place-name").fill("x"); await T(page, "plan-lat").fill("35"); await T(page, "plan-lng").fill("133"); await tapNext(page);
  await T(page, "plan-start-date").fill("2027-04-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20"); await tapNext(page);
  await T(page, "plan-title").fill("x"); await T(page, "plan-purpose").fill("x"); await tapNext(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; }); await settle(page);
  const r = await page.evaluate(() => { const b = document.querySelector('[data-testid="plan-wizard-progress-band"]').getBoundingClientRect(); const hd = document.querySelector('header')?.getBoundingClientRect(); return { band: [Math.round(b.top), Math.round(b.height)], vh: innerHeight, pos: getComputedStyle(document.querySelector('[data-testid="plan-wizard-progress-band"]')).position }; });
  console.log(w, JSON.stringify(r));
  await context.close();
}
await browser.close();
