// 期限の行の読み上げ順（アクセシビリティ ツリー）と、Tab の順（視覚の順との比較）、文字 200% の末尾（下部ナビが最後の要素を隠さない）。
import { apiAs, launch, newPage, mkAircraft, pilotId, mkPlan, confirmPlan, voidAll, shot, waitStyles, stamp, BASE } from "./sprint-16G-eval-lib.mjs";
const bm = await apiAs("b-manager"); const pid = await pilotId(); const browser = await launch(); const out = {};
try {
  await voidAll(bm);
  const id = await mkPlan(bm, { title: `読み上げ ${stamp}`, aircraftId: await mkAircraft(bm, "w"), pilotId: pid, place: "米子市日吉津", flags: ["method_night"] });
  await confirmPlan(bm, id);
  const { context, page } = await newPage(browser, "b-manager", { width: 375, height: 812 });
  await page.goto(`${BASE}/ops`); await page.waitForSelector('[data-testid="home-prep"]'); await waitStyles(page);
  out.deadlineAria = await page.locator('[data-testid="home-deadlines"]').ariaSnapshot();
  out.prepAria = await page.locator('[data-testid="home-prep"]').ariaSnapshot();
  out.mainAria = await page.locator('main').ariaSnapshot();
  // 期限の行の視覚の順（左上の座標）と DOM の順
  out.deadlineVisual = await page.evaluate(() => {
    const dl = document.querySelector('[data-testid="deadline-link"]');
    const parts = [["種別", dl.querySelector("span.font-bold")], ["対象", dl.querySelector("span.break-words")], ["日付", dl.querySelector("time")], ["札", dl.querySelector(".sb-tag, .text-sb-ink-3")]];
    return parts.map(([n, e]) => { const r = e.getBoundingClientRect(); return { n, top: Math.round(r.top), left: Math.round(r.left), text: e.textContent.trim().slice(0, 30) }; });
  });
  // Tab の順（上から下の視覚の順と合うか）
  const order = [];
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-testid") ?? e.tagName, top: Math.round(r.top + window.scrollY), left: Math.round(r.left) }; });
    if (f) order.push(f);
  }
  out.tabOrder = order;
  await context.close();
  // 文字 200%：末尾までスクロールして、下部ナビが最後の要素を隠さないか
  for (const [w, h] of [[390, 844], [430, 932], [320, 640]]) {
    const c = await newPage(browser, "b-manager", { width: w, height: h });
    await c.page.goto(`${BASE}/ops`); await c.page.waitForSelector('[data-testid="home-prep"]');
    await c.page.addStyleTag({ content: "html{font-size:32px !important}" }); await waitStyles(c.page);
    await c.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await c.page.waitForTimeout(200);
    const m = await c.page.evaluate(() => { const nav = document.querySelector('[data-testid="ops-bottom-nav"]').getBoundingClientRect(); const d = document.querySelector('[data-testid="today-disclaimer"]').getBoundingClientRect(); const p = document.querySelector('[data-testid="home-primary"]').getBoundingClientRect(); return { navTop: Math.round(nav.top), lastBottom: Math.round(d.bottom), gap: Math.round(nav.top - d.bottom), primaryW: Math.round(p.width), primaryH: Math.round(p.height), scrollW: document.documentElement.scrollWidth, innerW: innerWidth, fs: getComputedStyle(document.querySelector('[data-testid="home-prep-report-text"]')).fontSize }; });
    out[`zoom-${w}`] = m;
    await c.page.evaluate(() => window.scrollTo(0, 0)); await c.page.waitForTimeout(100); await shot(c.page, `zoom200-${w}x${h}-top`);
    await c.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await c.page.waitForTimeout(100); await shot(c.page, `zoom200-${w}x${h}-bottom`);
    await c.context.close();
  }
} finally { await voidAll(bm).catch(() => undefined); await browser.close(); await bm.dispose(); }
console.log(JSON.stringify(out, null, 1));
