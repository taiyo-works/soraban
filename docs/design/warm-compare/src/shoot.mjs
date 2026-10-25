// 実行: node docs/design/warm-compare/src/shoot.mjs   各案をスマホ(390)・PC(1280)で撮る。はみ出し検査つき。
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
const require = createRequire("/home/user/soraban/package.json");
const { chromium } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..");
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
for (const id of ["a", "b", "c"]) {
  for (const [name, w, h] of [["mobile", 390, 844], ["pc", 1280, 900]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
    await p.goto(pathToFileURL(path.join(out, `${id}.html`)).href);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(out, `${id}-${name}.png`), fullPage: true });
    const r = await p.evaluate(() => {
      const bad = [];
      const docW = document.documentElement.clientWidth;
      for (const e of document.querySelectorAll("body *")) {
        if (e.closest("svg")) continue;
        const cs = getComputedStyle(e);
        const rect = e.getBoundingClientRect();
        if (rect.width === 0) continue;
        if (e.scrollWidth > e.clientWidth + 1 && cs.display !== "inline" && !["hidden", "clip"].includes(cs.overflowX) && e.clientWidth > 0) bad.push("overflow " + e.tagName + "." + e.className + " " + e.scrollWidth + ">" + e.clientWidth);
        if (rect.right > docW + 1 && !e.closest(".hero-art")) bad.push("beyond " + e.tagName + "." + e.className + " " + Math.round(rect.right));
        const fs = parseFloat(cs.fontSize);
        if (fs < 12 && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) bad.push("small " + fs + " " + e.tagName + "." + e.className);
      }
      const tap = [...document.querySelectorAll("button,input")].filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.className + " " + Math.round(e.getBoundingClientRect().height));
      return { bad: bad.slice(0, 15), tap, h: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth };
    });
    console.log(id, name, JSON.stringify(r));
    await p.close();
  }
}
await b.close();
