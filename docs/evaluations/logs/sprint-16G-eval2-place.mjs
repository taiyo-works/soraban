// 再評価：場所名の出現（見える範囲・HTML 全体・aria・title）と、クイック操作の余裕。短い場所／30 字／30 字＋長い期限の対象。
import { apiAs, launch, newPage, mkAircraft, pilotId, mkPlan, confirmPlan, voidAll, shot, waitStyles, stamp, BASE } from "./sprint-16G-eval2-lib.mjs";
const bm = await apiAs("b-manager"); const pid = await pilotId(); const browser = await launch(); const out = [];
const LONG = "鳥取県米子市皆生温泉三丁目の海岸ひろば北側の臨時駐車場前広場";
const SHORT = `地点${stamp}`;
const BAD = ["完璧", "保証", "必ず", "代行", "代理", "申請", "通報不要", "問題なし"];
const scenario = async (label, place, flags) => {
  await voidAll(bm);
  const id = await mkPlan(bm, { title: "ホームの確認", aircraftId: await mkAircraft(bm, "p" + Math.random().toString(36).slice(2, 5)), pilotId: pid, place, flags });
  await confirmPlan(bm, id);
  for (const [w, h] of [[375, 812], [390, 844], [1280, 800]]) {
    const { context, page } = await newPage(browser, "b-manager", { width: w, height: h });
    await page.goto(`${BASE}/ops`); await page.waitForSelector('[data-testid="home-prep"]'); await waitStyles(page);
    const m = await page.evaluate((place) => {
      const q = (id) => document.querySelector(`[data-testid="${id}"]`);
      const cnt = (s) => s.split(place).length - 1;
      const nav = q("ops-bottom-nav").getBoundingClientRect(); const qk = q("home-quick").getBoundingClientRect();
      const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden"; };
      // 見える要素のうち、場所名を直接の文字に持つもの（testid と、最初の画面の中か）
      const holders = [];
      document.querySelectorAll("body *").forEach((e) => { if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(place)) && vis(e)) { const r = e.getBoundingClientRect(); holders.push({ id: e.getAttribute("data-testid") ?? e.tagName, top: Math.round(r.top), inFirstScreen: r.bottom <= window.innerHeight }); } });
      const attrHits = []; document.querySelectorAll("*").forEach((e) => { for (const a of e.attributes) if (a.value.includes(place)) attrHits.push(`${e.getAttribute("data-testid") ?? e.tagName}[${a.name}]`); });
      const main = q("ops-today");
      return {
        innerTextCount: cnt(main.innerText), htmlCount: cnt(document.documentElement.outerHTML), htmlNoScript: cnt(document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/g, "")), holders, attrHits,
        todayPlace: document.querySelectorAll('[data-testid="today-place"]').length,
        heading: q("today-heading")?.innerText.replace(/\s+/g, " "), prepWhen: q("home-prep-when")?.innerText, prepWhenTitle: q("home-prep-when")?.getAttribute("title"),
        nextPlace: q("home-next-place")?.innerText, prepAria: q("home-prep")?.getAttribute("aria-label"),
        gap: +(nav.top - qk.bottom).toFixed(1), quickBottom: +qk.bottom.toFixed(1), navTop: +nav.top.toFixed(1), scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        deadlineText: q("deadline-link")?.innerText.replace(/\s+/g, " "), deadlineH: q("deadline-link") ? Math.round(q("deadline-link").getBoundingClientRect().height) : null,
        bodyText: document.body.innerText,
      };
    }, place);
    m.bad = BAD.filter((b) => m.bodyText.includes(b)); delete m.bodyText;
    out.push({ label, w, h, ...m }); await shot(page, `place-${label}-${w}x${h}`); await context.close();
  }
};
try {
  const LP = "とても長い氏名の操縦者テスト太郎ホームの期限確認用四十字";
  const r0 = await bm.post("/api/ops/pilots", { data: { fullName: `${LP}A${stamp}`.slice(0, 40), hasLicense: true, licenseClass: "second", licenseNumber: `EV16-${stamp}-A`.slice(0, 30), licenseExpiresOn: "2027-01-20" } }); out.push({ pilotCreate: r0.status() });
  await scenario("long30+longdeadline(最上段)", LONG, ["method_night"]);
  await scenario("short+longdeadline(最上段)", SHORT, ["method_night"]);
} finally { await voidAll(bm).catch(() => undefined); await browser.close(); await bm.dispose(); }
console.log(JSON.stringify(out, null, 1));
