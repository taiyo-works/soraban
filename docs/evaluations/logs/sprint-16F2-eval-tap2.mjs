import { chromium } from "@playwright/test";
const BASE = "http://127.0.0.1:3400";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
for (const [w, zoom] of [[320, "200%"], [390, ""], [320, ""], [390, "200%"]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 640 }, hasTouch: true, serviceWorkers: "block" });
  await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  const page = await ctx.newPage(); let ok = 0; const N = 30;
  for (let i = 0; i < N; i++) {
    await page.goto(BASE + "/ops"); await page.waitForLoadState("networkidle").catch(() => {});
    await page.evaluate((z) => { document.documentElement.style.fontSize = z; }, zoom); await page.waitForTimeout(300);
    const bx = await page.locator('[data-testid="ops-bottom-nav"] [data-testid="nav-more"]').boundingBox();
    await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2);
    try { await page.waitForURL((u) => u.pathname === "/ops/more", { timeout: 4000 }); ok++; } catch {}
  }
  console.log(w, zoom || "100%", `first-tap ok ${ok}/${N}`);
  await ctx.close();
}
await b.close();
