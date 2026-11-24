// 期限の対象が約 40 文字（氏名 19 字＋既存の状態の文）で、場所が短いとき、375×812・390×844 のクイック操作と下部ナビの上端の距離。
import { apiAs, launch, newPage, mkAircraft, pilotId, mkPlan, confirmPlan, voidAll, shot, waitStyles, stamp, BASE } from "./sprint-16G-eval-lib.mjs";
const bm = await apiAs("b-manager"); const pid = await pilotId(); const browser = await launch(); const out = [];
try {
  await voidAll(bm);
  const r = await bm.post("/api/ops/pilots", { data: { fullName: "四十字対象の操縦者名ですテスト太郎", hasLicense: true, licenseClass: "second", licenseNumber: `S40-${stamp}`, licenseExpiresOn: "2027-01-05" } });
  out.push({ pilot: r.status() });
  const id = await mkPlan(bm, { title: `短い場所 ${stamp}`, aircraftId: await mkAircraft(bm, "y"), pilotId: pid, place: "米子市日吉津", flags: ["method_night"] });
  await confirmPlan(bm, id);
  for (const [w, h] of [[375, 812], [390, 844], [320, 640]]) {
    const { context, page } = await newPage(browser, "b-manager", { width: w, height: h });
    await page.goto(`${BASE}/ops`); await page.waitForSelector('[data-testid="home-prep"]'); await waitStyles(page);
    const m = await page.evaluate(() => { const nav = document.querySelector('[data-testid="ops-bottom-nav"]').getBoundingClientRect(); const q = document.querySelector('[data-testid="home-quick"]').getBoundingClientRect(); const dl = document.querySelector('[data-testid="deadline-link"]'); const sub = dl.querySelector("span.break-words"); return { gap: Math.round(nav.top - q.bottom), dlH: Math.round(dl.getBoundingClientRect().height), subLines: Math.round(sub.getBoundingClientRect().height / parseFloat(getComputedStyle(sub).lineHeight)), subChars: [...sub.textContent].length, dl: dl.innerText.replace(/\s+/g, " ") }; });
    out.push({ w, h, ...m }); await shot(page, `sub40-${w}x${h}`); await context.close();
  }
} finally { await voidAll(bm).catch(() => undefined); await browser.close(); await bm.dispose(); }
console.log(JSON.stringify(out, null, 1));
