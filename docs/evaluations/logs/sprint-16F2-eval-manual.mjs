// Sprint 16-F2 評価用の手動測定（アプリのコードは変えない）。EVAL_BASE・EVAL_TAG・EVAL_SHOTS を環境変数で指定。
import { chromium, request } from "@playwright/test";
import fs from "node:fs";
const BASE = process.env.EVAL_BASE ?? "http://127.0.0.1:3400";
const TAG = process.env.EVAL_TAG ?? "man";
const SHOT = "/home/user/soraban/docs/evaluations/screenshots/sprint-16F2";
const SHOTS = process.env.EVAL_SHOTS !== "0";
const stamp = Date.now().toString(36).toUpperCase();
const out = [];
const log = (o) => { out.push(o); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const signIn = async (ctx, key) => {
  const r = await ctx.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  if (r.status() !== 200) throw new Error("sign-in " + key + " " + r.status());
};
const api = async (key) => { const c = await request.newContext({ baseURL: BASE }); await signIn(c, key); return c; };
const T = (page, id) => page.locator(`[data-testid="${id}"]`);
const settle = async (page) => { await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => undefined); await page.waitForTimeout(150); };
const mgr = await api("a-manager");
const mark = `JU2${stamp}`.slice(0, 20);
const ar = await mgr.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "評価機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
const aircraftId = (await ar.json()).id;
const pl = await api("a-pilot");
const pilotId = (await (await pl.get("/api/ops/me")).json()).pilotId;

const measure = (page) => page.evaluate(() => {
  const nav = document.querySelector('[data-testid="ops-bottom-nav"]');
  if (!nav) return { nav: null };
  const W = document.documentElement.clientWidth;
  const items = [...nav.querySelectorAll("a")].map((a) => {
    const r = a.getBoundingClientRect();
    const lab = a.lastElementChild;
    const rg = document.createRange(); rg.selectNodeContents(lab);
    const rects = [...rg.getClientRects()];
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = (x, y) => { const e = document.elementFromPoint(x, y); return e ? !!e.closest("a") && e.closest("a") === a : false; };
    return {
      text: lab.textContent.trim(), tid: a.getAttribute("data-testid"), href: a.getAttribute("href"),
      l: +r.left.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1),
      lines: new Set(rects.map((q) => Math.round(q.top))).size,
      textL: +Math.min(...rects.map((q) => q.left)).toFixed(1), textR: +Math.max(...rects.map((q) => q.right)).toFixed(1),
      clip: lab.scrollWidth > lab.clientWidth + 1,
      fs: parseFloat(getComputedStyle(lab).fontSize),
      cur: a.getAttribute("aria-current") === "page",
      line3: getComputedStyle(a, "::before").content !== "none" && parseFloat(getComputedStyle(a, "::before").height) === 3,
      hitCenter: hit(cx, cy), hitLeftEdge: hit(r.left + 1, cy), hitRightEdge: hit(r.right - 1, cy),
    };
  });
  const cs = getComputedStyle(nav);
  const bad = [];
  for (const el of document.body.querySelectorAll("*")) {
    const q = el.getBoundingClientRect(); if (!q.width || !q.height) continue;
    if (nav.contains(el)) continue;
    if (q.right > W + 0.5) bad.push(`${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? "[" + el.getAttribute("data-testid") + "]" : ""} right=${Math.round(q.right)}`);
  }
  const nr = nav.getBoundingClientRect();
  return { nav: { sw: nav.scrollWidth, cw: nav.clientWidth, l: nr.left, r: nr.right, h: nr.height, gap: cs.columnGap, pad: cs.paddingLeft + "/" + cs.paddingRight, position: cs.position }, W, docSw: document.documentElement.scrollWidth, items, bad: bad.slice(0, 5), fsRoot: getComputedStyle(document.documentElement).fontSize };
});

const NAV4 = ["ホーム", "計画", "日誌", "機体と書類"];
const verdict = (m, w, z) => {
  const f = [];
  if (!m.nav) return ["nav なし"];
  if (m.nav.sw > m.nav.cw) f.push(`nav 横スクロール ${m.nav.sw}>${m.nav.cw}`);
  if (JSON.stringify(m.items.map((i) => i.text)) !== JSON.stringify(NAV4)) f.push("文言/順 " + m.items.map((i) => i.text));
  for (const i of m.items) {
    if (i.r > w + 0.5 || i.l < -0.5) f.push(`${i.text} 画面外 ${i.l}-${i.r}`);
    if (i.clip) f.push(`${i.text} clip`);
    if (i.textL < i.l - 0.5 || i.textR > i.r + 0.5) f.push(`${i.text} 文字が箱外 ${i.textL}-${i.textR} / ${i.l}-${i.r}`);
    if (i.h < 64) f.push(`${i.text} 高さ ${i.h}`);
    if (i.w < 48) f.push(`${i.text} 幅 ${i.w}`);
    if (i.fs !== (z ? 28 : 14)) f.push(`${i.text} fs ${i.fs}`);
    if (i.line3 !== i.cur) f.push(`${i.text} 線 ${i.line3} cur ${i.cur}`);
    if (!i.hitCenter || !i.hitLeftEdge || !i.hitRightEdge) f.push(`${i.text} タップ判定が他に奪われる c${i.hitCenter} l${i.hitLeftEdge} r${i.hitRightEdge}`);
  }
  const ov = m.items.slice(1).some((i, k) => i.l < m.items[k].r - 0.01);
  if (ov) f.push("項目の重なり");
  return f;
};

const sweepScreen = async (page, name, shotKey) => {
  for (const w of [320, 360, 390]) for (const z of [0, 1]) {
    await page.setViewportSize({ width: w, height: 640 });
    await page.evaluate((px) => { document.documentElement.style.fontSize = px; }, z ? "200%" : "");
    await settle(page);
    const m = await measure(page);
    const f = verdict(m, w, z);
    log({ case: "sweep", screen: name, w, zoom: z ? 200 : 100, navSw: m.nav?.sw, navCw: m.nav?.cw, docSw: m.docSw, W: m.W, gap: m.nav?.gap, pad: m.nav?.pad, widths: m.items?.map((i) => `${i.text}:${i.w}x${i.h}/${i.lines}`).join(" "), bad: m.bad, fail: f });
    if (SHOTS && w === 320 && shotKey) await page.screenshot({ path: `${SHOT}/eval-${shotKey}-${w}-${z ? 200 : 100}.png` });
    else if (SHOTS && shotKey && z && (w === 360 || w === 390) && ["home", "step4"].includes(shotKey)) await page.screenshot({ path: `${SHOT}/eval-${shotKey}-${w}-200.png` });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
};

const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, serviceWorkers: "block" });
await signIn(ctx.request, "a-manager");
const page = await ctx.newPage();
for (const [name, url, ready, key] of [["home", "/ops", "ops-today", "home"], ["plans", "/ops/plans", "plan-count", "plans"], ["journal", "/ops/journal", "ops-journal", "journal"], ["more", "/ops/more", "ops-more", "more"], ["inspections", "/ops/inspections", null, "insp"], ["aircraft", "/ops/aircraft", null, null], ["pilots", "/ops/pilots", null, null]]) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + url); if (ready) await T(page, ready).waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
  await sweepScreen(page, name, key);
}
// 計画作成 段 ①〜⑤
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + "/ops/plans/new"); await T(page, "plan-form").waitFor(); await page.waitForLoadState("networkidle").catch(() => {});
const fills = [
  async () => { await T(page, "plan-place-name").fill("F2 評価地点"); await T(page, "plan-lat").fill("35.1"); await T(page, "plan-lng").fill("133.1"); },
  async () => { await T(page, "plan-start-date").fill("2027-05-09"); await T(page, "plan-start-time").fill("10:00"); await T(page, "plan-duration").fill("20"); },
  async () => { await T(page, "plan-title").fill("F2 評価計画"); await T(page, "plan-purpose").fill("試験"); },
  async () => { await T(page, "plan-aircraft").selectOption(aircraftId); await T(page, "plan-pilot").selectOption(pilotId); },
];
for (let s = 1; s <= 5; s++) {
  await page.setViewportSize({ width: 390, height: 844 });
  await sweepScreen(page, `wizard-step${s}`, `step${s}`);
  await page.setViewportSize({ width: 390, height: 844 });
  if (s <= 4) {
    await fills[s - 1]();
    for (let i = 0; i < 5; i++) { await T(page, "plan-wizard-next").click(); await page.waitForTimeout(400); if (Number(await T(page, "plan-form").getAttribute("data-step")) !== s) break; }
  }
}
// 項目のリンク先・遷移（320・200%）
await page.setViewportSize({ width: 320, height: 640 });
await page.goto(BASE + "/ops"); await T(page, "ops-today").waitFor();
await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; }); await settle(page);
const nav = [];
for (const id of ["nav-plans", "nav-journal", "nav-more", "nav-today"]) {
  await T(page, "ops-bottom-nav").locator(`[data-testid="${id}"]`).click();
  await page.waitForTimeout(900); await page.waitForLoadState("networkidle").catch(() => {});
  nav.push({ id, url: new URL(page.url()).pathname });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
}
log({ case: "tap-nav-320-200", nav });
// 境界の幅：359/360 の計算値、1023/1024 で下部ナビの有無
const bnd = [];
for (const w of [319, 340, 359, 360, 375, 430, 767, 1023, 1024, 1280]) {
  await page.setViewportSize({ width: w, height: 700 });
  await page.goto(BASE + "/ops"); await T(page, "ops-today").waitFor(); await settle(page);
  const r = await page.evaluate(() => { const n = document.querySelector('[data-testid="ops-bottom-nav"]'); if (!n) return null; const cs = getComputedStyle(n); const t = n.querySelector("a"); return { vis: n.getBoundingClientRect().height > 0 && cs.display !== "none", gap: cs.columnGap, pad: cs.paddingLeft, tabPad: getComputedStyle(t).paddingLeft, tabMinH: getComputedStyle(t).minHeight, sw: n.scrollWidth, cw: n.clientWidth }; });
  const vis = await T(page, "ops-bottom-nav").isVisible().catch(() => false);
  bnd.push({ w, vis, ...r });
}
log({ case: "boundary", bnd });
fs.writeFileSync(`/home/user/soraban/docs/evaluations/logs/sprint-16F2-eval-manual-${TAG}.json`, JSON.stringify(out, null, 1));
const fails = out.filter((o) => o.fail && o.fail.length);
console.log("sweeps", out.filter((o) => o.case === "sweep").length, "failing", fails.length);
for (const f of fails) console.log(f.screen, f.w, f.zoom, f.fail.join("; "));
await browser.close();
