// 変異テスト：16-F2 の @media の効果を打ち消し（余白を 16-F の値に戻し）、新 spec と同じ判定が 320・200% で落ちることを確かめる
import { chromium } from "@playwright/test";
const BASE = "http://127.0.0.1:3400";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, serviceWorkers: "block" });
await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
const page = await ctx.newPage();
await page.goto(BASE + "/ops/more"); await page.waitForLoadState("networkidle").catch(() => {});
for (const mutate of [false, true]) {
  if (mutate) await page.addStyleTag({ content: ".sb-tabs{gap:8px!important;padding-inline:8px!important}.sb-tab{padding-inline:4px!important}" });
  for (const w of [320, 360]) {
    await page.setViewportSize({ width: w, height: 640 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; }); await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="ops-bottom-nav"]');
      const items = [...nav.querySelectorAll("a")].map((a) => { const r = a.getBoundingClientRect(); const lab = a.lastElementChild; const rg = document.createRange(); rg.selectNodeContents(lab); return { r: r.right, w: r.width, clip: lab.scrollWidth > lab.clientWidth + 1, out: [...rg.getClientRects()].some((q) => q.left < r.left - 0.5 || q.right > r.right + 0.5) }; });
      return { sw: nav.scrollWidth, cw: nav.clientWidth, items, sum: items.reduce((s, i) => s + i.w, 0), docSw: document.documentElement.scrollWidth };
    });
    const f = [];
    if (m.sw > m.cw) f.push(`navSw ${m.sw}>${m.cw}`);
    if (m.items.some((i) => i.r > w)) f.push(`右端 ${Math.max(...m.items.map((i) => i.r)).toFixed(0)}>${w}`);
    if (m.sum > w) f.push(`幅の合計 ${m.sum.toFixed(0)}>${w}`);
    if (m.items.some((i) => i.clip)) f.push("clip");
    if (m.items.some((i) => i.out)) f.push("ラベルが箱外");
    if (m.docSw > w) f.push(`doc ${m.docSw}>${w}`);
    console.log(mutate ? "MUTATED(16-F の余白)" : "HEAD", w + "px 200%", f.length ? "FAIL: " + f.join(", ") : "pass");
  }
}
await b.close();
