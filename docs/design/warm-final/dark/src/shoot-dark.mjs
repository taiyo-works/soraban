// 実行: node docs/design/warm-final/dark/src/shoot-dark.mjs
// 暗の 3 画面を撮り、①はみ出し ②12px 未満 ③押せる部品 44px 未満 ④描画された文字のコントラスト（実測）⑤OS の暗（属性なし）と強制の暗（data-theme）の絵の一致 を検査する。
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
const require = createRequire("/home/user/soraban/package.json");
const { chromium } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..");
const wf = path.join(out, "..");
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium" });
const shots = [["top", "mobile", 390, 844], ["result", "mobile", 1280, 900], ["home", "mobile", 390, 844]];

const inspect = ({ minFs, minTap }) => {
  const bad = [];
  const docW = document.documentElement.clientWidth;
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
    let base = { r: 0, g: 0, b: 0, a: 1 };
    for (const c of stack.reverse()) base = over(c, base);
    return base;
  };
  const contrast = [];
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
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const fs = parseFloat(cs.fontSize);
    if (fs < minFs && hasText) bad.push("small " + fs + " " + nm + " " + e.textContent.trim().slice(0, 12));
    const tappable = e.matches("button,select,input,a.pill,a.tab,a.s-item,a.s-child,a.back,a.row,a.more-link") || (e.matches("a") && cs.display !== "inline");
    if (tappable && rect.height < minTap - 0.5) bad.push("tap " + Math.round(rect.height) + " " + nm + " " + e.textContent.trim().slice(0, 10));
    if (tappable && rect.width < 44 - 0.5) bad.push("tapW " + Math.round(rect.width) + " " + nm);
    if (hasText && !e.closest('[aria-hidden="true"]')) { // 装飾（aria-hidden。見出しの背後の大きな数字）は文字の検査から外す（明と同じ扱い）
      const fg = parse(cs.color), bg = bgOf(e);
      if (fg) {
        const f = over(fg, bg);
        const a = L(f), c = L(bg), r = (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
        const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        contrast.push({ r, need, nm, t: e.textContent.trim().slice(0, 14) });
      }
    }
  }
  const low = contrast.filter((x) => x.r < x.need);
  const min = contrast.reduce((a, x) => (x.r / x.need < a.r / a.need ? x : a), contrast[0]);
  return { bad: bad.slice(0, 20), nbad: bad.length, nText: contrast.length, lowContrast: low.slice(0, 12), nLow: low.length, minContrast: min && { r: +min.r.toFixed(2), need: min.need, nm: min.nm, t: min.t }, sw: document.documentElement.scrollWidth };
};

let total = 0;
for (const [id, name, w, h] of shots) {
  // 強制の暗（data-theme="dark"）。OS 側は明のままにして、強制が効くことも確かめる
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
  await p.goto(pathToFileURL(path.join(out, `${id}.html`)).href);
  await p.evaluate(() => document.fonts.ready);
  const full = await p.evaluate(() => document.documentElement.scrollHeight);
  await p.setViewportSize({ width: w, height: Math.max(h, full) });
  const forced = await p.screenshot({ path: path.join(out, `${id}-${name}.png`), fullPage: true });
  const r = await p.evaluate(inspect, { minFs: 12, minTap: 44 });
  const theme = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sb-base").trim());
  await p.close();
  // OS の暗（属性なし。明の見本の HTML をそのまま、prefers-color-scheme: dark で開く）
  const q = await b.newPage({ viewport: { width: w, height: Math.max(h, full) }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
  await q.goto(pathToFileURL(path.join(wf, `${id}.html`)).href);
  await q.evaluate(() => document.fonts.ready);
  const media = await q.screenshot({ fullPage: true });
  await q.close();
  const same = Buffer.compare(forced, media) === 0;
  const fails = r.nbad + r.nLow + (r.sw > w ? 1 : 0) + (same ? 0 : 1) + (theme === "#1B1A18" ? 0 : 1);
  total += fails;
  console.log(id, name, JSON.stringify({ base: theme, ...r, osDarkEqualsForced: same }));
  await q.close?.();
}
console.log("検査の不合格:", total);
await b.close();
process.exit(total ? 1 : 0);
