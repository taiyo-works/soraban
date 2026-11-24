// 手順 5・8: 320 幅・200%、ほかの画面の同条件、色なし、寸法。
import { apiAs, launch, newPage, mkAircraft, pilotIdOf, shot, settle, T, stepOf, tapNext, BASE } from "./sprint-16H1-eval-lib.mjs";
import fs from "node:fs";
const out = [];
const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };
const mgr = await apiAs("a-manager");
const ac = await mkAircraft(mgr, "H1Z");
const pid = await pilotIdOf("a-pilot");
const browser = await launch();

const over = (page) => page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > W + 0.5) bad.push(`${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? "[" + el.getAttribute("data-testid") + "]" : ""}.${(el.className?.toString() || "").slice(0, 40)} right=${Math.round(r.right)}`);
  }
  return { scrollW: document.documentElement.scrollWidth, clientW: W, bad: bad.slice(0, 6) };
});
const zoom = (page) => page.evaluate(() => { document.documentElement.style.fontSize = "200%"; return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });

// A. ほかの画面 × 320 ×（等倍・200%）
const screens = ["/ops", "/ops/plans", "/ops/plans/new", "/ops/journal", "/ops/inspections", "/ops/inspections/new", "/ops/aircraft", "/ops/pilots", "/ops/permits", "/ops/places", "/ops/more", "/ops/about", "/ops/incidents", "/ops/members"];
for (const [w, h] of [[320, 640], [360, 740]]) {
  for (const s of screens) {
    const { context, page } = await newPage(browser, "a-manager", { width: w, height: h });
    await page.goto(`${BASE}${s}`); await page.waitForLoadState("networkidle").catch(() => {}); await settle(page);
    const a = await over(page);
    await zoom(page); await page.waitForTimeout(150);
    const b = await over(page);
    log({ case: "A-screens", w, screen: s, x1: a.scrollW > a.clientW ? a : "ok", x200: b.scrollW > b.clientW ? b : "ok" });
    await context.close();
  }
}
// B. ウィザード 各段 × 320・200%
{
  const { context, page } = await newPage(browser, "a-manager", { width: 320, height: 640 });
  await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  await zoom(page);
  const fills = [
    async () => { await T(page, "plan-place-name").fill("拡大の試験地点"); await T(page, "plan-lat").fill("35.1"); await T(page, "plan-lng").fill("133.1"); },
    async () => { await T(page, "plan-start-date").fill("2027-04-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20"); },
    async () => { await T(page, "plan-title").fill("拡大の計画"); await T(page, "plan-purpose").fill("試験"); },
    async () => { await T(page, "plan-aircraft").selectOption(ac.id); await T(page, "plan-pilot").selectOption(pid); },
  ];
  for (let s = 1; s <= 5; s++) {
    await settle(page);
    const o = await over(page);
    const sec = await page.evaluate(() => { const b = document.querySelector('[data-testid="plan-wizard-next"], [data-testid="plan-submit"]'); const n = document.querySelector('[data-testid="ops-bottom-nav"]'); b.scrollIntoView({ block: "center" }); const rb = b.getBoundingClientRect(); const rn = n?.getBoundingClientRect(); return { btn: [Math.round(rb.top), Math.round(rb.bottom)], navTop: rn && Math.round(rn.top), navH: rn && Math.round(rn.height) }; });
    log({ case: "B-wizard-320-200", step: s, ...o, sec });
    await shot(page, `320-200-step${s}`);
    if (s <= 4) { await fills[s - 1](); await tapNext(page); }
  }
  await context.close();
}
// C. 色なし（achromatopsia）：375 の段 3 エラー・進捗・⑤・422
{
  const { context, page } = await newPage(browser, "a-manager", { width: 375, height: 812 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "achromatopsia" });
  await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {}); await settle(page);
  await shot(page, "gray-step1");
  await T(page, "plan-wizard-next").click(); await page.waitForTimeout(300); await shot(page, "gray-step1-error");
  await T(page, "plan-place-name").fill("色なし"); await T(page, "plan-lat").fill("95"); await T(page, "plan-lng").fill("133.1");
  await tapNext(page); await T(page, "plan-start-date").fill("2027-04-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20"); await tapNext(page);
  await settle(page); await shot(page, "gray-step3");
  await T(page, "plan-wizard-next").click(); await page.waitForTimeout(300); await shot(page, "gray-step3-error");
  await T(page, "plan-title").fill("色なしの計画"); await T(page, "plan-purpose").fill("試験"); await tapNext(page);
  await T(page, "plan-aircraft").selectOption(ac.id); await T(page, "plan-pilot").selectOption(pid); await tapNext(page); await settle(page);
  await shot(page, "gray-step5");
  await T(page, "plan-submit").click(); await page.waitForTimeout(1500); await shot(page, "gray-422"); await shot(page, "gray-422-full", true);
  await context.close();
}
// D. 寸法・文字・断り書き（各段、375・1280）
for (const [w, h] of [[375, 812], [1280, 800]]) {
  const { context, page } = await newPage(browser, "a-manager", { width: w, height: h });
  await page.goto(`${BASE}/ops/plans/new`); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  const fills = [
    async () => { await T(page, "plan-place-name").fill("寸法の試験地点"); await T(page, "plan-lat").fill("35.1"); await T(page, "plan-lng").fill("133.1"); },
    async () => { await T(page, "plan-start-date").fill("2027-04-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20"); },
    async () => { await T(page, "plan-title").fill("寸法の計画"); await T(page, "plan-purpose").fill("試験"); },
    async () => { await T(page, "plan-aircraft").selectOption(ac.id); await T(page, "plan-pilot").selectOption(pid); },
  ];
  for (let s = 1; s <= 5; s++) {
    await settle(page);
    const m = await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
      const taps = Array.from(document.querySelectorAll("main a, main button, main input:not([type=checkbox]):not([type=radio]), main select, main textarea, main label:has(input)")).filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-testid") || e.textContent.trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.h < 47.5 || t.w < 47.5);
      const small = []; const fs = new Map();
      for (const e of document.querySelectorAll("main *")) { if (!vis(e)) continue; const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) continue; const f = parseFloat(getComputedStyle(e).fontSize); fs.set(f, (fs.get(f) || 0) + 1); if (f < 16) small.push(`${e.tagName.toLowerCase()}${e.getAttribute("data-testid") ? "[" + e.getAttribute("data-testid") + "]" : ""}=${f}:${e.textContent.trim().slice(0, 14)}`); }
      const notes = Array.from(document.querySelectorAll('[data-testid="plan-dips-notice"], main > div:first-child .opx-note, [data-testid="judge-pills"]')).map((e) => ({ id: e.getAttribute("data-testid"), shown: vis(e), display: getComputedStyle(e).display, t: e.textContent.trim().slice(0, 40) }));
      const h1 = document.querySelector("main h1")?.getBoundingClientRect();
      const first = document.querySelector('[data-testid="plan-step-heading"]').getBoundingClientRect();
      const nb = document.querySelector('[data-testid="plan-wizard-next"], [data-testid="plan-submit"]').getBoundingClientRect();
      return { smallTap: taps, smallText: small.slice(0, 8), fontSizes: Object.fromEntries(fs), notes, headingTop: Math.round(first.top), btnBottom: Math.round(nb.bottom), docH: document.documentElement.scrollHeight };
    });
    log({ case: "D-measure", w, step: s, ...m });
    if (s <= 4) { await fills[s - 1](); await tapNext(page); }
  }
  await context.close();
}
fs.writeFileSync("/home/user/soraban/docs/evaluations/logs/sprint-16H1-eval-zoom.json", JSON.stringify(out, null, 1));
await browser.close(); await mgr.dispose();
