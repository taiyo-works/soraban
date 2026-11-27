// 長い場所名（30 字）・長い期限の対象（約 40 字）・文字 200%・320 幅の測定。
import { apiAs, launch, newPage, mkAircraft, pilotId, mkPlan, confirmPlan, voidAll, shot, waitStyles, stamp, BASE } from "./sprint-16G-eval-lib.mjs";

const bm = await apiAs("b-manager");
const pid = await pilotId();
const browser = await launch();
const out = [];
const LONG_PLACE = "鳥取県米子市皆生温泉三丁目の海岸ひろば北側の臨時駐車場前広場"; // 30 字
const LONG_PILOT = process.env.PILOT_NAME ?? "とても長い氏名の操縦者テスト太郎ホームの期限確認用四十字";
try {
  await voidAll(bm);
  const ac = await mkAircraft(bm, "l");
  for (const [n, exp] of JSON.parse(process.env.PILOT_DATES ?? '[["A","2027-01-20"],["B","2027-02-05"]]')) {
    const r = await bm.post("/api/ops/pilots", { data: { fullName: `${LONG_PILOT}${n}${stamp}`.slice(0, 40), hasLicense: true, licenseClass: "second", licenseNumber: `EV16-${stamp}-${n}`.slice(0, 30), licenseExpiresOn: exp } });
    out.push({ pilotCreate: r.status() });
  }
  const id = await mkPlan(bm, { title: `長い場所の計画 ${stamp}`, aircraftId: ac, pilotId: pid, place: LONG_PLACE, flags: ["method_night"] });
  await confirmPlan(bm, id);
  out.push({ placeLen: [...LONG_PLACE].length });

  const measure = async (label, w, h, zoom, hide = []) => {
    const { context, page } = await newPage(browser, "b-manager", { width: w, height: h });
    await page.goto(`${BASE}/ops`);
    await page.waitForSelector('[data-testid="home-prep"]');
    if (zoom) await page.addStyleTag({ content: `html{font-size:${16 * zoom}px !important}` });
    for (const id of hide) await page.addStyleTag({ content: `[data-testid="${id}"]{display:none !important}` });
    await waitStyles(page);
    const m = await page.evaluate(() => {
      const q = (id) => document.querySelector(`[data-testid="${id}"]`);
      const box = (id) => { const e = q(id); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }; };
      const nav = q("ops-bottom-nav").getBoundingClientRect();
      const quick = q("home-quick")?.getBoundingClientRect();
      // 切れ：overflow hidden/clip で内容が箱より大きい要素（文字を持つもの）
      const clipped = [];
      document.querySelectorAll("main *").forEach((e) => {
        const cs = getComputedStyle(e);
        if (!/hidden|clip/.test(cs.overflowX + cs.overflowY)) return;
        if (!e.textContent?.trim()) return;
        const r = e.getBoundingClientRect();
        if (r.width === 0) return;
        if (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) clipped.push(e.getAttribute("data-testid") ?? e.tagName);
      });
      // 期限の行：種別の行数（1 字ずつ折れていないか）、日付・札が行の箱の中か
      const dl = q("deadline-link");
      let deadline = null;
      if (dl) {
        const lr = dl.getBoundingClientRect();
        const spans = Array.from(dl.querySelectorAll("span, time"));
        const whatEl = dl.querySelector("span.font-bold") ?? dl.querySelector("span");
        const fs = parseFloat(getComputedStyle(whatEl).fontSize);
        const lh = parseFloat(getComputedStyle(whatEl).lineHeight);
        const timeEl = dl.querySelector("time");
        const tag = dl.querySelector(".sb-tag, span.text-sm.text-sb-ink-3");
        const inBox = (e) => { const r = e.getBoundingClientRect(); return r.left >= lr.left - 1 && r.right <= lr.right + 1 && r.width > 0; };
        deadline = {
          rowH: Math.round(lr.height), rowW: Math.round(lr.width),
          whatLines: Math.round(whatEl.getBoundingClientRect().height / lh), whatW: Math.round(whatEl.getBoundingClientRect().width), whatFs: fs,
          timeInBox: timeEl ? inBox(timeEl) : null, tagInBox: tag ? inBox(tag) : null,
          timeText: timeEl?.textContent, text: dl.innerText.replace(/\s+/g, " "),
          subjectLines: (() => { const s = dl.querySelector("span.break-words"); return s ? Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight)) : null; })(),
        };
      }
      // 14px の要素の行間比（補足）
      const lowLH = [];
      document.querySelectorAll("main *").forEach((e) => {
        if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
        const cs = getComputedStyle(e);
        const fs = parseFloat(cs.fontSize);
        const lh = cs.lineHeight === "normal" ? NaN : parseFloat(cs.lineHeight);
        if (fs < 15 && !(lh / fs >= 1.49)) lowLH.push({ id: e.getAttribute("data-testid") ?? e.className.toString().slice(0, 40) ?? e.tagName, tag: e.tagName, ratio: +(lh / fs).toFixed(3), note: e.hasAttribute("data-note") });
      });
      return {
        scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
        navTop: Math.round(nav.top), quickBottom: quick ? Math.round(quick.bottom) : null, gapToNav: quick ? Math.round(nav.top - quick.bottom) : null,
        place: box("today-place"), when: box("home-prep-when"), nextPlace: box("home-next-place"), prep: box("home-prep"), next: box("home-next"), primary: box("home-primary"),
        clipped, deadline, lowLH,
        deadlinesBox: box("home-deadlines"),
      };
    });
    out.push({ label, w, h, zoom, hide, ...m });
    await shot(page, `${label}-${w}x${h}${zoom ? `-z${zoom}` : ""}`);
    await context.close();
    return m;
  };

  await measure("long-base", 375, 812, 0);
  await measure("long-base", 390, 844, 0);
  await measure("long-base", 320, 640, 0);
  // 外す候補ごとの回復量
  for (const h of [["today-place"], ["home-prep-when"], ["home-next-place"], ["today-place", "home-prep-when"]]) await measure(`long-hide-${h.join("+")}`, 375, 812, 0, h);
  await measure("long-z2", 390, 844, 2);
  await measure("long-z2", 430, 932, 2);
  await measure("long-z2", 320, 640, 2);
  await measure("long-z2", 375, 812, 2);
} finally {
  await voidAll(bm).catch(() => undefined);
  await browser.close();
  await bm.dispose();
}
console.log(JSON.stringify(out, null, 1));
