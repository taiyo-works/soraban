import { chromium } from "@playwright/test";
const BASE = "http://127.0.0.1:3400";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
for (const [w, zoom] of [[320, "200%"], [320, ""], [390, ""]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 640 }, hasTouch: true, serviceWorkers: "block" });
  await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/ops/plans"); await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate((z) => { document.documentElement.style.fontSize = z; }, zoom); await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('[data-testid="ops-bottom-nav"] a')) {
      const q = a.getBoundingClientRect();
      const pts = { tl: [q.left + 1, q.top + 1], tr: [q.right - 1, q.top + 1], bl: [q.left + 1, q.bottom - 1], br: [q.right - 1, q.bottom - 1], c: [q.left + q.width / 2, q.top + q.height / 2] };
      const o = { id: a.getAttribute("data-testid"), box: [q.left, q.top, q.right, q.bottom].map((n) => +n.toFixed(1)), vh: innerHeight };
      for (const [k, [x, y]] of Object.entries(pts)) { const e = document.elementFromPoint(x, y); o[k] = e && e.closest("a") === a ? "self" : (e ? e.tagName + "." + (e.className || "").toString().slice(0, 30) : "null"); }
      out.push(o);
    }
    return out;
  });
  console.log(w, zoom || "100%"); for (const o of r) console.log(JSON.stringify(o));
  await ctx.close();
}
await b.close();
