// 16-N3 N3-9：下部ナビの最初のタップ。goto → networkidle → 文字の倍率 → 下部ナビ「機体と書類」を touchscreen.tap。30 回ずつ。
// 使い方: BASE=http://127.0.0.1:3400 node docs/evaluations/logs/sprint-16N3-gen-tap.mjs [回数]
// 記録: 遷移した回数、タップで click が届いた回数、click が preventDefault された回数（Link が受けた印）、遷移までの時間、失敗時の状況。
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://127.0.0.1:3400";
const N = Number(process.argv[2] ?? 30);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
for (const [w, zoom] of [[320, ""], [390, ""]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 640 }, hasTouch: true, serviceWorkers: "block" });
  await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a-manager" } });
  const page = await ctx.newPage();
  let ok = 0, clicked = 0, prevented = 0; const times = []; const fails = [];
  for (let i = 0; i < N; i++) {
    await page.goto(BASE + "/ops"); await page.waitForLoadState("networkidle").catch(() => {});
    await page.evaluate((z) => {
      document.documentElement.style.fontSize = z;
      window.__c = 0; window.__p = 0;
      document.addEventListener("click", () => { window.__c++; }, true);
      window.addEventListener("click", (e) => { if (e.defaultPrevented) window.__p++; });
    }, zoom);
    await page.waitForTimeout(300);
    const bx = await page.locator('[data-testid="ops-bottom-nav"] [data-testid="nav-more"]').boundingBox();
    const t0 = Date.now();
    await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2);
    let nav = false;
    try { await page.waitForURL((u) => u.pathname === "/ops/more", { timeout: 4000 }); nav = true; ok++; times.push(Date.now() - t0); } catch {}
    const st = nav ? null : await page.evaluate(() => ({ c: window.__c, p: window.__p, path: location.pathname })).catch(() => null);
    if (nav) { const s = await page.evaluate(() => 0).catch(() => 0); }
    if (st) { if (st.c > 0) clicked++; if (st.p > 0) prevented++; fails.push(`#${i} click=${st.c} prevented=${st.p} path=${st.path}`); }
  }
  times.sort((a, c) => a - c);
  console.log(w, zoom || "100%", `first-tap ok ${ok}/${N}`, `失敗のうち click 到達 ${clicked}・preventDefault ${prevented}`, `遷移までの時間 中央値 ${times[Math.floor(times.length / 2)] ?? "-"}ms 最大 ${times.at(-1) ?? "-"}ms`);
  if (fails.length) console.log("  失敗:", fails.slice(0, 5).join(" | "));
  await ctx.close();
}
await b.close();
