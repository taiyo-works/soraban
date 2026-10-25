// 実行: node docs/design/tokens/sheet/shoot.mjs <出力先.png> [index.html]  Chromium は /opt/pw-browsers のもの
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
const require = createRequire("/home/user/soraban/package.json");
const { chromium } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
const src = process.argv[3] ?? path.join(here, "index.html");
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const p = await b.newPage({ viewport: { width: 2400, height: 1000 }, colorScheme: "light", reducedMotion: "reduce" });
await p.goto(pathToFileURL(src).href);
await p.evaluate(() => document.fonts.ready);
const h = await p.evaluate(() => document.documentElement.scrollHeight);
await p.screenshot({ path: out, fullPage: true });
const over = await p.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow === "visible" && e.clientWidth > 0 && !e.closest("svg")).slice(0, 12).map((e) => e.tagName + "." + e.className + " " + e.scrollWidth + ">" + e.clientWidth));
console.log("height", h, "overflow", JSON.stringify(over));
await b.close();
