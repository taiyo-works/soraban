import { defineConfig, devices } from "@playwright/test";

// E2E（Sprint 6）: 地点切替 → 条件変更 → 履歴復元 → PDF 出力 の主要導線を検証する。
// ローカルは next dev、CI は build 済みの next start を E2E_SERVER_CMD で指定する。
// ブラウザは同梱 chromium。E2E_CHROME_CHANNEL=chrome でシステムの Chrome を使える。
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    ...(process.env.E2E_CHROME_CHANNEL ? { channel: process.env.E2E_CHROME_CHANNEL } : {}),
  },
  webServer: {
    command:
      process.env.E2E_SERVER_CMD ?? `pnpm --filter @soraban/web exec next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
