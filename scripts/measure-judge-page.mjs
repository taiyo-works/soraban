// `/`（公開の判定画面）の表示の速さを測る（Sprint 12h PR ② の Q-17）。main と作業ブランチに同じ方法で使い、数字を並べる。
// 使い方: E2E_CHROMIUM_PATH=... node scripts/measure-judge-page.mjs http://127.0.0.1:3300 [回数=5]
// 測るもの（375×812 と 1280×800 のそれぞれ。外部への通信は遮断し、地図タイルは空の画像で返す）：
//   - 初期 HTML・CSS・JS（gzip）：ページが読んだものの合計。gzip は応答の本文（復号後）を zlib の既定で圧縮した大きさ。JS は読み込み中に要求された .js すべて（押したときに読む PDF などは含まない）
//   - フォントの転送量（woff2 の応答の本文の合計。復号後の大きさ）と本数
//   - LCP（最大の要素が出るまでの時間）と LCP の要素・CLS（初回の判定の結果が出るまでの合計）・見出し内の CLS
// 回数分の中央値を出す。サーバーは `next start`（本番ビルド）。
import { chromium } from "@playwright/test";
import zlib from "node:zlib";

const base = process.argv[2];
const runs = Number(process.argv[3] ?? 5);
if (!base) {
  console.error("使い方: node scripts/measure-judge-page.mjs <baseURL> [回数]");
  process.exit(2);
}
const exe = process.env.E2E_CHROMIUM_PATH;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const gz = (buf) => zlib.gzipSync(buf).length;

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const out = {};
for (const [name, w, h] of [
  ["375x812", 375, 812],
  ["1280x800", 1280, 800],
]) {
  const rows = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.route(/cyberjapandata\.gsi\.go\.jp/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.addInitScript(() => {
      window.__lcp = [];
      window.__cls = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp.push({ t: e.startTime, tag: e.element?.tagName ?? null, tid: e.element?.closest?.("[data-testid]")?.getAttribute("data-testid") ?? null, inHeader: !!e.element?.closest?.("header"), size: e.size });
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls.push({ v: e.value, t: e.startTime, inHeader: (e.sources ?? []).some((s) => s.node && document.querySelector("header")?.contains(s.node)) });
      }).observe({ type: "layout-shift", buffered: true });
    });
    const sizes = { html: 0, css: 0, js: 0, font: 0, fonts: 0, requests: 0 };
    const pending = [];
    page.on("response", (res) => {
      const url = res.url();
      if (!url.startsWith(base)) return;
      const type = res.request().resourceType();
      pending.push(
        res
          .body()
          .then((b) => {
            sizes.requests++;
            if (type === "document" && url === base + "/") sizes.html = gz(b);
            else if (type === "stylesheet") sizes.css += gz(b);
            else if (type === "script") sizes.js += gz(b);
            else if (type === "font") {
              sizes.font += b.length;
              sizes.fonts++;
            }
          })
          .catch(() => {}),
      );
    });
    const diag = page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok(), { timeout: 60000 });
    await page.goto(base + "/");
    await diag;
    await page.waitForTimeout(2500);
    await Promise.all(pending);
    const perf = await page.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls }));
    const lastLcp = perf.lcp.at(-1);
    rows.push({
      ...sizes,
      lcp: lastLcp?.t ?? null,
      lcpEl: lastLcp ? `${lastLcp.tag}${lastLcp.tid ? `[${lastLcp.tid}]` : ""}${lastLcp.inHeader ? " (header)" : ""}` : null,
      cls: perf.cls.reduce((a, c) => a + c.v, 0),
      clsHeader: perf.cls.filter((c) => c.inHeader).reduce((a, c) => a + c.v, 0),
    });
    await ctx.close();
  }
  out[name] = {
    runs,
    htmlGz: median(rows.map((r) => r.html)),
    cssGz: median(rows.map((r) => r.css)),
    jsGz: median(rows.map((r) => r.js)),
    fontBytes: median(rows.map((r) => r.font)),
    fontFiles: median(rows.map((r) => r.fonts)),
    requests: median(rows.map((r) => r.requests)),
    lcpMs: Math.round(median(rows.map((r) => r.lcp ?? 0))),
    lcpElements: [...new Set(rows.map((r) => r.lcpEl))],
    clsMedian: Number(median(rows.map((r) => r.cls)).toFixed(5)),
    clsMax: Number(Math.max(...rows.map((r) => r.cls)).toFixed(5)),
    clsHeaderMax: Number(Math.max(...rows.map((r) => r.clsHeader)).toFixed(5)),
    perRunLcp: rows.map((r) => Math.round(r.lcp ?? 0)),
  };
}
await browser.close();
console.log(JSON.stringify(out, null, 2));
