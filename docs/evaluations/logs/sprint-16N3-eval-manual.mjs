// 16-N3 evaluator：手動シナリオの実測。使い方: BASE=http://127.0.0.1:3400 TAG=head node docs/evaluations/logs/sprint-16N3-eval-manual.mjs [section...]
import { chromium, request as pwRequest } from "@playwright/test";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE ?? "http://127.0.0.1:3400";
const TAG = process.env.TAG ?? "x";
const OUT = process.env.OUT ?? "docs/evaluations/screenshots/sprint-16N3/eval";
mkdirSync(OUT, { recursive: true });
const want = new Set(process.argv.slice(2));
const on = (s) => want.size === 0 || want.has(s);
const stamp = Date.now().toString(36).toUpperCase();
const mk = async (key) => { const c = await pwRequest.newContext({ baseURL: BASE }); const r = await c.post("/api/test-auth/sign-in", { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } }); if (r.status() !== 200) throw new Error("sign-in " + r.status()); return c; };
const post = async (c, path, data) => { const r = await c.post(path, { data }); if (r.status() !== 201) throw new Error(path + " " + r.status() + " " + (await r.text())); return r.json(); };
const mgr = await mk("b-manager");
const bp = await mk("b-pilot");
const me = await (await bp.get("/api/ops/me")).json();
const ac = await post(mgr, "/api/ops/aircraft", { registrationMark: `JU16E${stamp}`.slice(0, 20), modelName: "N3 評価機", manufacturer: "DJI", serialNumber: `SN-E${stamp}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 });
const plan = await post(mgr, "/api/ops/plans", { title: `橋梁の定期点検と河川敷の空撮の合同飛行 ${stamp}`, aircraftId: ac.id, pilotId: me.pilotId, plannedStartAt: "2027-01-05T13:00", durationMinutes: 30, purpose: "現場の空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] });
const ac2 = await post(mgr, "/api/ops/aircraft", { registrationMark: `JU16F${stamp}`.slice(0, 20), modelName: "N3 評価機 2", manufacturer: "DJI", serialNumber: `SN-F${stamp}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 });
await post(mgr, "/api/ops/plans", { title: `午後の山あいの送電線の巡視撮影と周辺の確認 ${stamp}`, aircraftId: ac2.id, pilotId: me.pilotId, plannedStartAt: "2027-01-05T16:00", durationMinutes: 30, purpose: "巡視", placeName: "山あい", latitude: 35.43, longitude: 133.38, flags: [] });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const settle = (p) => p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
const open = async (w, h, zoom, path, ready, key = "b-manager", opts = {}) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, locale: "ja-JP", serviceWorkers: "block", ...opts });
  await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  const page = await ctx.newPage();
  await page.goto(BASE + path);
  if (ready) await page.locator(ready).first().waitFor({ state: "visible" });
  if (zoom && zoom !== 100) await page.evaluate((z) => { document.documentElement.style.fontSize = z + "%"; }, zoom);
  await settle(page);
  return { ctx, page };
};
const log = (...a) => console.log(`[${TAG}]`, ...a);
const FIELD = `/ops/plans/${plan.id}/field`;

if (on("n31")) {
  for (const w of [320, 360, 390, 430]) for (const z of [100, 125, 150, 200]) {
    const { ctx, page } = await open(w, 740, z, FIELD, '[data-testid="field-root"][data-hydrated="true"]');
    const info = await page.evaluate(() => {
      const band = document.querySelector('[data-testid="field-status-band"]');
      const cb = document.querySelector('[data-testid="field-band-compact"]');
      const cs = band ? getComputedStyle(band) : null;
      return { bandPos: cs?.position, bandH: band ? Math.round(band.getBoundingClientRect().height * 10) / 10 : null, compact: cb ? getComputedStyle(cb).display : null, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    let res = { ...info };
    {
      // 離陸のボタンまでスクロール（中央・先頭・末尾）
      const btn = page.getByTestId("field-flight-button").first();
      const pts = [];
      for (const where of ["center", "start", "end"]) {
        await btn.evaluate((e, wh) => e.scrollIntoView({ block: wh, behavior: "instant" }), where);
        await settle(page);
        pts.push(await page.evaluate(() => {
          const c0 = document.querySelector('[data-testid="field-band-compact"]');
          const shown = c0 && getComputedStyle(c0).display !== "none";
          const cb = shown ? c0 : document.querySelector('[data-testid="field-status-band"]');
          const u = shown ? document.querySelector('[data-testid="field-band-compact-unsent"]') : document.querySelector('[data-testid="field-status-unsent"]');
          const t = document.querySelector('[data-testid="field-flight-button"]');
          const ur = u.getBoundingClientRect(), tr = t.getBoundingClientRect(), cr = cb.getBoundingClientRect();
          const at = (r) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const eu = at(ur), et = at(tr);
          const inView = tr.top >= 0 && tr.bottom <= innerHeight;
          return { mode: shown ? "compact" : "full", pos: getComputedStyle(cb).position, bandH: Math.round(cr.height * 10) / 10, bandTop: cr.top, unsentInBand: !!eu && cb.contains(eu), unsentInViewport: ur.top >= 0 && ur.bottom <= innerHeight && ur.left >= 0 && ur.right <= innerWidth, btnTopmost: !!et && (et === t || t.contains(et)), btnInView: inView, btnTop: Math.round(tr.top), bandBottom: Math.round(cr.bottom), oneLine: cr.height <= parseFloat(getComputedStyle(cb).lineHeight) + 12, sw: document.documentElement.scrollWidth };
        }));
      }
      res.pts = pts;
      if (w === 320 && z === 200) { await page.evaluate(() => scrollTo(0, 0)); await settle(page); await page.screenshot({ path: `${OUT}/n31-field-${w}-${z}-top-${TAG}.png` }); await page.getByTestId("field-flight-button").first().evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" })); await settle(page); await page.screenshot({ path: `${OUT}/n31-field-${w}-${z}-takeoff-${TAG}.png` }); }
      if (w === 390 && z === 150) { await page.getByTestId("field-flight-button").first().evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" })); await settle(page); await page.screenshot({ path: `${OUT}/n31-field-${w}-${z}-takeoff-${TAG}.png` }); }
    }
    log(`n31 ${w}/${z}`, JSON.stringify(res));
    await ctx.close();
  }
  // 圏外
  for (const [w, z] of [[320, 200], [360, 125], [390, 150], [430, 200]]) {
    const { ctx, page } = await open(w, 740, z, FIELD, '[data-testid="field-root"][data-hydrated="true"]');
    await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline"))); await page.waitForTimeout(400); await settle(page);
    const r = await page.evaluate(() => { const cb = document.querySelector('[data-testid="field-band-compact"]'); const c = cb.children[0], u = cb.children[1]; return { conn: c.textContent, unsent: u.textContent, bandH: cb.getBoundingClientRect().height, right: u.getBoundingClientRect().right, cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, bandSw: cb.scrollWidth, bandCw: cb.clientWidth }; });
    log(`n31-offline ${w}/${z}`, JSON.stringify(r));
    if (w === 320) await page.screenshot({ path: `${OUT}/n31-offline-${w}-${z}-${TAG}.png` });
    await ctx.close();
  }
}

const name40 = `四十字の氏名で期限の対象を長くする試験操縦者${stamp}ＡＢＣＤＥＦＧＨＩＪＫＬ`.slice(0, 40);
if (on("n38")) await post(mgr, "/api/ops/pilots", { fullName: name40, hasLicense: true, licenseClass: "second", licenseNumber: `ND-${stamp}`.slice(0, 30), licenseExpiresOn: "2027-01-06" });

if (on("n32")) {
  for (const w of [320, 360]) {
    const { ctx, page } = await open(w, 740, 200, FIELD, '[data-testid="field-root"][data-hydrated="true"]');
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const wide = [];
      for (const el of document.body.querySelectorAll("*")) { const b = el.getBoundingClientRect(); if (b.width > 0 && b.right > de.clientWidth + 0.5) wide.push((el.getAttribute("data-testid") ?? el.tagName) + "→" + b.right.toFixed(0)); }
      const t = (sel, txt) => [...document.querySelectorAll(sel)].find((e) => (e.textContent ?? "").includes(txt));
      const rr = (e) => e ? { right: Math.round(e.getBoundingClientRect().right), sw: e.scrollWidth, cw: e.clientWidth } : null;
      const chips = [...document.querySelectorAll('[data-testid="field-same-day-link"]')].map((a) => { const s = a.querySelector("span:last-child"); const cs = getComputedStyle(s); return { text: s.textContent, ov: cs.overflow, to: cs.textOverflow, trunc: s.scrollWidth > s.clientWidth + 1, h: Math.round(a.getBoundingClientRect().height), lines: Math.round(s.getBoundingClientRect().height / parseFloat(cs.lineHeight)), w: Math.round(a.getBoundingClientRect().width) }; });
      return { sw: de.scrollWidth, cw: de.clientWidth, wide, h3: rr(t("h3", "飛行自粛要請")), h4: rr(t("h4", "飛行マニュアル")), back: rr(document.querySelector('[data-testid="field-back"]')), backH: Math.round(document.querySelector('[data-testid="field-back"]').getBoundingClientRect().height), chips };
    });
    log(`n32 ${w}/200`, JSON.stringify(r));
    await page.screenshot({ path: `${OUT}/n32-field-${w}-200-top-${TAG}.png`, fullPage: false });
    const ch = page.getByTestId("field-same-day-link").first();
    if (await ch.count()) { await ch.scrollIntoViewIfNeeded(); await settle(page); await page.screenshot({ path: `${OUT}/n32-field-${w}-200-chips-${TAG}.png` }); }
    await ctx.close();
  }
}

const probeDates = (page) => page.evaluate(() => {
  const canvas = document.createElement("canvas").getContext("2d");
  return [...document.querySelectorAll('input[type="date"], input[type="time"]')].filter((i) => i.getBoundingClientRect().width > 0).map((i) => {
    const cs = getComputedStyle(i);
    canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const sample = i.type === "date" ? "2027/01/05" : "12:34";
    return { id: i.getAttribute("data-testid") ?? i.getAttribute("aria-label") ?? i.type, type: i.type, value: i.value, w: Math.round(i.getBoundingClientRect().width), cw: i.clientWidth, sw: i.scrollWidth, pl: cs.paddingLeft, ls: cs.letterSpacing, fs: cs.fontSize, textW: Math.round(canvas.measureText(sample).width), clipped: i.scrollWidth > i.clientWidth + 1 };
  });
});
if (on("n34")) {
  const screens = [["flights", "/ops/flights/new"], ["inspections", "/ops/inspections/new"], ["inspfromjournal", `/ops/inspections/new?aircraftId=${ac.id}&takeoffAt=2027-01-05T11:00`]];
  for (const [w, z] of [[320, 200], [360, 100], [360, 200], [375, 100], [375, 200], [390, 100]]) for (const [nm, path] of screens) {
    const { ctx, page } = await open(w, 740, z, path, "form");
    // 値を入れて撮る（値が長い日付）
    for (const d of await page.locator('input[type="date"]').all()) { if (await d.isVisible()) await d.fill("2027-12-30").catch(() => {}); }
    for (const t of await page.locator('input[type="time"]').all()) { if (await t.isVisible()) await t.fill("23:59").catch(() => {}); }
    await settle(page);
    const r = await probeDates(page);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    log(`n34 ${nm} ${w}/${z}`, JSON.stringify({ docSw: sw, inputs: r }));
    if ((w === 360 || w === 375 || w === 320) && z !== 0) { const f = page.locator('input[type="date"]').first(); await f.scrollIntoViewIfNeeded(); await settle(page); await page.screenshot({ path: `${OUT}/n34-${nm}-${w}-${z}-${TAG}.png` }); }
    await ctx.close();
  }
  // 段 ②
  for (const [w, z] of [[320, 200], [360, 100], [375, 100]]) {
    const { ctx, page } = await open(w, 740, z, "/ops/plans/new", '[data-testid="plan-form"]');
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByTestId("plan-place-name")?.fill("N3 試験地点").catch(() => {});
    log(`n34 wizard-step1 ${w}/${z} (段 ② は E2E で確認)`);
    await ctx.close();
  }
}

if (on("n36")) {
  for (const w of [320, 360, 390]) for (const z of [100, 200]) {
    const { ctx, page } = await open(w, 640, z, "/ops", '[data-testid="ops-header"]');
    const r = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="ops-brand-mark"]'); const h = document.querySelector('[data-testid="ops-header"]');
      const sp = [...a.querySelectorAll("span")].map((e) => { const b = e.getBoundingClientRect(); return { t: e.textContent, l: Math.round(b.left), r: Math.round(b.right), sw: e.scrollWidth, cw: e.clientWidth }; });
      const btns = [...h.querySelectorAll("a, button")].map((e) => { const b = e.getBoundingClientRect(); return { n: e.getAttribute("data-testid") ?? e.getAttribute("aria-label"), w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left), r: Math.round(b.right) }; });
      return { hdrH: Math.round(h.getBoundingClientRect().height), brand: a.getBoundingClientRect().toJSON(), sp, btns, vw: innerWidth, sw: document.documentElement.scrollWidth };
    });
    log(`n36 ${w}/${z}`, JSON.stringify(r));
    await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: `${OUT}/n36-header-${w}-${z}-${TAG}.png`, clip: { x: 0, y: 0, width: w, height: 180 } });
    await ctx.close();
  }
}

if (on("n37")) {
  const { ctx, page } = await open(375, 812, 100, "/ops", '[data-testid="home-prep"]');
  const snap = await page.getByTestId("home-prep").ariaSnapshot();
  log("n37 ariaSnapshot\n" + snap);
  const info = await page.getByTestId("home-prep").evaluate((e) => ({ label: e.getAttribute("aria-label"), by: e.getAttribute("aria-labelledby"), role: e.tagName, titleId: e.querySelector("h2")?.id, inner: [...e.querySelectorAll("a, button")].map((x) => (x.textContent ?? "").trim()) }));
  log("n37 attrs", JSON.stringify(info));
  const reg = await page.getByRole("region", { name: "次の飛行の準備", exact: true }).count();
  log("n37 region by name count", reg);
  await ctx.close();
}

if (on("n38")) {
  const { ctx, page } = await open(375, 812, 100, "/ops", '[data-testid="home-prep"]');
  const m = await page.evaluate(() => { const q = document.querySelector('[data-testid="home-quick"]').getBoundingClientRect(); const nav = document.querySelector('[data-testid="ops-bottom-nav"]').getBoundingClientRect(); const head = document.querySelector(".home-prep-head"); const t = document.querySelector('[data-testid="home-prep-title"]').getBoundingClientRect(); const w = document.querySelector('[data-testid="home-prep-when"]').getBoundingClientRect(); const dl = document.querySelector('[data-testid="home-deadlines"]'); return { margin: nav.top - q.bottom, quickBottom: q.bottom, navTop: nav.top, titleRect: [t.left, t.top, t.right, t.bottom].map(Math.round), whenRect: [w.left, w.top, w.right, w.bottom].map(Math.round), sameRow: Math.abs(t.bottom - w.bottom) < 6, dlText: dl ? dl.innerText.slice(0, 200) : null, title2: document.querySelector('[data-testid="home-next"]')?.innerText.slice(0,200) }; });
  log("n38 home 375x812", JSON.stringify(m));
  await page.screenshot({ path: `${OUT}/n38-home-375-${TAG}.png` });
  await page.screenshot({ path: `${OUT}/n38-home-375-full-${TAG}.png`, fullPage: true });
  await ctx.close();
  for (const [w, z] of [[375, 125], [320, 100], [360, 100], [390, 100], [320, 200]]) {
    const { ctx: c2, page: p2 } = await open(w, 740, z, "/ops", '[data-testid="home-prep"]');
    const r = await p2.evaluate(() => { const t = document.querySelector('[data-testid="home-prep-title"]').getBoundingClientRect(); const wh = document.querySelector('[data-testid="home-prep-when"]').getBoundingClientRect(); const c = document.querySelector('[data-testid="home-prep"]').getBoundingClientRect(); return { title: [t.left, t.top, t.right, t.bottom].map(Math.round), when: [wh.left, wh.top, wh.right, wh.bottom].map(Math.round), card: Math.round(c.height), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
    log(`n38 prep ${w}/${z}`, JSON.stringify(r));
    if (z !== 100 || w === 320) await p2.screenshot({ path: `${OUT}/n38-prep-${w}-${z}-${TAG}.png`, clip: { x: 0, y: 0, width: w, height: 500 } });
    await c2.close();
  }
}

if (on("n30")) {
  // §17 の 30：today / more の右端
  for (const [w, h] of [[375, 812], [1280, 800]]) {
    const { ctx, page } = await open(w, h, 100, "/", null, "b-manager");
    await page.waitForTimeout(1500); await settle(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll("a.sb-row")].map((a) => { const d = a.querySelector(".sb-go-dot"); const r = a.getBoundingClientRect(); const dr = d?.getBoundingClientRect(); const cs = d && getComputedStyle(d); return { href: a.getAttribute("href"), tid: a.getAttribute("data-testid"), rowW: Math.round(r.width), rowH: Math.round(r.height), dot: d ? { w: dr.width, h: dr.height, bg: cs.backgroundColor, br: cs.borderRadius, color: cs.color, svg: !!d.querySelector("svg"), aria: d.getAttribute("aria-hidden") } : null }; }));
    log(`n30 / ${w}`, JSON.stringify(rows));
    const sr = page.locator("a.sb-row").first();
    if (await sr.count()) { await sr.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/n30-root-${w}-${TAG}.png` }); }
    await ctx.close();
  }
  for (const [w, h] of [[375, 812], [1280, 800]]) {
    const { ctx, page } = await open(w, h, 100, "/ops/more", null);
    await page.waitForTimeout(800); await settle(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="more-link-"]')].map((a) => { const d = a.querySelector(".sb-go-dot"); const r = a.getBoundingClientRect(); const dr = d?.getBoundingClientRect(); const cs = d && getComputedStyle(d); return { tid: a.getAttribute("data-testid"), href: a.getAttribute("href"), rowW: Math.round(r.width), rowH: Math.round(r.height), dot: d ? { w: dr.width, h: dr.height, bg: cs.backgroundColor, br: cs.borderRadius, color: cs.color } : null }; }));
    log(`n30 /ops/more ${w}`, JSON.stringify(rows));
    await page.screenshot({ path: `${OUT}/n30-more-${w}-${TAG}.png` });
    // 行の右端（chevron の外側）を押して遷移するか
    const first = page.locator('[data-testid^="more-link-"]').first();
    const bx = await first.boundingBox();
    const href = await first.getAttribute("href");
    await page.mouse.click(bx.x + bx.width - 4, bx.y + bx.height / 2);
    await page.waitForURL((u) => u.pathname === href, { timeout: 8000 }).then(() => log(`n30 more ${w} 右端クリックで遷移 OK ${href}`)).catch(() => log(`n30 more ${w} 右端クリックで遷移せず ${href}（1 回目のタップ問題の可能性。再クリック）`));
    await ctx.close();
  }
}

if (on("nso")) {
  for (const w of [320, 375, 390]) {
    // 圏外で離陸を押して、端末に送信待ち 1 件を作る → オンラインに戻して /ops/more でログアウト
    const { ctx, page } = await open(w, 812, 100, FIELD, '[data-testid="field-root"][data-hydrated="true"]', "b-manager");
    await ctx.setOffline(true);
    await page.getByTestId("field-flight-button").click();
    await page.getByTestId("field-unsent").waitFor({ timeout: 8000 }).catch(() => {});
    await ctx.setOffline(false);
    await page.goto(BASE + "/ops/more");
    for (let n = 0; n < 8; n++) { await page.getByTestId("user-menu-button").click(); await page.getByTestId("signout").click(); if (await page.getByTestId("signout-warning").isVisible().catch(() => false)) break; await page.waitForTimeout(500); }
    await page.waitForTimeout(500);
    const k = page.getByTestId("signout-keep");
    if (await k.count()) {
      const r = await k.evaluate((e) => { const sp = [...e.querySelectorAll("span.inline-block")]; const note = e.querySelector("span:last-child"); return { noteText: note.textContent, parts: sp.map((x) => { const b = x.getBoundingClientRect(); return { t: x.textContent, lines: Math.round(b.height / parseFloat(getComputedStyle(x).lineHeight)), right: Math.round(b.right) }; }), noteH: Math.round(note.getBoundingClientRect().height), btnH: Math.round(e.getBoundingClientRect().height), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
      log(`nso ${w}`, JSON.stringify(r));
      await k.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/nso-${w}-${TAG}.png` });
    } else log(`nso ${w}: signout-keep が出ない`);
    await ctx.close();
  }
}
await b.close();
