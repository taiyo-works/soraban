import { chromium } from "/home/user/soraban/node_modules/@playwright/test/index.mjs";
const BASE = process.argv[2] ?? "http://127.0.0.1:3400";
const out = [];
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH, args: ["--no-sandbox"] });
const routes = [["/", "公開 /"], ["/ops", "ホーム"], ["/ops/plans/new", "計画作成"], ["/ops/inspections/new", "点検の入力"], ["/ops/journal", "日誌"], ["/ops/flights/new", "飛行記録の入力"]];
for (const [w, h] of [[375, 812], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, serviceWorkers: "block" });
  const r = await ctx.request.post(BASE + "/api/test-auth/sign-in", { data: { authUserId: "b-manager", email: "b-manager@example.test", emailVerified: true, name: "b-manager" } });
  if (r.status() !== 200) throw new Error("sign-in " + r.status());
  for (const [path, name] of routes) {
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const m = await page.evaluate((vh) => {
      const de = document.documentElement;
      const vis = [...document.querySelectorAll("[data-testid]")].filter((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; });
      const first = vis.filter((e) => e.getBoundingClientRect().top < vh && e.getBoundingClientRect().top >= 0).map((e) => e.getAttribute("data-testid"));
      const inner = Math.max(...[...document.querySelectorAll("*")].map((e) => e.scrollHeight)); return { innerMaxScrollHeight: inner, scrollHeight: de.scrollHeight, bodyHeight: Math.round(document.body.getBoundingClientRect().height), firstScreenTestIds: first.slice(0, 30), title: document.title };
    }, h);
    out.push({ viewport: `${w}x${h}`, path, name, ...m });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
