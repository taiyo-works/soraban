// 実行: node docs/design/warm-final/src/shoot.mjs
// 5 画面を撮り、はみ出し・12px 未満（現場は 14px 未満）・押せる部品の高さ（44px 未満、現場 56px 未満）・ヒーローの高さを検査する。
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
const require = createRequire("/home/user/soraban/package.json");
const { chromium } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..");
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const shots = [
  ["top", "mobile", 390, 844], ["top", "pc", 1280, 900],
  ["result", "mobile", 1280, 900],
  ["home", "mobile", 390, 844], ["home", "pc", 1280, 900],
  ["field", "mobile", 390, 844], ["inspections", "mobile", 390, 844], ["journal", "mobile", 390, 844], ["plan-new", "mobile", 390, 844],
];
let total = 0;
for (const [id, name, w, h] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
  await p.goto(pathToFileURL(path.join(out, `${id}.html`)).href);
  await p.evaluate(() => document.fonts.ready);
  // 画面下に貼りつく帯（下タブ・保存バー）が撮影の途中に写り込まないよう、ページ全体の高さのビューポートで撮る
  const full = await p.evaluate(() => document.documentElement.scrollHeight);
  await p.setViewportSize({ width: w, height: Math.max(h, full) });
  await p.screenshot({ path: path.join(out, `${id}-${name}.png`), fullPage: true });
  const r = await p.evaluate(({ field }) => {
    const bad = [];
    const docW = document.documentElement.clientWidth;
    const minFs = field ? 14 : 12, minTap = field ? 56 : 44;
    for (const e of document.querySelectorAll("body *")) {
      if (e.closest("svg")) continue;
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const rect = e.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const nm = e.tagName + "." + e.className;
      if (e.scrollWidth > e.clientWidth + 1 && cs.display !== "inline" && !["hidden", "clip"].includes(cs.overflowX) && e.clientWidth > 0) bad.push("overflow " + nm + " " + e.scrollWidth + ">" + e.clientWidth);
      if (rect.right > docW + 1 && !e.closest(".hero-art")) bad.push("beyond " + nm + " " + Math.round(rect.right));
      if (rect.left < -1) bad.push("left<0 " + nm);
      const fs = parseFloat(cs.fontSize);
      if (fs < minFs && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) bad.push("small " + fs + " " + nm + " " + e.textContent.trim().slice(0, 12));
      const tappable = e.matches("button,select,input,[role=radio],a.pill,a.tab,a.s-item,a.s-child,a.back,a.row,a.more-link,a.f-back,a.f-step") || (e.matches("a") && cs.display !== "inline");
      if (tappable && rect.height < minTap - 0.5) bad.push("tap " + Math.round(rect.height) + " " + nm + " " + e.textContent.trim().slice(0, 10));
      if (tappable && rect.width < 44 - 0.5) bad.push("tapW " + Math.round(rect.width) + " " + nm);
    }
    const extra = {};
    const hero = document.querySelector(".hero"); if (hero) extra.hero = Math.round(hero.getBoundingClientRect().height);
    if (field) {
      extra.rows = [...document.querySelectorAll(".chk-row")].map((e) => Math.round(e.getBoundingClientRect().height));
      extra.tab = Math.round(document.querySelector(".tab").getBoundingClientRect().height); extra.tabs = document.querySelectorAll(".tabbar .tab").length; extra.lastVsTab = Math.round(document.querySelector(".tabbar").getBoundingClientRect().top - document.querySelector("#why").getBoundingClientRect().bottom);
      extra.primary = [...document.querySelectorAll(".pill-primary,.f-btn")].map((e) => Math.round(e.getBoundingClientRect().height));
      const anim = [...document.querySelectorAll("*")].filter((e) => { const c = getComputedStyle(e); return (c.animationName !== "none" && parseFloat(c.animationDuration) > 0) || parseFloat(c.transitionDuration) > 0; }).length;
      extra.animated = anim;
    }
    extra.radii = [...new Set([...document.querySelectorAll("body *")].map((e) => getComputedStyle(e).borderTopLeftRadius).filter((v) => v !== "0px"))].join(",");
    return { bad: bad.slice(0, 20), nbad: bad.length, extra, h: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth };
  }, { field: id === "field" });
  total += r.nbad + (r.sw > w ? 1 : 0);
  console.log(id, name, JSON.stringify(r));
  await p.close();
}
// 動きの確認：動きを許した状態で 1.2 秒待った撮影が、動きを減らした撮影と一致するか（せり上がりが終わって同じ絵になる）
for (const [id, w] of [["top", 390], ["home", 390]]) {
  const p = await b.newPage({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  await p.goto(pathToFileURL(path.join(out, `${id}.html`)).href);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `/tmp/claude-0/-home-user-soraban/5e54861b-053b-5f39-9727-378f5faa2cec/scratchpad/${id}-motion.png`, fullPage: true });
  await p.close();
}
console.log("検査の不合格:", total);
await b.close();
process.exit(total ? 1 : 0);
