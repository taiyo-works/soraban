// 長い場所名（30 字）で、外す候補ごとの 375×812 の余裕（クイック操作の下端と下部ナビの上端の差）を測る。期限は対象が短いもの（短い氏名）と長いものの両方。
import { apiAs, launch, newPage, mkAircraft, pilotId, mkPlan, confirmPlan, voidAll, shot, waitStyles, stamp, BASE } from "./sprint-16G-eval-lib.mjs";
const bm = await apiAs("b-manager"); const pid = await pilotId(); const browser = await launch(); const out = [];
const PLACE = "鳥取県米子市皆生温泉三丁目の海岸ひろば北側の臨時駐車場前広場";
try {
  await voidAll(bm);
  const id = await mkPlan(bm, { title: `長い場所 ${stamp}`, aircraftId: await mkAircraft(bm, "z"), pilotId: pid, place: PLACE, flags: ["method_night"] });
  await confirmPlan(bm, id);
  const run = async (label, w, h, css = "", js = null) => {
    const { context, page } = await newPage(browser, "b-manager", { width: w, height: h });
    await page.goto(`${BASE}/ops`); await page.waitForSelector('[data-testid="home-prep"]');
    if (css) await page.addStyleTag({ content: css });
    if (js) await page.evaluate(js);
    await waitStyles(page);
    const m = await page.evaluate(() => { const nav = document.querySelector('[data-testid="ops-bottom-nav"]').getBoundingClientRect(); const q = document.querySelector('[data-testid="home-quick"]').getBoundingClientRect(); const dl = document.querySelector('[data-testid="deadline-link"]'); return { gap: Math.round(nav.top - q.bottom), qBottom: Math.round(q.bottom), navTop: Math.round(nav.top), dlH: dl ? Math.round(dl.getBoundingClientRect().height) : null, dl: dl?.innerText.replace(/\s+/g, " ") }; });
    out.push({ label, w, h, ...m }); await shot(page, `${label.replace(/[^\w+-]/g, "_")}-${w}x${h}`); await context.close();
  };
  const dateOnly = `(() => { const e = document.querySelector('[data-testid="home-prep-when"]'); e.textContent = e.textContent.split("　")[0]; })()`;
  for (const [w, h] of [[375, 812], [390, 844]]) {
    await run("base", w, h);
    await run("A:prep-when を日時だけ", w, h, "", dateOnly);
    await run("B:today-place を外す", w, h, '[data-testid="today-place"]{display:none!important}');
    await run("C:next-place を外す", w, h, '[data-testid="home-next-place"]{display:none!important}');
    await run("A+C", w, h, '[data-testid="home-next-place"]{display:none!important}', dateOnly);
    await run("A+B", w, h, '[data-testid="today-place"]{display:none!important}', dateOnly);
    await run("B+C", w, h, '[data-testid="today-place"],[data-testid="home-next-place"]{display:none!important}');
    await run("A+B+C", w, h, '[data-testid="today-place"],[data-testid="home-next-place"]{display:none!important}', dateOnly);
    await run("D:today-place を 1 行に切る(省略記号)", w, h, '[data-testid="today-place"]{display:block;max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}');
  }
} finally { await voidAll(bm).catch(() => undefined); await browser.close(); await bm.dispose(); }
console.log(JSON.stringify(out, null, 1));
