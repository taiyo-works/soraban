import { apiAs, launch, newPage, mkAircraft, pilotIdOf, shot, settle, T, tapNext, BASE } from "./sprint-16H1-eval-lib.mjs";
const mgr = await apiAs("a-manager"); const ac = await mkAircraft(mgr, "H1N"); const pid = await pilotIdOf("a-pilot");
const browser = await launch();
const probe = (page) => page.evaluate(() => {
  const W = document.documentElement.clientWidth; const res = { sw: document.documentElement.scrollWidth, W, nonFixed: [], nav: null };
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let fixed = false; for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).position === "fixed") { fixed = true; break; }
    if (r.right > W + 0.5 && !fixed) res.nonFixed.push(`${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? "[" + el.getAttribute("data-testid") + "]" : ""}.${String(el.className).slice(0, 50)} r=${Math.round(r.right)} sw=${el.scrollWidth}`);
  }
  const nav = document.querySelector('[data-testid="ops-bottom-nav"]'); const tabs = Array.from(nav.querySelectorAll("a.sb-tab")).map((a) => { const r = a.getBoundingClientRect(); return [a.textContent.trim(), Math.round(r.left), Math.round(r.right)]; });
  const nr = nav.getBoundingClientRect(); res.nav = { left: nr.left, right: nr.right, sw: nav.scrollWidth, cw: nav.clientWidth, tabs, pos: getComputedStyle(nav).position };
  return res;
});
for (const url of ["/ops", "/ops/plans/new?step=4"]) {
  const { context, page } = await newPage(browser, "a-manager", { width: 320, height: 640 });
  await page.goto(`${BASE}${url.split("?")[0]}`); await T(page, "ops-bottom-nav").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  if (url.includes("plans/new")) {
    await T(page, "plan-place-name").fill("x"); await T(page, "plan-lat").fill("35"); await T(page, "plan-lng").fill("133"); await tapNext(page);
    await T(page, "plan-start-date").fill("2027-04-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20"); await tapNext(page);
    await T(page, "plan-title").fill("x"); await T(page, "plan-purpose").fill("x"); await tapNext(page);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; }); await settle(page);
  console.log(url, JSON.stringify(await probe(page)));
  await shot(page, `nav-320-200-${url.includes("plans") ? "step4" : "home"}`);
  await context.close();
}
await browser.close(); await mgr.dispose();
