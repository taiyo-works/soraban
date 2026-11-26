// 16-N3 designer：前後の撮影と実測。使い方: BASE=http://127.0.0.1:3400 OUT=docs/evaluations/screenshots/sprint-16N3/design TAG=before node docs/evaluations/logs/sprint-16N3-design-shots.mjs
import { chromium, request as pwRequest } from "@playwright/test";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE ?? "http://127.0.0.1:3400";
const OUT = process.env.OUT ?? "docs/evaluations/screenshots/sprint-16N3/design";
const TAG = process.env.TAG ?? "x";
mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36).toUpperCase();
const mk = async (key) => { const c = await pwRequest.newContext({ baseURL: BASE }); const r = await c.post("/api/test-auth/sign-in", { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } }); if (r.status() !== 200) throw new Error("sign-in " + r.status()); return c; };
const post = async (c, path, data) => { const r = await c.post(path, { data }); if (r.status() !== 201) throw new Error(path + " " + r.status() + " " + (await r.text())); return r.json(); };
const mgr = await mk("b-manager");
const ac = await post(mgr, "/api/ops/aircraft", { registrationMark: `JU16D${stamp}`.slice(0, 20), modelName: "N3 試験機", manufacturer: "DJI", serialNumber: `SN-D${stamp}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 });
const bp = await mk("b-pilot");
const me = await (await bp.get("/api/ops/me")).json();
const title = `橋梁の定期点検と河川敷の空撮の合同飛行 ${stamp}`;
const plan = await post(mgr, "/api/ops/plans", { title, aircraftId: ac.id, pilotId: me.pilotId, plannedStartAt: "2027-01-05T13:00", durationMinutes: 30, purpose: "現場の空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] });
const name40 = `四十字の氏名で期限の対象を長くする試験操縦者${stamp}ＡＢＣＤＥＦＧＨＩＪＫＬ`.slice(0, 40);
await post(mgr, "/api/ops/pilots", { fullName: name40, hasLicense: true, licenseClass: "second", licenseNumber: `ND-${stamp}`.slice(0, 30), licenseExpiresOn: "2027-01-06" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const settle = (p) => p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
const open = async (w, h, zoom, path, ready) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, locale: "ja-JP", serviceWorkers: "block" });
  await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "b-manager", email: "b-manager@example.test", emailVerified: true, name: "b-manager" } });
  const page = await ctx.newPage();
  await page.goto(BASE + path);
  if (ready) await page.locator(ready).first().waitFor({ state: "visible" });
  if (zoom) await page.evaluate((z) => { document.documentElement.style.fontSize = z + "%"; }, zoom);
  await settle(page);
  return { ctx, page };
};
const shot = async (page, name, full = false) => page.screenshot({ path: `${OUT}/${name}-${TAG}.png`, fullPage: full });
// 1. ホーム 375×812（題 2 行・期限の対象 40 字）
{
  const { ctx, page } = await open(375, 812, 0, "/ops", '[data-testid="home-prep"]');
  const m = await page.evaluate(() => { const q = document.querySelector('[data-testid="home-quick"]').getBoundingClientRect(); const nav = document.querySelector('[data-testid="ops-bottom-nav"]').getBoundingClientRect(); const r = (id) => { const e = document.querySelector(`[data-testid="${id}"]`); return e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : null; }; return { margin: nav.top - q.bottom, quickBottom: q.bottom, navTop: nav.top, prep: r("home-prep"), next: r("home-next"), dl: r("home-deadlines"), primary: r("home-primary") }; });
  console.log(`[${TAG}] home 375x812`, JSON.stringify(m));
  await shot(page, "home-375"); await ctx.close();
}
// 2. 現場 320・200%（1 行の帯・折り返し）
for (const [w, z] of [[320, 200], [390, 100]]) {
  const { ctx, page } = await open(w, 700, z, `/ops/plans/${plan.id}/field`, '[data-testid="field-root"][data-hydrated="true"]');
  await shot(page, `field-${w}-${z}-top`);
  await page.evaluate(() => window.scrollTo(0, 700)); await settle(page); await shot(page, `field-${w}-${z}-scrolled`);
  if (z === 200) {
    const pad = await page.evaluate(() => { const e = document.querySelector('[data-testid="field-band-compact"]'); const cs = getComputedStyle(e); const c = e.children[0].getBoundingClientRect(), u = e.children[1].getBoundingClientRect(); return { fs: cs.fontSize, pl: cs.paddingLeft, left: c.left, right: u.right, h: e.getBoundingClientRect().height, sw: e.scrollWidth, cw: e.clientWidth }; });
    console.log(`[${TAG}] field band ${w}/${z}`, JSON.stringify(pad));
  }
  await ctx.close();
}
// 3. header 320・200%、360・100%
for (const [w, z] of [[320, 200], [360, 100]]) { const { ctx, page } = await open(w, 640, z, "/ops", '[data-testid="ops-header"]'); await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, `header-${w}-${z}`); await ctx.close(); }
// 4. 計画作成の段 ②（320・200%：全体）
{
  const { ctx, page } = await open(320, 640, 200, "/ops/plans/new", "form");
  await shot(page, "wizard-new-320-200", true); await ctx.close();
}
// 5. 点検の入力（日付先頭：/ops/inspections/new?…）
{
  const { ctx, page } = await open(360, 740, 0, "/ops/inspections/new", "form");
  await shot(page, "inspection-new-360-100"); await ctx.close();
}
await b.close(); await mgr.dispose(); await bp.dispose();
