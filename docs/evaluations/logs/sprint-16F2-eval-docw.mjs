import { chromium, request } from "@playwright/test";
const T = (page, id) => page.locator(`[data-testid="${id}"]`);
const probe = (page) => page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const nav = document.querySelector('[data-testid="ops-bottom-nav"]');
  const sw0 = document.documentElement.scrollWidth;
  const navDisp = nav.style.display; nav.style.display = "none";
  const sw1 = document.documentElement.scrollWidth;
  nav.style.display = navDisp;
  const off = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) {
    if (!n.textContent.trim() || nav.contains(n.parentElement)) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    for (const q of r.getClientRects()) if (q.right > W + 0.5) { const e = n.parentElement; off.push(`${e.tagName.toLowerCase()}[${e.closest("[data-testid]")?.getAttribute("data-testid") ?? ""}] "${n.textContent.trim().slice(0, 24)}" right=${Math.round(q.right)}`); break; }
  }
  for (const el of document.body.querySelectorAll("*")) { if (nav.contains(el)) continue; const q = el.getBoundingClientRect(); if (q.width && q.right > W + 0.5) off.push(`BOX ${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? ""}] ${(el.className||"").toString().slice(0,30)} right=${Math.round(q.right)}`); }
  return { W, withNav: sw0, navHidden: sw1, off: off.slice(0, 8) };
});
const run = async (BASE, label) => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, serviceWorkers: "block" });
  await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/ops/plans"); await T(page, "plan-count").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  const cnt = await T(page, "plan-count").textContent();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; }); await page.waitForTimeout(400);
  console.log(label, "plans-list count:", cnt?.trim(), JSON.stringify(await probe(page)));
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  if (BASE.endsWith("3400")) {
    // 段 ④（空の DB：機体・操縦者を作ってから）
    const mgr = await ctx.request;
    const mark = `JU2${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    const ar = await mgr.post(`${BASE}/api/ops/aircraft`, { data: { registrationMark: mark, modelName: "評価機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
    await page.goto(BASE + "/ops/plans/new"); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
    const go = async (fill, s) => { await fill(); for (let i = 0; i < 5; i++) { await T(page, "plan-wizard-next").click(); await page.waitForTimeout(400); if (Number(await T(page, "plan-form").getAttribute("data-step")) !== s) break; } };
    await go(async () => { await T(page, "plan-place-name").fill("地点"); await T(page, "plan-lat").fill("35.1"); await T(page, "plan-lng").fill("133.1"); }, 1);
    await go(async () => { await T(page, "plan-start-date").fill("2027-05-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20"); }, 2);
    await go(async () => { await T(page, "plan-title").fill("計画"); await T(page, "plan-purpose").fill("試験"); }, 3);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; }); await page.waitForTimeout(400);
    console.log(label, "step", await T(page, "plan-form").getAttribute("data-step"), JSON.stringify(await probe(page)));
  }
  await b.close();
};
await run("http://127.0.0.1:3400", "fresh-DB");
await run("http://127.0.0.1:3401", "accumulated-DB");
