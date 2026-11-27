import { chromium } from "@playwright/test";
const BASE = "http://127.0.0.1:3400";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, serviceWorkers: "block" });
await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
const page = await ctx.newPage();
await page.goto(BASE + "/ops"); await page.waitForLoadState("networkidle").catch(() => {});
for (const w of [320, 359, 360, 375, 390, 430, 768, 1023]) {
  await page.setViewportSize({ width: w, height: 640 }); await page.waitForTimeout(150);
  const r = await page.evaluate(() => { const t = document.querySelector(".sb-tabs"); const a = t.querySelector(".sb-tab"); const cs = getComputedStyle(t), ca = getComputedStyle(a); return { gap: cs.columnGap, padL: cs.paddingLeft, padR: cs.paddingRight, tabPadL: ca.paddingLeft, tabPadT: ca.paddingTop, minH: ca.minHeight, mY: ca.marginTop, fs: ca.fontSize, cols: cs.gridTemplateColumns.split(" ").length, shadow: cs.boxShadow.slice(0, 30) }; });
  console.log(w, JSON.stringify(r));
}
await b.close();
