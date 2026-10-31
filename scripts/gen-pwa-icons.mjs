// Sprint 15：PWA のアイコン（192・512・maskable 512・apple-touch-icon 180）を、既存のロゴ apps/web/src/app/icon.svg から作る。
// Playwright の Chromium で SVG を描いて PNG に書き出す（Firefly などの生成は使わない）。結果は apps/web/public/pwa/ に置き、リポジトリに入れる。
// 実行：node scripts/gen-pwa-icons.mjs（E2E_CHROMIUM_PATH で Chromium の実行ファイルを指定できる）
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(path.join(root, "apps/web/src/app/icon.svg"), "utf8");
const out = path.join(root, "apps/web/public/pwa");
const BG = "#1d3557";

const browser = await chromium.launch({
  ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const render = async (size, file, { maskable = false } = {}) => {
  // maskable：全面を背景色で塗り、ロゴを中央 80%（安全域）に収める
  const inner = maskable ? Math.round(size * 0.8) : size;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${maskable ? BG : "transparent"}">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  writeFileSync(path.join(out, file), await page.screenshot({ omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } }));
};
await render(192, "icon-192.png");
await render(512, "icon-512.png");
await render(512, "icon-maskable-512.png", { maskable: true });
await render(180, "apple-touch-icon.png", { maskable: true });
await browser.close();
console.log("written:", out);
