import { chromium, request } from "@playwright/test";
const BASE = "http://127.0.0.1:3400";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, serviceWorkers: "block" });
await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
const page = await ctx.newPage();
const res = [];
for (const [id, path] of [["nav-more", "/ops/more"], ["nav-plans", "/ops/plans"], ["nav-journal", "/ops/journal"], ["nav-today", "/ops"], ["nav-more", "/ops/more"]]) {
  await page.goto(BASE + "/ops"); await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.waitForTimeout(300);
  const loc = page.locator(`[data-testid="ops-bottom-nav"] [data-testid="${id}"]`);
  const box = await loc.boundingBox();
  // タッチ（tap）で、項目の左端・右端付近も押す
  const t0 = Date.now();
  await page.touchscreen.tap(box.x + 3, box.y + box.height / 2);
  let ok = true; try { await page.waitForURL((u) => u.pathname === path, { timeout: 8000 }); } catch { ok = false; }
  res.push({ id, edge: "left+3", ok, ms: Date.now() - t0, url: new URL(page.url()).pathname });
  await page.goto(BASE + "/ops"); await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; }); await page.waitForTimeout(300);
  const box2 = await loc.boundingBox();
  const t1 = Date.now();
  await page.touchscreen.tap(box2.x + box2.width - 10, box2.y + box2.height - 10);
  ok = true; try { await page.waitForURL((u) => u.pathname === path, { timeout: 8000 }); } catch { ok = false; }
  res.push({ id, edge: "right-10,bottom-10", ok, ms: Date.now() - t1, url: new URL(page.url()).pathname });
}
console.log(JSON.stringify(res, null, 1));
await b.close();
