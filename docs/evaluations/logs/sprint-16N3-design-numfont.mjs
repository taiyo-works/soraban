// 16-N3 designer：段 ② の日付・時刻の入力で sb-num（数字用の字体）を外した見た目の差。同じ値を、sb-num あり・なしで並べて撮る。
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://127.0.0.1:3400";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
for (const [w, z] of [[360, 100], [320, 200]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 500 }, locale: "ja-JP", serviceWorkers: "block" });
  await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a" } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/ops/inspections/new`); await page.locator("form").waitFor();
  const r = await page.evaluate((z) => {
    document.documentElement.style.fontSize = z + "%";
    const src = document.querySelector('input[type="date"]');
    document.body.innerHTML = "";
    const mk = (cls, label) => { const d = document.createElement("div"); d.style.cssText = "padding:8px 16px"; d.innerHTML = `<p style="font-size:14px">${label}</p>`; const i = document.createElement("input"); i.type = "date"; i.value = "2027-01-05"; i.className = src.className.replace(/sb-num/g, "") + " " + cls; i.style.width = "100%"; d.append(i); const t = document.createElement("input"); t.type = "time"; t.value = "13:00"; t.className = i.className; t.style.width = "100%"; d.append(t); document.body.append(d); return [i.scrollWidth, i.clientWidth]; };
    return { without: mk("", "sb-num なし（今）"), with: mk("sb-num", "sb-num あり（前）") };
  }, z);
  console.log(w, z, JSON.stringify(r));
  await page.screenshot({ path: `docs/evaluations/screenshots/sprint-16N3/design/numfont-${w}-${z}.png` });
  await ctx.close();
}
await b.close();
